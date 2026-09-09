/* experiment.js: V5.16.4 JT-flow runner.
 *
 * You should not need to change this file to build a new experiment. It takes
 * an experiment definition (see experiments/_template.js) and walks the
 * participant through: consent -> essentials -> camera -> instructions -> trials -> core save -> bonus survey -> score.
 *
 * THE FRAME LOOP, in one paragraph:
 * Every time the browser paints (~60x per second), we check whether the webcam
 * has produced a new picture. If it has, we send it to MediaPipe, get back the
 * hand landmarks, hand them to your experiment's onFrame(), store the frame,
 * and let your draw() paint the overlay. Frames where no hand was visible are
 * still stored, as nulls, so gaps in your data stay visible instead of silently
 * disappearing. */

import { STUDY, CONSENT, RECORDING, ACTIVE_EXPERIMENT } from "../../config.js";
import { DEMOGRAPHIC_QUESTIONS, POST_TASK_QUESTIONS } from "../../questions.js";
import { renderForm, readForm, focusField } from "./form.js";
import { startCamera, stopCamera } from "./camera.js";
import { createTracker } from "./tracker.js";
import { Recorder } from "./recorder.js?v=3";
import * as fb from "./firebase.js?v=515";
import { getParticipant, getEnvironment, requestedExperiment } from "./participant.js";
import * as ui from "./ui.js";

export async function main() {
  const name = requestedExperiment(ACTIVE_EXPERIMENT);

  let exp;
  try {
exp = (await import(`../../experiments/${name}.js?v=161`)).default;
  } catch (err) {
    return ui.fatal(
      `Could not load the experiment "${name}".`,
      `Check that experiments/${name}.js exists and has no syntax errors. ` +
      `Original error: ${err.message}`
    );
  }

  try {
    await run(exp);
  } catch (err) {
    ui.fatal("Something went wrong.", err?.message || String(err));
  }
}

