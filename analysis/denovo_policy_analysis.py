#!/usr/bin/env python3
"""Trial-level analysis for the two-hand de novo center-out task.

Primary purpose
---------------
Create a fixed, auditable table for the v19-10 two-direction de novo task.
The table separates:
1) cursor acquisition / discovery,
2) execution timing,
3) left/right hand policy,
4) hand coordination / null-dimension use.

The script always recomputes movement-policy measures from raw frames. When
`fetch_data.py` has included the detailed `reaches` array, exact runtime
outcomes are merged in as `runtime_*` columns. Older pilot files that contain
raw frames but not `reaches` still work; endpoint/hit fields are then marked as
raw-frame reconstructions rather than exact runtime records.

Usage
-----
python analysis/denovo_policy_analysis.py data/raw/SESSION.json
python analysis/denovo_policy_analysis.py data/raw/*.json --out data/processed/denovo

Outputs
-------
denovo_trials.csv
denovo_20trial_bins.csv
post_aftereffect_trials.csv
session_summary.csv
analysis_settings.json
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
from typing import Iterable

import numpy as np

TARGET_CODE_TO_NAME = {6: "upLeft", 7: "downRight"}
TARGET_ANGLE_DEG = {"upLeft": 135.0, "downRight": -45.0}
IDEAL_LEFT_HAND_DEG = {"upLeft": -90.0, "downRight": 90.0}
IDEAL_RIGHT_HAND_DEG = {"upLeft": 180.0, "downRight": 0.0}

TARGET_RADIUS = 0.70
TARGET_HIT_RADIUS = 0.10
ANGULAR_TOLERANCE_DEG = (
    2
    * math.asin(min(1.0, TARGET_HIT_RADIUS / (2 * TARGET_RADIUS)))
    * 180
    / math.pi
)
INITIAL_WINDOW_MS = 100.0
CURSOR_EFFECT_RADIUS = 0.10
DENOVO_IDS = ("denovo_discovery_1_50", "denovo_discovery_2_50")
POST_ID = "baseline_post_20_aftereffect_no_feedback"


def wrap_deg(value: float) -> float:
    return ((value + 180.0) % 360.0) - 180.0


def angle_deg(x: float, y: float) -> float:
    # Task Y is positive downward; convert to conventional math angle.
    return math.degrees(math.atan2(-y, x))


def circular_distance_deg(a: float, b: float) -> float:
    return abs(wrap_deg(a - b))


def finite_number(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


def load_sessions(paths: Iterable[Path]) -> list[dict]:
    sessions = []
    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        data["_source_path"] = str(path)
        sessions.append(data)
    return sessions


def first_numeric(frames: list[dict], key: str) -> float:
    for frame in frames:
        value = (frame.get("d") or {}).get(key)
        if finite_number(value):
            return float(value)
    return float("nan")


def interpolate_fields(
    frames: list[dict],
    time_ms: float,
    fields: list[str],
) -> list[float]:
    valid = []
    for frame in frames:
        t = frame.get("t")
        d = frame.get("d") or {}
        values = [d.get(field) for field in fields]
        if finite_number(t) and all(finite_number(v) for v in values):
            valid.append((float(t), [float(v) for v in values]))

    if not valid:
        return [float("nan")] * len(fields)

    times = np.asarray([row[0] for row in valid], dtype=float)
    values = np.asarray([row[1] for row in valid], dtype=float)

    if time_ms <= times[0]:
        return values[0].tolist()
    if time_ms >= times[-1]:
        return values[-1].tolist()

    j = int(np.searchsorted(times, time_ms))
    t0, t1 = times[j - 1], times[j]
    if t1 <= t0:
        return values[j].tolist()

    frac = (time_ms - t0) / (t1 - t0)
    return (values[j - 1] + frac * (values[j] - values[j - 1])).tolist()


def initial_vector(
    frames: list[dict],
    onset_ms: float,
    x_key: str,
    y_key: str,
    window_ms: float = INITIAL_WINDOW_MS,
) -> dict:
    if not finite_number(onset_ms):
        return _empty_vector()

    x0, y0 = interpolate_fields(frames, onset_ms, [x_key, y_key])
    x1, y1 = interpolate_fields(frames, onset_ms + window_ms, [x_key, y_key])

    if not all(finite_number(v) for v in (x0, y0, x1, y1)):
        return _empty_vector()

    dx, dy = x1 - x0, y1 - y0
    magnitude = math.hypot(dx, dy)
    direction = angle_deg(dx, dy) if magnitude > 1e-6 else float("nan")
    return {
        "dx": dx,
        "dy": dy,
        "magnitude": magnitude,
        "direction_deg": direction,
    }


def _empty_vector() -> dict:
    return {
        "dx": float("nan"),
        "dy": float("nan"),
        "magnitude": float("nan"),
        "direction_deg": float("nan"),
    }


def attempt_segments(trial: dict) -> list[dict]:
    """Split a bimanual reaching block into attempts using state transitions.

    Target-phase entry plus `completedReaches` is robust to return-home frames
    and does not require the detailed `reaches` subcollection.
    """
    frames = trial.get("frames") or []
    starts = []
    previous_phase = None

    for index, frame in enumerate(frames):
        d = frame.get("d") or {}
        phase = d.get("phaseCode")
        target_code = d.get("targetCode")
        completed = d.get("completedReaches")

        if (
            phase == 1
            and target_code in TARGET_CODE_TO_NAME
            and previous_phase != 1
            and finite_number(completed)
        ):
            starts.append((index, int(completed), int(target_code)))
        previous_phase = phase

    unique = []
    seen_completed = set()
    for start in starts:
        if start[1] not in seen_completed:
            unique.append(start)
            seen_completed.add(start[1])

    segments = []
    for n, (start_index, completed, target_code) in enumerate(unique):
        end_index = unique[n + 1][0] if n + 1 < len(unique) else len(frames)
        segments.append(
            {
                "reach_index0": completed,
                "target_code": target_code,
                "frames": frames[start_index:end_index],
            }
        )
    return segments


def completion_frame(segment: dict) -> dict | None:
    reach_index0 = segment["reach_index0"]
    for frame in segment["frames"]:
        completed = (frame.get("d") or {}).get("completedReaches")
        if finite_number(completed) and completed > reach_index0:
            return frame
    return None


def timed_out(segment: dict, end_time_ms: float) -> bool:
    values = []
    for frame in segment["frames"]:
        t = frame.get("t")
        if finite_number(t) and t <= end_time_ms:
            value = (frame.get("d") or {}).get("timedOutReaches")
            if finite_number(value):
                values.append(float(value))
    return bool(values) and max(values) > min(values)


def first_radius_crossing(
    frames: list[dict],
    start_time_ms: float,
    end_time_ms: float,
    radius: float = TARGET_RADIUS,
) -> tuple[float, float, float] | None:
    samples = []
    for frame in frames:
        t = frame.get("t")
        d = frame.get("d") or {}
        x, y = d.get("taskX"), d.get("taskY")
        if (
            finite_number(t)
            and finite_number(x)
            and finite_number(y)
            and (not finite_number(start_time_ms) or t >= start_time_ms)
            and t <= end_time_ms
        ):
            samples.append((float(t), float(x), float(y), math.hypot(x, y)))

    if not samples:
        return None

    # Runtime recovery rule: if feedback unlocks after the cursor has already
    # reached the target radius, use the first available mapped-cursor angle.
    if samples[0][3] >= radius:
        t, x, y, _ = samples[0]
        direction = angle_deg(x, y)
        a = math.radians(direction)
        return t, radius * math.cos(a), -radius * math.sin(a)

    for previous, current in zip(samples[:-1], samples[1:]):
        t0, x0, y0, r0 = previous
        t1, x1, y1, r1 = current
        if r0 < radius <= r1:
            denom = r1 - r0
            frac = (radius - r0) / denom if abs(denom) > 1e-9 else 1.0
            return (
                t0 + frac * (t1 - t0),
                x0 + frac * (x1 - x0),
                y0 + frac * (y1 - y0),
            )
    return None


def peak_cursor_state(
    frames: list[dict],
    start_time_ms: float,
    end_time_ms: float,
) -> dict:
    candidates = []
    for frame in frames:
        t = frame.get("t")
        d = frame.get("d") or {}
        x, y = d.get("taskX"), d.get("taskY")
        if (
            finite_number(t)
            and finite_number(x)
            and finite_number(y)
            and (not finite_number(start_time_ms) or t >= start_time_ms)
            and t <= end_time_ms
        ):
            candidates.append((float(t), float(x), float(y), math.hypot(x, y)))

    if not candidates:
        return {
            "time_ms": float("nan"),
            "x": float("nan"),
            "y": float("nan"),
            "radius": float("nan"),
            "direction_deg": float("nan"),
        }

    t, x, y, radius = max(candidates, key=lambda row: row[3])
    direction = angle_deg(x, y) if radius > 1e-9 else float("nan")
    return {"time_ms": t, "x": x, "y": y, "radius": radius, "direction_deg": direction}


def runtime_reach(trial: dict, index0: int) -> dict | None:
    reaches = trial.get("reaches")
    if isinstance(reaches, list) and 0 <= index0 < len(reaches):
        return reaches[index0] or {}
    return None


def analyze_denovo_block(
    session: dict,
    trial: dict,
    global_offset: int,
) -> list[dict]:
    rows = []
    segments = attempt_segments(trial)

    for segment in segments:
        index0 = segment["reach_index0"]
        frames = segment["frames"]
        target = TARGET_CODE_TO_NAME[segment["target_code"]]
        target_angle = TARGET_ANGLE_DEG[target]
        end_frame = completion_frame(segment)
        end_time = (
            float(end_frame["t"])
            if end_frame and finite_number(end_frame.get("t"))
            else float(frames[-1].get("t", float("nan")))
        )

        target_onset = float(frames[0].get("t", float("nan")))
        left_onset = first_numeric(frames, "leftHandMovementOnsetMs")
        right_onset = first_numeric(frames, "rightHandMovementOnsetMs")
        launch = first_numeric(frames, "movementWindowStartMs")
        planning = first_numeric(frames, "planningTimeMs")

        left_initial = initial_vector(frames, left_onset, "leftHandX", "leftHandY")
        right_initial = initial_vector(frames, right_onset, "rightHandX", "rightHandY")
        cursor_initial = initial_vector(frames, launch, "taskX", "taskY")

        cursor_initial_error = (
            wrap_deg(cursor_initial["direction_deg"] - target_angle)
            if finite_number(cursor_initial["direction_deg"])
            else float("nan")
        )

        left_policy_error = (
            wrap_deg(left_initial["direction_deg"] - IDEAL_LEFT_HAND_DEG[target])
            if finite_number(left_initial["direction_deg"])
            else float("nan")
        )
        right_policy_error = (
            wrap_deg(right_initial["direction_deg"] - IDEAL_RIGHT_HAND_DEG[target])
            if finite_number(right_initial["direction_deg"])
            else float("nan")
        )

        hand_separation = (
            circular_distance_deg(
                left_initial["direction_deg"],
                right_initial["direction_deg"],
            )
            if finite_number(left_initial["direction_deg"])
            and finite_number(right_initial["direction_deg"])
            else float("nan")
        )

        # Controller-relevant dimensions are Left Y and Right X.
        # Left X and Right Y are null dimensions.
        relevant_magnitude = (
            math.hypot(left_initial["dy"], right_initial["dx"])
            if finite_number(left_initial["dy"]) and finite_number(right_initial["dx"])
            else float("nan")
        )
        null_magnitude = (
            math.hypot(left_initial["dx"], right_initial["dy"])
            if finite_number(left_initial["dx"]) and finite_number(right_initial["dy"])
            else float("nan")
        )
        null_relevant_ratio = (
            null_magnitude / relevant_magnitude
            if finite_number(relevant_magnitude) and relevant_magnitude > 1e-9
            else float("nan")
        )

        timeout = timed_out(segment, end_time)
        crossing = first_radius_crossing(frames, launch, end_time)
        peak = peak_cursor_state(frames, launch, end_time)
        peak_error = (
            wrap_deg(peak["direction_deg"] - target_angle)
            if finite_number(peak["direction_deg"])
            else float("nan")
        )

        endpoint_direction = float("nan")
        endpoint_error = float("nan")
        raw_reconstructed_hit = False
        if crossing is not None:
            _, endpoint_x, endpoint_y = crossing
            endpoint_direction = angle_deg(endpoint_x, endpoint_y)
            endpoint_error = wrap_deg(endpoint_direction - target_angle)
            raw_reconstructed_hit = (
                not timeout and abs(endpoint_error) <= ANGULAR_TOLERANCE_DEG
            )

        if timeout:
            if finite_number(peak["radius"]) and peak["radius"] < CURSOR_EFFECT_RADIUS:
                raw_outcome = "no_cursor_effect"
            elif finite_number(peak_error) and abs(peak_error) <= ANGULAR_TOLERANCE_DEG:
                raw_outcome = "correct_direction_too_slow"
            else:
                raw_outcome = "wrong_cursor_direction"
        elif crossing is not None:
            raw_outcome = "hit" if raw_reconstructed_hit else "endpoint_miss"
        else:
            raw_outcome = "other_failure"

        runtime = runtime_reach(trial, index0)
        runtime_outcome = None
        if runtime is not None:
            if runtime.get("timedOut") is True:
                runtime_outcome = runtime.get("timeoutFailureType") or "timeout_unclassified"
            elif runtime.get("hit") is True or runtime.get("angularHit") == 1:
                runtime_outcome = "hit"
            else:
                runtime_outcome = "endpoint_miss"

        row = {
            "session_id": session.get("sessionId"),
            "participant_id": session.get("participantId"),
            "experiment_id": session.get("experimentId"),
            "block_id": trial.get("id"),
            "block_index": trial.get("blockIndex"),
            "trial_in_block": index0 + 1,
            "trial_global": global_offset + index0 + 1,
            "target": target,
            "target_angle_deg": target_angle,
            "target_onset_ms": target_onset,
            "left_onset_ms": left_onset,
            "right_onset_ms": right_onset,
            "launch_ms": launch,
            "planning_time_ms_raw": planning,
            "movement_window_time_ms_raw": (
                end_time - launch if finite_number(launch) and finite_number(end_time) else float("nan")
            ),
            "left_initial_direction_100ms_deg": left_initial["direction_deg"],
            "right_initial_direction_100ms_deg": right_initial["direction_deg"],
            "cursor_initial_direction_100ms_deg": cursor_initial["direction_deg"],
            "cursor_initial_error_100ms_deg": cursor_initial_error,
            "abs_cursor_initial_error_100ms_deg": (
                abs(cursor_initial_error) if finite_number(cursor_initial_error) else float("nan")
            ),
            "initial_direction_correct": (
                int(abs(cursor_initial_error) <= ANGULAR_TOLERANCE_DEG)
                if finite_number(cursor_initial_error)
                else None
            ),
            "left_policy_error_deg": left_policy_error,
            "right_policy_error_deg": right_policy_error,
            "hand_direction_separation_deg": hand_separation,
            "left_initial_dx": left_initial["dx"],
            "left_initial_dy": left_initial["dy"],
            "right_initial_dx": right_initial["dx"],
            "right_initial_dy": right_initial["dy"],
            "initial_relevant_magnitude": relevant_magnitude,
            "initial_null_magnitude": null_magnitude,
            "null_relevant_ratio": null_relevant_ratio,
            "peak_radius_raw": peak["radius"],
            "peak_cursor_direction_deg_raw": peak["direction_deg"],
            "peak_cursor_error_deg_raw": peak_error,
            "endpoint_direction_deg_raw": endpoint_direction,
            "endpoint_error_deg_raw": endpoint_error,
            "raw_outcome_reconstructed": raw_outcome,
            "raw_hit_reconstructed": int(raw_reconstructed_hit),
            "timed_out_raw": int(timeout),
            "runtime_outcome": runtime_outcome,
            "outcome_source": "runtime_reaches" if runtime is not None else "raw_reconstruction",
        }

        if runtime is not None:
            for key in (
                "hit",
                "timedOut",
                "movementWindowExpired",
                "timeoutFailureType",
                "planningTimeMs",
                "reactionTimeMs",
                "cursorReactionTimeMs",
                "movementTimeMs",
                "endpointAngularErrorDeg",
                "initialDirectionalErrorDeg",
                "initialLeftHandDirectionDeg",
                "initialRightHandDirectionDeg",
                "peakRadialDistance",
                "peakCursorDirectionalErrorDeg",
                "directionCorrectAtTimeout",
            ):
                row[f"runtime_{key}"] = runtime.get(key)

        rows.append(row)

    return rows


def analyze_post_block(session: dict, trial: dict) -> list[dict]:
    rows = []
    for segment in attempt_segments(trial):
        index0 = segment["reach_index0"]
        frames = segment["frames"]
        target = TARGET_CODE_TO_NAME[segment["target_code"]]
        target_angle = TARGET_ANGLE_DEG[target]
        end_frame = completion_frame(segment)
        end_time = (
            float(end_frame["t"])
            if end_frame and finite_number(end_frame.get("t"))
            else float(frames[-1].get("t", float("nan")))
        )

        # Baseline no-feedback has no de-novo launch gate. Use the first hand
        # onset as the start for finding the first target-radius crossing.
        left_onset = first_numeric(frames, "leftHandMovementOnsetMs")
        right_onset = first_numeric(frames, "rightHandMovementOnsetMs")
        onset_candidates = [v for v in (left_onset, right_onset) if finite_number(v)]
        start = min(onset_candidates) if onset_candidates else float(frames[0].get("t", 0))
        crossing = first_radius_crossing(frames, start, end_time)

        endpoint_direction = float("nan")
        endpoint_error = float("nan")
        if crossing is not None:
            _, x, y = crossing
            endpoint_direction = angle_deg(x, y)
            endpoint_error = wrap_deg(endpoint_direction - target_angle)

        runtime = runtime_reach(trial, index0)
        runtime_error = runtime.get("endpointAngularErrorDeg") if runtime else None

        rows.append(
            {
                "session_id": session.get("sessionId"),
                "participant_id": session.get("participantId"),
                "trial_in_post": index0 + 1,
                "target": target,
                "endpoint_direction_deg_raw": endpoint_direction,
                "endpoint_error_deg_raw": endpoint_error,
                "abs_endpoint_error_deg_raw": (
                    abs(endpoint_error) if finite_number(endpoint_error) else float("nan")
                ),
                "runtime_endpoint_error_deg": runtime_error,
                "outcome_source": "runtime_reaches" if runtime is not None else "raw_reconstruction",
            }
        )
    return rows


def mean_or_nan(values) -> float:
    values = np.asarray(
        [float(v) for v in values if finite_number(v)],
        dtype=float,
    )
    return float(np.mean(values)) if len(values) else float("nan")


def median_or_nan(values) -> float:
    values = np.asarray(
        [float(v) for v in values if finite_number(v)],
        dtype=float,
    )
    return float(np.median(values)) if len(values) else float("nan")


def summarize_bins(rows: list[dict], width: int = 20) -> list[dict]:
    out = []
    by_session: dict[str, list[dict]] = {}
    for row in rows:
        by_session.setdefault(str(row.get("session_id")), []).append(row)

    for session_id, session_rows in by_session.items():
        session_rows = sorted(session_rows, key=lambda r: r["trial_global"])
        participant_id = session_rows[0].get("participant_id") if session_rows else None
        max_trial = max((r["trial_global"] for r in session_rows), default=0)

        for start in range(1, max_trial + 1, width):
            stop = start + width - 1
            chunk = [r for r in session_rows if start <= r["trial_global"] <= stop]
            if not chunk:
                continue

            exact_outcomes = [
                r["runtime_outcome"] if r.get("runtime_outcome") else r["raw_outcome_reconstructed"]
                for r in chunk
            ]
            direction_correct = [
                r.get("initial_direction_correct")
                for r in chunk
                if r.get("initial_direction_correct") is not None
            ]

            out.append(
                {
                    "session_id": session_id,
                    "participant_id": participant_id,
                    "trial_bin": f"{start}-{stop}",
                    "bin_start": start,
                    "bin_end": stop,
                    "n_trials": len(chunk),
                    "hit_rate_best_available": exact_outcomes.count("hit") / len(chunk),
                    "exact_runtime_outcome_fraction": sum(
                        r.get("runtime_outcome") is not None for r in chunk
                    ) / len(chunk),
                    "timeout_rate_best_available": sum(
                        outcome in {
                            "no_cursor_effect",
                            "wrong_cursor_direction",
                            "correct_direction_too_slow",
                            "timeout_unclassified",
                        }
                        for outcome in exact_outcomes
                    )
                    / len(chunk),
                    "initial_direction_correct_rate": (
                        sum(direction_correct) / len(direction_correct)
                        if direction_correct else float("nan")
                    ),
                    "mean_abs_initial_cursor_error_deg": mean_or_nan(
                        [r.get("abs_cursor_initial_error_100ms_deg") for r in chunk]
                    ),
                    "median_planning_time_ms": median_or_nan(
                        [r.get("planning_time_ms_raw") for r in chunk]
                    ),
                    "median_movement_window_time_ms": median_or_nan(
                        [r.get("movement_window_time_ms_raw") for r in chunk]
                    ),
                    "median_hand_direction_separation_deg": median_or_nan(
                        [r.get("hand_direction_separation_deg") for r in chunk]
                    ),
                    "median_null_relevant_ratio": median_or_nan(
                        [r.get("null_relevant_ratio") for r in chunk]
                    ),
                }
            )
    return out


def session_summaries(
    sessions: list[dict],
    denovo_rows: list[dict],
    post_rows: list[dict],
) -> list[dict]:
    output = []
    for session in sessions:
        sid = session.get("sessionId")
        rows = [r for r in denovo_rows if r.get("session_id") == sid]
        post = [r for r in post_rows if r.get("session_id") == sid]
        outcomes = [
            r["runtime_outcome"] if r.get("runtime_outcome") else r["raw_outcome_reconstructed"]
            for r in rows
        ]
        late = [r for r in rows if r.get("trial_global", 0) >= 81]

        output.append(
            {
                "session_id": sid,
                "participant_id": session.get("participantId"),
                "experiment_id": session.get("experimentId"),
                "status": session.get("status"),
                "completed_reach_count_session": session.get("completedReachCount"),
                "n_denovo_trials_reconstructed": len(rows),
                "n_runtime_reach_records_available": sum(
                    r.get("runtime_outcome") is not None for r in rows
                ),
                "overall_hit_rate_best_available": outcomes.count("hit") / len(rows) if rows else float("nan"),
                "exact_runtime_outcome_fraction": (
                    sum(r.get("runtime_outcome") is not None for r in rows) / len(rows)
                    if rows else float("nan")
                ),
                "block1_summary_hit_rate": next(
                    (
                        t.get("successRate")
                        for t in (session.get("trials") or [])
                        if t.get("id") == "denovo_discovery_1_50"
                    ),
                    None,
                ),
                "block2_summary_hit_rate": next(
                    (
                        t.get("successRate")
                        for t in (session.get("trials") or [])
                        if t.get("id") == "denovo_discovery_2_50"
                    ),
                    None,
                ),
                "overall_initial_direction_correct_rate": mean_or_nan(
                    [r.get("initial_direction_correct") for r in rows]
                ),
                "late20_initial_direction_correct_rate": mean_or_nan(
                    [r.get("initial_direction_correct") for r in late]
                ),
                "late20_mean_abs_initial_cursor_error_deg": mean_or_nan(
                    [r.get("abs_cursor_initial_error_100ms_deg") for r in late]
                ),
                "late20_median_hand_direction_separation_deg": median_or_nan(
                    [r.get("hand_direction_separation_deg") for r in late]
                ),
                "late20_median_null_relevant_ratio": median_or_nan(
                    [r.get("null_relevant_ratio") for r in late]
                ),
                "post_n": len(post),
                "post_first1_abs_error_deg": (
                    post[0].get("abs_endpoint_error_deg_raw") if post else float("nan")
                ),
                "post_first2_mean_abs_error_deg": mean_or_nan(
                    [r.get("abs_endpoint_error_deg_raw") for r in post[:2]]
                ),
                "post_first4_mean_abs_error_deg": mean_or_nan(
                    [r.get("abs_endpoint_error_deg_raw") for r in post[:4]]
                ),
                "post_all_mean_abs_error_deg": mean_or_nan(
                    [r.get("abs_endpoint_error_deg_raw") for r in post]
                ),
            }
        )
    return output


def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return

    fields = []
    for row in rows:
        for key in row:
            if key not in fields:
                fields.append(key)

    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def resolve_inputs(items: list[str]) -> list[Path]:
    paths = []
    for item in items:
        path = Path(item)
        if path.is_dir():
            paths.extend(sorted(p for p in path.glob("*.json") if not p.name.startswith("_")))
        else:
            paths.append(path)
    return [p for p in paths if p.exists()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", help="session JSON file(s) or folders")
    parser.add_argument(
        "--out",
        default="data/processed/denovo",
        help="output folder (default: data/processed/denovo)",
    )
    args = parser.parse_args()

    paths = resolve_inputs(args.inputs)
    if not paths:
        raise SystemExit("No session JSON files found.")

    sessions = load_sessions(paths)
    denovo_rows = []
    post_rows = []

    for session in sessions:
        trials_by_id = {
            trial.get("id"): trial
            for trial in (session.get("trials") or [])
            if isinstance(trial, dict)
        }

        for block_index, trial_id in enumerate(DENOVO_IDS):
            trial = trials_by_id.get(trial_id)
            if trial:
                denovo_rows.extend(
                    analyze_denovo_block(
                        session,
                        trial,
                        global_offset=block_index * 50,
                    )
                )

        post_trial = trials_by_id.get(POST_ID)
        if post_trial:
            post_rows.extend(analyze_post_block(session, post_trial))

    binned_rows = summarize_bins(denovo_rows, width=20)
    summary_rows = session_summaries(sessions, denovo_rows, post_rows)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    write_csv(out / "denovo_trials.csv", denovo_rows)
    write_csv(out / "denovo_20trial_bins.csv", binned_rows)
    write_csv(out / "post_aftereffect_trials.csv", post_rows)
    write_csv(out / "session_summary.csv", summary_rows)

    settings = {
        "initial_window_ms": INITIAL_WINDOW_MS,
        "target_radius": TARGET_RADIUS,
        "target_hit_radius": TARGET_HIT_RADIUS,
        "angular_tolerance_deg": ANGULAR_TOLERANCE_DEG,
        "cursor_effect_radius": CURSOR_EFFECT_RADIUS,
        "target_angles_deg": TARGET_ANGLE_DEG,
        "ideal_left_hand_directions_deg": IDEAL_LEFT_HAND_DEG,
        "ideal_right_hand_directions_deg": IDEAL_RIGHT_HAND_DEG,
        "notes": {
            "initial_direction": (
                "Offline displacement direction from each hand's own detected onset "
                "to onset + 100 ms; cursor direction uses confirmed de-novo launch "
                "to launch + 100 ms."
            ),
            "null_relevant_ratio": (
                "sqrt(LeftX^2 + RightY^2) / sqrt(LeftY^2 + RightX^2) "
                "over the initial 100-ms hand displacement vectors."
            ),
            "runtime_preference": (
                "Exact runtime outcomes are used when detailed reaches are present. "
                "Older files without reaches retain raw-frame reconstructed outcomes."
            ),
        },
    }
    (out / "analysis_settings.json").write_text(
        json.dumps(settings, indent=2),
        encoding="utf-8",
    )

    print(
        f"{len(sessions)} session(s); "
        f"{len(denovo_rows)} de-novo attempts; "
        f"{len(post_rows)} post-baseline attempts."
    )
    exact = sum(r.get("runtime_outcome") is not None for r in denovo_rows)
    if denovo_rows and exact < len(denovo_rows):
        print(
            "NOTE: detailed runtime reach records are missing for "
            f"{len(denovo_rows) - exact}/{len(denovo_rows)} de-novo attempts. "
            "Policy metrics are exact from raw frames, but per-attempt outcome/hit "
            "labels for those attempts are raw-frame reconstructions. Re-fetch with "
            "the current analysis/fetch_data.py for exact runtime outcomes."
        )
    for name in (
        "denovo_trials.csv",
        "denovo_20trial_bins.csv",
        "post_aftereffect_trials.csv",
        "session_summary.csv",
        "analysis_settings.json",
    ):
        print(f"  {out / name}")


if __name__ == "__main__":
    main()