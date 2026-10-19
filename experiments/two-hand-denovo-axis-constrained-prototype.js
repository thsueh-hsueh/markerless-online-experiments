import { HAND } from "../js/core/tracker.js";

if (typeof window !== "undefined") {
  window.__bimanualV20Loaded = true;
  console.info("[Bimanual v20 taught-rule FULL] experiment module loaded");
}


/* AXIS-CONSTRAINED PROTOTYPE (separate from V20-FULL production).
 * Experimental constraints: LEFT physically vertical only, RIGHT horizontally only.
 * Off-axis detection is based on individually calibrated normalized coordinates.
 * This prototype retains V20 endpoint feedback, IDE and original formal timing.
 * DEVELOPMENT / PILOT ONLY; verify tracking validity and thresholds before recruitment.
 */
/* V20 — Explicit component-rule teaching, 12-target bimanual learning.
 * Static calibration and the formal v19-13 motor controller are preserved.
 * Active schedule is defined at the bottom of this file; baseline, mystery-zone
 * quiz and final explicit-rule probe are not scheduled.
 * Runner must support state.finished and qualityControl.evaluateTrial.
 * V21: display/teaching redesign + endpoint-based control check.
 * Configure V20_CONFIG below before recruitment (partial-payment text and URL).
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
  if (!img || !img.complete || !img.naturalWidth) {
    // Keep calibration/instruction animations understandable even before the
    // OpenMoji image is decoded or when its CDN is temporarily unavailable.
    ctx.save();ctx.translate(cx,cy);if(hand==='Right')ctx.scale(-1,1);
    ctx.scale(size/100,size/100);ctx.globalAlpha=alpha;
    ctx.fillStyle='#ecf3ff';ctx.strokeStyle='#acc7ef';ctx.lineWidth=2;
    ctx.shadowBlur=10;ctx.shadowColor='rgba(135,180,250,.24)';
    const palm=(x,y,w,h,r)=>{ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,r);
      else ctx.rect(x,y,w,h);ctx.fill();ctx.stroke();};
    palm(-23,-11,46,46,14);
    for(const [x,y,h] of [[-24,-40,37],[-12,-53,48],[0,-57,51],[12,-46,40]])palm(x,y,10,h,5);
    ctx.save();ctx.translate(-24,8);ctx.rotate(-.55);palm(-12,-4,15,34,7);ctx.restore();
    ctx.restore();return true;
  }
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

/* V24: use a single demonstration time course for single- and two-hand intros.
   Home -> LEFT -> Home -> UP is deliberately brief: all real directions
   are still assessed in the subsequent two-hand movement check. */
function v24CalibrationDemoMotion(elapsedMs) {
  const t = clamp(elapsedMs / CALIBRATION_INTRO_MS, 0, 0.999999);
  const path = [
    {start:0.00, end:0.12, from:'home', to:'home'},
    {start:0.12, end:0.32, from:'home', to:'left'},
    {start:0.32, end:0.46, from:'left', to:'left'},
    {start:0.46, end:0.64, from:'left', to:'home'},
    {start:0.64, end:0.76, from:'home', to:'home'},
    {start:0.76, end:0.94, from:'home', to:'up'},
    {start:0.94, end:1.00, from:'up', to:'up'},
  ];
  const segment = path.find(s => t >= s.start && t < s.end) || path[path.length-1];
  const raw = clamp((t-segment.start)/Math.max(1e-6,segment.end-segment.start),0,1);
  const eased = segment.from === segment.to ? raw : 0.5-0.5*Math.cos(Math.PI*raw);
  const hold = segment.from===segment.to && segment.from!=='home';
  return {segment,raw,eased,hold,position:segment.to};
}
function v24CalibrationDemoPoint(hand, motion) {
  const targets = CALIBRATION_TARGETS[hand];
  const a = targets[motion.segment.from], b = targets[motion.segment.to];
  return {x:a.x+(b.x-a.x)*motion.eased,y:a.y+(b.y-a.y)*motion.eased};
}
/* V25: This exact route is shared by the full both-hand calibration and its demo.
   The demo takes the FIRST TWO directional targets (UP then DOWN) and returns HOME. */
const V25_TWO_HAND_CALIBRATION_ROUTE = Object.freeze([
  'home','up','home','down','home','left','home','right','home'
]);
/* V25: preview only the first TWO directions of the actual both-hand route.
   Every outbound/return move uses the same ~0.94–1.04 s eased movement
   as the single-hand calibration intro, so the palms do NOT speed up.
   A single target (per hand) is active throughout each segment. */