async function run(exp) {
  const participant = getParticipant();
  const startedAt = new Date().toISOString();

  const params = new URLSearchParams(window.location.search);
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const devMode = isLocalhost && params.get("dev") === "1";
  const showPostInDev = devMode && params.get("post") === "1";
  if (devMode) console.warn("LOCAL DEVELOPMENT MODE: consent and pre-task questions are skipped; Firebase upload is disabled.");

  if (fb.configLooksUnfilled()) {
    ui.$("#demo-banner").hidden = false;
    console.warn("Demo mode: Firebase is not configured, so nothing will be saved.");
  }

  /* ---- 1. Consent: preserve the approved document/affirmations, simplify UI. */
  let consentRecord;
  if (devMode) {
    consentRecord = { document: CONSENT.pdf ?? null, agreedTo: [], agreedAt: null, developmentBypass: true };
  } else {
    if (exp.participantFlow?.simplifiedConsent) {
      ui.setText("#study-title", "Please consent to start");
      ui.setText("#study-lab", "");
      ui.setHtml("#consent-intro", "");
      ui.setText("#experiment-title", "");
      const consentButton = ui.$("#btn-consent");
      if (consentButton) consentButton.textContent = "Next";
    } else {
      ui.setText("#study-title", STUDY.title);
      ui.setText("#study-lab", STUDY.labName);
      ui.setHtml("#consent-intro", STUDY.consentIntroHtml ?? "");
      ui.setText("#experiment-title", exp.title);
    }

    if (CONSENT.pdf) {
      ui.$("#consent-doc").src = CONSENT.pdf;
      ui.$("#consent-download").href = CONSENT.pdf;
    } else {
      ui.$("#consent-doc-wrap").hidden = true;
    }

    const agreed = await collectConsent(CONSENT.affirmations ?? []);
    consentRecord = {
      document: CONSENT.pdf ?? null,
      agreedTo: agreed,
      agreedAt: new Date().toISOString(),
      developmentBypass: false,
    };
  }

  /* ---- 2. Six essential pre-task questions only. */
  let demographics = {};
  if (!devMode && DEMOGRAPHIC_QUESTIONS.length) {
    configureQuestionScreen({
      title: "A few quick questions",
      subtitle: "This should take less than 30 seconds.",
      buttonText: "Next",
    });
    demographics = await collectQuestionSet(DEMOGRAPHIC_QUESTIONS);
  }

  if (!participant.participantId) {
    participant.participantId = `anon_${Math.random().toString(36).slice(2, 8)}`;
  }

  /* ---- 3. Firebase, camera, tracker. Camera permission happens BEFORE fullscreen. */
  ui.showScreen("screen-loading");
  ui.setText("#loading-text", "Connecting...");
  const { enabled: firebaseEnabled } = await fb.initFirebase();
  const saving = firebaseEnabled && !devMode;
  const sessionId = fb.newSessionId();

  ui.setText("#loading-text", "Starting your camera...");
  const video = await startCamera(RECORDING.video);
  ui.setText("#loading-text", "Loading the hand tracking model...");
  const tracker = await createTracker(exp.tracker ?? "hand", exp.trackerOptions ?? {});
  if (tracker.delegate === "CPU") ui.$("#cpu-banner").hidden = false;

  const stage = ui.$("#stage");
  const canvas = ui.$("#overlay");
  stage.querySelector(".mirror").prepend(video);
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  stage.hidden = false;

  /* Camera check. The experiment's camera Continue button requests fullscreen. */
  ui.showScreen("screen-position");
  await positioningLoop(video, tracker, ctx, canvas, stage);

  /* ---- 4. Instructions. A held fist starts the task; click remains fallback. */
  ui.setHtml("#instructions-text", exp.instructions ?? "");
  ui.showScreen("screen-instructions");
  if (exp.participantFlow?.gestureStart) {
    await waitForFistOrClick(video, tracker, "#btn-start");
  } else {
    await ui.waitForClick("#btn-start");
  }

  const comprehensionRecord = await runComprehensionIfNeeded(exp, video, tracker);

  /* ---- 5. Trials. Uploads are serialized in the BACKGROUND during transitions. */
  const trials = typeof exp.trials === "function" ? exp.trials() : exp.trials;
  const recorder = new Recorder();
  const trialSummaries = [];
  const demoFrames = [];
  const uploadManager = createUploadManager({ saving, sessionId, experimentId: exp.id, trialCount: trials.length });

  for (let i = 0; i < trials.length; i++) {
    const trial = trials[i];
    const state = exp.onTrialStart?.(trial, { tracker }) ?? {};

    video.style.opacity = trial.showCamera === false ? "0" : "1";
    ui.showScreen("screen-trial");
    ui.setProgress(i + 1, trials.length);
    ui.setHtml("#trial-prompt", trial.prompt ?? exp.trialPrompt ?? "");
    ui.setHtml("#live-readout", "");
    await ui.countdown(trial.countdownSec ?? 3);

    recorder.reset();
    await recordTrial({ video, tracker, ctx, canvas, exp, trial, state, recorder });

    const summary = exp.onTrialEnd?.({
      frames: recorder.frames,
      events: recorder.events,
      trial,
      state,
    }) ?? {};

    const currentTrialSummary = {
      index: i,
      id: trial.id ?? `trial_${i}`,
      ...trial,
      frameCount: recorder.frames.length,
      detectionRate: round(recorder.detectionRate(), 4),
      events: recorder.events,
      ...summary,
    };
    trialSummaries.push(currentTrialSummary);

    if (saving) {
      uploadManager.queueTrial({
        trialIndex: i,
        trialId: trial.id ?? `trial_${i}`,
        chunks: recorder.toChunks(),
        summary: currentTrialSummary,
      });
    } else {
      demoFrames[i] = recorder.frames.slice();
    }

    if (i < trials.length - 1) {
      ui.showScreen("screen-rest");
      ui.setText("#rest-progress", `${i + 1} of ${trials.length} done`);
      await ui.waitForClick("#btn-next-trial");
    }
  }

  /* Tracking work is finished; release camera/MediaPipe before the final network flush. */
  const trackerMeta = { delegate: tracker.delegate, errorCount: tracker.errorCount };
  stopCamera(video);
  tracker.close();
  stage.hidden = true;

  const compactTrialSummaries = trialSummaries.map((t) => {
    const { events, reaches, ...compact } = t;
    return {
      ...compact,
      eventCount: Array.isArray(events) ? events.length : 0,
      reachCount: Array.isArray(reaches) ? reaches.length : null,
    };
  });

  const sessionDoc = {
    experimentId: exp.id,
    experimentTitle: exp.title,
    participantId: participant.participantId,
    participantSource: participant.source,
    prolific: participant.prolific,
    condition: participant.condition,
    startedAt,
    consent: consentRecord,
    demographics,
    comprehension: comprehensionRecord,
    trials: compactTrialSummaries,
    trialSummaryStorage: "trialSummaries_subcollection",
    postTaskSurveyStorage: "postTaskSurvey/response_if_completed",
    settings: { recording: RECORDING, trackerOptions: exp.trackerOptions ?? {} },
    environment: {
      ...getEnvironment(),
      trackerDelegate: trackerMeta.delegate,
      trackerErrors: trackerMeta.errorCount,
    },
    runnerBuild: "v5.16.1-jt-flow-20260909",
    schemaVersion: 5,
  };

  /* ---- 6. CORE SAVE before the bonus survey. Real progress; no fake countdown. */
  if (saving) {
    ui.showScreen("screen-saving");
    ensureSavingProgressUi();
    uploadManager.addFinalUnit();
    updateSavingProgress(uploadManager.progress(), "Saving your game data...");

    let slowTimer = setTimeout(() => {
      updateSavingProgress(uploadManager.progress(), "Still saving — your connection is taking longer than usual. Please keep this page open.");
    }, 15000);

    try {
      await uploadManager.flush();
      updateSavingProgress(uploadManager.progress(), "Finishing your save...");
      await fb.saveSession(sessionId, sessionDoc);
      uploadManager.completeFinalUnit();
      updateSavingProgress(uploadManager.progress(), "Saved.");
    } finally {
      clearTimeout(slowTimer);
    }
  }

  if (saving && RECORDING.alsoDownloadLocally) {
    ui.downloadJson(`${sessionId}.json`, sessionDoc);
  }

  /* ---- 7. Bonus post-task survey. Core game data are already safe. */
  let postTaskSurvey = null;
  let postTaskSurveySavePromise = null;
  if (exp.participantFlow?.postTaskSurvey && (!devMode || showPostInDev) && POST_TASK_QUESTIONS?.length) {
    configureQuestionScreen({
      title: "A few final questions",
      subtitle: "Your game data have been saved. Complete these questions to see your score.",
      buttonText: "Show my score",
    });
    postTaskSurvey = await collectQuestionSet(POST_TASK_QUESTIONS);

    if (saving) {
      // Bonus survey upload starts immediately but never blocks the score screen.
      postTaskSurveySavePromise = fb.savePostTaskSurvey(sessionId, {
        experimentId: exp.id,
        participantId: participant.participantId,
        completedAt: new Date().toISOString(),
        responses: postTaskSurvey,
      }).catch((err) => {
        console.warn("Post-task survey upload failed; core session is already saved.", err);
      });
    }
  }

  /* ---- 8. Score appears only after the post-task survey (or immediately in dev). */
  const score = computeTreasureScore(trialSummaries);
  ui.setHtml(
    "#done-results",
    exp.participantFlow?.showScore ? scoreCard(score) : resultsTable(exp, trialSummaries)
  );

  if (saving) {
    ui.setText("#done-session-id", sessionId);
  } else {
    ui.$("#done-saved-line").hidden = true;
    ui.$("#done-demo").hidden = false;
    ui.$("#btn-download-demo").onclick = () => {
      const copy = structuredClone(sessionDoc);
      copy.postTaskSurvey = postTaskSurvey;
      copy.trials.forEach((t, i) => { t.frames = demoFrames[i] ?? []; });
      ui.downloadJson(`${sessionId}.json`, copy);
    };
  }

  ui.showScreen("screen-done");
  if (saving && STUDY.completionRedirectUrl) {
    ui.setText("#done-redirect-note", "Returning you to Prolific in 5 seconds...");
    if (postTaskSurveySavePromise) {
      await Promise.race([postTaskSurveySavePromise, ui.sleep(1500)]);
    }
    await ui.sleep(3500);
    location.href = STUDY.completionRedirectUrl;
  }
}

