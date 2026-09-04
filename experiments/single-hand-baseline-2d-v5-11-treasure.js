import { HAND } from "../js/core/tracker.js";


/* ============================================================
 * SINGLE-HAND INTUITIVE BASELINE — V5.8 TREASURE HUNT
 *
 * Purpose
 * -------
 * Measure each hand's baseline center-out reaching behavior before
 * the bimanual/de-novo tasks.
 *
 * Intuitive controller:
 *   hand X -> cursor X
 *   hand Y -> cursor Y
 *
 * Experimental structure
 * ----------------------
 * 1) Continuous LEFT-hand calibration
 * 2) Continuous RIGHT-hand calibration
 * FORMAL STRUCTURE:
 * 3) NO-FEEDBACK: Right 8 -> Left 8 -> Right 8 -> Left 8 = 32 reaches
 * 4) FEEDBACK:    Right 8 -> Left 8 -> Right 8 -> Left 8 = 32 reaches
 *
 * Total = 320 reaches. Each block contains five complete randomized
 * cycle of the 8 target directions.
 *
 * V5.8 feedback design:
 * - NO-FEEDBACK: cursor is hidden during the outbound reach
 * - FEEDBACK: cursor remains continuously visible during the outbound reach
 * - the registered endpoint is therefore a closed-loop, visually guided outcome
 * - when the endpoint is registered, that endpoint cursor is FROZEN for 1000 ms
 * - the hand may relax/return during the freeze; the frozen dot does not follow the hand
 * - there is NO post-endpoint live-correction period in V5
 * - early/feedforward direction should be estimated offline from the raw trajectory
 *   (e.g. around 100 ms after velocity-based movement onset), while endpoint error
 *   reflects the result after online visual correction
 * - V4's near-target undershoot endpoint logic is retained
 * - V5.11 keeps V5.10 motor logic and optimizes rendering / participant cues and refines fullscreen, return-home cue, warning, rest timing, and target visuals
 * - online MT > 700 ms triggers a 1500-ms speed reminder
 * - TOO SLOW trials are flagged but NOT repeated or auto-excluded
 * - online timing fields remain provisional; formal RT/MT should be recomputed
 *   offline from raw trajectories.
 *
 * IMPORTANT RUNNER REQUIREMENT
 * ----------------------------
 * The experiment sets state.finished = true when a calibration
 * sequence or reaching block is complete. js/core/experiment.js
 * must therefore allow recordTrial() to stop when state.finished.
 * See the companion PowerShell patch script.
 * ============================================================
 */


/* ============================================================
 * EXPERIMENT-WIDE PARAMETERS
 * ============================================================
 */

const TARGET_ECCENTRICITY = 0.70;
const DISPLAY_GAIN = 0.30;

const HOME_RADIUS = 0.10;
const HOME_HOLD_MS = 500;

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

/* V5: during FEEDBACK reaches the cursor is visible throughout the outbound
   movement. Once the endpoint is registered, the endpoint cursor is frozen for
   a fixed 500 ms. This is outcome display only — not a live correction window. */
const TARGET_HIT_RADIUS = 0.10;
const FEEDBACK_FREEZE_MS = 500;

/* V5.1 speed instruction/QC. Warning only; task logic is unchanged. */
const TOO_SLOW_MT_MS = 700;
const TOO_SLOW_WARNING_MS = 1500;

const RETURN_GUIDE_DELAY_MS = 250;
const RETURN_SHOW_CURSOR_RADIUS = 0.28;

const REACHES_PER_BLOCK = 40;
const GEM_VISUAL_RADIUS_PX = 16;
const FIXED_INTER_BLOCK_REST_SEC = 15;
const CALIBRATION_INTER_HAND_REST_SEC = 5;
const CYCLES_PER_BLOCK = 1;

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
  return {
    x: 0.5 + taskX * DISPLAY_GAIN,
    y: 0.5 + taskY * DISPLAY_GAIN,
  };
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
  return 9;
}


/* ============================================================
 * TREASURE-HUNT VISUALS — V5.11
 * ============================================================
 * Vector-drawn gems: no emoji and no external image assets.
 * Decorative motion is visual-only and runs concurrently with the
 * existing task phases, so it adds no trial time.
 * The gem center, target geometry, success criterion, and timing are
 * unchanged from V5.1/V5.3.
 */

