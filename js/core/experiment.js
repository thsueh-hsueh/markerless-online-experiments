/* experiment.js: V5.18.3 qualification + reliability runner.
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
import { DEMOGRAPHIC_QUESTIONS, POST_TASK_QUESTIONS, POST_TASK_LIKERT_SCALE } from "../../questions.js";
import { renderForm, readForm, focusField } from "./form.js";
import { startCamera, stopCamera } from "./camera.js";
import { createTracker } from "./tracker.js";
import { Recorder } from "./recorder.js?v=3";
import * as fb from "./firebase.js?v=5183";
import { getParticipant, getEnvironment, requestedExperiment } from "./participant.js";
import * as ui from "./ui.js";

const RUNNER_BUILD = "v5.18.3-preflight-gate-save-reliability-qa6-20260912";

function detectBrowserInfo() {
  const ua = navigator.userAgent || "";
  let name = "Unknown";
  let version = "";

  const edge = ua.match(/Edg\/([\d.]+)/);
  const chrome = ua.match(/Chrome\/([\d.]+)/);
  const firefox = ua.match(/Firefox\/([\d.]+)/);
  const safari = ua.match(/Version\/([\d.]+).*Safari/);

  if (edge) {
    name = "Edge";
    version = edge[1];
  } else if (chrome) {
    name = "Chrome";
    version = chrome[1];
  } else if (firefox) {
    name = "Firefox";
    version = firefox[1];
  } else if (safari) {
    name = "Safari";
    version = safari[1];
  }

  return { browserName: name, browserVersion: version };
}

function prolificCompletionCode() {
  const explicit = STUDY.completionCode;
  if (explicit) return String(explicit);
  const redirect = STUDY.completionRedirectUrl;
  if (!redirect) return "";
  try {
    return new URL(redirect, window.location.href).searchParams.get("cc") || "";
  } catch {
    return "";
  }
}

export async function main() {
  document.documentElement.lang = "en";
  document.documentElement.setAttribute("translate", "no");
  const name = requestedExperiment(ACTIVE_EXPERIMENT);

  let exp;
  try {
    exp = (await import(`../../experiments/${name}.js?v=5183`)).default;
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
      subtitle: "",
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

  /* V5.18.3: create the identifiable parent record before camera/trials. If
     the participant later returns or the browser closes, raw data can still be
     linked to the Prolific PID instead of becoming an anonymous orphan. */
  if (saving) {
    await fb.createSessionStart(sessionId, {
      experimentId: exp.id,
      experimentTitle: exp.title,
      participantId: participant.participantId,
      participantSource: participant.source,
      prolific: participant.prolific,
      condition: participant.condition,
      startedAt,
      consent: consentRecord,
      demographics,
      status: "in_progress",
      runnerBuild: RUNNER_BUILD,
      schemaVersion: 6,
      environment: {
        ...getEnvironment(),
        ...detectBrowserInfo(),
      },
    });
  }

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

  if (saving) {
    await fb.saveSessionCheckpoint(sessionId, {
      status: "in_progress",
      lastCompletedStage: "camera_tracker_ready",
      environment: {
        ...getEnvironment(),
        ...detectBrowserInfo(),
        cameraWidth: video.videoWidth || null,
        cameraHeight: video.videoHeight || null,
        trackerDelegate: tracker.delegate,
      },
    });
  }

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

  /* ---- 5. Trials. V5.18.3 keeps every calibration attempt, but uses a
     separate storage index so a retry never overwrites the first attempt. */
  const trials = typeof exp.trials === "function" ? exp.trials() : exp.trials;
  const recorder = new Recorder();
  const trialSummaries = [];
  const demoFrames = [];
  const uploadManager = createUploadManager({ saving, sessionId, experimentId: exp.id, trialCount: trials.length });
  const trialAttempts = new Map();
  let executionIndex = 0;
  let termination = null;

  for (let i = 0; i < trials.length;) {
    const trial = trials[i];
    const attemptKey = trial.id ?? `trial_${i}`;
    const attempt = (trialAttempts.get(attemptKey) ?? 0) + 1;
    trialAttempts.set(attemptKey, attempt);
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
      index: executionIndex,
      plannedIndex: i,
      attempt,
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
        trialIndex: executionIndex,
        trialId: trial.id ?? `trial_${i}`,
        chunks: recorder.toChunks(),
        summary: currentTrialSummary,
      });
    } else {
      demoFrames[executionIndex] = recorder.frames.slice();
    }

    const outcome = exp.qualityControl?.evaluateTrial?.({
      trial,
      summary: currentTrialSummary,
      attempt,
      plannedIndex: i,
      executionIndex,
    }) ?? { action: "continue" };

    const completedReachCount = trialSummaries
      .filter((t) => t.kind === "baseline_reaching")
      .reduce((sum, t) => sum + (Number.isFinite(t.completedReaches) ? t.completedReaches : 0), 0);

    if (saving) {
      const checkpoint = {
        status: outcome.action === "terminate"
          ? (outcome.status || "technical_runtime_failure")
          : outcome.action === "retry"
            ? "preflight_retry"
            : "in_progress",
        lastAttemptedStage: trial.id ?? `trial_${i}`,
        lastTrialStorageIndex: executionIndex,
        lastTrialAttempt: attempt,
        completedReachCount,
      };
      if (outcome.action === "continue") checkpoint.lastCompletedStage = trial.id ?? `trial_${i}`;
      if (trial.kind === "baseline_reaching" && currentTrialSummary.blockFinishedNormally === true) {
        checkpoint.lastCompletedBlock = trial.id;
      }
      if (currentTrialSummary.preflightQuality) {
        checkpoint.preflightLatest = {
          hand: trial.hand,
          attempt,
          ...currentTrialSummary.preflightQuality,
        };
      }
      if (outcome.failureReason) checkpoint.failureReason = outcome.failureReason;
      uploadManager.queueCheckpoint(checkpoint);
    }

    executionIndex += 1;

    if (outcome.action === "retry") {
      await showCalibrationRetry(trial.hand);
      continue;
    }

    if (outcome.action === "terminate") {
      termination = {
        status: outcome.status || "technical_runtime_failure",
        failureReason: outcome.failureReason || "technical_failure",
        reasons: outcome.reasons || [],
        trialId: trial.id ?? `trial_${i}`,
        hand: trial.hand ?? null,
        attempt,
      };
      break;
    }

    i += 1;

    if (i < trials.length) {
      ui.showScreen("screen-rest");
      ui.setText("#rest-progress", `${i} of ${trials.length} done`);
      await ui.waitForClick("#btn-next-trial");
    }
  }

  /* Tracking work is finished; release camera/MediaPipe before the final network flush. */
  const trackerMeta = { delegate: tracker.delegate, errorCount: tracker.errorCount };
  stopCamera(video);
  tracker.close();
  stage.hidden = true;

  if (termination) {
    if (saving) {
      ui.showScreen("screen-saving");
      ui.setText("#saving-text", "Saving the technical check...");
      try {
        if (termination.status === "technical_preflight_failure") {
          /* Calibration data are relatively small and valuable for tuning the
             qualification gate, so confirm the raw calibration chunks too. */
          await uploadManager.flush();
        } else {
          /* A runtime failure can occur after a very long block. Confirm the
             summary/checkpoint immediately without forcing the participant to
             wait for a large raw-data backlog before seeing the stop screen. */
          await uploadManager.flushCritical();
        }
      } catch (err) {
        console.warn("Could not confirm all technical-check data before termination:", err);
      }
    }
    showTechnicalStop(termination);
    return;
  }

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
      ...detectBrowserInfo(),
      cameraWidth: video.videoWidth || null,
      cameraHeight: video.videoHeight || null,
      trackerDelegate: trackerMeta.delegate,
      trackerErrors: trackerMeta.errorCount,
    },
    status: "task_complete_pending_survey",
    runnerBuild: RUNNER_BUILD,
    schemaVersion: 6,
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

  /* ---- 7. Required post-task survey. Core game data are already safe. */
  let postTaskSurvey = null;
  let postTaskSurveySavePromise = null;
  if (exp.participantFlow?.postTaskSurvey && (!devMode || showPostInDev) && POST_TASK_QUESTIONS?.length) {
    configureQuestionScreen({
      title: "Please answer the questions below to see your Treasure Hunt score.",
      subtitle: "",
      buttonText: "See My Score",
    });
    postTaskSurvey = await collectParticipantSurvey(POST_TASK_QUESTIONS, POST_TASK_LIKERT_SCALE);

    if (saving) {
      // Save required post-task responses immediately. Do not swallow failures:
      // production redirect must wait until these required responses are acknowledged.
      postTaskSurveySavePromise = fb.savePostTaskSurvey(sessionId, {
        experimentId: exp.id,
        participantId: participant.participantId,
        completedAt: new Date().toISOString(),
        responses: postTaskSurvey,
      });
    }
  }

  /* Required post-task responses and final completion status must both be
     acknowledged before the participant is given the normal completion flow. */
  if (saving && postTaskSurveySavePromise) {
    ui.showScreen("screen-saving");
    ui.setText("#saving-text", "Saving your final responses...");
    await postTaskSurveySavePromise;
  }

  if (saving) {
    await fb.finalizeSession(sessionId, {
      lastCompletedStage: "post_task_survey_complete",
      lastCompletedBlock: trialSummaries
        .filter((t) => t.kind === "baseline_reaching" && t.blockFinishedNormally === true)
        .at(-1)?.id ?? null,
      completedReachCount: trialSummaries
        .filter((t) => t.kind === "baseline_reaching")
        .reduce((sum, t) => sum + (Number.isFinite(t.completedReaches) ? t.completedReaches : 0), 0),
    });
  }

  /* ---- 8. Score appears only after the post-task survey is safely stored. */
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

  if (exp.participantFlow?.showScore) {
    prepareTreasureDoneScreen(score);
  }
  prepareCompletionCodeUi({ saving, participant, sessionId });

  ui.showScreen("screen-done");

  if (saving && STUDY.completionRedirectUrl) {
    ui.setText("#done-redirect-note", "Returning you to Prolific in 5 seconds...");
    await ui.sleep(5000);
    location.href = STUDY.completionRedirectUrl;
  }
}

