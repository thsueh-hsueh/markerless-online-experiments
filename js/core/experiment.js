/* experiment.js: the runner.
 *
 * You should not need to change this file to build a new experiment. It takes
 * an experiment definition (see experiments/_template.js) and walks the
 * participant through: consent -> camera -> instructions -> trials -> upload.
 *
 * THE FRAME LOOP, in one paragraph:
 * Every time the browser paints (~60x per second), we check whether the webcam
 * has produced a new picture. If it has, we send it to MediaPipe, get back the
 * hand landmarks, hand them to your experiment's onFrame(), store the frame,
 * and let your draw() paint the overlay. Frames where no hand was visible are
 * still stored, as nulls, so gaps in your data stay visible instead of silently
 * disappearing. */

import { STUDY, CONSENT, RECORDING, ACTIVE_EXPERIMENT } from "../../config.js";
import { DEMOGRAPHIC_QUESTIONS } from "../../questions.js";
import { renderForm, readForm, focusField } from "./form.js";
import { startCamera, stopCamera } from "./camera.js";
import { createTracker } from "./tracker.js";
import { Recorder } from "./recorder.js?v=3";
import { FEEDBACK_QUESTIONS, FEEDBACK_SCALE, FEEDBACK_QUESTIONNAIRE_VERSION } from "../../feedback-questions.js?v=1";
import * as fb from "./firebase.js?v=3";
import { getParticipant, getEnvironment, requestedExperiment } from "./participant.js";
import * as ui from "./ui.js";

