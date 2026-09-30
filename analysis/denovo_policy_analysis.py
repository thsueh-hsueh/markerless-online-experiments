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
from scipy.signal import butter, filtfilt, find_peaks

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

# Frozen offline onset algorithm carried over from the N=30 single-hand baseline.
ONSET_FILTER_HZ = 4.0
ONSET_FILTER_ORDER = 2
ONSET_NOISE_WINDOW_MS = 300.0
ONSET_NOISE_PERCENTILE = 95.0
ONSET_SUBSTANTIAL_PEAK_FRACTION = 0.30
ONSET_THRESHOLD_PEAK_FRACTION = 0.10
LEGACY_DENOVO_IDS = ("denovo_discovery_1_50", "denovo_discovery_2_50")
BLOCKED_DENOVO_IDS = (
    "denovo_blocked_1_50",
    "denovo_blocked_2_50",
    "denovo_blocked_3_50",
    "denovo_blocked_4_50",
)
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


def offline_velocity_onset(
    frames: list[dict],
    target_onset_ms: float,
    analysis_end_ms: float,
    x_key: str,
    y_key: str,
) -> dict:
    """Estimate movement onset with the frozen webcam-reaching algorithm.

    Procedure: regularize to the median frame interval; zero-phase 2nd-order
    Butterworth low-pass at 4 Hz; compute 2-D tangential speed; estimate a
    pre-target resting-noise floor from the 95th percentile of the preceding
    300 ms; select the first local peak >=30% of the global outbound peak and
    above noise (global peak fallback); set the onset threshold to
    max(10% of that selected peak, noise); then search backward for the last
    below-to-above threshold crossing and linearly interpolate its time.
    """
    empty = {
        "onset_ms": float("nan"),
        "noise_floor": float("nan"),
        "selected_peak_speed": float("nan"),
        "selected_peak_ms": float("nan"),
        "threshold": float("nan"),
        "median_dt_ms": float("nan"),
        "sample_rate_hz": float("nan"),
        "max_raw_gap_ms": float("nan"),
        "status": "unavailable",
    }
    if not (finite_number(target_onset_ms) and finite_number(analysis_end_ms)):
        return empty
    start_ms = target_onset_ms - ONSET_NOISE_WINDOW_MS
    rows = []
    for frame in frames:
        t = frame.get("t")
        d = frame.get("d") or {}
        x, y = d.get(x_key), d.get(y_key)
        if (
            finite_number(t) and finite_number(x) and finite_number(y)
            and start_ms <= float(t) <= analysis_end_ms
        ):
            rows.append((float(t), float(x), float(y)))
    if len(rows) < 9:
        return {**empty, "status": "too_few_samples"}

    rows.sort(key=lambda z: z[0])
    dedup = {}
    for t, x, y in rows:
        dedup[t] = (x, y)
    times = np.asarray(sorted(dedup), dtype=float)
    xy = np.asarray([dedup[t] for t in times], dtype=float)
    dts = np.diff(times)
    positive_dts = dts[dts > 0]
    if len(positive_dts) < 4:
        return {**empty, "status": "invalid_timebase"}
    median_dt = float(np.median(positive_dts))
    max_gap = float(np.max(positive_dts))
    fs = 1000.0 / median_dt
    if not math.isfinite(fs) or fs <= 2.2 * ONSET_FILTER_HZ:
        return {
            **empty,
            "median_dt_ms": median_dt,
            "sample_rate_hz": fs,
            "max_raw_gap_ms": max_gap,
            "status": "sample_rate_too_low",
        }

    grid = np.arange(times[0], times[-1] + 0.5 * median_dt, median_dt)
    if len(grid) < 12:
        return {**empty, "status": "too_few_regularized_samples"}
    x = np.interp(grid, times, xy[:, 0])
    y = np.interp(grid, times, xy[:, 1])

    b, a = butter(ONSET_FILTER_ORDER, ONSET_FILTER_HZ, btype="low", fs=fs)
    try:
        xf = filtfilt(b, a, x)
        yf = filtfilt(b, a, y)
    except ValueError:
        return {**empty, "status": "filter_failed"}

    t_sec = grid / 1000.0
    vx = np.gradient(xf, t_sec)
    vy = np.gradient(yf, t_sec)
    speed = np.hypot(vx, vy)

    pre = (grid >= target_onset_ms - ONSET_NOISE_WINDOW_MS) & (grid < target_onset_ms)
    post = (grid >= target_onset_ms) & (grid <= analysis_end_ms)
    post_idx = np.flatnonzero(post)
    if len(post_idx) < 4:
        return {**empty, "status": "too_few_outbound_samples"}
    if pre.sum() >= 3:
        noise = float(np.percentile(speed[pre], ONSET_NOISE_PERCENTILE))
    else:
        noise = 0.0

    post_speed = speed[post_idx]
    local_rel, _ = find_peaks(post_speed)
    global_rel = int(np.argmax(post_speed))
    global_speed = float(post_speed[global_rel])
    if not math.isfinite(global_speed) or global_speed <= noise:
        return {
            **empty,
            "noise_floor": noise,
            "median_dt_ms": median_dt,
            "sample_rate_hz": fs,
            "max_raw_gap_ms": max_gap,
            "status": "no_peak_above_noise",
        }

    eligible_rel = [
        int(i) for i in local_rel
        if post_speed[i] >= ONSET_SUBSTANTIAL_PEAK_FRACTION * global_speed
        and post_speed[i] > noise
    ]
    selected_rel = eligible_rel[0] if eligible_rel else global_rel
    selected_idx = int(post_idx[selected_rel])
    selected_speed = float(speed[selected_idx])
    threshold = max(ONSET_THRESHOLD_PEAK_FRACTION * selected_speed, noise)

    first_post_idx = int(post_idx[0])
    crossings = []
    for i in range(first_post_idx + 1, selected_idx + 1):
        if speed[i - 1] < threshold <= speed[i]:
            crossings.append(i)
    if crossings:
        i = crossings[-1]
        s0, s1 = float(speed[i - 1]), float(speed[i])
        t0, t1 = float(grid[i - 1]), float(grid[i])
        frac = (threshold - s0) / (s1 - s0) if abs(s1 - s0) > 1e-12 else 1.0
        onset_ms = t0 + frac * (t1 - t0)
        status = "ok"
    elif speed[first_post_idx] >= threshold:
        onset_ms = float(target_onset_ms)
        status = "already_above_threshold_at_target"
    else:
        onset_ms = float("nan")
        status = "no_threshold_crossing"

    return {
        "onset_ms": onset_ms,
        "noise_floor": noise,
        "selected_peak_speed": selected_speed,
        "selected_peak_ms": float(grid[selected_idx]),
        "threshold": threshold,
        "median_dt_ms": median_dt,
        "sample_rate_hz": fs,
        "max_raw_gap_ms": max_gap,
        "status": status,
    }


