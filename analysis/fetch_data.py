#!/usr/bin/env python3
"""Download study data from Firebase onto this computer.

    python analysis/fetch_data.py

Writes one JSON file per session into data/raw/, with:
- session metadata
- detailed trial summaries (including reach-level records and events)
- frame-by-frame raw chunks reassembled into each trial
- post-task survey response, when present
- a local downloadAudit section describing chunk completeness

Also writes data/raw/_sessions.csv as a compact index.

FIRST TIME SETUP (once per computer)
    pip install -r analysis/requirements.txt
    gcloud auth application-default login

That second command signs you in as yourself. It does not create or download a
key file, so there is no secret to accidentally commit. If your institution
blocks it, you can instead point GOOGLE_APPLICATION_CREDENTIALS at a service
account key file.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

from config_reader import REPO_ROOT, firebase_project_id


def connect(project_id: str):
    try:
        from google.cloud import firestore
    except ImportError:
        sys.exit(
            "The Firestore library is not installed.\n"
            "Fix:  pip install -r analysis/requirements.txt"
        )
    try:
        return firestore.Client(project=project_id)
    except Exception as err:  # noqa: BLE001 - friendly CLI error
        sys.exit(
            f"Could not connect to Firebase project '{project_id}'.\n\n"
            f"Original error: {err}\n\n"
            "Most likely fix:  gcloud auth application-default login\n"
            "(and check that the project id in config.js is spelled correctly)."
        )


def fetch(db, experiment: str | None, limit: int | None):
    """Pull parent session documents, newest first.

    Sort client-side by the ISO startedAt field so --experiment plus --limit
    does not require an extra Firestore composite index.
    """
    query = db.collection("sessions")
    if experiment:
        query = query.where("experimentId", "==", experiment)

    sessions = list(query.stream())
    sessions.sort(
        key=lambda snap: (snap.to_dict() or {}).get("startedAt") or "",
        reverse=True,
    )
    return sessions[:limit] if limit else sessions


def fetch_frames(db, session_id: str) -> tuple[dict[int, list], dict[int, dict]]:
    """Reassemble raw frame chunks and report chunk completeness per trial."""
    by_trial: dict[int, list[tuple[int, int | None, list]]] = defaultdict(list)
    chunks = db.collection("sessions").document(session_id).collection("chunks")

    for snap in chunks.stream():
        data = snap.to_dict() or {}
        trial_index = int(data.get("trialIndex", 0))
        chunk_index = int(data.get("chunkIndex", 0))
        expected_count = data.get("chunkCount")
        expected_count = int(expected_count) if isinstance(expected_count, (int, float)) else None
        by_trial[trial_index].append(
            (chunk_index, expected_count, data.get("frames", []))
        )

    frames_out: dict[int, list] = {}
    audit_out: dict[int, dict] = {}

    for trial_index, pieces in by_trial.items():
        pieces.sort(key=lambda p: p[0])

        frames: list = []
        observed_indices: list[int] = []
        expected_counts: list[int] = []

        for chunk_index, expected_count, chunk in pieces:
            observed_indices.append(chunk_index)
            if expected_count is not None:
                expected_counts.append(expected_count)
            frames.extend(chunk)

        expected = max(expected_counts) if expected_counts else len(pieces)
        expected_indices = list(range(expected))
        missing_indices = [i for i in expected_indices if i not in observed_indices]
        duplicate_indices = sorted({
            i for i in observed_indices if observed_indices.count(i) > 1
        })

        frames_out[trial_index] = frames
        audit_out[trial_index] = {
            "observedChunkCount": len(pieces),
            "expectedChunkCount": expected,
            "observedChunkIndices": observed_indices,
            "missingChunkIndices": missing_indices,
            "duplicateChunkIndices": duplicate_indices,
            "complete": not missing_indices and not duplicate_indices and len(pieces) == expected,
            "frameCount": len(frames),
        }

    return frames_out, audit_out


def fetch_trial_summaries(db, session_id: str) -> dict[int, dict]:
    """Fetch the full per-trial summary documents.

    These contain fields intentionally omitted from the compact parent session
    document, especially reach-level records and events.
    """
    out: dict[int, dict] = {}
    coll = (
        db.collection("sessions")
        .document(session_id)
        .collection("trialSummaries")
    )
    for snap in coll.stream():
        data = snap.to_dict() or {}
        idx = data.get("trialIndex")
        if isinstance(idx, int):
            out[idx] = data
    return out


def fetch_post_task_survey(db, session_id: str) -> dict | None:
    """Fetch the final post-task survey response if it exists."""
    snap = (
        db.collection("sessions")
        .document(session_id)
        .collection("postTaskSurvey")
        .document("response")
        .get()
    )
    return (snap.to_dict() or {}) if snap.exists else None


def enrich_session(db, session_id: str, session: dict) -> dict:
    """Merge compact parent data, detailed summaries, raw frames, and survey."""
    frames_by_trial, chunk_audit = fetch_frames(db, session_id)
    detailed_by_trial = fetch_trial_summaries(db, session_id)
    survey = fetch_post_task_survey(db, session_id)

    parent_trials = session.get("trials", []) or []
    parent_by_trial: dict[int, dict] = {}
    for fallback_index, trial in enumerate(parent_trials):
        idx = trial.get("index", fallback_index)
        if isinstance(idx, int):
            parent_by_trial[idx] = trial

    all_indices = sorted(
        set(parent_by_trial) |
        set(detailed_by_trial) |
        set(frames_by_trial)
    )

    enriched_trials: list[dict] = []
    for idx in all_indices:
        merged: dict = {}
        if idx in parent_by_trial:
            merged.update(parent_by_trial[idx])
        if idx in detailed_by_trial:
            merged.update(detailed_by_trial[idx])

        merged.setdefault("index", idx)
        merged["frames"] = frames_by_trial.get(idx, [])
        merged["rawChunkAudit"] = chunk_audit.get(idx, {
            "observedChunkCount": 0,
            "expectedChunkCount": 0,
            "observedChunkIndices": [],
            "missingChunkIndices": [],
            "duplicateChunkIndices": [],
            "complete": False,
            "frameCount": 0,
        })
        enriched_trials.append(merged)

    session["trials"] = enriched_trials
    if survey is not None:
        session["postTaskSurvey"] = survey

    incomplete_chunk_trials = [
        idx for idx, info in sorted(chunk_audit.items())
        if not info.get("complete", False)
    ]
    summary_missing_trials = [
        idx for idx in all_indices if idx not in detailed_by_trial
    ]

    session["downloadAudit"] = {
        "parentTrialCount": len(parent_trials),
        "detailedTrialSummaryCount": len(detailed_by_trial),
        "trialCountAfterMerge": len(enriched_trials),
        "rawTrialCount": len(frames_by_trial),
        "postTaskSurveyPresent": survey is not None,
        "incompleteRawChunkTrialIndices": incomplete_chunk_trials,
        "missingDetailedTrialSummaryIndices": summary_missing_trials,
        "allObservedRawChunksComplete": len(incomplete_chunk_trials) == 0,
    }
    return session


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--project", help="Firebase project id (default: read from config.js)")
    ap.add_argument("--experiment", help="only download one experiment id")
    ap.add_argument("--out", default="data/raw", help="output folder (default: data/raw)")
    ap.add_argument("--limit", type=int, help="stop after this many sessions")
    ap.add_argument("--force", action="store_true",
                    help="re-download sessions already saved locally")
    args = ap.parse_args()

    project_id = firebase_project_id(args.project)
    out_dir = (REPO_ROOT / args.out) if not Path(args.out).is_absolute() else Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Project : {project_id}")
    print(f"Output  : {out_dir}")

    db = connect(project_id)
    sessions = fetch(db, args.experiment, args.limit)
    print(f"Found   : {len(sessions)} session document(s)\n")

    index_rows, downloaded, skipped, selftests = [], 0, 0, 0

    for snap in sessions:
        session = snap.to_dict() or {}
        session_id = snap.id

        if session.get("experimentId") == "_selftest":
            selftests += 1
            continue

        target = out_dir / f"{session_id}.json"

        if target.exists() and not args.force:
            skipped += 1
            stored = json.loads(target.read_text(encoding="utf-8"))
        else:
            stored = enrich_session(db, session_id, session)
            target.write_text(
                json.dumps(stored, indent=1, default=str),
                encoding="utf-8"
            )
            downloaded += 1

            audit = stored.get("downloadAudit") or {}
            reach_total = sum(
                len(t.get("reaches", []) or [])
                for t in stored.get("trials", [])
            )
            frame_total = sum(
                len(t.get("frames", []) or [])
                for t in stored.get("trials", [])
            )

            print(
                f"  saved {session_id}  "
                f"({len(stored.get('trials', []))} trial records, "
                f"{reach_total} reach records, "
                f"{frame_total} frames, "
                f"status={stored.get('status')})"
            )

            if audit.get("incompleteRawChunkTrialIndices"):
                print(
                    "    WARNING missing/duplicate raw chunks in trial indices: "
                    + ", ".join(map(str, audit["incompleteRawChunkTrialIndices"]))
                )
            if audit.get("missingDetailedTrialSummaryIndices"):
                print(
                    "    WARNING no detailed trial summary for indices: "
                    + ", ".join(map(str, audit["missingDetailedTrialSummaryIndices"]))
                )
            if not audit.get("postTaskSurveyPresent"):
                print("    NOTE post-task survey response not found.")

        demographics = stored.get("demographics") or {}
        for trial in stored.get("trials", []):
            index_rows.append({
                "sessionId": session_id,
                "participantId": stored.get("participantId"),
                "experimentId": stored.get("experimentId"),
                "status": stored.get("status"),
                "startedAt": stored.get("startedAt"),
                "consentedAt": (stored.get("consent") or {}).get("agreedAt"),
                "age": demographics.get("age"),
                "dominantHand": demographics.get("dominantHand"),
                "trialIndex": trial.get("index"),
                "trialId": trial.get("id"),
                "kind": trial.get("kind"),
                "mapping": trial.get("mapping"),
                "frameCount": len(trial.get("frames", []) or []),
                "reachCount": len(trial.get("reaches", []) or []),
                "detectionRate": trial.get("detectionRate"),
                "chunksComplete": (trial.get("rawChunkAudit") or {}).get("complete"),
            })

    if index_rows:
        index_path = out_dir / "_sessions.csv"
        with index_path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(
                fh,
                fieldnames=list(index_rows[0].keys())
            )
            writer.writeheader()
            writer.writerows(index_rows)
        print(f"\nIndex   : {index_path}")

    known = {s.id for s in db.collection("sessions").select([]).stream()}
    orphans = [
        d.id for d in db.collection("sessions").list_documents()
        if d.id not in known and not d.id.startswith("_selftest")
    ]

    print(
        f"\nDownloaded {downloaded}, already had {skipped}, "
        f"ignored {selftests} setup-check record(s)."
    )
    if orphans:
        print(
            f"\nNOTE: {len(orphans)} incomplete session(s) with subcollection "
            "data but no parent session document:"
        )
        for o in orphans[:10]:
            print(f"  {o}")
        if len(orphans) > 10:
            print(f"  ... and {len(orphans) - 10} more")


if __name__ == "__main__":
    main()