function configureQuestionScreen({ title, subtitle, buttonText }) {
  const screen = ui.$("#screen-demographics");
  if (!screen) return;
  const h2 = screen.querySelector("h2");
  if (h2) h2.textContent = title;

  let note = screen.querySelector("#v516-question-note");
  if (!note) {
    note = document.createElement("p");
    note.id = "v516-question-note";
    note.className = "subtle";
    const form = ui.$("#demographics-form");
    if (form) form.before(note);
  }
  note.textContent = subtitle;

  const button = ui.$("#btn-demographics");
  if (button) button.textContent = buttonText;
}

async function collectQuestionSet(questions) {
  const formEl = ui.$("#demographics-form");
  renderForm(formEl, questions);
  ui.showScreen("screen-demographics");
  while (true) {
    await ui.waitForClick("#btn-demographics");
    const { ok, values, firstError } = readForm(formEl, questions);
    if (ok) return values;
    focusField(formEl, firstError);
  }
}

async function runComprehensionIfNeeded(exp, video, tracker) {
  if (!exp.comprehension?.questions?.length) return null;
  const questions = exp.comprehension.questions;
  const correctAnswers = exp.comprehension.answers ?? {};
  let attempts = 0;
  let firstAttemptCorrect = null;
  const attemptRecords = [];

  while (true) {
    attempts += 1;
    const formEl = ui.$("#comprehension-form");
    renderForm(formEl, questions);
    ui.setText("#comprehension-feedback", "");
    ui.showScreen("screen-comprehension");

    let values;
    while (true) {
      await ui.waitForClick("#btn-comprehension");
      const result = readForm(formEl, questions);
      if (result.ok) { values = result.values; break; }
      focusField(formEl, result.firstError);
    }

    const items = questions.map((q) => ({
      id: q.id,
      response: values[q.id],
      correctAnswer: correctAnswers[q.id],
      correct: values[q.id] === correctAnswers[q.id],
    }));
    const correctCount = items.filter((item) => item.correct).length;
    const passed = correctCount === questions.length;
    if (attempts === 1) firstAttemptCorrect = correctCount;
    attemptRecords.push({ attempt: attempts, correctCount, total: questions.length, passed, items });

    if (passed) {
      return { passed: true, attempts, firstAttemptCorrect, totalQuestions: questions.length, attemptRecords };
    }

    ui.setText("#comprehension-feedback", `You answered ${correctCount} of ${questions.length} correctly. Please review the instructions and try again.`);
    await ui.sleep(1200);
    ui.setHtml("#instructions-text", exp.instructions ?? "");
    ui.showScreen("screen-instructions");
    if (exp.participantFlow?.gestureStart) await waitForFistOrClick(video, tracker, "#btn-start");
    else await ui.waitForClick("#btn-start");
  }
}

function landmarkDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function looksLikeFist(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  const palmIds = [0, 5, 9, 13, 17];
  const palm = palmIds.reduce((acc, i) => ({ x: acc.x + landmarks[i].x, y: acc.y + landmarks[i].y }), { x: 0, y: 0 });
  palm.x /= palmIds.length;
  palm.y /= palmIds.length;
  const palmWidth = landmarkDistance(landmarks[5], landmarks[17]);
  if (!Number.isFinite(palmWidth) || palmWidth < 0.015) return false;
  const curledTips = [8, 12, 16, 20].filter((i) => landmarkDistance(landmarks[i], palm) < palmWidth * 1.08).length;
  return curledTips >= 3;
}

async function waitForFistOrClick(video, tracker, buttonSelector) {
  const button = ui.$(buttonSelector);
  if (!button) return;
  button.textContent = "Start with a click instead";

  const MIN_READ_MS = 6000;
  const OPEN_HAND_ARM_MS = 1000;
  const FIST_HOLD_MS = 1200;
  const shownAt = performance.now();

  let done = false;
  const onClick = () => { done = true; };
  button.addEventListener("click", onClick);

  let fistSince = null;
  let openHandSince = null;
  let gestureArmed = false;
  let lastVideoTime = -1;
  const title = document.getElementById("treasure-gesture-start-title");
  const hint =
    document.getElementById("treasure-gesture-start-status") ||
    document.getElementById("treasure-gesture-start-hint");
  const gestureIcon = document.getElementById("treasure-gesture-start-icon");
  const setGesturePrompt = (headline, detail, iconState = null) => {
    if (title) title.textContent = headline;
    if (hint) hint.textContent = detail;
    if (gestureIcon && iconState) {
      const src = iconState === "read" ? gestureIcon.dataset.readSrc
        : iconState === "open" ? gestureIcon.dataset.openSrc
        : gestureIcon.dataset.fistSrc;
      if (src && gestureIcon.getAttribute("src") !== src) gestureIcon.setAttribute("src", src);
    }
  };

  try {
    while (!done) {
      if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const now = performance.now();
        const res = tracker.track(video, now);
        const hands = res.landmarks ?? [];
        const anyHand = hands.length > 0;
        const fist = hands.some(looksLikeFist);
        const readElapsed = now - shownAt;

        if (readElapsed < MIN_READ_MS) {
          /* Do not arm the gesture during the reading window. A pre-existing fist
             or a single noisy open-hand frame cannot advance the page. */
          fistSince = null;
          openHandSince = null;
          gestureArmed = false;
          setGesturePrompt("READ THE 3 STEPS ABOVE", `Please read before starting · ${Math.ceil((MIN_READ_MS-readElapsed)/1000)}s`, "read");
        } else if (!gestureArmed) {
          fistSince = null;
          if (anyHand && !fist) {
            if (openHandSince == null) openHandSince = now;
            const openHeld = now - openHandSince;
            setGesturePrompt("OPEN YOUR HAND FIRST", openHeld >= 250 ? "Keep it open for a moment..." : "Hold your hand open for a moment.", "open");
            if (openHeld >= OPEN_HAND_ARM_MS) {
              gestureArmed = true;
              openHandSince = null;
              setGesturePrompt("MAKE A FIST TO BEGIN", "Close your hand and hold.", "fist");
            }
          } else {
            openHandSince = null;
            setGesturePrompt("OPEN YOUR HAND FIRST", "Hold your hand open for a moment.", "open");
          }
        } else if (fist) {
          if (fistSince == null) fistSince = now;
          const held = now - fistSince;
          setGesturePrompt("HOLD YOUR FIST", held >= 250 ? "Keep holding..." : "Fist detected.", "fist");
          if (held >= FIST_HOLD_MS) done = true;
        } else {
          fistSince = null;
          setGesturePrompt("MAKE A FIST TO BEGIN", "Close your hand and hold.", "fist");
        }
      }
      await nextFrame();
    }
  } finally {
    button.removeEventListener("click", onClick);
  }
}

