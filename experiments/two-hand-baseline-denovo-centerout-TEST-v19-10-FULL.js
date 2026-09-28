import { HAND } from "../js/core/tracker.js";

if (typeof window !== "undefined") {
  window.__bimanualV19_9Loaded = true;
  console.info("[Bimanual v19-10 FULL] experiment module loaded");
}


/* ============================================================
 * SINGLE-HAND INTUITIVE BASELINE — V5.18.4 ANGULAR SLICE + STATIC + DYNAMIC PREFLIGHT
 *
 * Purpose
 * -------
 * Measure each hand's baseline center-out reaching bias before
 * the bimanual/de-novo tasks.
 *
 * Experimental structure
 * ----------------------
 * 1) Continuous LEFT-hand calibration
 * 2) Continuous RIGHT-hand calibration
 * 3) NO-FEEDBACK: Right 40 -> Left 40 -> Right 40 -> Left 40 = 160 reaches
 * 4) FEEDBACK:    Right 40 -> Left 40 -> Right 40 -> Left 40 = 160 reaches
 *
 * Total = 320 reaches.
 * Each reaching block contains 5 randomized 8-direction cycles.
 *
 * V5.18 angular-slice design
 * --------------------------
 * - Participants make a rapid slicing movement THROUGH each gem.
 * - NO-FEEDBACK: the hand-position dot is hidden during outbound movement.
 * - FEEDBACK: the live hand-position dot remains visible during outbound movement.
 * - Angular endpoint is registered when reach amplitude first reaches the
 *   target radius (0.70 task units); the crossing is linearly interpolated
 *   between webcam samples.
 * - Feedback is ANGULAR ONLY: the frozen dot is projected to the fixed target
 *   radius, preserving endpoint angle while removing radial-error feedback.
 * - The frozen angular feedback remains for 500 ms.
 * - Behavioral undershoots are retained in the raw trajectory and summarized
 *   with peak excursion; they are not converted into target-radius endpoints.
 * - Neutral gem pop/sparkle is shown in both feedback conditions; praise words
 *   are not displayed.
 * - The treasure chest remains visible during outbound movement and disappears
 *   briefly at collection before reappearing as the return-home goal.
 * - Full frame-by-frame trajectories remain stored for offline kinematic
 *   definitions (velocity onset, early heading, RT/MT, path measures, etc.).
 * - V5.17 isotropic display geometry, wrong-hand guarding, and hybrid
 *   radial + near-home XY return guidance are preserved.
 *
 * IMPORTANT RUNNER REQUIREMENT
 * ----------------------------
 * The experiment sets state.finished = true when a calibration sequence or
 * reaching block is complete. js/core/experiment.js must allow recordTrial()
 * to stop when state.finished.
 * ============================================================
 */


/* ============================================================
 * EXPERIMENT-WIDE PARAMETERS
 * ============================================================
 */

const TARGET_ECCENTRICITY = 0.70;
const DISPLAY_GAIN = 0.30;

const HOME_RADIUS = 0.10;
const HOME_HOLD_MS = 300;

const MOVEMENT_ONSET_RADIUS = HOME_RADIUS;
const MOVEMENT_ONSET_FRAMES = 1;

/* Separate limits so a missed outbound reach cannot be accepted several seconds later. */
const MAX_WAIT_FOR_MOVEMENT_MS = 3000;
const MAX_OUTBOUND_MS = 2000;
const ABORT_MIN_EXCURSION = 0.22;

/* Initial-endpoint detection.
   Prefer the classic target-radius crossing (0.70). If the reach undershoots
   slightly, accept the farthest outbound point once the hand clearly settles
   or reverses, provided it reached at least 0.60 task units. This prevents a
   reach that stops at e.g. 0.68-0.69 from being mislabeled as a timeout. */
const MIN_VALID_ENDPOINT_RADIUS = 0.60;
const PEAK_SETTLE_MS = 180;
const PEAK_UPDATE_EPSILON = 0.003;
const PEAK_REVERSAL_DROP = 0.025;

/* V5.18 angular-slice feedback:
   - During FEEDBACK reaches the live hand-position dot is visible throughout outbound movement.
   - Once an endpoint angle is registered, the frozen feedback dot is projected to the
     fixed target radius. This preserves angular error while removing radial-error feedback.
   - The raw sampled endpoint and full trajectory remain stored for offline analysis. */
const TARGET_HIT_RADIUS = 0.10;
const FEEDBACK_FREEZE_MS = 500;
const ANGULAR_HIT_TOLERANCE_DEG =
  2 * Math.asin(Math.min(1, TARGET_HIT_RADIUS / (2 * TARGET_ECCENTRICITY))) * 180 / Math.PI;

function projectedPointAtTargetRadius(angleDegrees) {
  const a = angleDegrees * Math.PI / 180;
  return {
    x: TARGET_ECCENTRICITY * Math.cos(a),
    y: -TARGET_ECCENTRICITY * Math.sin(a),
  };
}

function angularHitFromError(errorDegrees) {
  return Number.isFinite(errorDegrees) && Math.abs(errorDegrees) <= ANGULAR_HIT_TOLERANCE_DEG;
}

/* V5.1 speed instruction/QC. Warning only; task logic is unchanged. */
const TOO_SLOW_MT_MS = 700;
const TOO_SLOW_WARNING_MS = 1500;

const RETURN_GUIDE_DELAY_MS = 250;
/* Preserve endpoint blindness while making final home placement practical. */
const RETURN_SHOW_CURSOR_RADIUS = 0.20;
const WRONG_HAND_WARNING_MS = 700;
const WRONG_HAND_MOTION_THRESHOLD = 0.0045;
const WRONG_HAND_MOTION_RATIO = 2.4;
const WRONG_HAND_MOTION_MIN_EXPECTED = 0.0018;
const WRONG_HAND_MOTION_EMA_ALPHA = 0.28;

const REACHES_PER_BLOCK = 40;
const TOTAL_REACHING_BLOCKS = 8;

function gemVisualRadiusPx(W, H) {
  /* V5.17 FINAL: the visible gem radius exactly represents the logical
     TARGET_HIT_RADIUS under the same isotropic display scale used for
     targets and cursor positions. Thus every direction has the same
     visual/acceptance geometry, and the ratio is preserved across screens. */
  const scale = Math.min(W, H);
  return TARGET_HIT_RADIUS * DISPLAY_GAIN * scale;
}
const FIXED_INTER_BLOCK_REST_SEC = 15;
const MIDPOINT_BREAK_SEC = 45;
const CALIBRATION_INTRO_MS = 5200;
const TRACKING_LOSS_THRESHOLD_MS = 500;
const TRACKING_RECOVERY_STABLE_MS = 300;
const CALIBRATION_INTER_HAND_REST_SEC = 0;
const CYCLES_PER_BLOCK = 5;

/* V5.18.4 practice / dynamic preflight.
   Static calibration still defines the normalized movement space.
   Practice then checks the same fast slice-through movement used in the task. */
const PRACTICE_CYCLES = 1;
const PRACTICE_REACHES_PER_HAND = 8;
const PRACTICE_BLOCK_MAX_SEC = 120;

/* Provisional pilot thresholds: stored in each practice summary so they can be
   re-tuned after the next pilot. Accuracy itself is NOT used as a gate. */
const DYNAMIC_PREFLIGHT_MIN_MEDIAN_FPS = 18;
const DYNAMIC_PREFLIGHT_MIN_EXPECTED_HAND_DETECTION = 0.85;
const DYNAMIC_PREFLIGHT_MAX_EXPECTED_HAND_GAP_MS = 1500;

/* Hard safety timeout only; blocks normally end at 40 reaches. */
const CALIBRATION_MAX_SEC = 120;
const REACH_BLOCK_MAX_SEC = 300;

/* V5.18.3 preflight qualification. These are intentionally provisional
   pilot thresholds and are saved with every calibration summary so they can
   be re-evaluated after the next pilot. */
const PREFLIGHT_MIN_MEDIAN_FPS = 15;
const PREFLIGHT_MIN_EXPECTED_HAND_DETECTION = 0.85;
const PREFLIGHT_MIN_CALIBRATION_AXIS_RANGE = 0.05;
const PREFLIGHT_MAX_ATTEMPTS_PER_HAND = 2;

/* Production safety: forced preflight failure is disabled in the 320-trial
   experiment. Query parameters such as `forcePreflightFail=1` are ignored. */
const PREFLIGHT_QA_FORCE_FAIL = false;


/* ============================================================
 * CALIBRATION
 * ============================================================
 */

const calibration = {
  left: {
    homeX: null,
    homeY: null,
    leftX: null,
    rightX: null,
    upY: null,
    downY: null,
  },

  right: {
    homeX: null,
    homeY: null,
    leftX: null,
    rightX: null,
    upY: null,
    downY: null,
  },
};


/*
 * Keep the same single-hand workspaces used in the latest
 * bimanual pilot so the baseline and later tasks share geometry.
 */
const CALIBRATION_TARGETS = {
  Left: {
    home:  { x: 0.30, y: 0.55 },
    left:  { x: 0.14, y: 0.55 },
    right: { x: 0.46, y: 0.55 },
    up:    { x: 0.30, y: 0.32 },
    down:  { x: 0.30, y: 0.78 },
  },

  Right: {
    home:  { x: 0.70, y: 0.55 },
    left:  { x: 0.54, y: 0.55 },
    right: { x: 0.86, y: 0.55 },
    up:    { x: 0.70, y: 0.32 },
    down:  { x: 0.70, y: 0.78 },
  },
};

const CALIBRATION_TARGET_RADIUS = 0.075;
const CALIBRATION_HOLD_MS = 850;
const CALIBRATION_SAMPLE_DELAY_MS = 250;

/*
 * Continuous sequence: each direction starts from HOME.
 * No Next button is required between these internal steps.
 */
const CALIBRATION_SEQUENCE = [
  "home",
  "left",
  "home",
  "right",
  "home",
  "up",
  "home",
  "down",
  "home",
];


/* ============================================================
 * BASIC HELPERS
 * ============================================================
 */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


function median(values) {
  if (!values || values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return sorted[mid];
}

function percentile(values, p) {
  const clean = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  if (clean.length === 1) return clean[0];
  const pos = clamp(p, 0, 1) * (clean.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return clean[lo];
  const w = pos - lo;
  return clean[lo] * (1 - w) + clean[hi] * w;
}

function calibrationQualityMetrics(frames, hand, calibrationComplete, calibrationValid, calibrationValues) {
  /* Exclude the fixed intro window: participants are reading instructions then,
     so hand visibility during that period should not determine eligibility. */
  const activeFrames = (frames || []).filter((f) => f?.d?.calibrationIntro !== 1);
  const frameTimes = activeFrames.map((f) => Number(f?.t)).filter(Number.isFinite);
  const fpsSamples = [];
  for (let i = 1; i < frameTimes.length; i++) {
    const dt = frameTimes[i] - frameTimes[i - 1];
    if (dt > 0 && dt < 1000) fpsSamples.push(1000 / dt);
  }

  const expectedLabel = String(hand);
  /* Gate detection on the directional calibration steps rather than the HOME
     steps. This focuses the metric on actual hand movement and avoids penalizing
     brief re-positioning around HOME. */
  const directionalFrames = activeFrames.filter((f) => {
    const pos = f?.d?.calibrationPosition;
    return pos != null && pos !== "home";
  });
  const expectedDetected = directionalFrames.filter((f) => {
    const labels = Array.isArray(f?.h) ? f.h : [];
    return labels.includes(expectedLabel);
  }).length;
  let longestGapMs = 0;
  let gapStartMs = null;

  for (const f of activeFrames) {
    const labels = Array.isArray(f?.h) ? f.h : [];
    const detected = labels.includes(expectedLabel);
    const t = Number(f?.t);
    if (detected) {
      if (gapStartMs != null && Number.isFinite(t)) {
        longestGapMs = Math.max(longestGapMs, t - gapStartMs);
      }
      gapStartMs = null;
    } else if (gapStartMs == null && Number.isFinite(t)) {
      gapStartMs = t;
    }
  }
  if (gapStartMs != null && frameTimes.length) {
    longestGapMs = Math.max(longestGapMs, frameTimes[frameTimes.length - 1] - gapStartMs);
  }

  const medianProcessedFPS = median(fpsSamples);
  const p10ProcessedFPS = percentile(fpsSamples, 0.10);
  const expectedHandDetectionRate = directionalFrames.length
    ? expectedDetected / directionalFrames.length
    : 0;

  const reasons = [];
  if (!calibrationComplete || !calibrationValid) reasons.push("calibration_incomplete");

  const axisRanges = (calibrationValid && calibrationValues) ? [
    Math.abs(calibrationValues.leftX - calibrationValues.homeX),
    Math.abs(calibrationValues.rightX - calibrationValues.homeX),
    Math.abs(calibrationValues.upY - calibrationValues.homeY),
    Math.abs(calibrationValues.downY - calibrationValues.homeY),
  ] : [];
  const geometryValid = axisRanges.length === 4 && axisRanges.every(
    (v) => Number.isFinite(v) && v >= PREFLIGHT_MIN_CALIBRATION_AXIS_RANGE
  );
  if (calibrationValid && !geometryValid) reasons.push("calibration_geometry");

  if (!(Number.isFinite(medianProcessedFPS) && medianProcessedFPS >= PREFLIGHT_MIN_MEDIAN_FPS)) {
    reasons.push("low_fps");
  }
  if (expectedHandDetectionRate < PREFLIGHT_MIN_EXPECTED_HAND_DETECTION) {
    reasons.push(hand === "Left" ? "left_tracking" : "right_tracking");
  }
  if (PREFLIGHT_QA_FORCE_FAIL) {
    reasons.push("qa_forced_preflight_failure");
  }

  return {
    pass: reasons.length === 0,
    reasons,
    medianProcessedFPS,
    p10ProcessedFPS,
    expectedHandDetectionRate,
    expectedHandDirectionalDetectionRate: expectedHandDetectionRate,
    longestExpectedHandGapMs: longestGapMs,
    calibrationAxisRanges: axisRanges,
    calibrationGeometryValid: geometryValid,
    evaluatedFrameCount: activeFrames.length,
    directionalFrameCount: directionalFrames.length,
    qaForcedPreflightFailure: PREFLIGHT_QA_FORCE_FAIL,
    thresholds: {
      minMedianProcessedFPS: PREFLIGHT_MIN_MEDIAN_FPS,
      minExpectedHandDetectionRate: PREFLIGHT_MIN_EXPECTED_HAND_DETECTION,
      minCalibrationAxisRange: PREFLIGHT_MIN_CALIBRATION_AXIS_RANGE,
      maxAttemptsPerHand: PREFLIGHT_MAX_ATTEMPTS_PER_HAND,
    },
  };
}


function dynamicPracticeQualityMetrics(frames, hand) {
  const allFrames = (frames || []).filter((f) => Number.isFinite(Number(f?.t)));

  /* Start once the first practice target appears, so trial-onset setup frames
     do not determine eligibility. */
  const firstTaskIndex = allFrames.findIndex((f) => {
    const phase = Number(f?.d?.phaseCode);
    return phase === 1 || phase === 2 || phase === 4 || phase === 6;
  });
  const activeFrames = firstTaskIndex >= 0 ? allFrames.slice(firstTaskIndex) : allFrames;

  const frameTimes = activeFrames.map((f) => Number(f.t));
  const fpsSamples = [];
  for (let i = 1; i < frameTimes.length; i++) {
    const dt = frameTimes[i] - frameTimes[i - 1];
    if (dt > 0 && dt < 1000) fpsSamples.push(1000 / dt);
  }

  const expectedLabel = String(hand);
  const expectedDetected = activeFrames.filter((f) => {
    const labels = Array.isArray(f?.h) ? f.h : [];
    return labels.includes(expectedLabel);
  }).length;

  let longestGapMs = 0;
  let gapStartMs = null;
  for (const f of activeFrames) {
    const labels = Array.isArray(f?.h) ? f.h : [];
    const detected = labels.includes(expectedLabel);
    const t = Number(f.t);
    if (detected) {
      if (gapStartMs != null) longestGapMs = Math.max(longestGapMs, t - gapStartMs);
      gapStartMs = null;
    } else if (gapStartMs == null) {
      gapStartMs = t;
    }
  }
  if (gapStartMs != null && frameTimes.length) {
    longestGapMs = Math.max(longestGapMs, frameTimes[frameTimes.length - 1] - gapStartMs);
  }

  const medianProcessedFPS = median(fpsSamples);
  const p10ProcessedFPS = percentile(fpsSamples, 0.10);
  const expectedHandDetectionRate = activeFrames.length
    ? expectedDetected / activeFrames.length
    : 0;

  const reasons = [];
  if (!(Number.isFinite(medianProcessedFPS) &&
        medianProcessedFPS >= DYNAMIC_PREFLIGHT_MIN_MEDIAN_FPS)) {
    reasons.push("low_dynamic_fps");
  }
  if (expectedHandDetectionRate < DYNAMIC_PREFLIGHT_MIN_EXPECTED_HAND_DETECTION) {
    reasons.push(hand === "Left" ? "left_dynamic_tracking" : "right_dynamic_tracking");
  }
  if (longestGapMs > DYNAMIC_PREFLIGHT_MAX_EXPECTED_HAND_GAP_MS) {
    reasons.push("dynamic_tracking_gap");
  }

  return {
    pass: reasons.length === 0,
    reasons,
    medianProcessedFPS,
    p10ProcessedFPS,
    expectedHandDetectionRate,
    longestExpectedHandGapMs: longestGapMs,
    evaluatedFrameCount: activeFrames.length,
    thresholds: {
      minMedianProcessedFPS: DYNAMIC_PREFLIGHT_MIN_MEDIAN_FPS,
      minExpectedHandDetectionRate: DYNAMIC_PREFLIGHT_MIN_EXPECTED_HAND_DETECTION,
      maxExpectedHandGapMs: DYNAMIC_PREFLIGHT_MAX_EXPECTED_HAND_GAP_MS,
    },
  };
}


function distance2d(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}


function wrapAngleDeg(angle) {
  let a = angle;
  while (a > 180) a -= 360;
  while (a <= -180) a += 360;
  return a;
}


function angleDeg(x, y) {
  /* Task Y is positive downward, so negate Y for conventional math angle. */
  return Math.atan2(-y, x) * 180 / Math.PI;
}


function getPalmCenter(landmarks) {
  if (!landmarks) return null;

  const indices = [
    HAND.INDEX_MCP,
    HAND.MIDDLE_MCP,
    HAND.RING_MCP,
    HAND.PINKY_MCP,
  ];

  let rawX = 0;
  let rawY = 0;

  for (const i of indices) {
    rawX += landmarks[i].x;
    rawY += landmarks[i].y;
  }

  rawX /= indices.length;
  rawY /= indices.length;

  return {
    rawX,
    rawY,
    viewX: 1 - rawX,
    viewY: rawY,
  };
}


function getHand(allLandmarks, allHandedness, label) {
  const index = allHandedness.indexOf(label);
  if (index < 0) return null;
  return allLandmarks[index] ?? null;
}

function updateHandMotionGuard(state, trial, leftPalm, rightPalm, tMs) {
  const prevLeft = state.prevLeftPalmForGuard ?? null;
  const prevRight = state.prevRightPalmForGuard ?? null;

  const leftStep = (leftPalm && prevLeft)
    ? distance2d(leftPalm.viewX, leftPalm.viewY, prevLeft.x, prevLeft.y)
    : 0;
  const rightStep = (rightPalm && prevRight)
    ? distance2d(rightPalm.viewX, rightPalm.viewY, prevRight.x, prevRight.y)
    : 0;

  state.prevLeftPalmForGuard = leftPalm ? { x: leftPalm.viewX, y: leftPalm.viewY } : null;
  state.prevRightPalmForGuard = rightPalm ? { x: rightPalm.viewX, y: rightPalm.viewY } : null;

  const expectedStep = trial.hand === "Left" ? leftStep : rightStep;
  const oppositeStep = trial.hand === "Left" ? rightStep : leftStep;

  const a = WRONG_HAND_MOTION_EMA_ALPHA;
  state.expectedHandMotionEma = state.expectedHandMotionEma == null
    ? expectedStep
    : (1-a) * state.expectedHandMotionEma + a * expectedStep;
  state.oppositeHandMotionEma = state.oppositeHandMotionEma == null
    ? oppositeStep
    : (1-a) * state.oppositeHandMotionEma + a * oppositeStep;

  const bothVisible = leftPalm != null && rightPalm != null;
  const expected = state.expectedHandMotionEma ?? 0;
  const opposite = state.oppositeHandMotionEma ?? 0;
  const oppositeDominant =
    bothVisible &&
    opposite >= WRONG_HAND_MOTION_THRESHOLD &&
    opposite > Math.max(expected * WRONG_HAND_MOTION_RATIO, WRONG_HAND_MOTION_MIN_EXPECTED);

  if (oppositeDominant) {
    if (state.wrongHandMotionSinceMs == null) state.wrongHandMotionSinceMs = tMs;
  } else {
    state.wrongHandMotionSinceMs = null;
  }

  return oppositeDominant &&
    state.wrongHandMotionSinceMs != null &&
    (tMs - state.wrongHandMotionSinceMs) >= WRONG_HAND_WARNING_MS;
}


function getCalibrationTarget(hand, position) {
  return CALIBRATION_TARGETS?.[hand]?.[position] ?? null;
}


function normalizeAxis(value, center, negativeAnchor, positiveAnchor) {
  if (
    value == null ||
    center == null ||
    negativeAnchor == null ||
    positiveAnchor == null
  ) {
    return null;
  }

  const positiveRange = positiveAnchor - center;
  const negativeRange = negativeAnchor - center;

  if (
    Math.abs(positiveRange) < 0.001 ||
    Math.abs(negativeRange) < 0.001
  ) {
    return null;
  }

  const d = value - center;

  if (d * positiveRange >= 0) {
    return d / positiveRange;
  }

  return -(d / negativeRange);
}


function normalizedHandPosition(hand, palm) {
  if (!palm) return { x: null, y: null };

  const c = hand === "Left" ? calibration.left : calibration.right;

  return {
    x: normalizeAxis(palm.viewX, c.homeX, c.leftX, c.rightX),
    y: normalizeAxis(palm.viewY, c.homeY, c.upY, c.downY),
  };
}


function taskToView(taskX, taskY) {
  /* Keep the stored/derived view representation unchanged. Pixel rendering is
     made isotropic by viewToCanvas()/taskToCanvas() below. */
  return {
    x: 0.5 + taskX * DISPLAY_GAIN,
    y: 0.5 + taskY * DISPLAY_GAIN,
  };
}


function viewToCanvas(viewX, viewY, W, H) {
  /* V5.17 FINAL: use one common pixel scale for X and Y. This prevents a
     rectangular (e.g. 4:3) canvas from stretching the nominal circular
     8-direction target array into an ellipse. */
  const scale = Math.min(W, H);
  return {
    x: W * 0.5 + (viewX - 0.5) * scale,
    y: H * 0.5 + (viewY - 0.5) * scale,
  };
}


function taskToCanvas(taskX, taskY, W, H) {
  const view = taskToView(taskX, taskY);
  return viewToCanvas(view.x, view.y, W, H);
}


function calibrationDirectionSymbol(position) {
  if (position === "left") return "←";
  if (position === "right") return "→";
  if (position === "up") return "↑";
  if (position === "down") return "↓";
  return "○";
}


function handKey(hand) {
  return hand === "Left" ? "left" : "right";
}


/* ============================================================
 * TARGETS
 * ============================================================
 */

const DIAGONAL = TARGET_ECCENTRICITY / Math.sqrt(2);

const TARGETS = {
  right:     { x:  TARGET_ECCENTRICITY, y: 0 },
  left:      { x: -TARGET_ECCENTRICITY, y: 0 },
  up:        { x: 0, y: -TARGET_ECCENTRICITY },
  down:      { x: 0, y:  TARGET_ECCENTRICITY },
  upRight:   { x:  DIAGONAL, y: -DIAGONAL },
  upLeft:    { x: -DIAGONAL, y: -DIAGONAL },
  downRight: { x:  DIAGONAL, y:  DIAGONAL },
  downLeft:  { x: -DIAGONAL, y:  DIAGONAL },
};

const DIRECTION_ORDER = [
  "right",
  "left",
  "up",
  "down",
  "upRight",
  "upLeft",
  "downRight",
  "downLeft",
];


function directionLabel(direction) {
  const labels = {
    right: "RIGHT",
    left: "LEFT",
    up: "UP",
    down: "DOWN",
    upRight: "UP-RIGHT",
    upLeft: "UP-LEFT",
    downRight: "DOWN-RIGHT",
    downLeft: "DOWN-LEFT",
  };

  return labels[direction] ?? direction;
}


function targetCode(direction) {
  return DIRECTION_ORDER.indexOf(direction) + 1;
}


function targetAngleDeg(direction) {
  const target = TARGETS[direction];
  return angleDeg(target.x, target.y);
}


function makeTargetSequence(cycles = CYCLES_PER_BLOCK) {
  const sequence = [];

  for (let cycle = 0; cycle < cycles; cycle++) {
    const miniCycle = [...DIRECTION_ORDER];

    for (let i = miniCycle.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [miniCycle[i], miniCycle[j]] = [miniCycle[j], miniCycle[i]];
    }

    sequence.push(...miniCycle);
  }

  return sequence;
}


function phaseCode(phase) {
  if (phase === "home") return 0;
  if (phase === "target") return 1;
  if (phase === "moving") return 2;
  if (phase === "feedback_freeze") return 3;
  if (phase === "return_home") return 4;
  if (phase === "done") return 5;
  if (phase === "return_home_invalid") return 6;
  return 9;
}


function elapsedExcludingTracking(state, startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  let paused = 0;
  for (const interval of state.trackingPauseIntervals ?? []) {
    if (!Number.isFinite(interval?.startMs) || !Number.isFinite(interval?.endMs)) continue;
    const a = Math.max(startMs, interval.startMs);
    const b = Math.min(endMs, interval.endMs);
    if (b > a) paused += b - a;
  }
  return Math.max(0, endMs - startMs - paused);
}

const OPENMOJI_PALM_URL = "https://cdn.jsdelivr.net/npm/openmoji@17.0.0/color/svg/1F590.svg";
const OPENMOJI_FIST_URL = "https://cdn.jsdelivr.net/npm/openmoji@17.0.0/color/svg/270A.svg";
const OPENMOJI_BOOK_URL = "https://cdn.jsdelivr.net/npm/openmoji@17.0.0/color/svg/1F4D6.svg";
const OPENMOJI_PALM_FILTER = "hue-rotate(172deg) saturate(0.58) brightness(1.22)";

/* Participant-facing palm art is not hand-drawn by this experiment.
   It uses OpenMoji's "hand with fingers splayed" (U+1F590), CC BY-SA 4.0.
   The source artwork has the thumb on the viewer's right, corresponding to a LEFT palm
   facing the camera. Mirror only RIGHT-hand cues so the icon matches the requested hand. */
function palmImageHtml(hand = "Right", size = 96, className = "") {
  const flip = hand === "Right" ? "scaleX(-1)" : "none";
  return `<img class="openmoji-palm ${className}" src="${OPENMOJI_PALM_URL}" alt="" aria-hidden="true" style="width:${size}px;height:${size}px;object-fit:contain;transform:${flip};transform-origin:center;display:block;filter:${OPENMOJI_PALM_FILTER} drop-shadow(0 0 9px rgba(126,174,255,.22));">`;
}

let treasurePalmImage = null;
function preloadTreasurePalmImage() {
  if (typeof Image === "undefined") return null;
  if (treasurePalmImage) return treasurePalmImage;
  treasurePalmImage = new Image();
  treasurePalmImage.crossOrigin = "anonymous";
  treasurePalmImage.decoding = "async";
  treasurePalmImage.src = OPENMOJI_PALM_URL;
  return treasurePalmImage;
}

function drawOpenSourcePalm(ctx, cx, cy, size, hand = "Right", alpha = 1) {
  const img = preloadTreasurePalmImage();
  if (!img || !img.complete || !img.naturalWidth) return false;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  if (hand === "Right") ctx.scale(-1, 1);
  const previousFilter = ctx.filter;
  ctx.filter = `${OPENMOJI_PALM_FILTER} drop-shadow(0 0 8px rgba(126,174,255,.20))`;
  ctx.drawImage(img, -size/2, -size/2, size, size);
  ctx.filter = previousFilter;
  ctx.restore();
  return true;
}

function drawCalibrationIntro(ctx, W, H, hand, elapsedMs) {
  const total = CALIBRATION_INTRO_MS;
  const t = clamp(elapsedMs / total, 0, 0.999999);
  ctx.save();
  ctx.fillStyle = "rgba(5,14,34,.93)";
  ctx.fillRect(0,0,W,H);

  const scale = Math.min(W,H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f6f9ff";
  ctx.font = `900 ${Math.round(scale*0.060)}px system-ui,sans-serif`;
  ctx.fillText(`${hand.toUpperCase()} HAND CALIBRATION`, W*0.5, H*0.16);
  ctx.fillStyle = "#b9c9df";
  ctx.font = `700 ${Math.round(scale*0.031)}px system-ui,sans-serif`;
  ctx.fillText(`Use your ${hand.toLowerCase()} hand only.`, W*0.5, H*0.235);

  const targets = CALIBRATION_TARGETS[hand];
  const home = targets.home;
  const left = targets.left;
  const up = targets.up;
  const path = [
    { start: 0.00, end: 0.12, from: home, to: home },
    { start: 0.12, end: 0.32, from: home, to: left },
    { start: 0.32, end: 0.46, from: left, to: left },
    { start: 0.46, end: 0.64, from: left, to: home },
    { start: 0.64, end: 0.76, from: home, to: home },
    { start: 0.76, end: 0.94, from: home, to: up },
    { start: 0.94, end: 1.00, from: up, to: up },
  ];
  const seg = path.find(s => t >= s.start && t < s.end) || path[path.length - 1];
  const raw = (t - seg.start) / Math.max(1e-6, seg.end - seg.start);
  const q = (seg.from === seg.to)
    ? raw
    : (0.5 - 0.5*Math.cos(Math.PI*clamp(raw,0,1)));
  const hx = (seg.from.x + (seg.to.x-seg.from.x)*q) * W;
  const hy = (seg.from.y + (seg.to.y-seg.from.y)*q) * H;

  ctx.strokeStyle = "rgba(141,188,255,.18)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(home.x*W, home.y*H);
  ctx.lineTo(left.x*W, left.y*H);
  ctx.moveTo(home.x*W, home.y*H);
  ctx.lineTo(up.x*W, up.y*H);
  ctx.stroke();

  for (const pos of [home,left,up]) {
    ctx.beginPath();
    ctx.arc(pos.x*W, pos.y*H, scale*0.038, 0, Math.PI*2);
    ctx.fillStyle = pos === home ? "rgba(255,218,107,.14)" : "rgba(121,182,255,.10)";
    ctx.fill();
    ctx.strokeStyle = pos === home ? "rgba(255,218,107,.62)" : "rgba(170,210,255,.38)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  drawOpenSourcePalm(ctx, hx, hy, scale*0.18, hand, 0.99);

  ctx.fillStyle = "#ffe39a";
  ctx.font = `800 ${Math.round(scale*0.025)}px system-ui,sans-serif`;
  ctx.fillText("Move your hand to each glowing circle and hold still.", W*0.5, H*0.84);
  ctx.restore();
}

function setReadoutIfChanged(state, setReadout, html) {
  if (state.lastReadoutHtml === html) return;
  state.lastReadoutHtml = html;
  setReadout(html);
}


function makeTrackingPausedDerived(trial, state, handDetected, overlayActive) {
  const base = state.lastGoodDerived ?? {};
  return {
    ...base,
    activeHand: trial.hand,
    handDetected: handDetected ? 1 : 0,
    cursorVisible: overlayActive ? 0 : (base.cursorVisible ?? 0),
    phaseCode: phaseCode(state.phase),
    targetCode: targetCode(state.currentTargetDirection),
    completedReaches: state.completedReaches,
    trackingPaused: 1,
    trackingLossActive: overlayActive ? 1 : 0,
    fps: state.fps,
  };
}


/* ============================================================
 * TREASURE-HUNT VISUALS — V5.14
 * ============================================================
 * Vector-drawn gems: no emoji and no external image assets.
 * Decorative motion is visual-only and runs concurrently with the
 * existing task phases, so it adds no trial time.
 * The gem center, target geometry, success criterion, and timing are
 * unchanged from V5.1/V5.3.
 */

const EARLY_HEADING_MS = 100;
const GEM_SPARKLE_MS = 360;
/* V5.18: no praise words; collection feedback is a neutral gem pop/sparkle only. */

const GEM_STYLES = [
  { name: "ruby",     light: "#ff9bb0", mid: "#f04468", dark: "#8d1436", glow: "rgba(255,74,112,0.34)" },
  { name: "emerald",  light: "#91f2c1", mid: "#25b979", dark: "#08734a", glow: "rgba(48,208,137,0.32)" },
  { name: "sapphire", light: "#9fc8ff", mid: "#4a86e8", dark: "#244a9b", glow: "rgba(82,142,255,0.34)" },
  { name: "amethyst", light: "#d7b3ff", mid: "#9b62db", dark: "#5b2f96", glow: "rgba(168,100,235,0.34)" },
  { name: "amber",    light: "#ffe3a1", mid: "#f6ad3c", dark: "#a65b12", glow: "rgba(255,183,67,0.34)" },
  { name: "diamond",  light: "#f0fbff", mid: "#9fdceb", dark: "#4a8394", glow: "rgba(188,240,255,0.36)" },
];

function gemStyleIndexForReach(trial, state) {
  const handOffset = trial.hand === "Left" ? 2 : 0;
  const repOffset = (trial.repetition ?? 0) * 3;
  return (state.targetIndex + handOffset + repOffset) % GEM_STYLES.length;
}

/* The repository mirrors the whole #stage .mirror element in CSS so the
   webcam feels natural. Canvas text would therefore also appear backwards.
   We counter-mirror only the graphics drawn by this experiment. The underlying
   webcam remains mirrored, while our HUD/text/targets appear normally. */
function beginParticipantFacingOverlay(ctx, W) {
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
}

function endParticipantFacingOverlay(ctx) {
  ctx.restore();
}

let treasureBackgroundCache = null;

function buildTreasureBackgroundCache(W, H) {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(W));
  canvas.height = Math.max(1, Math.round(H));
  const bg = canvas.getContext("2d");
  if (!bg) return null;

  const g = bg.createRadialGradient(
    W * 0.50, H * 0.44, Math.min(W, H) * 0.04,
    W * 0.50, H * 0.50, Math.max(W, H) * 0.72
  );
  g.addColorStop(0, "#1a315e");
  g.addColorStop(0.48, "#0d1d3f");
  g.addColorStop(1, "#061023");
  bg.fillStyle = g;
  bg.fillRect(0, 0, W, H);

  const glows = [
    [0.14, 0.20, 0.18, "rgba(100,129,214,0.11)"],
    [0.84, 0.24, 0.20, "rgba(157,92,220,0.09)"],
    [0.78, 0.82, 0.17, "rgba(65,180,185,0.08)"],
  ];
  for (const [gx, gy, gr, color] of glows) {
    const rg = bg.createRadialGradient(gx*W, gy*H, 0, gx*W, gy*H, gr*Math.min(W,H));
    rg.addColorStop(0, color);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    bg.fillStyle = rg;
    bg.fillRect(0, 0, W, H);
  }

  /* Static stars are intentionally cached too. Rebuilding several gradients
     every tracking frame can add visible cursor lag on lower-power laptops. */
  const stars = [
    [0.09,0.17],[0.20,0.80],[0.30,0.12],[0.70,0.15],
    [0.88,0.35],[0.91,0.76],[0.73,0.88],[0.14,0.64],
    [0.42,0.08],[0.58,0.91],[0.06,0.44],[0.94,0.55],
  ];
  bg.fillStyle = "rgba(219,234,255,0.16)";
  for (const [mx, my] of stars) {
    bg.beginPath();
    bg.arc(mx*W, my*H, 1.15, 0, Math.PI*2);
    bg.fill();
  }

  return { canvas, W: canvas.width, H: canvas.height };
}

function drawTreasureBackground(ctx, W, H) {
  const w = Math.max(1, Math.round(W));
  const h = Math.max(1, Math.round(H));

  if (
    !treasureBackgroundCache ||
    treasureBackgroundCache.W !== w ||
    treasureBackgroundCache.H !== h
  ) {
    treasureBackgroundCache = buildTreasureBackgroundCache(w, h);
  }

  if (treasureBackgroundCache?.canvas) {
    ctx.drawImage(treasureBackgroundCache.canvas, 0, 0, W, H);
  } else {
    ctx.fillStyle = "#0d1d3f";
    ctx.fillRect(0, 0, W, H);
  }
}

function drawTreasureChest(ctx, x, y, size, active = false, tMs = 0, compact = false, openPct = 0) {
  const pulse = 0.5 + 0.5*Math.sin(tMs/360);
  const w = size * 1.92;
  const bodyH = size * 0.94;
  const lidH = size * 0.64;
  const bodyTop = y - size*0.02;
  const left = x - w/2;
  openPct = clamp(openPct, 0, 1);

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  /* Symmetric whole-chest glow only. */
  if (active || openPct > 0) {
    const haloR = size * (1.34 + 0.10*pulse);
    const halo = ctx.createRadialGradient(x, y, size*0.16, x, y, haloR);
    halo.addColorStop(0, `rgba(255,231,157,${active ? 0.24 : 0.16*openPct})`);
    halo.addColorStop(0.55, `rgba(255,204,94,${active ? 0.11 : 0.07*openPct})`);
    halo.addColorStop(1, "rgba(255,226,142,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, haloR, 0, Math.PI*2);
    ctx.fill();
  }

  ctx.shadowBlur = active ? 28 : 11;
  ctx.shadowColor = active ? "rgba(255,218,112,0.82)" : "rgba(255,195,82,0.24)";

  /* Dark silhouette stroke first keeps the chest crisp on bright or scaled displays. */
  ctx.strokeStyle = "rgba(43,24,16,0.96)";
  ctx.lineWidth = Math.max(4.2, size*0.14);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(left, bodyTop, w, bodyH, size*0.16);
  else ctx.rect(left, bodyTop, w, bodyH);
  ctx.stroke();

  const bodyGrad = ctx.createLinearGradient(left, bodyTop, left+w, bodyTop+bodyH);
  bodyGrad.addColorStop(0, "#df9140");
  bodyGrad.addColorStop(0.46, "#a85d2b");
  bodyGrad.addColorStop(1, "#5b2f1a");
  ctx.fillStyle = bodyGrad;
  ctx.strokeStyle = active ? "#fff0b4" : "#e9bf65";
  ctx.lineWidth = Math.max(2.3, size*0.08);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(left, bodyTop, w, bodyH, size*0.16);
  else ctx.rect(left, bodyTop, w, bodyH);
  ctx.fill();
  ctx.stroke();

  const lidLift = size * 0.50 * openPct;
  const lidTop = bodyTop - lidH*0.72 - lidLift;
  const lidEdgeY = bodyTop + size*0.03 - lidLift*0.42;

  /* Dark lid silhouette. */
  ctx.strokeStyle = "rgba(43,24,16,0.96)";
  ctx.lineWidth = Math.max(4.2, size*0.14);
  ctx.beginPath();
  ctx.moveTo(left, lidEdgeY);
  ctx.quadraticCurveTo(left + w*0.12, lidTop, x, lidTop);
  ctx.quadraticCurveTo(left + w*0.88, lidTop, left+w, lidEdgeY);
  ctx.closePath();
  ctx.stroke();

  const lidGrad = ctx.createLinearGradient(x, lidTop, x, bodyTop+size*0.08);
  lidGrad.addColorStop(0, "#f0ae55");
  lidGrad.addColorStop(0.58, "#bd6c2e");
  lidGrad.addColorStop(1, "#71381d");
  ctx.fillStyle = lidGrad;
  ctx.strokeStyle = active ? "#fff0b4" : "#e9bf65";
  ctx.lineWidth = Math.max(2.3, size*0.08);
  ctx.beginPath();
  ctx.moveTo(left, lidEdgeY);
  ctx.quadraticCurveTo(left + w*0.12, lidTop, x, lidTop);
  ctx.quadraticCurveTo(left + w*0.88, lidTop, left+w, lidEdgeY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;

  /* Brass corner bands and center rails. */
  ctx.strokeStyle = active ? "#fff2b8" : "#f1c96c";
  ctx.lineWidth = Math.max(2.1, size*0.075);
  const bandInset = w*0.25;
  ctx.beginPath();
  ctx.moveTo(x-bandInset, lidTop+size*0.05);
  ctx.lineTo(x-bandInset, bodyTop+bodyH*0.94);
  ctx.moveTo(x+bandInset, lidTop+size*0.05);
  ctx.lineTo(x+bandInset, bodyTop+bodyH*0.94);
  ctx.stroke();

  /* Fine highlights make the vector art read as high-resolution without raster assets. */
  ctx.strokeStyle = "rgba(255,244,204,0.74)";
  ctx.lineWidth = Math.max(1.2, size*0.038);
  ctx.beginPath();
  ctx.moveTo(left+w*0.15, bodyTop+bodyH*0.18);
  ctx.lineTo(left+w*0.43, bodyTop+bodyH*0.18);
  ctx.moveTo(left+w*0.16, bodyTop-size*0.27);
  ctx.quadraticCurveTo(x, lidTop+size*0.08, left+w*0.84, bodyTop-size*0.27);
  ctx.stroke();

  /* Lock plate plus keyhole. */
  ctx.fillStyle = active ? "#fff1ad" : "#f4ce72";
  ctx.strokeStyle = "#83531d";
  ctx.lineWidth = Math.max(1.2, size*0.04);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x-size*0.20, bodyTop+bodyH*0.19, size*0.40, size*0.34, size*0.07);
  else ctx.rect(x-size*0.20, bodyTop+bodyH*0.19, size*0.40, size*0.34);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#694019";
  ctx.beginPath();
  ctx.arc(x, bodyTop+bodyH*0.31, Math.max(1.4,size*0.045), 0, Math.PI*2);
  ctx.fill();
  ctx.fillRect(x-Math.max(0.8,size*0.024), bodyTop+bodyH*0.31, Math.max(1.6,size*0.048), Math.max(3,size*0.11));

  if (!compact) {
    ctx.globalAlpha = active ? 0.34 + 0.10*pulse : 0.12 + 0.04*pulse;
    ctx.strokeStyle = active ? "#8ff0d1" : "#738ba9";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, size*1.55 + 1.5*pulse, 0, Math.PI*2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawHomeChest(ctx, x, y, active, tMs = 0, returning = false) {
  /* The true HOME coordinate and all task logic remain unchanged. */
  const size = 38;
  const visualCenterOffsetY = size * 0.22;
  const openPct = returning ? 0.86 : 0;
  drawTreasureChest(ctx, x, y - visualCenterOffsetY, size, active || returning, tMs, true, openPct);
}

function drawReturnRadialGuide(ctx, homeX, homeY, radialDistance, handInHome, homeHoldPct, W, H, tMs = 0) {
  if (!Number.isFinite(radialDistance)) return;

  /* Radial-only return feedback. The outer ring is always centered on HOME and
     changes only with distance. The fixed inner ring shows the HOME tolerance,
     so participants know what "close enough" means without seeing XY direction. */
  const scale = Math.min(W, H);
  const taskRadiusPx = radialDistance * DISPLAY_GAIN * scale;
  const homeTolerancePx = HOME_RADIUS * DISPLAY_GAIN * scale;
  const radiusPx = clamp(taskRadiusPx, homeTolerancePx, scale*0.24);
  const pulse = 0.5 + 0.5*Math.sin(tMs/260);
  const closeness = clamp(1 - radialDistance / Math.max(TARGET_ECCENTRICITY, HOME_RADIUS), 0, 1);

  ctx.save();

  /* Fixed HOME acceptance zone. */
  ctx.lineWidth = Math.max(2.2, scale*0.0042);
  ctx.strokeStyle = handInHome ? "rgba(132,255,205,0.98)" : "rgba(255,225,145,0.56)";
  ctx.shadowBlur = handInHome ? 16 + 4*pulse : 6;
  ctx.shadowColor = handInHome ? "rgba(96,255,191,0.60)" : "rgba(255,218,126,0.22)";
  ctx.beginPath();
  ctx.arc(homeX, homeY, homeTolerancePx, 0, Math.PI*2);
  ctx.stroke();

  /* Brief hold progress. This does not reveal XY direction; it only shows
     how long the hand has remained inside the HOME acceptance zone. */
  if (handInHome && Number.isFinite(homeHoldPct) && homeHoldPct > 0) {
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(4.5, scale*0.007);
    ctx.strokeStyle = "rgba(220,255,239,0.98)";
    ctx.beginPath();
    ctx.arc(
      homeX, homeY, homeTolerancePx + Math.max(5, scale*0.008),
      -Math.PI/2, -Math.PI/2 + Math.PI*2*clamp(homeHoldPct,0,1)
    );
    ctx.stroke();
  }

  /* Distance ring: large when far, converges onto the fixed HOME ring. */
  ctx.shadowBlur = 8 + 8*closeness;
  ctx.shadowColor = `rgba(${Math.round(110 + 20*closeness)},${Math.round(185 + 60*closeness)},${Math.round(255 - 35*closeness)},0.42)`;
  ctx.lineWidth = Math.max(3, scale*0.006);
  ctx.strokeStyle = handInHome
    ? "rgba(133,255,207,0.98)"
    : `rgba(${Math.round(151 - 20*closeness)},${Math.round(205 + 30*closeness)},255,0.90)`;
  ctx.beginPath();
  ctx.arc(homeX, homeY, radiusPx, 0, Math.PI*2);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = Math.max(1.3, scale*0.0028);
  ctx.beginPath();
  ctx.arc(homeX, homeY, radiusPx + Math.max(5, scale*0.008), 0, Math.PI*2);
  ctx.stroke();
  ctx.restore();
}

function drawTreasureCompassCursor(ctx, cx, cy) {
  const r = 9.5;
  ctx.save();

  /* Small compass token: game-themed but still has an unambiguous center. */
  ctx.shadowBlur = 8;
  ctx.shadowColor = "rgba(255,216,120,0.30)";
  ctx.fillStyle = "#12243f";
  ctx.strokeStyle = "#f4cf72";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;

  /* Four-point compass rose. */
  ctx.fillStyle = "#f5d77f";
  ctx.beginPath();
  ctx.moveTo(cx, cy-r*0.66);
  ctx.lineTo(cx+r*0.22, cy-r*0.18);
  ctx.lineTo(cx+r*0.66, cy);
  ctx.lineTo(cx+r*0.22, cy+r*0.18);
  ctx.lineTo(cx, cy+r*0.66);
  ctx.lineTo(cx-r*0.22, cy+r*0.18);
  ctx.lineTo(cx-r*0.66, cy);
  ctx.lineTo(cx-r*0.22, cy-r*0.18);
  ctx.closePath();
  ctx.fill();

  /* Exact cursor coordinate remains visually marked. */
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, 1.8, 0, Math.PI*2);
  ctx.fill();

  ctx.restore();
}


function handPositionDotLegendHtml(size = 25) {
  const s = Number(size) || 25;
  return `<svg class="hand-position-dot-legend" width="${s}" height="${s}" viewBox="0 0 25 25" aria-label="hand-position dot" role="img" style="display:inline-block;vertical-align:-6px;margin:0 5px;filter:drop-shadow(0 0 5px rgba(255,216,120,.22));">
    <circle cx="12.5" cy="12.5" r="9.2" fill="#12243f" stroke="#f4cf72" stroke-width="2.1"/>
    <path d="M12.5 6.4 L14.5 10.6 L18.6 12.5 L14.5 14.4 L12.5 18.6 L10.5 14.4 L6.4 12.5 L10.5 10.6 Z" fill="#f5d77f"/>
    <circle cx="12.5" cy="12.5" r="1.8" fill="#ffffff"/>
  </svg>`;
}

function gemPolygon(styleIndex, cx, cy, r) {
  const k = styleIndex % GEM_STYLES.length;
  if (k === 0) return [[cx,cy-r],[cx+r*0.82,cy-r*0.18],[cx+r*0.48,cy+r],[cx-r*0.48,cy+r],[cx-r*0.82,cy-r*0.18]];
  if (k === 1) return [[cx-r*0.60,cy-r],[cx+r*0.60,cy-r],[cx+r,cy-r*0.48],[cx+r,cy+r*0.48],[cx+r*0.60,cy+r],[cx-r*0.60,cy+r],[cx-r,cy+r*0.48],[cx-r,cy-r*0.48]];
  if (k === 2) return [[cx,cy-r],[cx+r*0.88,cy-r*0.48],[cx+r*0.88,cy+r*0.48],[cx,cy+r],[cx-r*0.88,cy+r*0.48],[cx-r*0.88,cy-r*0.48]];
  if (k === 3) return [[cx,cy-r],[cx+r*0.62,cy-r*0.62],[cx+r*0.88,cy],[cx+r*0.55,cy+r*0.78],[cx,cy+r],[cx-r*0.55,cy+r*0.78],[cx-r*0.88,cy],[cx-r*0.62,cy-r*0.62]];
  if (k === 4) return [[cx,cy-r],[cx+r,cy],[cx,cy+r],[cx-r,cy]];
  return [[cx-r*0.72,cy-r*0.50],[cx-r*0.38,cy-r],[cx+r*0.38,cy-r],[cx+r*0.72,cy-r*0.50],[cx,cy+r]];
}

function pathPolygon(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function drawGem(ctx, cx, cy, size, styleIndex, tMs = 0) {
  const style = GEM_STYLES[styleIndex % GEM_STYLES.length];
  const pts = gemPolygon(styleIndex, cx, cy, size);
  const pulse = 0.5 + 0.5*Math.sin(tMs/420 + styleIndex*0.7);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const halo = ctx.createRadialGradient(cx, cy, size*0.08, cx, cy, size*(1.48 + 0.08*pulse));
  halo.addColorStop(0, style.glow);
  halo.addColorStop(0.55, style.glow.replace(/0\.3[24-6]/, "0.16"));
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = 0.84 + 0.16*pulse;
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, size*1.64, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1;

  /* Dark silhouette followed by a bright crystal edge remains sharp under scaling. */
  ctx.shadowBlur = 16 + 4*pulse;
  ctx.shadowColor = style.glow;
  ctx.lineWidth = Math.max(3.4, size*0.17);
  ctx.strokeStyle = "rgba(8,18,38,0.92)";
  pathPolygon(ctx, pts);
  ctx.stroke();

  const fill = ctx.createLinearGradient(cx-size, cy-size, cx+size, cy+size);
  fill.addColorStop(0, style.light);
  fill.addColorStop(0.38, style.mid);
  fill.addColorStop(1, style.dark);
  ctx.fillStyle = fill;
  pathPolygon(ctx, pts);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1.8, size*0.095);
  ctx.strokeStyle = "rgba(255,255,255,0.90)";
  pathPolygon(ctx, pts);
  ctx.stroke();

  /* Multi-plane facets: clear crystal structure without adding a center target dot. */
  const top = pts[0];
  const right = pts[Math.max(1, Math.floor(pts.length * 0.30))];
  const leftPt = pts[Math.max(1, Math.floor(pts.length * 0.72))];
  const innerTop = [cx, cy-size*0.28];
  const innerLeft = [cx-size*0.27, cy-size*0.05];
  const innerRight = [cx+size*0.29, cy-size*0.04];
  const innerBottom = [cx, cy+size*0.46];

  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath();
  ctx.moveTo(top[0], top[1]);
  ctx.lineTo(innerLeft[0], innerLeft[1]);
  ctx.lineTo(innerTop[0], innerTop[1]);
  ctx.lineTo(innerRight[0], innerRight[1]);
  ctx.closePath();
  ctx.fill();

  ctx.lineWidth = Math.max(1.0, size*0.055);
  ctx.strokeStyle = "rgba(255,255,255,0.34)";
  ctx.beginPath();
  ctx.moveTo(top[0], top[1]);
  ctx.lineTo(innerTop[0], innerTop[1]);
  ctx.lineTo(right[0], right[1]);
  ctx.moveTo(top[0], top[1]);
  ctx.lineTo(innerTop[0], innerTop[1]);
  ctx.lineTo(leftPt[0], leftPt[1]);
  ctx.moveTo(innerLeft[0], innerLeft[1]);
  ctx.lineTo(innerBottom[0], innerBottom[1]);
  ctx.lineTo(innerRight[0], innerRight[1]);
  ctx.stroke();

  /* Angled specular glint. */
  ctx.save();
  ctx.translate(cx - size*0.26, cy - size*0.34);
  ctx.rotate(-0.45);
  ctx.fillStyle = `rgba(255,255,255,${0.66 + 0.18*pulse})`;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-size*0.18, -size*0.05, size*0.36, size*0.10, size*0.05);
  else ctx.rect(-size*0.18, -size*0.05, size*0.36, size*0.10);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

function drawCollectSparkle(ctx, cx, cy, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > GEM_SPARKLE_MS) return;
  const p = elapsedMs / GEM_SPARKLE_MS;
  const radius = 18 + 30*p;
  const alpha = 1 - p;
  ctx.save();
  ctx.strokeStyle = `rgba(255,238,167,${0.75*alpha})`;
  ctx.fillStyle = `rgba(255,248,210,${0.86*alpha})`;
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + 0.25;
    const x = cx + Math.cos(a)*radius;
    const y = cy + Math.sin(a)*radius;
    ctx.beginPath();
    ctx.arc(x, y, 2.5 + 2.5*(1-p), 0, Math.PI*2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 12 + 18*p, 0, Math.PI*2);
  ctx.stroke();
  ctx.restore();
}

function drawCalibrationTint(ctx, W, H) {
  const edge = ctx.createRadialGradient(W*0.5,H*0.48,Math.min(W,H)*0.24,W*0.5,H*0.48,Math.max(W,H)*0.72);
  edge.addColorStop(0, "rgba(5,14,34,0.02)");
  edge.addColorStop(1, "rgba(5,14,34,0.34)");
  ctx.fillStyle = edge;
  ctx.fillRect(0,0,W,H);
}

function drawCalibrationMapRoute(ctx, W, H, hand, stepIndex, tMs) {
  const targets = CALIBRATION_TARGETS?.[hand];
  if (!targets) return;

  const home = targets.home;
  const cardinal = ["left", "right", "up", "down"];
  const firstVisit = { left: 1, right: 3, up: 5, down: 7 };

  ctx.save();
  ctx.lineCap = "round";

  /* Faint map spokes show the space that is being mapped. */
  for (const dir of cardinal) {
    const p = targets[dir];
    const completed = stepIndex > firstVisit[dir];
    ctx.strokeStyle = completed ? "rgba(255,218,116,0.48)" : "rgba(221,235,255,0.16)";
    ctx.lineWidth = completed ? 3 : 2;
    ctx.setLineDash(completed ? [] : [5, 8]);
    ctx.beginPath();
    ctx.moveTo(home.x*W, home.y*H);
    ctx.lineTo(p.x*W, p.y*H);
    ctx.stroke();

    /* Tiny destination marker. */
    ctx.fillStyle = completed ? "rgba(255,224,137,0.86)" : "rgba(218,232,255,0.30)";
    ctx.beginPath();
    ctx.arc(p.x*W, p.y*H, completed ? 4.2 : 3.2, 0, Math.PI*2);
    ctx.fill();
  }

  /* Animated route from the previous calibration point to the current one. */
  if (stepIndex > 0 && stepIndex < CALIBRATION_SEQUENCE.length) {
    const prevName = CALIBRATION_SEQUENCE[stepIndex-1];
    const curName = CALIBRATION_SEQUENCE[stepIndex];
    const a = targets[prevName];
    const b = targets[curName];
    if (a && b) {
      ctx.strokeStyle = "rgba(255,226,137,0.92)";
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 11]);
      ctx.lineDashOffset = -(tMs/34) % 21;
      ctx.shadowBlur = 9;
      ctx.shadowColor = "rgba(255,207,92,0.42)";
      ctx.beginPath();
      ctx.moveTo(a.x*W, a.y*H);
      ctx.lineTo(b.x*W, b.y*H);
      ctx.stroke();
    }
  }

  ctx.setLineDash([]);
  ctx.restore();
}

function drawCalibrationBeacon(ctx, x, y, radiusPx, position, onTarget, holdPct, tMs) {
  const pulse = 0.5 + 0.5*Math.sin(tMs/360);
  const color = onTarget ? "#7bf2c8" : "#ffd66b";

  ctx.save();
  ctx.shadowBlur = 16 + 7*pulse;
  ctx.shadowColor = onTarget ? "rgba(87,245,196,0.72)" : "rgba(255,207,95,0.68)";
  ctx.lineWidth = Math.max(4, radiusPx*0.10);
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radiusPx, 0, Math.PI*2);
  ctx.stroke();

  ctx.globalAlpha = 0.18 + 0.08*pulse;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, radiusPx*1.20, 0, Math.PI*2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (onTarget && holdPct > 0) {
    ctx.lineWidth = Math.max(5, radiusPx*0.12);
    ctx.strokeStyle = "#eafff7";
    ctx.beginPath();
    ctx.arc(x, y, radiusPx*1.04, -Math.PI/2, -Math.PI/2 + Math.PI*2*clamp(holdPct/100,0,1));
    ctx.stroke();
  }

  /* V5.8 / JT feedback: all calibration cues are circles.
     The target location itself tells the participant where to move; no arrows
     are needed inside the calibration marker. */
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(238,255,249,0.92)";
  ctx.beginPath();
  ctx.arc(x, y, radiusPx*0.40, 0, Math.PI*2);
  ctx.stroke();
  ctx.restore();
}

function drawCalibrationTracker(ctx, x, y, onTarget, tMs) {
  const pulse = 0.5 + 0.5*Math.sin(tMs/300);
  ctx.save();
  ctx.shadowBlur = 14 + 4*pulse;
  ctx.shadowColor = onTarget ? "rgba(118,242,200,0.86)" : "rgba(150,210,255,0.78)";
  ctx.fillStyle = onTarget ? "#bfffe8" : "#c7e8ff";
  ctx.strokeStyle = "rgba(7,21,45,0.95)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 11.5, 0, Math.PI*2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}


function drawProgressBadge(ctx, W, H, completed, total, tMs = 0, justCollected = false, label = "TASK PROGRESS") {
  const scale = Math.min(W, H);
  const h = Math.max(62, Math.round(scale * 0.102));
  const w = Math.max(190, Math.round(scale * 0.31));
  const x = W - w - Math.round(scale * 0.030);
  const y = Math.round(scale * 0.026);
  const glow = justCollected ? 0.48 + 0.20*Math.sin(tMs/70) : 0.14;
  const pct = Math.round(100 * clamp(completed / Math.max(1, total), 0, 1));

  ctx.save();
  ctx.shadowBlur = justCollected ? 18 : 8;
  ctx.shadowColor = `rgba(119,184,255,${glow})`;
  ctx.fillStyle = "rgba(5,14,32,0.84)";
  ctx.strokeStyle = justCollected ? "rgba(182,224,255,0.64)" : "rgba(176,208,255,0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, h*0.30);
  else ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  const iconX = x + h*0.47;
  const iconY = y + h*0.46;
  drawGem(ctx, iconX, iconY, h*0.20, 2, tMs);

  const tx = x + h*0.86;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#afc8e7";
  ctx.font = `750 ${Math.round(h*0.20)}px sans-serif`;
  ctx.fillText(label, tx, y + h*0.28);

  ctx.fillStyle = "#f5f8ff";
  ctx.font = `900 ${Math.round(h*0.36)}px sans-serif`;
  ctx.fillText(`${pct}%`, tx, y + h*0.55);

  const barX = tx;
  const barY = y + h*0.79;
  const barW = w - (tx - x) - h*0.22;
  const barH = Math.max(5, h*0.075);
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(barX, barY, barW, barH, barH/2);
  else ctx.rect(barX, barY, barW, barH);
  ctx.fill();
  ctx.fillStyle = "#78d6ff";
  ctx.beginPath();
  const fillW = Math.max(0, barW*clamp(completed/Math.max(1,total),0,1));
  if (ctx.roundRect) ctx.roundRect(barX, barY, fillW, barH, barH/2);
  else ctx.rect(barX, barY, fillW, barH);
  ctx.fill();
  ctx.restore();
}

function reachingBlockIndex(trial) {
  const phaseOffset = trial.feedback ? 4 : 0;
  const repetitionOffset = Math.max(0, (trial.repetition ?? 1) - 1) * 2;
  const handOffset = trial.hand === "Left" ? 1 : 0;
  return clamp(phaseOffset + repetitionOffset + handOffset, 0, TOTAL_REACHING_BLOCKS - 1);
}

function drawBlockStartOverlay(ctx, W, H, trial, state, tMs = 0) {
  /* V5.18: intentionally disabled. Hand/feedback changes are explained on the rest screen instead. */
}

function setTreasureReachingUiMode(mode) {
  if (typeof document === "undefined" || !document.body) return;
  document.body.classList.toggle("treasure-reaching-active", mode === "reaching");
  document.body.classList.toggle("treasure-calibration-active", mode === "calibration");
  if (mode !== "reaching") {
    document.getElementById("treasure-too-slow-overlay")?.classList.remove("show");
  }
}


function makeFeedbackFreezeRecord(state, freezeEndMs) {
  const r = state.currentInitialRecord;
  const endpointInsideTarget =
    r.angularHit === 1 || angularHitFromError(r.initialAngularErrorDeg);

  const freezeDurationMs = elapsedExcludingTracking(state, state.feedbackFreezeStartMs, freezeEndMs);

  return {
    ...r,

    /* V5 explicit endpoint aliases. These are the endpoint after a continuously
       visible feedback-guided outbound movement. */
    endpointX: r.initialCrossingX,
    endpointY: r.initialCrossingY,
    endpointAngleDeg: r.initialCrossingAngleDeg,
    endpointAngularErrorDeg: r.initialAngularErrorDeg,
    endpointRadialDistance: r.initialRadialDistance,
    endpointDistanceToTarget: r.initialDistanceToTarget,
    endpointInsideTarget: endpointInsideTarget ? 1 : 0,
    angularHit: endpointInsideTarget ? 1 : 0,
    angularHitToleranceDeg: ANGULAR_HIT_TOLERANCE_DEG,

    feedbackMode: "locked_cursor_planning_then_continuous_cursor_then_frozen_endpoint",
    feedbackCursorVisibleDuringOutbound: true,
    feedbackFreezePlannedMs: FEEDBACK_FREEZE_MS,
    feedbackFreezeMs: freezeDurationMs,
    frozenEndpointX: state.feedbackFreezeX,
    frozenEndpointY: state.feedbackFreezeY,

    /* Backward-compatible final* aliases now refer to the same registered
       endpoint. There is no second, post-endpoint corrected endpoint in V5. */
    finalX: r.initialCrossingX,
    finalY: r.initialCrossingY,
    finalAngleDeg: r.initialCrossingAngleDeg,
    finalAngularErrorDeg: r.initialAngularErrorDeg,
    finalRadialDistance: r.initialRadialDistance,
    finalDistanceToTarget: r.initialDistanceToTarget,

    firstTargetEntryX: null,
    firstTargetEntryY: null,
    firstTargetEntryAngleDeg: null,
    firstTargetEntryAngularErrorDeg: null,
    firstTargetEntryRadialDistance: null,
    firstTargetEntryDistanceToTarget: null,
    primaryCorrectionSource: null,
    primaryCorrectionMsFromFeedbackStart: null,
    absoluteErrorReductionDeg: null,
    correctionWindowMs: 0,
    feedbackWindowDurationMs: null,
    correctionLatencyMs: null,
    correctionSuccess: null,
    correctionEndReason: null,
    minimumTargetDistance: null,

    totalPathLength: state.outboundPathLength,
    timedOut: false,
  };
}

/* ============================================================
 * TREASURE-HUNT SHELL UI V5.17.0 FINAL — camera check, fullscreen-after-camera, transition reminders, tracking guard
 * ============================================================ */

let treasureAudioContext = null;

function playTreasureChime(kind = "block") {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!treasureAudioContext) treasureAudioContext = new AudioCtx();
    const ctx = treasureAudioContext;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const notes = kind === "complete" ? [523.25, 659.25, 783.99, 1046.50]
      : kind === "midpoint" ? [523.25, 659.25, 783.99]
      : kind === "calibration" ? [587.33, 739.99]
      : [659.25, 783.99];
    const startAt = ctx.currentTime + 0.015;
    notes.forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      const t0 = startAt + i * 0.075;
      const t1 = t0 + 0.14;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.065, t0 + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, t1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t1 + 0.02);
    });
  } catch (_) {}
}