async function showCalibrationRetry(hand) {
  const handText = hand ? `${hand.toLowerCase()}-hand ` : "";
  ui.setHtml(
    "#calibration-retry-message",
    `<div class="qa-message-title">We had trouble tracking your ${handText || ""}hand consistently.</div>` +
    `<p class="qa-message-intro">Before trying again, please:</p>` +
    `<ul class="qa-checklist">` +
      `<li><span class="qa-icon" aria-hidden="true">💡</span><span>Use a bright room</span></li>` +
      `<li><span class="qa-icon" aria-hidden="true">✋</span><span>Keep your full hand visible to the camera</span></li>` +
      `<li><span class="qa-icon" aria-hidden="true">💻</span><span>Close unnecessary programs and browser tabs</span></li>` +
    `</ul>` +
    `<p class="qa-message-outro">Then try the calibration again.</p>`
  );
  ui.showScreen("screen-calibration-retry");
  await ui.waitForClick("#btn-calibration-retry");
}

function showTechnicalStop(termination) {
  const isPreflight = termination?.status === "technical_preflight_failure";
  const message = isPreflight
    ? `<div class="qa-message-title">We can't get stable enough hand tracking on this setup right now, so we need to stop here.</div>` +
      `<p class="qa-message-outro">This can happen because of the camera, lighting, or device performance.</p>`
    : `<div class="qa-message-title">Hand tracking became too unstable to continue the study reliably, so we need to stop here.</div>`;
  ui.setHtml("#technical-stop-message", message);
  ui.showScreen("screen-technical-stop");
}