export async function main() {
  const name = requestedExperiment(ACTIVE_EXPERIMENT);

  let exp;
  try {
exp = (await import(`../../experiments/${name}.js?v=10`)).default;
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

  // ---------------------------------------------------------
  // LOCAL DEVELOPMENT MODE
  // Use ?dev=1 to skip consent + demographics on localhost.
  // This cannot be activated on a public study URL.
  // ---------------------------------------------------------
  const params = new URLSearchParams(window.location.search);

  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  const devMode =
    isLocalhost &&
    params.get("dev") === "1";

  if (devMode) {
    console.warn(
      "LOCAL DEVELOPMENT MODE: consent and demographics are skipped."
    );
  }

  // Flag demo mode up front, before the consent screen: someone should know
  // that nothing is being recorded *before* they agree to anything.
  if (fb.configLooksUnfilled()) {
    ui.$("#demo-banner").hidden = false;
    console.warn(
      "Demo mode: Firebase is not configured, so nothing will be saved. " +
      "Fill in FIREBASE in config.js to collect data (see docs/SETUP.md)."
    );
  }

  /* ---- 1. Consent -------------------------------------------------------
   * The consent document comes first, before anything else happens and before
   * the camera is touched. Each statement in CONSENT.affirmations has to be
   * ticked, and which ones were agreed to is stored with the session. */
  let consentRecord;

if (devMode) {

  consentRecord = {
    document: CONSENT.pdf ?? null,
    agreedTo: [],
    agreedAt: null,
    developmentBypass: true,
  };

} else {

  ui.setText("#study-title", STUDY.title);
  ui.setText("#study-lab", STUDY.labName);
  ui.setHtml("#consent-intro", STUDY.consentIntroHtml ?? "");
  ui.setText("#experiment-title", exp.title);

  if (CONSENT.pdf) {
    ui.$("#consent-doc").src = CONSENT.pdf;
    ui.$("#consent-download").href = CONSENT.pdf;
  } else {
    ui.$("#consent-doc-wrap").hidden = true;
  }

  const agreed =
    await collectConsent(CONSENT.affirmations ?? []);

  consentRecord = {
    document: CONSENT.pdf ?? null,
    agreedTo: agreed,
    agreedAt: new Date().toISOString(),
    developmentBypass: false,
  };

}

  /* ---- 2. Demographics ---------------------------------------------------
   * Built from questions.js. Edit that file to change what is asked. */
  let demographics = {};
 if (!devMode && DEMOGRAPHIC_QUESTIONS.length) {
    const formEl = ui.$("#demographics-form");
    // If they came from Prolific, fill their ID in rather than asking twice.
    renderForm(formEl, DEMOGRAPHIC_QUESTIONS,
               participant.participantId ? { participantId: participant.participantId } : {});
    ui.showScreen("screen-demographics");

    while (true) {
      await ui.waitForClick("#btn-demographics");
      const { ok, values, firstError } = readForm(formEl, DEMOGRAPHIC_QUESTIONS);
      if (ok) { demographics = values; break; }
      focusField(formEl, firstError);
    }
  }

  // A question with id "participantId" doubles as the participant's ID.
  if (!participant.participantId) {
    participant.participantId = demographics.participantId
      || `anon_${Math.random().toString(36).slice(2, 8)}`;
  }

  /* ---- 2. Firebase (optional) ------------------------------------------ */
  // If config.js has not been filled in, the study still runs, it just does
  // not save. That keeps the live demo usable by anyone who clicks the link.
  ui.showScreen("screen-loading");
  ui.setText("#loading-text", "Connecting...");
 const { enabled: firebaseEnabled } =
  await fb.initFirebase();

const saving =
  firebaseEnabled && !devMode;

if (devMode && firebaseEnabled) {
  console.warn(
    "Development mode: Firebase upload disabled."
  );
}
  const sessionId = fb.newSessionId();

  /* ---- 3. Camera + tracker --------------------------------------------- */
  ui.setText("#loading-text", "Starting your camera...");
  const video = await startCamera(RECORDING.video);

  ui.setText("#loading-text", "Loading the hand tracking model (a few MB, first visit only)...");
  const tracker = await createTracker(exp.tracker ?? "hand", exp.trackerOptions ?? {});
  if (tracker.delegate === "CPU") {
    ui.$("#cpu-banner").hidden = false;
  }

  const stage = ui.$("#stage");
  const canvas = ui.$("#overlay");
  stage.querySelector(".mirror").prepend(video);
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  stage.hidden = false;

  /* ---- 4. Positioning check -------------------------------------------- */
  // A live preview with the landmarks drawn on top. Participants fix their own
  // lighting and framing here, which is far more effective than instructions.
  ui.showScreen("screen-position");
  await positioningLoop(video, tracker, ctx, canvas, stage);

  /* ---- 5. Instructions -------------------------------------------------- */
  ui.setHtml("#instructions-text", exp.instructions ?? "");
  ui.showScreen("screen-instructions");
  await ui.waitForClick("#btn-start");

  /* ---- Optional comprehension check ------------------------------ */

let comprehensionRecord = null;

if (
  exp.comprehension?.questions?.length
) {

  const questions =
    exp.comprehension.questions;

  const correctAnswers =
    exp.comprehension.answers ?? {};


  let attempts = 0;

  const attemptRecords = [];

  let firstAttemptCorrect =
    null;


  while (true) {

    attempts += 1;


    const formEl =
      ui.$("#comprehension-form");


    /*
     * Start each attempt with a fresh form.
     */
    renderForm(
      formEl,
      questions
    );


    ui.setText(
      "#comprehension-feedback",
      ""
    );


    ui.showScreen(
      "screen-comprehension"
    );


    /*
     * Require every question to be answered.
     */
    let values;


    while (true) {

      await ui.waitForClick(
        "#btn-comprehension"
      );


      const result =
        readForm(
          formEl,
          questions
        );


      if (result.ok) {

        values =
          result.values;

        break;

      }


      focusField(
        formEl,
        result.firstError
      );

    }


    /*
     * Score each question.
     */
    const items =
      questions.map(
        q => ({

          id:
            q.id,

          response:
            values[q.id],

          correctAnswer:
            correctAnswers[q.id],

          correct:
            values[q.id] ===
            correctAnswers[q.id],

        })
      );


    const correctCount =
      items.filter(
        item => item.correct
      ).length;


    const passed =
      correctCount ===
      questions.length;


    if (
      attempts === 1
    ) {

      firstAttemptCorrect =
        correctCount;

    }


    attemptRecords.push({

      attempt:
        attempts,

      correctCount,

      total:
        questions.length,

      passed,

      items,

    });


    /*
     * Perfect score:
     * participant may start the experiment.
     */
    if (passed) {

      ui.setText(
        "#comprehension-feedback",
        "Correct."
      );


      comprehensionRecord = {

        passed:
          true,

        attempts,

        firstAttemptCorrect,

        totalQuestions:
          questions.length,

        attemptRecords,

      };


      break;

    }


    /*
     * Incorrect:
     * send participant back to the mapping instructions.
     */
    ui.setText(
      "#comprehension-feedback",
      `You answered ${correctCount} of ${questions.length} correctly. Please review the control rule and try again.`
    );


    await ui.sleep(1500);


    ui.setHtml(
      "#instructions-text",
      exp.instructions ?? ""
    );


    ui.showScreen(
      "screen-instructions"
    );


    await ui.waitForClick(
      "#btn-start"
    );

  }

}

  /* ---- 6. Trials -------------------------------------------------------- */
  const trials = typeof exp.trials === "function" ? exp.trials() : exp.trials;
  const recorder = new Recorder();
  const trialSummaries = [];
  const demoFrames = [];    // only used when nothing is being uploaded

  for (let i = 0; i < trials.length; i++) {
    const trial = trials[i];
    const state = exp.onTrialStart?.(trial, { tracker }) ?? {};
  
    // Show webcam during setup/calibration,
  // but allow task trials to hide the participant's hand.
  video.style.opacity =
    trial.showCamera === false
      ? "0"
      : "1";

    ui.showScreen("screen-trial");
    ui.setProgress(i + 1, trials.length);
    ui.setHtml("#trial-prompt", trial.prompt ?? exp.trialPrompt ?? "");
    ui.setHtml("#live-readout", "");

    await ui.countdown(trial.countdownSec ?? 3);

    recorder.reset();
    await recordTrial({ video, tracker, ctx, canvas, exp, trial, state, recorder });

    const summary = exp.onTrialEnd?.({
      frames: recorder.frames, events: recorder.events, trial, state,
    }) ?? {};

    trialSummaries.push({
      index: i,
      id: trial.id ?? `trial_${i}`,
      ...trial,
      frameCount: recorder.frames.length,
      detectionRate: round(recorder.detectionRate(), 4),
      events: recorder.events,
      ...summary,
    });

    const currentTrialSummary = trialSummaries[trialSummaries.length - 1];

    if (saving) {
      /* Upload straight away, so someone who quits mid-study still leaves data. */
      ui.showScreen("screen-saving");
      const chunks = recorder.toChunks();
      await fb.uploadTrialChunks(
        sessionId, i, chunks,
        { experimentId: exp.id, trialId: trial.id ?? `trial_${i}` },
        (done, total) => ui.setText("#saving-text", `Saving... ${done}/${total}`)
      );

      /* Store detailed events/reach records in a separate per-trial document.
         This prevents long experiments from exceeding Firestore's 1 MiB
         single-document limit at the final session write. */
      await fb.saveTrialSummary(sessionId, i, currentTrialSummary);
    } else {
      // Nowhere to upload to, so hold onto the frames and offer them as a
      // download at the end. The file matches what fetch_data.py produces, so
      // it can go straight into the Python analysis.
      demoFrames[i] = recorder.frames.slice();
    }

    if (i < trials.length - 1) {
      ui.showScreen("screen-rest");
      ui.setText("#rest-progress", `${i + 1} of ${trials.length} done`);
      await ui.waitForClick("#btn-next-trial");
    }
  }

  /* ---- 7. Post-experiment feedback --------------------------------------- */
  const feedbackRecord = await collectExperimentFeedback();

  /* ---- 8. Session summary ----------------------------------------------- */
  if (saving) {
    ui.showScreen("screen-saving");
    ui.setText("#saving-text", "Saving your results...");
  }

  /* Keep the parent session document intentionally small. Detailed arrays such
     as `events` and `reaches` are already saved per trial in the
     `trialSummaries` subcollection above. */
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
    feedback: feedbackRecord,
    trials: compactTrialSummaries,
    trialSummaryStorage: "trialSummaries_subcollection",
    settings: { recording: RECORDING, trackerOptions: exp.trackerOptions ?? {} },
    environment: {
      ...getEnvironment(),
      // "GPU" or "CPU". CPU machines run at a lower frame rate, which is worth
      // knowing before you wonder why one participant's data looks coarse.
      trackerDelegate: tracker.delegate,
      trackerErrors: tracker.errorCount,
    },
    runnerBuild: "firestore-v4-feedback-20260903",
    schemaVersion: 4,
};

  /* IMPORTANT: dev=1 intentionally disables Firebase uploads. Do not call
     saveSession in development mode, otherwise the runner would still attempt
     a final Firestore write even though per-trial chunks were never uploaded. */
  if (saving) {
    await fb.saveSession(sessionId, sessionDoc);
  }

  if (saving && RECORDING.alsoDownloadLocally) {
    ui.downloadJson(`${sessionId}.json`, sessionDoc);
  }

  /* ---- 8. Done ----------------------------------------------------------- */
  stopCamera(video);
  tracker.close();
  stage.hidden = true;

  // Show people what they just did. In demo mode this IS the point of the page.
  ui.setHtml("#done-results", resultsTable(exp, trialSummaries));

  if (saving) {
    ui.setText("#done-session-id", sessionId);
  } else {
    ui.$("#done-saved-line").hidden = true;
    ui.$("#done-demo").hidden = false;
    ui.$("#btn-download-demo").onclick = () => {
      const copy = structuredClone(sessionDoc);
      copy.trials.forEach((t, i) => { t.frames = demoFrames[i] ?? []; });
      ui.downloadJson(`${sessionId}.json`, copy);
    };
  }
  ui.showScreen("screen-done");

  if (saving && STUDY.completionRedirectUrl) {
    ui.setText("#done-redirect-note", "Returning you to Prolific in 5 seconds...");
    await ui.sleep(5000);
    location.href = STUDY.completionRedirectUrl;
  }
}


