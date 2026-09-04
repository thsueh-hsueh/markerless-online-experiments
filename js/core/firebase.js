/* firebase.js: signs the participant in anonymously and saves their data.
 *
 * HOW THE DATA IS LAID OUT IN FIRESTORE
 *
 *   sessions/{sessionId}                     <- one small document per session:
 *                                               who, when, settings, per-trial
 *                                               summary numbers, event times.
 *                                               This is what you usually read.
 *
 *   sessions/{sessionId}/chunks/{trial}_{n}  <- the raw frame-by-frame
 *                                               landmarks, split into pieces
 *                                               (see recorder.js).
 *
 * The session document is written LAST, once the participant has finished.
 * That means a session folder with chunks but no session document is someone
 * who dropped out partway, fetch_data.py reports those separately instead of
 * silently mixing them into your dataset.
 *
 * See firestore.rules for the matching security rules. */

import { FIREBASE } from "../../config.js";

const SDK = "https://www.gstatic.com/firebasejs/12.17.1";

let app = null, db = null, auth = null, uid = null;

// False when config.js has not been filled in. The experiment still runs, it
// just does not save anything. See initFirebase().
let enabled = false;

/** True if config.js still has the placeholder values in it. */
export function configLooksUnfilled() {
  return Object.values(FIREBASE).some(
    (v) => typeof v === "string" && v.includes("PASTE_YOUR")
  );
}

/**
 * Start Firebase and sign in anonymously.
 *
 * If config.js has not been filled in, this does NOT fail. It returns
 * `{ enabled: false }` and the experiment runs in demo mode: the task works
 * normally and the participant sees their live tap count, but nothing is
 * uploaded. That way the study is something you can click and try before you
 * have set up any accounts.
 *
 * Anonymous sign-in gives every participant a unique id without asking them for
 * an account, and lets the security rules reject writes from bots.
 *
 * @returns {Promise<{uid: string|null, enabled: boolean}>}
 */
export async function initFirebase() {
  if (uid) return { uid, enabled: true };

  if (configLooksUnfilled()) {
    enabled = false;
    return { uid: null, enabled: false };
  }

  const { initializeApp } = await import(`${SDK}/firebase-app.js`);
  const { getAuth, signInAnonymously } = await import(`${SDK}/firebase-auth.js`);
  const { getFirestore } = await import(`${SDK}/firebase-firestore.js`);

  app  = initializeApp(FIREBASE);
  auth = getAuth(app);
  db   = getFirestore(app);

  try {
    const cred = await signInAnonymously(auth);
    uid = cred.user.uid;
    enabled = true;
  } catch (err) {
    if (String(err?.code).includes("operation-not-allowed")) {
      throw new Error(
        "Anonymous sign-in is turned off for this Firebase project. Go to " +
        "Firebase Console -> Build -> Authentication -> Sign-in method, and " +
        "enable 'Anonymous'. (docs/SETUP.md step 3)"
      );
    }
    throw new Error(`Could not sign in to Firebase: ${err?.message || err}`);
  }

  return { uid, enabled: true };
}

/** Is data actually being saved? False in demo mode. */
export function isEnabled() { return enabled; }

/** A readable, sortable, collision-proof session id. */
export function newSessionId() {
  // "2026-08-18T20:39:27.123Z" -> "20260818203927" (14 characters, no dot,
  // so it is safe as both a Firestore document id and a filename).
  const iso = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${iso}_${rand}`;
}

/**
 * Upload the raw frames for one trial. Safe to call after every trial, so a
 * participant who quits halfway still leaves usable data behind.
 *
 * @param {string} sessionId
 * @param {number} trialIndex
 * @param {Array<Array>} chunks   output of Recorder#toChunks()
 * @param {object} meta           { experimentId, trialId }
 * @param {(done:number,total:number)=>void} [onProgress]
 */
export async function uploadTrialChunks(sessionId, trialIndex, chunks, meta, onProgress) {
  if (!enabled) return;          // demo mode: nothing is saved
  const { doc, setDoc, serverTimestamp } = await import(`${SDK}/firebase-firestore.js`);

  for (let i = 0; i < chunks.length; i++) {
    const ref = doc(db, "sessions", sessionId, "chunks", `${pad(trialIndex)}_${pad(i)}`);
    await setDoc(ref, {
      uid,
      sessionId,
      experimentId: meta.experimentId,
      trialIndex,
      trialId: meta.trialId,
      chunkIndex: i,
      chunkCount: chunks.length,
      frames: chunks[i],
      uploadedAt: serverTimestamp(),
    });
    onProgress?.(i + 1, chunks.length);
  }
}

/**
 * Write one trial/block summary into its own document.
 * Detailed events/reach records live here instead of being packed into the
 * parent session document, which keeps the parent safely below Firestore's
 * 1 MiB per-document limit even for long experiments.
 *
 * Path: sessions/{sessionId}/trialSummaries/{trialIndex}
 */
export async function saveTrialSummary(sessionId, trialIndex, payload) {
  if (!enabled) return;
  const { doc, setDoc, serverTimestamp } = await import(`${SDK}/firebase-firestore.js`);
  await setDoc(
    doc(db, "sessions", sessionId, "trialSummaries", pad(trialIndex)),
    {
      ...payload,
      uid,
      sessionId,
      trialIndex,
      savedAt: serverTimestamp(),
    }
  );
}

/**
 * Write the small summary document. Call this once, at the very end.
 * @param {string} sessionId
 * @param {object} payload  everything except uid/timestamps, which we add here
 */
export async function saveSession(sessionId, payload) {
  if (!enabled) return;          // demo mode: nothing is saved
  const { doc, setDoc, serverTimestamp } = await import(`${SDK}/firebase-firestore.js`);
  await setDoc(doc(db, "sessions", sessionId), {
    ...payload,
    uid,
    sessionId,
    finishedAt: serverTimestamp(),
  });
}

/** Current anonymous user id, or null before initFirebase() has run. */
export function currentUid() { return uid; }

function pad(n) { return String(n).padStart(3, "0"); }