function configureQuestionScreen({ title, subtitle, buttonText }) {
  const screen = ui.$("#screen-demographics");
  if (!screen) return;
  const h2 = screen.querySelector("h2");

  /* V5.18.1: keep the final questionnaire visually connected to the
     Treasure Hunt without adding extra explanatory copy. */
  let treasureIcon = screen.querySelector("#v518-final-question-chest");
  const isFinalSurvey = buttonText === "See My Score";
  if (!treasureIcon) {
    treasureIcon = document.createElement("div");
    treasureIcon.id = "v518-final-question-chest";
    treasureIcon.setAttribute("aria-hidden", "true");
    treasureIcon.style.cssText = "display:none;text-align:center;margin:0 auto 10px;";
    treasureIcon.innerHTML = `
      <svg width="66" height="58" viewBox="0 0 116 100" aria-hidden="true">
        <path d="M24 48h68v35H24z" fill="#7e421d" stroke="#f0c56c" stroke-width="3"/>
        <path d="M24 48c4-21 16-31 34-31s30 10 34 31H24Z" fill="#bd7130" stroke="#f0c56c" stroke-width="3"/>
        <path d="M42 20v63M74 20v63" stroke="#e8bd62" stroke-width="4"/>
        <rect x="51" y="55" width="14" height="14" rx="3" fill="#ffe69b"/>
      </svg>`;
    if (h2) h2.before(treasureIcon);
    else screen.prepend(treasureIcon);
  }
  treasureIcon.style.display = isFinalSurvey ? "block" : "none";

  /* Hide any legacy static note such as "The rest are optional"; the
     current questionnaire itself controls required fields. */
  screen.querySelectorAll(":scope > p.subtle").forEach((p) => {
    if (p.id !== "v516-question-note") p.hidden = true;
  });

  if (h2) {
    h2.textContent = title;
    h2.style.maxWidth = "820px";
    h2.style.marginLeft = "auto";
    h2.style.marginRight = "auto";
    h2.style.fontSize = "clamp(1.7rem, 3.8vw, 2.6rem)";
    h2.style.lineHeight = "1.12";
  }

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

async function collectParticipantSurvey(questions, likertScale = {}) {
  const formEl = ui.$("#demographics-form");
  const button = ui.$("#btn-demographics");
  ensureParticipantSurveyStyles();
  formEl.innerHTML = "";
  formEl.classList.add("v5151-final-survey");

  let currentSection = null;
  let sectionBody = null;

  for (const q of questions) {
    if (q.section !== currentSection) {
      currentSection = q.section || "Questions";
      const section = document.createElement("section");
      section.className = "v5151-survey-section";
      section.innerHTML = `<h3>${escapeHtml(currentSection)}</h3><div class="v5151-section-body"></div>`;
      formEl.appendChild(section);
      sectionBody = section.querySelector(".v5151-section-body");
    }
    sectionBody.appendChild(buildParticipantSurveyQuestion(q, likertScale));
  }

  const distractionSelect = formEl.querySelector('[name="distracted"]');
  const distractionWrap = formEl.querySelector('[data-question-id="distractionDescription"]');
  const syncDistraction = () => {
    if (!distractionWrap || !distractionSelect) return;
    const show = distractionSelect.value === "Yes" || distractionSelect.value === "Not sure";
    distractionWrap.hidden = !show;
    const inputs = distractionWrap.querySelectorAll("textarea,input,select");
    if (!show) {
      inputs.forEach((input) => {
        if (input.type === "checkbox" || input.type === "radio") input.checked = false;
        else input.value = "";
      });
    }
  };
  distractionSelect?.addEventListener("change", syncDistraction);
  syncDistraction();

  ui.showScreen("screen-demographics");

  while (true) {
    await ui.waitForClick("#btn-demographics");
    const result = readParticipantSurvey(formEl, questions);
    clearSurveyErrors(formEl);
    if (result.ok) {
      formEl.classList.remove("v5151-final-survey");
      return result.values;
    }

    const first = formEl.querySelector(`[data-question-id="${cssEscape(result.firstError)}"]`);
    if (first) {
      first.classList.add("v5151-has-error");
      first.scrollIntoView({ behavior: "smooth", block: "center" });
      first.querySelector("input,select,textarea")?.focus({ preventScroll: true });
    }
  }
}

function buildParticipantSurveyQuestion(q, likertScale) {
  const wrap = document.createElement("div");
  wrap.className = `v5151-survey-question ${q.type === "likert" ? "v5151-likert-question" : ""}`;
  wrap.dataset.questionId = q.id;

  const label = document.createElement("div");
  label.className = "v5151-question-label";
  label.innerHTML = `${escapeHtml(q.label)}${q.required ? ' <span class="v5151-required">*</span>' : ""}`;
  wrap.appendChild(label);

  if (q.help) {
    const help = document.createElement("div");
    help.className = "v5151-question-help";
    help.textContent = q.help;
    wrap.appendChild(help);
  }

  if (q.type === "likert") {
    const scale = document.createElement("div");
    scale.className = "v5151-likert-scale";
    for (let value = 1; value <= 5; value++) {
      const option = document.createElement("label");
      option.className = "v5151-likert-option";
      option.innerHTML = `
        <input type="radio" name="${escapeHtml(q.id)}" value="${value}">
        <span class="v5151-likert-number">${value}</span>
        <span class="v5151-likert-text">${escapeHtml(likertScale[value] || "")}</span>`;
      scale.appendChild(option);
    }
    wrap.appendChild(scale);
  } else if (q.type === "checkboxes") {
    const choices = document.createElement("div");
    choices.className = "v5151-checkbox-grid";
    for (const opt of (q.options || [])) {
      const option = document.createElement("label");
      option.className = "v5151-checkbox-option";
      option.innerHTML = `
        <input type="checkbox" name="${escapeHtml(q.id)}" value="${escapeHtml(opt)}">
        <span>${escapeHtml(opt)}</span>`;
      choices.appendChild(option);
    }
    wrap.appendChild(choices);
  } else if (q.type === "select") {
    const select = document.createElement("select");
    select.name = q.id;
    select.innerHTML = `<option value="">Select an option</option>` +
      (q.options || []).map((opt) => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join("");
    wrap.appendChild(select);
  } else if (q.type === "number") {
    const input = document.createElement("input");
    input.type = "number";
    input.name = q.id;
    if (Number.isFinite(q.min)) input.min = String(q.min);
    if (Number.isFinite(q.max)) input.max = String(q.max);
    if (q.placeholder) input.placeholder = q.placeholder;
    input.step = "any";
    wrap.appendChild(input);
  } else if (q.type === "textarea") {
    const textarea = document.createElement("textarea");
    textarea.name = q.id;
    textarea.rows = 3;
    if (q.placeholder) textarea.placeholder = q.placeholder;
    wrap.appendChild(textarea);
  } else {
    const input = document.createElement("input");
    input.type = "text";
    input.name = q.id;
    if (q.placeholder) input.placeholder = q.placeholder;
    wrap.appendChild(input);
  }

  const error = document.createElement("div");
  error.className = "v5151-question-error";
  error.textContent = "Please answer this question.";
  wrap.appendChild(error);
  return wrap;
}

function readParticipantSurvey(formEl, questions) {
  const values = {};
  let firstError = null;

  for (const q of questions) {
    const wrap = formEl.querySelector(`[data-question-id="${cssEscape(q.id)}"]`);
    if (!wrap || wrap.hidden) {
      values[q.id] = "";
      continue;
    }

    let value = "";
    if (q.type === "likert") {
      const checked = wrap.querySelector(`input[name="${cssEscape(q.id)}"]:checked`);
      value = checked ? Number(checked.value) : "";
    } else if (q.type === "checkboxes") {
      value = Array.from(
        wrap.querySelectorAll(`input[name="${cssEscape(q.id)}"]:checked`)
      ).map((el) => el.value);
    } else {
      const field = wrap.querySelector(`[name="${cssEscape(q.id)}"]`);
      value = field?.value?.trim?.() ?? "";
      if (q.type === "number" && value !== "") value = Number(value);
    }

    values[q.id] = value;

    const missing = q.required && (value === "" || value == null || (Array.isArray(value) && value.length === 0));
    const outOfRange = q.type === "number" && value !== "" && (
      (Number.isFinite(q.min) && value < q.min) ||
      (Number.isFinite(q.max) && value > q.max)
    );

    if ((missing || outOfRange) && firstError == null) firstError = q.id;
  }

  return { ok: firstError == null, values, firstError };
}

function clearSurveyErrors(formEl) {
  formEl.querySelectorAll(".v5151-has-error").forEach((el) => el.classList.remove("v5151-has-error"));
}

function ensureParticipantSurveyStyles() {
  if (document.getElementById("v5151-final-survey-style")) return;
  const style = document.createElement("style");
  style.id = "v5151-final-survey-style";
  style.textContent = `
    body:has(#screen-demographics.visible) main { max-width:920px; }
    #screen-demographics > h2 { margin-bottom:4px; }
    #v515-question-note:not([hidden]) { max-width:720px;margin:4px auto 18px;text-align:center;color:#aebed2; }
    .v5151-final-survey { display:grid;gap:16px;margin-top:18px; }
    .v5151-survey-section {
      padding:18px 20px 20px;border-radius:20px;
      background:rgba(14,31,60,.72);border:1px solid rgba(151,196,255,.14);
      box-shadow:0 12px 30px rgba(0,0,0,.12);
    }
    .v5151-survey-section h3 {
      margin:0 0 13px;color:#f2f7ff;font:850 1.18rem/1.2 system-ui,sans-serif;
      letter-spacing:.01em;
    }
    .v5151-section-body { display:grid;gap:13px; }
    .v5151-survey-question {
      padding:13px 14px;border-radius:14px;background:rgba(255,255,255,.035);
      border:1px solid rgba(190,217,255,.08);
    }
    .v5151-question-label { color:#edf4ff;font-weight:730;line-height:1.38; }
    .v5151-question-help { margin:5px 0 8px;color:#aebed2;font-size:.9rem;line-height:1.4; }
    .v5151-required { color:#ffcf77; }
    .v5151-survey-question select,
    .v5151-survey-question input[type="text"],
    .v5151-survey-question input[type="number"],
    .v5151-survey-question textarea {
      width:100%;box-sizing:border-box;margin-top:9px;padding:10px 12px;border-radius:11px;
      border:1px solid rgba(173,205,246,.22);background:#0b1a35;color:#f4f8ff;
      font:600 .96rem/1.3 system-ui,sans-serif;
    }
    .v5151-survey-question textarea { resize:vertical;min-height:78px; }
    .v5151-checkbox-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px; }
    .v5151-checkbox-option {
      display:flex;align-items:flex-start;gap:9px;padding:10px 11px;border-radius:12px;
      background:rgba(255,255,255,.035);border:1px solid rgba(188,215,255,.11);
      cursor:pointer;line-height:1.25;
    }
    .v5151-checkbox-option:has(input:checked) {
      background:rgba(111,164,255,.12);border-color:rgba(143,190,255,.36);
    }
    .v5151-checkbox-option input { margin-top:2px;accent-color:#8fb8ff; }
    .v5151-likert-scale { display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin-top:10px; }
    .v5151-likert-option {
      min-height:78px;padding:9px 5px 8px;border-radius:11px;cursor:pointer;
      display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:5px;
      background:rgba(255,255,255,.035);border:1px solid rgba(173,205,246,.12);
      color:#c9d8ec;text-align:center;
    }
    .v5151-likert-option:has(input:checked) {
      background:rgba(94,146,233,.18);border-color:rgba(139,185,255,.58);
      box-shadow:0 0 0 1px rgba(139,185,255,.16) inset;
    }
    .v5151-likert-option input { margin:0;accent-color:#8fb8ff; }
    .v5151-likert-number { font-weight:900;color:#f0f6ff; }
    .v5151-likert-text { font-size:.72rem;line-height:1.18; }
    .v5151-question-error { display:none;margin-top:7px;color:#ffb5ad;font-size:.85rem;font-weight:700; }
    .v5151-has-error { border-color:rgba(255,142,130,.60); }
    .v5151-has-error .v5151-question-error { display:block; }
    @media (max-width:720px) {
      .v5151-survey-section { padding:15px 12px; }
      .v5151-checkbox-grid { grid-template-columns:1fr; }
      .v5151-likert-scale { grid-template-columns:1fr; }
      .v5151-likert-option { min-height:0;flex-direction:row;justify-content:flex-start;text-align:left;padding:9px 10px; }
      .v5151-likert-text { font-size:.86rem; }
    }
  `;
  document.head.appendChild(style);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
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
  button.textContent = "Press Enter to start";

  const MIN_READ_MS = 8000;
  const OPEN_HAND_ARM_MS = 1000;
  const FIST_HOLD_MS = 1200;
  const shownAt = performance.now();

  let done = false;
  const onClick = () => { done = true; };
  const onKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      done = true;
    }
  };
  button.addEventListener("click", onClick);
  window.addEventListener("keydown", onKeyDown);

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
    window.removeEventListener("keydown", onKeyDown);
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
  const tasks = [];
  const criticalTasks = [];
  let checkpointChain = Promise.resolve();
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

    // Start this block's upload immediately instead of waiting for all earlier
    // blocks to receive network acknowledgements. This keeps a single slow
    // Firestore write from creating a long serialized backlog by the end.
    let lastDone = 0;
    const chunkTask = fb.uploadTrialChunks(
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
    ).then(() => {
      // Empty-chunk edge case still counts as one chunk unit.
      if (chunks.length === 0) {
        completedUnits += 1;
        updateSavingProgress(progress());
      }
    });

    const summaryTask = fb.saveTrialSummary(sessionId, trialIndex, summary).then(() => {
      completedUnits += 1;
      updateSavingProgress(progress());
    });
    criticalTasks.push(summaryTask);

    const task = Promise.all([chunkTask, summaryTask]).catch((err) => {
      firstError ??= err;
    });
    tasks.push(task);
  };

  const queueCheckpoint = (payload) => {
    if (!saving) return;
    checkpointChain = checkpointChain
      .catch(() => {})
      .then(() => fb.saveSessionCheckpoint(sessionId, payload));
    const guarded = checkpointChain.catch((err) => {
      firstError ??= err;
    });
    criticalTasks.push(guarded);
    tasks.push(guarded);
  };

  return {
    queueTrial,
    queueCheckpoint,
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
      await Promise.all(tasks);
      if (firstError) throw new Error(`A background upload failed: ${firstError.message || firstError}`);
    },
    async flushCritical() {
      await Promise.all(criticalTasks);
      if (firstError) throw new Error(`A critical background upload failed: ${firstError.message || firstError}`);
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
    if (r.angularHit === 1) return true;
    if (r.endpointInsideTarget === 1) return true;
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
  const percent = total > 0 ? Math.round(100 * hits / total) : 0;
  return `
    <div class="v5151-treasure-result">
      <div class="v5151-result-sparkles" aria-hidden="true">
        <span>✦</span><span>✧</span><span>✦</span><span>✧</span>
      </div>
      <svg class="v5151-result-chest" viewBox="0 0 220 150" aria-hidden="true">
        <defs>
          <linearGradient id="v5151ResultChestBody" x1="0" y1="0" x2="1" y2="1">
            <stop stop-color="#c97830"/><stop offset=".58" stop-color="#8b4922"/><stop offset="1" stop-color="#4d2918"/>
          </linearGradient>
          <linearGradient id="v5151ResultChestLid" x1="0" y1="0" x2="0" y2="1">
            <stop stop-color="#e8a34f"/><stop offset="1" stop-color="#7b3d1e"/>
          </linearGradient>
          <linearGradient id="v5151ResultGem" x1="0" y1="0" x2="1" y2="1">
            <stop stop-color="#eef8ff"/><stop offset=".45" stop-color="#77b4ff"/><stop offset="1" stop-color="#5a4ac8"/>
          </linearGradient>
        </defs>
        <g class="v5151-open-lid">
          <path d="M51 69 Q63 24 110 24 Q157 24 169 69 Z" fill="url(#v5151ResultChestLid)" stroke="#efc56b" stroke-width="5"/>
          <path d="M76 36V70M144 36V70" stroke="#e8bd62" stroke-width="6"/>
        </g>
        <g class="v5151-gem-pop">
          <path d="M91 61 L110 45 L129 61 L122 89 L98 89 Z" fill="url(#v5151ResultGem)" stroke="#f4f9ff" stroke-width="4"/>
        </g>
        <rect x="45" y="72" width="130" height="60" rx="10" fill="url(#v5151ResultChestBody)" stroke="#efc56b" stroke-width="5"/>
        <path d="M75 73V132M145 73V132" stroke="#e8bd62" stroke-width="6"/>
        <rect x="99" y="90" width="22" height="20" rx="4" fill="#ffe49a" stroke="#9c6824" stroke-width="3"/>
      </svg>
      <div class="v5151-result-kicker">YOUR TREASURE HAUL</div>
      <div class="v5151-result-score">${percent}%</div>
      <div class="v5151-result-message">You collected ${hits} of ${total} gems!</div>
    </div>`;
}