function ensureSavingProgressUi() {
  const screen = ui.$("#screen-saving");
  if (!screen || document.getElementById("v516-saving-progress")) return;
  const shell = document.createElement("div");
  shell.id = "v516-saving-progress";
  shell.style.cssText = "width:min(520px,86vw);margin:18px auto 0;text-align:left;";
  shell.innerHTML = `
    <div style="height:14px;border-radius:999px;background:rgba(255,255,255,.11);overflow:hidden;border:1px solid rgba(255,255,255,.08);">
      <div id="v516-saving-bar" style="height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#77a9ff,#98d9ff);transition:width .22s ease;"></div>
    </div>
    <div id="v516-saving-percent" style="margin-top:8px;text-align:center;font-weight:800;">0%</div>`;
  const savingText = ui.$("#saving-text");
  (savingText || screen.lastElementChild)?.after(shell);
}

function updateSavingProgress(progress, message) {
  ensureSavingProgressUi();
  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
  const bar = document.getElementById("v516-saving-bar");
  const label = document.getElementById("v516-saving-percent");
  if (bar) bar.style.width = `${pct}%`;
  if (label) label.textContent = `${pct}%`;
  if (message) ui.setText("#saving-text", message);
}

function createUploadManager({ saving, sessionId, experimentId, trialCount }) {
  let chain = Promise.resolve();
  let totalUnits = 0;
  let completedUnits = 0;
  let finalUnitAdded = false;
  let finalUnitComplete = false;
  let firstError = null;

  const progress = () => totalUnits > 0 ? completedUnits / totalUnits : 0;

  const queueTrial = ({ trialIndex, trialId, chunks, summary }) => {
    if (!saving) return;
    const chunkCount = Math.max(1, chunks.length);
    totalUnits += chunkCount + 1; // chunks + one detailed summary document

    chain = chain.then(async () => {
      let lastDone = 0;
      await fb.uploadTrialChunks(
        sessionId,
        trialIndex,
        chunks,
        { experimentId, trialId },
        (done) => {
          const delta = Math.max(0, done - lastDone);
          lastDone = done;
          completedUnits += delta;
          updateSavingProgress(progress());
        }
      );
      // Empty-chunk edge case still counts as one chunk unit.
      if (chunks.length === 0) completedUnits += 1;
      await fb.saveTrialSummary(sessionId, trialIndex, summary);
      completedUnits += 1;
      updateSavingProgress(progress());
    }).catch((err) => {
      firstError ??= err;
    });
  };

  return {
    queueTrial,
    addFinalUnit() {
      if (!finalUnitAdded) { totalUnits += 1; finalUnitAdded = true; }
    },
    completeFinalUnit() {
      if (finalUnitAdded && !finalUnitComplete) {
        completedUnits += 1;
        finalUnitComplete = true;
      }
    },
    progress,
    async flush() {
      await chain;
      if (firstError) throw new Error(`A background upload failed: ${firstError.message || firstError}`);
    },
    trialCount,
  };
}

