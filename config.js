/* =============================================================================
 *  config.js, THE ONLY FILE YOU NEED TO EDIT TO GET STARTED
 * =============================================================================
 *
 *  1. Fill in FIREBASE below (see docs/SETUP.md, takes about 15 minutes).
 *  2. Open check.html to confirm everything works.
 *  3. Open index.html to run the experiment.
 *
 *  The demographic questions live in a separate file, questions.js, because
 *  those are the ones you are most likely to change.
 *
 *  Everything in this file is safe to commit to a public repo. Firebase web
 *  API keys are public identifiers, NOT secrets, your data is protected by
 *  firestore.rules, not by hiding this key. (This surprises people. It is
 *  documented by Google: https://firebase.google.com/docs/projects/api-keys)
 * ===========================================================================*/


/* -----------------------------------------------------------------------------
 * 1. FIREBASE, where your participants' data gets saved
 * ---------------------------------------------------------------------------
 * Paste the config object from the Firebase Console here.
 * Firebase Console -> Project settings -> Your apps -> Web app -> Config
 * ---------------------------------------------------------------------------*/
export const FIREBASE = {
  apiKey:            "AIzaSyB_W97IxQkt1e_wM_2gsnjRIR5PTxsHkcw",
  authDomain:        "markerless-online-experiment.firebaseapp.com",
  projectId:         "markerless-online-experiment",
  storageBucket:     "markerless-online-experiment.firebasestorage.app",
  messagingSenderId: "1036974829550",
  appId:             "1:1036974829550:web:9ed66c7203e3d285e0a8ff",
};


/* -----------------------------------------------------------------------------
 * 2. WHICH EXPERIMENT TO RUN
 * ---------------------------------------------------------------------------
 * The name of a file in experiments/ (without the .js).
 * You can also override this in the URL:  index.html?exp=my-experiment
 * ---------------------------------------------------------------------------*/
export const ACTIVE_EXPERIMENT = "finger-tapping";


/* -----------------------------------------------------------------------------
 * 3. STUDY SETTINGS
 * ---------------------------------------------------------------------------*/
export const STUDY = {
  // Shown on the welcome screen.
  title: "Hand Movement Study",
  labName: "Your Lab Name",
  contactEmail: "you@university.edu",

  // Shown above the consent form as a short lead-in.
  consentIntroHtml: `
    <p>Please read the consent form below before taking part. You can
    <a href="consent/consent-form.pdf" target="_blank" rel="noopener">open it in
    a new tab</a> or download it to keep.</p>`,

  // Where to send participants when they finish. Prolific gives you a URL
  // like https://app.prolific.com/submissions/complete?cc=XXXXXXXX
  // Leave as null to just show a thank-you screen with no redirect.
  completionRedirectUrl: null,

};


/* -----------------------------------------------------------------------------
 * 4. CONSENT
 * ---------------------------------------------------------------------------*/
export const CONSENT = {
  // The consent document participants read. Replace this file with your own
  // approved form, or point this at a different path. Set to null to show only
  // the statements below with no document.
  pdf: "consent/consent-form.pdf",

  // Each of these becomes a checkbox that must be ticked before continuing.
  // These match the statements at the end of the included form. Change them to
  // match yours. Which ones were agreed to is saved with every session.
  affirmations: [
    "I am age 18 or older.",
    "I have read and understand the information above.",
    "I want to participate in this research and continue with the task.",
  ],
};


/* -----------------------------------------------------------------------------
 * 5. RECORDING SETTINGS: most people never need to change these
 * ---------------------------------------------------------------------------*/
export const RECORDING = {
  // Target camera resolution. Lower = faster on weak laptops.
  video: { width: 640, height: 480 },

  // How many frames go into one Firestore document.
  // WHY THIS EXISTS: a Firestore document can hold at most 1 MiB. One frame of
  // hand data is roughly 1.2 KB, so 250 frames is about 300 KB, a safe margin.
  // If you record many more landmarks per frame, lower this number.
  chunkFrames: 250,

  // Decimal places kept for each coordinate. 4 dp is well below the noise
  // floor of the tracker and roughly halves the storage cost.
  decimals: 4,

  // Also hand the participant a JSON copy of their session summary (the same
  // document that goes to Firebase: identity, settings, and the per-trial
  // numbers). The raw frame-by-frame landmarks are NOT included -- those only
  // go to Firebase. Useful while piloting; leave off for real collection.
  alsoDownloadLocally: false,
};


/* -----------------------------------------------------------------------------
 * 6. MEDIAPIPE VERSIONS, pinned on purpose
 * ---------------------------------------------------------------------------
 * Pinned so that your study does not silently change halfway through data
 * collection because Google shipped a new model. Only bump these between
 * studies, and re-run check.html when you do.
 * ---------------------------------------------------------------------------*/
export const MEDIAPIPE = {
  version: "1.0.1",

  // "auto" tries the graphics card and falls back to the CPU if that fails,
  // which is what you want almost always. Force "CPU" if a participant's
  // machine is unstable on the GPU, or "GPU" to refuse to run without it.
  // A URL can override this for one participant:  index.html?delegate=cpu
  delegate: "auto",

  models: {
    hand: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    pose: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  },
};