function prepareCompletionCodeUi({ saving, participant, sessionId }) {
  const screen = ui.$("#screen-done");
  if (!screen) return;

  const savedLine = ui.$("#done-saved-line");
  if (savedLine) savedLine.hidden = true;

  let box = document.getElementById("v518-prolific-code");
  if (!box) {
    box = document.createElement("div");
    box.id = "v518-prolific-code";
    box.style.cssText = "max-width:560px;margin:12px auto 6px;padding:12px 16px;border-radius:14px;background:rgba(255,255,255,.055);border:1px solid rgba(188,215,255,.13);font-weight:720;";
    const redirectNote = ui.$("#done-redirect-note");
    if (redirectNote) redirectNote.before(box);
    else screen.appendChild(box);
  }

  if (!saving) {
    box.textContent = `Development session: ${sessionId}`;
    return;
  }

  const code = prolificCompletionCode();
  if (code) {
    box.innerHTML = `Prolific completion code: <strong style="font-size:1.18em;letter-spacing:.04em;">${escapeHtml(code)}</strong>`;
  } else if (participant?.prolific?.pid || participant?.source === "prolific") {
    box.textContent = "Your responses have been saved. You will be returned to Prolific.";
  } else {
    box.textContent = "Your responses have been saved.";
  }
}