function computeTreasureScore(summaries) {
  const reaches = summaries
    .filter((t) => t.kind === "baseline_reaching")
    .flatMap((t) => Array.isArray(t.reaches) ? t.reaches : [])
    .filter((r) => !r.timedOut && !r.invalid);

  const hits = reaches.filter((r) => {
    if (r.endpointInsideTarget === 1) return true;
    if (Number.isFinite(r.initialDistanceToTarget)) return r.initialDistanceToTarget <= 0.10;
    return false;
  }).length;
  const planned = summaries
    .filter((t) => t.kind === "baseline_reaching")
    .reduce((sum, t) => sum + (Number.isFinite(t.requestedReaches) ? t.requestedReaches : 0), 0);
  return { hits, total: planned || reaches.length };
}

function scoreCard(score) {
  const total = Math.max(0, score.total || 0);
  const hits = Math.max(0, score.hits || 0);
  return `
    <div style="max-width:520px;margin:18px auto;padding:26px 22px;border-radius:24px;text-align:center;background:linear-gradient(180deg,rgba(25,55,104,.95),rgba(8,24,53,.96));border:1px solid rgba(143,190,255,.20);box-shadow:0 18px 50px rgba(0,0,0,.22);">
      <div style="font-size:1rem;font-weight:800;color:#bcd1ed;letter-spacing:.06em;">YOUR SCORE</div>
      <div style="font-size:3.1rem;font-weight:950;color:#f5f9ff;margin:5px 0 3px;">${hits} / ${total}</div>
      <div style="font-weight:750;color:#9fc8ff;">gems reached</div>
    </div>`;
}

/* -------------------------------------------------------------------------
 * Draw one checkbox per consent statement and wait until all are ticked.
 * Returns the statements that were agreed to, so the record stored with the
 * session is the wording the participant actually saw.
 * ---------------------------------------------------------------------- */
async function collectConsent(statements) {
  const box = ui.$("#consent-affirmations");
  const button = ui.$("#btn-consent");
  box.innerHTML = "";

  const boxes = statements.map((text, i) => {
    const row = document.createElement("label");
    row.className = "q-choice affirm";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `affirm-${i}`;
    row.append(input, document.createTextNode(" " + text));
    box.append(row);
    return input;
  });

  const refresh = () => { button.disabled = !boxes.every((b) => b.checked); };
  boxes.forEach((b) => b.addEventListener("change", refresh));
  refresh();

  ui.showScreen("screen-consent");
  await ui.waitForClick("#btn-consent");
  return statements.filter((_, i) => boxes[i].checked);
}