function playTreasureCollectSound() {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!treasureAudioContext) treasureAudioContext = new AudioCtx();
    const ctx = treasureAudioContext;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const now = ctx.currentTime + 0.008;

    /* Short, non-contingent collect/slice cue. It is triggered for every valid
       registered endpoint in both NF and FB, regardless of target accuracy. */
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(940, now + 0.075);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.010);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.105);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);

    const click = ctx.createOscillator();
    const clickGain = ctx.createGain();
    click.type = "sine";
    click.frequency.setValueAtTime(1280, now + 0.025);
    clickGain.gain.setValueAtTime(0.0001, now + 0.025);
    clickGain.gain.exponentialRampToValueAtTime(0.028, now + 0.032);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.072);
    click.connect(clickGain);
    clickGain.connect(ctx.destination);
    click.start(now + 0.025);
    click.stop(now + 0.08);
  } catch (_) {}
}

function requestTreasureFullscreen() {
  if (typeof document === "undefined") return;
  if (document.fullscreenElement || !document.documentElement?.requestFullscreen) return;
  document.documentElement.requestFullscreen().catch(() => {});
}

function setupTreasureShellUi() {
  if (typeof document === "undefined") return;
  preloadTreasurePalmImage();
  /* The runner may create/re-create #screen-position after this module loads.
     Install the CSS once, but always continue into the idempotent DOM setup
     below so late-created camera elements still receive the custom shell. */
  let style = document.getElementById("treasure-shell-v516");
  const needsShellStyle = !style;
  if (!style) {
    style = document.createElement("style");
    style.id = "treasure-shell-v516";
  }
  if (needsShellStyle) style.textContent = `
    /* V5.16 responsive shell. Setup/instruction screens may scroll on short
       displays; only active trial/rest screens lock page scrolling. */
    body:has(#screen-position.visible),
    body:has(#screen-instructions.visible) { overflow-y:auto; }
    /* V5.18.4 UI refinement: the generic instruction page is intentionally
       skipped; static LEFT calibration begins immediately after camera check. */
    #screen-instructions.visible { opacity:0 !important; pointer-events:none !important; }
    body:has(#screen-trial.visible),
    body:has(#screen-rest.visible) { overflow-y:hidden; }
    body:has(#screen-position.visible) main { max-width:900px; width:min(96vw,900px); }
    #screen-position { text-align:center; min-height:100dvh; box-sizing:border-box; padding-bottom:86px; }
    #screen-position > h2 { font-size:2rem; margin:8px 0 2px; }
    #screen-position .camera-performance-reminder { display:none !important; }
    #screen-position #position-stage-slot { margin-top:8px; }
    body:has(#screen-position.visible) #stage {
      width:min(92vw,680px,calc((100dvh - 300px) * 4 / 3));
      max-width:100%; margin:6px auto 8px; border-radius:18px;
      box-shadow:0 18px 52px rgba(0,0,0,.28);
    }
    body:has(#screen-position.visible) #live-readout,
    body:has(#screen-position.visible) #trial-timer,
    body:has(#screen-position.visible) #countdown { display:none !important; }

    #treasure-camera-cue {
      width:min(96vw,900px); box-sizing:border-box; margin:8px auto 10px; padding:9px 12px;
      border-radius:18px; background:rgba(18,36,65,.34);
      border:1px solid rgba(145,190,246,.12); box-shadow:0 10px 28px rgba(0,0,0,.13);
    }
    #treasure-camera-cue .camera-hero {
      display:grid; grid-template-columns:minmax(210px,250px) minmax(0,1fr);
      align-items:center; gap:16px; min-height:92px;
    }
    #treasure-camera-cue .camera-copy { text-align:left; padding-left:6px; }
    #treasure-camera-cue .camera-title { color:#f7f9ff; font:850 1.38rem/1.08 system-ui,sans-serif; letter-spacing:0; }
    #treasure-camera-cue .camera-sub { color:#c7d4e8; font:650 .94rem/1.35 system-ui,sans-serif; margin-top:4px; }
    #treasure-camera-cue .camera-note { color:#aebed2; font:600 .92rem/1.35 system-ui,sans-serif; margin-top:9px; }
    #treasure-camera-cue .camera-demo {
      height:86px; display:grid; place-items:center; position:relative; overflow:hidden;
    }
    #treasure-camera-cue .camera-hand-animation {
      display:grid; place-items:center; transform-origin:50% 85%;
      animation:treasureCameraPalmEnter5184 3.6s cubic-bezier(.33,.02,.23,1) infinite;
    }
    #treasure-camera-cue .camera-hand-animation .camera-palm {
      filter:drop-shadow(0 5px 9px rgba(0,0,0,.18));
    }
    #treasure-camera-cue .camera-check {
      position:absolute; inset:0; display:grid; place-items:center;
      color:#7ce7a8; font:900 2.7rem/1 system-ui,sans-serif;
      opacity:0; transform:scale(.82); transition:opacity .18s ease,transform .18s ease;
    }
    #treasure-camera-cue.detected .camera-hand-animation { animation:none; opacity:0; }
    #treasure-camera-cue.detected .camera-check { opacity:1; transform:scale(1); }
    @keyframes treasureCameraPalmEnter5184 {
      0%,10% { transform:translateY(62px) scale(.88); opacity:.10; }
      30%,68% { transform:translateY(0) scale(1); opacity:1; }
      84%,100% { transform:translateY(62px) scale(.88); opacity:.10; }
    }

    #position-status { min-height:1.5em; margin:6px 0 2px; font-size:1.02rem; }
    #treasure-camera-mainrow {
      width:min(96vw,900px); margin:5px auto 7px; display:flex;
      flex-direction:column; align-items:center; gap:10px;
    }
    #screen-position .treasure-camera-actions {
      width:min(100%,620px); display:flex; justify-content:center; margin:2px auto 0;
      position:static; z-index:1; padding:0; border-radius:0; background:transparent;
      backdrop-filter:none; -webkit-backdrop-filter:none;
    }
    #screen-position .treasure-camera-actions button {
      width:min(100%,360px); margin:0 auto; min-height:50px; border-radius:14px;
      font-weight:900; letter-spacing:.01em;
      box-shadow:0 8px 22px rgba(52,118,255,.22);
    }
    #treasure-camera-mainrow #position-stage-slot { width:min(100%,620px); min-width:0; margin:0 auto; }
    #treasure-camera-mainrow #stage { width:min(100%,620px,calc((100dvh - 285px) * 4 / 3)); margin:0 auto; }
    #treasure-camera-tips {
      width:min(100%,620px); margin:2px auto 0; display:grid !important;
      grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; align-items:stretch;
    }
    #treasure-camera-tips .tip {
      display:flex; align-items:center; justify-content:center; gap:7px; min-height:42px;
      padding:8px 9px; border-radius:12px; background:rgba(19,37,66,.42);
      border:1px solid rgba(145,190,246,.11); color:#dbe7f7; font-size:.84rem;
      font-weight:700; text-align:center; line-height:1.18;
    }
    #treasure-camera-tips svg { width:18px; height:18px; flex:0 0 auto; color:#9fc8ff; }
    @media (max-width:720px) {
      #treasure-camera-cue .camera-hero { grid-template-columns:1fr; }
      #treasure-camera-cue .camera-copy { text-align:center; padding-left:0; }
      #treasure-camera-cue .camera-demo { height:72px; }
      #treasure-camera-mainrow { display:flex; flex-direction:column; }
      #treasure-camera-tips { grid-template-columns:1fr; width:min(100%,560px); }
      #treasure-camera-tips .tip { justify-content:flex-start; text-align:left; }
      #screen-position .treasure-camera-actions button { width:100%; }
    }
    @media (max-height:820px) {
      #treasure-camera-cue { margin:5px auto 6px; padding:7px 12px; }
      #treasure-camera-cue .camera-title { font-size:1.28rem; }
      #treasure-camera-cue .camera-note { display:none; }
      #treasure-camera-cue .camera-hero { min-height:78px; }
      #treasure-camera-cue .camera-demo { height:72px; }
      #treasure-camera-mainrow #stage { width:min(100%,560px,calc((100dvh - 215px) * 4 / 3)); }
    }
    @media (max-height:640px) {
      #screen-position > h2 { font-size:1.55rem; }
      #screen-position .camera-performance-reminder { display:none !important; }
      #treasure-camera-cue .camera-hero { grid-template-columns:1fr; min-height:0; }
      #treasure-camera-cue .camera-copy { text-align:center; padding-left:0; }
      #treasure-camera-cue .camera-demo { display:none; }
      body:has(#screen-position.visible) #stage { width:min(88vw,500px,calc((100dvh - 170px) * 4 / 3)); }
    }

    body.treasure-reaching-active #stage,
    body.treasure-reaching-active #stage *,
    body.treasure-calibration-active #stage,
    body.treasure-calibration-active #stage * { cursor:none !important; }

    /* V5.16 transition screen: larger one-hand cue and How-to-Play reminder for full-screen viewing. */
    body:has(#screen-rest.visible) main { max-width:none; width:100%; }
    #screen-rest {
      width:min(90vw,960px); min-height:min(64dvh,500px); box-sizing:border-box;
      text-align:center; margin:0 auto; padding:30px 40px 26px; border-radius:30px;
      flex-direction:column; justify-content:center;
      background:radial-gradient(circle at 50% 12%,#17315f 0,#0d1d3d 45%,#091429 100%);
      border:1px solid rgba(151,196,255,.14); box-shadow:0 24px 70px rgba(0,0,0,.28);
    }
    #screen-rest:not(.visible) { display:none !important; }
    #screen-rest.visible { display:flex; }
    #screen-rest h2 { font-size:clamp(2.5rem,5.5vw,3.7rem); margin:6px 0 7px; letter-spacing:.015em; }
    #screen-rest > p:not(.subtle) { font-size:clamp(1.15rem,2.2vw,1.4rem); min-height:1.5em; margin:4px 0 9px; color:#d4e1f1; font-weight:700; }
    #screen-rest[data-transition-kind="reaching"] > p:not(.subtle) {
      width:min(92%,760px);box-sizing:border-box;margin:5px auto 10px;padding:9px 15px;
      border-radius:14px;color:#ffe28a;font-size:clamp(1.25rem,2.65vw,1.65rem);font-weight:950;
      line-height:1.18;text-shadow:0 0 16px rgba(255,211,105,.24);
      background:rgba(255,209,91,.075);border:1px solid rgba(255,222,132,.25);
    }
    #screen-rest[data-transition-kind="reaching"] #treasure-rest-howto .mini-steps span:nth-child(2) {
      color:#ffe28a;font-weight:900;background:rgba(255,209,91,.075);border:1px solid rgba(255,222,132,.18);
    }
    #screen-rest #rest-progress { position:absolute !important; width:1px; height:1px; overflow:hidden; opacity:0; pointer-events:none; }
    #treasure-rest-art { min-height:88px; display:flex; align-items:center; justify-content:center; margin:0 auto 2px; color:#d9e9ff; }
    #screen-rest[data-transition-kind="skipCalibration"],
    #screen-rest[data-transition-kind="skipCustom"] { opacity:0 !important; pointer-events:none !important; }
    #screen-rest[data-transition-kind="skipCalibration"] #treasure-rest-countdown,
    #screen-rest[data-transition-kind="skipCalibration"] #treasure-rest-auto-note,
    #screen-rest[data-transition-kind="skipCustom"] #treasure-rest-countdown,
    #screen-rest[data-transition-kind="skipCustom"] #treasure-rest-auto-note { display:none !important; }

    /* V5: while the custom bimanual flow is active, do not flash the runner's
       generic transition/GO screen between our instruction and task trials.
       Real break/completion cards remain allowed. */
    body.bim-custom-flow-active #screen-rest.visible,
    body.treasure-calibration-active #screen-rest.visible { opacity:0; pointer-events:none; }
    body.bim-custom-flow-active #screen-rest.visible[data-transition-kind="denovoBreak"],
    body.bim-custom-flow-active #screen-rest.visible[data-transition-kind="complete"],
    body.treasure-calibration-active #screen-rest.visible[data-transition-kind="complete"] { opacity:1; pointer-events:auto; }
    #treasure-rest-art svg, #treasure-rest-art img { filter:drop-shadow(0 9px 16px rgba(0,0,0,.24)); }
    #treasure-rest-howto { display:none; width:min(100%,800px); max-width:800px; margin:10px auto 5px; padding:15px 17px 14px; border-radius:18px; background:rgba(255,255,255,.045); border:1px solid rgba(192,219,255,.11); }
    #screen-rest[data-transition-kind="reaching"] #treasure-rest-howto { display:block; }
    #screen-rest[data-transition-kind="reaching"] #treasure-rest-art { display:none; }
    #treasure-rest-howto .mini-demo { width:100%; height:142px; display:block; overflow:visible; }
    #treasure-rest-howto .mini-how-hand { animation:treasureMiniHowHand5161 4.6s cubic-bezier(.45,.04,.2,1) infinite; transform-box:fill-box; transform-origin:center; filter:hue-rotate(172deg) saturate(.58) brightness(1.22) drop-shadow(0 0 7px rgba(126,174,255,.22)); }
    #treasure-rest-howto .mini-how-chest { animation:treasureMiniHowChest516 4.6s linear infinite; }
    #treasure-rest-howto .mini-how-gem { animation:treasureMiniHowGem516 1.25s ease-in-out infinite; transform-box:fill-box; transform-origin:center; }
    #treasure-rest-howto .mini-steps { display:grid; grid-template-columns:repeat(3,1fr); gap:9px; margin-top:5px; color:#d9e6f7; font-size:.94rem; font-weight:750; line-height:1.2; }
    #treasure-rest-howto .mini-steps span { padding:9px 7px; border-radius:10px; background:rgba(255,255,255,.035); }
    @keyframes treasureMiniHowHand5161 { 0%,18%{transform:translateX(0) scaleX(var(--hand-flip,1))} 48%,64%{transform:translateX(360px) scaleX(var(--hand-flip,1))} 90%,100%{transform:translateX(0) scaleX(var(--hand-flip,1))} }
    @keyframes treasureMiniHowChest516 { 0%,22%{opacity:1} 30%,61%{opacity:.10} 68%,100%{opacity:1} }
    @keyframes treasureMiniHowGem516 { 0%,42%,72%,100%{filter:drop-shadow(0 0 4px rgba(120,190,255,.45));transform:scale(.98)} 52%,64%{filter:drop-shadow(0 0 14px rgba(160,220,255,1));transform:scale(1.10)} }
    #treasure-rest-route { display:none !important; }
    #screen-rest #btn-next-trial { display:none !important; }
    #treasure-rest-countdown { width:128px; height:128px; margin:13px auto 4px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:9px; position:relative; background:conic-gradient(#7da8ff var(--rest-pct,0%),rgba(255,255,255,.10) 0); box-shadow:0 0 28px rgba(95,151,255,.24); }
    #treasure-rest-countdown::before { content:""; position:absolute; inset:8px; border-radius:50%; background:#0b1934; border:1px solid rgba(193,220,255,.15); }
    #treasure-rest-countdown .rest-sec { position:relative; z-index:1; display:block; font:900 2.55rem/.92 system-ui,sans-serif; color:#f5f9ff; transform:translateY(3px); }
    #treasure-rest-countdown .rest-label { position:relative; z-index:1; display:block; font:750 .70rem/1 system-ui,sans-serif; color:#aec3df; letter-spacing:.07em; }
    #treasure-rest-auto-note { margin:10px auto 0; color:#aebed2; font-size:1rem; }
    @media (max-height:650px) {
      #screen-rest { min-height:auto; padding:20px 28px 18px; }
      #screen-rest h2 { font-size:clamp(2.1rem,5vw,3rem); }
      #treasure-rest-howto { margin:6px auto 2px; padding:9px 12px 10px; }
      #treasure-rest-howto .mini-demo { height:108px; }
      #treasure-rest-howto .mini-steps { font-size:.82rem; gap:6px; }
      #treasure-rest-howto .mini-steps span { padding:6px 5px; }
      #treasure-rest-countdown { width:102px; height:102px; margin:7px auto 2px; }
      #treasure-rest-countdown .rest-sec { font-size:2.1rem; }
      #treasure-rest-auto-note { margin-top:5px; font-size:.88rem; }
    }

    /* Full-screen task safeguards. */
    #treasure-too-slow-overlay,
    #treasure-tracking-overlay { position:fixed; inset:0; z-index:99999; display:none; place-items:center; pointer-events:none; background:rgba(4,10,24,.66); -webkit-backdrop-filter:blur(5px); backdrop-filter:blur(5px); }
    #treasure-too-slow-overlay.show,
    #treasure-tracking-overlay.show { display:grid; }
    #treasure-too-slow-overlay .slow-card,
    #treasure-tracking-overlay .tracking-card { min-width:min(470px,76%); padding:26px 32px 24px; border-radius:24px; text-align:center; background:rgba(8,20,43,.95); box-shadow:0 22px 56px rgba(0,0,0,.38); }
    #treasure-too-slow-overlay .slow-card { border:2px solid rgba(255,220,124,.68); }
    #treasure-tracking-overlay .tracking-card { border:2px solid rgba(154,204,255,.66); }
    #treasure-too-slow-overlay .slow-title,
    #treasure-tracking-overlay .tracking-title { font:900 clamp(28px,4.2vw,46px)/1.05 system-ui,sans-serif; }
    #treasure-too-slow-overlay .slow-title { color:#ffe29a; }
    #treasure-tracking-overlay .tracking-title { color:#d8ebff; }
    #treasure-too-slow-overlay .slow-sub,
    #treasure-tracking-overlay .tracking-sub { margin-top:9px; color:#f4f7ff; font:650 clamp(15px,2vw,19px)/1.38 system-ui,sans-serif; }
    #treasure-tracking-overlay .tracking-sub span { display:block; margin-top:4px; color:#bcd0e7; }
  `;
  if (needsShellStyle) document.head.appendChild(style);

  const position = document.getElementById("screen-position");
  if (position) {
    const title = position.querySelector("h2");
    const intro = title?.nextElementSibling;
    if (title) title.textContent = "Camera check";
    if (intro?.tagName === "P") intro.style.display = "none";
    position.querySelectorAll(".camera-performance-reminder").forEach((el) => el.remove());

    const stageSlot = document.getElementById("position-stage-slot");
    if (stageSlot && !document.getElementById("treasure-camera-cue")) {
      const cue = document.createElement("div");
      cue.id = "treasure-camera-cue";
      cue.innerHTML = `
        <div class="camera-hero">
          <div class="camera-copy">
            <div class="camera-title">Raise either hand</div>
            <div class="camera-sub">Show your palm to the camera.</div>
          </div>
          <div class="camera-demo" aria-hidden="true">
            <div class="camera-hand-animation">${palmImageHtml("Right",78,"camera-palm")}</div>
            <div class="camera-check">✓</div>
          </div>
        </div>`;
      stageSlot.before(cue);
    }

    const continueBtn = document.getElementById("btn-position-done");
    if (continueBtn) {
      continueBtn.textContent = "Continue in Full Screen";
      let actions = position.querySelector(".treasure-camera-actions");
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "treasure-camera-actions";
        continueBtn.before(actions);
        actions.appendChild(continueBtn);
      }
      if (!continueBtn.dataset.treasureFullscreenBound) {
        continueBtn.dataset.treasureFullscreenBound = "1";
        continueBtn.addEventListener("click", () => {
          requestTreasureFullscreen();
          try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx && !treasureAudioContext) treasureAudioContext = new AudioCtx();
            if (treasureAudioContext?.state === "suspended") treasureAudioContext.resume().catch(() => {});
          } catch (_) {}
        }, { capture:true });
      }
    }

    const oldHelp = position.querySelector("details.help");
    if (oldHelp && !document.getElementById("treasure-camera-tips")) {
      const tips = document.createElement("div");
      tips.id = "treasure-camera-tips";
      tips.innerHTML = `
        <div class="tip"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2"/></svg><span>Bright room</span></div>
        <div class="tip"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="15" rx="2"/><path d="M7 8h10M7 12h7"/><path d="M17 15l4 4M21 15l-4 4"/></svg><span>Close unnecessary tabs &amp; programs</span></div>
        <div class="tip"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3"/></svg><span>About an arm's length away</span></div>`;
      oldHelp.replaceWith(tips);
    }

    /* Camera preview is the visual center. Keep the same three setup goals,
       but place them as lightweight cues below the preview instead of a sidebar. */
    const cameraTips = document.getElementById("treasure-camera-tips");
    const cameraActions = position.querySelector(".treasure-camera-actions");
    if (stageSlot && cameraTips && !document.getElementById("treasure-camera-mainrow")) {
      const row = document.createElement("div");
      row.id = "treasure-camera-mainrow";
      stageSlot.before(row);
      row.appendChild(stageSlot);
      row.appendChild(cameraTips);
      if (cameraActions) row.appendChild(cameraActions);
    }
  }

  /* The standalone setup-instructions page was redundant with the calibration
     animation. Auto-advance it invisibly so the next participant-facing screen
     is the LEFT-hand static calibration animation. */
  const instructionScreen = document.getElementById("screen-instructions");
  if (instructionScreen && !instructionScreen.dataset.v5184AutoSkipBound) {
    instructionScreen.dataset.v5184AutoSkipBound = "1";
    let autoSkipTimer = null;
    const maybeSkipInstructions = () => {
      if (autoSkipTimer != null) { clearTimeout(autoSkipTimer); autoSkipTimer = null; }
      if (!instructionScreen.classList.contains("visible")) return;
      autoSkipTimer = setTimeout(() => {
        if (!instructionScreen.classList.contains("visible")) return;
        const startBtn = document.getElementById("btn-start");
        if (startBtn) startBtn.click();
      }, 120);
    };
    new MutationObserver(maybeSkipInstructions).observe(instructionScreen, { attributes:true, attributeFilter:["class"] });
    maybeSkipInstructions();
  }

  const posStatus = document.getElementById("position-status");
  if (posStatus) {
    const shortenStatus = () => {
      const t = (posStatus.textContent || "").trim();
      let next = t;
      const cue = document.getElementById("treasure-camera-cue");
      const cueTitle = cue?.querySelector(".camera-title");
      const cueSub = cue?.querySelector(".camera-sub");
      const detected = /Looking good|Looks good/i.test(t);

      if (detected) next = "Looks good!";
      else if (/not visible/i.test(t) || /Looking for/i.test(t)) next = "Raise either hand";
      else if (/Hold still/i.test(t)) next = "Hold still…";

      if (cue) cue.classList.toggle("detected", detected);
      if (cueTitle) cueTitle.textContent = detected ? "Hand detected" : "Raise either hand";
      if (cueSub) cueSub.textContent = detected ? "You're ready to continue." : "Show your palm to the camera.";
      if (next !== t) posStatus.textContent = next;
    };
    new MutationObserver(shortenStatus).observe(posStatus, { childList:true, subtree:true, characterData:true });
    shortenStatus();
  }

  const rest = document.getElementById("screen-rest");
  if (rest) {
    const h2 = rest.querySelector("h2");
    const bodyP = rest.querySelector("p:not(.subtle)");
    const progress = document.getElementById("rest-progress");
    const btn = document.getElementById("btn-next-trial");

    if (!document.getElementById("treasure-rest-art")) {
      const art = document.createElement("div");
      art.id = "treasure-rest-art";
      rest.insertBefore(art, h2);
    }
    if (!document.getElementById("treasure-rest-route")) {
      const route = document.createElement("div");
      route.id = "treasure-rest-route";
      progress?.after(route);
    }
    if (!document.getElementById("treasure-rest-howto")) {
      const howto = document.createElement("div");
      howto.id = "treasure-rest-howto";
      (bodyP || h2)?.after(howto);
    }

    const updateRest = () => {
      if (!progress) return;
      const raw = progress.textContent || "";
      const m = raw.match(/(\d+)\s+of\s+(\d+)/i);
      if (!m) return;
      const done = Number(m[1]);
      const total = Number(m[2]);
      const art = document.getElementById("treasure-rest-art");
      const howto = document.getElementById("treasure-rest-howto");
      if (howto) howto.innerHTML = "";

      const renderHowto = (nextHand) => {
        if (!howto) return;
        howto.innerHTML = `
          <svg class="mini-demo" viewBox="0 0 520 106" aria-hidden="true">
            <defs>
              <linearGradient id="miniChestBody516" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#c97830"/><stop offset=".58" stop-color="#8b4922"/><stop offset="1" stop-color="#4d2918"/></linearGradient>
              <linearGradient id="miniChestLid516" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#e49b47"/><stop offset="1" stop-color="#7b3d1e"/></linearGradient>
              <linearGradient id="miniGem516" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e6f5ff"/><stop offset=".46" stop-color="#72a9ff"/><stop offset="1" stop-color="#4d4ab8"/></linearGradient>
            </defs>
            <g class="mini-how-chest">
              <rect x="42" y="41" width="58" height="34" rx="6" fill="url(#miniChestBody516)" stroke="#efc56b" stroke-width="2.4"/>
              <path d="M42 43 Q47 18 71 18 Q95 18 100 43 Z" fill="url(#miniChestLid516)" stroke="#efc56b" stroke-width="2.4"/>
              <rect x="64" y="49" width="14" height="12" rx="2.5" fill="#ffe49a" stroke="#9c6824" stroke-width="1.6"/>
            </g>
            <g class="mini-how-gem">
              <path d="M432 22 L458 41 L450 79 L414 79 L406 41 Z" fill="url(#miniGem516)" stroke="#f2f8ff" stroke-width="3"/>
            </g>
            <image class="mini-how-hand" href="${OPENMOJI_PALM_URL}" x="43" y="16" width="60" height="70" preserveAspectRatio="xMidYMid meet" style="--hand-flip:${nextHand === "Right" ? -1 : 1};"/>
          </svg>
          <div class="mini-steps">
            <span>Start at the chest</span>
            <span>Move quickly through the gem</span>
            <span>Return to the chest</span>
          </div>`;
      };

      if (done === 1) {
        rest.dataset.treasureRestSec = String(CALIBRATION_INTER_HAND_REST_SEC);
        rest.dataset.transitionKind = "skipCalibration";
        if (h2) h2.textContent = "";
        if (bodyP) bodyP.textContent = "";
        if (art) art.innerHTML = "";
        return;
      }

      /* V4 CUSTOM FLOW: after the two static calibrations, skip all legacy
         single-hand practice / transition cards. Baseline itself is the
         task-specific bimanual dynamic-QC sample. */
      if (done >= 2) {
        if (done >= total) {
          rest.dataset.treasureRestSec = "2";
          rest.dataset.transitionKind = "complete";
          if (h2) h2.textContent = "CHALLENGE COMPLETE!";
          if (bodyP) bodyP.textContent = "";
          if (art) art.innerHTML = "";
        } else {
          rest.dataset.treasureRestSec = "0";
          rest.dataset.transitionKind = "skipCustom";
          if (h2) h2.textContent = "";
          if (bodyP) bodyP.textContent = "";
          if (art) art.innerHTML = "";
          if (howto) howto.innerHTML = "";
        }
        return;
      }

      /* Legacy V5.18.4 single-hand transition cards remain below for reference
         but are unreachable in this bimanual experiment. */
      if (done === 2) {
        rest.dataset.treasureRestSec = "9";
        rest.dataset.transitionKind = "reaching";
        if (h2) h2.textContent = "LEFT HAND PRACTICE";
        if (bodyP) bodyP.textContent = "Move quickly through each gem.";
        if (art) art.innerHTML = "";
        renderHowto("Left");
        return;
      }

      if (done === 3) {
        rest.dataset.treasureRestSec = "6";
        rest.dataset.transitionKind = "reaching";
        if (h2) h2.textContent = "RIGHT HAND PRACTICE";
        if (bodyP) bodyP.textContent = "Move quickly through each gem.";
        if (art) art.innerHTML = "";
        renderHowto("Right");
        return;
      }

      if (done >= 4) {
        /* The V5.18.4 preflight is complete. From here onward this experiment
           intentionally diverges from the single-hand 320 task. */
        if (done === 4 || done === 5 || done === 6 || done === 7 || done === 8) {
          rest.dataset.treasureRestSec = "0";
          rest.dataset.transitionKind = "skipCustom";
          if (h2) h2.textContent = "";
          if (bodyP) bodyP.textContent = "";
          if (art) art.innerHTML = "";
          return;
        }
        if (done === 9) {
          rest.dataset.treasureRestSec = "5";
          rest.dataset.transitionKind = "denovoBreak";
          if (h2) h2.textContent = "Short break";
          if (bodyP) bodyP.textContent = "One more challenge block to go.";
          if (art) art.innerHTML = "";
          return;
        }
        if (done >= 10 || done >= total) {
          rest.dataset.treasureRestSec = "2";
          rest.dataset.transitionKind = "complete";
          if (h2) h2.textContent = "TREASURE HUNT COMPLETE!";
          if (bodyP) bodyP.textContent = "";
          if (art) art.innerHTML = "";
          return;
        }
      }

      if (done === 4) {
        rest.dataset.treasureRestSec = "5";
        rest.dataset.transitionKind = "practiceComplete";
        if (h2) h2.textContent = "PRACTICE COMPLETE!";
        if (bodyP) bodyP.innerHTML = `Ready for the treasure hunt.<br><span style="display:inline-block;margin-top:8px;color:#8fb8ff;font-weight:950;letter-spacing:.07em;">FIRST HALF</span><br><span style="display:inline-block;margin-top:4px;font-weight:850;color:#eaf3ff;">HAND-POSITION DOT ${handPositionDotLegendHtml(24)} HIDDEN</span>`;
        if (art) art.innerHTML = `<svg width="108" height="88" viewBox="0 0 116 100" aria-hidden="true"><path d="M24 48h68v35H24z" fill="#7e421d" stroke="#f0c56c" stroke-width="3"/><path d="M24 48c4-21 16-31 34-31s30 10 34 31H24Z" fill="#bd7130" stroke="#f0c56c" stroke-width="3"/><path d="M42 20v63M74 20v63" stroke="#e8bd62" stroke-width="4"/><rect x="51" y="55" width="14" height="14" rx="3" fill="#ffe69b"/></svg>`;
        return;
      }

      const formalDone = Math.max(0, done - 4);
      const formalTotal = 8;

      if (formalDone === 4) {
        rest.dataset.treasureRestSec = String(MIDPOINT_BREAK_SEC);
        rest.dataset.transitionKind = "midpoint";
        if (h2) h2.textContent = "HALFWAY THERE!";
        if (bodyP) bodyP.innerHTML = `Take a short break.<br><span style="display:inline-block;margin-top:7px;color:#8fb8ff;font-weight:900;letter-spacing:.07em;">SECOND HALF</span><br><span style="display:inline-block;margin-top:3px;font-weight:800;color:#eaf3ff;">The hand-position dot ${handPositionDotLegendHtml(22)} will stay visible.</span>`;
        if (art) art.innerHTML = `<svg width="116" height="100" viewBox="0 0 116 100" aria-hidden="true"><path d="M24 48h68v35H24z" fill="#7e421d" stroke="#f0c56c" stroke-width="3"/><path d="M24 48c4-21 16-31 34-31s30 10 34 31H24Z" fill="#bd7130" stroke="#f0c56c" stroke-width="3"/><path d="M42 20v63M74 20v63" stroke="#e8bd62" stroke-width="4"/><rect x="51" y="55" width="14" height="14" rx="3" fill="#ffe69b"/></svg>`;
        if (!rest.dataset.midpointChimePlayed) {
          rest.dataset.midpointChimePlayed = "1";
          playTreasureChime("midpoint");
        }
        return;
      }

      if (formalDone >= formalTotal || done >= total) {
        rest.dataset.treasureRestSec = "2";
        rest.dataset.transitionKind = "complete";
        if (h2) h2.textContent = "TREASURE HUNT COMPLETE!";
        if (bodyP) bodyP.textContent = "";
        if (art) art.innerHTML = "";
        return;
      }

      const nextFormalIndex = formalDone;
      const nextHand = nextFormalIndex % 2 === 0 ? "Right" : "Left";
      rest.dataset.treasureRestSec = String(FIXED_INTER_BLOCK_REST_SEC);
      rest.dataset.transitionKind = "reaching";
      if (h2) h2.textContent = `${nextHand.toUpperCase()} HAND ONLY`;
      if (bodyP) bodyP.textContent = "Move quickly through each gem.";
      if (art) art.innerHTML = "";
      renderHowto(nextHand);
      if (btn) btn.textContent = "Next";
    };
    rest.treasureUpdateRest = updateRest;
    if (progress) {
      new MutationObserver(updateRest).observe(progress, { childList:true, subtree:true, characterData:true });
      updateRest();
    }
  }

  if (rest && !document.getElementById("treasure-rest-countdown")) {
    const countdown = document.createElement("div");
    countdown.id = "treasure-rest-countdown";
    countdown.innerHTML = `<span class="rest-sec">${FIXED_INTER_BLOCK_REST_SEC}</span><span class="rest-label">SECONDS</span>`;
    const note = document.createElement("div");
    note.id = "treasure-rest-auto-note";
    note.textContent = "The next section starts automatically.";
    (document.getElementById("treasure-rest-route") || document.getElementById("rest-progress"))?.after(countdown, note);
  }

  if (rest && !rest.dataset.fixedCountdownBound) {
    rest.dataset.fixedCountdownBound = "1";
    let timerId = null;
    let activeToken = 0;
    const stopTimer = () => {
      activeToken += 1;
      if (timerId != null) { clearInterval(timerId); timerId = null; }
    };
    const startTimer = () => {
      stopTimer();
      if (!rest.classList.contains("visible")) return;
      if (typeof rest.treasureUpdateRest === "function") rest.treasureUpdateRest();
      const token = activeToken;
      const btn = document.getElementById("btn-next-trial");
      const dial = document.getElementById("treasure-rest-countdown");
      if (rest.dataset.transitionKind === "skipCalibration" || rest.dataset.transitionKind === "skipCustom") {
        if (btn) { btn.disabled = false; setTimeout(() => btn.click(), 0); }
        return;
      }
      const secEl = dial?.querySelector(".rest-sec");
      const started = performance.now();
      const durationSec = Number(rest.dataset.treasureRestSec) || FIXED_INTER_BLOCK_REST_SEC;
      const totalMs = durationSec * 1000;
      if (secEl) secEl.textContent = String(durationSec);
      if (dial) dial.style.setProperty("--rest-pct", "0%");
      if (btn) btn.disabled = true;

      const update = () => {
        if (token !== activeToken || !rest.classList.contains("visible")) { stopTimer(); return; }
        const elapsed = performance.now() - started;
        const remainMs = Math.max(0, totalMs - elapsed);
        if (secEl) secEl.textContent = String(Math.ceil(remainMs / 1000));
        if (dial) dial.style.setProperty("--rest-pct", `${Math.min(100,Math.max(0,(elapsed/totalMs)*100))}%`);
        if (remainMs <= 0) {
          stopTimer();
          if (btn) { btn.disabled = false; btn.click(); }
        }
      };
      update();
      timerId = setInterval(update, 100);
    };
    new MutationObserver(() => {
      if (rest.classList.contains("visible")) startTimer();
      else stopTimer();
    }).observe(rest, { attributes:true, attributeFilter:["class"] });
  }

  if (document.body && !document.getElementById("treasure-too-slow-overlay")) {
    const overlay = document.createElement("div");
    overlay.id = "treasure-too-slow-overlay";
    overlay.innerHTML = `<div class="slow-card"><div class="slow-title">TOO SLOW!</div><div class="slow-sub">Make one quick movement.</div></div>`;
    document.body.appendChild(overlay);
  }

  if (document.body && !document.getElementById("treasure-tracking-overlay")) {
    const overlay = document.createElement("div");
    overlay.id = "treasure-tracking-overlay";
    overlay.innerHTML = `<div class="tracking-card"><div class="tracking-title">HAND NOT DETECTED</div><div class="tracking-sub">Show your palm to the camera.</div></div>`;
    document.body.appendChild(overlay);
  }

  /* Soften the generic early-stop page while keeping the instruction clear.
     The runner owns this screen, so this experiment-level observer only adjusts
     participant-facing copy when that technical-stop message appears. */
  if (document.body && !document.body.dataset.v5184StopCopyBound) {
    document.body.dataset.v5184StopCopyBound = "1";
    const updateTechnicalStopCopy = () => {
      for (const h2 of document.querySelectorAll("h1,h2,h3")) {
        if (/thanks for checking your setup/i.test((h2.textContent || "").trim())) {
          h2.textContent = "Thank you for your time";
        }
      }
      for (const p of document.querySelectorAll("p")) {
        const t = (p.textContent || "").trim();
        if (/hand tracking became too unstable to continue/i.test(t) ||
            /stable enough hand tracking/i.test(t)) {
          p.textContent = "We couldn't get stable enough hand tracking to continue this study reliably. Thank you for trying the setup.";
        }
      }
    };
    new MutationObserver(updateTechnicalStopCopy).observe(document.body, { childList:true, subtree:true, characterData:true });
    updateTechnicalStopCopy();
  }
}