def task_relevant_initial_vector(
    frames: list[dict],
    onset_ms: float,
    window_ms: float = INITIAL_WINDOW_MS,
) -> dict:
    # Mapped task-relevant coordinates are cursor taskX/taskY:
    # taskX = -LeftY and taskY = RightX.
    return initial_vector(frames, onset_ms, "taskX", "taskY", window_ms)


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
        online_left_onset = first_numeric(frames, "leftHandMovementOnsetMs")
        online_right_onset = first_numeric(frames, "rightHandMovementOnsetMs")
        launch = first_numeric(frames, "movementWindowStartMs")
        planning_runtime = first_numeric(frames, "planningTimeMs")

        # Scientific timing is recomputed offline from raw trajectories, using
        # the same frozen velocity-onset procedure as the single-hand N=30
        # baseline. Online displacement/launch gates remain runtime controls.
        all_trial_frames = trial.get("frames") or frames
        left_onset_info = offline_velocity_onset(
            all_trial_frames, target_onset, end_time, "leftHandX", "leftHandY"
        )
        right_onset_info = offline_velocity_onset(
            all_trial_frames, target_onset, end_time, "rightHandX", "rightHandY"
        )
        task_onset_info = offline_velocity_onset(
            all_trial_frames, target_onset, end_time, "taskX", "taskY"
        )
        left_onset = left_onset_info["onset_ms"]
        right_onset = right_onset_info["onset_ms"]
        task_onset = task_onset_info["onset_ms"]
        physical_onsets = [v for v in (left_onset, right_onset) if finite_number(v)]
        motor_onset = min(physical_onsets) if physical_onsets else float("nan")
        inter_hand_lag = (
            abs(left_onset - right_onset)
            if finite_number(left_onset) and finite_number(right_onset)
            else float("nan")
        )

        left_initial = initial_vector(all_trial_frames, left_onset, "leftHandX", "leftHandY")
        right_initial = initial_vector(all_trial_frames, right_onset, "rightHandX", "rightHandY")
        cursor_initial = task_relevant_initial_vector(all_trial_frames, task_onset)

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
        total_policy_magnitude = (
            null_magnitude + relevant_magnitude
            if finite_number(null_magnitude) and finite_number(relevant_magnitude)
            else float("nan")
        )
        null_fraction = (
            null_magnitude / total_policy_magnitude
            if finite_number(total_policy_magnitude) and total_policy_magnitude > 1e-9
            else float("nan")
        )

        timeout = timed_out(segment, end_time)
        # Scientific endpoint/MT uses the full physical movement rather than
        # the later online launch-confirmation time.
        crossing = first_radius_crossing(frames, target_onset, end_time)
        peak = peak_cursor_state(frames, launch, end_time)
        peak_error = (
            wrap_deg(peak["direction_deg"] - target_angle)
            if finite_number(peak["direction_deg"])
            else float("nan")
        )

        endpoint_direction = float("nan")
        endpoint_error = float("nan")
        raw_reconstructed_hit = False
        endpoint_time_ms = float("nan")
        if crossing is not None:
            endpoint_time_ms, endpoint_x, endpoint_y = crossing
            endpoint_direction = angle_deg(endpoint_x, endpoint_y)
            endpoint_error = wrap_deg(endpoint_direction - target_angle)
            raw_reconstructed_hit = (
                not timeout and abs(endpoint_error) <= ANGULAR_TOLERANCE_DEG
            )

        motor_rt_ms = (
            motor_onset - target_onset
            if finite_number(motor_onset) and finite_number(target_onset)
            else float("nan")
        )
        task_relevant_rt_ms = (
            task_onset - target_onset
            if finite_number(task_onset) and finite_number(target_onset)
            else float("nan")
        )
        task_mt_ms = (
            endpoint_time_ms - task_onset
            if finite_number(endpoint_time_ms) and finite_number(task_onset) and not timeout
            else float("nan")
        )
        motor_mt_ms = (
            endpoint_time_ms - motor_onset
            if finite_number(endpoint_time_ms) and finite_number(motor_onset) and not timeout
            else float("nan")
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
            "left_onset_offline_ms": left_onset,
            "right_onset_offline_ms": right_onset,
            "motor_onset_offline_ms": motor_onset,
            "task_relevant_onset_offline_ms": task_onset,
            "online_left_onset_ms": online_left_onset,
            "online_right_onset_ms": online_right_onset,
            "launch_ms": launch,
            "planning_time_ms_runtime": planning_runtime,
            "motor_rt_ms": motor_rt_ms,
            "task_relevant_rt_ms": task_relevant_rt_ms,
            "inter_hand_onset_lag_ms": inter_hand_lag,
            "task_mt_ms": task_mt_ms,
            "motor_mt_ms": motor_mt_ms,
            "movement_window_time_ms_runtime": (
                end_time - launch if finite_number(launch) and finite_number(end_time) else float("nan")
            ),
            "left_onset_status": left_onset_info["status"],
            "right_onset_status": right_onset_info["status"],
            "task_relevant_onset_status": task_onset_info["status"],
            "left_onset_noise_floor": left_onset_info["noise_floor"],
            "right_onset_noise_floor": right_onset_info["noise_floor"],
            "task_relevant_onset_noise_floor": task_onset_info["noise_floor"],
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
            "null_fraction": null_fraction,
            # Deprecated aliases retained so older plotting notebooks do not break.
            "planning_time_ms_raw": planning_runtime,
            "movement_window_time_ms_raw": (
                end_time - launch if finite_number(launch) and finite_number(end_time) else float("nan")
            ),
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
                    "median_runtime_planning_time_ms": median_or_nan(
                        [r.get("planning_time_ms_runtime") for r in chunk]
                    ),
                    "median_motor_rt_ms": median_or_nan(
                        [r.get("motor_rt_ms") for r in chunk]
                    ),
                    "median_task_relevant_rt_ms": median_or_nan(
                        [r.get("task_relevant_rt_ms") for r in chunk]
                    ),
                    "median_inter_hand_onset_lag_ms": median_or_nan(
                        [r.get("inter_hand_onset_lag_ms") for r in chunk]
                    ),
                    "median_task_mt_ms_completed": median_or_nan(
                        [r.get("task_mt_ms") for r in chunk]
                    ),
                    "n_task_mt_completed": sum(
                        finite_number(r.get("task_mt_ms")) for r in chunk
                    ),
                    "median_runtime_movement_window_time_ms": median_or_nan(
                        [r.get("movement_window_time_ms_runtime") for r in chunk]
                    ),
                    "median_hand_direction_separation_deg": median_or_nan(
                        [r.get("hand_direction_separation_deg") for r in chunk]
                    ),
                    "median_null_relevant_ratio": median_or_nan(
                        [r.get("null_relevant_ratio") for r in chunk]
                    ),
                    "median_null_fraction": median_or_nan(
                        [r.get("null_fraction") for r in chunk]
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
                "late20_median_null_fraction": median_or_nan(
                    [r.get("null_fraction") for r in late]
                ),
                "overall_median_motor_rt_ms": median_or_nan(
                    [r.get("motor_rt_ms") for r in rows]
                ),
                "overall_median_task_relevant_rt_ms": median_or_nan(
                    [r.get("task_relevant_rt_ms") for r in rows]
                ),
                "overall_median_inter_hand_onset_lag_ms": median_or_nan(
                    [r.get("inter_hand_onset_lag_ms") for r in rows]
                ),
                "overall_median_task_mt_ms_completed": median_or_nan(
                    [r.get("task_mt_ms") for r in rows]
                ),
                "n_task_mt_completed": sum(
                    finite_number(r.get("task_mt_ms")) for r in rows
                ),
                "task_relevant_onset_success_rate": (
                    sum(finite_number(r.get("task_relevant_onset_offline_ms")) for r in rows) / len(rows)
                    if rows else float("nan")
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

        if any(trial_id in trials_by_id for trial_id in BLOCKED_DENOVO_IDS):
            denovo_ids = BLOCKED_DENOVO_IDS
        else:
            denovo_ids = LEGACY_DENOVO_IDS

        for block_index, trial_id in enumerate(denovo_ids):
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
        "analysis_version": "denovo-policy-v2-offline-onset",
        "initial_window_ms": INITIAL_WINDOW_MS,
        "onset_algorithm": {
            "filter": "zero-phase 2nd-order Butterworth",
            "lowpass_hz": ONSET_FILTER_HZ,
            "noise_window_ms": ONSET_NOISE_WINDOW_MS,
            "noise_percentile": ONSET_NOISE_PERCENTILE,
            "substantial_peak_fraction_of_global": ONSET_SUBSTANTIAL_PEAK_FRACTION,
            "threshold_fraction_of_selected_peak": ONSET_THRESHOLD_PEAK_FRACTION,
        },
        "target_radius": TARGET_RADIUS,
        "target_hit_radius": TARGET_HIT_RADIUS,
        "angular_tolerance_deg": ANGULAR_TOLERANCE_DEG,
        "cursor_effect_radius": CURSOR_EFFECT_RADIUS,
        "target_angles_deg": TARGET_ANGLE_DEG,
        "ideal_left_hand_directions_deg": IDEAL_LEFT_HAND_DEG,
        "ideal_right_hand_directions_deg": IDEAL_RIGHT_HAND_DEG,
        "notes": {
            "initial_direction": (
                "Offline displacement direction from each signal's own frozen velocity-defined "
                "onset to onset + 100 ms. Left/right use each hand's 2-D trajectory; "
                "task/cursor direction uses the task-relevant mapped trajectory [-LeftY, RightX]."
            ),
            "timing": (
                "Online displacement and launch thresholds are retained only for experiment control. "
                "Scientific RT/MT are recomputed offline with the frozen 4-Hz velocity-onset algorithm. "
                "Task MT is defined only for non-timeout attempts with an r=.70 crossing."
            ),
            "null_relevant_ratio": (
                "sqrt(LeftX^2 + RightY^2) / sqrt(LeftY^2 + RightX^2) "
                "over the initial 100-ms hand displacement vectors. Descriptive only."
            ),
            "null_fraction": (
                "Null / (Null + Relevant), bounded from 0 to 1; preferred for group modeling."
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