/* -------------------------------------------------------------------------
 * Retina/high-DPI overlay support. The canvas keeps CSS-pixel logical
 * coordinates while its backing store is enlarged for sharper vector art.
 * The backing store is capped near 2.1 MP to avoid unnecessary per-frame cost.
 * ---------------------------------------------------------------------- */
function syncOverlayResolution(canvas, video = null) {
  const rect = canvas.getBoundingClientRect();
  const fallbackW = Math.max(1, video?.videoWidth || canvas.__logicalWidth || canvas.width || 640);
  const fallbackH = Math.max(1, video?.videoHeight || canvas.__logicalHeight || canvas.height || 480);
  const aspect = fallbackW / fallbackH;

  const logicalW = Math.max(1, Math.round(rect.width || fallbackW));
  const logicalH = Math.max(1, Math.round(rect.height || (logicalW / aspect)));

  const desiredDpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  let backingW = Math.max(1, Math.round(logicalW * desiredDpr));
  let backingH = Math.max(1, Math.round(logicalH * desiredDpr));

  const MAX_BACKING_PIXELS = 2073600;
  const pixelCount = backingW * backingH;
  if (pixelCount > MAX_BACKING_PIXELS) {
    const s = Math.sqrt(MAX_BACKING_PIXELS / pixelCount);
    backingW = Math.max(1, Math.round(backingW * s));
    backingH = Math.max(1, Math.round(backingH * s));
  }

  if (canvas.width !== backingW || canvas.height !== backingH) {
    canvas.width = backingW;
    canvas.height = backingH;
  }

  canvas.__logicalWidth = logicalW;
  canvas.__logicalHeight = logicalH;
  canvas.__renderScaleX = backingW / logicalW;
  canvas.__renderScaleY = backingH / logicalH;
}

function prepareOverlayContext(ctx, canvas, video = null, clear = true) {
  syncOverlayResolution(canvas, video);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (clear) ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(canvas.__renderScaleX || 1, 0, 0, canvas.__renderScaleY || 1, 0, 0);
}

/* -------------------------------------------------------------------------
 * The positioning preview: run the tracker live until the participant has been
 * visible for a couple of continuous seconds, then let them continue.
 * ---------------------------------------------------------------------- */
async function positioningLoop(video, tracker, ctx, canvas, stage) {
  ui.$("#position-stage-slot").append(stage);

  let stop = false;
  let visibleSince = null;
  const btn = ui.$("#btn-position-done");
  btn.disabled = true;
  ui.waitForClick("#btn-position-done").then(() => { stop = true; });

  let lastVideoTime = -1;
  while (!stop) {
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const res = tracker.track(video, performance.now());
      prepareOverlayContext(ctx, canvas, video, true);
      drawLandmarks(ctx, canvas, res.landmarks[0]);

      const seen = res.landmarks.length > 0;
      if (seen && visibleSince === null) visibleSince = performance.now();
      if (!seen) visibleSince = null;

      const heldFor = visibleSince ? performance.now() - visibleSince : 0;
      if (heldFor > 1500) {
        btn.disabled = false;
        ui.setText("#position-status", "Looking good, you can continue.");
        ui.$("#position-status").className = "status good";
      } else {
        btn.disabled = true;
        ui.setText("#position-status",
          seen ? "Hold still..." : "Your hand is not visible. Move it into the frame.");
        ui.$("#position-status").className = seen ? "status" : "status bad";
      }
    }
    await nextFrame();
  }
  // Move the camera view into the trial screen for the rest of the study.
  ui.$("#trial-stage-slot").append(stage);
}

/* -------------------------------------------------------------------------
 * One trial's frame loop.
 * ---------------------------------------------------------------------- */