function setTrackingLossOverlay(show, mode = "missing", expectedHand = null) {
  if (typeof document === "undefined") return;
  const overlay = document.getElementById("treasure-tracking-overlay");
  if (!overlay) return;

  if (show) {
    const title = overlay.querySelector(".tracking-title");
    const sub = overlay.querySelector(".tracking-sub");
    if (mode === "wrong") {
      if (title) title.textContent = "WRONG HAND";
      if (sub) sub.innerHTML = `Please use your ${String(expectedHand || "requested").toUpperCase()} hand.<span>Keep the other hand out of the task area.</span>`;
    } else {
      if (title) title.textContent = `${String(expectedHand || "HAND").toUpperCase()} HAND NOT DETECTED`;
      if (sub) sub.textContent = `Show your ${String(expectedHand || "").toLowerCase()} palm to the camera.`;
    }
  }

  const already = overlay.classList.contains("show");
  if (show && !already) overlay.classList.add("show");
  else if (!show && already) overlay.classList.remove("show");
}

let treasureTooSlowTimer = null;

function showDiscoveryAttemptWarning(kind = "too_slow", durationMs = TOO_SLOW_WARNING_MS) {
  if (typeof document === "undefined") return;
  const overlay = document.getElementById("treasure-too-slow-overlay");
  if (!overlay) return;

  const title = overlay.querySelector(".slow-title");
  const sub = overlay.querySelector(".slow-sub");
  if (kind === "try_another_movement") {
    if (title) title.textContent = "TRY ANOTHER MOVEMENT";
    if (sub) sub.textContent = "Try a different movement.";
  } else {
    if (title) title.textContent = "TOO SLOW!";
    if (sub) sub.textContent = "Make one quick movement.";
  }

  overlay.classList.add("show");
  if (treasureTooSlowTimer != null) clearTimeout(treasureTooSlowTimer);
  treasureTooSlowTimer = setTimeout(() => {
    overlay.classList.remove("show");
    treasureTooSlowTimer = null;
  }, durationMs);
}

function showTooSlowWarning(durationMs = TOO_SLOW_WARNING_MS) {
  showDiscoveryAttemptWarning("too_slow", durationMs);
}

function showTryAnotherMovementWarning(durationMs = TOO_SLOW_WARNING_MS) {
  showDiscoveryAttemptWarning("try_another_movement", durationMs);
}

if (typeof document !== "undefined") {
  /* Robust late-DOM integration. The runner can construct or replace its
     camera/setup screen well after the experiment module is evaluated.
     Watch the document for that screen instead of relying on a short retry
     window. Calls are coalesced to one animation frame, and setupTreasureShellUi
     is idempotent. */
  let treasureShellApplyQueued = false;

  const queueTreasureShellApply = () => {
    if (treasureShellApplyQueued) return;
    treasureShellApplyQueued = true;
    const run = () => {
      treasureShellApplyQueued = false;
      setupTreasureShellUi();
    };
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(run);
    } else {
      setTimeout(run, 0);
    }
  };

  const startTreasureShellObserver = () => {
    queueTreasureShellApply();

    const root = document.documentElement || document.body;
    if (!root || typeof MutationObserver === "undefined") return;

    const observer = new MutationObserver((mutations) => {
      let relevant = false;
      for (const mutation of mutations) {
        if (mutation.type === "childList" && (mutation.addedNodes?.length || mutation.removedNodes?.length)) {
          relevant = true;
          break;
        }
        if (mutation.type === "attributes") {
          const target = mutation.target;
          if (target?.id === "screen-position" || target?.id === "position-stage-slot") {
            relevant = true;
            break;
          }
        }
      }
      if (!relevant) return;

      const position = document.getElementById("screen-position");
      if (!position) return;

      /* Reapply if the runner has just created/replaced the camera DOM or if
         any piece of our custom shell is missing. */
      if (
        !document.getElementById("treasure-camera-cue") ||
        !document.getElementById("treasure-camera-mainrow") ||
        !document.getElementById("treasure-camera-tips") ||
        !position.querySelector(".treasure-camera-actions")
      ) {
        queueTreasureShellApply();
      }
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "id"]
    });

    /* Keep a reference for debugging and to prevent accidental GC in unusual
       embedded runners. */
    if (typeof window !== "undefined") window.__treasureShellObserver = observer;
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startTreasureShellObserver, { once:true });
  } else {
    startTreasureShellObserver();
  }
}


/* ============================================================
 * VIEWPORT-FIT STAGE
 * ============================================================
 */

function ensureResponsiveStage() {
  const STYLE_ID = "single-hand-baseline-stage-v5-14-treasure";
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;

  style.textContent = `
    body:has(#screen-trial.visible) {
      overflow-x: hidden;
      overflow-y: hidden;
    }

    body:has(#screen-trial.visible) main {
      width: min(96vw, calc((100dvh - 180px) * 4 / 3));
      max-width: none;
      margin-left: auto;
      margin-right: auto;
      padding-left: 0;
      padding-right: 0;
    }

    body:has(#screen-trial.visible) #screen-trial,
    body:has(#screen-trial.visible) #trial-stage-slot,
    body:has(#screen-trial.visible) #stage {
      width: 100%;
      max-width: none;
    }

    body:has(#screen-trial.visible) #trial-prompt {
      margin-top: 6px;
      margin-bottom: 8px;
      line-height: 1.35;
    }

    body.treasure-reaching-active #trial-prompt,
    body.treasure-reaching-active #screen-trial > .progress,
    body.treasure-reaching-active #trial-timer,
    body.treasure-reaching-active #countdown,
    body.treasure-calibration-active #trial-prompt,
    body.treasure-calibration-active #screen-trial > .progress,
    body.treasure-calibration-active #trial-timer,
    body.treasure-calibration-active #countdown {
      display: none !important;
    }

    body.treasure-reaching-active main,
    body.treasure-calibration-active main {
      width: min(97vw, calc((100dvh - 52px) * 4 / 3));
      padding-top: 16px;
    }

    body.treasure-reaching-active #stage,
    body.treasure-calibration-active #stage {
      margin-top: 4px;
      border-radius: 18px;
      box-shadow: 0 18px 54px rgba(0,0,0,.28);
    }
  `;

  document.head.appendChild(style);
}


function fitStageToViewport() {
  const screenTrial = document.getElementById("screen-trial");
  if (!screenTrial || !screenTrial.classList.contains("visible")) return;

  const stage = document.getElementById("stage");
  const main = document.querySelector("main");
  if (!stage || !main) return;

  const stageTop = stage.getBoundingClientRect().top;
  const availableHeight = Math.max(280, window.innerHeight - stageTop - 10);
  const widthFromHeight = availableHeight * (4 / 3);
  const widthFromViewport = window.innerWidth * 0.96;
  const fittedWidth = Math.floor(Math.min(widthFromHeight, widthFromViewport));

  main.style.width = `${fittedWidth}px`;
}


/* ============================================================
 * TRIAL DEFINITIONS
 * ============================================================
 */

function isReachingTrial(trial) {
  return trial?.kind === "baseline_reaching" || trial?.kind === "practice_reaching";
}

function reachesRequiredForTrial(trial) {
  return trial?.kind === "practice_reaching" ? PRACTICE_REACHES_PER_HAND : REACHES_PER_BLOCK;
}

function reachingTrial(id, hand, feedback, repetition) {
  return {
    id,
    kind: "baseline_reaching",
    hand,
    feedback,
    repetition,
    practice: false,
    showCamera: false,
    durationSec: REACH_BLOCK_MAX_SEC,
    countdownSec: 0,
    prompt:
      `${hand.toUpperCase()} HAND · ${feedback ? "HAND-POSITION DOT VISIBLE" : "HAND-POSITION DOT HIDDEN"}`,
  };
}

function practiceTrial(id, hand) {
  return {
    id,
    kind: "practice_reaching",
    hand,
    feedback: false,
    repetition: 0,
    practice: true,
    showCamera: false,
    durationSec: PRACTICE_BLOCK_MAX_SEC,
    countdownSec: 0,
    prompt: `${hand.toUpperCase()} HAND · PRACTICE`,
  };
}


/* ============================================================
 * BIMANUAL BASELINE -> DE NOVO DISCOVERY -> AFTEREFFECT PROBE V19-10 FULL
 * TWO-DIRECTION / LIVE-FEEDBACK DISCOVERY VERSION
 *
 * Experimental flow:
 * - Pre baseline: 40 reaches (UP-LEFT / DOWN-RIGHT; 20 each).
 * - Mystery-zone comprehension check (4 yes/no questions).
 * - De novo discovery: 100 reaches total, split 50 + 50 by a short break.
 *   Each 50-reach block contains 25 UP-LEFT and 25 DOWN-RIGHT reaches.
 * - Post-baseline aftereffect probe: 20 NO-FEEDBACK reaches (10 each), with no motor demonstration.
 * - Final explicit probe of the learned hand-to-cursor component rules.
 *
 * V19-10 discovery + matched baseline feedback:
 * - During planning, the cursor is locked at the treasure-chest center.
 * - Once the outbound movement is committed, the mapped cursor is visible live.
 * - The attempt ends at the first r = 0.70 crossing or a 600-ms movement deadline.
 * - At the first radius crossing, live feedback stops and the crossing ANGLE is
 *   projected to the fixed target radius and frozen for 500 ms (angular feedback).
 * - If the deadline expires first, the attempt stops and a TOO SLOW warning appears.
 *
 * The 600-ms value is a pilot parameter intended to discourage deliberate online
 * corrections while still providing movement-contingent visual information.
 * ============================================================ */

const BIM_BASELINE_REACHES = 40;
const BIM_POST_BASELINE_REACHES = 20;
const BIM_DENOVO_BLOCKS = 2;
const BIM_DENOVO_REACHES_PER_BLOCK = 50;
const BIM_TWO_DIRECTION_POOL = ["upLeft", "downRight"];
const BIM_TARGET_DEADLINE_MS = 3000; // Baseline only.
const BIM_DISCOVERY_MOVEMENT_WINDOW_MS = 600;
const BIM_DISCOVERY_ONSET_DISPLACEMENT = 0.08;
const BIM_DISCOVERY_ONSET_CONFIRM_FRAMES = 2;
const BIM_DISCOVERY_LAUNCH_DISPLACEMENT = 0.12;
const BIM_DISCOVERY_LAUNCH_CONFIRM_FRAMES = 3;
const BIM_DISCOVERY_LAUNCH_REVERSAL_TOLERANCE = 0.012;
/* A mapped cursor excursion smaller than the ordinary cursor-onset radius is
   treated as "no cursor effect" rather than evidence about movement direction. */
const BIM_DISCOVERY_CURSOR_EFFECT_RADIUS = MOVEMENT_ONSET_RADIUS;
const BIM_DISCOVERY_ENDPOINT_FEEDBACK_MS = 500; // Frozen angular endpoint, matching single-hand FB.
const BIM_EARLY_HEADING_MS = 100;
const BIM_COLLECT_SPARKLE_MS = 360;
const BIM_HOME_FADE_MS = 240;

