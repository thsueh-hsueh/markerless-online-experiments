/* firebase.js — V5.18.3 qualification + save-reliability patch
 *
 * Keeps the existing Firestore layout, but fixes a failure mode seen in the
 * 320-trial task: a valid Firestore setDoc() can remain pending for longer than
 * 20 seconds during a temporary network/backend interruption. The old helper
 * treated that as failure and issued a duplicate setDoc().
 *
 * V5.18.2 issues each write exactly once. If acknowledgement is slow, it keeps
 * waiting on the SAME Firestore promise for an extended recovery window. This
 * preserves real backend errors while avoiding false failures and duplicate
 * writes against create-only security rules.
 */

import { FIREBASE } from "../../config.js";

const SDK = "https://www.gstatic.com/firebasejs/12.17.1";
const WRITE_TIMEOUT_MS = 60000;
const WRITE_RECOVERY_GRACE_MS = 240000;
const RAW_CHUNK_CONCURRENCY = 3;

let app = null, db = null, auth = null, uid = null;
let enabled = false;
let activeRawChunkWrites = 0;
const rawChunkWaiters = [];

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

function timeoutError(label, timeoutMs) {
  const err = new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
  err.code = "client-write-timeout";
  return err;
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(label, timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer != null) clearTimeout(timer);
  });
}

async function writeWithRecovery(label, makeWrite) {
  // Important: makeWrite() is called ONCE. Firestore itself keeps a pending
  // write alive while connectivity is interrupted. Racing the same promise
  // against two timers lets us show bounded UI behavior without duplicating
  // a create-only setDoc to the same document.
  const writePromise = Promise.resolve().then(makeWrite);

  try {
    await withTimeout(writePromise, WRITE_TIMEOUT_MS, label);
    return;
  } catch (err) {
    if (err?.code !== "client-write-timeout") {
      throw new Error(`${label} could not be saved: ${err?.message || err}`);
    }
  }

  try {
    await withTimeout(
      writePromise,
      WRITE_RECOVERY_GRACE_MS,
      `${label} (waiting for connection recovery)`
    );
  } catch (err) {
    if (err?.code === "client-write-timeout") {
      const totalSec = Math.round((WRITE_TIMEOUT_MS + WRITE_RECOVERY_GRACE_MS) / 1000);
      const out = new Error(
        `${label} is still waiting for Firebase after ${totalSec} seconds. ` +
        `Please check the internet connection and keep this page open.`
      );
      out.code = "save-confirmation-timeout";
      throw out;
    }
    throw new Error(`${label} could not be saved: ${err?.message || err}`);
  }
}

async function withRawChunkSlot(work) {
  if (activeRawChunkWrites >= RAW_CHUNK_CONCURRENCY) {
    await new Promise((resolve) => rawChunkWaiters.push(resolve));
  }
  activeRawChunkWrites += 1;
  try {
    return await work();
  } finally {
    activeRawChunkWrites -= 1;
    const next = rawChunkWaiters.shift();
    if (next) next();
  }
}

export async function createSessionStart(sessionId, payload) {
  if (!enabled) return;
  const { doc, setDoc, serverTimestamp } = await import(`${SDK}/firebase-firestore.js`);
  const ref = doc(db, "sessions", sessionId);
  await writeWithRecovery("Initial session record", () => setDoc(ref, {
    ...payload,
    uid,
    sessionId,
    status: payload.status ?? "in_progress",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
}

export async function saveSessionCheckpoint(sessionId, payload) {
  if (!enabled) return;
  const { doc, setDoc, serverTimestamp } = await import(`${SDK}/firebase-firestore.js`);
  const ref = doc(db, "sessions", sessionId);
  await writeWithRecovery("Session checkpoint", () => setDoc(ref, {
    ...payload,
    uid,
    sessionId,
    checkpointedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true }));
}

export async function uploadTrialChunks(sessionId, trialIndex, chunks, meta, onProgress) {
  if (!enabled) return;
  const { doc, setDoc, serverTimestamp } = await import(`${SDK}/firebase-firestore.js`);

  // Start all unique chunk writes for this block immediately. Firestore queues
  // them internally; waiting for one network acknowledgement before issuing the
  // next chunk unnecessarily magnifies a temporary connection stall.
  let completed = 0;
  const writes = chunks.map((chunk, i) => {
    const ref = doc(db, "sessions", sessionId, "chunks", `${pad(trialIndex)}_${pad(i)}`);
    return withRawChunkSlot(() => writeWithRecovery(
      `Raw data chunk ${trialIndex + 1}.${i + 1}`,
      () => setDoc(ref, {
        uid,
        sessionId,
        experimentId: meta.experimentId,
        trialIndex,
        trialId: meta.trialId,
        chunkIndex: i,
        chunkCount: chunks.length,
        frames: chunk,
        uploadedAt: serverTimestamp(),
      })
    )).then(() => {
      completed += 1;
      onProgress?.(completed, chunks.length);
    });
  });

  await Promise.all(writes);
}

export async function saveTrialSummary(sessionId, trialIndex, payload) {
  if (!enabled) return;
  const { doc, setDoc, serverTimestamp } = await import(`${SDK}/firebase-firestore.js`);
  const ref = doc(db, "sessions", sessionId, "trialSummaries", pad(trialIndex));
  await writeWithRecovery(`Trial summary ${trialIndex + 1}`, () => setDoc(ref, {
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
  await writeWithRecovery("Final session summary", () => setDoc(ref, {
    ...payload,
    uid,
    sessionId,
    taskFinishedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true }));
}

export async function finalizeSession(sessionId, payload = {}) {
  if (!enabled) return;
  const { doc, setDoc, serverTimestamp } = await import(`${SDK}/firebase-firestore.js`);
  const ref = doc(db, "sessions", sessionId);
  await writeWithRecovery("Completion status", () => setDoc(ref, {
    ...payload,
    uid,
    sessionId,
    status: "complete",
    finishedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true }));
}

export async function savePostTaskSurvey(sessionId, payload) {
  if (!enabled) return;
  const { doc, setDoc, serverTimestamp } = await import(`${SDK}/firebase-firestore.js`);
  const ref = doc(db, "sessions", sessionId, "postTaskSurvey", "response");
  await writeWithRecovery("Post-task survey", () => setDoc(ref, {
    ...payload,
    uid,
    sessionId,
    savedAt: serverTimestamp(),
  }));
}

export function currentUid() { return uid; }
function pad(n) { return String(n).padStart(3, "0"); }