/* -------------------------------------------------------------------------
 * Post-experiment feedback questionnaire.
 * Likert responses are required; the two text boxes are optional.
 * This is intentionally stored in the small parent session document.
 * ---------------------------------------------------------------------- */
function ensureFeedbackStyles() {
  if (document.getElementById("feedback-questionnaire-styles")) return;

  const style = document.createElement("style");
  style.id = "feedback-questionnaire-styles";
  style.textContent = `
    body:has(#screen-feedback.visible) main {
      max-width: 1040px;
    }

    #screen-feedback {
      text-align: left;
      padding-bottom: 42px;
    }

    #screen-feedback .feedback-header {
      text-align: center;
      margin-bottom: 22px;
    }

    #screen-feedback .feedback-header h2 {
      margin-bottom: 8px;
      font-size: clamp(1.9rem, 3vw, 2.45rem);
    }

    #screen-feedback .feedback-intro {
      color: #c7d4e7;
      margin: 0 auto 14px;
      max-width: 760px;
      line-height: 1.45;
    }

    #screen-feedback .feedback-scale-legend {
      max-width: 900px;
      margin: 12px auto 22px;
      padding: 12px 16px;
      border-radius: 14px;
      background: rgba(122, 164, 226, .08);
      border: 1px solid rgba(158, 196, 246, .14);
      color: #dce8f8;
      text-align: center;
      font-size: .93rem;
      line-height: 1.45;
    }

    #feedback-form {
      display: grid;
      gap: 22px;
      max-width: 960px;
      margin: 0 auto;
    }

    .feedback-section {
      display: grid;
      gap: 10px;
    }

    .feedback-section-title {
      margin: 4px 0 2px;
      color: #9fc8ff;
      font-size: .88rem;
      font-weight: 850;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .feedback-row {
      display: grid;
      grid-template-columns: minmax(260px, 1fr) minmax(330px, 430px);
      align-items: center;
      gap: 22px;
      padding: 15px 18px;
      border-radius: 16px;
      background: rgba(15, 31, 58, .72);
      border: 1px solid rgba(158, 196, 246, .12);
    }

    .feedback-row.missing {
      border-color: rgba(255, 138, 138, .85);
      box-shadow: 0 0 0 2px rgba(255, 96, 96, .10);
    }

    .feedback-question {
      color: #eef5ff;
      font-size: 1rem;
      line-height: 1.38;
      font-weight: 650;
    }

    .feedback-required {
      color: #ffb2b2;
      margin-left: 3px;
    }

    .feedback-likert {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 8px;
    }

    .feedback-choice {
      position: relative;
      display: grid;
      place-items: center;
      min-height: 44px;
      border-radius: 12px;
      background: rgba(255,255,255,.045);
      border: 1px solid rgba(182, 210, 246, .18);
      cursor: pointer;
      user-select: none;
      transition: transform .12s ease, background .12s ease, border-color .12s ease;
    }

    .feedback-choice:hover {
      transform: translateY(-1px);
      background: rgba(123, 173, 242, .10);
      border-color: rgba(163, 205, 255, .42);
    }

    .feedback-choice input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .feedback-choice .feedback-number {
      font-weight: 850;
      color: #dbe9fb;
      font-size: 1.04rem;
    }

    .feedback-choice:has(input:checked) {
      background: #3768a8;
      border-color: #9bc9ff;
      box-shadow: 0 0 16px rgba(93, 159, 238, .24);
    }

    .feedback-choice:has(input:checked) .feedback-number {
      color: #ffffff;
    }

    .feedback-end-labels {
      grid-column: 2;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: -5px;
      padding: 0 4px 2px;
      color: #9aabc2;
      font-size: .75rem;
    }

    .feedback-text-row {
      display: grid;
      gap: 9px;
      padding: 16px 18px;
      border-radius: 16px;
      background: rgba(15, 31, 58, .72);
      border: 1px solid rgba(158, 196, 246, .12);
    }

    .feedback-text-row textarea {
      width: 100%;
      min-height: 92px;
      resize: vertical;
      box-sizing: border-box;
      border-radius: 12px;
      border: 1px solid rgba(168, 204, 248, .20);
      background: rgba(4, 14, 30, .72);
      color: #f2f7ff;
      padding: 12px 13px;
      font: 500 1rem/1.4 system-ui, sans-serif;
    }

    #feedback-error {
      min-height: 1.4em;
      margin: 6px 0 0;
      text-align: center;
      color: #ffb4b4;
      font-weight: 700;
    }

    #btn-feedback-submit {
      width: min(360px, 100%);
      margin: 10px auto 0;
      display: block;
      font-size: 1.08rem;
    }

    @media (max-width: 760px) {
      .feedback-row {
        grid-template-columns: 1fr;
        gap: 12px;
      }

      .feedback-end-labels {
        grid-column: 1;
      }
    }
  `;
  document.head.appendChild(style);
}