function prepareTreasureDoneScreen(score) {
  ensureTreasureDoneStyles();
  const screen = ui.$("#screen-done");
  const title = screen?.querySelector("h2");
  if (title) title.textContent = "TREASURE HUNT COMPLETE!";

  const subtle = screen?.querySelector("p.subtle");
  if (subtle && /session|saved|complete|done/i.test(subtle.textContent || "")) {
    subtle.textContent = "Thanks for playing!";
  }
}

function ensureTreasureDoneStyles() {
  if (document.getElementById("v5151-treasure-done-style")) return;
  const style = document.createElement("style");
  style.id = "v5151-treasure-done-style";
  style.textContent = `
    body:has(#screen-done.visible) main { max-width:760px; }
    #screen-done { text-align:center; }
    #screen-done > h2 { font-size:clamp(2rem,5vw,3rem);margin-bottom:5px;letter-spacing:.015em; }
    .v5151-treasure-result {
      position:relative;overflow:hidden;max-width:560px;margin:16px auto 18px;padding:24px 24px 26px;
      border-radius:26px;background:radial-gradient(circle at 50% 20%,#1b3b72 0,#0d1f43 48%,#08152e 100%);
      border:1px solid rgba(151,196,255,.16);box-shadow:0 22px 60px rgba(0,0,0,.28);
    }
    .v5151-result-chest { width:min(230px,56vw);height:auto;filter:drop-shadow(0 14px 20px rgba(0,0,0,.28)); }
    .v5151-open-lid { transform-origin:110px 69px;animation:v5151LidOpen .75s cubic-bezier(.2,.8,.2,1) both; }
    .v5151-gem-pop { transform-origin:110px 75px;animation:v5151GemPop 1.4s .35s ease-out both; }
    .v5151-result-kicker { margin-top:2px;color:#a9c7ef;font-weight:850;letter-spacing:.08em;font-size:.86rem; }
    .v5151-result-score { margin:4px 0 1px;color:#f7fbff;font:950 clamp(2.7rem,7vw,4rem)/1 system-ui,sans-serif; }
    .v5151-result-score span { font-size:.38em;color:#9fb8d8;font-weight:750;vertical-align:middle; }
    .v5151-result-message { margin-top:7px;color:#dceaff;font-weight:780;font-size:1.08rem; }
    .v5151-result-sparkles span { position:absolute;color:#dceeff;text-shadow:0 0 12px rgba(143,190,255,.9);animation:v5151Sparkle 1.8s ease-in-out infinite; }
    .v5151-result-sparkles span:nth-child(1){left:17%;top:21%;font-size:1.4rem}
    .v5151-result-sparkles span:nth-child(2){right:18%;top:26%;font-size:1.1rem;animation-delay:.35s}
    .v5151-result-sparkles span:nth-child(3){left:26%;top:43%;font-size:.9rem;animation-delay:.7s}
    .v5151-result-sparkles span:nth-child(4){right:26%;top:45%;font-size:1rem;animation-delay:1s}
    @keyframes v5151LidOpen { from{transform:translateY(20px) rotate(0deg);opacity:.7} to{transform:translateY(0) rotate(0deg);opacity:1} }
    @keyframes v5151GemPop { 0%{transform:translateY(28px) scale(.55);opacity:0} 55%{transform:translateY(-10px) scale(1.12);opacity:1} 100%{transform:translateY(0) scale(1);opacity:1} }
    @keyframes v5151Sparkle { 0%,100%{opacity:.25;transform:scale(.85)} 50%{opacity:1;transform:scale(1.2)} }
  `;
  document.head.appendChild(style);
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