const EARLY_HEADING_MS = 100;
const GEM_SPARKLE_MS = 150;
const PRAISE_MS = 260;
const PRAISE_WORDS = ["NICE!", "GREAT!", "GOT IT!", "AWESOME!", "WELL DONE!"];

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
  const w = size * 1.90;
  const bodyH = size * 0.92;
  const lidH = size * 0.62;
  const bodyTop = y - size*0.02;
  const left = x - w/2;
  openPct = clamp(openPct, 0, 1);

  ctx.save();

  /* Lightweight return-home beacon. The chest still opens, but this version
     avoids animated particle loops / extra gradients during tracking. */
  if (openPct > 0) {
    ctx.save();
    ctx.globalAlpha = (0.10 + 0.04*pulse) * openPct;
    ctx.fillStyle = "#ffe39a";
    ctx.beginPath();
    ctx.moveTo(x-w*0.44, bodyTop+size*0.10);
    ctx.lineTo(x-w*0.72, bodyTop-size*1.85);
    ctx.lineTo(x+w*0.72, bodyTop-size*1.85);
    ctx.lineTo(x+w*0.44, bodyTop+size*0.10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* Soft shadow/halo: keeps the chest readable without looking like a target dot. */
  ctx.shadowBlur = active ? 24 : 12;
  ctx.shadowColor = active ? "rgba(255,218,112,0.72)" : "rgba(255,195,82,0.26)";

  const bodyGrad = ctx.createLinearGradient(left, bodyTop, left+w, bodyTop+bodyH);
  bodyGrad.addColorStop(0, "#c9772f");
  bodyGrad.addColorStop(0.55, "#8d4a22");
  bodyGrad.addColorStop(1, "#502a18");
  ctx.fillStyle = bodyGrad;
  ctx.strokeStyle = active ? "#ffe8a6" : "#e4b65b";
  ctx.lineWidth = Math.max(2.2, size*0.09);

  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(left, bodyTop, w, bodyH, size*0.16);
  else ctx.rect(left, bodyTop, w, bodyH);
  ctx.fill();
  ctx.stroke();

  /* Rounded lid; lift it while the participant returns home. */
  const lidLift = size * 0.52 * openPct;
  const lidTop = bodyTop - lidH*0.72 - lidLift;
  const lidEdgeY = bodyTop + size*0.03 - lidLift*0.42;
  ctx.beginPath();
  ctx.moveTo(left, lidEdgeY);
  ctx.quadraticCurveTo(left + w*0.12, lidTop, x, lidTop);
  ctx.quadraticCurveTo(left + w*0.88, lidTop, left+w, lidEdgeY);
  ctx.closePath();
  const lidGrad = ctx.createLinearGradient(x, lidTop, x, bodyTop+size*0.08);
  lidGrad.addColorStop(0, "#e29a45");
  lidGrad.addColorStop(0.60, "#ad6128");
  lidGrad.addColorStop(1, "#773b1d");
  ctx.fillStyle = lidGrad;
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;

  /* Gold frame and bands. */
  ctx.strokeStyle = active ? "#fff0b2" : "#e9bf65";
  ctx.lineWidth = Math.max(2.2, size*0.085);
  const bandInset = w*0.25;
  ctx.beginPath();
  ctx.moveTo(x-bandInset, lidTop+size*0.06);
  ctx.lineTo(x-bandInset, bodyTop+bodyH*0.94);
  ctx.moveTo(x+bandInset, lidTop+size*0.06);
  ctx.lineTo(x+bandInset, bodyTop+bodyH*0.94);
  ctx.stroke();

  /* Thin lid highlight adds depth. */
  ctx.strokeStyle = "rgba(255,236,175,0.58)";
  ctx.lineWidth = Math.max(1.4, size*0.05);
  ctx.beginPath();
  ctx.moveTo(left+w*0.16, bodyTop-size*0.28);
  ctx.quadraticCurveTo(x, lidTop+size*0.10, left+w*0.84, bodyTop-size*0.28);
  ctx.stroke();

  /* Wide lock plate, not a circular center mark. */
  ctx.fillStyle = active ? "#fff0a8" : "#f0c967";
  ctx.strokeStyle = "#9c6824";
  ctx.lineWidth = Math.max(1.2, size*0.045);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x-size*0.19, bodyTop+bodyH*0.20, size*0.38, size*0.32, size*0.07);
  else ctx.rect(x-size*0.19, bodyTop+bodyH*0.20, size*0.38, size*0.32);
  ctx.fill();
  ctx.stroke();

  if (!compact) {
    ctx.globalAlpha = active ? 0.34 + 0.12*pulse : 0.13 + 0.04*pulse;
    ctx.strokeStyle = active ? "#8ff0d1" : "#738ba9";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, size*1.52 + 1.5*pulse, 0, Math.PI*2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawHomeChest(ctx, x, y, active, tMs = 0, returning = false) {
  /*
   * V5.7: the true home coordinate is unchanged for all task logic and data.
   * Only the participant-facing rendering changes: show a centered chest with
   * no visible circular home ring. drawTreasureChest is slightly bottom-heavy,
   * so shift its drawing anchor upward to align the chest's visual center with
   * the hidden home coordinate.
   */
  const size = 26;
  const visualCenterOffsetY = size * 0.22;
  const openPct = returning ? 0.92 : 0;
  drawTreasureChest(ctx, x, y - visualCenterOffsetY, size, active || returning, tMs, true, openPct);
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

  const halo = ctx.createRadialGradient(cx, cy, size*0.12, cx, cy, size*(1.42 + 0.10*pulse));
  halo.addColorStop(0, style.glow);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = 0.82 + 0.18*pulse;
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, size*1.58, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.shadowBlur = 18 + 4*pulse;
  ctx.shadowColor = style.glow;
  const fill = ctx.createLinearGradient(cx-size, cy-size, cx+size, cy+size);
  fill.addColorStop(0, style.light);
  fill.addColorStop(0.48, style.mid);
  fill.addColorStop(1, style.dark);
  ctx.fillStyle = fill;
  pathPolygon(ctx, pts);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = "rgba(255,255,255,0.78)";
  pathPolygon(ctx, pts);
  ctx.stroke();

  /* Facets stay away from the exact center: no target-like center point. */
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  const top = pts[0];
  const right = pts[Math.max(1, Math.floor(pts.length * 0.30))];
  const left = pts[Math.max(1, Math.floor(pts.length * 0.72))];
  ctx.beginPath();
  ctx.moveTo(top[0], top[1]);
  ctx.lineTo(cx + size*0.18, cy - size*0.16);
  ctx.lineTo(right[0], right[1]);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(top[0], top[1]);
  ctx.lineTo(cx - size*0.20, cy - size*0.10);
  ctx.lineTo(left[0], left[1]);
  ctx.stroke();

  /* Angled glint. */
  ctx.save();
  ctx.translate(cx - size*0.24, cy - size*0.31);
  ctx.rotate(-0.45);
  ctx.fillStyle = `rgba(255,255,255,${0.58 + 0.20*pulse})`;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-size*0.16, -size*0.045, size*0.32, size*0.09, size*0.05);
  else ctx.rect(-size*0.16, -size*0.045, size*0.32, size*0.09);
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

function praiseIndexForReach(trial, state) {
  const handOffset = trial.hand === "Left" ? 2 : 0;
  const feedbackOffset = trial.feedback ? 1 : 0;
  const repOffset = (trial.repetition ?? 0) * 3;
  return (state.targetIndex * 2 + handOffset + feedbackOffset + repOffset) % PRAISE_WORDS.length;
}

function drawPraise(ctx, W, H, state, tMs) {
  if (state.praiseStartMs == null || state.praiseIndex == null) return;
  const elapsed = tMs - state.praiseStartMs;
  if (elapsed < 0 || elapsed > PRAISE_MS) return;

  const p = elapsed / PRAISE_MS;
  const alpha = p < 0.20 ? p / 0.20 : Math.max(0, 1 - (p - 0.20) / 0.80);
  const scale = 0.94 + 0.08 * Math.sin(Math.min(1, p) * Math.PI);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(W * 0.50, H * 0.115);
  ctx.scale(scale, scale);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `850 ${Math.round(Math.min(W,H)*0.050)}px sans-serif`;
  ctx.lineWidth = Math.max(3, Math.min(W,H)*0.006);
  ctx.strokeStyle = "rgba(7,17,38,0.90)";
  ctx.fillStyle = "#fff0a8";
  const word = PRAISE_WORDS[state.praiseIndex % PRAISE_WORDS.length];
  ctx.strokeText(word, 0, 0);
  ctx.fillText(word, 0, 0);
  ctx.restore();
}

function drawProgressBadge(ctx, W, H, completed, total, tMs = 0, justCollected = false) {
  const scale = Math.min(W, H);
  const h = Math.max(58, Math.round(scale * 0.095));
  const w = Math.max(154, Math.round(scale * 0.255));
  const x = W - w - Math.round(scale * 0.030);
  const y = Math.round(scale * 0.026);
  const glow = justCollected ? 0.48 + 0.20*Math.sin(tMs/70) : 0.14;

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

  const iconX = x + h*0.50;
  const iconY = y + h*0.43;
  drawGem(ctx, iconX, iconY, h*0.22, 2, tMs);

  ctx.fillStyle = "#f5f8ff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `850 ${Math.round(h*0.39)}px sans-serif`;
  ctx.fillText(`${completed} / ${total}`, x + h*0.94, y + h*0.42);

  const barX = x + h*0.94;
  const barY = y + h*0.72;
  const barW = w - h*1.18;
  const barH = Math.max(4, h*0.07);
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

function drawBlockStartOverlay(ctx, W, H, trial, state, tMs = 0) {
  if (!(state.completedReaches === 0 && state.phase === "home")) return;

  const scale = Math.min(W, H);
  const boxW = Math.min(W*0.42, 360);
  const boxH = Math.min(H*0.16, 104);
  const x = (W-boxW)/2;
  const y = H*0.095;

  ctx.save();
  ctx.fillStyle = "rgba(5,14,32,0.84)";
  ctx.strokeStyle = "rgba(180,220,255,0.28)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, boxW, boxH, 18);
  else ctx.rect(x, y, boxW, boxH);
  ctx.fill();
  ctx.stroke();

  drawGem(ctx, x + boxH*0.43, y + boxH*0.50, boxH*0.16, trial.feedback ? 5 : 4, tMs);

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const tx = x + boxH*0.78;
  ctx.fillStyle = "#f6f9ff";
  ctx.font = `850 ${Math.round(scale*0.034)}px sans-serif`;
  ctx.fillText(`${trial.hand.toUpperCase()} HAND`, tx, y + boxH*0.36);

  ctx.fillStyle = trial.feedback ? "#9fddff" : "#c9d4e4";
  ctx.font = `750 ${Math.round(scale*0.025)}px sans-serif`;
  ctx.fillText(trial.feedback ? "Cursor visible · move quickly" : "Cursor hidden · move quickly", tx, y + boxH*0.67);
  ctx.restore();
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
    Number.isFinite(r.initialDistanceToTarget) &&
    r.initialDistanceToTarget <= TARGET_HIT_RADIUS;

  const freezeDurationMs = Math.max(0, freezeEndMs - state.feedbackFreezeStartMs);

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

    feedbackMode: "continuous_cursor_then_frozen_endpoint",
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
 * TREASURE-HUNT SHELL UI V5.11 — camera check, fullscreen, rest screen
 * ============================================================ */

function setupTreasureShellUi() {
  if (typeof document === "undefined") return;
  if (document.getElementById("treasure-shell-v58")) return;

  const style = document.createElement("style");
  style.id = "treasure-shell-v58";
  style.textContent = `
    /* Camera check */
    body:has(#screen-position.visible) main { max-width: 900px; }
    #screen-position { text-align:center; }
    #screen-position > h2 { font-size:2.15rem; margin-top:12px; margin-bottom:6px; }
    #screen-position > h2 + p { margin:0 auto 10px; font-size:1.34rem; line-height:1.35; color:#eef4ff; font-weight:750; }
    #screen-position > h2 + p .camera-sub { display:block; margin-top:4px; font-size:1rem; font-weight:500; color:#aab8ca; }
    #screen-position #position-stage-slot { margin-top:10px; }
    body:has(#screen-position.visible) #stage { margin:8px auto 10px; border-radius:20px; box-shadow:0 18px 52px rgba(0,0,0,.28); }
    body:has(#screen-position.visible) #live-readout,
    body:has(#screen-position.visible) #trial-timer,
    body:has(#screen-position.visible) #countdown { display:none !important; }
    #treasure-camera-cue { display:flex; justify-content:center; margin:2px auto 6px; }
    #treasure-camera-cue .camera-cue-icon {
      width:70px; height:54px; display:grid; place-items:center;
      border:1px solid rgba(143,190,255,.20); border-radius:17px;
      background:linear-gradient(180deg,rgba(25,46,81,.72),rgba(15,29,53,.78));
      box-shadow:0 10px 24px rgba(0,0,0,.16);
    }
    #position-status { min-height:1.7em; margin:8px 0 2px; font-size:1.08rem; }
    #screen-position .treasure-camera-actions { display:flex; justify-content:center; align-items:stretch; margin-top:12px; }
    #screen-position .treasure-camera-actions button { width:min(420px,100%); margin-top:0; }
    #treasure-camera-tips {
      max-width:760px; margin:14px auto 0; display:grid; grid-template-columns:repeat(3,1fr);
      gap:10px;
    }
    #treasure-camera-tips .tip {
      display:flex; align-items:center; justify-content:center; gap:9px;
      min-height:54px; padding:8px 12px; border-radius:15px;
      background:rgba(19,37,66,.68); border:1px solid rgba(145,190,246,.15);
      color:#dbe7f7; font-size:.95rem; font-weight:650;
    }
    #treasure-camera-tips svg { flex:0 0 auto; color:#9fc8ff; }
    @media (max-width:680px) {
      #treasure-camera-tips { grid-template-columns:1fr; }
      #screen-position .treasure-camera-actions button { width:100%; }
    }

    /* Hide the operating-system mouse pointer during motor trials only.
       It returns automatically on camera check, instructions, rest, and buttons. */
    body.treasure-reaching-active #stage,
    body.treasure-reaching-active #stage *,
    body.treasure-calibration-active #stage,
    body.treasure-calibration-active #stage * {
      cursor: none !important;
    }

    /* Calibration readout */
    body.treasure-reaching-active #live-readout { left:50%; top:14px; transform:translateX(-50%); width:auto; max-width:90%; justify-content:center; }
    .treasure-map-readout { display:flex; align-items:center; gap:11px; padding:9px 15px; border-radius:16px; background:rgba(5,14,32,.80); border:1px solid rgba(186,218,255,.20); box-shadow:0 8px 24px rgba(0,0,0,.22); white-space:nowrap; }
    .treasure-map-readout .map-copy { display:flex; flex-direction:column; align-items:flex-start; line-height:1.15; }
    .treasure-map-readout .map-title { font-size:1.02rem; font-weight:850; color:#f5f8ff; }
    .treasure-map-readout .map-sub { margin-top:3px; font-size:.78rem; color:#c7d5e9; }

    /* Rest screen */
    body:has(#screen-rest.visible) main { max-width:820px; }
    #screen-rest { text-align:center; margin:0 auto; padding:38px 36px 34px; border-radius:26px; background:radial-gradient(circle at 50% 12%,#17315f 0,#0d1d3d 45%,#091429 100%); border:1px solid rgba(151,196,255,.14); box-shadow:0 24px 70px rgba(0,0,0,.28); }
    #screen-rest h2 { font-size:2.2rem; margin:8px 0 4px; }
    #screen-rest > p:not(.subtle) { font-size:1.15rem; margin:4px 0 8px; color:#dce7f7; }
    #screen-rest #rest-progress { font-size:1.05rem; color:#b9c7da; margin:12px 0 8px; }
    #treasure-rest-art { display:flex; justify-content:center; margin:0 auto 4px; }
    #treasure-rest-route { display:flex; justify-content:center; gap:8px; min-height:30px; margin:10px 0 4px; }
    #treasure-rest-route .route-gem { width:18px; height:18px; transform:rotate(45deg); border-radius:4px; border:2px solid rgba(185,211,246,.32); background:rgba(255,255,255,.04); box-shadow:none; }
    #treasure-rest-route .route-gem.done { background:linear-gradient(135deg,#ffe6a0,#6da0ff); border-color:#e9f3ff; box-shadow:0 0 12px rgba(115,177,255,.44); }
    #screen-rest #btn-next-trial { display:none !important; }
    #treasure-rest-countdown {
      width:144px; height:144px; margin:20px auto 4px; border-radius:50%;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      gap:9px; position:relative;
      background:conic-gradient(#7da8ff var(--rest-pct,0%), rgba(255,255,255,.10) 0);
      box-shadow:0 0 28px rgba(95,151,255,.24);
    }
    #treasure-rest-countdown::before {
      content:""; position:absolute; inset:8px; border-radius:50%;
      background:#0b1934; border:1px solid rgba(193,220,255,.15);
    }
    #treasure-rest-countdown .rest-sec {
      position:relative; z-index:1; display:block;
      font:900 2.72rem/.92 system-ui,sans-serif; color:#f5f9ff;
      transform:translateY(3px);
    }
    #treasure-rest-countdown .rest-label {
      position:relative; z-index:1; display:block;
      font:750 .70rem/1 system-ui,sans-serif; color:#aec3df;
      letter-spacing:.07em;
    }
    #treasure-rest-auto-note { margin:9px auto 0; color:#c8d6e8; font-size:.95rem; }

    #stage { position:relative; }
    #treasure-too-slow-overlay {
      position:fixed; inset:0; z-index:99999; display:none; place-items:center;
      pointer-events:none; background:rgba(4,10,24,.52);
      -webkit-backdrop-filter:blur(4px); backdrop-filter:blur(4px);
    }
    #treasure-too-slow-overlay.show { display:grid; }
    #treasure-too-slow-overlay .slow-card {
      min-width:min(430px,72%); padding:24px 30px 22px; border-radius:24px;
      text-align:center; background:rgba(8,20,43,.93);
      border:2px solid rgba(255,220,124,.68);
      box-shadow:0 22px 56px rgba(0,0,0,.35),0 0 32px rgba(255,202,90,.12);
    }
    #treasure-too-slow-overlay .slow-title {
      color:#ffe29a; font:900 clamp(28px,4.2vw,46px)/1.05 system-ui,sans-serif;
    }
    #treasure-too-slow-overlay .slow-sub {
      margin-top:8px; color:#f4f7ff; font:650 clamp(15px,2vw,19px)/1.3 system-ui,sans-serif;
    }
  `;
  document.head.appendChild(style);

  /* Camera check: shorter wording + visual cue + fullscreen control. */
  const position = document.getElementById("screen-position");
  if (position) {
    const title = position.querySelector("h2");
    const intro = title?.nextElementSibling;
    if (title) title.textContent = "Camera check";
    if (intro?.tagName === "P") {
      intro.textContent = "";
      intro.style.display = "none";
    }

    /* No extra hand-icon card here: the live camera and status line are enough. */
    const continueBtn = document.getElementById("btn-position-done");
    if (continueBtn) {
      continueBtn.textContent = "Continue";
      let actions = position.querySelector(".treasure-camera-actions");
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "treasure-camera-actions";
        continueBtn.before(actions);
        actions.appendChild(continueBtn);
      }
      /* Browsers require a real user gesture for Fullscreen API.
         Use the Continue click the participant already has to make after
         hand detection, so there is no separate fullscreen button/click. */
      if (!continueBtn.dataset.treasureFullscreenBound) {
        continueBtn.dataset.treasureFullscreenBound = "1";
        continueBtn.addEventListener("click", () => {
          if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
          }
        }, { capture:true });
      }
    }

    const oldHelp = position.querySelector("details.help");
    if (oldHelp && !document.getElementById("treasure-camera-tips")) {
      const tips = document.createElement("div");
      tips.id = "treasure-camera-tips";
      tips.innerHTML = `
        <div class="tip">
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
          </svg>
          <span>Bright room</span>
        </div>
        <div class="tip">
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3"/>
          </svg>
          <span>About an arm's length from the screen</span>
        </div>
        <div class="tip">
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>
          </svg>
          <span>Plain background</span>
        </div>`;
      oldHelp.replaceWith(tips);
    }
  }

  /* Keep the runner's camera-status logic, but shorten its participant wording. */
  const posStatus = document.getElementById("position-status");
  if (posStatus) {
    const shortenStatus = () => {
      const t = (posStatus.textContent || "").trim();
      let next = t;
      if (/Looking good/i.test(t)) next = "Looks good!";
      else if (/not visible/i.test(t)) next = "Raise either hand";
      else if (/Hold still/i.test(t)) next = "Hold still…";
      else if (/Looking for/i.test(t)) next = "Raise either hand";
      if (next !== t) posStatus.textContent = next;
    };
    new MutationObserver(shortenStatus).observe(posStatus, { childList:true, subtree:true, characterData:true });
    shortenStatus();
  }

  /* Rest screen: centered, visual, and counts the 8 reaching rounds rather than calibration. */
  const rest = document.getElementById("screen-rest");
  if (rest) {
    const h2 = rest.querySelector("h2");
    const bodyP = rest.querySelector("p:not(.subtle)");
    const progress = document.getElementById("rest-progress");
    const btn = document.getElementById("btn-next-trial");

    if (!document.getElementById("treasure-rest-art")) {
      const art = document.createElement("div");
      art.id = "treasure-rest-art";
      art.innerHTML = `<svg width="112" height="86" viewBox="0 0 112 86" fill="none" aria-hidden="true">
        <ellipse cx="56" cy="72" rx="37" ry="8" fill="rgba(0,0,0,.22)"/>
        <path d="M25 40h62v30H25z" fill="#7e421d" stroke="#f0c56c" stroke-width="3"/>
        <path d="M25 40c3-17 14-25 31-25s28 8 31 25H25Z" fill="#bd7130" stroke="#f0c56c" stroke-width="3"/>
        <path d="M40 18v52M72 18v52" stroke="#e8bd62" stroke-width="4"/>
        <rect x="50" y="44" width="12" height="13" rx="3" fill="#ffe69b"/>
        <path d="M13 21l3 5 5 3-5 3-3 5-3-5-5-3 5-3 3-5ZM96 10l2.5 4 4 2.5-4 2.5-2.5 4-2.5-4-4-2.5 4-2.5 2.5-4Z" fill="#d9eeff"/>
      </svg>`;
      rest.insertBefore(art, h2);
    }
    if (!document.getElementById("treasure-rest-route")) {
      const route = document.createElement("div");
      route.id = "treasure-rest-route";
      progress?.after(route);
    }

    const updateRest = () => {
      if (!progress) return;
      const raw = progress.textContent || "";
      const m = raw.match(/(\d+)\s+of\s+(\d+)/i);
      if (!m) return;
      const done = Number(m[1]);
      const total = Number(m[2]);
      const route = document.getElementById("treasure-rest-route");

      if (done <= 2) {
        if (done === 1) {
          rest.dataset.treasureRestSec = String(CALIBRATION_INTER_HAND_REST_SEC);
          if (h2) h2.textContent = "Nice!";
          if (bodyP) bodyP.textContent = "Now map your other hand.";
          progress.textContent = "Treasure map - 1 / 2 hands ready";
          if (btn) btn.textContent = "Map the other hand";
        } else {
          rest.dataset.treasureRestSec = String(FIXED_INTER_BLOCK_REST_SEC);
          if (h2) h2.textContent = "Treasure map ready!";
          if (bodyP) bodyP.textContent = "Your treasure hunt is ready to begin.";
          progress.textContent = "Both hands are mapped";
          if (btn) btn.textContent = "Start treasure hunt";
        }
        if (route) {
          route.innerHTML = Array.from({length:2},(_,i)=>`<span class="route-gem ${i<done?'done':''}"></span>`).join("");
        }
        return;
      }

      rest.dataset.treasureRestSec = String(FIXED_INTER_BLOCK_REST_SEC);
      const reachingTotal = Math.max(1, total - 2);
      const reachingDone = Math.max(0, done - 2);
      if (h2) h2.textContent = "Great job!";
      if (bodyP) bodyP.textContent = "Take a short break.";
      progress.textContent = `${reachingDone} / ${reachingTotal} rounds complete`;
      if (btn) btn.textContent = "Next round";
      if (route) {
        route.innerHTML = Array.from({length:reachingTotal},(_,i)=>`<span class="route-gem ${i<reachingDone?'done':''}"></span>`).join("");
      }
    };
    if (progress) {
      new MutationObserver(updateRest).observe(progress, { childList:true, subtree:true, characterData:true });
      updateRest();
    }
  }

  /* Fixed inter-block interval: every transition is exactly 15 s and
     advances automatically, removing participant-controlled rest duration. */
  if (rest && !document.getElementById("treasure-rest-countdown")) {
    const countdown = document.createElement("div");
    countdown.id = "treasure-rest-countdown";
    countdown.innerHTML = `<span class="rest-sec">${FIXED_INTER_BLOCK_REST_SEC}</span><span class="rest-label">SECONDS</span>`;
    const note = document.createElement("div");
    note.id = "treasure-rest-auto-note";
    note.textContent = "The next round starts automatically.";
    const route = document.getElementById("treasure-rest-route");
    (route || document.getElementById("rest-progress"))?.after(countdown, note);
  }

  if (rest && !rest.dataset.fixedCountdownBound) {
    rest.dataset.fixedCountdownBound = "1";
    let timerId = null;
    let activeToken = 0;

    const stopTimer = () => {
      activeToken += 1;
      if (timerId != null) {
        clearInterval(timerId);
        timerId = null;
      }
    };

    const startTimer = () => {
      stopTimer();
      if (!rest.classList.contains("visible")) return;

      const token = activeToken;
      const btn = document.getElementById("btn-next-trial");
      const dial = document.getElementById("treasure-rest-countdown");
      const secEl = dial?.querySelector(".rest-sec");
      const started = performance.now();
      const durationSec = Number(rest.dataset.treasureRestSec) || FIXED_INTER_BLOCK_REST_SEC;
      const totalMs = durationSec * 1000;
      if (secEl) secEl.textContent = String(durationSec);

      if (btn) btn.disabled = true;

      const update = () => {
        if (token !== activeToken || !rest.classList.contains("visible")) {
          stopTimer();
          return;
        }
        const elapsed = performance.now() - started;
        const remainMs = Math.max(0, totalMs - elapsed);
        const remainSec = Math.ceil(remainMs / 1000);
        if (secEl) secEl.textContent = String(remainSec);
        if (dial) {
          const pct = Math.min(100, Math.max(0, (elapsed / totalMs) * 100));
          dial.style.setProperty("--rest-pct", `${pct}%`);
        }
        if (remainMs <= 0) {
          stopTimer();
          if (btn) {
            btn.disabled = false;
            btn.click();
          }
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

  /* Full-page warning: BODY placement avoids mirrored/stage stacking issues. */
  if (document.body && !document.getElementById("treasure-too-slow-overlay")) {
    const overlay = document.createElement("div");
    overlay.id = "treasure-too-slow-overlay";
    overlay.innerHTML = `
      <div class="slow-card">
        <div class="slow-title">Move faster!</div>
        <div class="slow-sub">Try a quick, smooth reach.</div>
      </div>`;
    document.body.appendChild(overlay);
  }
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
  const STYLE_ID = "single-hand-baseline-stage-v5-8-treasure";
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
    prompt:
      `${hand.toUpperCase()} HAND · ${feedback ? "CURSOR VISIBLE" : "CURSOR HIDDEN"}`,
  };
}


export default {
  id: "single-hand-baseline-2d-v5-11-treasure",

  title: "Single-Hand Baseline V5.11 Treasure — 320 Reaches",

  tracker: "hand",

  trackerOptions: {
    numHands: 2,
  },

  instructions: `
    <style>
      body:has(.treasure-v57-instructions) #screen-instructions > h2 { display:none; }
      body:has(.treasure-v57-instructions) #instructions-text.prose { background:transparent; padding:0; }
      .treasure-v57-instructions .quest-gem { animation: treasureGemGlow57 1.8s ease-in-out infinite; }
      .treasure-v57-instructions .quest-chest { animation: treasureChestGlow57 2.0s ease-in-out infinite; }
      .treasure-v57-instructions .quest-arrow { animation: treasureArrow57 1.5s ease-in-out infinite; }
      @keyframes treasureGemGlow57 {
        0%,100%{filter:drop-shadow(0 0 5px rgba(125,184,255,.48))}
        50%{filter:drop-shadow(0 0 13px rgba(125,184,255,.92))}
      }
      @keyframes treasureChestGlow57 {
        0%,100%{filter:drop-shadow(0 0 4px rgba(255,208,99,.28))}
        50%{filter:drop-shadow(0 0 12px rgba(255,208,99,.72))}
      }
      @keyframes treasureArrow57 { 0%,100%{opacity:.52} 50%{opacity:1} }
    </style>

    <div class="treasure-v57-instructions" style="max-width:860px;margin:0 auto;padding:26px 28px 22px;border-radius:26px;background:radial-gradient(circle at 50% 28%,#173366 0,#0d1e42 48%,#08152e 100%);color:#eef6ff;box-shadow:0 22px 60px rgba(0,0,0,.28);border:1px solid rgba(150,198,255,.12);overflow:hidden;position:relative;">
      <div style="position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 12% 18%,rgba(104,145,225,.10),transparent 24%),radial-gradient(circle at 88% 74%,rgba(160,99,219,.08),transparent 26%);"></div>

      <div style="position:relative;text-align:center;">
        <div style="font-size:2.25rem;font-weight:900;letter-spacing:.01em;">Treasure Hunt</div>
        <div style="font-size:1.08rem;opacity:.82;margin-top:3px;">Collect the gems.</div>
      </div>

      <div style="position:relative;margin:20px auto 15px;max-width:740px;padding:15px 18px 12px;border-radius:22px;background:rgba(255,255,255,.055);border:1px solid rgba(192,219,255,.10);">
        <svg viewBox="0 0 760 180" width="100%" height="180" aria-hidden="true">
          <defs>
            <linearGradient id="v57gem" x1="0" y1="0" x2="1" y2="1">
              <stop stop-color="#d8ecff"/><stop offset=".46" stop-color="#6e9fff"/><stop offset="1" stop-color="#4943ad"/>
            </linearGradient>
            <linearGradient id="v57chestBody" x1="0" y1="0" x2="1" y2="1">
              <stop stop-color="#c97830"/><stop offset=".58" stop-color="#8b4922"/><stop offset="1" stop-color="#4d2918"/>
            </linearGradient>
            <linearGradient id="v57chestLid" x1="0" y1="0" x2="0" y2="1">
              <stop stop-color="#e49b47"/><stop offset="1" stop-color="#7b3d1e"/>
            </linearGradient>
            <marker id="v57arr" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
              <path d="M0,0 L9,4.5 L0,9 z" fill="#dbe9ff"/>
            </marker>
          </defs>

          <g class="quest-chest">
            <circle cx="120" cy="72" r="40" fill="none" stroke="rgba(119,240,199,.22)" stroke-width="3"/>
            <circle cx="120" cy="72" r="32" fill="none" stroke="#77f0c7" stroke-width="5"/>
            <rect x="86" y="68" width="68" height="39" rx="7" fill="url(#v57chestBody)" stroke="#efc56b" stroke-width="3"/>
            <path d="M86 70 Q92 39 120 39 Q148 39 154 70 Z" fill="url(#v57chestLid)" stroke="#efc56b" stroke-width="3"/>
            <path d="M103 44V106M137 44V106" stroke="#e9bf65" stroke-width="4"/>
            <rect x="112" y="77" width="16" height="13" rx="3" fill="#ffe49a" stroke="#9c6824" stroke-width="2"/>
          </g>

          <line class="quest-arrow" x1="173" y1="72" x2="304" y2="72" stroke="#dbe9ff" stroke-width="5" stroke-linecap="round" marker-end="url(#v57arr)"/>

          <g class="quest-gem">
            <path d="M380 25 L420 53 L407 108 L353 108 L340 53 Z" fill="url(#v57gem)" stroke="#f2f8ff" stroke-width="4"/>
            <path d="M356 51 L381 34 L405 52" fill="none" stroke="rgba(255,255,255,.74)" stroke-width="4" stroke-linecap="round"/>
          </g>

          <line class="quest-arrow" x1="451" y1="72" x2="582" y2="72" stroke="#dbe9ff" stroke-width="5" stroke-linecap="round" marker-end="url(#v57arr)"/>

          <g class="quest-chest">
            <circle cx="640" cy="72" r="40" fill="none" stroke="rgba(119,240,199,.22)" stroke-width="3"/>
            <circle cx="640" cy="72" r="32" fill="none" stroke="#77f0c7" stroke-width="5"/>
            <rect x="606" y="68" width="68" height="39" rx="7" fill="url(#v57chestBody)" stroke="#efc56b" stroke-width="3"/>
            <path d="M606 70 Q612 39 640 39 Q668 39 674 70 Z" fill="url(#v57chestLid)" stroke="#efc56b" stroke-width="3"/>
            <path d="M623 44V106M657 44V106" stroke="#e9bf65" stroke-width="4"/>
            <rect x="632" y="77" width="16" height="13" rx="3" fill="#ffe49a" stroke="#9c6824" stroke-width="2"/>
          </g>

          <text x="120" y="154" text-anchor="middle" fill="#f2f7ff" font-size="21" font-weight="800">START AT CHEST</text>
          <text x="380" y="154" text-anchor="middle" fill="#f2f7ff" font-size="21" font-weight="800">COLLECT</text>
          <text x="640" y="154" text-anchor="middle" fill="#f2f7ff" font-size="21" font-weight="800">RETURN</text>
        </svg>
      </div>

      <div style="position:relative;text-align:center;font-size:1.24rem;font-weight:850;color:#ffe6a0;margin-top:10px;">
        Move quickly in one smooth motion.
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
      prompt:
        "Set up your treasure map · LEFT HAND",
    },

    {
      id: "cal_right_continuous",
      kind: "continuous_calibration",
      hand: "Right",
      showCamera: true,
      durationSec: CALIBRATION_MAX_SEC,
      prompt:
        "Set up your treasure map · RIGHT HAND",
    },

    /* No feedback: R -> L -> R -> L = 160 reaches */
    reachingTrial("nf_right_1", "Right", false, 1),
    reachingTrial("nf_left_1", "Left", false, 1),
    reachingTrial("nf_right_2", "Right", false, 2),
    reachingTrial("nf_left_2", "Left", false, 2),

    /* Feedback: R -> L -> R -> L = 160 reaches */
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
        calibrationComplete: false,
        finished: false,

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
        reaches: [],

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
        praiseStartMs: null,
        praiseIndex: null,
        returnGuideStartMs: null,

        peakRadialDistance: 0,
        peakTaskX: null,
        peakTaskY: null,
        peakMs: null,
        peakPathLength: 0,
        previousRadialDistance: null,

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

      if (activePalm == null) {
        if (state.phase === "home" || state.phase === "return_home") {
          state.homeEnterMs = null;
        }

        return {
          activeHand: trial.hand,
          handDetected: 0,
          handX: null,
          handY: null,
          taskX: null,
          taskY: null,
          radialDistance: null,
          cursorViewX: null,
          cursorViewY: null,
          cursorVisible: 0,
          phaseCode: phaseCode(state.phase),
          targetCode: targetCode(state.currentTargetDirection),
          completedReaches: state.completedReaches,
          fps: state.fps,
        };
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
          state.lastTaskX = taskX;
          state.lastTaskY = taskY;

          addEvent("movement_onset", {
            hand: trial.hand,
            feedback: trial.feedback,
            targetDirection: state.currentTargetDirection,
            reactionTimeMs: state.movementOnsetMs - state.targetOnsetMs,
          });
        }

        if (tMs - state.targetOnsetMs > MAX_WAIT_FOR_MOVEMENT_MS) {
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
          tMs - state.movementOnsetMs >= EARLY_HEADING_MS
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

        const outboundElapsedMs = tMs - state.movementOnsetMs;

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
            onlineReactionTimeMs: state.movementOnsetMs - state.targetOnsetMs,
            outboundElapsedMs,
            peakRadialDistance: state.peakRadialDistance,
          });

          addEvent("reach_failed", {
            hand: trial.hand,
            feedback: trial.feedback,
            targetDirection: state.currentTargetDirection,
            failureReason: "returned_home_before_target_distance",
            outboundElapsedMs,
            peakRadialDistance: state.peakRadialDistance,
          });

          state.completedReaches += 1;
          state.phase = "return_home";
          state.returnGuideStartMs = tMs;
          state.homeEnterMs = tMs;
        }

        /* Register the initial endpoint.
           Priority 1: exact crossing of the target-center radius (0.70), matching
           the conventional center-out definition.
           Priority 2: if the hand undershoots, use the farthest outbound point
           after the movement settles or clearly reverses. */
        else {
          const crossedTargetDistance =
            state.previousRadialDistance != null &&
            state.previousRadialDistance < TARGET_ECCENTRICITY &&
            radialDistance >= TARGET_ECCENTRICITY;

          const peakIsUsable =
            state.peakRadialDistance >= MIN_VALID_ENDPOINT_RADIUS &&
            state.peakTaskX != null &&
            state.peakTaskY != null;

          const settledNearPeak =
            peakIsUsable &&
            state.peakMs != null &&
            tMs - state.peakMs >= PEAK_SETTLE_MS;

          const reversedFromPeak =
            peakIsUsable &&
            radialDistance <= state.peakRadialDistance - PEAK_REVERSAL_DROP;

          const nearTargetAtTimeout =
            peakIsUsable &&
            outboundElapsedMs > MAX_OUTBOUND_MS;

          let endpointX = null;
          let endpointY = null;
          let endpointRadialDistance = null;
          let endpointMs = null;
          let endpointPathLength = null;
          let endpointSource = null;
          let slowOutbound = false;

          if (crossedTargetDistance) {
            endpointX = taskX;
            endpointY = taskY;
            endpointRadialDistance = radialDistance;
            endpointMs = tMs;
            endpointPathLength = state.currentPathLength;
            endpointSource = "target_radius_crossing";
          } else if (settledNearPeak || reversedFromPeak) {
            endpointX = state.peakTaskX;
            endpointY = state.peakTaskY;
            endpointRadialDistance = state.peakRadialDistance;
            endpointMs = state.peakMs;
            endpointPathLength = state.peakPathLength;
            endpointSource = reversedFromPeak
              ? "undershoot_peak_reversal"
              : "undershoot_peak_settle";
          } else if (nearTargetAtTimeout) {
            endpointX = state.peakTaskX;
            endpointY = state.peakTaskY;
            endpointRadialDistance = state.peakRadialDistance;
            endpointMs = state.peakMs;
            endpointPathLength = state.peakPathLength;
            endpointSource = "undershoot_peak_at_time_limit";
            slowOutbound = true;
          }

          if (endpointSource != null && state.firstCrossingMs == null) {
            state.firstCrossingMs = endpointMs;
            state.outboundPathLength = endpointPathLength;

            const observedAngle = angleDeg(endpointX, endpointY);
            const intendedAngle = targetAngleDeg(state.currentTargetDirection);
            const angularError = wrapAngleDeg(observedAngle - intendedAngle);
            const target = TARGETS[state.currentTargetDirection];
            const distanceToTarget = distance2d(endpointX, endpointY, target.x, target.y);

            const onlineMovementTimeMs = endpointMs - state.movementOnsetMs;
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
                earlySampleElapsedMsOnline = state.earlySampleMs - state.movementOnsetMs;
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

            /* Non-contingent game feel: runs concurrently with the existing
               return/freeze phase and never adds trial time. */
            state.collectSparkleStartMs = tMs;
            state.praiseStartMs = tMs;
            state.praiseIndex = praiseIndexForReach(trial, state);

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
              initialEndpointSource: endpointSource,
              initialEndpointWasUndershoot: endpointSource.startsWith("undershoot_") ? 1 : 0,
              slowOutbound,

              /* These online timing values are useful for task control/QC only.
                 Formal RT/MT should still be recomputed from raw trajectories. */
              reactionTimeMs: state.movementOnsetMs - state.targetOnsetMs,
              onlineReactionTimeMs: state.movementOnsetMs - state.targetOnsetMs,
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
              endpointInsideTarget: distanceToTarget <= TARGET_HIT_RADIUS ? 1 : 0,

              peakRadialDistance: state.peakRadialDistance,
            };

            addEvent("initial_endpoint_registered", {
              ...state.currentInitialRecord,
            });

            if (trial.feedback) {
              /* V5: the cursor was already visible throughout the outbound reach.
                 Freeze the registered endpoint for 500 ms; do NOT provide a
                 second live-correction period after the endpoint. */
              state.feedbackFreezeStartMs = tMs;
              state.feedbackFreezeX = endpointX;
              state.feedbackFreezeY = endpointY;

              addEvent("feedback_endpoint_freeze_onset", {
                hand: trial.hand,
                targetDirection: state.currentTargetDirection,
                x: endpointX,
                y: endpointY,
                endpointAngularErrorDeg: angularError,
                endpointDistanceToTarget: distanceToTarget,
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
            outboundElapsedMs > MAX_OUTBOUND_MS &&
            !peakIsUsable
          ) {
            state.timedOutReaches += 1;
            state.reaches.push({
              hand: trial.hand,
              feedback: trial.feedback,
              targetDirection: state.currentTargetDirection,
              timedOut: true,
              failureReason: "outbound_too_short_or_slow",
              onlineReactionTimeMs: state.movementOnsetMs - state.targetOnsetMs,
              outboundElapsedMs,
              peakRadialDistance: state.peakRadialDistance,
            });

            addEvent("reach_timeout", {
              hand: trial.hand,
              feedback: trial.feedback,
              targetDirection: state.currentTargetDirection,
              failureReason: "outbound_too_short_or_slow",
              outboundElapsedMs,
              peakRadialDistance: state.peakRadialDistance,
            });

            state.completedReaches += 1;
            state.phase = "return_home";
            state.returnGuideStartMs = tMs;
            state.homeEnterMs = null;
          }
        }

        state.previousRadialDistance = radialDistance;
      }


      /* ---------------- FROZEN ENDPOINT FEEDBACK ---------------- */
      else if (state.phase === "feedback_freeze") {
        const freezeElapsedMs = tMs - state.feedbackFreezeStartMs;

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
      else if (state.phase === "return_home") {
        if (handInHome) {
          if (state.homeEnterMs == null) state.homeEnterMs = tMs;

          const warningFinished =
            state.tooSlowWarningUntilMs == null || tMs >= state.tooSlowWarningUntilMs;

          if (tMs - state.homeEnterMs >= HOME_HOLD_MS && warningFinished) {
            if (state.completedReaches >= REACHES_PER_BLOCK) {
              state.phase = "done";
              state.finished = true;

              addEvent("block_complete", {
                hand: trial.hand,
                feedback: trial.feedback,
                completedReaches: state.completedReaches,
              });
            } else {
              state.targetIndex += 1;
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
              state.praiseStartMs = null;
              state.praiseIndex = null;
              state.returnGuideStartMs = null;
              state.currentPathLength = 0;
              state.outboundPathLength = 0;
              state.peakRadialDistance = 0;
              state.peakTaskX = null;
              state.peakTaskY = null;
              state.peakMs = null;
              state.peakPathLength = 0;
              state.previousRadialDistance = null;
              state.lastTaskX = null;
              state.lastTaskY = null;
              state.currentInitialRecord = null;
              state.phase = "home";
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
        /* V5: continuous veridical cursor during the outbound feedback reach. */
        cursorVisible = true;
      } else if (trial.feedback && state.phase === "feedback_freeze") {
        /* Freeze the registered endpoint; do not follow the returning hand. */
        cursorVisible = true;
        if (state.feedbackFreezeX != null && state.feedbackFreezeY != null) {
          const fx = clamp(state.feedbackFreezeX, -1.25, 1.25);
          const fy = clamp(state.feedbackFreezeY, -1.25, 1.25);
          renderedCursorView = taskToView(fx, fy);
        }
      } else if (state.phase === "return_home") {
        const guideReady =
          state.returnGuideStartMs != null &&
          tMs - state.returnGuideStartMs >= RETURN_GUIDE_DELAY_MS;

        /* JT feedback check: after a NO-FEEDBACK outward reach, the true cursor
           does NOT reappear at the endpoint. It only becomes visible once the
           returning hand is close to home (<= RETURN_SHOW_CURSOR_RADIUS), after
           the short return-guide delay. This preserves endpoint blindness. */
        cursorVisible = guideReady && radialDistance <= RETURN_SHOW_CURSOR_RADIUS;
      }

      return {
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
          ? Math.max(0, tMs - state.feedbackFreezeStartMs)
          : null,
        feedbackCursorVisibleDuringOutbound: trial.feedback ? 1 : 0,
        tooSlowWarningActive:
          state.tooSlowWarningUntilMs != null && tMs < state.tooSlowWarningUntilMs ? 1 : 0,
        collectSparkleElapsedMs: state.collectSparkleStartMs != null ? Math.max(0, tMs - state.collectSparkleStartMs) : null,
        tooSlowThresholdMs: TOO_SLOW_MT_MS,
        fps: state.fps,
      };
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

    const W = canvas.width;
    const H = canvas.height;


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
      if (!activePalm) status = `Show your ${trial.hand.toLowerCase()} hand`;
      else if (derived.calibrationOnTarget) status = "Hold still";
      if (state.calibrationComplete) status = "Treasure map ready!";

      setReadout(`
        <span style="display:inline-flex;align-items:center;gap:10px;padding:8px 12px;border-radius:14px;background:rgba(5,14,32,.76);border:1px solid rgba(186,218,255,.20);font-size:1rem;">
          <b>${trial.hand.toUpperCase()} HAND</b>
          <span style="opacity:.72;">${stepNumber}/${CALIBRATION_SEQUENCE.length}</span>
          <span style="color:${derived.calibrationOnTarget ? "#9ff6d8" : "#ffe19a"};font-weight:750;">${status}</span>
        </span>
      `);

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

      const homeView = taskToView(0, 0);
      const homeCanvasX = homeView.x * W;
      const homeCanvasY = homeView.y * H;

      const target = state.currentTargetDirection != null ? TARGETS[state.currentTargetDirection] : null;
      const targetView = target != null ? taskToView(target.x, target.y) : null;
      const targetCanvasX = targetView != null ? targetView.x * W : null;
      const targetCanvasY = targetView != null ? targetView.y * H : null;

      drawHomeChest(ctx, homeCanvasX, homeCanvasY, !!derived.handInHome, tMs, state.phase === "return_home");

      const showTarget = state.currentTargetDirection != null &&
        (state.phase === "target" || state.phase === "moving" || state.phase === "feedback_freeze");

      if (showTarget && targetCanvasX != null) {
        drawGem(ctx, targetCanvasX, targetCanvasY, GEM_VISUAL_RADIUS_PX, gemStyleIndexForReach(trial, state), tMs);
      }

      if (state.collectSparkleStartMs != null && targetCanvasX != null && targetCanvasY != null) {
        drawCollectSparkle(ctx, targetCanvasX, targetCanvasY, tMs - state.collectSparkleStartMs);
      }

      /* Return-home cue is now the opening/glowing treasure chest itself.
         It is anchored at fixed HOME and does not encode endpoint direction. */

      /* Cursor obeys visibility rules from onFrame(). */
      if (
        derived.cursorVisible &&
        derived.cursorViewX != null &&
        derived.cursorViewY != null
      ) {
        const cursorCanvasX = derived.cursorViewX * W;
        const cursorCanvasY = derived.cursorViewY * H;

        drawTreasureCompassCursor(ctx, cursorCanvasX, cursorCanvasY);
      }

      /* Keep the active task screen visually quiet: no long instruction bar. */
      setReadout("");

      const displayedCompleted =
        state.completedReaches +
        (trial.feedback && state.phase === "feedback_freeze" && state.currentInitialRecord != null ? 1 : 0);

      drawProgressBadge(
        ctx,
        W,
        H,
        Math.min(displayedCompleted, REACHES_PER_BLOCK),
        REACHES_PER_BLOCK,
        tMs,
        state.praiseStartMs != null && tMs - state.praiseStartMs <= PRAISE_MS
      );

      drawPraise(ctx, W, H, state, tMs);
      drawBlockStartOverlay(ctx, W, H, trial, state, tMs);

      endParticipantFacingOverlay(ctx);
      return;
    }
  },


  /* ==========================================================
   * TRIAL END / SUMMARY
   * ========================================================== */

  onTrialEnd({ trial, state }) {
    setTreasureReachingUiMode(null);

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
      const validReaches = state.reaches.filter((r) => !r.timedOut);

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
          ? "continuous_cursor_then_frozen_endpoint"
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