const V25_TWO_HAND_DEMO_STEPS = Object.freeze([
  {from:V25_TWO_HAND_CALIBRATION_ROUTE[0],to:V25_TWO_HAND_CALIBRATION_ROUTE[0],durationMs:624},
  {from:V25_TWO_HAND_CALIBRATION_ROUTE[0],to:V25_TWO_HAND_CALIBRATION_ROUTE[1],durationMs:1040},
  {from:V25_TWO_HAND_CALIBRATION_ROUTE[1],to:V25_TWO_HAND_CALIBRATION_ROUTE[1],durationMs:850},
  {from:V25_TWO_HAND_CALIBRATION_ROUTE[1],to:V25_TWO_HAND_CALIBRATION_ROUTE[2],durationMs:936},
  {from:V25_TWO_HAND_CALIBRATION_ROUTE[2],to:V25_TWO_HAND_CALIBRATION_ROUTE[2],durationMs:624},
  {from:V25_TWO_HAND_CALIBRATION_ROUTE[2],to:V25_TWO_HAND_CALIBRATION_ROUTE[3],durationMs:1040},
  {from:V25_TWO_HAND_CALIBRATION_ROUTE[3],to:V25_TWO_HAND_CALIBRATION_ROUTE[3],durationMs:850},
  {from:V25_TWO_HAND_CALIBRATION_ROUTE[3],to:V25_TWO_HAND_CALIBRATION_ROUTE[4],durationMs:936},
  {from:V25_TWO_HAND_CALIBRATION_ROUTE[4],to:V25_TWO_HAND_CALIBRATION_ROUTE[4],durationMs:210},
]);
const V25_TWO_HAND_DEMO_MS = V25_TWO_HAND_DEMO_STEPS.reduce((ms,segment)=>ms+segment.durationMs,0);
function v25TwoHandDemoMotion(elapsedMs) {
  let elapsed=clamp(elapsedMs,0,V25_TWO_HAND_DEMO_MS-0.0001);
  for(const segment of V25_TWO_HAND_DEMO_STEPS) {
    if(elapsed < segment.durationMs) {
      const raw=clamp(elapsed/segment.durationMs,0,1);
      const eased=segment.from===segment.to?raw:demoEase01(raw);
      const hold=segment.from===segment.to;
      return {segment,raw,eased,hold,position:segment.to};
    }
    elapsed-=segment.durationMs;
  }
  const segment=V25_TWO_HAND_DEMO_STEPS[V25_TWO_HAND_DEMO_STEPS.length-1];
  return {segment,raw:1,eased:1,hold:true,position:segment.to};
}
function drawCalibrationIntro(ctx, W, H, hand, elapsedMs) {
  const motion = v24CalibrationDemoMotion(elapsedMs);
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
  const palm = v24CalibrationDemoPoint(hand,motion);
  const hx = palm.x*W, hy=palm.y*H;

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
  if (typeof document !== "undefined" && document.body?.dataset.v20Scene === "formal") { v20Scene(ctx,W,H,"formal"); return; }
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

/* V24: fit the entire Camera check into the actual visible viewport.
   The camera's native 4:3 aspect ratio is preserved; only its max WIDTH is
   changed, and only while #screen-position is the active page. */
let v24CameraFitQueued=false;
function v24FitCameraCheck() {
  if(typeof document==='undefined'||typeof window==='undefined')return;
  const screen=document.getElementById('screen-position');
  if(!screen||!screen.classList.contains('visible'))return;
  const stage=screen.querySelector('#stage');
  const continueButton=screen.querySelector('#btn-position-done');
  if(!stage||!continueButton)return;
  const viewportH=window.visualViewport?.height||window.innerHeight;
  const viewportW=window.visualViewport?.width||window.innerWidth;
  let width=Math.max(150,Math.min(700,viewportW*.92,(viewportH-280)*4/3));
  screen.style.setProperty('--camera-v24-preview-width',`${Math.round(width)}px`);
  let iteration=0;
  function checkFit() {
    if(!screen.classList.contains('visible'))return;
    const stageRect=stage.getBoundingClientRect();
    const buttonBottom=continueButton.getBoundingClientRect().bottom;
    const excess=buttonBottom-(viewportH-12);
    if(excess>1&&iteration++<4&&stageRect.width>150&&stageRect.height>0) {
      width=Math.max(150,width-excess*(stageRect.width/stageRect.height)-10);
      screen.style.setProperty('--camera-v24-preview-width',`${Math.round(width)}px`);
      window.requestAnimationFrame(checkFit);
    }
  }
  window.requestAnimationFrame(checkFit);
}
function v24QueueCameraFit() {
  if(typeof window==='undefined'||v24CameraFitQueued)return;
  v24CameraFitQueued=true;
  window.requestAnimationFrame(()=>{v24CameraFitQueued=false;v24FitCameraCheck();});
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
    body:has(#screen-position.visible) main { max-width:1040px; width:min(98vw,1040px); }
    #screen-position { text-align:center; min-height:100dvh; box-sizing:border-box; padding-bottom:86px; }
    #screen-position > h2 { font-size:2rem; margin:8px 0 2px; }
    #screen-position .camera-performance-reminder { display:none !important; }
    /* The runner's global progress may remain visible under Camera check;
       it is unrelated to hand detection and looks like a green bottom strip. */
    body:has(#screen-position.visible) #screen-position .progress,
    body:has(#screen-position.visible) #screen-position progress,
    body:has(#screen-position.visible) #screen-position .progress-bar,
    body:has(#screen-position.visible) main > .progress,
    body:has(#screen-position.visible) #app > .progress {display:none !important;}
    /* Keep the real palm-landmark preview visible; only hide redundant chrome. */
    #screen-position #position-stage-slot { margin-top:8px; }
    body:has(#screen-position.visible) #stage {
      width:min(96vw,800px,calc((100dvh - 205px) * 4 / 3));
      max-width:100%; margin:6px auto 8px; border-radius:18px;
      box-shadow:0 18px 52px rgba(0,0,0,.28);
    }
    body:has(#screen-position.visible) #live-readout,
    body:has(#screen-position.visible) #trial-timer,
    body:has(#screen-position.visible) #countdown { display:none !important; }

    #treasure-camera-cue {
      width:min(96vw,820px); box-sizing:border-box; margin:4px auto 6px; padding:6px 12px;
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
      width:min(98vw,880px); margin:3px auto 6px; display:flex;
      flex-direction:column; align-items:center; gap:10px;
    }
    #screen-position .treasure-camera-actions {
      width:min(100%,800px); display:flex; justify-content:center; margin:1px auto 0;
      position:static; z-index:1; padding:0; border-radius:0; background:transparent;
      backdrop-filter:none; -webkit-backdrop-filter:none;
    }
    #screen-position .treasure-camera-actions button {
      width:min(100%,360px); margin:0 auto; min-height:50px; border-radius:14px;
      font-weight:900; letter-spacing:.01em;
      box-shadow:0 8px 22px rgba(52,118,255,.22);
    }
    #treasure-camera-mainrow #position-stage-slot { width:min(100%,800px); min-width:0; margin:0 auto; }
    #treasure-camera-mainrow #stage { width:min(100%,800px,calc((100dvh - 215px) * 4 / 3)); margin:0 auto; }
    #treasure-camera-tips {
      width:min(100%,800px); margin:2px auto 0; display:grid !important;
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
      #treasure-camera-mainrow #stage { width:min(100%,730px,calc((100dvh - 205px) * 4 / 3)); }
    }
    @media (max-height:640px) {
      #screen-position > h2 { font-size:1.55rem; }
      #screen-position .camera-performance-reminder { display:none !important; }
      #treasure-camera-cue .camera-hero { grid-template-columns:1fr; min-height:0; }
      #treasure-camera-cue .camera-copy { text-align:center; padding-left:0; }
      #treasure-camera-cue .camera-demo { display:none; }
      #treasure-camera-mainrow #stage { width:min(96vw,660px,calc((100dvh - 165px) * 4 / 3)); }
    }

    /* V24: Camera check must show detection, preview, tips, and Continue without
       vertical scrolling; leave a viewport margin for the runner header. */
    body:has(#screen-position.visible) {overflow-y:hidden !important;}
    #screen-position.visible {min-height:0!important;padding-bottom:8px!important;}
    #screen-position.visible > h2 {font-size:clamp(1.25rem,2.8vh,1.7rem);margin:2px 0 3px;}
    #treasure-camera-cue {margin:2px auto 3px!important;padding:4px 10px!important;}
    #treasure-camera-cue .camera-hero {min-height:57px;gap:10px;}
    #treasure-camera-cue .camera-demo {height:55px;}
    #treasure-camera-cue .camera-title {font-size:1.2rem;}
    #treasure-camera-cue .camera-sub {font-size:.82rem;margin-top:2px;}
    #position-status {min-height:1.1em;margin:2px 0!important;font-size:.92rem;}
    #treasure-camera-mainrow {gap:5px;margin:1px auto 3px!important;}
    #treasure-camera-mainrow #stage {
      width:min(94vw,700px,var(--camera-v24-preview-width,610px))!important;
      max-width:100%;margin:0 auto!important;
    }
    #treasure-camera-tips {gap:5px;margin:1px auto 0!important;}
    #treasure-camera-tips .tip {min-height:32px;padding:5px 7px;font-size:.76rem;}
    #screen-position .treasure-camera-actions button {min-height:42px;}
    @media(max-height:720px) {
      #treasure-camera-cue .camera-demo {display:none!important;}
      #treasure-camera-cue .camera-hero {grid-template-columns:1fr;min-height:42px;}
      #treasure-camera-cue .camera-copy {text-align:center;padding-left:0;}
      #treasure-camera-tips .tip {min-height:28px;padding:3px 5px;}
      #screen-position .treasure-camera-actions button {min-height:38px;}
    }
    @media(max-height:540px) {#treasure-camera-tips {display:none!important;}}

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
    v24QueueCameraFit();
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
        /* The custom bimanual flow owns its own instructions and breaks.
           Skip the runner's generic rest screen between custom-flow trials so
           there is no duplicate or forced auto-start rest. */
        if (done < total) {
          rest.dataset.treasureRestSec = "0";
          rest.dataset.transitionKind = "skipCustom";
          if (h2) h2.textContent = "";
          if (bodyP) bodyP.textContent = "";
          if (art) art.innerHTML = "";
          return;
        }
        rest.dataset.treasureRestSec = "2";
        rest.dataset.transitionKind = "complete";
        if (h2) h2.textContent = "TREASURE HUNT COMPLETE!";
        if (bodyP) bodyP.textContent = "";
        if (art) art.innerHTML = "";
        return;
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
    window.addEventListener('resize',v24QueueCameraFit,{passive:true});
    window.visualViewport?.addEventListener('resize',v24QueueCameraFit,{passive:true});

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
      v24QueueCameraFit();

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
 * BIMANUAL BASELINE -> DE NOVO DISCOVERY -> AFTEREFFECT PROBE V19-13 FULL
 * TWO-DIRECTION / LIVE-FEEDBACK DISCOVERY VERSION
 *
 * Experimental flow:
 * - Pre baseline: 40 reaches total (UP-LEFT / DOWN-RIGHT; 20 each).
 *   The first 8 (4/4) are the dynamic QC gate; the remaining 32 continue
 *   immediately if QC passes.
 * - Mystery-zone comprehension check (4 yes/no questions).
 * - De novo discovery: 200 reaches total.
 *   Targets are BLOCKED in 10-trial runs and alternate between UP-LEFT and
 *   DOWN-RIGHT. The starting target is counterbalanced deterministically by
 *   participant ID when available. Short self-paced breaks occur after
 *   trials 50, 100, and 150.
 * - Post-baseline aftereffect probe: 20 NO-FEEDBACK reaches (10 each), with no motor demonstration.
 * - Final explicit probe of the learned hand-to-cursor component rules.
 *
 * V19-13 discovery + matched baseline feedback:
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
const BIM_BASELINE_QC_REACHES = 8;
const BIM_BASELINE_REMAINING_REACHES = BIM_BASELINE_REACHES - BIM_BASELINE_QC_REACHES;
const BIM_POST_BASELINE_REACHES = 20;
const BIM_DENOVO_BLOCKS = 4;
const BIM_DENOVO_REACHES_PER_BLOCK = 60;
const BIM_DENOVO_TOTAL_REACHES = BIM_DENOVO_BLOCKS * BIM_DENOVO_REACHES_PER_BLOCK;
const BIM_DENOVO_TARGET_BLOCK_SIZE = 10;
const BIM_DENOVO_BREAK_MIN_SEC = 0;
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



function bimanualParticipantCounterbalanceKey() {
  if (typeof window === "undefined") return "";
  try {
    const p = new URLSearchParams(window.location.search);
    return (
      p.get("PROLIFIC_PID") ||
      p.get("prolific_pid") ||
      p.get("participantId") ||
      p.get("participant_id") ||
      p.get("pid") ||
      ""
    );
  } catch {
    return "";
  }
}

function bimanualStableParity(text) {
  let hash = 0;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    hash = ((hash * 31) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2;
}

function makeBlockedBimanualTargetSequence(totalReaches, blockSize, startTarget) {
  const total = Math.max(1, Number(totalReaches) || 1);
  const size = Math.max(1, Number(blockSize) || 1);
  const firstIndex = BIM_TWO_DIRECTION_POOL.indexOf(startTarget);
  let targetIndex = firstIndex >= 0 ? firstIndex : 0;
  const sequence = [];

  while (sequence.length < total) {
    const n = Math.min(size, total - sequence.length);
    sequence.push(...Array(n).fill(BIM_TWO_DIRECTION_POOL[targetIndex]));
    targetIndex = 1 - targetIndex;
  }
  return sequence;
}

const BIM_DENOVO_COUNTERBALANCE_KEY = bimanualParticipantCounterbalanceKey();
const BIM_DENOVO_START_TARGET = BIM_TWO_DIRECTION_POOL[
  BIM_DENOVO_COUNTERBALANCE_KEY
    ? bimanualStableParity(BIM_DENOVO_COUNTERBALANCE_KEY)
    : (Math.random() < 0.5 ? 0 : 1)
];
const BIM_DENOVO_BLOCKED_SEQUENCE = makeBlockedBimanualTargetSequence(
  BIM_DENOVO_TOTAL_REACHES,
  BIM_DENOVO_TARGET_BLOCK_SIZE,
  BIM_DENOVO_START_TARGET
);
const BIM_DENOVO_CHUNKS = Array.from({ length: BIM_DENOVO_BLOCKS }, (_, i) =>
  BIM_DENOVO_BLOCKED_SEQUENCE.slice(
    i * BIM_DENOVO_REACHES_PER_BLOCK,
    (i + 1) * BIM_DENOVO_REACHES_PER_BLOCK
  )
);


function makePreBaselineSplitSequences() {
  /* Build ONE balanced 40-trial order, then split after trial 8.
     This guarantees:
       - full baseline = 20 UP-LEFT / 20 DOWN-RIGHT
       - QC segment = 4 / 4
       - remaining segment = 16 / 16
       - max same-direction run length <= 3 ACROSS the 8->9 boundary. */
  for (let attempt = 0; attempt < 10000; attempt++) {
    const full = makeBimanualTargetSequenceFromPool(
      BIM_BASELINE_REACHES,
      BIM_TWO_DIRECTION_POOL,
      3
    );
    const first = full.slice(0, BIM_BASELINE_QC_REACHES);
    const firstA = first.filter(x => x === BIM_TWO_DIRECTION_POOL[0]).length;
    const firstB = first.filter(x => x === BIM_TWO_DIRECTION_POOL[1]).length;
    if (firstA === 4 && firstB === 4) {
      return {
        qc: first,
        remaining: full.slice(BIM_BASELINE_QC_REACHES),
        full,
      };
    }
  }

  /* Deterministic safety fallback; balanced and run-length safe. */
  const full = Array.from({length:BIM_BASELINE_REACHES}, (_,i) =>
    BIM_TWO_DIRECTION_POOL[i % 2]
  );
  return {
    qc: full.slice(0, BIM_BASELINE_QC_REACHES),
    remaining: full.slice(BIM_BASELINE_QC_REACHES),
    full,
  };
}

const BIM_PRE_BASELINE_SPLIT = makePreBaselineSplitSequences();


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
    targetSequence: Array.isArray(options.targetSequence) ? [...options.targetSequence] : null,
    dynamicQcGate: options.dynamicQcGate === true,
    skipRestAfter: options.skipRestAfter === true,
    baselinePhase: options.baselinePhase ?? null,
    visualReachOffset: Number.isFinite(options.visualReachOffset) ? options.visualReachOffset : 0,
    blockedSchedule: options.blockedSchedule === true,
    blockedStartTarget: options.blockedStartTarget ?? null,
    blockedChunkIndex: Number.isFinite(options.blockedChunkIndex) ? options.blockedChunkIndex : null,
    targetBlockSize: Number.isFinite(options.targetBlockSize) ? options.targetBlockSize : null,
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
    const completedMatch = String(trial.id || '').match(/denovo_break_(\\d+)/);
    const completed = completedMatch ? Number(completedMatch[1]) : null;
    panel.innerHTML = `
      <h2>Take a short break</h2>
      <div class="bim-sub">
        ${Number.isFinite(completed) ? `${completed} of ${BIM_DENOVO_TOTAL_REACHES} Mystery Zone trials complete.<br>` : ''}
        Rest for a moment. Continue when you are ready.
      </div>
      <div class="bim-break-countdown" style="text-align:center;margin:10px 0 18px;color:#b9cce6;font-weight:800;"></div>
      <button type="button" class="bim-main-button" disabled>Continue</button>`;

    const btn = panel.querySelector('.bim-main-button');
    const countdown = panel.querySelector('.bim-break-countdown');
    const started = performance.now();

    const updateBreak = () => {
      const elapsedSec = (performance.now() - started) / 1000;
      const remaining = Math.max(0, BIM_DENOVO_BREAK_MIN_SEC - elapsedSec);
      if (remaining > 0) {
        if (countdown) countdown.textContent = `Continue available in ${Math.ceil(remaining)} s`;
        requestAnimationFrame(updateBreak);
        return;
      }
      if (countdown) countdown.textContent = 'Continue when ready';
      if (btn) btn.disabled = false;
    };
    updateBreak();
    btn?.addEventListener('click',finishInstruction);
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
      state.quizGradedAnswers=[...state.quizAnswers];
      state.quizGradedCorrect=questions.map((q,qi)=>state.quizAnswers[qi]===q.correct);

      /* Freeze the response state once graded so the saved answers and the
         gate decision cannot diverge if a participant clicks again. */
      panel.querySelectorAll('.bim-option').forEach(btn=>{
        btn.disabled=true;
        btn.setAttribute('aria-disabled','true');
      });

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
  const warnings=[];
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

  /* A single long tracking gap is retained as a diagnostic warning but is not
     by itself a hard exclusion. Pilot v19-11 showed that participants could
     fail this metric once, restart, and then complete with excellent tracking.
     Persistent poor detection is still a hard gate through the rate criteria. */
  const trackingGapExceeded =
    longestLeftGapMs>DYNAMIC_PREFLIGHT_MAX_EXPECTED_HAND_GAP_MS ||
    longestRightGapMs>DYNAMIC_PREFLIGHT_MAX_EXPECTED_HAND_GAP_MS ||
    longestBothHandsGapMs>DYNAMIC_PREFLIGHT_MAX_EXPECTED_HAND_GAP_MS;
  if (trackingGapExceeded) warnings.push('dynamic_tracking_gap');

  return {
    pass:reasons.length===0,
    reasons,
    warnings,
    trackingGapExceeded,
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

const legacyExperiment = {
  id: "two-hand-baseline-denovo-centerout-TEST-v19-13-FULL",

  title: "Two-Hand Baseline + De Novo Center-Out — V19-13 FULL",

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

        /* Only the FIRST 8 pre-baseline reaches are the dynamic QC gate.
           Later pre-baseline reaches and the post-baseline probe are never
           retrospectively used to terminate the participant. */
        if (trial.dynamicQcGate === true) {
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

  trials: [],


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
        targetSequence:trial.targetSequence?.length
          ? [...trial.targetSequence]
          : trial.targetPool?.length
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
      // Check BEFORE the legacy target/endpoint handler. An axis violation must
      // never be converted into a successful endpoint on the same video frame.
      if (trial.axisConstrained && (state.phase === 'target' || state.phase === 'moving')) {
        axisFormalViolation(state,trial,left,right,tMs,addEvent);
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
          const styleIndex=((trial.visualReachOffset||0)+state.targetIndex+(String(trial.mapping).startsWith('denovo')?2:0)+(trial.blockIndex||0))%GEM_STYLES.length;
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
        answers:state.quizGradedAnswers ?? state.quizAnswers ?? [],
        gradedAnswers:state.quizGradedAnswers ?? null,
        gradedCorrect:state.quizGradedCorrect ?? null
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
      const dynamicPreflightQuality=trial.dynamicQcGate === true
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
        targetSequence:trial.targetSequence ?? null,
        blockedSchedule:trial.blockedSchedule === true,
        blockedStartTarget:trial.blockedStartTarget ?? null,
        blockedChunkIndex:trial.blockedChunkIndex ?? null,
        targetBlockSize:trial.targetBlockSize ?? null,
        dynamicQcGate:trial.dynamicQcGate === true,
        baselinePhase:trial.baselinePhase ?? null,
        skipRestAfter:trial.skipRestAfter === true,
        dynamicPreflightQuality,
        dynamicPreflightPass:dynamicPreflightQuality?.pass ?? null,
        dynamicPreflightFailureReasons:dynamicPreflightQuality?.reasons ?? [],
        dynamicPreflightWarnings:dynamicPreflightQuality?.warnings ?? [],
        dynamicTrackingGapExceeded:dynamicPreflightQuality?.trackingGapExceeded ?? null,
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
/* ================= AXIS-CONSTRAINED PROTOTYPE SETTINGS =================
 * Values are candidates pending pilot validation. dParallel and dPerp are
 * individually calibrated normalized hand displacements from the SAME target
 * start position. Do not confuse off-axis motor violations with tracking loss.
 */
const AXIS_V1 = Object.freeze({
  absoluteTolerance:0.10,
  relativeTolerance:0.20,
  minimumViolationDisplacement:0.20,
  confirmationMs:80,
  minimumValidFrames:3,
  maxConsecutiveFrameGapMs:220,
  maxPlausibleSpeedPerMs:0.009,
  guidedRetriesPerTarget:2,
  devTrainingReaches:8,
});
function axisIsPrototypeDev() {
  return typeof location!=='undefined' &&
    /^(localhost|127\.0\.0\.1)$/.test(location.hostname) &&
    new URLSearchParams(location.search).get('dev')==='1';
}
function axisTrialMonitor(state,token,displacements,tMs) {
  if(state.axisMonitor?.token!==token) state.axisMonitor={token,
    Left:{last:null,since:null,frames:0,maxOffAxis:0,spikes:0,quarantined:false},
    Right:{last:null,since:null,frames:0,maxOffAxis:0,spikes:0,quarantined:false},
    violation:null};
  const m=state.axisMonitor;
  for(const hand of ['Left','Right']) {
    const d=displacements[hand],h=m[hand];
    if(!d||![d.x,d.y].every(Number.isFinite)){
      h.last=null;h.since=null;h.frames=0;continue;
    }
    const parallel=hand==='Left'?d.y:d.x;
    const perpendicular=hand==='Left'?d.x:d.y;
    const absOff=Math.abs(perpendicular), absAlong=Math.abs(parallel);
    const tolerance=Math.max(AXIS_V1.absoluteTolerance,AXIS_V1.relativeTolerance*absAlong);
    // A nonphysical jump cannot become valid merely by remaining at its new location.
    if(h.quarantined){
      if(h.last&&Math.hypot(d.x-h.last.x,d.y-h.last.y)<=AXIS_V1.absoluteTolerance){
        h.quarantined=false;h.last={t:tMs,x:d.x,y:d.y};
      }
      continue;
    }
    if(h.last){
      const dt=tMs-h.last.t;
      if(!(dt>0)||dt>AXIS_V1.maxConsecutiveFrameGapMs){
        h.since=null;h.frames=0;
      } else if(Math.hypot(d.x-h.last.x,d.y-h.last.y)/dt>AXIS_V1.maxPlausibleSpeedPerMs) {
        h.spikes++;h.since=null;h.frames=0;h.quarantined=true;
        continue;
      }
    }
    h.last={t:tMs,x:d.x,y:d.y};
    h.maxOffAxis=Math.max(h.maxOffAxis,absOff);
    const beyond=absOff>=AXIS_V1.minimumViolationDisplacement && absOff>tolerance;
    if(!beyond){h.since=null;h.frames=0;continue;}
    if(h.since===null){h.since=tMs;h.frames=1;}
    else h.frames++;
    if(!m.violation && h.frames>=AXIS_V1.minimumValidFrames && tMs-h.since>=AXIS_V1.confirmationMs) {
      m.violation={hand,atMs:tMs,perpendicular,parallel,absOffAxis:absOff,
        tolerance,confirmationMs:tMs-h.since,confirmationFrames:h.frames,
        maxLeftOffAxis:m.Left.maxOffAxis,maxRightOffAxis:m.Right.maxOffAxis};
    }
  }
  return m.violation;
}
function axisAddEvent(addEvent,name,data) {
  if(typeof addEvent==='function')addEvent(name,data);
}
function axisV20Violation(state,trial,violation,direction,rule,delta,task,addEvent,tMs) {
  const guided=trial.kind==='v20_practice' && trial.guided;
  const attemptIndex=state.index;
  const retries=guided?(state.axisGuidedRetries??(state.axisGuidedRetries={})):null;
  const retryCount=guided?((retries[attemptIndex]??0)+1):0;
  if(guided)retries[attemptIndex]=retryCount;
  const retrySameTarget=guided && retryCount<=AXIS_V1.guidedRetriesPerTarget;
  const rec={index:attemptIndex,targetDirection:direction,requiredHand:rule.hand,
    outcome:'off_axis_violation',ruleCorrect:false,endpointHit:false,
    offAxisViolation:true,offAxis:violation,
    initialDirectionDeg:null,initialDirectionalErrorDeg:null,
    endpointTaskX:task.x,endpointTaskY:task.y,
    left:{...delta.Left},right:{...delta.Right},tMs,
    guided:guided===true,trainingRetry:retrySameTarget,
    guidedOffAxisAttempt:retryCount||null};
  state.attempts.push(rec);
  state.lastResult=rec;state.phase='feedback';state.feedbackAt=state.clock;
  if(trial.kind==='v20_gate'){
    state.errors++;
    state.index++;
    if(state.index%4===0){
      state.perfectRounds=state.roundCorrect===4?state.perfectRounds+1:0;
      state.roundCorrect=0;
    }
    state.gateTechnicalInvalidForTarget=0;
    axisAddEvent(addEvent,'v20_gate_result',rec);
  }else if(!retrySameTarget){state.index++;}
  axisAddEvent(addEvent,'axis_off_axis_violation',rec);
  if(trial.kind==='v20_practice')axisAddEvent(addEvent,'v20_practice_result',rec);
  return rec;
}
function axisFormalViolation(state,trial,left,right,tMs,addEvent){
  if(!Number.isFinite(state.trialLeftOriginX)||!Number.isFinite(state.trialRightOriginX))return null;
  const delta={Left:{x:left.x-state.trialLeftOriginX,y:left.y-state.trialLeftOriginY},
    Right:{x:right.x-state.trialRightOriginX,y:right.y-state.trialRightOriginY}};
  const violation=axisTrialMonitor(state,`formal:${trial.id}:${state.targetIndex}:${state.targetOnsetMs}`,delta,tMs);
  if(!violation)return null;
  const rec={mapping:trial.mapping,targetDirection:state.currentTargetDirection,
    outcome:'off_axis_violation',offAxisViolation:true,offAxis:violation,
    noFeedback:false,hit:false,timedOut:false,validEndpoint:false,
    reactionTimeMs:state.handReactionTimeMs,planningTimeMs:state.handReactionTimeMs,
    movementTimeMs:null,endpointX:null,endpointY:null,
    endpointDirectionalErrorDeg:null,initialDirectionalErrorDeg:null,
    endedAtMs:tMs,targetIndex:state.targetIndex,
    left:{...delta.Left},right:{...delta.Right}};
  state.reaches.push(rec);
  state.completedReaches+=1; // Counts toward all 240; never silently replace.
  state.phase='return_home';
  state.leftHomeEnterMs=null;state.rightHomeEnterMs=null;
  state.axisFlashUntil=tMs+1400;
  axisAddEvent(addEvent,'axis_off_axis_violation',rec);
  return rec;
}
function axisDebugHud(trial,state) {
  if(!axisIsPrototypeDev()||typeof document==='undefined')return;
  let panel=document.getElementById('axis-prototype-debug');
  if(!panel){
    panel=document.createElement('pre');panel.id='axis-prototype-debug';
    panel.style.cssText='position:fixed;left:10px;bottom:9px;z-index:100090;pointer-events:none;'
      +'padding:10px 12px;color:#eef8fc;background:rgba(3,15,29,.85);border:1px solid #597a93;'
      +'font:12px/1.5 Consolas,monospace;white-space:pre-wrap;max-width:390px;';
    document.body.appendChild(panel);
  }
  if(!trial.axisConstrained){panel.style.display='none';return;}
  panel.style.display='block';
  const m=state.axisMonitor;
  const fmt=(n)=>Number.isFinite(n)?n.toFixed(3):'–';
  const dl=m?.Left?.last??null,dr=m?.Right?.last??null;
  const lOff=dl?Math.abs(dl.x):null,rOff=dr?Math.abs(dr.y):null;
  const lAllowed=dl?Math.max(AXIS_V1.absoluteTolerance,AXIS_V1.relativeTolerance*Math.abs(dl.y)):null;
  const rAllowed=dr?Math.max(AXIS_V1.absoluteTolerance,AXIS_V1.relativeTolerance*Math.abs(dr.x)):null;
  panel.textContent=`AXIS PROTOTYPE · ${trial.kind} · ${state.phase??'–'}\n`+
    `L: dy allowed ${fmt(dl?.y)} | dx off ${fmt(lOff)} | tolerance ${fmt(lAllowed)}\n`+
    `R: dx allowed ${fmt(dr?.x)} | dy off ${fmt(rOff)} | tolerance ${fmt(rAllowed)}\n`+
    `Violated: ${m?.violation?.hand??'no'} | target ${state.currentTargetDirection??state.sequence?.[state.index]??'–'}\n`+
    `Errors: ${state.errors??'–'} | completed ${state.completedReaches??state.index??'–'}\n`+
    `DEV ONLY — never use for participant recruitment`;
}
function axisDrawWarning(ctx,canvas,msg){
  const W=canvas.__logicalWidth??canvas.clientWidth??canvas.width;
  const H=canvas.__logicalHeight??canvas.clientHeight??canvas.height;
  if(!W||!H)return;
  ctx.save();ctx.translate(W,0);ctx.scale(-1,1); // Undo runner's mirror.
  ctx.textAlign='center';ctx.textBaseline='middle';
  const size=Math.max(16,Math.round(Math.min(W,H)*0.035));
  ctx.font=`800 ${size}px system-ui,sans-serif`;
  ctx.fillStyle='#fff0c9';ctx.shadowColor='#391619';ctx.shadowBlur=12;
  ctx.fillText(msg,W*0.5,H*0.13);ctx.restore();
}
/* ================= V22 UI REFINEMENT / V20 ACTIVE PROTOCOL =================
 * V22 modifies visual presentation only; the original formal controller and
 * V21 endpoint-based control-check scoring remain unchanged.
 * Compensation is NOT automatically issued by this client-side script.
 * Default exit opens Prolific in a separate tab, preserving saved experiment
 * data. Set a study-specific exit URL if needed; no completion code is invented.
 */
const AXIS_DYNAMIC_ROUTE=Object.freeze([
  {Left:'home',Right:'home'},
  {Left:'up',Right:'home'}, {Left:'home',Right:'home'},
  {Left:'down',Right:'home'}, {Left:'home',Right:'home'},
  {Left:'home',Right:'left'}, {Left:'home',Right:'home'},
  {Left:'home',Right:'right'}, {Left:'home',Right:'home'},
  {Left:'up',Right:'left'}, {Left:'home',Right:'home'},
]);
const V20_CONFIG = Object.freeze({
  partialPaymentText: 'You will receive partial payment for the time you spent in this study.',
  prolificReturnUrl: 'https://app.prolific.com/', // May be replaced with the study-specific exit URL.
  failureReturnText: 'Please return to your Prolific study page and return your submission. Your partial payment will be arranged separately.',
  gateMaxErrors: 4,
  gateMaxAttempts: 24,
  gatePerfectRounds: 2,
  practiceMovementWindowMs: 5000,
  gateDeadZone: 0.12,
  gateInitialSampleRadii: [0.15,0.20,0.25],
  gateConfirmRadius: 0.35,
  gateOutwardMinMs: 120,
  gateMinMotionFrames: 3,
  gateMaxStepSpeedUnitsPerMs: 0.009, // >9 calibrated units/second is an implausible tracking jump.
  gateSyncWindowMs: 180,
  gateSyncDecisionGraceMs: 95, // Extra frames to allow a second movement to confirm.
  gateSyncPendingMaxMs: 700,
  gateIdeToleranceDeg: 30,
  gateMaxTechnicalRetriesPerTarget: 2,
  gateMaxTechnicalInvalidTotal: 6,
  gateResumableTrackingGapMs: 220, // Brief missing frames: resume only if early motion is still measurable.
  gateTechnicalTrackingGapMs: 1200, // Longer continuous loss consumes one technical retry.
  gateMaxFreeRestartsPerTarget: 8, // Prevent endless non-scored repeats under intermittent tracking.
  planningWindowMs: 15000,
  stageSafetyDurationSec: 300, // Keep the existing single-hand practice stage limit.
  dynamicDemoMs: V25_TWO_HAND_DEMO_MS, // Full-screen teaching demo only.
  trackingFailureMs: 15000,
  dynamicMaxSec: 150,
  initialDirectionThreshold: 0.08,
  initialDirectionConfirmFrames: 2,
  dynamicTolerance: 0.20,
  dynamicMinMovingFrames: 20,
});
const V20_ANGLES = [22.5,45,67.5,112.5,135,157.5,202.5,225,247.5,292.5,315,337.5];
const V20_TARGET_KEYS = V20_ANGLES.map((angle,i) => {
  const key=`v20_target_${i+1}`;
  TARGETS[key]={x:TARGET_ECCENTRICITY*Math.cos(angle*Math.PI/180),y:-TARGET_ECCENTRICITY*Math.sin(angle*Math.PI/180)};
  // Unique codes also enter the original per-frame export.
  DIRECTION_ORDER.push(key);
  return key;
});
function v20BalancedSequence(pool, rounds) {
  const result=[];
  for(let i=0;i<rounds;i++) {
    const next=shuffleInPlace([...pool]);
    if(result.length && next[0]===result[result.length-1] && next.length>1) [next[0],next[1]]=[next[1],next[0]];
    result.push(...next);
  }
  return result;
}
const V20_FORMAL_SEQUENCE=v20BalancedSequence(V20_TARGET_KEYS,20);
const V20_RULES={
  right:{hand:'Left',axis:'y',sign:-1,handWord:'UP',arrow:'↑'},
  left:{hand:'Left',axis:'y',sign:1,handWord:'DOWN',arrow:'↓'},
  up:{hand:'Right',axis:'x',sign:-1,handWord:'LEFT',arrow:'←'},
  down:{hand:'Right',axis:'x',sign:1,handWord:'RIGHT',arrow:'→'},
};
const V20_CARDINAL=['right','left','up','down'];
function v20Page(id, title, lines, demo=null, scene='practice', autoAdvance=false) {
  return {...bimanualInstructionTrial(id,'v20'),v20:true,title,lines,demo,scene,autoAdvance};
}
function v20Practice(hand,guided) {
  const pool=hand==='Left'?['right','left']:['up','down'];
  return {id:`v20_${hand.toLowerCase()}_${guided?'guided':'independent'}`,kind:'v20_practice',hand,guided,
    sequence:v20BalancedSequence(pool,4),axisConstrained:true,scene:'practice',showCamera:false,durationSec:V20_CONFIG.stageSafetyDurationSec,countdownSec:0,prompt:''};
}
const v20Trials=[
  ...['Left','Right'].map(hand=>({id:`cal_${hand.toLowerCase()}_continuous`,kind:'continuous_calibration',hand,
    scene:'setup',showCamera:true,durationSec:CALIBRATION_MAX_SEC,countdownSec:0,prompt:`Movement setup · ${hand.toUpperCase()} HAND`})),
  v20Page('v20_dynamic_intro','AXIS-SPECIFIC MOVEMENT CHECK',[
    'Left hand: move UP and DOWN only. Keep your right hand near its starting circle.',
    'Right hand: move LEFT and RIGHT only. Keep your left hand near its starting circle.',
    'Then move both hands on their assigned axes.'
  ],null,'setup'),
  {id:'v20_dynamic_four',kind:'v20_dynamic',axisConstrained:true,scene:'setup',showCamera:true,durationSec:V20_CONFIG.dynamicMaxSec,countdownSec:0,prompt:''},
  v20Page('v20_training_intro',"Let's learn the controls",[
    "Let's learn how your hands control the cursor.",
    'First, practice with each hand separately.'
  ]),
  v20Page('v20_left_intro',"Let's start with your left hand",[
    'Move your left hand UP to move the cursor RIGHT.',
    'Move your left hand DOWN to move the cursor LEFT.',
    'Only UP and DOWN hand movements are allowed.'
  ],'Left'),
  v20Practice('Left',true),
  v20Page('v20_left_no_arrow','YOUR LEFT HAND',['Now try without the hints.']),
  v20Practice('Left',false),
  v20Page('v20_right_intro',"Now, let's try your right hand",[
    'Move your right hand LEFT to move the cursor UP.',
    'Move your right hand RIGHT to move the cursor DOWN.',
    'Only LEFT and RIGHT hand movements are allowed.'
  ],'Right'),
  v20Practice('Right',true),
  v20Page('v20_right_no_arrow','YOUR RIGHT HAND',['Now try without the hints.']),
  v20Practice('Right',false),
  v20Page('v20_gate_intro',"Let's see what you've learned!",[
    'Use the rules you learned to move the cursor toward each gem.',
    'Move along each hand’s assigned axis only.'
  ]),
  {id:'v20_control_gate',kind:'v20_gate',axisConstrained:true,scene:'practice',sequence:v20BalancedSequence(V20_CARDINAL,6),showCamera:false,durationSec:1200,countdownSec:0,prompt:''},
  v20Page('v20_formal_intro','Ready to collect the gems?',[
    'Use both hands to control the cursor.',
    'Make one outward movement toward each gem.',
    'Moving off either allowed hand axis ends that attempt.'
  ],null,'formal'),
];
for(let block=0;block<4;block++) {
  v20Trials.push({...bimanualReachingTrial(`v20_formal_${block+1}`,'denovo',60,block+1,{
    targetSequence:V20_FORMAL_SEQUENCE.slice(block*60,(block+1)*60),visualReachOffset:block*60,
    skipRestAfter:true,training:true,noSpeedLimit:true,singleAttempt:true,movementWindowMs:600
  }),scene:'formal',v20Formal:true,axisConstrained:true});
  if(block<3) v20Trials.push(v20Page(`v20_break_${block+1}`,`${(block+1)*25}% complete`,[],null,'formal'));
}

function v20Scene(ctx,W,H,scene) {
  // Shared navy-and-gold visual system across setup, teaching, and formal task.
  const g=ctx.createRadialGradient(W*.5,H*.42,Math.min(W,H)*.05,W*.5,H*.5,Math.max(W,H)*.68);
  g.addColorStop(0,'#182d4c');g.addColorStop(.58,'#0d1d35');g.addColorStop(1,'#071225');
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  // Intentionally no inset rectangles: one full-bleed demonstration surface.
}
function v20Progress(ctx,W,H,value) {
  // Kept as a minimal no-bar fallback; the primary progress is the numeric DOM badge.
  ctx.save();ctx.fillStyle='#f7e6b6';ctx.textAlign='right';
  ctx.font='850 20px system-ui';ctx.fillText(`${Math.floor(clamp(value,0,1)*100)}%`,W-28,35);ctx.restore();
}
/* V23 preserves V22 progress: overall experimental completion, including calibration and
   teaching; formal reaches account for the final 85 percentage points. */
function v22OverallFraction(trial,state) {
  const firstFormal=v20Trials.findIndex(t=>t.v20Formal);
  const index=v20Trials.findIndex(t=>t.id===trial?.id);
  if(trial?.v20Formal) {
    const reaches=(trial.visualReachOffset||0)+(state?.reaches?.length||0);
    return .15+.85*clamp(reaches/240,0,1);
  }
  const breakMatch=/^v20_break_(\d+)$/.exec(trial?.id||'');
  if(breakMatch)return .15+.85*(Number(breakMatch[1])*60/240);
  if(index>=0&&index<firstFormal) {
    let progress=0;
    if(trial?.kind==='v20_dynamic')progress=(state?.step||0)/AXIS_DYNAMIC_ROUTE.length;
    else if(trial?.kind==='v20_practice')progress=(state?.index||0)/(trial.sequence?.length||1);
    else if(trial?.kind==='v20_gate')progress=(state?.index||0)/V20_CONFIG.gateMaxAttempts;
    else if(trial?.kind==='continuous_calibration')progress=(state?.calibrationComplete?1:0);
    return .15*clamp((index+progress)/Math.max(1,firstFormal),0,1);
  }
  return .15;
}
function v22ShowPercent(trial,state) {
  if(typeof document==='undefined')return;
  let badge=document.getElementById('v22-study-percent');
  if(!badge){badge=document.createElement('div');badge.id='v22-study-percent';
    badge.setAttribute('aria-label','Study progress');document.body.appendChild(badge);}
  const label=`${Math.floor(v22OverallFraction(trial,state)*100+1e-7)}%`;
  if(badge.textContent!==label)badge.textContent=label;
}
function v20Style() {
  if(document.getElementById('v20-style')) return;
  const style=document.createElement('style');style.id='v20-style';style.textContent=`
    #bim-instruction-overlay[data-scene] {background:radial-gradient(circle at 50% 30%,#182e4c,#071225 75%)}
    #bim-instruction-overlay .bim-panel {width:min(1080px,94vw);padding:clamp(18px,3vw,38px);border-radius:24px;
      background:rgba(9,22,42,.97);border:1px solid rgba(224,193,115,.23)}
    #bim-instruction-overlay h2 {font-size:clamp(1.9rem,4vw,3.2rem);line-height:1.15;margin-bottom:18px}
    #bim-instruction-overlay .v20-copy {font-size:clamp(17px,2vw,23px);line-height:1.45;
      margin:12px auto;text-align:center;max-width:920px;color:#e8edf7}
    #bim-instruction-overlay .v20-demo {display:block;width:100%;height:auto;aspect-ratio:2/1;
      max-height:min(58vh,520px);object-fit:contain;margin:8px auto 18px;border-radius:16px;
      border:1px solid rgba(226,195,125,.20)}
    #bim-instruction-overlay .bim-panel {max-height:95dvh;overflow:auto}
    /* V22: demonstration itself occupies the whole viewport like calibration.
       No inner animation card, frame, or squashed half-height canvas. */
    #bim-instruction-overlay.v22-immersive {padding:0;overflow:hidden;align-items:stretch;justify-content:stretch}
    #bim-instruction-overlay.v22-immersive .bim-panel {
      width:100vw;max-width:none;height:100dvh;max-height:none;padding:clamp(12px,2.6vh,28px) 4vw;
      box-sizing:border-box;border:0;border-radius:0;background:transparent;box-shadow:none;
      overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
      position:relative;isolation:isolate;
    }
    #bim-instruction-overlay.v22-immersive .v20-demo {
      position:absolute;inset:0;width:100%;height:100%;max-height:none;aspect-ratio:auto;
      object-fit:contain;margin:0;border:0;border-radius:0;z-index:0;pointer-events:none;
    }
    #bim-instruction-overlay.v22-immersive h2 {
      position:relative;z-index:1;flex-shrink:0;align-self:center;
      margin:clamp(6px,2vh,18px) auto auto;
      font-size:clamp(1.75rem,3.5vw,3.6rem);text-shadow:0 4px 18px rgba(0,0,0,.36);
    }
    #bim-instruction-overlay.v22-immersive .v20-copy {
      position:relative;z-index:1;flex-shrink:0;line-height:1.34;
      font-size:clamp(14px,1.7vw,21px);margin:3px auto;
      text-shadow:0 3px 14px rgba(0,0,0,.52);
    }
    /* Same visual language as drawCalibrationIntro(): off-white bold heading,
       dark navy full screen, pale subtitle, warm-yellow bottom instruction. */
    #bim-instruction-overlay.v23-calibration { background:#061024; }
    #bim-instruction-overlay.v23-calibration h2 {
      color:#f6f9ff;font:900 clamp(27px,5.5vmin,52px)/1.15 system-ui,sans-serif;
      letter-spacing:0;text-align:center;
    }
    #bim-instruction-overlay.v23-calibration .v20-copy {
      color:#ffe39a;font-weight:800;font-size:clamp(14px,2.5vmin,22px);
      margin-bottom:clamp(15px,6vh,65px);
    }
    #bim-instruction-overlay.v22-immersive .bim-main-button {
      position:relative;z-index:1;flex-shrink:0;margin:clamp(8px,1.4vh,16px) auto clamp(8px,1.2vh,14px);
      min-width:min(260px,45vw);
    }
    @media(max-height:620px) {
      #bim-instruction-overlay.v22-immersive h2 {font-size:clamp(1.6rem,3vw,2.8rem);margin-top:0}
      #bim-instruction-overlay.v22-immersive .v20-copy {font-size:14px;margin:1px auto}
      #bim-instruction-overlay.v22-immersive .bim-main-button {min-height:40px;margin:6px auto 0}
    }
    /* Global runner counters remain hidden; one unobtrusive numeric percentage is shown. */
    body[data-v20-scene] #screen-trial > .progress,
    body[data-v20-scene] #screen-trial .trial-progress,
    body[data-v20-scene] #screen-trial .trial-counter,
    body[data-v20-scene] #trial-progress,
    body[data-v20-scene] #trial-counter {display:none !important}
    #v22-study-percent {position:fixed;top:clamp(10px,1.6vh,20px);right:clamp(12px,2.1vw,32px);
      z-index:100090;pointer-events:none;color:#f7e6b6;
      font:850 clamp(15px,1.7vw,23px)/1 system-ui,sans-serif;
      text-shadow:0 2px 14px rgba(0,0,0,.75);font-variant-numeric:tabular-nums}

    #bim-instruction-overlay .bim-main-button {background:#304f76;border-color:#bfa76e;min-height:52px;margin-top:20px}
    /* The runner's generic technical stop is not an additional V20 Return page. */
    body.v20-exit-overlay-active #screen-technical-stop {display:none !important}
    body[data-v20-scene] #stage {background:#09172b}
    /* Hide the OS pointer only during actual motion checks and reaching, not on instruction buttons. */
    body[data-v20-task="v20_dynamic"] #stage, body[data-v20-task="v20_dynamic"] #stage *,
    body[data-v20-task="v20_practice"] #stage, body[data-v20-task="v20_practice"] #stage *,
    body[data-v20-task="v20_gate"] #stage, body[data-v20-task="v20_gate"] #stage * {cursor:none !important}
    /* Do not display runner trial counters in the bimanual movement check. */
    body[data-v20-task="v20_dynamic"] .trial-progress,
    body[data-v20-task="v20_dynamic"] .trial-counter,
    body[data-v20-task="v20_dynamic"] #trial-progress,
    body[data-v20-task="v20_dynamic"] #trial-counter {display:none !important}
    /* Runner-wide remaining-time labels are not a response deadline for practice/check stages. */
    body[data-v20-task="v20_practice"] #trial-timer,
    body[data-v20-task="v20_gate"] #trial-timer,
    body[data-v20-task="v20_practice"] .trial-timer,
    body[data-v20-task="v20_gate"] .trial-timer,
    body[data-v20-task="v20_practice"] .time-remaining,
    body[data-v20-task="v20_gate"] .time-remaining {display:none !important}
  `;document.head.appendChild(style);
}
function v20Arrow(ctx,x,y,dx,dy,color='#ffd77c') {
  ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=5;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+dx,y+dy);ctx.stroke();
  const a=Math.atan2(dy,dx);ctx.beginPath();ctx.moveTo(x+dx,y+dy);
  ctx.lineTo(x+dx-15*Math.cos(a-.5),y+dy-15*Math.sin(a-.5));ctx.lineTo(x+dx-15*Math.cos(a+.5),y+dy-15*Math.sin(a+.5));ctx.closePath();ctx.fill();ctx.restore();
}
function v20Demo(canvas,demo,t) {
  const ctx=canvas.getContext('2d');
  const W=Math.round(canvas.clientWidth||window.innerWidth||1280);
  const H=Math.round(canvas.clientHeight||window.innerHeight||720);
  if(canvas.width!==W)canvas.width=W;
  if(canvas.height!==H)canvas.height=H;
  if(demo==='dynamic') {
    // Match the full-screen, dark-navy single-hand calibration intro.
    ctx.fillStyle='#061024';
    ctx.fillRect(0,0,W,H);
  } else {
    v20Scene(ctx,W,H,'practice');
  }
  const scale=Math.min(W,H);
  ctx.textAlign='center';ctx.textBaseline='middle';
  if(demo==='dynamic') {
    const motion=v25TwoHandDemoMotion(t);
    const target=motion.position;
    const heading=motion.hold
      ? (target==='home'?'Place both hands in the starting circles':'Hold still')
      : (target==='home'?'Return both hands to the starting circles':`Move both hands ${target.toUpperCase()}`);
    ctx.fillStyle='#b9c9df';
    ctx.font=`700 ${Math.round(scale*.031)}px system-ui,sans-serif`;
    ctx.fillText(heading,W/2,H*.205);
    // Match the REAL two-hand check: draw ONLY the current directional target,
    // one ring for each hand. Never show HOME plus another direction together.
    for(const hand of ['Left','Right']) {
      const anchor=CALIBRATION_TARGETS[hand][target];
      drawCalibrationBeacon(ctx,anchor.x*W,anchor.y*H,scale*.038,target,
        motion.hold, motion.hold?motion.raw*100:0,t);
      const palm=v24CalibrationDemoPoint(hand,motion);
      drawOpenSourcePalm(ctx,palm.x*W,palm.y*H,scale*.15,hand,1);
    }
    return;
  }
  // Occupy the full screen, but protect an independent area for each cause/effect.
  // The cursor never enters the hand's space (and neither overlaps text labels).
  const hand=demo,option=Math.floor(t/3600)%2,phase=(t%3600)/3600;
  const amount=phase<.20?0:phase<.50?(1-Math.cos(Math.PI*(phase-.20)/.30))/2:
    phase<.67?1:phase<.92?(1+Math.cos(Math.PI*(phase-.67)/.25))/2:0;
  const handDirection=hand==='Left'?(option===0?'UP':'DOWN'):(option===0?'LEFT':'RIGHT');
  const cursorDirection=hand==='Left'?(option===0?'RIGHT':'LEFT'):(option===0?'UP':'DOWN');
  const handStart={x:W*.26,y:H*.58},cursorStart={x:W*.72,y:H*.58};
  const handShift={x:hand==='Right'?(option===0?-W*.105:W*.105):0,
                   y:hand==='Left'?(option===0?-H*.14:H*.14):0};
  const cursorShift={x:hand==='Left'?(option===0?W*.115:-W*.115):0,
                     y:hand==='Right'?(option===0?-H*.14:H*.14):0};
  // Each column stays independent; visual association comes from synchronous motion.
  ctx.save();ctx.strokeStyle='rgba(210,224,245,.13)';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(W*.50,H*.28);ctx.lineTo(W*.50,H*.80);ctx.stroke();ctx.restore();
  ctx.fillStyle='#f4f6fb';ctx.font=`850 ${Math.round(scale*.043)}px system-ui`;
  ctx.fillText(`YOUR ${hand.toUpperCase()} HAND`,handStart.x,H*.26);
  ctx.fillText('THE CURSOR',cursorStart.x,H*.26);
  ctx.fillStyle='#e8cb89';ctx.font=`750 ${Math.round(scale*.034)}px system-ui`;
  ctx.fillText(`MOVE ${handDirection}`,handStart.x,H*.33);
  ctx.fillText(`MOVES ${cursorDirection}`,cursorStart.x,H*.33);
  ctx.save();ctx.setLineDash([8,12]);ctx.lineWidth=3;ctx.strokeStyle='rgba(224,233,245,.20)';
  ctx.beginPath();ctx.moveTo(handStart.x,handStart.y);
  ctx.lineTo(handStart.x+handShift.x,handStart.y+handShift.y);
  ctx.moveTo(cursorStart.x,cursorStart.y);
  ctx.lineTo(cursorStart.x+cursorShift.x,cursorStart.y+cursorShift.y);ctx.stroke();ctx.restore();
  drawCalibrationBeacon(ctx,handStart.x,handStart.y,scale*.052,'home',false,0,t);
  drawOpenSourcePalm(ctx,handStart.x+handShift.x*amount,handStart.y+handShift.y*amount,
                     scale*.15,hand,1);
  const cursorX=cursorStart.x+cursorShift.x*amount,cursorY=cursorStart.y+cursorShift.y*amount;
  drawTreasureCompassCursor(ctx,cursorX,cursorY);
  const gx=cursorStart.x+cursorShift.x,gy=cursorStart.y+cursorShift.y;
  if(!(phase>=.50&&phase<.67))drawGem(ctx,gx,gy,scale*.043,4,t);
  else drawCollectSparkle(ctx,gx,gy,Math.min(GEM_SPARKLE_MS,(phase-.50)*3600));
}
function v20Overlay(trial,state,failure=false) {
  if(document.getElementById('bim-instruction-overlay'))return;
  ensureBimanualStyles();v20Style();
  const overlay=document.createElement('div');overlay.id='bim-instruction-overlay';overlay.dataset.scene=trial.scene||'practice';
  if(failure)document.body.classList.add('v20-exit-overlay-active');
  if(!failure&&trial.demo)overlay.classList.add('v22-immersive');
  if(!failure&&trial.demo==='dynamic')overlay.classList.add('v23-calibration');
  const panel=document.createElement('div');panel.className='bim-panel';overlay.appendChild(panel);
  const title=document.createElement('h2');title.textContent=failure?'Session ended':trial.title;panel.appendChild(title);
  const lines=failure?[
    state.failureReason==='rule_check_failed'?'You did not pass the control check.':'We could not complete the movement or tracking check.',
    V20_CONFIG.failureReturnText
  ]:trial.lines;
  if(!failure&&trial.demo) {
    const canvas=document.createElement('canvas');canvas.className='v20-demo';
    canvas.setAttribute('aria-label',`${trial.demo} movement demonstration`);panel.appendChild(canvas);
    const start=performance.now();
    const loop=()=>{
      if(!canvas.isConnected||state.finished)return;
      const elapsed=performance.now()-start;
      v20Demo(canvas,trial.demo,trial.autoAdvance?Math.min(elapsed,V20_CONFIG.dynamicDemoMs-1):elapsed);
      if(trial.autoAdvance&&elapsed>=V20_CONFIG.dynamicDemoMs) {
        state.finished=true;removeBimanualOverlay();return;
      }
      const id=requestAnimationFrame(()=>{bimanualInstructionRafs.delete(id);loop();});
      bimanualInstructionRafs.add(id);
    };
    // Start once the element has been attached to the DOM.
    const first=requestAnimationFrame(()=>{bimanualInstructionRafs.delete(first);loop();});
    bimanualInstructionRafs.add(first);
  }
  for(const line of lines||[]) {const p=document.createElement('div');p.className='v20-copy';p.textContent=line;panel.appendChild(p);}
  if(!failure&&trial.autoAdvance) {
    // Auto-advance immediately after the full-screen movement demonstration.
  } else {
    const button=document.createElement('button');button.type='button';button.className='bim-main-button';
    button.textContent=failure?'Return to Prolific':'Continue';panel.appendChild(button);
    button.addEventListener('click',()=>{
      if(failure) {
        state.failureAcknowledged=true;state.finished=true;
        if(V20_CONFIG.prolificReturnUrl)window.open(V20_CONFIG.prolificReturnUrl,'_blank','noopener,noreferrer');
        // Keep the study-specific exit overlay visible on the original tab.
        // Otherwise the runner's outdated tracking-error Return page reappears.
        return;
      }
      state.finished=true;
      removeBimanualOverlay();
    });
  }
  document.body.appendChild(overlay);
}
function v20Custom(trial) {return ['v20_dynamic','v20_practice','v20_gate'].includes(trial.kind);}
function v20Fail(state,reason,addEvent,tMs) {
  if(state.failureReason)return;state.failureReason=reason;state.phase='failure';state.finished=true;
  addEvent('v20_exit_requested',{reason,tMs,partialPaymentRequired:true,errors:state.errors});
}
function v20StartState(trial) {
  return {finished:false,phase:'home',index:0,step:0,hold:{Left:null,Right:null},holdPct:{Left:0,Right:0},
    sequence:trial.sequence?[...trial.sequence]:[],attempts:[],errors:0,roundCorrect:0,perfectRounds:0,gatePassed:false,
    movingFrames:[],dynamicSteps:[],dynamicMoved:{Left:false,Right:false},lastT:null,clock:0,lastValid:false,
    lostAt:null,invalidTrackingAttempts:0,candidate:null,candidateFrames:0,initial:null,origin:null,
    onsetFrames:0,onsetCandidateMs:null,outboundPeakTask:{x:0,y:0},outboundPeakR:0,
    peakAtMs:null,previousTask:null,endpointTask:null,
    gateTrackers:null,gateTechnicalInvalidTotal:0,gateTechnicalInvalidForTarget:0,
    gateTrackingGapActive:false,gateTrackingGapCount:0,gateFreeRestartCount:0,
    gateFreeRestartsForTarget:0,gateTrackingGapMs:0,
    gateNoResponseCount:0,
    failureReason:null,currentTask:{x:0,y:0},maxR:0};
}
function v20HomePoint(hand) {const c=calibration[hand==='Left'?'left':'right'];return {x:c.homeX,y:c.homeY};}
/* Control Check display-only alignment. Both HOME circles share y=0.55.
   Translate each tracked hand by exactly the same offset as its HOME circle.
   This preserves the visually indicated hit radius and all actual calibration/QC. */
function v20GateDisplayPoint(hand,palm) {
  const home=v20HomePoint(hand);
  const displayHome=CALIBRATION_TARGETS[hand].home;
  return {x:displayHome.x+(palm.viewX-home.x),y:displayHome.y+(palm.viewY-home.y)};
}
/* V23: visualization-only display for the both-hands check.
   Camera-space calibration points are allowed to be vertically offset per hand.
   Show both hands in a matched virtual workspace instead, while moving the
   tracker dot by the SAME per-hand calibrated transform as its corresponding
   target. Otherwise a forced-aligned ring would lie about hit proximity. */
function v23DynamicDisplayPoint(hand,normalized) {
  const anchors=CALIBRATION_TARGETS[hand];
  const x=Number.isFinite(normalized?.x)?normalized.x:0;
  const y=Number.isFinite(normalized?.y)?normalized.y:0;
  const ax=x<0?(anchors.home.x-anchors.left.x):(anchors.right.x-anchors.home.x);
  const ay=y<0?(anchors.home.y-anchors.up.y):(anchors.down.y-anchors.home.y);
  return {x:anchors.home.x+x*ax,y:anchors.home.y+y*ay};
}
function v20Hold(state,hand,inside,now,duration) {
  if(!inside)state.hold[hand]=null;else if(state.hold[hand]==null)state.hold[hand]=now;
  state.holdPct[hand]=state.hold[hand]==null?0:clamp((now-state.hold[hand])/duration,0,1)*100;
  return state.holdPct[hand]>=100;
}
function v20ResetHold(state) {state.hold={Left:null,Right:null};state.holdPct={Left:0,Right:0};}
/* Control Check V2: detect a committed outward movement, then sample its
   EARLY direction retrospectively. No changes to single-hand practice/formal. */
function v20GateNewTracker() {
  return {last:null,candidate:null,confirmed:null,jumps:0,abortedCandidates:0};
}
function v20GateInitMotion(state) {
  state.gateTrackers={Left:v20GateNewTracker(),Right:v20GateNewTracker()};
  state.gateFirstConfirmationAt=null;
  state.gateInitialTrajectory=[];
}
function v20GateThresholdPoint(previous,current,radius) {
  const a=previous?.r??0,b=current.r;
  if(b<radius||a>=radius)return null;
  const f=clamp((radius-a)/Math.max(1e-9,b-a),0,1);
  return {t:previous.t+(current.t-previous.t)*f,
    x:previous.x+(current.x-previous.x)*f,
    y:previous.y+(current.y-previous.y)*f,r:radius};
}
function v20GateTrackHand(tracker,delta,clock) {
  if(tracker.confirmed)return;
  const now={t:clock,x:delta.x,y:delta.y,r:Math.hypot(delta.x,delta.y)};
  const prior=tracker.last;
  tracker.last=now;
  if(!prior||now.t<=prior.t)return;
  const speed=Math.hypot(now.x-prior.x,now.y-prior.y)/(now.t-prior.t);
  if(speed>V20_CONFIG.gateMaxStepSpeedUnitsPerMs) {
    tracker.jumps++;
    tracker.candidate=null;
    return;
  }
  if(now.r<V20_CONFIG.gateDeadZone*.85) {
    if(tracker.candidate)tracker.abortedCandidates++;
    tracker.candidate=null;
    return;
  }
  if(!tracker.candidate&&now.r>=V20_CONFIG.gateDeadZone) {
    const begin=v20GateThresholdPoint(prior,now,V20_CONFIG.gateDeadZone);
    tracker.candidate={onsetMs:begin?.t??clock,frames:0,riseFrames:0,
      maxRadius:V20_CONFIG.gateDeadZone,points:{},samples:[]};
  }
  const c=tracker.candidate;
  if(!c)return;
  c.frames++;
  if(now.r>c.maxRadius+0.009)c.riseFrames++;
  c.maxRadius=Math.max(c.maxRadius,now.r);
  if(c.samples.length<90)c.samples.push({t:now.t,x:now.x,y:now.y,r:now.r});
  for(const rad of V20_CONFIG.gateInitialSampleRadii) {
    const key=rad.toFixed(2);
    if(c.points[key]==null){
      const sample=v20GateThresholdPoint(prior,now,rad);
      if(sample)c.points[key]=sample;
    }
  }
  if(now.r>=V20_CONFIG.gateConfirmRadius &&
     clock-c.onsetMs>=V20_CONFIG.gateOutwardMinMs &&
     c.frames>=V20_CONFIG.gateMinMotionFrames && c.riseFrames>=2 &&
     V20_CONFIG.gateInitialSampleRadii.every(rad=>c.points[rad.toFixed(2)])) {
    tracker.confirmed={...c,confirmedAtMs:clock,confirmRadius:now.r};
  }
}
function v20GateEarlyVector(confirmed) {
  if(!confirmed)return null;
  const points=V20_CONFIG.gateInitialSampleRadii.map(r=>confirmed.points[r.toFixed(2)]);
  if(points.some(p=>!p))return null;
  // The spatially aligned samples are deliberately taken before the 0.35
  // confirmation radius, avoiding a later corrective movement.
  return {x:points.reduce((a,p)=>a+p.x,0)/points.length,
    y:points.reduce((a,p)=>a+p.y,0)/points.length};
}
function v20GateDirectionAssessment(direction,mode,left,right) {
  const L=left?v20GateEarlyVector(left):null;
  const R=right?v20GateEarlyVector(right):null;
  const task={x:L?-L.y:0,y:R?R.x:0};
  const mag=Math.hypot(task.x,task.y);
  const hasDirection=mag>=V20_CONFIG.gateDeadZone;
  const angle=hasDirection?angleDeg(task.x,task.y):null;
  const signedError=angle==null?null:wrapAngleDeg(angle-targetAngleDeg(direction));
  return {mode,taskVector:task,taskMagnitude:mag,angle,
    signedError,absoluteError:signedError==null?null:Math.abs(signedError),
    correct:signedError!=null&&Math.abs(signedError)<=V20_CONFIG.gateIdeToleranceDeg,
    classification:hasDirection?'ide':'ineffective_control'};
}
function v20GateDecide(state,direction,force=false) {
  const left=state.gateTrackers.Left.confirmed;
  const right=state.gateTrackers.Right.confirmed;
  const confirmed=[['Left',left],['Right',right]].filter(([,c])=>!!c)
    .sort((a,b)=>a[1].onsetMs-b[1].onsetMs);
  if(!confirmed.length)return null;
  const [firstHand,first]=confirmed[0];
  const otherHand=firstHand==='Left'?'Right':'Left';
  const other=state.gateTrackers[otherHand];
  const firstStart=first.onsetMs;
  const earliestDue=firstStart+V20_CONFIG.gateSyncWindowMs+
    V20_CONFIG.gateOutwardMinMs+V20_CONFIG.gateSyncDecisionGraceMs;
  if(!force&&state.clock<earliestDue)return null;
  // If the other hand began within the synchrony window, let it complete the
  // movement confirmation (bounded, so it cannot delay indefinitely).
  if(!other.confirmed && other.candidate &&
     other.candidate.onsetMs-firstStart<=V20_CONFIG.gateSyncWindowMs &&
     !force&&state.clock<firstStart+V20_CONFIG.gateSyncPendingMaxMs)return null;
  let mode='first_confirmed_hand';
  let activeLeft=firstHand==='Left'?first:null;
  let activeRight=firstHand==='Right'?first:null;
  const second=confirmed[1];
  if(second&&second[1].onsetMs-firstStart<=V20_CONFIG.gateSyncWindowMs){
    activeLeft=left;activeRight=right;mode='near_simultaneous_composite';
    // A fully formed wrong movement before the second hand even starts cannot
    // be reclassified as a simultaneous plan by a subsequent correction.
    const solo=v20GateDirectionAssessment(direction,'early_effect_before_second',
      firstHand==='Left'?first:null,firstHand==='Right'?first:null);
    const earlyAt=first.points['0.20']?.t;
    if(solo.classification==='ide'&&!solo.correct &&
       Number.isFinite(earlyAt)&&earlyAt+30<second[1].onsetMs){
      activeLeft=firstHand==='Left'?first:null;
      activeRight=firstHand==='Right'?first:null;
      mode='early_error_before_second';
    }
  }
  const result=v20GateDirectionAssessment(direction,mode,activeLeft,activeRight);
  return {...result,firstHand,firstOnsetMs:first.onsetMs,
    firstConfirmedMs:first.confirmedAtMs,
    leftOnsetMs:left?.onsetMs??null,rightOnsetMs:right?.onsetMs??null,
    onsetDifferenceMs:left&&right?right.onsetMs-left.onsetMs:null,
    leftEarlyVector:v20GateEarlyVector(left),rightEarlyVector:v20GateEarlyVector(right),
    trajectory:{Left:left?.samples??state.gateTrackers.Left.candidate?.samples??[],
      Right:right?.samples??state.gateTrackers.Right.candidate?.samples??[]}};
}
/* Missing one or a few tracking frames cannot by itself be evidence of
   incorrect rule knowledge. During a dropout the existing active clock is
   paused; resume an outward reach only if no early IDE threshold was crossed
   unseen and both hands remain consistent with their last valid samples. */
function v20GateCanResumeAfterGap(state,pos,gapMs) {
  if(gapMs>V20_CONFIG.gateResumableTrackingGapMs||!state.origin||!state.gateTrackers)return false;
  for(const hand of ['Left','Right']) {
    const tracker=state.gateTrackers[hand];
    const delta={x:pos[hand].x-state.origin[hand].x,y:pos[hand].y-state.origin[hand].y};
    const radius=Math.hypot(delta.x,delta.y),last=tracker.last;
    if(!last) {if(radius>V20_CONFIG.gateDeadZone*.85)return false;continue;}
    // A plausible short displacement may be resumed, but do not interpolate a
    // movement direction through a missing part of the early trajectory.
    if(Math.hypot(delta.x-last.x,delta.y-last.y)>0.035+0.0025*gapMs)return false;
    if(!tracker.confirmed) {
      const sampleRadii=[V20_CONFIG.gateDeadZone,...V20_CONFIG.gateInitialSampleRadii,
        V20_CONFIG.gateConfirmRadius];
      if(sampleRadii.some(rad=>last.r<rad&&radius>=rad))return false;
    }
  }
  return true;
}
function v20GateRestartUnscored(state,addEvent,tMs,reason,gapMs) {
  state.gateFreeRestartCount++;
  state.gateFreeRestartsForTarget++;
  addEvent('v20_gate_unscored_restart',{index:state.index,reason,gapMs,tMs,
    restartsForTarget:state.gateFreeRestartsForTarget});
  state.gateTrackingGapActive=false;
  state.phase='home';state.origin=null;v20ResetHold(state);v20GateInitMotion(state);
  // Prolonged *intermittent* tracking errors also need a bounded retry path.
  // These short-dropout restarts are not IDE errors and do not advance targets.
  if(state.gateFreeRestartsForTarget>V20_CONFIG.gateMaxFreeRestartsPerTarget) {
    state.gateFreeRestartsForTarget=0;
    v20GateTechnicalInvalid(state,addEvent,tMs,'excessive_interrupted_early_trajectories');
  }
}
function v20GateTechnicalInvalid(state,addEvent,tMs,reason) {
  state.gateTrackingGapActive=false;
  state.invalidTrackingAttempts++;
  state.gateTechnicalInvalidTotal++;
  state.gateTechnicalInvalidForTarget++;
  addEvent('v20_gate_technical_invalid',{index:state.index,reason,tMs,
    retryForTarget:state.gateTechnicalInvalidForTarget,total:state.gateTechnicalInvalidTotal});
  if(state.gateTechnicalInvalidForTarget>V20_CONFIG.gateMaxTechnicalRetriesPerTarget ||
     state.gateTechnicalInvalidTotal>V20_CONFIG.gateMaxTechnicalInvalidTotal) {
    v20Fail(state,'gate_tracking_unreliable',addEvent,tMs);
  }else{
    state.phase='home';state.origin=null;v20ResetHold(state);
    v20GateInitMotion(state);
  }
}
function v20GateRecord(state,direction,rule,delta,task,result,addEvent,tMs) {
  const correct=result.outcome==='correct';
  const record={index:state.index,targetDirection:direction,targetAngleDeg:targetAngleDeg(direction),
    requiredHand:rule.hand,ruleCorrect:correct,outcome:result.outcome,
    initialDirectionDeg:result.angle??null,
    initialDirectionalErrorDeg:result.signedError??null,
    initialAbsoluteErrorDeg:result.absoluteError??null,
    initialTaskVector:result.taskVector??null,
    initialTaskMagnitude:result.taskMagnitude??null,
    movementConfirmationMs:result.firstConfirmedMs??null,
    leftOnsetMs:result.leftOnsetMs??null,rightOnsetMs:result.rightOnsetMs??null,
    onsetDifferenceMs:result.onsetDifferenceMs??null,
    firstHand:result.firstHand??null,decisionMode:result.mode??'no_response',
    gateClassification:result.classification??'no_response',
    earlyTrajectory:result.trajectory??null,
    deadZone:V20_CONFIG.gateDeadZone,confirmRadius:V20_CONFIG.gateConfirmRadius,
    ideToleranceDeg:V20_CONFIG.gateIdeToleranceDeg,
    endpointTaskX:task.x,endpointTaskY:task.y,left:{...delta.Left},right:{...delta.Right},
    reactionTimeMs:result.firstOnsetMs==null?null:result.firstOnsetMs-state.targetAt,
    movementTimeMs:result.firstOnsetMs==null||result.firstConfirmedMs==null?null:result.firstConfirmedMs-result.firstOnsetMs,
    timedOut:result.outcome==='no_response',tMs};
  state.attempts.push(record);
  state.lastResult=record;state.index++;state.feedbackAt=state.clock;state.phase='feedback';
  if(!correct)state.errors++;else state.roundCorrect++;
  if(result.outcome==='no_response')state.gateNoResponseCount++;
  if(state.index%4===0){state.perfectRounds=state.roundCorrect===4?state.perfectRounds+1:0;state.roundCorrect=0;}
  state.gateTechnicalInvalidForTarget=0;
  state.gateFreeRestartsForTarget=0;
  addEvent('v20_gate_result',record);
  addEvent('v20_practice_result',record); // Preserve existing analytics event name.
}
function v20Frame(args) {
  const {trial,state,tMs,addEvent}=args;
  const palms={},pos={};for(const hand of ['Left','Right']) {
    palms[hand]=getPalmCenter(getHand(args.allLandmarks||[],args.allHandedness||[],hand));
    pos[hand]=normalizedHandPosition(hand,palms[hand]);
  }
  const required=trial.kind==='v20_practice'?[trial.hand]:['Left','Right'];
  const valid=required.every(hand=>palms[hand]&&Number.isFinite(pos[hand].x)&&Number.isFinite(pos[hand].y));
  const dt=state.lastT==null?0:Math.max(0,tMs-state.lastT);state.lastT=tMs;
  if(valid&&state.lastValid)state.clock+=dt;state.lastValid=valid;
  const dynamicMoving=trial.kind==='v20_dynamic'&&state.dynamicTravel===true;
  if(dynamicMoving) {
    state.dynamicSampleClock=(state.dynamicSampleClock??0)+dt;
    state.movingFrames.push({t:state.dynamicSampleClock,sourceTimeMs:tMs,h:['Left','Right'].filter(h=>palms[h])});
  }
  state.dynamicWasMoving=dynamicMoving;
  const derived={phase:state.phase,phaseCode:state.phase==='home'?0:state.phase==='reach'?2:state.phase==='feedback'?3:4,
    h:['Left','Right'].filter(h=>palms[h]),leftX:pos.Left.x,leftY:pos.Left.y,rightX:pos.Right.x,rightY:pos.Right.y,
    leftViewX:palms.Left?.viewX??null,leftViewY:palms.Left?.viewY??null,rightViewX:palms.Right?.viewX??null,rightViewY:palms.Right?.viewY??null,
    activeClockMs:state.clock,targetDirection:state.sequence[state.index]??null,targetCode:targetCode(state.sequence[state.index]),
    cursorFeedbackVisible:state.phase==='reach'||state.phase==='feedback',taskX:state.currentTask.x,taskY:state.currentTask.y,
    errors:state.errors,attemptIndex:state.index,dynamicStep:state.step,trackingValid:valid};
  if(state.failureReason||state.finished)return derived;
  if(!valid) {
    if(state.lostAt==null)state.lostAt=tMs;
    v20ResetHold(state);
    if(trial.kind==='v20_gate'&&state.phase==='reach') {
      state.gateTrackingGapActive=true;
      // Do not invalidate a reach on the first missing frame. Only a sustained
      // absence counts as a technical retry; brief gaps pause the active clock.
      if(tMs-state.lostAt>=V20_CONFIG.gateTechnicalTrackingGapMs) {
        state.gateTrackingGapMs+=tMs-state.lostAt;
        v20GateTechnicalInvalid(state,addEvent,tMs,'sustained_tracking_loss_during_reach');
      }
    } else if(trial.kind==='v20_practice'&&state.phase==='reach') {
      state.invalidTrackingAttempts++;state.phase='home';state.initial=null;state.candidate=null;state.candidateFrames=0;
      addEvent('v20_attempt_invalid_tracking',{index:state.index,tMs});
    }
    if(tMs-state.lostAt>=V20_CONFIG.trackingFailureMs)v20Fail(state,'tracking_unavailable',addEvent,tMs);
    return derived;
  }
  if(trial.kind==='v20_gate'&&state.phase==='reach'&&state.gateTrackingGapActive) {
    const gapMs=state.lostAt==null?0:Math.max(0,tMs-state.lostAt);
    state.gateTrackingGapCount++;
    state.gateTrackingGapMs+=gapMs;
    state.gateTrackingGapActive=false;
    if(!v20GateCanResumeAfterGap(state,pos,gapMs)) {
      // If any early IDE threshold may have been crossed while unobserved,
      // repeat the SAME target from HOME without assigning a wrong direction.
      v20GateRestartUnscored(state,addEvent,tMs,'early_trajectory_not_observable',gapMs);
      state.lostAt=null;
      return derived;
    }
    // Do not interpolate across missing observations or infer onset inside a gap.
    for(const hand of ['Left','Right']) {
      const delta={x:pos[hand].x-state.origin[hand].x,y:pos[hand].y-state.origin[hand].y};
      state.gateTrackers[hand].last={t:state.clock,x:delta.x,y:delta.y,
        r:Math.hypot(delta.x,delta.y)};
    }
    addEvent('v20_gate_tracking_resumed',{index:state.index,gapMs,tMs});
  }
  state.lostAt=null;
  if(trial.kind==='v20_dynamic') {
    const route=AXIS_DYNAMIC_ROUTE;
    const pose=route[state.step]??route[route.length-1];let complete=true;
    for(const hand of ['Left','Right']) {
      const direction=pose[hand];
      const nominal=direction==='home'?{x:0,y:0}:direction==='up'?{x:0,y:-1}:direction==='down'?{x:0,y:1}:direction==='left'?{x:-1,y:0}:{x:1,y:0};
      const distance=Math.hypot(pos[hand].x-nominal.x,pos[hand].y-nominal.y);
      if(state.dynamicStepOrigin&&Math.hypot(pos[hand].x-state.dynamicStepOrigin[hand].x,pos[hand].y-state.dynamicStepOrigin[hand].y)>.10)state.dynamicMoved[hand]=true;
      const inside=distance<=V20_CONFIG.dynamicTolerance;
      complete=v20Hold(state,hand,inside,state.clock,CALIBRATION_HOLD_MS)&&complete;
    }
    // End active QC sampling once both hands arrive; holds are not QC frames.
    state.dynamicTravel=state.step>0&&!(state.hold.Left!=null&&state.hold.Right!=null);
    if(complete) {
      if(state.step>0) {
        const previous=route[state.step-1];
        for(const hand of ['Left','Right']) {
          if(pose[hand]!==previous[hand]&&!state.dynamicMoved[hand])return derived;
        }
      }
      state.dynamicSteps.push({direction:`L:${pose.Left}|R:${pose.Right}`,completedAtMs:tMs,left:{...pos.Left},right:{...pos.Right}});
      addEvent('v20_dynamic_position_complete',state.dynamicSteps[state.dynamicSteps.length-1]);
      state.step++;state.dynamicStepOrigin={Left:{...pos.Left},Right:{...pos.Right}};
      state.dynamicMoved={Left:false,Right:false};v20ResetHold(state);state.dynamicTravel=true;
      if(state.step===route.length) {
        state.dynamicTravel=false;
        const quality=bimanualBaselineDynamicQualityMetrics(state.movingFrames);
        if(state.movingFrames.length<V20_CONFIG.dynamicMinMovingFrames) {quality.pass=false;quality.reasons.push('insufficient_dynamic_samples');}
        state.dynamicQuality=quality;
        if(quality.pass)state.finished=true;else v20Fail(state,'dynamic_tracking_failed',addEvent,tMs);
      }
    }
    derived.dynamicDirection=`L:${pose.Left}|R:${pose.Right}`;return derived;
  }
  const direction=state.sequence[state.index],rule=V20_RULES[direction];
  if(state.phase==='home') {
    let ready=true;
    for(const hand of required) {
      const home=v20HomePoint(hand),p=palms[hand];
      ready=v20Hold(state,hand,Math.hypot(p.viewX-home.x,p.viewY-home.y)<=CALIBRATION_TARGET_RADIUS,state.clock,HOME_HOLD_MS)&&ready;
    }
    if(ready) {
      state.origin={Left:{...pos.Left},Right:{...pos.Right}};state.phase='reach';state.targetAt=state.clock;
      state.initial=null;state.candidate=null;state.candidateFrames=0;state.moveAt=null;state.currentTask={x:0,y:0};state.maxR=0;
      if(trial.kind==='v20_gate')v20GateInitMotion(state);
      v20ResetHold(state);addEvent('v20_gem_onset',{index:state.index,direction,requiredHand:rule.hand,tMs});
    }
    return derived;
  }
  if(state.phase==='feedback') {
    if(state.clock-state.feedbackAt>=500) {
      if(trial.kind==='v20_gate'&&state.errors>=V20_CONFIG.gateMaxErrors)v20Fail(state,'rule_check_failed',addEvent,tMs);
      else if(trial.kind==='v20_gate'&&state.perfectRounds>=V20_CONFIG.gatePerfectRounds){state.gatePassed=true;state.finished=true;}
      else if(state.index>=state.sequence.length) {
        if(trial.kind==='v20_gate')v20Fail(state,'rule_check_failed',addEvent,tMs);else state.finished=true;
      } else {state.phase='home';v20ResetHold(state);}
    }
    return derived;
  }
  const delta={};for(const hand of ['Left','Right'])delta[hand]={x:pos[hand].x-state.origin[hand].x,y:pos[hand].y-state.origin[hand].y};
  const task=trial.kind==='v20_practice'?(rule.hand==='Left'?{x:-delta.Left.y,y:0}:{x:0,y:delta.Right.x}):{x:-delta.Left.y,y:delta.Right.x};
  state.currentTask=task;const radius=Math.hypot(task.x,task.y);state.maxR=Math.max(state.maxR,radius);
  const active=delta[rule.hand],other=delta[rule.hand==='Left'?'Right':'Left'];
  if(trial.axisConstrained && state.phase==='reach') {
    const violation=axisTrialMonitor(state,`${trial.id}:${state.index}:${state.targetAt}`,delta,tMs);
    if(violation){
      axisV20Violation(state,trial,violation,direction,rule,delta,task,addEvent,tMs);
      return {...derived,axisViolation:1,axisOffendingHand:violation.hand};
    }
  }

  const activeR=Math.hypot(active.x,active.y),otherR=Math.hypot(other.x,other.y);
  if(trial.kind==='v20_practice') {
  if(state.moveAt==null&&activeR>=V20_CONFIG.initialDirectionThreshold)state.moveAt=state.clock;
  if(!state.initial) {
    const wrongHand=trial.kind==='v20_gate'&&otherR>=V20_CONFIG.initialDirectionThreshold&&otherR>activeR*1.5;
    const axisValue=active[rule.axis],orthogonal=active[rule.axis==='x'?'y':'x'];
    const moved=activeR>=V20_CONFIG.initialDirectionThreshold||wrongHand;
    if(moved) {
      const answer=wrongHand?'wrong_hand':Math.abs(axisValue)<Math.abs(orthogonal)?'wrong_axis':axisValue*rule.sign>0?'correct':'wrong_direction';
      if(answer===state.candidate)state.candidateFrames++;else{state.candidate=answer;state.candidateFrames=1;}
      if(state.candidateFrames>=V20_CONFIG.initialDirectionConfirmFrames){
        // Record initial cursor angle as a descriptive measure, but retain the
        // ORIGINAL rule criterion: first hand, axis, and signed direction.
        const cursorR=Math.hypot(task.x,task.y);
        const firstAngle=trial.kind==='v20_gate'&&cursorR>1e-9?angleDeg(task.x,task.y):null;
        const firstError=firstAngle==null?null:wrapAngleDeg(firstAngle-targetAngleDeg(direction));
        state.initial={classification:answer,correct:answer==='correct',tMs,left:{...delta.Left},right:{...delta.Right},
          ...(trial.kind==='v20_gate'?{initialDirectionDeg:firstAngle,initialDirectionalErrorDeg:firstError}:{} )};
        addEvent('v20_initial_choice',{index:state.index,direction,...state.initial});}
    } else {state.candidate=null;state.candidateFrames=0;}
  }
  }
  if (trial.kind==='v20_gate') {
    for(const hand of ['Left','Right'])v20GateTrackHand(state.gateTrackers[hand],delta[hand],state.clock);
    const jumpCount=state.gateTrackers.Left.jumps+state.gateTrackers.Right.jumps;
    if(jumpCount>=3){
      v20GateTechnicalInvalid(state,addEvent,tMs,'discontinuous_early_trajectory');
      return derived;
    }
    const confirmed=v20GateDecide(state,direction);
    if(confirmed){
      v20GateRecord(state,direction,rule,delta,task,
        {...confirmed,outcome:confirmed.correct?'correct':'incorrect'},addEvent,tMs);
    } else if(state.clock-state.targetAt>=V20_CONFIG.planningWindowMs) {
      // If a movement was confirmed just before the deadline, score that
      // already-committed action instead of mislabeling it as No response.
      const atDeadline=v20GateDecide(state,direction,true);
      if(atDeadline)v20GateRecord(state,direction,rule,delta,task,
        {...atDeadline,outcome:atDeadline.correct?'correct':'incorrect'},addEvent,tMs);
      else v20GateRecord(state,direction,rule,delta,task,{outcome:'no_response'},addEvent,tMs);
    }
  } else {
    // SINGLE-HAND PRACTICE ONLY: use exactly the same visible gem-circle hit
    // geometry as Control Check. Reaching the wrong outer radius, or entering
    // the near side of the gem before r=0.70, must not be mis-scored.
    // Keep original 15 s planning / 5 s movement limits and initial-choice data.
    const expired=state.moveAt==null?state.clock-state.targetAt>=V20_CONFIG.planningWindowMs:state.clock-state.moveAt>=V20_CONFIG.practiceMovementWindowMs;
    const target=TARGETS[direction];
    const cap=radius>TARGET_ECCENTRICITY?TARGET_ECCENTRICITY/radius:1;
    const visibleX=task.x*cap,visibleY=task.y*cap;
    const endpointHit=distance2d(visibleX,visibleY,target.x,target.y)<=TARGET_HIT_RADIUS;
    if(endpointHit||expired) {
      const angle=radius>0?angleDeg(task.x,task.y):null;
      const error=angle==null?null:wrapAngleDeg(angle-targetAngleDeg(direction));
      const correct=state.initial?.correct===true;
      const record={index:state.index,targetDirection:direction,targetAngleDeg:targetAngleDeg(direction),requiredHand:rule.hand,
        initialChoice:state.initial,ruleCorrect:correct,endpointHit,timedOut:expired&&!endpointHit,endpointAngularErrorDeg:error,
        endpointTaskX:task.x,endpointTaskY:task.y,left:{...delta.Left},right:{...delta.Right},
        reactionTimeMs:state.moveAt==null?null:state.moveAt-state.targetAt,movementTimeMs:state.moveAt==null?null:state.clock-state.moveAt,
        guided:trial.guided===true,feedback:'continuous_cursor_then_endpoint',tMs};
      state.attempts.push(record);state.index++;state.feedbackAt=state.clock;state.phase='feedback';state.lastResult=record;
      addEvent('v20_practice_result',record);
    }
  }
  derived.taskX=task.x;derived.taskY=task.y;derived.initialRuleCorrect=state.initial?.correct??null;
  return derived;
}
function v20DrawCustom(ctx,args) {
  const {trial,state,canvas,tMs,setReadout}=args;
  const W=canvas.__logicalWidth??canvas.clientWidth??canvas.width;
  const H=canvas.__logicalHeight??canvas.clientHeight??canvas.height;
  const palms={};for(const hand of ['Left','Right'])palms[hand]=getPalmCenter(getHand(args.allLandmarks||[],args.allHandedness||[],hand));
  beginParticipantFacingOverlay(ctx,W);v20Scene(ctx,W,H,trial.scene);
  if(state.failureReason){endParticipantFacingOverlay(ctx);v20Overlay(trial,state,true);return;}
  const required=trial.kind==='v20_practice'?[trial.hand]:['Left','Right'];
  const scale=Math.min(W,H);
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`700 ${Math.round(scale*.037)}px system-ui`;ctx.fillStyle='#f3f5fc';
  if(trial.kind==='v20_dynamic'||state.phase==='home') {
    const pose=AXIS_DYNAMIC_ROUTE[state.step]??AXIS_DYNAMIC_ROUTE[0];
    const direction='home';
    for(const hand of required) {
      if(trial.kind==='v20_dynamic') {
        // Only the target on that hand's permitted physical axis is shown.
        const handDir=pose[hand];
        const point=CALIBRATION_TARGETS[hand][handDir];
        drawCalibrationBeacon(ctx,point.x*W,point.y*H,CALIBRATION_TARGET_RADIUS*scale,handDir,
          state.hold[hand]!=null,state.holdPct[hand],tMs);
        const n=normalizedHandPosition(hand,palms[hand]);
        if(Number.isFinite(n.x)&&Number.isFinite(n.y)) {
          const p=v23DynamicDisplayPoint(hand,n);
          drawCalibrationTracker(ctx,p.x*W,p.y*H,state.hold[hand]!=null,tMs);
        }
      } else {
        // Align only Control Check's two HOME rings. Both tracker dots get
        // the identical per-hand translation; hit checks still use raw HOME.
        if(trial.kind==='v20_gate') {
          const point=CALIBRATION_TARGETS[hand].home;
          drawCalibrationBeacon(ctx,point.x*W,point.y*H,CALIBRATION_TARGET_RADIUS*scale,'home',
            state.hold[hand]!=null,state.holdPct[hand],tMs);
          const p=palms[hand];if(p) {
            const shown=v20GateDisplayPoint(hand,p);
            drawCalibrationTracker(ctx,shown.x*W,shown.y*H,state.hold[hand]!=null,tMs);
          }
        } else {
          // Preserve single-hand practice's original camera-calibrated HOME.
          const c=calibration[hand==='Left'?'left':'right'];
          const point={x:direction==='left'?c.leftX:direction==='right'?c.rightX:c.homeX,
            y:direction==='up'?c.upY:direction==='down'?c.downY:c.homeY};
          drawCalibrationBeacon(ctx,point.x*W,point.y*H,CALIBRATION_TARGET_RADIUS*scale,direction,
            state.hold[hand]!=null,state.holdPct[hand],tMs);
          const p=palms[hand];if(p)drawCalibrationTracker(ctx,p.viewX*W,p.viewY*H,state.hold[hand]!=null,tMs);
        }
      }
    }
    if(trial.kind==='v20_dynamic') {
      const holding=required.every(hand=>state.hold[hand]!=null);
      const moving=pose.Left!=='home'&&pose.Right!=='home'?'Move both hands on their assigned axes':
        pose.Left!=='home'?`Move your LEFT hand ${pose.Left.toUpperCase()}`:
        pose.Right!=='home'?`Move your RIGHT hand ${pose.Right.toUpperCase()}`:
        'Return both hands to the starting circles';
      const msg=holding?'Hold still':moving;
      ctx.fillText(msg,W/2,scale*.10);
    }else if(state.phase==='home') {
      ctx.fillText(trial.kind==='v20_practice'?`Place your ${trial.hand.toLowerCase()} hand in the starting circle`:
        'Place both hands in the starting circles',W/2,scale*.10);
    }
  } else {
    const direction=state.phase==='feedback'?state.lastResult?.targetDirection:state.sequence[state.index];
    const target=TARGETS[direction];
    if(target) {
      const p=taskToCanvas(target.x,target.y,W,H);
      const hit=state.phase==='feedback'&&state.lastResult?.endpointHit===true;
      if(!hit)drawGem(ctx,p.x,p.y,gemVisualRadiusPx(W,H),4,tMs);
      else drawCollectSparkle(ctx,p.x,p.y,state.clock-state.feedbackAt);
      const r=Math.hypot(state.currentTask.x,state.currentTask.y);
      const cap=r>TARGET_ECCENTRICITY?TARGET_ECCENTRICITY/r:1;
      const cursor=taskToCanvas(state.currentTask.x*cap,state.currentTask.y*cap,W,H);
      if(trial.guided&&state.phase==='reach') {
        const rule=V20_RULES[direction];
        // One clear gesture per gem: the translucent palm originates at the
        // cursor's HOME (screen centre), then moves in physical hand direction.
        // The actual cursor remains independently controlled by tracked hands.
        const elapsed=Math.max(0,state.clock-(state.targetAt??state.clock));
        const amt=demoEase01(clamp((elapsed-350)/1200,0,1));
        const cueX=W*.50,cueY=H*.50;
        const motion=scale*.19;
        const endX=cueX+(rule.axis==='x'?rule.sign*motion:0);
        const endY=cueY+(rule.axis==='y'?rule.sign*motion:0);
        ctx.save();ctx.strokeStyle='rgba(244,211,145,.44)';ctx.lineWidth=2.5;
        ctx.setLineDash([5,8]);ctx.beginPath();ctx.moveTo(cueX,cueY);
        ctx.lineTo(endX,endY);ctx.stroke();ctx.restore();
        drawOpenSourcePalm(ctx,cueX+(endX-cueX)*amt,cueY+(endY-cueY)*amt,
          scale*.081,rule.hand,.76);
        ctx.fillText(`Move your ${rule.hand.toLowerCase()} hand ${rule.handWord}`,W/2,scale*.10);
      }
      // Render the cursor last so even at the start of the hand demonstration
      // the gold feedback token remains visible and cannot be mistaken for art.
      drawTreasureCompassCursor(ctx,cursor.x,cursor.y);
      if(state.phase==='feedback') {
        const firstCorrect=state.lastResult?.ruleCorrect===true;
        ctx.fillStyle=(trial.kind==='v20_gate'?firstCorrect:hit)?'#f4d894':'#ecedf2';
        ctx.fillText(trial.kind==='v20_gate'
          ? (state.lastResult?.offAxisViolation?'Off-axis movement':state.lastResult?.outcome==='no_response'?'No valid movement detected':firstCorrect?'Initial direction correct':'Initial direction incorrect')
          : (state.lastResult?.offAxisViolation?'Off-axis movement':hit?'Gem collected!':'Not quite. Try the next gem.'),W/2,scale*.10);
      }
    }
  }
  if(state.lostAt!=null) {
    ctx.fillStyle='#ffe4a4';
    ctx.fillText(required.length===2?'Show both palms to the camera.':
      `Show your ${trial.hand.toLowerCase()} palm to the camera.`,W/2,H*.86);
  }
  endParticipantFacingOverlay(ctx);setReadoutIfChanged(state,setReadout,'');
}

const experiment={
  ...legacyExperiment,
  id:'two-hand-denovo-axis-constrained-prototype',
  title:'Axis-Constrained Two-Hand De Novo — Pilot Prototype',
  participantFlow:{...legacyExperiment.participantFlow,postTaskSurvey:false},
  trials:()=>{
    if(!axisIsPrototypeDev())return v20Trials;
    const mode=new URLSearchParams(location.search).get('axisTest');
    if(!mode)return v20Trials;
    const calibrations=v20Trials.filter(t=>t.kind==='continuous_calibration');
    if(mode==='dynamic')return [...calibrations,
      v20Trials.find(t=>t.id==='v20_dynamic_intro'),v20Trials.find(t=>t.id==='v20_dynamic_four')];
    if(mode==='gate')return [...calibrations,
      v20Trials.find(t=>t.id==='v20_gate_intro'),v20Trials.find(t=>t.id==='v20_control_gate')];
    if(mode==='training')return [...calibrations,
      ...v20Trials.filter(t=>t.kind==='v20_practice')];
    if(mode==='formal'){
      const base=v20Trials.find(t=>t.id==='v20_formal_1');
      return [...calibrations,v20Trials.find(t=>t.id==='v20_formal_intro'),
        {...base,id:'axis_formal_dev_12',targetSequence:base.targetSequence.slice(0,12),
          reachesRequired:12,visualReachOffset:0}];
    }
    return v20Trials;
  },
  qualityControl:{
    ...legacyExperiment.qualityControl,
    evaluateTrial(context) {
      const {trial,summary}=context;
      let decision;
      if(v20Custom(trial)) {
        const passed=trial.kind==='v20_gate'?summary?.gatePassed===true:summary?.blockFinishedNormally===true;
        const trackingFailed=trial.kind==='v20_gate'&&['gate_tracking_unreliable','tracking_unavailable'].includes(summary?.failureReason);
        decision=passed?{action:'continue'}:{action:'terminate',
          status:trial.kind==='v20_gate'&&!trackingFailed?'instruction_check_incomplete':'technical_preflight_failure',
          failureReason:summary?.failureReason||'v20_stage_incomplete',reasons:[summary?.failureReason||'v20_stage_incomplete']};
      } else decision=legacyExperiment.qualityControl.evaluateTrial(context);
      if(decision.action==='terminate'&&typeof document!=='undefined') {
        // Keep compensation instructions available even when the runner swaps
        // its own termination panel in after evaluateTrial returns.
        setTimeout(()=>v20Overlay(trial,{failureReason:decision.failureReason,finished:false},true),0);
      }
      return decision;
    }
  },
  onTrialStart(trial,context) {
    if(typeof document!=='undefined') {
      removeBimanualOverlay();document.body.classList.remove('v20-exit-overlay-active');v20Style();
      document.body.dataset.v20Scene=trial.scene||'setup';
      document.body.dataset.v20Task=trial.kind;
      v22ShowPercent(trial,null);
    }
    if(v20Custom(trial)) {
      setTreasureReachingUiMode(null);setBimanualTrackingOverlay(false);
      document.body.classList.add('bim-custom-flow-active');return v20StartState(trial);
    }
    return legacyExperiment.onTrialStart(trial,context);
  },
  onFrame(args) {
    const before=Array.isArray(args.state?.reaches)?args.state.reaches.length:
      Array.isArray(args.state?.attempts)?args.state.attempts.length:0;
    const derived=v20Custom(args.trial)?v20Frame(args):legacyExperiment.onFrame(args);
    const records=Array.isArray(args.state?.reaches)?args.state.reaches:
      Array.isArray(args.state?.attempts)?args.state.attempts:null;
    if(args.trial.axisConstrained&&records&&records.length>before){
      const m=args.state.axisMonitor;
      const last=records[records.length-1];
      last.axisConstrained=true;
      last.maxLeftOffAxis=m?.Left?.maxOffAxis??null;
      last.maxRightOffAxis=m?.Right?.maxOffAxis??null;
      if(last.offAxisViolation!==true)last.offAxisViolation=false;
      axisAddEvent(args.addEvent,'axis_attempt_metrics',{
        kind:args.trial.kind,targetDirection:last.targetDirection,
        index:last.index??last.targetIndex??args.state.targetIndex,
        offAxisViolation:last.offAxisViolation,
        maxLeftOffAxis:last.maxLeftOffAxis,maxRightOffAxis:last.maxRightOffAxis});
    }
    v22ShowPercent(args.trial,args.state);
    axisDebugHud(args.trial,args.state);
    return derived;
  },
  draw(ctx,args) {
    if(args.trial.v20) {v22ShowPercent(args.trial,args.state);v20Overlay(args.trial,args.state);setReadoutIfChanged(args.state,args.setReadout,'');return;}
    if(v20Custom(args.trial)){ensureResponsiveStage();fitStageToViewport();v20DrawCustom(ctx,args);return;}
    legacyExperiment.draw(ctx,args);
    if(args.trial.axisConstrained&&args.state?.phase==='return_home'&&
      Number.isFinite(args.state.axisFlashUntil)&&args.tMs<args.state.axisFlashUntil)
      axisDrawWarning(ctx,args.canvas,'Off-axis movement — Return HOME');
    // Numeric percent is rendered in a single fixed DOM badge for all stages.
  },
  onTrialEnd(args) {
    if(v20Custom(args.trial)) {
      removeBimanualOverlay();setBimanualTrackingOverlay(false);
      const s=args.state,t=args.trial;
      return {protocolVersion:'axis_constrained_v1',stage:t.kind,hand:t.hand??null,guided:t.guided===true,
        blockFinishedNormally:s.finished===true&&!s.failureReason,failureReason:s.failureReason||(s.finished?null:'v20_stage_incomplete'),
        gatePassed:s.gatePassed,gateErrorCount:s.errors,perfectRounds:s.perfectRounds,
        gateThresholds:{maxErrors:V20_CONFIG.gateMaxErrors,maxAttempts:V20_CONFIG.gateMaxAttempts,perfectRounds:V20_CONFIG.gatePerfectRounds},
        gateScoring:'confirmed_outward_retrospective_initial_direction_error_30deg',
        gateScoringParameters:{deadZone:V20_CONFIG.gateDeadZone,sampleRadii:V20_CONFIG.gateInitialSampleRadii,
          confirmRadius:V20_CONFIG.gateConfirmRadius,outwardMinMs:V20_CONFIG.gateOutwardMinMs,
          minFrames:V20_CONFIG.gateMinMotionFrames,maxStepSpeedUnitsPerMs:V20_CONFIG.gateMaxStepSpeedUnitsPerMs,
          syncWindowMs:V20_CONFIG.gateSyncWindowMs,ideToleranceDeg:V20_CONFIG.gateIdeToleranceDeg,
          maxTechnicalRetriesPerTarget:V20_CONFIG.gateMaxTechnicalRetriesPerTarget,
          maxTechnicalInvalidTotal:V20_CONFIG.gateMaxTechnicalInvalidTotal},
        gateTechnicalInvalidTotal:s.gateTechnicalInvalidTotal,
        gateNoResponseCount:s.gateNoResponseCount,
        axisConstrained:true,
        offAxisViolationCount:s.attempts.filter(r=>r.offAxisViolation===true).length,
        axisThresholds:AXIS_V1,
        gateInitialMovementThreshold:V20_CONFIG.gateDeadZone,
        gateInitialConfirmFrames:V20_CONFIG.gateMinMotionFrames,
        gateIdeToleranceDeg:V20_CONFIG.gateIdeToleranceDeg,
        planningTimeLimitMs:V20_CONFIG.planningWindowMs,
        targetSequence:s.sequence,reaches:s.attempts,invalidTrackingAttempts:s.invalidTrackingAttempts,
        dynamicSteps:s.dynamicSteps,dynamicPreflightQuality:s.dynamicQuality??null,
        dynamicMovingFrameCount:s.movingFrames.length,
        gateTrackingGapCount:s.gateTrackingGapCount,gateTrackingGapMs:s.gateTrackingGapMs,
        gateFreeRestartCount:s.gateFreeRestartCount,
        partialPaymentRequired:!!s.failureReason||!s.finished};
    }
    const base=legacyExperiment.onTrialEnd(args);
    const violations=(args.state.reaches||[]).filter(r=>r.offAxisViolation===true);
    return {...base,protocolVersion:'axis_constrained_v1',scene:args.trial.scene??'setup',
      axisConstrained:args.trial.axisConstrained===true,
      axisViolationCount:violations.length,axisViolations:violations,
      axisThresholds:AXIS_V1};
  }
};
export default experiment;