function renderFeedbackQuestionnaire(container, questions) {
  container.innerHTML = "";
  let currentSection = null;
  let sectionEl = null;

  for (const q of questions) {
    if (q.section !== currentSection) {
      currentSection = q.section;
      sectionEl = document.createElement("section");
      sectionEl.className = "feedback-section";

      const heading = document.createElement("h3");
      heading.className = "feedback-section-title";
      heading.textContent = currentSection;
      sectionEl.appendChild(heading);
      container.appendChild(sectionEl);
    }

    if (q.type === "likert") {
      const row = document.createElement("div");
      row.className = "feedback-row";
      row.dataset.feedbackId = q.id;

      const question = document.createElement("div");
      question.className = "feedback-question";
      question.textContent = q.text;
      if (q.required) {
        const req = document.createElement("span");
        req.className = "feedback-required";
        req.textContent = " *";
        question.appendChild(req);
      }

      const scale = document.createElement("div");
      scale.className = "feedback-likert";

      for (let value = FEEDBACK_SCALE.min; value <= FEEDBACK_SCALE.max; value++) {
        const label = document.createElement("label");
        label.className = "feedback-choice";
        label.title = FEEDBACK_SCALE.labels[value] ?? String(value);

        const input = document.createElement("input");
        input.type = "radio";
        input.name = `feedback-${q.id}`;
        input.value = String(value);

        const num = document.createElement("span");
        num.className = "feedback-number";
        num.textContent = String(value);

        label.append(input, num);
        scale.appendChild(label);
      }

      const endpoints = document.createElement("div");
      endpoints.className = "feedback-end-labels";
      endpoints.innerHTML = "<span>Strongly disagree</span><span>Strongly agree</span>";

      row.append(question, scale, endpoints);
      sectionEl.appendChild(row);
    } else if (q.type === "textarea") {
      const row = document.createElement("div");
      row.className = "feedback-text-row";
      row.dataset.feedbackId = q.id;

      const question = document.createElement("label");
      question.className = "feedback-question";
      question.htmlFor = `feedback-${q.id}`;
      question.textContent = q.text;

      const textarea = document.createElement("textarea");
      textarea.id = `feedback-${q.id}`;
      textarea.placeholder = q.placeholder ?? "Optional";

      row.append(question, textarea);
      sectionEl.appendChild(row);
    }
  }
}

