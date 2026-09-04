/* recorder.js: collects one row of numbers per video frame, and splits the
 * result into Firestore-sized pieces.
 *
 * WHY CHUNKING EXISTS
 * A Firestore document can hold at most 1 MiB. One frame of hand tracking is
 * about 1.2 KB (21 landmarks x 3 coordinates, twice: screen + world). A 30-
 * second trial at 30 fps is therefore about 1.1 MB, which is over the limit. So we cut
 * the frame list into chunks of RECORDING.chunkFrames and store each chunk as
 * its own document. analysis/fetch_data.py glues them back together, so you
 * never have to think about this again. */

import { RECORDING } from "../../config.js";

export class Recorder {
  constructor(opts = {}) {
    this.chunkFrames = opts.chunkFrames ?? RECORDING.chunkFrames;
    this.decimals    = opts.decimals    ?? RECORDING.decimals;
    this.frames = [];
    this.events = [];
  }

  /** Throw away anything recorded so far. Call at the start of each trial. */
  reset() {
    this.frames = [];
    this.events = [];
  }

  /**
   * Store one frame.
   *
   * @param {number} tMs      milliseconds since this trial started
   * @param {object|null} lm  landmark array for ONE hand/person (image coords),
   *                          or null if nothing was detected this frame
   * @param {object|null} wl  the matching world landmarks (metres), or null
   * @param {object} derived  any extra numbers your experiment computed, e.g.
   *                          { aperture: 0.41 }. Kept alongside the raw data.
   */
  addFrame(
  tMs,
  lm,
  wl,
  derived = {},
  multi = {}
) {

  /*
   * Backward compatibility:
   *
   * lm / wl  = first detected hand, exactly as before.
   *
   * For bimanual experiments we additionally save:
   *
   * lm2 / wl2 = second detected hand
   * h          = MediaPipe handedness labels in detection order
   *
   * Example:
   * h = ["Left", "Right"]
   *
   * We intentionally preserve detection order rather than
   * immediately rewriting the data into anatomical Left/Right.
   * That lets us detect possible handedness swaps offline.
   */

  const allLandmarks =
    multi.allLandmarks ?? [];

  const allWorldLandmarks =
    multi.allWorldLandmarks ?? [];

  const allHandedness =
    multi.allHandedness ?? [];


  const lm2 =
    allLandmarks[1] ?? null;

  const wl2 =
    allWorldLandmarks[1] ?? null;


  this.frames.push({

    t:
      round(tMs, 1),

    /*
     * First detected hand.
     */
    lm:
      lm
        ? flatten(lm, this.decimals)
        : null,

    wl:
      wl
        ? flatten(wl, this.decimals)
        : null,

    /*
     * Second detected hand.
     */
    lm2:
      lm2
        ? flatten(lm2, this.decimals)
        : null,

    wl2:
      wl2
        ? flatten(wl2, this.decimals)
        : null,

    /*
     * Handedness labels corresponding to lm / lm2.
     */
    h:
      allHandedness.slice(0, 2),

    /*
     * Experiment-specific derived measurements.
     */
    d:
      roundValues(
        derived,
        5
      ),

  });

}

  /**
   * Note that something happened at a point in time, a tap, a button press,
   * a target appearing. Events are stored in the small session document, so
   * they are cheap to query later.
   */
  addEvent(tMs, type, data = {}) {
    this.events.push({ t: round(tMs, 1), type, ...roundValues(data, 5) });
  }

  /** How many frames actually contained a detected hand/person. */
  detectionRate() {
    if (!this.frames.length) return 0;
    const hits = this.frames.filter((f) => f.lm !== null).length;
    return hits / this.frames.length;
  }

  /** Split the recorded frames into Firestore-sized arrays. */
  toChunks() {
    const out = [];
    for (let i = 0; i < this.frames.length; i += this.chunkFrames) {
      out.push(this.frames.slice(i, i + this.chunkFrames));
    }
    return out;
  }
}

/* ---- helpers ---------------------------------------------------------- */

// [{x,y,z}, {x,y,z}, ...] -> [x0,y0,z0, x1,y1,z1, ...]
// A flat array of numbers is roughly 3x smaller in Firestore than an array of
// {x,y,z} maps, because every map repeats the key names.
function flatten(landmarks, decimals) {
  const out = new Array(landmarks.length * 3);
  for (let i = 0; i < landmarks.length; i++) {
    out[i * 3]     = round(landmarks[i].x, decimals);
    out[i * 3 + 1] = round(landmarks[i].y, decimals);
    out[i * 3 + 2] = round(landmarks[i].z, decimals);
  }
  return out;
}

function round(v, decimals) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const p = 10 ** decimals;
  return Math.round(v * p) / p;
}

function roundValues(obj, decimals) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === "number" ? round(v, decimals) : v;
  }
  return out;
}
