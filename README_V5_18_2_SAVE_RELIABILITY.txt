V5.18.2 SAVE RELIABILITY PATCH — 2026-09-11

Observed failure
----------------
After a full 320-trial run, the browser showed:
  Raw data chunk 6.6 could not be saved after 2 attempts:
  Raw data chunk 6.6 timed out after 20 seconds.

Root cause in the uploaded repository
-------------------------------------
js/core/firebase.js imposed a 20-second client-side timeout and then issued a
second setDoc() to the same Firestore document. A Firestore setDoc promise can
legitimately remain pending while connectivity is interrupted; timing out the
JavaScript promise does not cancel the original Firestore write. This made a
slow acknowledgement look like a hard failure and could also produce a
duplicate setDoc against create-only Firestore rules.

Changes in V5.18.2
------------------
1. Each Firestore document is now issued exactly once.
2. Normal acknowledgement window: 60 seconds.
3. If still pending, the SAME Firestore promise gets a 240-second recovery
   window. No duplicate write is issued.
4. Chunk writes within a block, and uploads across completed blocks, are issued
   in the background without serially waiting for every earlier acknowledgement.
   This prevents one slow write from creating a long end-of-study backlog.
5. Required post-task survey upload is now awaited before redirecting to
   Prolific. The old code redirected after at most 1.5 seconds even if the
   survey write was still pending.
6. firestore.rules now explicitly includes the postTaskSurvey/response path.
7. Cache-busting versions were incremented so GitHub Pages browsers receive the
   new firebase.js and experiment.js.
8. runnerBuild is now:
   v5.18.2-angular-slice-save-reliability-20260911

Intentionally NOT changed
-------------------------
- V5.18.1 320-trial experiment file
- V5.18.1 test64 experiment file
- trial order / 320 trial count
- angular-slice endpoint logic
- feedback/no-feedback behavior
- hand order
- rest durations
- instructions / UI task flow
- survey questions
- chunkFrames (remains 250)
- Prolific completion URL in config.js

Before Prolific launch
----------------------
1. Upload the changed files to GitHub.
2. If your deployed Firebase Console rules do not already allow
   sessions/{sessionId}/postTaskSurvey/response, publish the included
   firestore.rules in Firebase Console.
3. Hard refresh GitHub Pages.
4. Run one Prolific Preview through the actual 320 URL.
5. Verify Firebase has participantSource='prolific', prolific pid/study/session
   IDs, all trialSummaries/chunks, postTaskSurvey/response, and runnerBuild
   v5.18.2-angular-slice-save-reliability-20260911.
6. Verify the final page redirects to completion code C19G86LN.

This patch does NOT require Firebase Cloud Storage. The task writes to Cloud
Firestore.