function readFeedbackQuestionnaire(questions) {
  const responses = {};
  const items = [];
  const missing = [];

  for (const q of questions) {
    let response = null;

    if (q.type === "likert") {
      const checked = document.querySelector(`input[name="feedback-${q.id}"]:checked`);
      response = checked ? Number(checked.value) : null;

      const row = document.querySelector(`[data-feedback-id="${q.id}"]`);
      row?.classList.toggle("missing", q.required && response == null);

      if (q.required && response == null) missing.push(q.id);
    } else if (q.type === "textarea") {
      const el = document.getElementById(`feedback-${q.id}`);
      const text = (el?.value ?? "").trim();
      response = text || null;
    }

    responses[q.id] = response;
    items.push({
      id: q.id,
      text: q.text,
      type: q.type,
      response,
    });
  }

  return { responses, items, missing };
}

async function collectExperimentFeedback() {
  const screen = ui.$("#screen-feedback");
  const form = ui.$("#feedback-form");
  const error = ui.$("#feedback-error");

  if (!screen || !form) {
    throw new Error(
      "Feedback screen is missing from index.html. Run patch-index-feedback-v1.ps1."
    );
  }

  ensureFeedbackStyles();
  renderFeedbackQuestionnaire(form, FEEDBACK_QUESTIONS);
  if (error) error.textContent = "";

  ui.showScreen("screen-feedback");

  while (true) {
    await ui.waitForClick("#btn-feedback-submit");
    const result = readFeedbackQuestionnaire(FEEDBACK_QUESTIONS);

    if (result.missing.length === 0) {
      return {
        questionnaireVersion: FEEDBACK_QUESTIONNAIRE_VERSION,
        completedAt: new Date().toISOString(),
        scale: {
          min: FEEDBACK_SCALE.min,
          max: FEEDBACK_SCALE.max,
          labels: FEEDBACK_SCALE.labels,
        },
        responses: result.responses,
        items: result.items,
      };
    }

    if (error) {
      error.textContent = "Please answer all 10 rating questions before continuing.";
    }

    const firstMissing = document.querySelector(
      `[data-feedback-id="${result.missing[0]}"]`
    );
    firstMissing?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
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

      ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks) return;
  const W = canvas.width, H = canvas.height;

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