function shuffleInPlace(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function makeBimanualTargetSequence(reachesRequired) {
  const n = Math.max(1, Number(reachesRequired) || 1);
  const sequence = [];
  const full = Math.floor(n / DIRECTION_ORDER.length);
  const remainder = n % DIRECTION_ORDER.length;
  for (let r = 0; r < full; r++) sequence.push(...DIRECTION_ORDER);
  if (remainder > 0) sequence.push(...shuffleInPlace([...DIRECTION_ORDER]).slice(0, remainder));
  return shuffleInPlace(sequence);
}

function makeBimanualTargetSequenceFromPool(reachesRequired, pool, maxRun = 3) {
  const n = Math.max(1, Number(reachesRequired) || 1);
  const cleanPool = Array.isArray(pool) && pool.length ? [...pool] : [...DIRECTION_ORDER];

  /* For the two-direction experiment, keep exact exposure balanced while avoiding
     the AB/BA predictability created by two-item mini-cycles. Build the exact
     counts first, then shuffle until no direction repeats more than maxRun times. */
  if (cleanPool.length === 2) {
    const base = Math.floor(n / 2);
    const counts = [base, base];
    if (n % 2) counts[Math.floor(Math.random() * 2)] += 1;
    const poolList = [
      ...Array(counts[0]).fill(cleanPool[0]),
      ...Array(counts[1]).fill(cleanPool[1]),
    ];

    const validRunStructure = (seq) => {
      let run = 1;
      for (let i = 1; i < seq.length; i++) {
        run = seq[i] === seq[i-1] ? run + 1 : 1;
        if (run > maxRun) return false;
      }
      return true;
    };

    for (let attempt = 0; attempt < 5000; attempt++) {
      const candidate = shuffleInPlace([...poolList]);
      if (validRunStructure(candidate)) return candidate;
    }

    /* Extremely unlikely fallback: balanced alternating order still preserves
       exact counts and respects the run-length constraint. */
    const fallback = [];
    let a = counts[0], b = counts[1];
    let next = Math.random() < .5 ? 0 : 1;
    while (a > 0 || b > 0) {
      if ((next === 0 && a === 0) || (next === 1 && b === 0)) next = 1-next;
      fallback.push(cleanPool[next]);
      if (next === 0) a -= 1; else b -= 1;
      next = 1-next;
    }
    return fallback;
  }

  const sequence = [];
  while (sequence.length < n) {
    sequence.push(...shuffleInPlace([...cleanPool]).slice(0, n - sequence.length));
  }
  return sequence;
}

function bimanualCursor(mapping, left, right) {
  if (mapping === 'baseline') {
    return {
      x: (left.x + right.x) / 2,
      y: (left.y + right.y) / 2,
    };
  }

  /* Sequential De Novo teaching mappings.
       LEFT up      -> cursor right
       LEFT down    -> cursor left
       RIGHT left   -> cursor up
       RIGHT right  -> cursor down
     The single-hand training mappings expose only one cursor axis so the
     participant can learn each component rule before combining them. */
  if (mapping === 'denovo_left_training') {
    return { x: -left.y, y: 0 };
  }
  if (mapping === 'denovo_right_training') {
    return { x: 0, y: right.x };
  }
  return {
    x: -left.y,
    y: right.x,
  };
}

function bimanualInstructionTrial(id, page) {
  return {
    id,
    kind: 'bimanual_instruction',
    page,
    showCamera: false,
    durationSec: 600,
    countdownSec: 0,
    prompt: '',
  };
}

function bimanualQuizTrial() {
  return {
    id: 'denovo_rule_check',
    kind: 'denovo_quiz',
    showCamera: false,
    durationSec: 600,
    countdownSec: 0,
    prompt: '',
  };
}

function bimanualExplicitProbeTrial() {
  return {
    id: 'denovo_explicit_rule_probe',
    kind: 'denovo_explicit_probe',
    showCamera: false,
    durationSec: 600,
    countdownSec: 0,
    prompt: '',
  };
}

function bimanualReachingTrial(id, mapping, reachesRequired, blockIndex = 0, options = {}) {
  return {
    id,
    kind: 'bimanual_reaching',
    mapping,
    reachesRequired,
    blockIndex,
    targetPool: Array.isArray(options.targetPool) ? [...options.targetPool] : null,
    training: options.training === true,
    noSpeedLimit: options.noSpeedLimit === true,
    singleAttempt: options.singleAttempt === true,
    noFeedback: options.noFeedback === true,
    movementWindowMs: Number.isFinite(options.movementWindowMs) ? options.movementWindowMs : null,
    inactiveHand: options.inactiveHand ?? null,
    showCamera: false,
    durationSec: options.durationSec ?? (options.noSpeedLimit ? 900 : 300),
    countdownSec: 0,
    prompt: '',
  };
}

let bimanualInstructionRafs = new Set();

function stopBimanualInstructionAnimations() {
  for (const id of bimanualInstructionRafs) cancelAnimationFrame(id);
  bimanualInstructionRafs.clear();
}

function removeBimanualOverlay() {
  stopBimanualInstructionAnimations();
  document.getElementById('bim-instruction-overlay')?.remove();
}

function ensureBimanualStyles() {
  if (document.getElementById('bim-centerout-v5-styles')) return;
  const style = document.createElement('style');
  style.id = 'bim-centerout-v5-styles';
  style.textContent = `
    #bim-instruction-overlay {
      position:fixed; inset:0; z-index:100050; overflow:auto;
      display:flex; align-items:center; justify-content:center;
      padding:10px; box-sizing:border-box;
      background:radial-gradient(circle at 50% 34%,#17315c 0,#09162e 58%,#050d1e 100%);
      color:#f7f9ff; font-family:system-ui,-apple-system,Segoe UI,sans-serif;
    }
    #bim-instruction-overlay .bim-panel {
      width:min(1520px,96vw); box-sizing:border-box;
      border:1px solid rgba(190,220,255,.18); border-radius:30px;
      background:rgba(8,20,43,.96); box-shadow:0 26px 76px rgba(0,0,0,.42);
      padding:30px 36px 32px;
    }
    #bim-instruction-overlay .bim-panel.bim-denovo-panel {
      width:min(1720px,97vw);
      min-height:min(92vh,980px);
      display:flex; flex-direction:column; justify-content:center;
      padding:30px 36px 32px;
    }
    #bim-instruction-overlay h2 {
      margin:0 0 8px; text-align:center;
      font:900 clamp(2.6rem,5.4vw,4.35rem)/1.02 system-ui,sans-serif;
      letter-spacing:.01em;
    }
    #bim-instruction-overlay .bim-sub {
      text-align:center; color:#d4e1f1;
      font:800 clamp(1.28rem,2.25vw,1.72rem)/1.32 system-ui,sans-serif;
      margin:2px auto 24px;
    }
    #bim-instruction-overlay .bim-baseline-canvas {
      width:min(1220px,100%); aspect-ratio:16/8; display:block;
      margin:4px auto 13px; border-radius:22px;
      border:1px solid rgba(178,214,255,.16);
      box-shadow:0 18px 45px rgba(0,0,0,.26); background:#07152e;
    }
    #bim-instruction-overlay .bim-line {
      margin:12px auto 22px; text-align:center;
      color:#f7faff; font:850 clamp(1.16rem,2.25vw,1.52rem)/1.3 system-ui,sans-serif;
    }
    #bim-instruction-overlay .bim-main-button,
    #bim-instruction-overlay .bim-secondary-button,
    #bim-instruction-overlay .bim-option,
    #bim-instruction-overlay .bim-replay {
      appearance:none; border:1px solid rgba(189,219,255,.26);
      color:#f8fbff; background:#15325e; border-radius:14px;
      font:800 16px/1.2 system-ui,sans-serif; cursor:pointer;
      transition:transform .12s ease, background .12s ease, border-color .12s ease;
    }
    #bim-instruction-overlay button:hover { background:#1c447e; border-color:rgba(197,226,255,.46); }
    #bim-instruction-overlay button:active { transform:translateY(1px); }
    #bim-instruction-overlay .bim-main-button {
      min-width:230px; padding:16px 34px; display:block; margin:0 auto;
      background:#2256a0; font-size:20px;
    }
    #bim-instruction-overlay .bim-demo-grid {
      display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:24px;
      margin:18px 0 14px; align-items:stretch;
    }
    #bim-instruction-overlay .bim-denovo-panel .bim-demo-grid {
      flex:1; min-height:0;
    }
    #bim-instruction-overlay .bim-demo-card {
      min-width:0; display:flex; flex-direction:column;
      background:rgba(255,255,255,.030); border:1px solid rgba(188,219,255,.09);
      border-radius:22px; padding:14px 14px 16px; text-align:center;
      min-height:min(60vh,640px);
      box-shadow:0 14px 34px rgba(0,0,0,.16);
    }
    #bim-instruction-overlay .bim-demo-title {
      margin:2px 0 12px; color:#e7f1ff; font:900 clamp(1.18rem,1.65vw,1.48rem)/1.08 system-ui,sans-serif;
      letter-spacing:.045em;
    }
    #bim-instruction-overlay .bim-demo-canvas {
      display:block; width:100%; aspect-ratio:.90/1; min-height:min(52vh,590px); border-radius:17px;
      border:0; background:#07152e; box-shadow:inset 0 0 0 1px rgba(177,211,255,.055);
    }
    #bim-instruction-overlay .bim-replay {
      padding:9px 15px; margin-top:9px; font-size:14px; background:#112b51;
    }
    #bim-instruction-overlay .bim-quiz-grid {
      display:grid; gap:13px; margin:15px auto 17px; max-width:900px;
    }
    #bim-instruction-overlay .bim-question-card {
      border:1px solid rgba(185,218,255,.14); border-radius:18px;
      background:rgba(255,255,255,.035); padding:15px 16px 16px;
    }
    #bim-instruction-overlay .bim-question {
      color:#f7faff; font:850 clamp(1rem,1.9vw,1.16rem)/1.35 system-ui,sans-serif;
      margin-bottom:10px;
    }
    #bim-instruction-overlay .bim-options {
      display:grid; grid-template-columns:1fr 1fr; gap:9px;
    }
    #bim-instruction-overlay .bim-option { padding:11px 12px; text-align:left; background:#10294f; }
    #bim-instruction-overlay .bim-option.selected { background:#23549a; border-color:#9dc9ff; box-shadow:0 0 0 2px rgba(127,186,255,.12) inset; }
    #bim-instruction-overlay .bim-option.incorrect { border-color:#ffbe79; background:#5a3824; }
    #bim-instruction-overlay .bim-option.correct { border-color:#8ee5b9; background:#214c3c; }
    #bim-instruction-overlay .bim-quiz-feedback {
      min-height:26px; text-align:center; color:#ffd690;
      font:850 16px/1.35 system-ui,sans-serif; margin:6px 0 10px;
    }

    #bim-instruction-overlay .bim-rule-panel {
      width:min(1180px,94vw);
      padding:28px 34px 30px;
    }
    #bim-instruction-overlay .bim-rule-canvas {
      width:min(1080px,100%); aspect-ratio:16/7.3; display:block;
      margin:14px auto 16px; border-radius:22px; border:0;
      background:#07152e; box-shadow:inset 0 0 0 1px rgba(177,211,255,.065),0 18px 42px rgba(0,0,0,.22);
    }
    #bim-instruction-overlay .bim-rule-lines {
      display:grid; grid-template-columns:1fr 1fr; gap:12px;
      width:min(900px,100%); margin:0 auto 12px;
    }
    #bim-instruction-overlay .bim-rule-line {
      display:flex; align-items:center; justify-content:center; min-height:54px;
      padding:10px 15px; border-radius:15px; text-align:center;
      background:rgba(109,157,224,.075); border:1px solid rgba(161,201,255,.13);
      color:#f2f7ff; font:900 clamp(1.02rem,1.55vw,1.24rem)/1.22 system-ui,sans-serif;
    }
    #bim-instruction-overlay .bim-training-note {
      width:min(900px,100%); margin:5px auto 17px; padding:10px 15px;
      text-align:center; border-radius:14px;
      color:#ffe7a8; background:rgba(255,212,104,.065); border:1px solid rgba(255,222,139,.15);
      font:850 clamp(.98rem,1.35vw,1.12rem)/1.25 system-ui,sans-serif;
    }
    #bim-instruction-overlay .bim-transition-panel {
      width:100%; max-width:none; min-height:100vh; box-sizing:border-box;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      text-align:center; padding:42px 28px 46px; border:0; border-radius:0;
      background:transparent; box-shadow:none;
    }
    #bim-instruction-overlay .bim-transition-panel h2 {
      font-size:clamp(3.6rem,7.2vw,6.8rem); margin:0 0 12px;
      text-shadow:0 10px 32px rgba(0,0,0,.28);
    }
    #bim-instruction-overlay .bim-transition-panel .bim-sub {
      margin:0 auto 8px; font-size:clamp(1.45rem,2.45vw,2rem);
      color:#edf4ff;
    }
    #bim-instruction-overlay .bim-transition-panel .bim-hidden-rule {
      margin:2px auto 12px; color:#f7faff;
      font:900 clamp(1.30rem,2.10vw,1.78rem)/1.3 system-ui,sans-serif;
    }
    #bim-instruction-overlay .bim-transition-canvas {
      width:min(940px,88vw); aspect-ratio:3.3/1; display:block;
      margin:4px auto 18px; border:0; border-radius:28px;
      background:rgba(5,16,38,.20);
    }
    #bim-instruction-overlay .bim-transition-prompt {
      margin:2px auto 24px; color:#f6f9ff;
      font:850 clamp(1.25rem,2vw,1.65rem)/1.28 system-ui,sans-serif;
    }
    #bim-instruction-overlay .bim-transition-panel .bim-main-button {
      min-width:250px; padding:17px 38px; font-size:21px;
    }
    #bim-instruction-overlay .bim-warning-wrap {
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      gap:8px; margin:2px auto 14px;
    }
    #bim-instruction-overlay .bim-warning-icon {
      width:clamp(70px,7.5vw,112px); height:auto; display:block;
      filter:drop-shadow(0 0 18px rgba(255,72,72,.28));
      animation:bimWarningPulse 1.05s ease-in-out infinite, bimWarningShake 2.4s ease-in-out infinite;
      transform-origin:center;
    }
    #bim-instruction-overlay .bim-warning-text {
      color:#fff0f0;
      font:900 clamp(1.32rem,2.25vw,1.9rem)/1.25 system-ui,sans-serif;
      letter-spacing:.005em;
    }
    @keyframes bimWarningPulse {
      0%,100% { transform:scale(1); filter:drop-shadow(0 0 12px rgba(255,72,72,.22)); }
      50% { transform:scale(1.075); filter:drop-shadow(0 0 28px rgba(255,72,72,.48)); }
    }
    @keyframes bimWarningShake {
      0%,82%,100% { translate:0 0; rotate:0deg; }
      86% { translate:-3px 0; rotate:-2deg; }
      90% { translate:3px 0; rotate:2deg; }
      94% { translate:-2px 0; rotate:-1.5deg; }
      98% { translate:2px 0; rotate:1.5deg; }
    }
    #bim-instruction-overlay .bim-transition-copy {
      width:min(980px,92vw); margin:0 auto 22px; display:grid; gap:7px;
      color:#f7faff;
      font:800 clamp(1.18rem,1.85vw,1.52rem)/1.28 system-ui,sans-serif;
    }
    #bim-instruction-overlay .bim-transition-copy strong { color:inherit; font-weight:950; }
    #bim-instruction-overlay .bim-reveal-line {
      opacity:0; transform:translateY(9px);
      animation:bimRevealLine .42s cubic-bezier(.22,.75,.28,1) forwards;
      animation-delay:var(--reveal-delay,0s);
    }
    #bim-instruction-overlay .bim-reveal-question {
      margin-top:7px; font-size:1.08em;
    }
    #bim-instruction-overlay .bim-reveal-button {
      opacity:0; transform:translateY(7px); visibility:hidden;
      animation:bimRevealButton .38s ease-out forwards;
      animation-delay:12.35s;
    }
    @keyframes bimRevealLine {
      from { opacity:0; transform:translateY(9px); }
      to { opacity:1; transform:translateY(0); }
    }
    @keyframes bimRevealButton {
      0% { opacity:0; transform:translateY(7px); visibility:visible; }
      100% { opacity:1; transform:translateY(0); visibility:visible; }
    }
    #bim-instruction-overlay .bim-restore-panel {
      width:min(1380px,96vw); padding:34px 38px 36px;
      display:flex; flex-direction:column; align-items:center;
    }
    #bim-instruction-overlay .bim-restore-panel h2 {
      font-size:clamp(3.5rem,6.7vw,6.2rem); margin-bottom:10px;
    }
    #bim-instruction-overlay .bim-restore-panel .bim-restore-sub {
      text-align:center; color:#f7faff;
      font:900 clamp(1.55rem,2.65vw,2.15rem)/1.25 system-ui,sans-serif;
      margin:0 auto 17px;
    }
    #bim-instruction-overlay .bim-restore-panel .bim-baseline-canvas {
      width:min(1220px,94vw); margin:4px auto 16px;
    }
    #bim-instruction-overlay .bim-restore-panel .bim-line {
      font-size:clamp(1.38rem,2.35vw,1.9rem); margin:10px auto 24px;
    }
    #bim-instruction-overlay .bim-visual-quiz-grid {
      display:grid; grid-template-columns:1fr 1fr; gap:18px; width:min(1080px,100%); margin:16px auto 18px;
    }
    #bim-instruction-overlay .bim-visual-question {
      border:1px solid rgba(185,218,255,.13); border-radius:20px;
      background:rgba(255,255,255,.032); padding:15px;
    }
    #bim-instruction-overlay .bim-quiz-target-canvas {
      width:100%; aspect-ratio:16/6.8; display:block; border-radius:15px;
      background:#07152e; box-shadow:inset 0 0 0 1px rgba(177,211,255,.055);
      margin-bottom:12px;
    }
    #bim-instruction-overlay .bim-visual-question .bim-question {
      text-align:center; font-size:clamp(1rem,1.45vw,1.17rem); margin-bottom:11px;
    }
    #bim-instruction-overlay .bim-visual-question .bim-options { grid-template-columns:1fr; }
    #bim-instruction-overlay .bim-speed-line {
      text-align:center; color:#fff1b3; font:900 clamp(1.25rem,2.1vw,1.65rem)/1.3 system-ui,sans-serif;
      margin:18px auto 26px;
    }
    @media (max-width:900px) {
      #bim-instruction-overlay { padding:12px; align-items:flex-start; }
      #bim-instruction-overlay .bim-panel { padding:20px 16px 22px; }
      #bim-instruction-overlay .bim-demo-grid { grid-template-columns:1fr; }
      #bim-instruction-overlay .bim-demo-canvas { max-height:300px; }
      #bim-instruction-overlay .bim-options { grid-template-columns:1fr; }
      #bim-instruction-overlay .bim-rule-lines, #bim-instruction-overlay .bim-visual-quiz-grid { grid-template-columns:1fr; }
    }
  `;
  document.head.appendChild(style);
}

function setBimanualTrackingOverlay(show, missingHand = "Both") {
  if (typeof document === 'undefined') return;
  const overlay = document.getElementById('treasure-tracking-overlay');
  if (!overlay) return;
  if (show) {
    const title = overlay.querySelector('.tracking-title');
    const sub = overlay.querySelector('.tracking-sub');
    if (missingHand === 'Left') {
      if (title) title.textContent = 'LEFT HAND NOT DETECTED';
      if (sub) sub.textContent = 'Show your left palm to the camera.';
    } else if (missingHand === 'Right') {
      if (title) title.textContent = 'RIGHT HAND NOT DETECTED';
      if (sub) sub.textContent = 'Show your right palm to the camera.';
    } else {
      if (title) title.textContent = 'HANDS NOT DETECTED';
      if (sub) sub.textContent = 'Show both palms to the camera.';
    }
    overlay.classList.add('show');
  } else {
    overlay.classList.remove('show');
  }
}

function demoEase01(x) {
  x = clamp(x, 0, 1);
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

function fitInstructionCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(320, Math.round(rect.width * dpr));
  const h = Math.max(210, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { W:w, H:h };
}

function drawMotionArrow(ctx, x1, y1, x2, y2, color = "rgba(211,232,255,.94)", alpha = 1) {
  const dx=x2-x1, dy=y2-y1;
  const len=Math.hypot(dx,dy);
  if (!(len>2)) return;
  const ux=dx/len, uy=dy/len;
  const head=Math.min(18,Math.max(10,len*.16));
  const wing=head*.52;
  ctx.save();
  ctx.globalAlpha=clamp(alpha,0,1);
  ctx.strokeStyle=color;
  ctx.fillStyle=color;
  ctx.lineWidth=Math.max(3,Math.min(6,len*.045));
  ctx.lineCap='round';
  ctx.shadowBlur=10;
  ctx.shadowColor=color;
  ctx.beginPath();
  ctx.moveTo(x1,y1);
  ctx.lineTo(x2-ux*head*.75,y2-uy*head*.75);
  ctx.stroke();
  const bx=x2-ux*head, by=y2-uy*head;
  ctx.beginPath();
  ctx.moveTo(x2,y2);
  ctx.lineTo(bx-uy*wing,by+ux*wing);
  ctx.lineTo(bx+uy*wing,by-ux*wing);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBaselineInstructionDemo(canvas, nowMs) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const {W,H} = fitInstructionCanvas(canvas);
  const started = Number(canvas.__demoStartMs) || nowMs;
  const cycle = 7000;
  const local = ((nowMs - started) % cycle + cycle) % cycle;
  ctx.clearRect(0,0,W,H);
  drawTreasureBackground(ctx,W,H);

  const scale=Math.min(W,H);
  const chestX=W*.50, chestY=H*.52;
  let segLocal=local;
  let kind='upLeft';
  if (local >= 3400) { kind='downRight'; segLocal=local-3400; }
  const moveStart=520;
  const moveEnd=2450;
  const q=demoEase01(clamp((segLocal-moveStart)/(moveEnd-moveStart),0,1));
  const sparklePct=clamp((segLocal-2450)/520,0,1);

  const left0={x:W*.35,y:H*.52};
  const right0={x:W*.65,y:H*.52};
  const cursor0={x:chestX,y:chestY};
  let dx=-W*.20,dy=-H*.30;
  let gemX=W*.30,gemY=H*.22;
  let style=2;
  if (kind==='downRight') {
    dx=W*.20; dy=H*.30;
    gemX=W*.70; gemY=H*.82;
    style=4;
  }

  const chestAlpha=1-clamp((segLocal-moveStart)/280,0,1);
  if (chestAlpha>0) {
    ctx.save();
    ctx.globalAlpha=chestAlpha;
    drawTreasureChest(ctx,chestX,chestY,scale*.070,false,nowMs,false,0);
    ctx.restore();
  }
  drawGem(ctx,gemX,gemY,scale*.041,style,nowMs);
  drawOpenSourcePalm(ctx,left0.x+dx*q,left0.y+dy*q,scale*.155,'Left',.99);
  drawOpenSourcePalm(ctx,right0.x+dx*q,right0.y+dy*q,scale*.155,'Right',.99);
  drawTreasureCompassCursor(ctx,cursor0.x+dx*q,cursor0.y+dy*q);
  if (sparklePct>0 && sparklePct<1) drawCollectSparkle(ctx,gemX,gemY,sparklePct*GEM_SPARKLE_MS);
}

function drawRuleSplitBackground(ctx, W, H) {
  const padX = W * 0.045;
  const padY = H * 0.08;
  const gap = W * 0.035;
  const halfW = (W - padX*2 - gap) / 2;
  const r = Math.min(W,H) * 0.045;

  ctx.save();
  for (let i=0;i<2;i++) {
    const x = padX + i*(halfW+gap);
    const g = ctx.createLinearGradient(0,padY,0,H-padY);
    g.addColorStop(0,'rgba(51,91,153,.16)');
    g.addColorStop(1,'rgba(12,31,65,.26)');
    ctx.fillStyle = g;
    ctx.strokeStyle = 'rgba(170,207,255,.10)';
    ctx.lineWidth = Math.max(1.1,Math.min(W,H)*.0024);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x,padY,halfW,H-padY*2,r);
    else ctx.rect(x,padY,halfW,H-padY*2);
    ctx.fill(); ctx.stroke();
  }

  ctx.textAlign='center';
  ctx.textBaseline='middle';
  ctx.fillStyle='rgba(220,235,255,.72)';
  ctx.font=`850 ${Math.round(Math.min(W,H)*.046)}px system-ui,sans-serif`;
  ctx.fillText('HAND',padX+halfW/2,padY+H*.045);
  ctx.fillText('CURSOR',padX+halfW+gap+halfW/2,padY+H*.045);

  // A subtle causal connector between the two panels.
  const y=H*.50;
  const x1=padX+halfW+gap*.18;
  const x2=padX+halfW+gap*.82;
  drawMotionArrow(ctx,x1,y,x2,y,'rgba(187,216,255,.38)',1);
  ctx.restore();

  return {
    left:{x:padX,y:padY,w:halfW,h:H-padY*2},
    right:{x:padX+halfW+gap,y:padY,w:halfW,h:H-padY*2},
  };
}

function drawDenovoInstructionDemo(canvas, mode, nowMs) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const {W,H} = fitInstructionCanvas(canvas);
  const start = Number(canvas.__demoStartMs) || nowMs;
  const cycle = 5600;
  const local = ((nowMs-start)%cycle+cycle)%cycle;
  const seg = local < cycle/2 ? 0 : 1;
  const segT = seg===0 ? local : local-cycle/2;

  ctx.clearRect(0,0,W,H);
  drawTreasureBackground(ctx,W,H);
  const areas = drawRuleSplitBackground(ctx,W,H);
  const L=areas.left, R=areas.right;
  const scale=Math.min(W,H);

  const moveQ=demoEase01(clamp((segT-430)/1100,0,1));
  const arrowAlpha=clamp((segT-430)/180,0,1)*(1-clamp((segT-1580)/260,0,1));
  const sparklePct=clamp((segT-1600)/500,0,1);

  // Right panel: every cursor movement begins from the exact chest center.
  const chest={x:R.x+R.w*.50,y:R.y+R.h*.56};
  let gem={x:R.x+R.w*.78,y:chest.y};
  let style=0;

  // Left panel: active hand(s) only. No ghost/inactive hand is shown.
  let left0={x:L.x+L.w*.50,y:L.y+L.h*.61};
  let left1={...left0};
  let right0={x:L.x+L.w*.50,y:L.y+L.h*.61};
  let right1={...right0};
  let drawLeft=false, drawRight=false;

  if (mode==='left') {
    drawLeft=true;
    if (seg===0) {
      left1={x:left0.x,y:left0.y-L.h*.23};           // hand UP
      gem={x:R.x+R.w*.78,y:chest.y};                // cursor RIGHT
      style=0;
    } else {
      left1={x:left0.x,y:left0.y+L.h*.23};           // hand DOWN
      gem={x:R.x+R.w*.22,y:chest.y};                // cursor LEFT
      style=1;
    }
  } else if (mode==='right') {
    drawRight=true;
    if (seg===0) {
      right1={x:right0.x-L.w*.23,y:right0.y};        // hand LEFT
      gem={x:chest.x,y:R.y+R.h*.25};                 // cursor UP
      style=2;
    } else {
      right1={x:right0.x+L.w*.23,y:right0.y};        // hand RIGHT
      gem={x:chest.x,y:R.y+R.h*.84};                 // cursor DOWN
      style=4;
    }
  } else {
    drawLeft=true; drawRight=true;
    left0={x:L.x+L.w*.36,y:L.y+L.h*.62};
    right0={x:L.x+L.w*.66,y:L.y+L.h*.62};
    if (seg===0) {
      left1={x:left0.x,y:left0.y-L.h*.20};           // left UP
      right1={x:right0.x-L.w*.16,y:right0.y};        // right LEFT
      gem={x:R.x+R.w*.76,y:R.y+R.h*.27};             // cursor UP-RIGHT
      style=3;
    } else {
      left1={x:left0.x,y:left0.y+L.h*.20};           // left DOWN
      right1={x:right0.x+L.w*.16,y:right0.y};        // right RIGHT
      gem={x:R.x+R.w*.24,y:R.y+R.h*.82};             // cursor DOWN-LEFT
      style=1;
    }
  }

  // HAND side: arrow and actual palm move simultaneously.
  const palmSize=scale*.145;
  if (drawLeft) {
    const lx=left0.x+(left1.x-left0.x)*moveQ;
    const ly=left0.y+(left1.y-left0.y)*moveQ;
    drawMotionArrow(ctx,left0.x+scale*.075,left0.y,left1.x+scale*.075,left1.y,'rgba(157,210,255,.96)',arrowAlpha);
    drawOpenSourcePalm(ctx,lx,ly,palmSize,'Left',.99);
  }
  if (drawRight) {
    const rx=right0.x+(right1.x-right0.x)*moveQ;
    const ry=right0.y+(right1.y-right0.y)*moveQ;
    drawMotionArrow(ctx,right0.x,right0.y-scale*.075,right1.x,right1.y-scale*.075,'rgba(157,210,255,.96)',arrowAlpha);
    drawOpenSourcePalm(ctx,rx,ry,palmSize,'Right',.99);
  }

  // CURSOR side: chest, target, and cursor move at the same time as the hand.
  drawTreasureChest(ctx,chest.x,chest.y,scale*.070,false,nowMs,false,0);
  drawGem(ctx,gem.x,gem.y,scale*.044,style,nowMs);
  const cx=chest.x+(gem.x-chest.x)*moveQ;
  const cy=chest.y+(gem.y-chest.y)*moveQ;
  drawMotionArrow(ctx,chest.x,chest.y,gem.x,gem.y,'rgba(255,222,128,.97)',arrowAlpha);
  drawTreasureCompassCursor(ctx,cx,cy);
  if (sparklePct>0 && sparklePct<1) drawCollectSparkle(ctx,gem.x,gem.y,sparklePct*GEM_SPARKLE_MS);
}


function drawNoInstructionTransitionDemo(canvas, nowMs) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const {W,H} = fitInstructionCanvas(canvas);
  ctx.clearRect(0,0,W,H);
  drawTreasureBackground(ctx,W,H);

  const scale=Math.min(W,H);
  const pulse=0.5+0.5*Math.sin(nowMs/360);
  const cx=W*.50, cy=H*.58;
  const shakeX=Math.sin(nowMs/55)*scale*.008 + Math.sin(nowMs/31)*scale*.003;
  const shakeY=Math.sin(nowMs/71)*scale*.004;

  /* Subtle warning waves make the scene feel disturbed without teaching the mapping. */
  ctx.save();
  ctx.globalAlpha=.18+.11*pulse;
  ctx.strokeStyle='rgba(255,211,112,.70)';
  ctx.lineWidth=Math.max(1.5,scale*.006);
  for (let k=0;k<3;k++) {
    ctx.beginPath();
    ctx.arc(cx,cy,scale*(.14+k*.085+.010*pulse),0,Math.PI*2);
    ctx.stroke();
  }
  ctx.restore();

  const gemPositions=[
    {x:W*.30,y:H*.24,style:2,phase:.7},
    {x:W*.70,y:H*.82,style:4,phase:2.8},
  ];
  for (let i=0;i<gemPositions.length;i++) {
    const p=gemPositions[i];
    const gx=p.x + Math.sin(nowMs/62+p.phase)*scale*.010 + Math.sin(nowMs/37+p.phase)*scale*.003;
    const gy=p.y + Math.cos(nowMs/74+p.phase)*scale*.006;
    drawGem(ctx,gx,gy,scale*(.070+.004*pulse),p.style,nowMs+i*130);
  }

  drawTreasureChest(ctx,cx+shakeX,cy+shakeY,scale*.105,true,nowMs,false,.18+.08*pulse);
}

function runInstructionCanvas(canvas, mode) {
  canvas.__demoStartMs = performance.now();
  const tick = (t) => {
    if (!document.body.contains(canvas)) return;
    if (mode === 'baseline') drawBaselineInstructionDemo(canvas,t);
    else if (mode === 'transition') drawNoInstructionTransitionDemo(canvas,t);
    else drawDenovoInstructionDemo(canvas,mode,t);
    const id = requestAnimationFrame(tick);
    bimanualInstructionRafs.add(id);
  };
  const id = requestAnimationFrame(tick);
  bimanualInstructionRafs.add(id);
}


function drawQuizTargetCanvas(canvas, direction) {
  const ctx=canvas.getContext('2d');
  if (!ctx) return;
  const {W,H}=fitInstructionCanvas(canvas);
  ctx.clearRect(0,0,W,H);
  drawTreasureBackground(ctx,W,H);
  const scale=Math.min(W,H);
  const chest={x:W*.50,y:H*.63};
  const dirs={
    upLeft:{x:W*.28,y:H*.24,style:3},
    downRight:{x:W*.72,y:H*.84,style:4},
  };
  const target=dirs[direction] ?? dirs.upLeft;
  drawTreasureChest(ctx,chest.x,chest.y,scale*.085,false,0,false,0);
  drawTreasureCompassCursor(ctx,chest.x,chest.y);
  drawGem(ctx,target.x,target.y,scale*.052,target.style,0);
}

