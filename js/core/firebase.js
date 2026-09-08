/* firebase.js — V5.15 robust writes
 *
 * Changes from the prior Firestore helper:
 * - keeps raw chunks + per-trial detailed summaries
 * - adds bounded write timeouts and one retry so the UI cannot spin forever
 * - adds a separate postTaskSurvey document written only after core session save
 *
 * IMPORTANT: use the companion firestore-v5-15.rules. The retry path may issue
 * an idempotent second setDoc to the same document if the first request times out.
 */

import { FIREBASE } from "../../config.js";

const SDK = "https://www.gstatic.com/firebasejs/12.17.1";
const WRITE_TIMEOUT_MS = 20000;
const WRITE_ATTEMPTS = 2;

let app = null, db = null, auth = null, uid = null;
let enabled = false;

export function configLooksUnfilled() {
  return Object.values(FIREBASE).some(
    (v) => typeof v === "string" && v.includes("PASTE_YOUR")
  );
}

export async function initFirebase() {
  if (uid) return { uid, enabled: true };
  if (configLooksUnfilled()) {
    enabled = false;
    return { uid: null, enabled: false };
  }

  const { initializeApp } = await import(`${SDK}/firebase-app.js`);
  const { getAuth, signInAnonymously } = await import(`${SDK}/firebase-auth.js`);
  const { getFirestore } = await import(`${SDK}/firebase-firestore.js`);

  app = initializeApp(FIREBASE);
  auth = getAuth(app);
  db = getFirestore(app);

  try {
    const cred = await signInAnonymously(auth);
    uid = cred.user.uid;
    enabled = true;
  } catch (err) {
    if (String(err?.code).includes("operation-not-allowed")) {
      throw new Error("Anonymous Firebase sign-in is disabled for this project.");
    }
    throw new Error(`Could not sign in to Firebase: ${err?.message || err}`);
  }
  return { uid, enabled: true };
}

export function isEnabled() { return enabled; }

export function newSessionId() {
  const iso = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${iso}_${rand}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer != null) clearTimeout(timer);
  });
}

async function writeWithRetry(label, makeWrite) {
  let lastError = null;
  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt++) {
    try {
      await withTimeout(Promise.resolve().then(makeWrite), WRITE_TIMEOUT_MS, label);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < WRITE_ATTEMPTS) await sleep(650 * attempt);
    }
  }
  throw new Error(`${label} could not be saved after ${WRITE_ATTEMPTS} attempts: ${lastError?.message || lastError}`);
}

export async function uploadTrialChunks(sessionId, trialIndex, chunks, meta, onProgress) {
  if (!enabled) return;
  const { doc, setDoc, serverTimestamp } = await import(`${SDK}/firebase-firestore.js`);

  for (let i = 0; i < chunks.length; i++) {
    const ref = doc(db, "sessions", sessionId, "chunks", `${pad(trialIndex)}_${pad(i)}`);
    await writeWithRetry(`Raw data chunk ${trialIndex + 1}.${i + 1}`, () => setDoc(ref, {
      uid,
      sessionId,
      experimentId: meta.experimentId,
      trialIndex,
      trialId: meta.trialId,
      chunkIndex: i,
      chunkCount: chunks.length,
      frames: chunks[i],
      uploadedAt: serverTimestamp(),
    }));
    onProgress?.(i + 1, chunks.length);
  }
}

export async function saveTrialSummary(sessionId, trialIndex, payload) {
  if (!enabled) return;
  const { doc, setDoc, serverTimestamp } = await import(`${SDK}/firebase-firestore.js`);
  const ref = doc(db, "sessions", sessionId, "trialSummaries", pad(trialIndex));
  await writeWithRetry(`Trial summary ${trialIndex + 1}`, () => setDoc(ref, {
    ...payload,
    uid,
    sessionId,
    trialIndex,
    savedAt: serverTimestamp(),
  }));
}

export async function saveSession(sessionId, payload) {
  if (!enabled) return;
  const { doc, setDoc, serverTimestamp } = await import(`${SDK}/firebase-firestore.js`);
  const ref = doc(db, "sessions", sessionId);
  await writeWithRetry("Final session summary", () => setDoc(ref, {
    ...payload,
    uid,
    sessionId,
    finishedAt: serverTimestamp(),
  }));
}

export async function savePostTaskSurvey(sessionId, payload) {
  if (!enabled) return;
  const { doc, setDoc, serverTimestamp } = await import(`${SDK}/firebase-firestore.js`);
  const ref = doc(db, "sessions", sessionId, "postTaskSurvey", "response");
  await writeWithRetry("Post-task survey", () => setDoc(ref, {
    ...payload,
    uid,
    sessionId,
    savedAt: serverTimestamp(),
  }));
}

export function currentUid() { return uid; }
function pad(n) { return String(n).padStart(3, "0"); }
