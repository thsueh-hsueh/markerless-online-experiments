import { HAND } from "../js/core/tracker.js";


/* ============================================================
 * SINGLE-HAND INTUITIVE BASELINE — V5.18.0 ANGULAR SLICE
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
const WRONG_HAND_WARNING_MS = 350;
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

/* Hard safety timeout only; blocks normally end at 40 reaches. */
const CALIBRATION_MAX_SEC = 120;
const REACH_BLOCK_MAX_SEC = 300;


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
  ctx.fillText("Watch the hand move to the glowing circles.", W*0.5, H*0.84);
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


function drawProgressBadge(ctx, W, H, completed, total, tMs = 0, justCollected = false) {
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
  ctx.fillText("TASK PROGRESS", tx, y + h*0.28);

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

    feedbackMode: "continuous_cursor_then_frozen_angular_endpoint",
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
  if (document.getElementById("treasure-shell-v516")) return;

  const style = document.createElement("style");
  style.id = "treasure-shell-v516";
  style.textContent = `
    /* V5.16 responsive shell. Setup/instruction screens may scroll on short
       displays; only active trial/rest screens lock page scrolling. */
    body:has(#screen-position.visible),
    body:has(#screen-instructions.visible) { overflow-y:auto; }
    body:has(#screen-trial.visible),
    body:has(#screen-rest.visible) { overflow-y:hidden; }
    body:has(#screen-position.visible) main { max-width:900px; width:min(96vw,900px); }
    #screen-position { text-align:center; min-height:100dvh; box-sizing:border-box; padding-bottom:86px; }
    #screen-position > h2 { font-size:2rem; margin:8px 0 2px; }
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
      max-width:760px; margin:10px auto 10px; padding:14px 18px;
      border-radius:22px; background:radial-gradient(circle at 50% 18%,#17315f 0,#0d1d3d 52%,#091429 100%);
      border:1px solid rgba(151,196,255,.14); box-shadow:0 16px 40px rgba(0,0,0,.20);
    }
    #treasure-camera-cue .camera-hero { display:grid; grid-template-columns:1.1fr .9fr; align-items:center; gap:16px; }
    #treasure-camera-cue .camera-copy { text-align:left; }
    #treasure-camera-cue .camera-title { color:#f7f9ff; font:900 1.7rem/1.05 system-ui,sans-serif; letter-spacing:.02em; }
    #treasure-camera-cue .camera-sub { color:#dce7f8; font:700 1rem/1.35 system-ui,sans-serif; margin-top:5px; }
    #treasure-camera-cue .camera-note { color:#aebed2; font:600 .92rem/1.35 system-ui,sans-serif; margin-top:9px; }
    #treasure-camera-cue .laptop { width:236px; margin:0 auto; color:#d9e9ff; }
    #treasure-camera-cue .laptop-screen {
      width:214px; height:122px; margin:0 auto; position:relative; display:grid; place-items:center;
      border:4px solid #8da7c7; border-radius:13px 13px 8px 8px; background:#102449;
      box-shadow:inset 0 0 38px rgba(77,132,213,.17),0 12px 28px rgba(0,0,0,.22);
    }
    #treasure-camera-cue .webcam-dot { position:absolute; top:3px; left:50%; width:9px; height:9px; border-radius:50%; transform:translateX(-50%); background:#cfe5ff; box-shadow:0 0 0 2px rgba(53,96,150,.9),0 0 8px rgba(159,200,255,.8); }
    #treasure-camera-cue .laptop-screen .camera-palm { transform:translateY(4px); filter:drop-shadow(0 6px 10px rgba(0,0,0,.18)); }
    #treasure-camera-cue .laptop-base { width:236px; height:11px; margin:0 auto 0; border-radius:3px 3px 12px 12px; background:#7890ae; clip-path:polygon(7% 0,93% 0,100% 100%,0 100%); }

    #position-status { min-height:1.5em; margin:6px 0 2px; font-size:1.02rem; }
    #screen-position .treasure-camera-actions {
      display:flex; justify-content:center; margin-top:8px; position:sticky; bottom:8px; z-index:30;
      padding:8px 10px; border-radius:18px; background:rgba(6,15,32,.88);
      -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);
    }
    #screen-position .treasure-camera-actions button { width:min(420px,100%); margin-top:0; }
    #treasure-camera-tips { max-width:760px; margin:8px auto 0; display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
    #treasure-camera-tips .tip { display:flex; align-items:center; justify-content:center; gap:8px; min-height:46px; padding:7px 10px; border-radius:15px; background:rgba(19,37,66,.68); border:1px solid rgba(145,190,246,.15); color:#dbe7f7; font-size:.90rem; font-weight:650; }
    #treasure-camera-tips svg { flex:0 0 auto; color:#9fc8ff; }
    @media (max-width:720px) {
      #treasure-camera-cue .camera-hero { grid-template-columns:1fr; }
      #treasure-camera-cue .camera-copy { text-align:center; }
      #treasure-camera-tips { grid-template-columns:1fr; }
      #screen-position .treasure-camera-actions button { width:100%; }
    }
    @media (max-height:820px) {
      #treasure-camera-cue { margin:5px auto 6px; padding:10px 16px; }
      #treasure-camera-cue .camera-title { font-size:1.5rem; }
      #treasure-camera-cue .camera-note { display:none; }
      #treasure-camera-cue .laptop { width:190px; }
      #treasure-camera-cue .laptop-screen { width:172px; height:94px; }
      #treasure-camera-cue .laptop-base { width:190px; }
      #treasure-camera-tips { display:none; }
      body:has(#screen-position.visible) #stage { width:min(90vw,560px,calc((100dvh - 220px) * 4 / 3)); }
    }
    @media (max-height:640px) {
      #screen-position > h2 { font-size:1.55rem; }
      #treasure-camera-cue .camera-hero { grid-template-columns:1fr; }
      #treasure-camera-cue .camera-copy { text-align:center; }
      #treasure-camera-cue .laptop { display:none; }
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
    #screen-rest[data-transition-kind="skipCalibration"] { opacity:0; pointer-events:none; }
    #screen-rest[data-transition-kind="skipCalibration"] #treasure-rest-countdown,
    #screen-rest[data-transition-kind="skipCalibration"] #treasure-rest-auto-note { display:none !important; }
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
  document.head.appendChild(style);

  const position = document.getElementById("screen-position");
  if (position) {
    const title = position.querySelector("h2");
    const intro = title?.nextElementSibling;
    if (title) title.textContent = "Camera check";
    if (intro?.tagName === "P") intro.style.display = "none";

    const stageSlot = document.getElementById("position-stage-slot");
    if (stageSlot && !document.getElementById("treasure-camera-cue")) {
      const cue = document.createElement("div");
      cue.id = "treasure-camera-cue";
      cue.innerHTML = `
        <div class="camera-hero">
          <div class="camera-copy">
            <div class="camera-title">RAISE EITHER HAND</div>
            <div class="camera-sub">Show your palm to the camera.</div>
          </div>
          <div class="laptop" aria-hidden="true">
            <div class="laptop-screen"><span class="webcam-dot"></span><div style="display:flex;align-items:center;justify-content:center;gap:2px;">${palmImageHtml("Right",72,"camera-palm")}</div></div>
            <div class="laptop-base"></div>
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
        <div class="tip"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3"/></svg><span>About an arm's length away</span></div>
        <div class="tip"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/></svg><span>Plain background</span></div>`;
      oldHelp.replaceWith(tips);
    }
  }

  const posStatus = document.getElementById("position-status");
  if (posStatus) {
    const shortenStatus = () => {
      const t = (posStatus.textContent || "").trim();
      let next = t;
      if (/Looking good/i.test(t)) next = "Looks good!";
      else if (/not visible/i.test(t) || /Looking for/i.test(t)) next = "Raise either hand";
      else if (/Hold still/i.test(t)) next = "Hold still…";
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
      const reachingTotal = Math.max(0, total - 2);
      const reachingDone = Math.max(0, done - 2);
      const art = document.getElementById("treasure-rest-art");
      const howto = document.getElementById("treasure-rest-howto");
      if (howto) howto.innerHTML = "";

      if (done === 1) {
        rest.dataset.treasureRestSec = String(CALIBRATION_INTER_HAND_REST_SEC);
        rest.dataset.transitionKind = "skipCalibration";
        if (h2) h2.textContent = "";
        if (bodyP) bodyP.textContent = "";
        if (art) art.innerHTML = "";
        return;
      }

      const midpointReached = reachingTotal > 0 && reachingDone === Math.floor(reachingTotal / 2);
      if (midpointReached) {
        rest.dataset.treasureRestSec = String(MIDPOINT_BREAK_SEC);
        rest.dataset.transitionKind = "midpoint";
        if (h2) h2.textContent = "HALFWAY THERE!";
        if (bodyP) bodyP.innerHTML = `Take a short break.<br><span style="display:inline-block;margin-top:7px;color:#8fb8ff;font-weight:900;letter-spacing:.07em;">SECOND HALF</span><br><span style="display:inline-block;margin-top:3px;font-weight:800;color:#eaf3ff;">The hand-position dot will stay visible.</span>`;
        if (art) art.innerHTML = `<svg width="116" height="100" viewBox="0 0 116 100" aria-hidden="true"><path d="M24 48h68v35H24z" fill="#7e421d" stroke="#f0c56c" stroke-width="3"/><path d="M24 48c4-21 16-31 34-31s30 10 34 31H24Z" fill="#bd7130" stroke="#f0c56c" stroke-width="3"/><path d="M42 20v63M74 20v63" stroke="#e8bd62" stroke-width="4"/><rect x="51" y="55" width="14" height="14" rx="3" fill="#ffe69b"/></svg>`;
        if (!rest.dataset.midpointChimePlayed) {
          rest.dataset.midpointChimePlayed = "1";
          playTreasureChime("midpoint");
        }
        return;
      }

      if (done >= total) {
        rest.dataset.treasureRestSec = "2";
        rest.dataset.transitionKind = "complete";
        if (h2) h2.textContent = "TREASURE HUNT COMPLETE!";
        if (bodyP) bodyP.textContent = "";
        if (art) art.innerHTML = "";
        return;
      }

      const nextReachingIndex = reachingDone;
      const nextHand = nextReachingIndex % 2 === 0 ? "Right" : "Left";
      rest.dataset.treasureRestSec = String(FIXED_INTER_BLOCK_REST_SEC);
      rest.dataset.transitionKind = "reaching";
      if (h2) h2.textContent = `${nextHand.toUpperCase()} HAND ONLY`;
      if (bodyP) bodyP.textContent = "Move quickly through each gem.";
      if (art) art.innerHTML = "";
      if (howto) howto.innerHTML = `
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
      if (rest.dataset.transitionKind === "skipCalibration") {
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
    overlay.innerHTML = `<div class="slow-card"><div class="slow-title">Move faster!</div><div class="slow-sub">Try a quick, smooth reach.</div></div>`;
    document.body.appendChild(overlay);
  }

  if (document.body && !document.getElementById("treasure-tracking-overlay")) {
    const overlay = document.createElement("div");
    overlay.id = "treasure-tracking-overlay";
    overlay.innerHTML = `<div class="tracking-card"><div class="tracking-title">HAND NOT DETECTED</div><div class="tracking-sub">Show your palm to the camera.</div></div>`;
    document.body.appendChild(overlay);
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

function showTooSlowWarning(durationMs = TOO_SLOW_WARNING_MS) {
  if (typeof document === "undefined") return;
  const overlay = document.getElementById("treasure-too-slow-overlay");
  if (!overlay) return;

  overlay.classList.add("show");
  if (treasureTooSlowTimer != null) clearTimeout(treasureTooSlowTimer);
  treasureTooSlowTimer = setTimeout(() => {
    overlay.classList.remove("show");
    treasureTooSlowTimer = null;
  }, durationMs);
}

if (typeof document !== "undefined") setupTreasureShellUi();

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
    body.treasure-calibration-active #trial-prompt,
    body.treasure-calibration-active #screen-trial > .progress,
    body.treasure-calibration-active #trial-timer {
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

function reachingTrial(id, hand, feedback, repetition) {
  return {
    id,
    kind: "baseline_reaching",
    hand,
    feedback,
    repetition,
    showCamera: false,
    durationSec: REACH_BLOCK_MAX_SEC,
    countdownSec: 0,
    prompt:
      `${hand.toUpperCase()} HAND · ${feedback ? "HAND-POSITION DOT VISIBLE" : "HAND-POSITION DOT HIDDEN"}`,
  };
}


export default {
  id: "single-hand-baseline-2d-v5-18-1-angular-slice-320",

  title: "Single-Hand Baseline V5.18.1 ANGULAR SLICE — 320 Reaches",

  tracker: "hand",

  trackerOptions: {
    numHands: 2,
  },

  participantFlow: {
    simplifiedConsent: true,
    gestureStart: true,
    postTaskSurvey: true,
    showScore: true,
  },

  instructions: `
    <style>
      body:has(#screen-instructions.visible .treasure-v516-instructions) #screen-instructions > h2 { display:none; }
      body:has(#screen-instructions.visible .treasure-v516-instructions) #instructions-text.prose { background:transparent; padding:0; }
      body:has(#screen-instructions.visible .treasure-v516-instructions) main { max-width:none; width:100%; }
      .treasure-v516-instructions { max-height:calc(100dvh - 20px); overflow-y:auto !important; }
      .treasure-v516-instructions .instruction-steps { display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:760px;margin:0 auto;text-align:center; }
      @media (max-width:720px) { .treasure-v516-instructions .instruction-steps { grid-template-columns:1fr; } }
      @media (max-height:700px) {
        .treasure-v516-instructions { padding:18px 24px 18px !important; }
        .treasure-v516-instructions .instruction-demo { margin:8px auto 8px !important; padding:6px 10px 4px !important; }
        .treasure-v516-instructions .instruction-demo svg { height:150px !important; }
        .treasure-v516-instructions .gesture-start-card { margin-top:10px !important; }
      }
      .treasure-v516-instructions .how-hand { animation:treasureHowHand516 4.6s cubic-bezier(.45,.04,.2,1) infinite; transform-box:fill-box; transform-origin:center; }
      .treasure-v516-instructions .how-chest { animation:treasureHowChest516 4.6s linear infinite; }
      .treasure-v516-instructions .how-gem { animation:treasureHowGem516 1.25s ease-in-out infinite; transform-box:fill-box; transform-origin:center; }
      @keyframes treasureHowHand516 {
        0%,18% { transform:translateX(0); }
        46%,62% { transform:translateX(420px); }
        88%,100% { transform:translateX(0); }
      }
      @keyframes treasureHowChest516 {
        0%,44% { opacity:1; }
        49%,62% { opacity:.10; }
        69%,100% { opacity:1; }
      }
      @keyframes treasureHowGem516 { 0%,100%{filter:drop-shadow(0 0 6px rgba(120,190,255,.45));transform:scale(.98)} 50%{filter:drop-shadow(0 0 15px rgba(120,190,255,.95));transform:scale(1.05)} }
      .treasure-v516-instructions .gesture-start-card {
        max-width:430px;margin:18px auto 0;padding:12px 18px;border-radius:19px;
        display:flex;align-items:center;justify-content:center;gap:13px;
        background:rgba(255,255,255,.055);border:1px solid rgba(192,219,255,.13);
      }
      .treasure-v516-instructions .gesture-icon {
        width:68px;height:68px;object-fit:contain;
        animation:treasureGesturePulse516 1.6s ease-in-out infinite;
        filter:hue-rotate(172deg) saturate(.58) brightness(1.22) drop-shadow(0 0 8px rgba(126,174,255,.24));
      }
      .treasure-v516-instructions .gesture-copy { text-align:left;line-height:1.16;min-width:0; }
      .treasure-v516-instructions .gesture-title { color:#f5f9ff;font-weight:950;font-size:clamp(1.12rem,2.2vw,1.38rem);letter-spacing:.02em; }
      .treasure-v516-instructions .gesture-sub { margin-top:5px;color:#bcd6f5;font-weight:750;font-size:clamp(.98rem,1.7vw,1.10rem);line-height:1.25; }
      #treasure-gesture-start-status { min-height:1.25em; }
      @keyframes treasureGesturePulse516 { 0%,100%{transform:scale(.96)} 50%{transform:scale(1.06)} }
    </style>

    <div class="treasure-v516-instructions" style="width:min(94vw,1000px);box-sizing:border-box;margin:0 auto;padding:30px 38px 28px;border-radius:26px;background:radial-gradient(circle at 50% 24%,#173366 0,#0d1e42 48%,#08152e 100%);color:#eef6ff;box-shadow:0 22px 60px rgba(0,0,0,.28);border:1px solid rgba(150,198,255,.12);position:relative;">
      <div style="text-align:center;font-size:clamp(1.65rem,4vw,2.5rem);line-height:1.08;font-weight:950;letter-spacing:.01em;color:#ffe28a;text-shadow:0 0 18px rgba(255,211,105,.22);">MOVE QUICKLY THROUGH EACH GEM.</div>
      <div style="text-align:center;margin-top:8px;color:#b9c9df;font-size:1rem;font-weight:650;">Follow the 3 steps below.</div>

      <div class="instruction-demo" style="margin:15px auto 13px;max-width:760px;padding:10px 14px 7px;border-radius:22px;background:rgba(255,255,255,.045);border:1px solid rgba(192,219,255,.10);">
        <svg viewBox="0 0 720 210" width="100%" height="225" aria-hidden="true">
          <defs>
            <linearGradient id="v516chestBody" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#c97830"/><stop offset=".58" stop-color="#8b4922"/><stop offset="1" stop-color="#4d2918"/></linearGradient>
            <linearGradient id="v516chestLid" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#e49b47"/><stop offset="1" stop-color="#7b3d1e"/></linearGradient>
            <linearGradient id="v516gem" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e6f5ff"/><stop offset=".46" stop-color="#72a9ff"/><stop offset="1" stop-color="#4d4ab8"/></linearGradient>
          </defs>

          <g class="how-chest">
            <rect x="92" y="92" width="78" height="44" rx="8" fill="url(#v516chestBody)" stroke="#efc56b" stroke-width="3"/>
            <path d="M92 94 Q99 58 131 58 Q163 58 170 94 Z" fill="url(#v516chestLid)" stroke="#efc56b" stroke-width="3"/>
            <path d="M111 64V135M151 64V135" stroke="#e9bf65" stroke-width="4"/>
            <rect x="121" y="102" width="20" height="16" rx="3" fill="#ffe49a" stroke="#9c6824" stroke-width="2"/>
          </g>

          <g class="how-gem">
            <path d="M568 51 L606 78 L594 132 L542 132 L530 78 Z" fill="url(#v516gem)" stroke="#f2f8ff" stroke-width="4"/>
            <path d="M546 77 L569 60 L591 78" fill="none" stroke="rgba(255,255,255,.76)" stroke-width="4" stroke-linecap="round"/>
          </g>

          <image class="how-hand" href="${OPENMOJI_PALM_URL}" x="88" y="42" width="92" height="112" preserveAspectRatio="xMidYMid meet" style="filter:${OPENMOJI_PALM_FILTER} drop-shadow(0 0 8px rgba(126,174,255,.22));"/>
        </svg>
      </div>

      <div class="instruction-steps">
        <div style="padding:11px 9px;border-radius:16px;background:rgba(255,255,255,.045);"><b style="display:block;color:#8fb8ff;margin-bottom:3px;">STEP 1</b><span style="font-weight:780;">Start at the treasure chest.</span></div>
        <div style="padding:11px 9px;border-radius:16px;background:rgba(255,255,255,.045);"><b style="display:block;color:#8fb8ff;margin-bottom:3px;">STEP 2</b><span style="font-weight:780;">Move through the gem.</span></div>
        <div style="padding:11px 9px;border-radius:16px;background:rgba(255,255,255,.045);"><b style="display:block;color:#8fb8ff;margin-bottom:3px;">STEP 3</b><span style="font-weight:780;">Return to the chest.</span></div>
      </div>
      <div style="max-width:760px;margin:12px auto 0;text-align:center;color:#d9e8fb;font-weight:800;font-size:clamp(1.08rem,2vw,1.28rem);line-height:1.25;">
        <div style="color:#8fb8ff;font-size:.82em;letter-spacing:.08em;margin-bottom:3px;">FIRST HALF</div>
        <div>The hand-position dot will be hidden while you reach.</div>
      </div>

      <div class="gesture-start-card">
        <img id="treasure-gesture-start-icon" class="gesture-icon" src="${OPENMOJI_BOOK_URL}" data-read-src="${OPENMOJI_BOOK_URL}" data-open-src="${OPENMOJI_PALM_URL}" data-fist-src="${OPENMOJI_FIST_URL}" alt="" aria-hidden="true">
        <div class="gesture-copy">
          <div id="treasure-gesture-start-title" class="gesture-title">READ THE 3 STEPS ABOVE</div>
          <div id="treasure-gesture-start-status" class="gesture-sub">The start gesture will unlock shortly.</div>
        </div>
      </div>
    </div>
  `,

  trials: [
    {
      id: "cal_left_continuous",
      kind: "continuous_calibration",
      hand: "Left",
      showCamera: true,
      durationSec: CALIBRATION_MAX_SEC,
      countdownSec: 0,
      prompt:
        "Set up your treasure map · LEFT HAND",
    },

    {
      id: "cal_right_continuous",
      kind: "continuous_calibration",
      hand: "Right",
      showCamera: true,
      durationSec: CALIBRATION_MAX_SEC,
      countdownSec: 0,
      prompt:
        "Set up your treasure map · RIGHT HAND",
    },

    /* No feedback: R -> L -> R -> L = 160 reaches (40 per block). */
    reachingTrial("nf_right_1", "Right", false, 1),
    reachingTrial("nf_left_1", "Left", false, 1),
    reachingTrial("nf_right_2", "Right", false, 2),
    reachingTrial("nf_left_2", "Left", false, 2),

    /* Feedback: R -> L -> R -> L = 160 reaches (40 per block). */
    reachingTrial("fb_right_1", "Right", true, 1),
    reachingTrial("fb_left_1", "Left", true, 1),
    reachingTrial("fb_right_2", "Right", true, 2),
    reachingTrial("fb_left_2", "Left", true, 2),
  ],


  /* ==========================================================
   * TRIAL START
   * ========================================================== */

  onTrialStart(trial, { tracker }) {
    setTreasureReachingUiMode(trial.kind === "baseline_reaching" ? "reaching" : trial.kind === "continuous_calibration" ? "calibration" : null);

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

    if (trial.kind === "baseline_reaching") {
      return {
        phase: "home",
        finished: false,
        targetSequence: makeTargetSequence(CYCLES_PER_BLOCK),
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

    if (trial.kind === "baseline_reaching") {
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
            if (!repeatSameTarget && state.completedReaches >= REACHES_PER_BLOCK) {
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
      if (state.calibrationComplete) status = "Treasure map ready!";

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

    if (trial.kind === "baseline_reaching") {
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
      const overallCompleted =
        reachingBlockIndex(trial) * REACHES_PER_BLOCK + Math.min(displayedCompleted, REACHES_PER_BLOCK);
      const overallTotal = TOTAL_REACHING_BLOCKS * REACHES_PER_BLOCK;

      drawProgressBadge(
        ctx,
        W,
        H,
        overallCompleted,
        overallTotal,
        tMs,
        state.collectSparkleStartMs != null && tMs - state.collectSparkleStartMs <= GEM_SPARKLE_MS
      );

      endParticipantFacingOverlay(ctx);
      return;
    }
  },


  /* ==========================================================
   * TRIAL END / SUMMARY
   * ========================================================== */

  onTrialEnd({ trial, state }) {
    setTreasureReachingUiMode(null);
    setTrackingLossOverlay(false);

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

      console.log(`Calibration ${trial.hand}:`, c);

      return {
        hand: trial.hand,
        calibrationComplete: state.calibrationComplete,
        calibrationValid: valid,
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

    if (trial.kind === "baseline_reaching") {
      const validReaches = state.reaches.filter((r) => !r.timedOut && !r.invalid);

      const mean = (values) => {
        const clean = values.filter((v) => Number.isFinite(v));
        if (!clean.length) return null;
        return clean.reduce((a, b) => a + b, 0) / clean.length;
      };

      return {
        hand: trial.hand,
        feedback: trial.feedback,
        repetition: trial.repetition,
        requestedReaches: REACHES_PER_BLOCK,
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
          ? "continuous_cursor_then_frozen_angular_endpoint"
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