function ensureBimanualInstructionOverlay(trial, state) {
  ensureBimanualStyles();
  if (document.getElementById('bim-instruction-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'bim-instruction-overlay';
  const panel = document.createElement('div');
  panel.className = 'bim-panel';
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const finishInstruction = () => {
    state.finished = true;
    removeBimanualOverlay();
  };

  if (trial.kind === 'bimanual_instruction' && trial.page === 'baseline') {
    panel.innerHTML = `
      <h2>Collect the gem</h2>
      <canvas class="bim-baseline-canvas" aria-label="Two hands moving together with the cursor toward a gem"></canvas>
      <div class="bim-line">Move both hands together to reach the gem.</div>
      <button type="button" class="bim-main-button">Start</button>`;
    runInstructionCanvas(panel.querySelector('canvas'),'baseline');
    panel.querySelector('.bim-main-button').addEventListener('click',finishInstruction);
    return;
  }

  if (trial.kind === 'bimanual_instruction' && trial.page === 'no_instruction') {
    panel.classList.add('bim-transition-panel');
    panel.innerHTML = `
      <h2>MYSTERY ZONE</h2>
      <div class="bim-warning-wrap">
        <svg class="bim-warning-icon" viewBox="0 0 120 104" role="img" aria-label="Warning">
          <path d="M60 7 L113 97 H7 Z" fill="#d92c2c" stroke="#ff6b6b" stroke-width="5" stroke-linejoin="round"/>
          <path d="M60 28 L60 65" stroke="#ffffff" stroke-width="11" stroke-linecap="round"/>
          <circle cx="60" cy="82" r="6.5" fill="#ffffff"/>
        </svg>
        <div class="bim-warning-text">Warning: an unknown force has been detected!</div>
      </div>
      <canvas class="bim-transition-canvas" aria-label="Treasure chest and gems shaking as an unknown force appears"></canvas>
      <div class="bim-transition-copy">
        <div class="bim-reveal-line" style="--reveal-delay:.60s"><strong>The controls are no longer working the same way as before.</strong></div>
        <div class="bim-reveal-line" style="--reveal-delay:2.50s">A new hidden rule is now controlling the cursor.</div>
        <div class="bim-reveal-line" style="--reveal-delay:4.40s"><strong>The same hidden rule applies to every gem.</strong></div>
        <div class="bim-reveal-line" style="--reveal-delay:6.30s">Your mission is to discover the hidden rule and use it to collect the gems.</div>
        <div class="bim-reveal-line" style="--reveal-delay:9.00s"><strong>Make one quick movement toward each gem.</strong></div>
        <div class="bim-reveal-line bim-reveal-question" style="--reveal-delay:11.00s"><strong>Can you discover the new rule?</strong></div>
      </div>
      <button type="button" class="bim-main-button bim-reveal-button">Enter the Mystery Zone</button>`;
    runInstructionCanvas(panel.querySelector('.bim-transition-canvas'),'transition');
    panel.querySelector('.bim-main-button').addEventListener('click',finishInstruction);
    return;
  }

  if (trial.kind === 'bimanual_instruction' && trial.page === 'denovo_break') {
    panel.classList.add('bim-rule-panel');
    panel.innerHTML = `
      <h2>Take a short break</h2>
      <div class="bim-sub">The Mystery Zone will continue when you are ready.</div>
      <button type="button" class="bim-main-button">Continue</button>`;
    panel.querySelector('.bim-main-button').addEventListener('click',finishInstruction);
    return;
  }

  if (trial.kind === 'bimanual_instruction' && trial.page === 'restore_baseline') {
    panel.classList.add('bim-restore-panel');
    panel.innerHTML = `
      <h2>THE FORCE IS GONE</h2>
      <div class="bim-restore-sub">The original controls are back.</div>
      <button type="button" class="bim-main-button">Continue</button>`;
    panel.querySelector('.bim-main-button').addEventListener('click',finishInstruction);
    return;
  }

  if (trial.kind === 'denovo_quiz') {
    const questions = [
      { text:'Will the controls work the same way as before?', correct:'no', correction:'No. The controls have changed.' },
      { text:'Will the hidden rule stay the same for every gem?', correct:'yes', correction:'Yes. The same hidden rule applies to every gem.' },
      { text:'Is your goal to figure out the hidden rule?', correct:'yes', correction:'Yes. Your goal is to discover the hidden rule.' },
      { text:'Should you make one quick movement toward each gem?', correct:'yes', correction:'Yes. Make one quick movement toward each gem.' },
    ];
    state.quizAnswers = Array.isArray(state.quizAnswers) && state.quizAnswers.length === 4
      ? state.quizAnswers : [null,null,null,null];
    panel.classList.add('bim-rule-panel');
    panel.innerHTML = `
      <h2>Before you begin...</h2>
      <div class="bim-sub">Answer these questions about the Mystery Zone.</div>
      <div class="bim-quiz-grid">
        ${questions.map((q,qi)=>`
          <div class="bim-question-card" data-question="${qi}">
            <div class="bim-question">${qi+1}. ${q.text}</div>
            <div class="bim-options">
              <button type="button" class="bim-option" data-q="${qi}" data-o="yes">YES</button>
              <button type="button" class="bim-option" data-q="${qi}" data-o="no">NO</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="bim-quiz-feedback"></div>
      <button type="button" class="bim-main-button" data-action="check">Check answers</button>`;

    panel.querySelectorAll('.bim-option').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const qi=Number(btn.dataset.q), answer=btn.dataset.o;
        state.quizAnswers[qi]=answer;
        const card=panel.querySelector(`[data-question="${qi}"]`);
        card?.querySelectorAll('.bim-option').forEach(x=>x.classList.remove('selected','incorrect','correct'));
        btn.classList.add('selected');
        panel.querySelector('.bim-quiz-feedback').textContent='';
      });
    });

    const main=panel.querySelector('.bim-main-button');
    main.addEventListener('click',()=>{
      if (main.dataset.action === 'continue') {
        state.quizPassed = true;
        state.finished = true;
        removeBimanualOverlay();
        return;
      }
      if (main.dataset.action === 'fail') {
        state.quizPassed = false;
        state.quizFailed = true;
        state.finished = true;
        removeBimanualOverlay();
        return;
      }

      const unanswered=state.quizAnswers.some(a=>a==null);
      const fb=panel.querySelector('.bim-quiz-feedback');
      if (unanswered) { fb.textContent='Please answer all four questions.'; return; }

      const wrong=[];
      questions.forEach((q,qi)=>{
        const card=panel.querySelector(`[data-question="${qi}"]`);
        card?.querySelectorAll('.bim-option').forEach(x=>x.classList.remove('incorrect','correct'));
        const selected=state.quizAnswers[qi];
        if (selected !== q.correct) {
          wrong.push(qi);
          card?.querySelector(`.bim-option[data-o="${selected}"]`)?.classList.add('incorrect');
          card?.querySelector(`.bim-option[data-o="${q.correct}"]`)?.classList.add('correct');
        }
      });
      state.quizErrorCount=wrong.length;

      if (wrong.length === 0) {
        fb.textContent='Correct. You are ready to enter the Mystery Zone.';
        main.textContent='Continue';
        main.dataset.action='continue';
      } else if (wrong.length === 1) {
        fb.textContent=`Correction: ${questions[wrong[0]].correction}`;
        main.textContent='Continue';
        main.dataset.action='continue';
      } else {
        fb.textContent='You did not pass the instruction check. Please return to Prolific.';
        main.textContent='End study';
        main.dataset.action='fail';
      }
    });
    return;
  }

  if (trial.kind === 'denovo_explicit_probe') {
    const questions = [
      { text:'In the Mystery Zone, if I move my LEFT hand UP, the cursor will move...', options:['LEFT','RIGHT','UP','DOWN'], correct:1 },
      { text:'In the Mystery Zone, if I move my LEFT hand DOWN, the cursor will move...', options:['LEFT','RIGHT','UP','DOWN'], correct:0 },
      { text:'In the Mystery Zone, if I move my RIGHT hand LEFT, the cursor will move...', options:['LEFT','RIGHT','UP','DOWN'], correct:2 },
      { text:'In the Mystery Zone, if I move my RIGHT hand RIGHT, the cursor will move...', options:['LEFT','RIGHT','UP','DOWN'], correct:3 },
    ];
    state.probeAnswers = Array.isArray(state.probeAnswers) && state.probeAnswers.length === 4
      ? state.probeAnswers : [null,null,null,null];
    panel.classList.add('bim-rule-panel');
    panel.innerHTML = `
      <h2>One last check</h2>
      <div class="bim-sub">Think back to the Mystery Zone.</div>
      <div class="bim-quiz-grid">
        ${questions.map((q,qi)=>`
          <div class="bim-question-card" data-question="${qi}">
            <div class="bim-question">${qi+1}. ${q.text}</div>
            <div class="bim-options">
              ${q.options.map((o,oi)=>`<button type="button" class="bim-option" data-q="${qi}" data-o="${oi}">${o}</button>`).join('')}
            </div>
          </div>`).join('')}
      </div>
      <div class="bim-quiz-feedback"></div>
      <button type="button" class="bim-main-button">Continue</button>`;

    panel.querySelectorAll('.bim-option').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const qi=Number(btn.dataset.q), oi=Number(btn.dataset.o);
        state.probeAnswers[qi]=oi;
        const card=panel.querySelector(`[data-question="${qi}"]`);
        card?.querySelectorAll('.bim-option').forEach(x=>x.classList.remove('selected'));
        btn.classList.add('selected');
        panel.querySelector('.bim-quiz-feedback').textContent='';
      });
    });
    panel.querySelector('.bim-main-button').addEventListener('click',()=>{
      if (state.probeAnswers.some(a=>a==null)) {
        panel.querySelector('.bim-quiz-feedback').textContent='Please answer all four questions.';
        return;
      }
      state.probeCorrect = state.probeAnswers.map((a,i)=>a===questions[i].correct);
      state.finished=true;
      removeBimanualOverlay();
    });
    return;
  }
}

function updateDiscoveryHandOnsetCandidate(state, hand, displacement, tMs, taskX, taskY, left, right, addEvent, trial) {
  const isLeft = hand === "left";
  const onsetKey = isLeft ? "leftHandMovementOnsetMs" : "rightHandMovementOnsetMs";
  const onsetPausedKey = isLeft ? "leftHandMovementOnsetPausedMs" : "rightHandMovementOnsetPausedMs";
  const candidateMsKey = isLeft ? "leftOnsetCandidateMs" : "rightOnsetCandidateMs";
  const candidatePausedKey = isLeft ? "leftOnsetCandidatePausedMs" : "rightOnsetCandidatePausedMs";
  const candidateFramesKey = isLeft ? "leftOnsetCandidateFrames" : "rightOnsetCandidateFrames";
  const candidateSnapshotKey = isLeft ? "leftOnsetCandidateSnapshot" : "rightOnsetCandidateSnapshot";

  if (state[onsetKey] != null) return true;

  if (Number.isFinite(displacement) && displacement >= BIM_DISCOVERY_ONSET_DISPLACEMENT) {
    if ((state[candidateFramesKey] ?? 0) === 0) {
      state[candidateMsKey] = tMs;
      state[candidatePausedKey] = state.trackingPausedTotalMs ?? 0;
      state[candidateSnapshotKey] = {
        taskX, taskY,
        leftX:left.x, leftY:left.y,
        rightX:right.x, rightY:right.y,
      };
      addEvent(`${hand}_hand_onset_candidate`, {
        mapping:trial.mapping,
        targetDirection:state.currentTargetDirection,
        displacement,
        threshold:BIM_DISCOVERY_ONSET_DISPLACEMENT,
      });
    }

    state[candidateFramesKey] = (state[candidateFramesKey] ?? 0) + 1;

    if (state[candidateFramesKey] >= BIM_DISCOVERY_ONSET_CONFIRM_FRAMES) {
      state[onsetKey] = state[candidateMsKey] ?? tMs;
      state[onsetPausedKey] = state[candidatePausedKey] ?? (state.trackingPausedTotalMs ?? 0);
      addEvent(`${hand}_hand_movement_onset`, {
        mapping:trial.mapping,
        targetDirection:state.currentTargetDirection,
        onsetMs:state[onsetKey],
        confirmedAtMs:tMs,
        confirmationFrames:BIM_DISCOVERY_ONSET_CONFIRM_FRAMES,
        displacementThreshold:BIM_DISCOVERY_ONSET_DISPLACEMENT,
        planningTimeMs:Math.max(
          0,
          state[onsetKey] - state.targetOnsetMs - (state[onsetPausedKey] ?? 0)
        ),
      });
      return true;
    }
  } else {
    /* A one-frame excursion that returns inside threshold is treated as jitter. */
    state[candidateMsKey] = null;
    state[candidatePausedKey] = null;
    state[candidateFramesKey] = 0;
    state[candidateSnapshotKey] = null;
  }

  return false;
}

function updateDiscoveryLaunchCandidate(state, hand, displacement, tMs, taskX, taskY, left, right, addEvent, trial) {
  const isLeft = hand === "left";
  const launchKey = isLeft ? "leftAttemptLaunchMs" : "rightAttemptLaunchMs";
  const candidateMsKey = isLeft ? "leftLaunchCandidateMs" : "rightLaunchCandidateMs";
  const candidateFramesKey = isLeft ? "leftLaunchCandidateFrames" : "rightLaunchCandidateFrames";
  const candidateLastDispKey = isLeft ? "leftLaunchCandidateLastDisplacement" : "rightLaunchCandidateLastDisplacement";
  const candidateSnapshotKey = isLeft ? "leftLaunchCandidateSnapshot" : "rightLaunchCandidateSnapshot";

  if (state[launchKey] != null) return true;

  const reset = () => {
    state[candidateMsKey] = null;
    state[candidateFramesKey] = 0;
    state[candidateLastDispKey] = null;
    state[candidateSnapshotKey] = null;
  };

  if (!(Number.isFinite(displacement) && displacement >= BIM_DISCOVERY_LAUNCH_DISPLACEMENT)) {
    reset();
    return false;
  }

  const prevDisp = state[candidateLastDispKey];
  if (Number.isFinite(prevDisp) && displacement < prevDisp - BIM_DISCOVERY_LAUNCH_REVERSAL_TOLERANCE) {
    reset();
  }

  if ((state[candidateFramesKey] ?? 0) === 0) {
    state[candidateMsKey] = tMs;
    state[candidateSnapshotKey] = {
      taskX, taskY,
      leftX:left.x, leftY:left.y,
      rightX:right.x, rightY:right.y,
    };
    addEvent(`${hand}_attempt_launch_candidate`, {
      mapping:trial.mapping,
      targetDirection:state.currentTargetDirection,
      displacement,
      threshold:BIM_DISCOVERY_LAUNCH_DISPLACEMENT,
    });
  }

  state[candidateFramesKey] = (state[candidateFramesKey] ?? 0) + 1;
  state[candidateLastDispKey] = displacement;

  if (state[candidateFramesKey] >= BIM_DISCOVERY_LAUNCH_CONFIRM_FRAMES) {
    state[launchKey] = tMs; // live feedback unlocks after robust launch confirmation
    addEvent(`${hand}_attempt_launch_confirmed`, {
      mapping:trial.mapping,
      targetDirection:state.currentTargetDirection,
      candidateStartedMs:state[candidateMsKey],
      confirmedAtMs:tMs,
      displacement,
      threshold:BIM_DISCOVERY_LAUNCH_DISPLACEMENT,
      confirmationFrames:BIM_DISCOVERY_LAUNCH_CONFIRM_FRAMES,
    });
    return true;
  }

  return false;
}

function startBimanualTarget(state, trial, tMs, addEvent, taskX, taskY, left, right) {
  state.currentTargetDirection = state.targetSequence[state.targetIndex];
  state.targetOnsetMs = tMs;
  state.trackingPausedTotalMs = 0;
  state.handMovementOnsetMs = null;
  state.cursorMovementOnsetMs = null;
  state.handReactionTimeMs = null;
  state.cursorReactionTimeMs = null;
  state.earlySampleMs = null;
  state.earlyTaskX = null;
  state.earlyTaskY = null;
  state.earlyLeftX = null;
  state.earlyLeftY = null;
  state.earlyRightX = null;
  state.earlyRightY = null;
  state.movementOnsetTaskX = taskX;
  state.movementOnsetTaskY = taskY;
  state.movementOnsetLeftX = left.x;
  state.movementOnsetLeftY = left.y;
  state.movementOnsetRightX = right.x;
  state.movementOnsetRightY = right.y;
  state.cursorOriginTaskX = taskX;
  state.cursorOriginTaskY = taskY;
  /* Trial-specific hand origins are captured only after the HOME hold is complete.
     Discovery onset is measured relative to these positions, not the idealized
     calibration zero, which prevents small HOME-placement offsets from looking
     like movement at target onset. */
  state.trialLeftOriginX = left.x;
  state.trialLeftOriginY = left.y;
  state.trialRightOriginX = right.x;
  state.trialRightOriginY = right.y;
  state.leftOnsetCandidateMs = null;
  state.rightOnsetCandidateMs = null;
  state.leftOnsetCandidatePausedMs = null;
  state.rightOnsetCandidatePausedMs = null;
  state.leftOnsetCandidateFrames = 0;
  state.rightOnsetCandidateFrames = 0;
  state.leftOnsetCandidateSnapshot = null;
  state.rightOnsetCandidateSnapshot = null;
  state.leftAttemptLaunchMs = null;
  state.rightAttemptLaunchMs = null;
  state.leftLaunchCandidateMs = null;
  state.rightLaunchCandidateMs = null;
  state.leftLaunchCandidateFrames = 0;
  state.rightLaunchCandidateFrames = 0;
  state.leftLaunchCandidateLastDisplacement = null;
  state.rightLaunchCandidateLastDisplacement = null;
  state.leftLaunchCandidateSnapshot = null;
  state.rightLaunchCandidateSnapshot = null;
  state.movementWindowStartMs = null;
  state.trackingPausedAtMovementWindowStartMs = null;
  state.cursorFeedbackUnlockMs = null;
  state.commitCursorTaskX = null;
  state.commitCursorTaskY = null;
  state.commitLeftHandX = null;
  state.commitLeftHandY = null;
  state.commitRightHandX = null;
  state.commitRightHandY = null;
  state.leftHandMovementOnsetPausedMs = null;
  state.rightHandMovementOnsetPausedMs = null;
  state.currentPathLength = 0;
  state.lastTaskX = 0;
  state.lastTaskY = 0;
  state.previousTaskX = 0;
  state.previousTaskY = 0;
  state.previousRadialDistance = 0;
  state.previousFrameMs = tMs;
  state.peakRadialDistance = 0;
  state.peakTaskX = 0;
  state.peakTaskY = 0;
  state.feedbackEndpointTaskX = null;
  state.feedbackEndpointTaskY = null;
  state.feedbackEndpointMs = null;
  state.feedbackEndpointSource = null;
  state.feedbackHit = null;
  state.endpointFeedbackStartMs = null;
  state.leftHandMovementOnsetMs = null;
  state.rightHandMovementOnsetMs = null;
  state.trackingPausedAtMovementOnsetMs = null;
  state.leftHomeEnterMs = null;
  state.rightHomeEnterMs = null;
  state.phase = 'target';
  addEvent('target_onset', {
    mapping: trial.mapping,
    targetDirection: state.currentTargetDirection,
    reachNumber: state.targetIndex,
    targetDeadlineMs: trial.singleAttempt ? null : (trial.noSpeedLimit ? null : BIM_TARGET_DEADLINE_MS),
    movementWindowMs: trial.singleAttempt ? trial.movementWindowMs : null,
  });
}

function updateBimanualHomeHold(state, leftInHome, rightInHome, tMs) {
  if (leftInHome) {
    if (state.leftHomeEnterMs == null) state.leftHomeEnterMs = tMs;
  } else state.leftHomeEnterMs = null;
  if (rightInHome) {
    if (state.rightHomeEnterMs == null) state.rightHomeEnterMs = tMs;
  } else state.rightHomeEnterMs = null;
  const leftHoldMs = state.leftHomeEnterMs == null ? 0 : Math.max(0,tMs-state.leftHomeEnterMs);
  const rightHoldMs = state.rightHomeEnterMs == null ? 0 : Math.max(0,tMs-state.rightHomeEnterMs);
  return {
    leftHoldMs,
    rightHoldMs,
    bothReady:leftInHome && rightInHome && leftHoldMs >= HOME_HOLD_MS && rightHoldMs >= HOME_HOLD_MS,
  };
}

function bimanualHomeMetrics(leftPalm,rightPalm) {
  const leftHome = {x:calibration.left.homeX,y:calibration.left.homeY};
  const rightHome = {x:calibration.right.homeX,y:calibration.right.homeY};
  const leftDist = leftPalm && Number.isFinite(leftHome.x) && Number.isFinite(leftHome.y)
    ? distance2d(leftPalm.viewX,leftPalm.viewY,leftHome.x,leftHome.y) : null;
  const rightDist = rightPalm && Number.isFinite(rightHome.x) && Number.isFinite(rightHome.y)
    ? distance2d(rightPalm.viewX,rightPalm.viewY,rightHome.x,rightHome.y) : null;
  return {
    leftHome,
    rightHome,
    leftViewHomeDistance:leftDist,
    rightViewHomeDistance:rightDist,
    leftInHome:Number.isFinite(leftDist) && leftDist <= CALIBRATION_TARGET_RADIUS,
    rightInHome:Number.isFinite(rightDist) && rightDist <= CALIBRATION_TARGET_RADIUS,
  };
}

function bimanualMean(values) {
  const clean=(values||[]).filter(Number.isFinite);
  return clean.length ? clean.reduce((a,b)=>a+b,0)/clean.length : null;
}

/* Dynamic QC is evaluated from the actual two-hand Baseline block rather than
   from separate single-hand practice. This keeps the technical gate matched to
   the movement/tracking demands of the task. Behavioral accuracy is NOT a gate. */
function bimanualBaselineDynamicQualityMetrics(frames) {
  const activeFrames=(frames||[]).filter(f=>Number.isFinite(Number(f?.t)));
  const frameTimes=activeFrames.map(f=>Number(f.t));
  const fpsSamples=[];
  for (let i=1;i<frameTimes.length;i++) {
    const dt=frameTimes[i]-frameTimes[i-1];
    if (dt>0 && dt<1000) fpsSamples.push(1000/dt);
  }

  const hasLabel=(f,label)=>Array.isArray(f?.h) && f.h.includes(label);
  const leftDetected=activeFrames.filter(f=>hasLabel(f,'Left')).length;
  const rightDetected=activeFrames.filter(f=>hasLabel(f,'Right')).length;
  const bothDetected=activeFrames.filter(f=>hasLabel(f,'Left') && hasLabel(f,'Right')).length;

  function longestMissingGapMs(predicate) {
    let longest=0;
    let gapStart=null;
    for (const f of activeFrames) {
      const t=Number(f.t);
      const detected=predicate(f);
      if (detected) {
        if (gapStart!=null) longest=Math.max(longest,t-gapStart);
        gapStart=null;
      } else if (gapStart==null) {
        gapStart=t;
      }
    }
    if (gapStart!=null && frameTimes.length) {
      longest=Math.max(longest,frameTimes[frameTimes.length-1]-gapStart);
    }
    return longest;
  }

  const medianProcessedFPS=median(fpsSamples);
  const p10ProcessedFPS=percentile(fpsSamples,0.10);
  const n=activeFrames.length;
  const leftHandDetectionRate=n ? leftDetected/n : 0;
  const rightHandDetectionRate=n ? rightDetected/n : 0;
  const bothHandsDetectionRate=n ? bothDetected/n : 0;
  const longestLeftGapMs=longestMissingGapMs(f=>hasLabel(f,'Left'));
  const longestRightGapMs=longestMissingGapMs(f=>hasLabel(f,'Right'));
  const longestBothHandsGapMs=longestMissingGapMs(f=>hasLabel(f,'Left') && hasLabel(f,'Right'));

  const reasons=[];
  if (!(Number.isFinite(medianProcessedFPS) && medianProcessedFPS>=DYNAMIC_PREFLIGHT_MIN_MEDIAN_FPS)) {
    reasons.push('low_dynamic_fps');
  }
  if (leftHandDetectionRate<DYNAMIC_PREFLIGHT_MIN_EXPECTED_HAND_DETECTION) {
    reasons.push('left_dynamic_tracking');
  }
  if (rightHandDetectionRate<DYNAMIC_PREFLIGHT_MIN_EXPECTED_HAND_DETECTION) {
    reasons.push('right_dynamic_tracking');
  }
  if (bothHandsDetectionRate<DYNAMIC_PREFLIGHT_MIN_EXPECTED_HAND_DETECTION) {
    reasons.push('both_hands_dynamic_tracking');
  }
  if (longestLeftGapMs>DYNAMIC_PREFLIGHT_MAX_EXPECTED_HAND_GAP_MS ||
      longestRightGapMs>DYNAMIC_PREFLIGHT_MAX_EXPECTED_HAND_GAP_MS ||
      longestBothHandsGapMs>DYNAMIC_PREFLIGHT_MAX_EXPECTED_HAND_GAP_MS) {
    reasons.push('dynamic_tracking_gap');
  }

  return {
    pass:reasons.length===0,
    reasons,
    medianProcessedFPS,
    p10ProcessedFPS,
    leftHandDetectionRate,
    rightHandDetectionRate,
    bothHandsDetectionRate,
    longestLeftGapMs,
    longestRightGapMs,
    longestBothHandsGapMs,
    evaluatedFrameCount:n,
    thresholds:{
      minMedianProcessedFPS:DYNAMIC_PREFLIGHT_MIN_MEDIAN_FPS,
      minHandDetectionRate:DYNAMIC_PREFLIGHT_MIN_EXPECTED_HAND_DETECTION,
      minBothHandsDetectionRate:DYNAMIC_PREFLIGHT_MIN_EXPECTED_HAND_DETECTION,
      maxTrackingGapMs:DYNAMIC_PREFLIGHT_MAX_EXPECTED_HAND_GAP_MS,
    },
  };
}



/* Participant-facing treasure total. This is a gamified end-of-task summary only;
   it is not used as the scientific outcome. It includes the three formal bimanual
   phases (pre-baseline + de novo + post-baseline), but not calibration/instructions. */
const bimanualTreasureSummary = { attempted:0, collected:0 };

function updateBimanualTreasureSummaryFromState(trial,state) {
  if (trial?.kind !== 'bimanual_reaching' || !state || state.__treasureSummaryCounted) return;
  const rows=Array.isArray(state.reaches) ? state.reaches : [];
  bimanualTreasureSummary.attempted += rows.length;
  bimanualTreasureSummary.collected += rows.filter(r=>r && r.hit === true).length;
  state.__treasureSummaryCounted=true;
}

function patchRunnerTreasureCompleteScreen() {
  if (typeof document === 'undefined') return;
  const headings=[...document.querySelectorAll('h1,h2,h3')];
  const complete=headings.find(el=>/TREASURE\s+HUNT\s+COMPLETE/i.test((el.textContent||'').trim()));
  if (!complete) return;
  const attempted=bimanualTreasureSummary.attempted;
  const collected=bimanualTreasureSummary.collected;
  if (!attempted) return;
  const pct=Math.round(100*collected/attempted);
  const all=[...document.querySelectorAll('body *')];
  for (const el of all) {
    const txt=(el.textContent||'').trim();
    if (/^You collected\s+\d+\s+of\s+\d+\s+gems!?$/i.test(txt) && el.children.length===0) {
      const desired=`You collected ${collected} of ${attempted} gems!`;
      if (txt !== desired) el.textContent=desired;
    } else if (/^\d+%$/.test(txt) && el.children.length===0) {
      const parentText=(el.parentElement?.textContent||'').toUpperCase();
      if (parentText.includes('TREASURE HAUL') || parentText.includes('YOU COLLECTED')) {
        const desired=`${pct}%`;
        if (txt !== desired) el.textContent=desired;
      }
    }
  }
}

if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
  const finalSummaryObserver=new MutationObserver(()=>patchRunnerTreasureCompleteScreen());
  const startFinalSummaryObserver=()=>{
    if (!document.body) return;
    finalSummaryObserver.observe(document.body,{childList:true,subtree:true,characterData:true});
    patchRunnerTreasureCompleteScreen();
  };
  if (document.body) startFinalSummaryObserver();
  else document.addEventListener('DOMContentLoaded',startFinalSummaryObserver,{once:true});
}

export default {
  id: "two-hand-baseline-denovo-centerout-TEST-v19-10-FULL",

  title: "Two-Hand Baseline + De Novo Center-Out — V19-10 FULL",

  tracker: "hand",

  trackerOptions: {
    numHands: 2,
  },

  participantFlow: {
    simplifiedConsent: true,
    gestureStart: false,
    postTaskSurvey: true,
    showScore: true,
  },

  qualityControl: {
    calibrationMaxAttempts: PREFLIGHT_MAX_ATTEMPTS_PER_HAND,
    evaluateTrial({ trial, summary, attempt }) {
      if (trial.kind === "continuous_calibration") {
        const gate = summary?.preflightQuality ?? null;
        if (gate?.pass) return { action: "continue" };
        const reasons = Array.isArray(gate?.reasons) && gate.reasons.length
          ? gate.reasons
          : ["calibration_incomplete"];
        if (attempt < PREFLIGHT_MAX_ATTEMPTS_PER_HAND) {
          return {
            action: "retry",
            status: "preflight_retry",
            failureReason: reasons.join(","),
            reasons,
          };
        }
        return {
          action: "terminate",
          status: "technical_preflight_failure",
          failureReason: reasons.join(","),
          reasons,
        };
      }

      if (trial.kind === "denovo_quiz" && summary?.quizPassed !== true) {
        return {
          action: "terminate",
          status: "instruction_check_incomplete",
          failureReason: summary?.quizFailed === true ? "denovo_instruction_check_failed" : "denovo_rule_check_incomplete",
          reasons: [summary?.quizFailed === true ? "denovo_instruction_check_failed" : "denovo_rule_check_incomplete"],
        };
      }

      if (trial.kind === "bimanual_reaching") {
        if (summary?.blockFinishedNormally !== true) {
          return {
            action: "terminate",
            status: "technical_runtime_failure",
            failureReason: "block_time_limit_before_required_reaches",
            reasons: ["block_time_limit_before_required_reaches"],
          };
        }

        /* The actual two-hand Baseline block doubles as dynamic tracking QC. */
        if (trial.mapping === "baseline") {
          const gate=summary?.dynamicPreflightQuality ?? null;
          if (gate?.pass) return { action: "continue" };
          const reasons=Array.isArray(gate?.reasons) && gate.reasons.length
            ? gate.reasons
            : ["baseline_dynamic_preflight_failed"];
          return {
            action: "terminate",
            status: "technical_dynamic_preflight_failure",
            failureReason: reasons.join(","),
            reasons,
          };
        }
      }

      if (trial.kind === "baseline_reaching" && summary?.blockFinishedNormally !== true) {
        return {
          action: "terminate",
          status: "technical_runtime_failure",
          failureReason: "block_time_limit_before_required_reaches",
          reasons: ["block_time_limit_before_required_reaches"],
        };
      }

      return { action: "continue" };
    },
  },

  instructions: `<div aria-hidden="true"></div>`,

  trials: [
    {
      id: "cal_left_continuous",
      kind: "continuous_calibration",
      hand: "Left",
      showCamera: true,
      durationSec: CALIBRATION_MAX_SEC,
      countdownSec: 0,
      prompt: "Movement setup · LEFT HAND",
    },

    {
      id: "cal_right_continuous",
      kind: "continuous_calibration",
      hand: "Right",
      showCamera: true,
      durationSec: CALIBRATION_MAX_SEC,
      countdownSec: 0,
      prompt: "Movement setup · RIGHT HAND",
    },

    /* No separate single-hand dynamic practice. The task-specific flow begins
       here, and the first two-hand Baseline block is also the dynamic QC sample. */
    bimanualInstructionTrial("baseline_instruction", "baseline"),
    bimanualReachingTrial("baseline_pre_40", "baseline", BIM_BASELINE_REACHES, 0, {
      targetPool:BIM_TWO_DIRECTION_POOL
    }),

    /* Mystery-zone framing + comprehension check before any de novo exposure. */
    bimanualInstructionTrial("denovo_mystery_zone_intro", "no_instruction"),
    bimanualQuizTrial(),

    /* 100 de novo trials total: 50 + break + 50. Each block is exactly 25/25
       UP-LEFT vs DOWN-RIGHT with constrained random order (max run length 3). */
    bimanualReachingTrial("denovo_discovery_1_50", "denovo", BIM_DENOVO_REACHES_PER_BLOCK, 1, {
      targetPool:BIM_TWO_DIRECTION_POOL,
      training:true,
      noSpeedLimit:true,
      singleAttempt:true,
      movementWindowMs:BIM_DISCOVERY_MOVEMENT_WINDOW_MS
    }),
    bimanualInstructionTrial("denovo_mid_break", "denovo_break"),
    bimanualReachingTrial("denovo_discovery_2_50", "denovo", BIM_DENOVO_REACHES_PER_BLOCK, 2, {
      targetPool:BIM_TWO_DIRECTION_POOL,
      training:true,
      noSpeedLimit:true,
      singleAttempt:true,
      movementWindowMs:BIM_DISCOVERY_MOVEMENT_WINDOW_MS
    }),

    /* Aftereffect probe: signal that the original controls are back without re-demonstrating the motor solution. */
    bimanualInstructionTrial("baseline_restore_instruction", "restore_baseline"),
    bimanualReachingTrial("baseline_post_20_aftereffect_no_feedback", "baseline", BIM_POST_BASELINE_REACHES, 3, {
      targetPool:BIM_TWO_DIRECTION_POOL,
      noFeedback:true
    }),

    /* Explicit report of the component rule learned in the Mystery Zone. */
    bimanualExplicitProbeTrial(),

  ],


  /* ==========================================================
   * TRIAL START
   * ========================================================== */

  onTrialStart(trial, { tracker }) {
    removeBimanualOverlay();
    setBimanualTrackingOverlay(false);
    if (typeof document !== "undefined" && document.body) {
      document.body.classList.toggle(
        "bim-custom-flow-active",
        trial.kind === "continuous_calibration" || trial.kind === "bimanual_instruction" || trial.kind === "denovo_quiz" || trial.kind === "denovo_explicit_probe" || trial.kind === "bimanual_reaching"
      );
    }
    setTreasureReachingUiMode(
      trial.kind === "bimanual_reaching" ? "reaching" :
      isReachingTrial(trial) ? "reaching" :
      trial.kind === "continuous_calibration" ? "calibration" : null
    );

    if (trial.kind === "continuous_calibration") {
      return {
        stepIndex: 0,
        holdStartMs: null,
        introStartMs: null,
        calibrationComplete: false,
        calibrationChimePlayed: false,
        finished: false,
        lastReadoutHtml: null,
        trackingMissingSinceMs: null,
        trackingRecoverySinceMs: null,
        trackingOverlayShown: false,
        trackingIssueType: null,
        prevLeftPalmForGuard: null,
        prevRightPalmForGuard: null,
        expectedHandMotionEma: null,
        oppositeHandMotionEma: null,
        wrongHandMotionSinceMs: null,

        samples: {
          homeX: [],
          homeY: [],
          leftX: [],
          leftY: [],
          rightX: [],
          rightY: [],
          upX: [],
          upY: [],
          downX: [],
          downY: [],
        },

        lastFrameMs: null,
        fps: null,
        delegate: tracker?.delegate ?? "?",
      };
    }

    if (trial.kind === "bimanual_instruction") {
      return {
        finished:false,
        page:trial.page,
        lastFrameMs:null,
        fps:null,
        delegate:tracker?.delegate ?? "?",
      };
    }

    if (trial.kind === "denovo_quiz") {
      return {
        finished:false,
        quizPassed:false,
        quizFailed:false,
        quizErrorCount:null,
        quizAnswers:[null,null,null,null],
        lastFrameMs:null,
        fps:null,
        delegate:tracker?.delegate ?? "?",
      };
    }

    if (trial.kind === "denovo_explicit_probe") {
      return {
        finished:false,
        probeAnswers:[null,null,null,null],
        probeCorrect:[false,false,false,false],
        lastFrameMs:null,
        fps:null,
        delegate:tracker?.delegate ?? "?",
      };
    }

    if (trial.kind === "bimanual_reaching") {
      return {
        phase:"home",
        finished:false,
        targetSequence:trial.targetPool?.length
          ? makeBimanualTargetSequenceFromPool(trial.reachesRequired, trial.targetPool)
          : makeBimanualTargetSequence(trial.reachesRequired),
        targetIndex:0,
        currentTargetDirection:null,
        completedReaches:0,
        timedOutReaches:0,
        reaches:[],
        leftHomeEnterMs:null,
        rightHomeEnterMs:null,
        launchStartMs:null,
        targetOnsetMs:null,
        handMovementOnsetMs:null,
        cursorMovementOnsetMs:null,
        handReactionTimeMs:null,
        cursorReactionTimeMs:null,
        earlySampleMs:null,
        earlyTaskX:null,
        earlyTaskY:null,
        earlyLeftX:null,
        earlyLeftY:null,
        earlyRightX:null,
        earlyRightY:null,
        movementOnsetTaskX:null,
        movementOnsetTaskY:null,
        movementOnsetLeftX:null,
        movementOnsetLeftY:null,
        movementOnsetRightX:null,
        movementOnsetRightY:null,
        cursorOriginTaskX:null,
        cursorOriginTaskY:null,
        trialLeftOriginX:null,
        trialLeftOriginY:null,
        trialRightOriginX:null,
        trialRightOriginY:null,
        leftOnsetCandidateMs:null,
        rightOnsetCandidateMs:null,
        leftOnsetCandidatePausedMs:null,
        rightOnsetCandidatePausedMs:null,
        leftOnsetCandidateFrames:0,
        rightOnsetCandidateFrames:0,
        leftOnsetCandidateSnapshot:null,
        rightOnsetCandidateSnapshot:null,
        leftAttemptLaunchMs:null,
        rightAttemptLaunchMs:null,
        leftLaunchCandidateMs:null,
        rightLaunchCandidateMs:null,
        leftLaunchCandidateFrames:0,
        rightLaunchCandidateFrames:0,
        leftLaunchCandidateLastDisplacement:null,
        rightLaunchCandidateLastDisplacement:null,
        leftLaunchCandidateSnapshot:null,
        rightLaunchCandidateSnapshot:null,
        movementWindowStartMs:null,
        trackingPausedAtMovementWindowStartMs:null,
        cursorFeedbackUnlockMs:null,
        commitCursorTaskX:null,
        commitCursorTaskY:null,
        commitLeftHandX:null,
        commitLeftHandY:null,
        commitRightHandX:null,
        commitRightHandY:null,
        leftHandMovementOnsetPausedMs:null,
        rightHandMovementOnsetPausedMs:null,
        currentPathLength:0,
        lastTaskX:null,
        lastTaskY:null,
        previousTaskX:null,
        previousTaskY:null,
        previousRadialDistance:null,
        previousFrameMs:null,
        peakRadialDistance:0,
        peakTaskX:null,
        peakTaskY:null,
        feedbackEndpointTaskX:null,
        feedbackEndpointTaskY:null,
        feedbackEndpointMs:null,
        feedbackEndpointSource:null,
        feedbackHit:null,
        endpointFeedbackStartMs:null,
        leftHandMovementOnsetMs:null,
        rightHandMovementOnsetMs:null,
        trackingPausedAtMovementOnsetMs:null,
        collectSparkleStartMs:null,
        lastCollectedDirection:null,
        trackingMissingSinceMs:null,
        trackingRecoverySinceMs:null,
        trackingPauseStartMs:null,
        trackingPausedTotalMs:0,
        lastFrameMs:null,
        fps:null,
        delegate:tracker?.delegate ?? "?",
      };
    }

    if (isReachingTrial(trial)) {
      return {
        phase: "home",
        finished: false,
        targetSequence: makeTargetSequence(trial.kind === "practice_reaching" ? PRACTICE_CYCLES : CYCLES_PER_BLOCK),
        targetIndex: 0,
        currentTargetDirection: null,
        completedReaches: 0,
        timedOutReaches: 0,
        trackingLossInvalidReaches: 0,
        reaches: [],

        trackingMissingSinceMs: null,
        trackingRecoverySinceMs: null,
        trackingPhaseAtLoss: null,
        trackingInvalidPending: false,
        trackingPauseIntervals: [],
        trackingOverlayShown: false,
        trackingIssueType: null,
        prevLeftPalmForGuard: null,
        prevRightPalmForGuard: null,
        expectedHandMotionEma: null,
        oppositeHandMotionEma: null,
        wrongHandMotionSinceMs: null,
        lastGoodDerived: null,
        lastReadoutHtml: null,
        blockChimePlayed: false,
        taskCompleteChimePlayed: false,

        homeEnterMs: null,
        targetOnsetMs: null,
        movementOnsetMs: null,
        movementOnsetFrames: 0,
        movementOnsetTaskX: null,
        movementOnsetTaskY: null,
        earlySampleTaskX: null,
        earlySampleTaskY: null,
        earlySampleMs: null,
        firstCrossingMs: null,
        feedbackFreezeStartMs: null,
        feedbackFreezeX: null,
        feedbackFreezeY: null,
        tooSlowWarningUntilMs: null,
        collectSparkleStartMs: null,
        returnGuideStartMs: null,

        peakRadialDistance: 0,
        peakTaskX: null,
        peakTaskY: null,
        peakMs: null,
        peakPathLength: 0,
        previousRadialDistance: null,
        previousTaskX: null,
        previousTaskY: null,
        previousFrameMs: null,

        currentPathLength: 0,
        outboundPathLength: 0,
        lastTaskX: null,
        lastTaskY: null,

        currentInitialRecord: null,

        lastFrameMs: null,
        fps: null,
        delegate: tracker?.delegate ?? "?",
      };
    }

    return {};
  },


  /* ==========================================================
   * FRAME UPDATE
   * ========================================================== */

  onFrame({
    allLandmarks = [],
    allHandedness = [],
    tMs,
    trial,
    state,
    addEvent,
  }) {
    /* ---------- FPS ---------- */
    if (state.lastFrameMs != null) {
      const dt = tMs - state.lastFrameMs;
      if (dt > 0) {
        const instantFPS = 1000 / dt;
        state.fps = state.fps == null
          ? instantFPS
          : 0.9 * state.fps + 0.1 * instantFPS;
      }
    }
    state.lastFrameMs = tMs;

    const leftPalm = getPalmCenter(
      getHand(allLandmarks, allHandedness, "Left")
    );

    const rightPalm = getPalmCenter(
      getHand(allLandmarks, allHandedness, "Right")
    );

    if (trial.kind === "bimanual_instruction") {
      return { page:trial.page, finished:state.finished ? 1 : 0, fps:state.fps };
    }

    if (trial.kind === "denovo_quiz") {
      return {
        quizPassed:state.quizPassed ? 1 : 0,
        quizFailed:state.quizFailed ? 1 : 0,
        quizErrorCount:state.quizErrorCount,
        finished:state.finished ? 1 : 0,
        fps:state.fps
      };
    }

    if (trial.kind === "denovo_explicit_probe") {
      return { finished:state.finished ? 1 : 0, fps:state.fps };
    }

    if (trial.kind === "bimanual_reaching") {
      const requiredHand = trial.mapping === 'denovo_left_training'
        ? 'Left'
        : trial.mapping === 'denovo_right_training'
          ? 'Right'
          : 'Both';
      const requiredDetected = requiredHand === 'Left'
        ? !!leftPalm
        : requiredHand === 'Right'
          ? !!rightPalm
          : (!!leftPalm && !!rightPalm);
      const missingHand = requiredDetected
        ? null
        : requiredHand === 'Left'
          ? 'Left'
          : requiredHand === 'Right'
            ? 'Right'
            : (!leftPalm && !rightPalm)
              ? 'Both'
              : (!leftPalm ? 'Left' : 'Right');

      if (!requiredDetected) {
        if (state.trackingMissingSinceMs == null) state.trackingMissingSinceMs = tMs;
        state.trackingRecoverySinceMs = null;
        if (state.trackingPauseStartMs == null) state.trackingPauseStartMs = tMs;
        if (tMs - state.trackingMissingSinceMs >= TRACKING_LOSS_THRESHOLD_MS) {
          setBimanualTrackingOverlay(true, missingHand);
        }
        return {
          mapping:trial.mapping,
          bothHandsDetected: requiredHand === 'Both' ? 0 : null,
          requiredHandDetected:0,
          trackingMissingHand:missingHand,
          leftPalmX:leftPalm?.viewX ?? null,
          leftPalmY:leftPalm?.viewY ?? null,
          rightPalmX:rightPalm?.viewX ?? null,
          rightPalmY:rightPalm?.viewY ?? null,
          phaseCode:state.phase === "collected" ? 7 : state.phase === "attempt_feedback" ? 10 : state.phase === "launch" ? 8 : phaseCode(state.phase),
          targetCode:targetCode(state.currentTargetDirection),
          fps:state.fps,
        };
      }

      if (state.trackingMissingSinceMs != null) {
        if (state.trackingRecoverySinceMs == null) state.trackingRecoverySinceMs = tMs;
        if (tMs - state.trackingRecoverySinceMs < TRACKING_RECOVERY_STABLE_MS) {
          return {
            mapping:trial.mapping,
            bothHandsDetected: requiredHand === 'Both' ? 1 : null,
            requiredHandDetected:1,
            phaseCode:state.phase === "collected" ? 7 : state.phase === "attempt_feedback" ? 10 : state.phase === "launch" ? 8 : phaseCode(state.phase),
            targetCode:targetCode(state.currentTargetDirection),
            fps:state.fps,
          };
        }
        if (state.trackingPauseStartMs != null) state.trackingPausedTotalMs += tMs - state.trackingPauseStartMs;
        state.trackingPauseStartMs = null;
        state.trackingMissingSinceMs = null;
        state.trackingRecoverySinceMs = null;
        setBimanualTrackingOverlay(false, requiredHand);
      }

      const left = requiredHand === 'Right'
        ? {x:0,y:0}
        : normalizedHandPosition("Left",leftPalm);
      const right = requiredHand === 'Left'
        ? {x:0,y:0}
        : normalizedHandPosition("Right",rightPalm);
      if (![left.x,left.y,right.x,right.y].every(Number.isFinite)) {
        return { mapping:trial.mapping, requiredHandDetected:1, fps:state.fps };
      }

      const rawHome = bimanualHomeMetrics(leftPalm,rightPalm);
      const home = requiredHand === 'Left'
        ? {...rawHome, rightInHome:true, rightViewHomeDistance:0}
        : requiredHand === 'Right'
          ? {...rawHome, leftInHome:true, leftViewHomeDistance:0}
          : rawHome;
      const rawTask = bimanualCursor(trial.mapping,left,right);
      const originActive = Number.isFinite(state.cursorOriginTaskX) && Number.isFinite(state.cursorOriginTaskY) &&
        (state.phase === "target" || state.phase === "moving" || state.phase === "attempt_feedback" || state.phase === "collected");
      const taskX = originActive ? rawTask.x - state.cursorOriginTaskX : rawTask.x;
      const taskY = originActive ? rawTask.y - state.cursorOriginTaskY : rawTask.y;
      const cursorView = taskToView(clamp(taskX,-1.25,1.25),clamp(taskY,-1.25,1.25));
      const cursorHomeDistance = distance2d(taskX,taskY,0,0);
      const activeElapsed = state.targetOnsetMs == null ? null : Math.max(0,tMs-state.targetOnsetMs-state.trackingPausedTotalMs);

      let hold = { leftHoldMs:0,rightHoldMs:0,bothReady:false };
      if (state.phase === "home" || state.phase === "return_home") {
        hold = updateBimanualHomeHold(state,home.leftInHome,home.rightInHome,tMs);
      }

      if (state.phase === "home" && hold.bothReady) {
        state.phase = "launch";
        state.launchStartMs = tMs;
      }
      else if (state.phase === "launch") {
        if (!home.leftInHome || !home.rightInHome) {
          state.phase = "home";
          state.launchStartMs = null;
          state.leftHomeEnterMs = null;
          state.rightHomeEnterMs = null;
        } else if (state.launchStartMs != null && tMs - state.launchStartMs >= BIM_HOME_FADE_MS) {
          startBimanualTarget(state,trial,tMs,addEvent,rawTask.x,rawTask.y,left,right);
          state.launchStartMs = null;
        }
      }
      else if (state.phase === "target") {
        const leftDisplacement = [state.trialLeftOriginX,state.trialLeftOriginY].every(Number.isFinite)
          ? Math.hypot(left.x-state.trialLeftOriginX,left.y-state.trialLeftOriginY)
          : Math.hypot(left.x,left.y);
        const rightDisplacement = [state.trialRightOriginX,state.trialRightOriginY].every(Number.isFinite)
          ? Math.hypot(right.x-state.trialRightOriginX,right.y-state.trialRightOriginY)
          : Math.hypot(right.x,right.y);

        let activeHandStarted = false;

        if (trial.singleAttempt) {
          /* Keep a sensitive displacement-based onset estimate for online RT bookkeeping.
             A separate, stricter launch gate below controls live-feedback unlock and
             the 600-ms runtime deadline; offline kinematic onset remains velocity-based. */
          updateDiscoveryHandOnsetCandidate(
            state,"left",leftDisplacement,tMs,taskX,taskY,left,right,addEvent,trial
          );
          updateDiscoveryHandOnsetCandidate(
            state,"right",rightDisplacement,tMs,taskX,taskY,left,right,addEvent,trial
          );

          updateDiscoveryLaunchCandidate(
            state,"left",leftDisplacement,tMs,taskX,taskY,left,right,addEvent,trial
          );
          updateDiscoveryLaunchCandidate(
            state,"right",rightDisplacement,tMs,taskX,taskY,left,right,addEvent,trial
          );

          const measuredOnsets = [
            {ms:state.leftHandMovementOnsetMs,paused:state.leftHandMovementOnsetPausedMs,snapshot:state.leftOnsetCandidateSnapshot},
            {ms:state.rightHandMovementOnsetMs,paused:state.rightHandMovementOnsetPausedMs,snapshot:state.rightOnsetCandidateSnapshot},
          ].filter(o=>Number.isFinite(o.ms)).sort((a,b)=>a.ms-b.ms);

          if (measuredOnsets.length && state.handMovementOnsetMs == null) {
            const first = measuredOnsets[0];
            const snapshot = first.snapshot ?? {taskX,taskY,leftX:left.x,leftY:left.y,rightX:right.x,rightY:right.y};
            state.handMovementOnsetMs=first.ms;
            state.handReactionTimeMs=Math.max(0,first.ms-state.targetOnsetMs-(first.paused ?? 0));
            state.trackingPausedAtMovementOnsetMs=first.paused ?? state.trackingPausedTotalMs;
            state.movementOnsetTaskX=snapshot.taskX; state.movementOnsetTaskY=snapshot.taskY;
            state.movementOnsetLeftX=snapshot.leftX; state.movementOnsetLeftY=snapshot.leftY;
            state.movementOnsetRightX=snapshot.rightX; state.movementOnsetRightY=snapshot.rightY;
            addEvent("hand_movement_onset",{
              mapping:trial.mapping,
              targetDirection:state.currentTargetDirection,
              reactionTimeMs:state.handReactionTimeMs,
              planningTimeMs:state.handReactionTimeMs,
              onsetMs:state.handMovementOnsetMs,
              confirmationFrames:BIM_DISCOVERY_ONSET_CONFIRM_FRAMES,
              displacementThreshold:BIM_DISCOVERY_ONSET_DISPLACEMENT,
              leftHandOnsetMs:state.leftHandMovementOnsetMs,
              rightHandOnsetMs:state.rightHandMovementOnsetMs,
            });
          }

          const launches = [
            {hand:"left",ms:state.leftAttemptLaunchMs},
            {hand:"right",ms:state.rightAttemptLaunchMs},
          ].filter(o=>Number.isFinite(o.ms)).sort((a,b)=>a.ms-b.ms);
          activeHandStarted = launches.length > 0;

          if (activeHandStarted && state.phase === "target") {
            const firstLaunch=launches[0];
            if (state.handMovementOnsetMs == null) {
              /* Fallback: if the onset detector did not store a timestamp, use
                 the confirmed launch moment as the movement-onset estimate. */
              state.handMovementOnsetMs=firstLaunch.ms;
              state.handReactionTimeMs=Math.max(0,firstLaunch.ms-state.targetOnsetMs-state.trackingPausedTotalMs);
              state.trackingPausedAtMovementOnsetMs=state.trackingPausedTotalMs;
              state.movementOnsetTaskX=taskX; state.movementOnsetTaskY=taskY;
              state.movementOnsetLeftX=left.x; state.movementOnsetLeftY=left.y;
              state.movementOnsetRightX=right.x; state.movementOnsetRightY=right.y;
            }
            /* Planning remains cursor-locked at HOME. Once the outbound movement
               is committed, show the mapped cursor live so the participant can learn
               the controller from movement-contingent feedback. */
            state.cursorFeedbackUnlockMs=tMs;
            state.commitCursorTaskX=taskX;
            state.commitCursorTaskY=taskY;
            state.commitLeftHandX=left.x;
            state.commitLeftHandY=left.y;
            state.commitRightHandX=right.x;
            state.commitRightHandY=right.y;
            /* Runtime deadline starts only after robust launch confirmation.
               The earlier onset estimate is retained for RT/kinematic bookkeeping,
               but cannot make a stationary/planning participant time out. */
            state.movementWindowStartMs=tMs;
            state.trackingPausedAtMovementWindowStartMs=state.trackingPausedTotalMs;
            state.lastTaskX=taskX; state.lastTaskY=taskY;
            state.previousTaskX=taskX; state.previousTaskY=taskY;
            state.previousRadialDistance=Math.hypot(taskX,taskY);
            state.previousFrameMs=tMs;
            state.peakRadialDistance=state.previousRadialDistance;
            state.peakTaskX=taskX; state.peakTaskY=taskY;
            state.phase="moving";
            addEvent("attempt_committed",{
              mapping:trial.mapping,
              targetDirection:state.currentTargetDirection,
              launchHand:firstLaunch.hand,
              confirmedAtMs:tMs,
              launchDisplacementThreshold:BIM_DISCOVERY_LAUNCH_DISPLACEMENT,
              launchConfirmationFrames:BIM_DISCOVERY_LAUNCH_CONFIRM_FRAMES,
              planningTimeMs:state.handReactionTimeMs,
              cursorFeedbackLockedBeforeCommit:true,
              cursorFeedbackHiddenDuringMovement:false,
              feedbackMode:"continuous_cursor_then_frozen_angular_endpoint",
              cursorFeedbackUnlockMs:state.cursorFeedbackUnlockMs,
              commitCursorTaskX:state.commitCursorTaskX,
              commitCursorTaskY:state.commitCursorTaskY,
              commitCursorDirectionDeg:Math.hypot(state.commitCursorTaskX ?? 0,state.commitCursorTaskY ?? 0) > 0.001
                ? angleDeg(state.commitCursorTaskX,state.commitCursorTaskY) : null,
              commitTargetDirectionalErrorDeg:Math.hypot(state.commitCursorTaskX ?? 0,state.commitCursorTaskY ?? 0) > 0.001
                ? wrapAngleDeg(angleDeg(state.commitCursorTaskX,state.commitCursorTaskY)-targetAngleDeg(state.currentTargetDirection)) : null,
            });
          }
        } else {
          /* Baseline keeps the existing onset rule. */
          const leftStarted = Math.hypot(left.x,left.y) > MOVEMENT_ONSET_RADIUS;
          const rightStarted = Math.hypot(right.x,right.y) > MOVEMENT_ONSET_RADIUS;

          if (leftStarted && state.leftHandMovementOnsetMs == null) {
            state.leftHandMovementOnsetMs = tMs;
            addEvent("left_hand_movement_onset", {
              mapping:trial.mapping,
              targetDirection:state.currentTargetDirection,
              planningTimeMs:Math.max(0,tMs-state.targetOnsetMs-state.trackingPausedTotalMs),
            });
          }
          if (rightStarted && state.rightHandMovementOnsetMs == null) {
            state.rightHandMovementOnsetMs = tMs;
            addEvent("right_hand_movement_onset", {
              mapping:trial.mapping,
              targetDirection:state.currentTargetDirection,
              planningTimeMs:Math.max(0,tMs-state.targetOnsetMs-state.trackingPausedTotalMs),
            });
          }

          activeHandStarted = trial.mapping === 'denovo_left_training'
            ? leftStarted
            : trial.mapping === 'denovo_right_training'
              ? rightStarted
              : (leftStarted || rightStarted);

          if (activeHandStarted && state.handMovementOnsetMs == null) {
            state.handMovementOnsetMs=tMs;
            state.handReactionTimeMs=Math.max(0,tMs-state.targetOnsetMs-state.trackingPausedTotalMs);
            state.trackingPausedAtMovementOnsetMs=state.trackingPausedTotalMs;
            state.movementOnsetTaskX=taskX; state.movementOnsetTaskY=taskY;
            state.movementOnsetLeftX=left.x; state.movementOnsetLeftY=left.y;
            state.movementOnsetRightX=right.x; state.movementOnsetRightY=right.y;
            state.lastTaskX=taskX; state.lastTaskY=taskY;
            state.previousTaskX=taskX; state.previousTaskY=taskY;
            state.previousRadialDistance=Math.hypot(taskX,taskY);
            state.previousFrameMs=tMs;
            state.peakRadialDistance=state.previousRadialDistance;
            state.peakTaskX=taskX; state.peakTaskY=taskY;
            state.phase="moving";
            addEvent("hand_movement_onset",{
              mapping:trial.mapping,
              targetDirection:state.currentTargetDirection,
              reactionTimeMs:state.handReactionTimeMs,
              planningTimeMs:state.handReactionTimeMs,
              leftHandOnsetMs:state.leftHandMovementOnsetMs,
              rightHandOnsetMs:state.rightHandMovementOnsetMs,
            });
          }
        }
        if (cursorHomeDistance > MOVEMENT_ONSET_RADIUS && state.cursorMovementOnsetMs == null) {
          state.cursorMovementOnsetMs=tMs;
          state.cursorReactionTimeMs=Math.max(0,tMs-state.targetOnsetMs-state.trackingPausedTotalMs);
        }
        if (!trial.singleAttempt && !trial.noSpeedLimit && activeElapsed != null && activeElapsed > BIM_TARGET_DEADLINE_MS) {
          state.timedOutReaches += 1;
          state.reaches.push({mapping:trial.mapping,targetDirection:state.currentTargetDirection,timedOut:true,reactionTimeMs:state.handReactionTimeMs,cursorReactionTimeMs:state.cursorReactionTimeMs});
          addEvent("reach_timeout",{mapping:trial.mapping,targetDirection:state.currentTargetDirection});
          state.phase="return_home";
          state.leftHomeEnterMs=null; state.rightHomeEnterMs=null;
        }
      }
      else if (state.phase === "moving") {
        if (trial.singleAttempt) {
          /* Keep monitoring the second hand after the first hand has launched the
             attempt, using the same robust trial-origin detector. */
          const leftDisplacement = [state.trialLeftOriginX,state.trialLeftOriginY].every(Number.isFinite)
            ? Math.hypot(left.x-state.trialLeftOriginX,left.y-state.trialLeftOriginY)
            : Math.hypot(left.x,left.y);
          const rightDisplacement = [state.trialRightOriginX,state.trialRightOriginY].every(Number.isFinite)
            ? Math.hypot(right.x-state.trialRightOriginX,right.y-state.trialRightOriginY)
            : Math.hypot(right.x,right.y);
          updateDiscoveryHandOnsetCandidate(
            state,"left",leftDisplacement,tMs,taskX,taskY,left,right,addEvent,trial
          );
          updateDiscoveryHandOnsetCandidate(
            state,"right",rightDisplacement,tMs,taskX,taskY,left,right,addEvent,trial
          );
        } else {
          const leftStartedNow = Math.hypot(left.x,left.y) > MOVEMENT_ONSET_RADIUS;
          const rightStartedNow = Math.hypot(right.x,right.y) > MOVEMENT_ONSET_RADIUS;
          if (leftStartedNow && state.leftHandMovementOnsetMs == null) state.leftHandMovementOnsetMs=tMs;
          if (rightStartedNow && state.rightHandMovementOnsetMs == null) state.rightHandMovementOnsetMs=tMs;
        }

        if (state.cursorMovementOnsetMs == null && cursorHomeDistance > MOVEMENT_ONSET_RADIUS) {
          state.cursorMovementOnsetMs=tMs;
          state.cursorReactionTimeMs=Math.max(0,tMs-state.targetOnsetMs-state.trackingPausedTotalMs);
        }

        const prevX=state.previousTaskX;
        const prevY=state.previousTaskY;
        const prevR=state.previousRadialDistance;
        const prevT=state.previousFrameMs;
        const currentR=Math.hypot(taskX,taskY);
        const currentStep=(Number.isFinite(state.lastTaskX) && Number.isFinite(state.lastTaskY))
          ? distance2d(state.lastTaskX,state.lastTaskY,taskX,taskY) : 0;
        state.currentPathLength += currentStep;
        state.lastTaskX=taskX; state.lastTaskY=taskY;

        if (currentR > (state.peakRadialDistance ?? -Infinity)) {
          state.peakRadialDistance=currentR;
          state.peakTaskX=taskX;
          state.peakTaskY=taskY;
        }

        if (state.handMovementOnsetMs != null && state.earlySampleMs == null && tMs-state.handMovementOnsetMs >= BIM_EARLY_HEADING_MS) {
          state.earlySampleMs=tMs;
          state.earlyTaskX=taskX; state.earlyTaskY=taskY;
          state.earlyLeftX=left.x; state.earlyLeftY=left.y;
          state.earlyRightX=right.x; state.earlyRightY=right.y;
        }

        if (trial.singleAttempt) {
          const pausedAfterOnset=Math.max(0,state.trackingPausedTotalMs-(state.trackingPausedAtMovementOnsetMs ?? 0));
          const pausedAfterWindowStart=Math.max(0,state.trackingPausedTotalMs-(state.trackingPausedAtMovementWindowStartMs ?? 0));
          const movementElapsedMs=state.handMovementOnsetMs == null
            ? 0
            : Math.max(0,tMs-state.handMovementOnsetMs-pausedAfterOnset);
          const movementWindowElapsedMs=state.movementWindowStartMs == null
            ? 0
            : Math.max(0,tMs-state.movementWindowStartMs-pausedAfterWindowStart);
          /* Robust de-novo endpoint gate. The display is capped at r=0.70, so
             registration must also accept a cursor that is already at/beyond
             r=0.70 on the first MOVING frame. This can happen when the 3-frame
             launch confirmation finishes after a fast reach has already crossed
             the target radius. Requiring only prevR<0.70 -> currentR>=0.70 would
             then miss the crossing and falsely end in TOO SLOW. */
          const crossedTargetRadius=Number.isFinite(prevR) && prevR < TARGET_ECCENTRICITY && currentR >= TARGET_ECCENTRICITY;
          const reachedTargetRadius=currentR >= TARGET_ECCENTRICITY;
          const radiusReached=crossedTargetRadius || reachedTargetRadius;
          const windowExpired=movementWindowElapsedMs >= (trial.movementWindowMs ?? BIM_DISCOVERY_MOVEMENT_WINDOW_MS);

          /* Radius attainment has priority over the movement deadline. If the
             same sampled frame is both >= r=0.70 and >= the time limit, treat it
             as an endpoint rather than a timeout. */
          if (radiusReached || windowExpired) {
            let endpointX=taskX, endpointY=taskY, endpointMs=tMs;
            let endpointSource=windowExpired && !radiusReached
              ? `movement_deadline_${trial.movementWindowMs ?? BIM_DISCOVERY_MOVEMENT_WINDOW_MS}ms`
              : "target_radius_reached";

            if (crossedTargetRadius && [prevX,prevY,prevR].every(Number.isFinite)) {
              const denom=currentR-prevR;
              const frac=Math.abs(denom)>1e-9
                ? clamp((TARGET_ECCENTRICITY-prevR)/denom,0,1)
                : 1;
              endpointX=prevX+frac*(taskX-prevX);
              endpointY=prevY+frac*(taskY-prevY);
              endpointMs=Number.isFinite(prevT) ? prevT+frac*(tMs-prevT) : tMs;
              endpointSource="interpolated_target_radius_crossing";
            } else if (reachedTargetRadius) {
              /* The radius was already crossed before this MOVING frame (most
                 often during launch confirmation). Recover the angular endpoint
                 by projecting the current mapped-cursor angle to r=0.70. */
              const recoveredAngle=Math.hypot(taskX,taskY)>1e-9 ? angleDeg(taskX,taskY) : null;
              if (Number.isFinite(recoveredAngle)) {
                const recoveredPoint=projectedPointAtTargetRadius(recoveredAngle);
                endpointX=recoveredPoint.x;
                endpointY=recoveredPoint.y;
              }
              endpointSource="target_radius_already_reached_at_launch";
            }

            const timedOut=windowExpired && !radiusReached;
            const target=TARGETS[state.currentTargetDirection];
            const endpointDistanceToTarget=distance2d(endpointX,endpointY,target.x,target.y);
            const endpointAngleDeg=Math.hypot(endpointX,endpointY) > 1e-9 ? angleDeg(endpointX,endpointY) : null;
            const endpointAngularErrorDeg=Number.isFinite(endpointAngleDeg)
              ? wrapAngleDeg(endpointAngleDeg-targetAngleDeg(state.currentTargetDirection))
              : null;
            const hit=!timedOut && angularHitFromError(endpointAngularErrorDeg);
            const angularFeedbackPoint=Number.isFinite(endpointAngleDeg)
              ? projectedPointAtTargetRadius(endpointAngleDeg)
              : null;
            const movementTimeMs=state.handMovementOnsetMs == null
              ? null
              : Math.max(0,endpointMs-state.handMovementOnsetMs-pausedAfterOnset);

            /* At a 600-ms timeout, classify the attempted controller solution
               before choosing participant-facing feedback. Rule/direction errors
               take priority over speed errors. */
            const timeoutPeakRadialDistance=Number.isFinite(state.peakRadialDistance)
              ? state.peakRadialDistance : 0;
            const timeoutPeakAngleDeg=
              timeoutPeakRadialDistance > 1e-9 &&
              [state.peakTaskX,state.peakTaskY].every(Number.isFinite)
                ? angleDeg(state.peakTaskX,state.peakTaskY)
                : null;
            const timeoutPeakDirectionalErrorDeg=Number.isFinite(timeoutPeakAngleDeg)
              ? wrapAngleDeg(timeoutPeakAngleDeg-targetAngleDeg(state.currentTargetDirection))
              : null;
            const cursorEffectDetected=
              timeoutPeakRadialDistance >= BIM_DISCOVERY_CURSOR_EFFECT_RADIUS;
            const directionCorrectAtTimeout=
              cursorEffectDetected && angularHitFromError(timeoutPeakDirectionalErrorDeg);
            const timeoutFailureType=timedOut
              ? (!cursorEffectDetected
                  ? "no_cursor_effect"
                  : (directionCorrectAtTimeout
                      ? "correct_direction_too_slow"
                      : "wrong_cursor_direction"))
              : null;

            let initialDirectionDeg=null, initialDirectionalErrorDeg=null;
            let initialLeftHandDirectionDeg=null, initialRightHandDirectionDeg=null;
            if ([state.earlyTaskX,state.earlyTaskY,state.movementOnsetTaskX,state.movementOnsetTaskY].every(Number.isFinite)) {
              const dx=state.earlyTaskX-state.movementOnsetTaskX, dy=state.earlyTaskY-state.movementOnsetTaskY;
              if (Math.hypot(dx,dy)>.001) {
                initialDirectionDeg=angleDeg(dx,dy);
                initialDirectionalErrorDeg=wrapAngleDeg(initialDirectionDeg-targetAngleDeg(state.currentTargetDirection));
              }
            }
            if ([state.earlyLeftX,state.earlyLeftY,state.movementOnsetLeftX,state.movementOnsetLeftY].every(Number.isFinite)) {
              const dx=state.earlyLeftX-state.movementOnsetLeftX,dy=state.earlyLeftY-state.movementOnsetLeftY;
              if (Math.hypot(dx,dy)>.001) initialLeftHandDirectionDeg=angleDeg(dx,dy);
            }
            if ([state.earlyRightX,state.earlyRightY,state.movementOnsetRightX,state.movementOnsetRightY].every(Number.isFinite)) {
              const dx=state.earlyRightX-state.movementOnsetRightX,dy=state.earlyRightY-state.movementOnsetRightY;
              if (Math.hypot(dx,dy)>.001) initialRightHandDirectionDeg=angleDeg(dx,dy);
            }

            const record={
              mapping:trial.mapping,
              targetDirection:state.currentTargetDirection,
              hit,
              timedOut,
              movementWindowExpired:timedOut,
              endpointSource,
              endpointX,endpointY,
              endpointRadialDistance:Math.hypot(endpointX,endpointY),
              endpointAngleDeg,
              endpointAngularErrorDeg,
              endpointDistanceToTarget,
              angularHit:hit ? 1 : 0,
              angularHitToleranceDeg:ANGULAR_HIT_TOLERANCE_DEG,
              planningTimeMs:state.handReactionTimeMs,
              reactionTimeMs:state.handReactionTimeMs,
              cursorReactionTimeMs:state.cursorReactionTimeMs,
              leftHandMovementOnsetMs:state.leftHandMovementOnsetMs,
              rightHandMovementOnsetMs:state.rightHandMovementOnsetMs,
              leftOnsetCandidateMs:state.leftOnsetCandidateMs,
              rightOnsetCandidateMs:state.rightOnsetCandidateMs,
              onsetDisplacementThreshold:BIM_DISCOVERY_ONSET_DISPLACEMENT,
              onsetConfirmationFrames:BIM_DISCOVERY_ONSET_CONFIRM_FRAMES,
              launchDisplacementThreshold:BIM_DISCOVERY_LAUNCH_DISPLACEMENT,
              launchConfirmationFrames:BIM_DISCOVERY_LAUNCH_CONFIRM_FRAMES,
              leftAttemptLaunchMs:state.leftAttemptLaunchMs,
              rightAttemptLaunchMs:state.rightAttemptLaunchMs,
              movementWindowStartMs:state.movementWindowStartMs,
              cursorFeedbackLockedDuringPlanning:true,
              cursorFeedbackHiddenDuringMovement:false,
              feedbackMode:"continuous_cursor_then_frozen_angular_endpoint",
              feedbackType:timedOut ? "none_timeout" : "angular_only_projected_to_target_radius",
              feedbackFreezePlannedMs:timedOut ? 0 : BIM_DISCOVERY_ENDPOINT_FEEDBACK_MS,
              frozenEndpointX:(!timedOut && angularFeedbackPoint) ? angularFeedbackPoint.x : null,
              frozenEndpointY:(!timedOut && angularFeedbackPoint) ? angularFeedbackPoint.y : null,
              cursorFeedbackUnlockMs:state.cursorFeedbackUnlockMs,
              commitCursorTaskX:state.commitCursorTaskX,
              commitCursorTaskY:state.commitCursorTaskY,
              commitCursorDirectionDeg:Math.hypot(state.commitCursorTaskX ?? 0,state.commitCursorTaskY ?? 0) > 0.001
                ? angleDeg(state.commitCursorTaskX,state.commitCursorTaskY) : null,
              commitTargetDirectionalErrorDeg:Math.hypot(state.commitCursorTaskX ?? 0,state.commitCursorTaskY ?? 0) > 0.001
                ? wrapAngleDeg(angleDeg(state.commitCursorTaskX,state.commitCursorTaskY)-targetAngleDeg(state.currentTargetDirection)) : null,
              commitLeftHandX:state.commitLeftHandX,
              commitLeftHandY:state.commitLeftHandY,
              commitRightHandX:state.commitRightHandX,
              commitRightHandY:state.commitRightHandY,
              movementTimeMs,
              pathLength:state.currentPathLength,
              normalizedPathLength:state.currentPathLength/TARGET_ECCENTRICITY,
              peakRadialDistance:state.peakRadialDistance,
              peakTaskX:state.peakTaskX,
              peakTaskY:state.peakTaskY,
              timeoutFailureType,
              cursorEffectDetected:timedOut ? cursorEffectDetected : null,
              cursorEffectRadiusThreshold:timedOut ? BIM_DISCOVERY_CURSOR_EFFECT_RADIUS : null,
              peakCursorAngleDeg:timedOut ? timeoutPeakAngleDeg : null,
              peakCursorDirectionalErrorDeg:timedOut ? timeoutPeakDirectionalErrorDeg : null,
              directionCorrectAtTimeout:timedOut ? directionCorrectAtTimeout : null,
              timeoutDirectionToleranceDeg:timedOut ? ANGULAR_HIT_TOLERANCE_DEG : null,
              initialDirectionDeg,initialDirectionalErrorDeg,
              initialLeftHandDirectionDeg,initialRightHandDirectionDeg,
            };

            state.reaches.push(record);
            state.completedReaches += 1;
            addEvent(timedOut ? "discovery_attempt_timeout" : "discovery_attempt_endpoint",record);

            if (timedOut) {
              state.timedOutReaches += 1;
              if (timeoutFailureType === "correct_direction_too_slow") {
                showTooSlowWarning(700);
              } else {
                showTryAnotherMovementWarning(700);
              }
              addEvent("discovery_timeout_feedback",{
                mapping:trial.mapping,
                targetDirection:state.currentTargetDirection,
                timeoutFailureType,
                cursorEffectDetected,
                peakRadialDistance:timeoutPeakRadialDistance,
                peakCursorAngleDeg:timeoutPeakAngleDeg,
                peakCursorDirectionalErrorDeg:timeoutPeakDirectionalErrorDeg,
                directionCorrectAtTimeout,
                cursorEffectRadiusThreshold:BIM_DISCOVERY_CURSOR_EFFECT_RADIUS,
                directionToleranceDeg:ANGULAR_HIT_TOLERANCE_DEG,
              });
              state.phase="return_home";
              state.leftHomeEnterMs=null;
              state.rightHomeEnterMs=null;
            } else {
              /* Match the single-hand FEEDBACK condition: stop the live cursor at
                 the first target-radius crossing, preserve only its ANGLE, and
                 freeze that angle on the fixed target radius for 500 ms. The raw
                 interpolated crossing and full frame trajectory remain unchanged. */
              state.feedbackEndpointTaskX=angularFeedbackPoint.x;
              state.feedbackEndpointTaskY=angularFeedbackPoint.y;
              state.feedbackEndpointMs=endpointMs;
              state.feedbackEndpointSource="angular_only_projected_to_target_radius";
              state.feedbackHit=hit;
              state.endpointFeedbackStartMs=tMs;
              addEvent("discovery_angular_feedback_onset",{
                mapping:trial.mapping,
                targetDirection:state.currentTargetDirection,
                rawEndpointX:endpointX,
                rawEndpointY:endpointY,
                endpointAngleDeg,
                endpointAngularErrorDeg,
                x:state.feedbackEndpointTaskX,
                y:state.feedbackEndpointTaskY,
                angularHit:hit ? 1 : 0,
                angularHitToleranceDeg:ANGULAR_HIT_TOLERANCE_DEG,
                feedbackType:"angular_only_projected_to_target_radius",
                plannedFreezeMs:BIM_DISCOVERY_ENDPOINT_FEEDBACK_MS,
              });
              if (hit) {
                state.collectSparkleStartMs=tMs;
                state.lastCollectedDirection=state.currentTargetDirection;
                playTreasureCollectSound();
              }
              state.phase="attempt_feedback";
            }
          }
        } else {
          const target=TARGETS[state.currentTargetDirection];

          if (trial.noFeedback) {
            /* Aftereffect probe mirrors the single-hand NO-FEEDBACK logic:
               hide the cursor during outbound movement and register the endpoint
               at the first target-radius crossing, whether or not it hit the gem. */
            const crossedTargetRadius=Number.isFinite(prevR) && prevR < TARGET_ECCENTRICITY && currentR >= TARGET_ECCENTRICITY;
            if (crossedTargetRadius) {
              let endpointX=taskX, endpointY=taskY, endpointMs=tMs;
              if ([prevX,prevY,prevR].every(Number.isFinite)) {
                const denom=currentR-prevR;
                const frac=Math.abs(denom)>1e-9
                  ? clamp((TARGET_ECCENTRICITY-prevR)/denom,0,1)
                  : 1;
                endpointX=prevX+frac*(taskX-prevX);
                endpointY=prevY+frac*(taskY-prevY);
                endpointMs=Number.isFinite(prevT) ? prevT+frac*(tMs-prevT) : tMs;
              }
              const endpointDistanceToTarget=distance2d(endpointX,endpointY,target.x,target.y);
              const hit=endpointDistanceToTarget <= TARGET_HIT_RADIUS;
              const endpointAngleDeg=angleDeg(endpointX,endpointY);
              const endpointDirectionalErrorDeg=wrapAngleDeg(endpointAngleDeg-targetAngleDeg(state.currentTargetDirection));
              const acquisitionTimeMs=Math.max(0,endpointMs-state.targetOnsetMs-state.trackingPausedTotalMs);
              const pausedAfterOnset=Math.max(0,state.trackingPausedTotalMs-(state.trackingPausedAtMovementOnsetMs ?? 0));
              const movementTimeMs=Number.isFinite(state.handMovementOnsetMs)
                ? Math.max(0,endpointMs-state.handMovementOnsetMs-pausedAfterOnset)
                : null;

              let initialDirectionDeg=null, initialDirectionalErrorDeg=null;
              let initialLeftHandDirectionDeg=null, initialRightHandDirectionDeg=null;
              if ([state.earlyTaskX,state.earlyTaskY,state.movementOnsetTaskX,state.movementOnsetTaskY].every(Number.isFinite)) {
                const dx=state.earlyTaskX-state.movementOnsetTaskX, dy=state.earlyTaskY-state.movementOnsetTaskY;
                if (Math.hypot(dx,dy)>.001) {
                  initialDirectionDeg=angleDeg(dx,dy);
                  initialDirectionalErrorDeg=wrapAngleDeg(initialDirectionDeg-targetAngleDeg(state.currentTargetDirection));
                }
              }
              if ([state.earlyLeftX,state.earlyLeftY,state.movementOnsetLeftX,state.movementOnsetLeftY].every(Number.isFinite)) {
                const dx=state.earlyLeftX-state.movementOnsetLeftX,dy=state.earlyLeftY-state.movementOnsetLeftY;
                if (Math.hypot(dx,dy)>.001) initialLeftHandDirectionDeg=angleDeg(dx,dy);
              }
              if ([state.earlyRightX,state.earlyRightY,state.movementOnsetRightX,state.movementOnsetRightY].every(Number.isFinite)) {
                const dx=state.earlyRightX-state.movementOnsetRightX,dy=state.earlyRightY-state.movementOnsetRightY;
                if (Math.hypot(dx,dy)>.001) initialRightHandDirectionDeg=angleDeg(dx,dy);
              }

              const record={
                mapping:trial.mapping,targetDirection:state.currentTargetDirection,
                noFeedback:true,hit,timedOut:false,
                planningTimeMs:state.handReactionTimeMs,reactionTimeMs:state.handReactionTimeMs,cursorReactionTimeMs:state.cursorReactionTimeMs,
                movementTimeMs,acquisitionTimeMs,pathLength:state.currentPathLength,
                normalizedPathLength:state.currentPathLength/TARGET_ECCENTRICITY,
                endpointX,endpointY,endpointAngleDeg,endpointDirectionalErrorDeg,endpointDistanceToTarget,
                initialDirectionDeg,initialDirectionalErrorDeg,initialLeftHandDirectionDeg,initialRightHandDirectionDeg,
              };
              state.reaches.push(record);
              state.completedReaches += 1;
              /* Same neutral collection event as the single-hand no-feedback task:
                 it marks trial completion but is not contingent on accuracy. */
              state.collectSparkleStartMs=tMs;
              state.lastCollectedDirection=state.currentTargetDirection;
              playTreasureCollectSound();
              addEvent("aftereffect_no_feedback_endpoint",record);
              state.phase="collected";
            }
          } else {
            /* Pre-baseline midpoint FEEDBACK now matches the single-hand angular-slice
               architecture. The first outbound target-radius crossing ends the attempt
               whether or not the cursor is inside the gem. This prevents a miss from
               being followed by a return-to-HOME and a second reach on the same trial. */
            const crossedTargetRadius=
              Number.isFinite(prevR) &&
              prevR < TARGET_ECCENTRICITY &&
              currentR >= TARGET_ECCENTRICITY;

            /* Also mirror the single-hand baseline's single-attempt guard:
               once a meaningful outbound excursion has occurred, returning to HOME
               before target radius ends the attempt instead of allowing a retry. */
            const returnedHomeBeforeTargetRadius=
              Number.isFinite(state.peakRadialDistance) &&
              state.peakRadialDistance >= ABORT_MIN_EXCURSION &&
              currentR <= HOME_RADIUS &&
              !crossedTargetRadius;

            if (returnedHomeBeforeTargetRadius) {
              const pausedAfterOnset=Math.max(
                0,
                state.trackingPausedTotalMs-(state.trackingPausedAtMovementOnsetMs ?? 0)
              );
              const outboundElapsedMs=Number.isFinite(state.handMovementOnsetMs)
                ? Math.max(0,tMs-state.handMovementOnsetMs-pausedAfterOnset)
                : null;
              const failureRecord={
                mapping:trial.mapping,
                targetDirection:state.currentTargetDirection,
                noFeedback:false,
                hit:false,
                timedOut:true,
                failureReason:"returned_home_before_target_distance",
                planningTimeMs:state.handReactionTimeMs,
                reactionTimeMs:state.handReactionTimeMs,
                cursorReactionTimeMs:state.cursorReactionTimeMs,
                outboundElapsedMs,
                peakRadialDistance:state.peakRadialDistance,
                peakTaskX:state.peakTaskX,
                peakTaskY:state.peakTaskY,
                peakAngleDeg:
                  [state.peakTaskX,state.peakTaskY].every(Number.isFinite)
                    ? angleDeg(state.peakTaskX,state.peakTaskY)
                    : null,
              };
              state.reaches.push(failureRecord);
              state.timedOutReaches += 1;
              state.completedReaches += 1;
              addEvent("baseline_reach_failed",failureRecord);
              state.phase="return_home";
              state.leftHomeEnterMs=null;
              state.rightHomeEnterMs=null;
            } else if (crossedTargetRadius) {
              let endpointX=taskX, endpointY=taskY, endpointMs=tMs;
              if ([prevX,prevY,prevR].every(Number.isFinite)) {
                const denom=currentR-prevR;
                const frac=Math.abs(denom)>1e-9
                  ? clamp((TARGET_ECCENTRICITY-prevR)/denom,0,1)
                  : 1;
                endpointX=prevX+frac*(taskX-prevX);
                endpointY=prevY+frac*(taskY-prevY);
                endpointMs=Number.isFinite(prevT) ? prevT+frac*(tMs-prevT) : tMs;
              }

              const endpointDistanceToTarget=distance2d(endpointX,endpointY,target.x,target.y);
              const endpointAngleDeg=angleDeg(endpointX,endpointY);
              const endpointDirectionalErrorDeg=
                wrapAngleDeg(endpointAngleDeg-targetAngleDeg(state.currentTargetDirection));
              const hit=angularHitFromError(endpointDirectionalErrorDeg);
              const angularFeedbackPoint=projectedPointAtTargetRadius(endpointAngleDeg);
              const acquisitionTimeMs=Math.max(
                0,
                endpointMs-state.targetOnsetMs-state.trackingPausedTotalMs
              );
              const pausedAfterOnset=Math.max(
                0,
                state.trackingPausedTotalMs-(state.trackingPausedAtMovementOnsetMs ?? 0)
              );
              const movementTimeMs=Number.isFinite(state.handMovementOnsetMs)
                ? Math.max(0,endpointMs-state.handMovementOnsetMs-pausedAfterOnset)
                : null;

              let initialDirectionDeg=null, initialDirectionalErrorDeg=null;
              let initialLeftHandDirectionDeg=null, initialRightHandDirectionDeg=null;
              if ([state.earlyTaskX,state.earlyTaskY,state.movementOnsetTaskX,state.movementOnsetTaskY].every(Number.isFinite)) {
                const dx=state.earlyTaskX-state.movementOnsetTaskX;
                const dy=state.earlyTaskY-state.movementOnsetTaskY;
                if (Math.hypot(dx,dy)>.001) {
                  initialDirectionDeg=angleDeg(dx,dy);
                  initialDirectionalErrorDeg=
                    wrapAngleDeg(initialDirectionDeg-targetAngleDeg(state.currentTargetDirection));
                }
              }
              if ([state.earlyLeftX,state.earlyLeftY,state.movementOnsetLeftX,state.movementOnsetLeftY].every(Number.isFinite)) {
                const dx=state.earlyLeftX-state.movementOnsetLeftX;
                const dy=state.earlyLeftY-state.movementOnsetLeftY;
                if (Math.hypot(dx,dy)>.001) initialLeftHandDirectionDeg=angleDeg(dx,dy);
              }
              if ([state.earlyRightX,state.earlyRightY,state.movementOnsetRightX,state.movementOnsetRightY].every(Number.isFinite)) {
                const dx=state.earlyRightX-state.movementOnsetRightX;
                const dy=state.earlyRightY-state.movementOnsetRightY;
                if (Math.hypot(dx,dy)>.001) initialRightHandDirectionDeg=angleDeg(dx,dy);
              }

              const record={
                mapping:trial.mapping,
                targetDirection:state.currentTargetDirection,
                noFeedback:false,
                hit,
                timedOut:false,
                feedbackMode:"continuous_cursor_then_frozen_angular_endpoint",
                feedbackType:"angular_only_projected_to_target_radius",
                feedbackFreezePlannedMs:BIM_DISCOVERY_ENDPOINT_FEEDBACK_MS,
                planningTimeMs:state.handReactionTimeMs,
                reactionTimeMs:state.handReactionTimeMs,
                cursorReactionTimeMs:state.cursorReactionTimeMs,
                movementTimeMs,
                acquisitionTimeMs,
                pathLength:state.currentPathLength,
                normalizedPathLength:state.currentPathLength/TARGET_ECCENTRICITY,
                endpointX,
                endpointY,
                endpointAngleDeg,
                endpointDirectionalErrorDeg,
                endpointDistanceToTarget,
                angularHit:hit ? 1 : 0,
                angularHitToleranceDeg:ANGULAR_HIT_TOLERANCE_DEG,
                frozenEndpointX:angularFeedbackPoint.x,
                frozenEndpointY:angularFeedbackPoint.y,
                initialDirectionDeg,
                initialDirectionalErrorDeg,
                initialLeftHandDirectionDeg,
                initialRightHandDirectionDeg,
              };

              state.reaches.push(record);
              state.completedReaches += 1;

              /* Match the single-hand FEEDBACK block: collection sound/pop is a
                 neutral endpoint event, not a reward contingent on accuracy. */
              state.collectSparkleStartMs=tMs;
              state.lastCollectedDirection=state.currentTargetDirection;
              playTreasureCollectSound();

              state.feedbackEndpointTaskX=angularFeedbackPoint.x;
              state.feedbackEndpointTaskY=angularFeedbackPoint.y;
              state.feedbackEndpointMs=endpointMs;
              state.feedbackEndpointSource="angular_only_projected_to_target_radius";
              state.feedbackHit=hit;
              state.endpointFeedbackStartMs=tMs;

              addEvent("baseline_angular_feedback_onset",{
                ...record,
                rawEndpointX:endpointX,
                rawEndpointY:endpointY,
                x:state.feedbackEndpointTaskX,
                y:state.feedbackEndpointTaskY,
              });
              state.phase="attempt_feedback";
            }
          }
          if (!trial.noSpeedLimit && state.phase === "moving" && activeElapsed != null && activeElapsed > BIM_TARGET_DEADLINE_MS) {
            state.timedOutReaches += 1;
            state.reaches.push({mapping:trial.mapping,targetDirection:state.currentTargetDirection,noFeedback:trial.noFeedback===true,hit:false,timedOut:true,reactionTimeMs:state.handReactionTimeMs,cursorReactionTimeMs:state.cursorReactionTimeMs});
            addEvent("reach_timeout",{mapping:trial.mapping,targetDirection:state.currentTargetDirection,noFeedback:trial.noFeedback===true});
            state.phase="return_home";
            state.leftHomeEnterMs=null; state.rightHomeEnterMs=null;
          }
        }

        state.previousTaskX=taskX;
        state.previousTaskY=taskY;
        state.previousRadialDistance=currentR;
        state.previousFrameMs=tMs;
      }
      else if (state.phase === "attempt_feedback") {
        if (state.endpointFeedbackStartMs != null && tMs-state.endpointFeedbackStartMs >= BIM_DISCOVERY_ENDPOINT_FEEDBACK_MS) {
          state.phase="return_home";
          state.leftHomeEnterMs=null;
          state.rightHomeEnterMs=null;
        }
      }
      else if (state.phase === "collected") {
        if (state.collectSparkleStartMs != null && tMs-state.collectSparkleStartMs >= BIM_COLLECT_SPARKLE_MS) {
          state.phase="return_home";
          state.leftHomeEnterMs=null; state.rightHomeEnterMs=null;
        }
      }
      else if (state.phase === "return_home" && hold.bothReady) {
        state.targetIndex += 1;
        if (state.targetIndex >= trial.reachesRequired) {
          state.finished=true;
          state.phase="done";
        } else {
          state.phase="launch";
          state.launchStartMs=tMs;
        }
      }

      return {
        mapping:trial.mapping,
        bothHandsDetected: requiredHand === 'Both' ? 1 : null,
        requiredHandDetected:1,
        leftPalmX:leftPalm?.viewX ?? null,leftPalmY:leftPalm?.viewY ?? null,
        rightPalmX:rightPalm?.viewX ?? null,rightPalmY:rightPalm?.viewY ?? null,
        leftHandX:left.x,leftHandY:left.y,rightHandX:right.x,rightHandY:right.y,
        leftViewHomeDistance:home.leftViewHomeDistance,rightViewHomeDistance:home.rightViewHomeDistance,
        leftHandInHome:home.leftInHome?1:0,rightHandInHome:home.rightInHome?1:0,
        leftHomeHoldElapsedMs:hold.leftHoldMs,rightHomeHoldElapsedMs:hold.rightHoldMs,
        taskX:(Number.isFinite(state.cursorOriginTaskX) && (state.phase === "target" || state.phase === "moving" || state.phase === "attempt_feedback" || state.phase === "collected")) ? rawTask.x-state.cursorOriginTaskX : taskX,
        taskY:(Number.isFinite(state.cursorOriginTaskY) && (state.phase === "target" || state.phase === "moving" || state.phase === "attempt_feedback" || state.phase === "collected")) ? rawTask.y-state.cursorOriginTaskY : taskY,
        cursorViewX:taskToView(
          clamp((Number.isFinite(state.cursorOriginTaskX) && (state.phase === "target" || state.phase === "moving" || state.phase === "attempt_feedback" || state.phase === "collected")) ? rawTask.x-state.cursorOriginTaskX : taskX,-1.25,1.25),
          clamp((Number.isFinite(state.cursorOriginTaskY) && (state.phase === "target" || state.phase === "moving" || state.phase === "attempt_feedback" || state.phase === "collected")) ? rawTask.y-state.cursorOriginTaskY : taskY,-1.25,1.25)
        ).x,
        cursorViewY:taskToView(
          clamp((Number.isFinite(state.cursorOriginTaskX) && (state.phase === "target" || state.phase === "moving" || state.phase === "attempt_feedback" || state.phase === "collected")) ? rawTask.x-state.cursorOriginTaskX : taskX,-1.25,1.25),
          clamp((Number.isFinite(state.cursorOriginTaskY) && (state.phase === "target" || state.phase === "moving" || state.phase === "attempt_feedback" || state.phase === "collected")) ? rawTask.y-state.cursorOriginTaskY : taskY,-1.25,1.25)
        ).y,
        phaseCode:state.phase === "collected" ? 7 : state.phase === "attempt_feedback" ? 10 : state.phase === "launch" ? 8 : phaseCode(state.phase),
        targetCode:targetCode(state.currentTargetDirection),
        completedReaches:state.completedReaches,timedOutReaches:state.timedOutReaches,
        targetDeadlineMs:trial.singleAttempt ? null : (trial.noSpeedLimit ? null : BIM_TARGET_DEADLINE_MS),
        movementWindowMs:trial.singleAttempt ? trial.movementWindowMs : null,
        planningTimeMs:state.handReactionTimeMs,
        leftHandMovementOnsetMs:state.leftHandMovementOnsetMs,
        rightHandMovementOnsetMs:state.rightHandMovementOnsetMs,
        leftOnsetCandidateFrames:state.leftOnsetCandidateFrames ?? 0,
        rightOnsetCandidateFrames:state.rightOnsetCandidateFrames ?? 0,
        leftDisplacementFromTrialOrigin:[state.trialLeftOriginX,state.trialLeftOriginY].every(Number.isFinite)
          ? Math.hypot(left.x-state.trialLeftOriginX,left.y-state.trialLeftOriginY) : null,
        rightDisplacementFromTrialOrigin:[state.trialRightOriginX,state.trialRightOriginY].every(Number.isFinite)
          ? Math.hypot(right.x-state.trialRightOriginX,right.y-state.trialRightOriginY) : null,
        discoveryOnsetThreshold:trial.singleAttempt ? BIM_DISCOVERY_ONSET_DISPLACEMENT : null,
        discoveryOnsetConfirmFrames:trial.singleAttempt ? BIM_DISCOVERY_ONSET_CONFIRM_FRAMES : null,
        discoveryLaunchThreshold:trial.singleAttempt ? BIM_DISCOVERY_LAUNCH_DISPLACEMENT : null,
        discoveryLaunchConfirmFrames:trial.singleAttempt ? BIM_DISCOVERY_LAUNCH_CONFIRM_FRAMES : null,
        leftAttemptLaunchMs:state.leftAttemptLaunchMs,
        rightAttemptLaunchMs:state.rightAttemptLaunchMs,
        movementWindowStartMs:state.movementWindowStartMs,
        cursorFeedbackLocked:trial.singleAttempt && state.phase === "target" ? 1 : 0,
        liveCursorVisible:trial.singleAttempt
          ? ((state.phase === "moving" || state.phase === "attempt_feedback") ? 1 : 0)
          : (trial.noFeedback && state.phase === "moving" ? 0 : 1),
        cursorFeedbackMode:trial.singleAttempt
          ? "continuous_cursor_then_frozen_angular_endpoint"
          : (trial.noFeedback ? "no_outbound_cursor_no_endpoint_feedback" : "continuous"),
        cursorFeedbackUnlockMs:state.cursorFeedbackUnlockMs,
        commitCursorTaskX:state.commitCursorTaskX,
        commitCursorTaskY:state.commitCursorTaskY,
        feedbackEndpointTaskX:state.feedbackEndpointTaskX,
        feedbackEndpointTaskY:state.feedbackEndpointTaskY,
        currentPathLength:state.currentPathLength,fps:state.fps,
      };
    }


    /* ========================================================
     * CONTINUOUS CALIBRATION
     * ======================================================== */

    if (trial.kind === "continuous_calibration") {
      const activePalm = trial.hand === "Left" ? leftPalm : rightPalm;
      const position = CALIBRATION_SEQUENCE[state.stepIndex] ?? null;
      const target = position != null
        ? getCalibrationTarget(trial.hand, position)
        : null;

      if (state.introStartMs == null) state.introStartMs = tMs;
      const introElapsedMs = Math.max(0, tMs - state.introStartMs);
      if (introElapsedMs < CALIBRATION_INTRO_MS) {
        return {
          activeHand: trial.hand,
          calibrationIntro: 1,
          calibrationIntroElapsedMs: introElapsedMs,
          calibrationStep: state.stepIndex,
          calibrationPosition: position,
          calibrationTargetX: target?.x ?? null,
          calibrationTargetY: target?.y ?? null,
          calibrationTargetDistance: null,
          calibrationOnTarget: 0,
          calibrationHoldElapsedMs: 0,
          calibrationComplete: 0,
          leftPalmX: leftPalm?.viewX ?? null,
          leftPalmY: leftPalm?.viewY ?? null,
          rightPalmX: rightPalm?.viewX ?? null,
          rightPalmY: rightPalm?.viewY ?? null,
          fps: state.fps,
        };
      }

      const wrongHandMotionActive = updateHandMotionGuard(state, trial, leftPalm, rightPalm, tMs);

      /* Calibration pauses whenever the requested hand is unavailable. If the
         opposite hand is clearly visible, or if both are visible but the opposite
         hand is clearly the one moving, give a specific wrong-hand warning. */
      if (wrongHandMotionActive) {
        state.holdStartMs = null;
        state.trackingRecoverySinceMs = null;
        if (state.trackingMissingSinceMs == null || state.trackingIssueType !== "wrong_motion") {
          state.trackingMissingSinceMs = tMs - WRONG_HAND_WARNING_MS;
          state.trackingIssueType = "wrong_motion";
        }
        if (!state.trackingOverlayShown) {
          state.trackingOverlayShown = true;
          setTrackingLossOverlay(true, "wrong", trial.hand);
          addEvent("calibration_wrong_hand_motion", {
            hand: trial.hand, stepIndex: state.stepIndex, issueType: "wrong_motion", thresholdMs: WRONG_HAND_WARNING_MS
          });
        }
        return {
          activeHand: trial.hand,
          calibrationStep: state.stepIndex,
          calibrationPosition: position,
          calibrationTargetX: target?.x ?? null,
          calibrationTargetY: target?.y ?? null,
          calibrationTargetDistance: null,
          calibrationOnTarget: 0,
          calibrationHoldElapsedMs: 0,
          calibrationComplete: 0,
          leftPalmX: leftPalm?.viewX ?? null,
          leftPalmY: leftPalm?.viewY ?? null,
          rightPalmX: rightPalm?.viewX ?? null,
          rightPalmY: rightPalm?.viewY ?? null,
          fps: state.fps,
        };
      }

      if (activePalm == null) {
        const oppositePalm = trial.hand === "Left" ? rightPalm : leftPalm;
        const issueType = oppositePalm != null ? "wrong" : "missing";
        const warningThreshold = issueType === "wrong" ? WRONG_HAND_WARNING_MS : TRACKING_LOSS_THRESHOLD_MS;
        state.holdStartMs = null;
        state.trackingRecoverySinceMs = null;
        if (state.trackingMissingSinceMs == null || state.trackingIssueType !== issueType) {
          state.trackingMissingSinceMs = tMs;
          state.trackingIssueType = issueType;
        }
        if (tMs - state.trackingMissingSinceMs >= warningThreshold && !state.trackingOverlayShown) {
          state.trackingOverlayShown = true;
          setTrackingLossOverlay(true, issueType, trial.hand);
          addEvent(issueType === "wrong" ? "calibration_wrong_hand" : "calibration_tracking_loss_started", {
            hand: trial.hand, stepIndex: state.stepIndex, issueType, thresholdMs: warningThreshold
          });
        }
        return {
          activeHand: trial.hand,
          calibrationStep: state.stepIndex,
          calibrationPosition: position,
          calibrationTargetX: target?.x ?? null,
          calibrationTargetY: target?.y ?? null,
          calibrationTargetDistance: null,
          calibrationOnTarget: 0,
          calibrationHoldElapsedMs: 0,
          calibrationComplete: 0,
          leftPalmX: leftPalm?.viewX ?? null,
          leftPalmY: leftPalm?.viewY ?? null,
          rightPalmX: rightPalm?.viewX ?? null,
          rightPalmY: rightPalm?.viewY ?? null,
          fps: state.fps,
        };
      }

      if (state.trackingMissingSinceMs != null) {
        const recoveryThresholdMs = (state.trackingIssueType === "wrong" || state.trackingIssueType === "wrong_motion")
          ? WRONG_HAND_WARNING_MS
          : TRACKING_LOSS_THRESHOLD_MS;
        const prolonged = state.trackingOverlayShown || tMs - state.trackingMissingSinceMs >= recoveryThresholdMs;
        if (prolonged) {
          if (state.trackingRecoverySinceMs == null) {
            state.trackingRecoverySinceMs = tMs;
          }
          if (tMs - state.trackingRecoverySinceMs < TRACKING_RECOVERY_STABLE_MS) {
            return {
              activeHand: trial.hand,
              calibrationStep: state.stepIndex,
              calibrationPosition: position,
              calibrationTargetX: target?.x ?? null,
              calibrationTargetY: target?.y ?? null,
              calibrationTargetDistance: null,
              calibrationOnTarget: 0,
              calibrationHoldElapsedMs: 0,
              calibrationComplete: 0,
              leftPalmX: leftPalm?.viewX ?? null,
              leftPalmY: leftPalm?.viewY ?? null,
              rightPalmX: rightPalm?.viewX ?? null,
              rightPalmY: rightPalm?.viewY ?? null,
              fps: state.fps,
            };
          }
          addEvent("calibration_tracking_issue_recovered", {
            hand: trial.hand,
            stepIndex: state.stepIndex,
            issueType: state.trackingIssueType,
            stableRecoveryMs: TRACKING_RECOVERY_STABLE_MS,
          });
        }
        state.trackingMissingSinceMs = null;
        state.trackingRecoverySinceMs = null;
        state.trackingIssueType = null;
        if (state.trackingOverlayShown) {
          state.trackingOverlayShown = false;
          setTrackingLossOverlay(false);
        }
      }

      let onTarget = false;
      let targetDistance = null;
      let holdElapsedMs = 0;

      if (activePalm != null && target != null) {
        targetDistance = distance2d(
          activePalm.viewX,
          activePalm.viewY,
          target.x,
          target.y
        );

        onTarget = targetDistance <= CALIBRATION_TARGET_RADIUS;
      }

      if (onTarget) {
        if (state.holdStartMs == null) {
          state.holdStartMs = tMs;
        }

        holdElapsedMs = tMs - state.holdStartMs;

        if (holdElapsedMs >= CALIBRATION_SAMPLE_DELAY_MS && activePalm != null) {
          const xKey = `${position}X`;
          const yKey = `${position}Y`;
          state.samples[xKey]?.push(activePalm.viewX);
          state.samples[yKey]?.push(activePalm.viewY);
        }

        if (holdElapsedMs >= CALIBRATION_HOLD_MS) {
          addEvent("calibration_step_complete", {
            hand: trial.hand,
            position,
            stepIndex: state.stepIndex,
          });

          state.stepIndex += 1;
          state.holdStartMs = null;

          if (state.stepIndex >= CALIBRATION_SEQUENCE.length) {
            state.calibrationComplete = true;
            state.finished = true;
            if (!state.calibrationChimePlayed) {
              state.calibrationChimePlayed = true;
              playTreasureChime("calibration");
            }
          }
        }
      } else {
        state.holdStartMs = null;
      }

      return {
        activeHand: trial.hand,
        calibrationStep: state.stepIndex,
        calibrationPosition: position,
        calibrationTargetX: target?.x ?? null,
        calibrationTargetY: target?.y ?? null,
        calibrationTargetDistance: targetDistance,
        calibrationOnTarget: onTarget ? 1 : 0,
        calibrationHoldElapsedMs: holdElapsedMs,
        calibrationComplete: state.calibrationComplete ? 1 : 0,

        leftPalmX: leftPalm?.viewX ?? null,
        leftPalmY: leftPalm?.viewY ?? null,
        rightPalmX: rightPalm?.viewX ?? null,
        rightPalmY: rightPalm?.viewY ?? null,
        fps: state.fps,
      };
    }


    /* ========================================================
     * SINGLE-HAND BASELINE REACHING
     * ======================================================== */

    if (isReachingTrial(trial)) {
      const activePalm = trial.hand === "Left" ? leftPalm : rightPalm;

      const wrongHandMotionActive = updateHandMotionGuard(state, trial, leftPalm, rightPalm, tMs);

      /* Tracking / hand-choice safeguard. Brief gaps pause timing. If only the
         opposite hand is visible, or if both are visible but the opposite hand
         clearly dominates the movement, show a specific warning. */
      if (wrongHandMotionActive) {
        const issueType = "wrong_motion";
        if (state.trackingMissingSinceMs == null || state.trackingIssueType !== issueType) {
          state.trackingMissingSinceMs = tMs - WRONG_HAND_WARNING_MS;
          state.trackingRecoverySinceMs = null;
          state.trackingPhaseAtLoss = state.phase;
          state.trackingIssueType = issueType;
          if (state.phase === "moving") {
            state.lastTaskX = null;
            state.lastTaskY = null;
          }
        }
        if (!state.trackingOverlayShown) {
          state.trackingOverlayShown = true;
          setTrackingLossOverlay(true, "wrong", trial.hand);
          state.trackingInvalidPending = state.trackingPhaseAtLoss === "moving";
          if (state.trackingPhaseAtLoss === "home" || state.trackingPhaseAtLoss === "return_home" || state.trackingPhaseAtLoss === "return_home_invalid") {
            state.homeEnterMs = null;
          }
          addEvent("wrong_hand_motion_started", {
            hand: trial.hand, feedback: trial.feedback, targetDirection: state.currentTargetDirection,
            phase: state.trackingPhaseAtLoss, issueType, thresholdMs: WRONG_HAND_WARNING_MS
          });
        }
        return makeTrackingPausedDerived(trial, state, false, true);
      }

      if (activePalm == null) {
        const oppositePalm = trial.hand === "Left" ? rightPalm : leftPalm;
        const issueType = oppositePalm != null ? "wrong" : "missing";
        const warningThreshold = issueType === "wrong" ? WRONG_HAND_WARNING_MS : TRACKING_LOSS_THRESHOLD_MS;

        if (state.trackingMissingSinceMs == null || state.trackingIssueType !== issueType) {
          state.trackingMissingSinceMs = tMs;
          state.trackingRecoverySinceMs = null;
          state.trackingPhaseAtLoss = state.phase;
          state.trackingIssueType = issueType;
          if (state.phase === "moving") {
            state.lastTaskX = null;
            state.lastTaskY = null;
          }
        }

        const missingElapsedMs = Math.max(0, tMs - state.trackingMissingSinceMs);
        if (missingElapsedMs >= warningThreshold) {
          state.trackingRecoverySinceMs = null;
          if (!state.trackingOverlayShown) {
            state.trackingOverlayShown = true;
            setTrackingLossOverlay(true, issueType, trial.hand);
            state.trackingInvalidPending = state.trackingPhaseAtLoss === "moving";
            if (state.trackingPhaseAtLoss === "home" || state.trackingPhaseAtLoss === "return_home" || state.trackingPhaseAtLoss === "return_home_invalid") {
              state.homeEnterMs = null;
            }
            addEvent(issueType === "wrong" ? "wrong_hand_started" : "tracking_loss_started", {
              hand: trial.hand,
              feedback: trial.feedback,
              targetDirection: state.currentTargetDirection,
              phase: state.trackingPhaseAtLoss,
              issueType,
              thresholdMs: warningThreshold,
            });
          }
        }

        return makeTrackingPausedDerived(
          trial,
          state,
          false,
          state.trackingOverlayShown
        );
      }

      if (state.trackingMissingSinceMs != null) {
        const missingStartMs = state.trackingMissingSinceMs;
        const missingElapsedMs = Math.max(0, tMs - missingStartMs);
        const issueType = state.trackingIssueType || "missing";
        const issueThresholdMs = (issueType === "wrong" || issueType === "wrong_motion") ? WRONG_HAND_WARNING_MS : TRACKING_LOSS_THRESHOLD_MS;
        const prolonged = missingElapsedMs >= issueThresholdMs || state.trackingOverlayShown;

        if (prolonged) {
          if (state.trackingRecoverySinceMs == null) {
            state.trackingRecoverySinceMs = tMs;
            return makeTrackingPausedDerived(trial, state, true, true);
          }
          if (tMs - state.trackingRecoverySinceMs < TRACKING_RECOVERY_STABLE_MS) {
            return makeTrackingPausedDerived(trial, state, true, true);
          }
        }

        const interval = {
          startMs: missingStartMs,
          endMs: tMs,
          durationMs: Math.max(0, tMs - missingStartMs),
          prolonged: prolonged ? 1 : 0,
          phase: state.trackingPhaseAtLoss,
          issueType,
        };
        state.trackingPauseIntervals.push(interval);

        if (prolonged) {
          addEvent((issueType === "wrong" || issueType === "wrong_motion") ? "wrong_hand_recovered" : "tracking_loss_recovered", {
            hand: trial.hand,
            feedback: trial.feedback,
            targetDirection: state.currentTargetDirection,
            phase: state.trackingPhaseAtLoss,
            issueType,
            trackingLossDurationMs: interval.durationMs,
            stableRecoveryMs: TRACKING_RECOVERY_STABLE_MS,
          });
        }

        if (prolonged && state.trackingInvalidPending) {
          const invalidRecord = {
            hand: trial.hand,
            feedback: trial.feedback,
            repetition: trial.repetition,
            targetDirection: state.currentTargetDirection,
            invalid: true,
            invalidReason: issueType === "wrong" ? "wrong_hand_outbound" : "tracking_loss_outbound",
            trackingIssueType: issueType,
            timedOut: false,
            trackingLossDurationMs: interval.durationMs,
            trackingLossThresholdMs: issueThresholdMs,
            trackingRecoveryStableMs: TRACKING_RECOVERY_STABLE_MS,
          };
          state.reaches.push(invalidRecord);
          state.trackingLossInvalidReaches += 1;
          addEvent("reach_invalid_tracking_loss", invalidRecord);

          state.phase = "return_home_invalid";
          state.returnGuideStartMs = tMs;
          state.homeEnterMs = null;
          state.movementOnsetMs = null;
          state.movementOnsetFrames = 0;
          state.movementOnsetTaskX = null;
          state.movementOnsetTaskY = null;
          state.earlySampleTaskX = null;
          state.earlySampleTaskY = null;
          state.earlySampleMs = null;
          state.firstCrossingMs = null;
          state.feedbackFreezeStartMs = null;
          state.feedbackFreezeX = null;
          state.feedbackFreezeY = null;
          state.currentPathLength = 0;
          state.outboundPathLength = 0;
          state.peakRadialDistance = 0;
          state.peakTaskX = null;
          state.peakTaskY = null;
          state.peakMs = null;
          state.peakPathLength = 0;
          state.previousRadialDistance = null;
          state.previousTaskX = null;
          state.previousTaskY = null;
          state.previousFrameMs = null;
          state.lastTaskX = null;
          state.lastTaskY = null;
          state.currentInitialRecord = null;
        } else if (prolonged && (state.trackingPhaseAtLoss === "home" || state.trackingPhaseAtLoss === "return_home" || state.trackingPhaseAtLoss === "return_home_invalid")) {
          state.homeEnterMs = null;
        }

        state.trackingMissingSinceMs = null;
        state.trackingRecoverySinceMs = null;
        state.trackingIssueType = null;
        state.trackingPhaseAtLoss = null;
        state.trackingInvalidPending = false;
        if (state.trackingOverlayShown) {
          state.trackingOverlayShown = false;
          setTrackingLossOverlay(false);
        }
      }

      const normalized = normalizedHandPosition(trial.hand, activePalm);
      const handX = normalized.x;
      const handY = normalized.y;

      if (handX == null || handY == null) {
        return {
          activeHand: trial.hand,
          handDetected: 1,
          handX,
          handY,
          taskX: null,
          taskY: null,
          radialDistance: null,
          cursorViewX: null,
          cursorViewY: null,
          cursorVisible: 0,
          phaseCode: -1,
          targetCode: 0,
          completedReaches: state.completedReaches,
          fps: state.fps,
        };
      }

      /* Intuitive/veridical single-hand controller. */
      const taskX = handX;
      const taskY = handY;

      const radialDistance = distance2d(taskX, taskY, 0, 0);
      const handInHome = radialDistance <= HOME_RADIUS;

      const displayX = clamp(taskX, -1.25, 1.25);
      const displayY = clamp(taskY, -1.25, 1.25);
      const cursorView = taskToView(displayX, displayY);


      /* ---------------- HOME ---------------- */
      if (state.phase === "home") {
        if (handInHome) {
          if (state.homeEnterMs == null) state.homeEnterMs = tMs;

          if (tMs - state.homeEnterMs >= HOME_HOLD_MS) {
            state.currentTargetDirection = state.targetSequence[state.targetIndex];
            state.targetOnsetMs = tMs;
            state.movementOnsetMs = null;
            state.movementOnsetFrames = 0;
            state.movementOnsetTaskX = null;
            state.movementOnsetTaskY = null;
            state.earlySampleTaskX = null;
            state.earlySampleTaskY = null;
            state.earlySampleMs = null;
            state.firstCrossingMs = null;
            state.feedbackFreezeStartMs = null;
            state.feedbackFreezeX = null;
            state.feedbackFreezeY = null;
            state.tooSlowWarningUntilMs = null;
            state.collectSparkleStartMs = null;
            state.praiseStartMs = null;
            state.praiseIndex = null;
            state.returnGuideStartMs = null;
            state.currentPathLength = 0;
            state.outboundPathLength = 0;
            state.peakRadialDistance = radialDistance;
            state.peakTaskX = taskX;
            state.peakTaskY = taskY;
            state.peakMs = tMs;
            state.peakPathLength = 0;
            state.previousRadialDistance = radialDistance;
            state.lastTaskX = taskX;
            state.lastTaskY = taskY;
            state.currentInitialRecord = null;
            state.phase = "target";

            addEvent("target_onset", {
              hand: trial.hand,
              feedback: trial.feedback,
              targetDirection: state.currentTargetDirection,
              reachNumber: state.targetIndex,
            });
          }
        } else {
          state.homeEnterMs = null;
        }
      }


      /* ---------------- TARGET / WAIT FOR MOVEMENT ---------------- */
      else if (state.phase === "target") {
        if (radialDistance > MOVEMENT_ONSET_RADIUS) {
          state.movementOnsetFrames += 1;
        } else {
          state.movementOnsetFrames = 0;
        }

        if (state.movementOnsetFrames >= MOVEMENT_ONSET_FRAMES) {
          state.movementOnsetMs = tMs;
          state.movementOnsetTaskX = taskX;
          state.movementOnsetTaskY = taskY;
          state.earlySampleTaskX = null;
          state.earlySampleTaskY = null;
          state.earlySampleMs = null;
          state.phase = "moving";
          state.previousTaskX = taskX;
          state.previousTaskY = taskY;
          state.previousRadialDistance = radialDistance;
          state.previousFrameMs = tMs;
          state.lastTaskX = taskX;
          state.lastTaskY = taskY;

          addEvent("movement_onset", {
            hand: trial.hand,
            feedback: trial.feedback,
            targetDirection: state.currentTargetDirection,
            reactionTimeMs: elapsedExcludingTracking(state, state.targetOnsetMs, state.movementOnsetMs),
          });
        }

        if (elapsedExcludingTracking(state, state.targetOnsetMs, tMs) > MAX_WAIT_FOR_MOVEMENT_MS) {
          state.timedOutReaches += 1;
          state.reaches.push({
            hand: trial.hand,
            feedback: trial.feedback,
            targetDirection: state.currentTargetDirection,
            timedOut: true,
            failureReason: "no_movement",
          });

          addEvent("reach_timeout", {
            hand: trial.hand,
            feedback: trial.feedback,
            targetDirection: state.currentTargetDirection,
            failureReason: "no_movement",
          });

          state.completedReaches += 1;
          state.phase = "return_home";
          state.returnGuideStartMs = tMs;
          state.homeEnterMs = null;
        }
      }


      /* ---------------- MOVING / INITIAL RADIAL CROSSING ---------------- */
      else if (state.phase === "moving") {
        /* Provisional 100-ms heading sample; formal onset is recomputed offline. */
        if (
          state.earlySampleMs == null &&
          state.movementOnsetMs != null &&
          elapsedExcludingTracking(state, state.movementOnsetMs, tMs) >= EARLY_HEADING_MS
        ) {
          state.earlySampleTaskX = taskX;
          state.earlySampleTaskY = taskY;
          state.earlySampleMs = tMs;
        }

        if (state.lastTaskX != null && state.lastTaskY != null) {
          state.currentPathLength += distance2d(
            state.lastTaskX,
            state.lastTaskY,
            taskX,
            taskY
          );
        }

        state.lastTaskX = taskX;
        state.lastTaskY = taskY;

        if (
          state.peakRadialDistance == null ||
          radialDistance > state.peakRadialDistance + PEAK_UPDATE_EPSILON
        ) {
          state.peakRadialDistance = radialDistance;
          state.peakTaskX = taskX;
          state.peakTaskY = taskY;
          state.peakMs = tMs;
          state.peakPathLength = state.currentPathLength;
        }

        const outboundElapsedMs = elapsedExcludingTracking(state, state.movementOnsetMs, tMs);

        /* If the hand comes back to HOME before reaching target distance,
           end the attempt immediately instead of allowing a later movement
           on the opposite side of the workspace to count as the endpoint. */
        if (
          state.peakRadialDistance >= ABORT_MIN_EXCURSION &&
          radialDistance <= HOME_RADIUS &&
          state.firstCrossingMs == null
        ) {
          state.timedOutReaches += 1;
          state.reaches.push({
            hand: trial.hand,
            feedback: trial.feedback,
            targetDirection: state.currentTargetDirection,
            timedOut: true,
            failureReason: "returned_home_before_target_distance",
            onlineReactionTimeMs: elapsedExcludingTracking(state, state.targetOnsetMs, state.movementOnsetMs),
            outboundElapsedMs,
            peakRadialDistance: state.peakRadialDistance,
            peakTaskX: state.peakTaskX,
            peakTaskY: state.peakTaskY,
            peakAngleDeg: (
              Number.isFinite(state.peakTaskX) && Number.isFinite(state.peakTaskY)
            ) ? angleDeg(state.peakTaskX, state.peakTaskY) : null,
          });

          addEvent("reach_failed", {
            hand: trial.hand,
            feedback: trial.feedback,
            targetDirection: state.currentTargetDirection,
            failureReason: "returned_home_before_target_distance",
            outboundElapsedMs,
            peakRadialDistance: state.peakRadialDistance,
            peakTaskX: state.peakTaskX,
            peakTaskY: state.peakTaskY,
          });

          state.completedReaches += 1;
          state.phase = "return_home";
          state.returnGuideStartMs = tMs;
          state.homeEnterMs = tMs;
        }

        /* Register the angular endpoint only when movement amplitude
           reaches the target-center radius (0.70). Behavioral undershoots remain
           in the raw trajectory and are stored as failed reaches with peak extent. */
        else {
          const crossedTargetDistance =
            state.previousRadialDistance != null &&
            state.previousRadialDistance < TARGET_ECCENTRICITY &&
            radialDistance >= TARGET_ECCENTRICITY;

          /* V5.18 angular-slice endpoint:
             The scientific/game endpoint is defined only when movement amplitude
             reaches the target radius. Interpolate the crossing between the two
             webcam samples so angular feedback is not shifted outward by a low
             (~30 Hz) sampling rate. Undershoots remain stored as behavioral
             failures with their peak excursion; they are not converted into a
             pseudo-endpoint. */
          let endpointX = null;
          let endpointY = null;
          let endpointRadialDistance = null;
          let endpointMs = null;
          let endpointPathLength = null;
          let endpointSource = null;
          let slowOutbound = false;

          if (
            crossedTargetDistance &&
            Number.isFinite(state.previousTaskX) &&
            Number.isFinite(state.previousTaskY) &&
            Number.isFinite(state.previousRadialDistance)
          ) {
            const r0 = state.previousRadialDistance;
            const r1 = radialDistance;
            const denom = r1 - r0;
            const frac = Math.abs(denom) > 1e-9
              ? clamp((TARGET_ECCENTRICITY - r0) / denom, 0, 1)
              : 1;

            endpointX = state.previousTaskX + frac * (taskX - state.previousTaskX);
            endpointY = state.previousTaskY + frac * (taskY - state.previousTaskY);
            endpointRadialDistance = Math.hypot(endpointX, endpointY);
            endpointMs = state.previousFrameMs != null
              ? state.previousFrameMs + frac * (tMs - state.previousFrameMs)
              : tMs;

            const currentStep = (
              Number.isFinite(state.previousTaskX) && Number.isFinite(state.previousTaskY)
            ) ? distance2d(state.previousTaskX, state.previousTaskY, taskX, taskY) : 0;
            endpointPathLength = Math.max(
              0,
              state.currentPathLength - currentStep + frac * currentStep
            );
            endpointSource = "interpolated_target_radius_crossing";
          } else if (crossedTargetDistance) {
            endpointX = taskX;
            endpointY = taskY;
            endpointRadialDistance = radialDistance;
            endpointMs = tMs;
            endpointPathLength = state.currentPathLength;
            endpointSource = "target_radius_crossing";
          }

          if (endpointSource != null && state.firstCrossingMs == null) {
            state.firstCrossingMs = endpointMs;
            state.outboundPathLength = endpointPathLength;

            const observedAngle = angleDeg(endpointX, endpointY);
            const intendedAngle = targetAngleDeg(state.currentTargetDirection);
            const angularError = wrapAngleDeg(observedAngle - intendedAngle);
            const target = TARGETS[state.currentTargetDirection];
            const distanceToTarget = distance2d(endpointX, endpointY, target.x, target.y);

            const onlineMovementTimeMs = elapsedExcludingTracking(state, state.movementOnsetMs, endpointMs);
            const tooSlow = onlineMovementTimeMs > TOO_SLOW_MT_MS;

            const onsetToEndpointDistance = (
              Number.isFinite(state.movementOnsetTaskX) && Number.isFinite(state.movementOnsetTaskY)
            ) ? distance2d(state.movementOnsetTaskX, state.movementOnsetTaskY, endpointX, endpointY) : null;

            const pathEfficiency = (
              Number.isFinite(endpointPathLength) && Number.isFinite(onsetToEndpointDistance) && onsetToEndpointDistance > 1e-6
            ) ? endpointPathLength / onsetToEndpointDistance : null;

            let earlyHeading100msDegOnline = null;
            let earlyAngularError100msDegOnline = null;
            let earlySampleElapsedMsOnline = null;
            let correctionBenefitDegOnline = null;
            let headingChangeEarlyToEndpointDegOnline = null;

            if (
              Number.isFinite(state.movementOnsetTaskX) && Number.isFinite(state.movementOnsetTaskY) &&
              Number.isFinite(state.earlySampleTaskX) && Number.isFinite(state.earlySampleTaskY) &&
              Number.isFinite(state.earlySampleMs)
            ) {
              const earlyDx = state.earlySampleTaskX - state.movementOnsetTaskX;
              const earlyDy = state.earlySampleTaskY - state.movementOnsetTaskY;
              if (Math.hypot(earlyDx, earlyDy) > 1e-6) {
                earlyHeading100msDegOnline = angleDeg(earlyDx, earlyDy);
                earlyAngularError100msDegOnline = wrapAngleDeg(earlyHeading100msDegOnline - intendedAngle);
                earlySampleElapsedMsOnline = elapsedExcludingTracking(state, state.movementOnsetMs, state.earlySampleMs);
                correctionBenefitDegOnline = Math.abs(earlyAngularError100msDegOnline) - Math.abs(angularError);
                headingChangeEarlyToEndpointDegOnline = wrapAngleDeg(observedAngle - earlyHeading100msDegOnline);
              }
            }

            if (tooSlow) {
              state.tooSlowWarningUntilMs = tMs + TOO_SLOW_WARNING_MS;
              showTooSlowWarning(TOO_SLOW_WARNING_MS);
              addEvent("too_slow_warning", {
                hand: trial.hand,
                feedback: trial.feedback,
                targetDirection: state.currentTargetDirection,
                onlineMovementTimeMs,
                thresholdMs: TOO_SLOW_MT_MS,
              });
            }

            /* Neutral collection event: same pop/sparkle and sound in both
               feedback and no-feedback conditions. It is not performance-contingent. */
            state.collectSparkleStartMs = tMs;
            playTreasureCollectSound();

            state.currentInitialRecord = {
              hand: trial.hand,
              feedback: trial.feedback,
              repetition: trial.repetition,
              targetDirection: state.currentTargetDirection,
              targetAngleDeg: intendedAngle,
              initialCrossingX: endpointX,
              initialCrossingY: endpointY,
              initialCrossingAngleDeg: observedAngle,
              initialAngularErrorDeg: angularError,
              initialRadialDistance: endpointRadialDistance,
              initialDistanceToTarget: distanceToTarget,
              angularHit: angularHitFromError(angularError) ? 1 : 0,
              angularHitToleranceDeg: ANGULAR_HIT_TOLERANCE_DEG,
              initialEndpointSource: endpointSource,
              initialEndpointWasUndershoot: 0,
              slowOutbound,

              /* These online timing values are useful for task control/QC only.
                 Formal RT/MT should still be recomputed from raw trajectories. */
              reactionTimeMs: elapsedExcludingTracking(state, state.targetOnsetMs, state.movementOnsetMs),
              onlineReactionTimeMs: elapsedExcludingTracking(state, state.targetOnsetMs, state.movementOnsetMs),
              timeToTargetDistanceMs: onlineMovementTimeMs,
              onlineTimeToTargetDistanceMs: onlineMovementTimeMs,
              tooSlow,
              tooSlowThresholdMs: TOO_SLOW_MT_MS,
              tooSlowWarningMs: tooSlow ? TOO_SLOW_WARNING_MS : 0,

              outboundPathLength: state.outboundPathLength,
              onsetToEndpointDistance,
              pathEfficiency,
              normalizedOutboundPathLengthLegacy: state.outboundPathLength / TARGET_ECCENTRICITY,

              earlyHeading100msDegOnline,
              earlyAngularError100msDegOnline,
              earlySampleElapsedMsOnline,
              correctionBenefitDegOnline,
              headingChangeEarlyToEndpointDegOnline,

              endpointX,
              endpointY,
              endpointAngleDeg: observedAngle,
              endpointAngularErrorDeg: angularError,
              endpointRadialDistance,
              endpointDistanceToTarget: distanceToTarget,
              endpointInsideTarget: angularHitFromError(angularError) ? 1 : 0,

              peakRadialDistance: state.peakRadialDistance,
            };

            addEvent("initial_endpoint_registered", {
              ...state.currentInitialRecord,
            });

            if (trial.feedback) {
              /* V5.18: the live hand-position dot was visible throughout the
                 outbound reach. Freeze only the registered ANGLE at the fixed
                 target radius for 500 ms; do not reveal radial overshoot. */
              state.feedbackFreezeStartMs = tMs;
              const angularFeedbackPoint = projectedPointAtTargetRadius(observedAngle);
              state.feedbackFreezeX = angularFeedbackPoint.x;
              state.feedbackFreezeY = angularFeedbackPoint.y;

              addEvent("feedback_endpoint_freeze_onset", {
                hand: trial.hand,
                targetDirection: state.currentTargetDirection,
                rawEndpointX: endpointX,
                rawEndpointY: endpointY,
                x: state.feedbackFreezeX,
                y: state.feedbackFreezeY,
                endpointAngularErrorDeg: angularError,
                endpointDistanceToTarget: distanceToTarget,
                angularHit: angularHitFromError(angularError) ? 1 : 0,
                angularHitToleranceDeg: ANGULAR_HIT_TOLERANCE_DEG,
                feedbackType: "angular_only_projected_to_target_radius",
                initialEndpointSource: endpointSource,
                plannedFreezeMs: FEEDBACK_FREEZE_MS,
              });

              state.phase = "feedback_freeze";
            } else {
              state.reaches.push({
                ...state.currentInitialRecord,
                finalX: null,
                finalY: null,
                finalAngularErrorDeg: null,
                absoluteErrorReductionDeg: null,
                correctionWindowMs: 0,
                correctionSuccess: null,
                correctionLatencyMs: null,
                correctionEndReason: null,
                timedOut: false,
              });

              state.completedReaches += 1;
              state.phase = "return_home";
              state.returnGuideStartMs = tMs;
              state.homeEnterMs = null;
            }
          } else if (
            outboundElapsedMs > MAX_OUTBOUND_MS
          ) {
            state.timedOutReaches += 1;
            state.reaches.push({
              hand: trial.hand,
              feedback: trial.feedback,
              targetDirection: state.currentTargetDirection,
              timedOut: true,
              failureReason: "outbound_did_not_reach_target_radius",
              onlineReactionTimeMs: elapsedExcludingTracking(state, state.targetOnsetMs, state.movementOnsetMs),
              outboundElapsedMs,
              peakRadialDistance: state.peakRadialDistance,
              peakTaskX: state.peakTaskX,
              peakTaskY: state.peakTaskY,
              peakAngleDeg: (
                Number.isFinite(state.peakTaskX) && Number.isFinite(state.peakTaskY)
              ) ? angleDeg(state.peakTaskX, state.peakTaskY) : null,
            });

            addEvent("reach_timeout", {
              hand: trial.hand,
              feedback: trial.feedback,
              targetDirection: state.currentTargetDirection,
              failureReason: "outbound_did_not_reach_target_radius",
              outboundElapsedMs,
              peakRadialDistance: state.peakRadialDistance,
              peakTaskX: state.peakTaskX,
              peakTaskY: state.peakTaskY,
            });

            state.completedReaches += 1;
            state.phase = "return_home";
            state.returnGuideStartMs = tMs;
            state.homeEnterMs = null;
          }
        }

        state.previousRadialDistance = radialDistance;
        state.previousTaskX = taskX;
        state.previousTaskY = taskY;
        state.previousFrameMs = tMs;
      }


      /* ---------------- FROZEN ENDPOINT FEEDBACK ---------------- */
      else if (state.phase === "feedback_freeze") {
        const freezeElapsedMs = elapsedExcludingTracking(state, state.feedbackFreezeStartMs, tMs);

        if (freezeElapsedMs >= FEEDBACK_FREEZE_MS) {
          const finalRecord = makeFeedbackFreezeRecord(state, tMs);

          state.reaches.push(finalRecord);
          state.completedReaches += 1;
          addEvent("feedback_endpoint_freeze_end", finalRecord);

          state.phase = "return_home";
          state.returnGuideStartMs = tMs;
          state.homeEnterMs = null;
        }
      }

      /* ---------------- RETURN HOME ---------------- */
      else if (state.phase === "return_home" || state.phase === "return_home_invalid") {
        const repeatSameTarget = state.phase === "return_home_invalid";
        if (handInHome) {
          if (state.homeEnterMs == null) state.homeEnterMs = tMs;

          const warningFinished = repeatSameTarget ||
            state.tooSlowWarningUntilMs == null || tMs >= state.tooSlowWarningUntilMs;

          if (tMs - state.homeEnterMs >= HOME_HOLD_MS && warningFinished) {
            if (!repeatSameTarget && state.completedReaches >= reachesRequiredForTrial(trial)) {
              state.phase = "done";
              state.finished = true;

              addEvent("block_complete", {
                hand: trial.hand,
                feedback: trial.feedback,
                completedReaches: state.completedReaches,
                trackingLossInvalidReaches: state.trackingLossInvalidReaches,
              });

              if (!state.blockChimePlayed) {
                state.blockChimePlayed = true;
                if (trial.id === "fb_left_2") {
                  state.taskCompleteChimePlayed = true;
                  playTreasureChime("complete");
                }
              }
            } else {
              if (!repeatSameTarget) state.targetIndex += 1;

              state.currentTargetDirection = null;
              state.targetOnsetMs = null;
              state.movementOnsetMs = null;
              state.movementOnsetFrames = 0;
              state.movementOnsetTaskX = null;
              state.movementOnsetTaskY = null;
              state.earlySampleTaskX = null;
              state.earlySampleTaskY = null;
              state.earlySampleMs = null;
              state.firstCrossingMs = null;
              state.feedbackFreezeStartMs = null;
              state.feedbackFreezeX = null;
              state.feedbackFreezeY = null;
              state.tooSlowWarningUntilMs = null;
              state.collectSparkleStartMs = null;
              state.returnGuideStartMs = null;
              state.currentPathLength = 0;
              state.outboundPathLength = 0;
              state.peakRadialDistance = 0;
              state.peakTaskX = null;
              state.peakTaskY = null;
              state.peakMs = null;
              state.peakPathLength = 0;
              state.previousRadialDistance = null;
              state.previousTaskX = null;
              state.previousTaskY = null;
              state.previousFrameMs = null;
              state.lastTaskX = null;
              state.lastTaskY = null;
              state.currentInitialRecord = null;
              state.phase = "home";
              /* The next frame can present the next (or repeated) target immediately
                 once the hand has returned and held at home. */
              state.homeEnterMs = tMs - HOME_HOLD_MS;
            }
          }
        } else {
          state.homeEnterMs = null;
        }
      }

      /* Cursor visibility rule. */
      let cursorVisible = false;
      let renderedCursorView = cursorView;

      if (state.phase === "home" || state.phase === "target") {
        cursorVisible = true;
      } else if (trial.feedback && state.phase === "moving") {
        /* V5.14.1: continuous veridical cursor during the outbound feedback reach. */
        cursorVisible = true;
      } else if (trial.feedback && state.phase === "feedback_freeze") {
        /* Freeze the registered endpoint; do not follow the returning hand. */
        cursorVisible = true;
        if (state.feedbackFreezeX != null && state.feedbackFreezeY != null) {
          const fx = clamp(state.feedbackFreezeX, -1.25, 1.25);
          const fy = clamp(state.feedbackFreezeY, -1.25, 1.25);
          renderedCursorView = taskToView(fx, fy);
        }
      } else if (state.phase === "return_home" || state.phase === "return_home_invalid") {
        const guideReady =
          state.returnGuideStartMs != null &&
          elapsedExcludingTracking(state, state.returnGuideStartMs, tMs) >= RETURN_GUIDE_DELAY_MS;

        /* V5.17 FINAL hybrid return guidance:
           - Far from HOME: radial-only ring, so the outbound endpoint direction
             is not revealed immediately.
           - Near HOME (<= 0.20 task units): also show the true XY cursor so the
             participant can make the final placement and hold inside HOME.
           The radial ring remains visible in both stages. */
        cursorVisible = guideReady && radialDistance <= RETURN_SHOW_CURSOR_RADIUS;
      }

      const frameDerived = {
        activeHand: trial.hand,
        handDetected: 1,
        handX,
        handY,
        taskX,
        taskY,
        radialDistance,
        handInHome: handInHome ? 1 : 0,

        cursorViewX: renderedCursorView.x,
        cursorViewY: renderedCursorView.y,
        cursorVisible: cursorVisible ? 1 : 0,

        phaseCode: phaseCode(state.phase),
        targetCode: targetCode(state.currentTargetDirection),
        completedReaches: state.completedReaches,
        currentPathLength: state.currentPathLength,
        feedback: trial.feedback ? 1 : 0,
        practice: trial.kind === "practice_reaching" ? 1 : 0,
        targetHitRadius: TARGET_HIT_RADIUS,
        feedbackFreezeElapsedMs: state.feedbackFreezeStartMs != null
          ? elapsedExcludingTracking(state, state.feedbackFreezeStartMs, tMs)
          : null,
        feedbackCursorVisibleDuringOutbound: trial.feedback ? 1 : 0,
        tooSlowWarningActive:
          state.tooSlowWarningUntilMs != null && tMs < state.tooSlowWarningUntilMs ? 1 : 0,
        collectSparkleElapsedMs: state.collectSparkleStartMs != null ? Math.max(0, tMs - state.collectSparkleStartMs) : null,
        tooSlowThresholdMs: TOO_SLOW_MT_MS,
        trackingPaused: 0,
        trackingLossActive: 0,
        trackingLossInvalidReaches: state.trackingLossInvalidReaches,
        fps: state.fps,
      };
      state.lastGoodDerived = frameDerived;
      return frameDerived;
    }

    return {};
  },


  /* ==========================================================
   * DRAW
   * ========================================================== */

  draw(
    ctx,
    {
      allLandmarks = [],
      allHandedness = [],
      derived,
      state,
      trial,
      canvas,
      tMs,
      setReadout,
    }
  ) {
    ensureResponsiveStage();
    fitStageToViewport();

    const W = canvas.__logicalWidth ?? canvas.clientWidth ?? canvas.width;
    const H = canvas.__logicalHeight ?? canvas.clientHeight ?? canvas.height;

    if (trial.kind === "bimanual_instruction" || trial.kind === "denovo_quiz" || trial.kind === "denovo_explicit_probe") {
      ensureBimanualInstructionOverlay(trial,state);
      setReadoutIfChanged(state,setReadout,"");
      return;
    }

    if (trial.kind === "bimanual_reaching") {
      beginParticipantFacingOverlay(ctx,W);

      /* V5: HOME placement and reaching live on the same treasure-hunt canvas.
         Only the task elements change: HOME beacons fade away, then the chest,
         cursor, and gem appear. No participant-facing text is drawn here. */
      drawTreasureBackground(ctx,W,H);
      const homePhase = state.phase === "home" || state.phase === "return_home" || state.phase === "launch";

      if (homePhase) {
        const scale=Math.min(W,H);
        const r=CALIBRATION_TARGET_RADIUS*scale;
        const leftPalm=getPalmCenter(getHand(allLandmarks,allHandedness,"Left"));
        const rightPalm=getPalmCenter(getHand(allLandmarks,allHandedness,"Right"));
        const launchPct = state.phase === "launch" && state.launchStartMs != null
          ? clamp((tMs-state.launchStartMs)/BIM_HOME_FADE_MS,0,1)
          : 0;
        const beaconAlpha = state.phase === "launch" ? 1-launchPct : 1;
        const leftPct = state.phase === "launch"
          ? 100
          : Math.min(100,Math.round(100*(derived.leftHomeHoldElapsedMs??0)/HOME_HOLD_MS));
        const rightPct = state.phase === "launch"
          ? 100
          : Math.min(100,Math.round(100*(derived.rightHomeHoldElapsedMs??0)/HOME_HOLD_MS));

        ctx.save();
        ctx.globalAlpha=beaconAlpha;
        const leftOnlyTraining = trial.mapping === 'denovo_left_training';
        const rightOnlyTraining = trial.mapping === 'denovo_right_training';
        if (!rightOnlyTraining && Number.isFinite(calibration.left.homeX) && Number.isFinite(calibration.left.homeY)) {
          drawCalibrationBeacon(ctx,calibration.left.homeX*W,calibration.left.homeY*H,r,'home',!!derived.leftHandInHome,leftPct,tMs);
        }
        if (!leftOnlyTraining && Number.isFinite(calibration.right.homeX) && Number.isFinite(calibration.right.homeY)) {
          drawCalibrationBeacon(ctx,calibration.right.homeX*W,calibration.right.homeY*H,r,'home',!!derived.rightHandInHome,rightPct,tMs);
        }
        if (!rightOnlyTraining && leftPalm) drawCalibrationTracker(ctx,leftPalm.viewX*W,leftPalm.viewY*H,!!derived.leftHandInHome,tMs);
        if (!leftOnlyTraining && rightPalm) drawCalibrationTracker(ctx,rightPalm.viewX*W,rightPalm.viewY*H,!!derived.rightHandInHome,tMs);
        ctx.restore();
      } else {
        const home=taskToCanvas(0,0,W,H);
        const collected=state.phase === 'collected';
        const endpointFeedback=state.phase === 'attempt_feedback';
        const outboundMovement=state.phase === 'moving';
        /* Post-baseline aftereffect probe follows the single-hand NO-FEEDBACK
           visual logic: keep the treasure chest visible throughout outbound
           movement, hide it only once the endpoint is registered/collected,
           then show it again as the return-home goal. De novo still hides the
           chest once the outbound movement is committed. */
        const keepChestDuringNoFeedbackOutbound = trial.noFeedback === true && outboundMovement;
        const showChest = !collected && !endpointFeedback &&
          (!outboundMovement || keepChestDuringNoFeedbackOutbound);
        if (showChest) drawTreasureChest(ctx,home.x,home.y,38,false,tMs,true,0);

        if (state.currentTargetDirection) {
          const target=TARGETS[state.currentTargetDirection];
          const p=taskToCanvas(target.x,target.y,W,H);
          const radius=gemVisualRadiusPx(W,H);
          const styleIndex=(state.targetIndex+(String(trial.mapping).startsWith('denovo')?2:0)+(trial.blockIndex||0))%GEM_STYLES.length;
          drawGem(ctx,p.x,p.y,radius,styleIndex,tMs);
          const showNeutralBaselineEndpointSparkle =
            endpointFeedback && trial.mapping === "baseline";
          if (
            (collected || showNeutralBaselineEndpointSparkle || (endpointFeedback && state.feedbackHit)) &&
            state.collectSparkleStartMs != null
          ) {
            drawCollectSparkle(ctx,p.x,p.y,tMs-state.collectSparkleStartMs);
          }
        }

        if (!collected) {
          if (endpointFeedback && Number.isFinite(state.feedbackEndpointTaskX) && Number.isFinite(state.feedbackEndpointTaskY)) {
            const c=taskToCanvas(state.feedbackEndpointTaskX,state.feedbackEndpointTaskY,W,H);
            drawTreasureCompassCursor(ctx,c.x,c.y);
          } else if (trial.singleAttempt && state.phase === "target") {
            /* Discovery planning phase: the visible cursor is deliberately locked
               at the treasure-chest origin. The hidden/veridical mapped cursor is
               still computed and stored internally. */
            drawTreasureCompassCursor(ctx,home.x,home.y);
          } else if (trial.singleAttempt && state.phase === "moving" && Number.isFinite(derived.taskX) && Number.isFinite(derived.taskY)) {
            /* Discovery FEEDBACK condition: continuous mapped cursor is visible
               during outbound movement, but its DISPLAY is capped at the target
               radius. Thus even on a low-FPS frame that jumps across r=0.70, the
               participant never sees the cursor continue beyond the gem radius.
               Raw task/hand coordinates are still stored without this display cap. */
            const liveR=Math.hypot(derived.taskX,derived.taskY);
            const displayScale=(liveR > TARGET_ECCENTRICITY && liveR > 1e-9)
              ? TARGET_ECCENTRICITY/liveR
              : 1;
            const c=taskToCanvas(derived.taskX*displayScale,derived.taskY*displayScale,W,H);
            drawTreasureCompassCursor(ctx,c.x,c.y);
          } else if (trial.noFeedback && state.phase === "moving") {
            /* Aftereffect probe: outbound cursor intentionally hidden. */
          } else if (Number.isFinite(derived.cursorViewX) && Number.isFinite(derived.cursorViewY)) {
            const c=viewToCanvas(derived.cursorViewX,derived.cursorViewY,W,H);
            drawTreasureCompassCursor(ctx,c.x,c.y);
          }
        }

      }

      endParticipantFacingOverlay(ctx);
      setReadoutIfChanged(state,setReadout,"");
      return;
    }


    /* ========================================================
     * CONTINUOUS CALIBRATION DISPLAY
     * ======================================================== */

    if (trial.kind === "continuous_calibration") {
      const activePalm = getPalmCenter(
        getHand(allLandmarks, allHandedness, trial.hand)
      );

      const position = CALIBRATION_SEQUENCE[state.stepIndex] ?? null;
      const target = position != null
        ? getCalibrationTarget(trial.hand, position)
        : null;

      const stepNumber = Math.min(state.stepIndex + 1, CALIBRATION_SEQUENCE.length);
      const holdMs = derived.calibrationHoldElapsedMs ?? 0;
      const holdPct = Math.min(100, Math.round(100 * holdMs / CALIBRATION_HOLD_MS));

      if (derived.calibrationIntro) {
        beginParticipantFacingOverlay(ctx, W);
        drawCalibrationIntro(ctx, W, H, trial.hand, derived.calibrationIntroElapsedMs ?? 0);
        endParticipantFacingOverlay(ctx);
        setReadoutIfChanged(state, setReadout, "");
        return;
      }

      beginParticipantFacingOverlay(ctx, W);
      drawCalibrationTint(ctx, W, H);

      if (target != null) {
        const x = target.x * W;
        const y = target.y * H;
        const radiusPx = CALIBRATION_TARGET_RADIUS * Math.min(W, H);
        drawCalibrationBeacon(
          ctx,
          x,
          y,
          radiusPx,
          position,
          !!derived.calibrationOnTarget,
          holdPct,
          tMs
        );
      }

      if (activePalm != null) {
        drawCalibrationTracker(
          ctx,
          activePalm.viewX * W,
          activePalm.viewY * H,
          !!derived.calibrationOnTarget,
          tMs
        );
      }

      endParticipantFacingOverlay(ctx);

      let status = "Move to the glowing beacon";
      if (!activePalm) {
        const oppositeDetected = getHand(allLandmarks, allHandedness, trial.hand === "Left" ? "Right" : "Left") != null;
        status = oppositeDetected
          ? `Use your ${trial.hand.toLowerCase()} hand`
          : `Show your ${trial.hand.toLowerCase()} hand`;
      } else if (derived.calibrationOnTarget) status = "Hold still";
      if (state.calibrationComplete) status = "Movement space ready!";

      const calibrationReadout = `
        <span style="display:inline-flex;align-items:center;gap:10px;padding:8px 12px;border-radius:14px;background:rgba(5,14,32,.76);border:1px solid rgba(186,218,255,.20);font-size:1rem;">
          <b>${trial.hand.toUpperCase()} HAND</b>
          <span style="opacity:.72;">${stepNumber}/${CALIBRATION_SEQUENCE.length}</span>
          <span style="color:${derived.calibrationOnTarget ? "#9ff6d8" : "#ffe19a"};font-weight:750;">${status}</span>
        </span>
      `;
      setReadoutIfChanged(state, setReadout, calibrationReadout);

      return;
    }


    /* ========================================================
     * SINGLE-HAND REACHING DISPLAY
     * ======================================================== */

    if (isReachingTrial(trial)) {
      /* Keep the repository webcam mirror, but counter-mirror our own canvas UI. */
      beginParticipantFacingOverlay(ctx, W);

      /* Treasure Hunt visual wrapper. Camera tracking continues, but video stays hidden. */
      drawTreasureBackground(ctx, W, H, tMs);

      const homeCanvas = taskToCanvas(0, 0, W, H);
      const homeCanvasX = homeCanvas.x;
      const homeCanvasY = homeCanvas.y;

      const target = state.currentTargetDirection != null ? TARGETS[state.currentTargetDirection] : null;
      const targetCanvas = target != null ? taskToCanvas(target.x, target.y, W, H) : null;
      const targetCanvasX = targetCanvas != null ? targetCanvas.x : null;
      const targetCanvasY = targetCanvas != null ? targetCanvas.y : null;

      /* Keep the chest visible during the outbound slice so the visual start
         position remains available. At collection it disappears briefly, then
         returns as the home goal. */
      const collectionPopActive =
        state.collectSparkleStartMs != null &&
        tMs - state.collectSparkleStartMs >= 0 &&
        tMs - state.collectSparkleStartMs <= GEM_SPARKLE_MS;
      const hideChestForAngularFeedback =
        state.phase === "feedback_freeze" || collectionPopActive;
      const showChest =
        !hideChestForAngularFeedback && (
          state.phase === "home" ||
          state.phase === "target" ||
          state.phase === "moving" ||
          state.phase === "return_home" ||
          state.phase === "return_home_invalid"
        );
      if (showChest) {
        const returning = state.phase === "return_home" || state.phase === "return_home_invalid";
        drawHomeChest(ctx, homeCanvasX, homeCanvasY, !!derived.handInHome, tMs, returning);
      }

      const showTarget = state.currentTargetDirection != null &&
        (state.phase === "target" || state.phase === "moving" || state.phase === "feedback_freeze");

      if (showTarget && targetCanvasX != null) {
        drawGem(ctx, targetCanvasX, targetCanvasY, gemVisualRadiusPx(W, H), gemStyleIndexForReach(trial, state), tMs);
      }

      /* Return radial guidance. The ring is centered on HOME and appears after
         a short delay; its size changes only with distance-to-home. In V5.17 FINAL
         it remains visible even when the near-home XY cursor is also shown. */
      if (state.phase === "return_home" || state.phase === "return_home_invalid") {
        const guideReady =
          state.returnGuideStartMs != null &&
          elapsedExcludingTracking(state, state.returnGuideStartMs, tMs) >= RETURN_GUIDE_DELAY_MS;
        if (guideReady) {
          const homeHoldPct = state.homeEnterMs != null
            ? clamp(elapsedExcludingTracking(state, state.homeEnterMs, tMs) / HOME_HOLD_MS, 0, 1)
            : 0;
          drawReturnRadialGuide(
            ctx, homeCanvasX, homeCanvasY, derived.radialDistance, !!derived.handInHome, homeHoldPct, W, H, tMs
          );
        }
      }

      /* Cursor obeys visibility rules from onFrame(). */
      if (
        derived.cursorVisible &&
        derived.cursorViewX != null &&
        derived.cursorViewY != null
      ) {
        const cursorCanvas = viewToCanvas(derived.cursorViewX, derived.cursorViewY, W, H);
        const cursorCanvasX = cursorCanvas.x;
        const cursorCanvasY = cursorCanvas.y;

        drawTreasureCompassCursor(ctx, cursorCanvasX, cursorCanvasY);
      }

      /* Draw the same neutral collection pop in both conditions, on top of the
         cursor layer so it remains visible during feedback freeze. */
      if (state.collectSparkleStartMs != null && targetCanvasX != null && targetCanvasY != null) {
        drawCollectSparkle(ctx, targetCanvasX, targetCanvasY, tMs - state.collectSparkleStartMs);
      }

      /* Keep the active task screen visually quiet: no long instruction bar. */
      setReadoutIfChanged(state, setReadout, "");

      const displayedCompleted =
        state.completedReaches +
        (trial.feedback && state.phase === "feedback_freeze" && state.currentInitialRecord != null ? 1 : 0);
      const justCollected =
        state.collectSparkleStartMs != null && tMs - state.collectSparkleStartMs <= GEM_SPARKLE_MS;

      if (trial.kind === "practice_reaching") {
        drawProgressBadge(
          ctx, W, H,
          Math.min(displayedCompleted, PRACTICE_REACHES_PER_HAND),
          PRACTICE_REACHES_PER_HAND,
          tMs,
          justCollected,
          "PRACTICE"
        );
      } else {
        const overallCompleted =
          reachingBlockIndex(trial) * REACHES_PER_BLOCK + Math.min(displayedCompleted, REACHES_PER_BLOCK);
        const overallTotal = TOTAL_REACHING_BLOCKS * REACHES_PER_BLOCK;
        drawProgressBadge(
          ctx, W, H,
          overallCompleted,
          overallTotal,
          tMs,
          justCollected,
          "TASK PROGRESS"
        );
      }

      endParticipantFacingOverlay(ctx);
      return;
    }
  },


  /* ==========================================================
   * TRIAL END / SUMMARY
   * ========================================================== */

  onTrialEnd({ frames, trial, state }) {
    setTreasureReachingUiMode(null);
    setTrackingLossOverlay(false);
    removeBimanualOverlay();
    setBimanualTrackingOverlay(false);

    if (trial.kind === "bimanual_instruction") {
      return { page:trial.page, instructionComplete:state.finished === true };
    }

    if (trial.kind === "denovo_quiz") {
      return {
        quizPassed:state.quizPassed === true,
        quizFailed:state.quizFailed === true,
        quizErrorCount:state.quizErrorCount ?? null,
        answers:state.quizAnswers ?? []
      };
    }

    if (trial.kind === "denovo_explicit_probe") {
      return {
        answers:state.probeAnswers ?? [],
        correct:state.probeCorrect ?? [],
        score:Array.isArray(state.probeCorrect) ? state.probeCorrect.filter(Boolean).length : null
      };
    }

    if (trial.kind === "bimanual_reaching") {
      updateBimanualTreasureSummaryFromState(trial,state);
      patchRunnerTreasureCompleteScreen();
      const validReaches=state.reaches.filter(r=>!r.timedOut);
      const successful=trial.noFeedback
        ? state.reaches.filter(r=>r.hit === true)
        : state.reaches.filter(r=>r.hit === true || (!trial.singleAttempt && !r.timedOut));
      const analysisReaches=trial.noFeedback ? validReaches : successful;
      const dynamicPreflightQuality=trial.mapping === "baseline"
        ? bimanualBaselineDynamicQualityMetrics(frames)
        : null;
      return {
        mapping:trial.mapping,
        training:trial.training === true,
        noSpeedLimit:trial.noSpeedLimit === true,
        singleAttempt:trial.singleAttempt === true,
        noFeedback:trial.noFeedback === true,
        movementWindowMs:trial.movementWindowMs ?? null,
        targetPool:trial.targetPool ?? null,
        dynamicPreflightQuality,
        dynamicPreflightPass:dynamicPreflightQuality?.pass ?? null,
        dynamicPreflightFailureReasons:dynamicPreflightQuality?.reasons ?? [],
        blockIndex:trial.blockIndex,
        requestedReaches:trial.reachesRequired,
        blockFinishedNormally:state.finished === true,
        completedReaches:state.completedReaches,
        timedOutReaches:state.timedOutReaches,
        successRate:state.reaches.length ? successful.length/state.reaches.length : null,
        movementWindowExpiredReaches:state.reaches.filter(r=>r.movementWindowExpired === true).length,
        noCursorEffectReaches:state.reaches.filter(r=>r.timeoutFailureType === "no_cursor_effect").length,
        wrongCursorDirectionReaches:state.reaches.filter(r=>r.timeoutFailureType === "wrong_cursor_direction").length,
        correctDirectionTooSlowReaches:state.reaches.filter(r=>r.timeoutFailureType === "correct_direction_too_slow").length,
        meanPlanningTimeMs:bimanualMean(state.reaches.map(r=>r.planningTimeMs)),
        meanReactionTimeMs:bimanualMean(analysisReaches.map(r=>r.reactionTimeMs)),
        meanCursorReactionTimeMs:bimanualMean(analysisReaches.map(r=>r.cursorReactionTimeMs)),
        meanMovementTimeMs:bimanualMean(analysisReaches.map(r=>r.movementTimeMs)),
        meanAcquisitionTimeMs:bimanualMean(analysisReaches.map(r=>r.acquisitionTimeMs)),
        meanAbsoluteInitialDirectionalErrorDeg:bimanualMean(analysisReaches.map(r=>Math.abs(r.initialDirectionalErrorDeg))),
        meanEndpointDirectionalErrorDeg:bimanualMean(analysisReaches.map(r=>r.endpointDirectionalErrorDeg)),
        meanAbsoluteEndpointDirectionalErrorDeg:bimanualMean(analysisReaches.map(r=>Math.abs(r.endpointDirectionalErrorDeg))),
        reaches:state.reaches,
        displayedFPS:state.fps,
      };
    }

    if (trial.kind === "continuous_calibration") {
      const key = handKey(trial.hand);
      const c = calibration[key];

      c.homeX = median(state.samples.homeX);
      c.homeY = median(state.samples.homeY);
      c.leftX = median(state.samples.leftX);
      c.rightX = median(state.samples.rightX);
      c.upY = median(state.samples.upY);
      c.downY = median(state.samples.downY);

      const valid = [
        c.homeX,
        c.homeY,
        c.leftX,
        c.rightX,
        c.upY,
        c.downY,
      ].every((v) => v != null);

      const preflightQuality = calibrationQualityMetrics(
        frames,
        trial.hand,
        state.calibrationComplete,
        valid,
        c
      );

      console.log(`Calibration ${trial.hand}:`, c, preflightQuality);

      return {
        hand: trial.hand,
        calibrationComplete: state.calibrationComplete,
        calibrationValid: valid,
        preflightQuality,
        medianProcessedFPS: preflightQuality.medianProcessedFPS,
        p10ProcessedFPS: preflightQuality.p10ProcessedFPS,
        expectedHandDetectionRate: preflightQuality.expectedHandDetectionRate,
        expectedHandDirectionalDetectionRate: preflightQuality.expectedHandDirectionalDetectionRate,
        longestExpectedHandGapMs: preflightQuality.longestExpectedHandGapMs,
        preflightPass: preflightQuality.pass,
        preflightFailureReasons: preflightQuality.reasons,
        homeX: c.homeX,
        homeY: c.homeY,
        leftX: c.leftX,
        rightX: c.rightX,
        upY: c.upY,
        downY: c.downY,
        homeSampleCount: state.samples.homeX.length,
        leftSampleCount: state.samples.leftX.length,
        rightSampleCount: state.samples.rightX.length,
        upSampleCount: state.samples.upY.length,
        downSampleCount: state.samples.downY.length,
        displayedFPS: state.fps,
      };
    }

    if (isReachingTrial(trial)) {
      const validReaches = state.reaches.filter((r) => !r.timedOut && !r.invalid);

      const mean = (values) => {
        const clean = values.filter((v) => Number.isFinite(v));
        if (!clean.length) return null;
        return clean.reduce((a, b) => a + b, 0) / clean.length;
      };

      const dynamicPreflightQuality = trial.kind === "practice_reaching"
        ? dynamicPracticeQualityMetrics(frames, trial.hand)
        : null;

      return {
        hand: trial.hand,
        phase: trial.kind === "practice_reaching" ? "practice" : "task",
        practice: trial.kind === "practice_reaching",
        feedback: trial.feedback,
        repetition: trial.repetition,
        requestedReaches: reachesRequiredForTrial(trial),
        dynamicPreflightQuality,
        dynamicPreflightPass: dynamicPreflightQuality?.pass ?? null,
        dynamicPreflightFailureReasons: dynamicPreflightQuality?.reasons ?? [],
        completedReaches: state.completedReaches,
        validReaches: validReaches.length,
        timedOutReaches: state.timedOutReaches,
        trackingLossInvalidReaches: state.trackingLossInvalidReaches,
        totalAttemptRecords: state.reaches.length,
        tooSlowReaches: validReaches.filter((r) => r.tooSlow === true).length,
        tooSlowThresholdMs: TOO_SLOW_MT_MS,
        blockFinishedNormally: state.finished,
        meanReactionTimeMs: mean(validReaches.map((r) => r.reactionTimeMs)),
        meanInitialAngularErrorDeg: mean(validReaches.map((r) => r.initialAngularErrorDeg)),
        meanAbsoluteInitialAngularErrorDeg: mean(
          validReaches.map((r) => Math.abs(r.initialAngularErrorDeg))
        ),
        meanEndpointAngularErrorDeg: mean(
          validReaches.map((r) => r.initialAngularErrorDeg)
        ),
        meanAbsoluteEndpointAngularErrorDeg: mean(
          validReaches.map((r) => Math.abs(r.initialAngularErrorDeg))
        ),
        meanFinalAngularErrorDeg: trial.feedback
          ? mean(validReaches.map((r) => r.finalAngularErrorDeg))
          : null,
        feedbackMode: trial.feedback
          ? "locked_cursor_planning_then_continuous_cursor_then_frozen_endpoint"
          : "no_feedback",
        meanFeedbackFreezeMs: trial.feedback
          ? mean(validReaches.map((r) => r.feedbackFreezeMs))
          : null,
        feedbackCorrectionSuccessRate: null,
        meanCorrectionLatencyMs: null,
        meanAbsoluteErrorReductionDeg: null,
        meanPathEfficiency: mean(validReaches.map((r) => r.pathEfficiency)),
        meanEarlyAngularError100msDegOnline: mean(validReaches.map((r) => r.earlyAngularError100msDegOnline)),
        meanAbsoluteEarlyAngularError100msDegOnline: mean(validReaches.map((r) => Math.abs(r.earlyAngularError100msDegOnline))),
        meanCorrectionBenefitDegOnline: mean(validReaches.map((r) => r.correctionBenefitDegOnline)),
        reaches: state.reaches,
        displayedFPS: state.fps,
      };
    }

    return {};
  },
};