async function recordTrial({ video, tracker, ctx, canvas, exp, trial, state, recorder }) {
  const durationMs = (trial.durationSec ?? 15) * 1000;
  const t0 = performance.now();
  let lastVideoTime = -1;

  while (performance.now() - t0 < durationMs && !state.finished) {
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const tMs = performance.now() - t0;
      const res = tracker.track(video, performance.now());

      const allLandmarks =
  res.landmarks ?? [];

const allWorldLandmarks =
  res.worldLandmarks ?? [];

const allHandedness =
  res.handedness ?? [];


/*
 * Keep the original single-hand API working.
 */
const lm =
  allLandmarks[0] ?? null;

const wl =
  allWorldLandmarks[0] ?? null;


const derived = exp.onFrame?.({

  // Backward-compatible first hand
  landmarks: lm,
  worldLandmarks: wl,
  handedness:
    allHandedness[0] ?? null,

  // NEW: all detected hands
  allLandmarks,
  allWorldLandmarks,
  allHandedness,

  tMs,
  trial,
  state,

  addEvent:
    (type, data) =>
      recorder.addEvent(
        tMs,
        type,
        data
      ),

}) ?? {};

      recorder.addFrame(
  tMs,
  lm,
  wl,
  derived,
  {
    allLandmarks,
    allWorldLandmarks,
    allHandedness,
  }
);

      prepareOverlayContext(ctx, canvas, video, true);
      if (exp.draw) {
        exp.draw(ctx, {

  landmarks: lm,

  // NEW
  allLandmarks,
  allWorldLandmarks,
  allHandedness,

  derived,
  state,
  trial,
  canvas,
  tMs,

  setReadout:
    (html) =>
      ui.setHtml(
        "#live-readout",
        html
      ),

});
      } else {
        drawLandmarks(ctx, canvas, lm);
      }

      ui.setTimeRemaining((durationMs - tMs) / 1000);
    }
    await nextFrame();
  }
}

/* -------------------------------------------------------------------------
 * Default overlay: dots on every landmark, lines along the fingers.
 * ---------------------------------------------------------------------- */
const HAND_BONES = [
  [0,1],[1,2],[2,3],[3,4],          // thumb
  [0,5],[5,6],[6,7],[7,8],          // index
  [5,9],[9,10],[10,11],[11,12],     // middle
  [9,13],[13,14],[14,15],[15,16],   // ring
  [13,17],[17,18],[18,19],[19,20],  // pinky
  [0,17],
];

export function drawLandmarks(ctx, canvas, landmarks, color = "#4ade80") {
  const W = canvas.__logicalWidth ?? canvas.clientWidth ?? canvas.width;
  const H = canvas.__logicalHeight ?? canvas.clientHeight ?? canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!landmarks) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  if (landmarks.length === 21) {
    for (const [a, b] of HAND_BONES) {
      ctx.beginPath();
      ctx.moveTo(landmarks[a].x * W, landmarks[a].y * H);
      ctx.lineTo(landmarks[b].x * W, landmarks[b].y * H);
      ctx.stroke();
    }
  }
  ctx.fillStyle = "#ffffff";
  for (const p of landmarks) {
    ctx.beginPath();
    ctx.arc(p.x * W, p.y * H, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A small table of what happened, shown on the final screen. */
function resultsTable(exp, summaries) {
  const rows = summaries.map((t) => {
    const bits = [];
    if (t.tapCount != null) bits.push(`<td>${t.tapCount}</td>`);
    if (t.tapRateHz != null) bits.push(`<td>${t.tapRateHz.toFixed(2)} Hz</td>`);
    if (t.detectionRate != null) {
      const pct = Math.round(t.detectionRate * 100);
      bits.push(`<td class="${pct < 90 ? "bad" : ""}">${pct}%</td>`);
    }
    return `<tr><th>${t.hand ?? t.id}</th>${bits.join("")}</tr>`;
  });
  if (!rows.length) return "";
  const headers = ["", summaries[0].tapCount != null ? "taps" : null,
                   summaries[0].tapRateHz != null ? "rate" : null,
                   summaries[0].detectionRate != null ? "hand visible" : null]
                  .filter((h) => h !== null);
  return `<table class="results">
    <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
    ${rows.join("")}
  </table>`;
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(r));
}

function round(v, d) { const p = 10 ** d; return Math.round(v * p) / p; }

