/* =============================================================================
 *  questions.js: participant background and current-state questions asked before the task starts.
 * =============================================================================
 *
 *  THIS FILE IS MEANT TO BE EDITED. Add, remove, or reorder the entries in
 *  DEMOGRAPHIC_QUESTIONS below and reload the page. Nothing else needs changing:
 *  the form builds itself, validates itself, and the answers are saved under
 *  `demographics` in each session.
 *
 *  After editing, open preview.html to see your questions the way participants
 *  will, and to have common mistakes pointed out.
 *
 *  Full guide with examples: docs/EDITING-QUESTIONS.md
 *
 *  ---------------------------------------------------------------------------
 *  ADDING A QUESTION
 *  ---------------------------------------------------------------------------
 *  Copy one of the entries below and change it. Every question needs an `id`
 *  and a `label`. The `id` becomes the column name in your data, so use short
 *  names without spaces, and do not reuse one.
 *
 *      { id: "handedness", label: "Dominant hand", type: "select",
 *        options: ["Right", "Left"] }
 *
 *  ---------------------------------------------------------------------------
 *  THE FIVE TYPES
 *  ---------------------------------------------------------------------------
 *      type: "select"     a drop-down. Needs `options`.
 *      type: "radio"      the same, but all choices shown at once. Needs `options`.
 *      type: "checkboxes" choose any number. Needs `options`. Saved as a list.
 *      type: "number"     a number box. Optional `min` and `max`.
 *      type: "text"       a single line of text.
 *      type: "textarea"   a larger box for a longer answer.
 *
 *  ---------------------------------------------------------------------------
 *  OPTIONAL SETTINGS ON ANY QUESTION
 *  ---------------------------------------------------------------------------
 *      required: true     participant cannot continue without answering.
 *                         Shown with a red asterisk. Defaults to false.
 *      help: "..."        smaller grey text under the label.
 *      placeholder: "..." greyed-out example inside a text or number box.
 *
 *  ---------------------------------------------------------------------------
 *  ONE SPECIAL ID
 *  ---------------------------------------------------------------------------
 *  A question with id "participantId" is also used as the participant's ID in
 *  your data. If they arrived from Prolific it is filled in for them. If they
 *  leave it blank they are given a random anonymous ID instead. Delete this
 *  question if you do not want to ask for it.
 *
 *  To skip demographics entirely, set DEMOGRAPHIC_QUESTIONS to an empty list:
 *      export const DEMOGRAPHIC_QUESTIONS = [];
 */

export const DEMOGRAPHIC_QUESTIONS = [
  { id: "age",
    label: "Age",
    type: "number",
    required: true,
    placeholder: "e.g. 42",
    min: 18,
    max: 120 },

  { id: "sexAtBirth",
    label: "Sex assigned at birth",
    type: "select",
    required: true,
    options: ["Female", "Male", "Intersex", "Prefer not to say"] },

  { id: "dominantHand",
    label: "Which hand do you primarily use for everyday activities such as writing?",
    type: "select",
    required: true,
    options: ["Right", "Left", "Mixed / no clear preference", "Prefer not to say"] },

  { id: "device",
    label: "What device are you using?",
    type: "select",
    required: true,
    options: ["Laptop", "Desktop computer", "Tablet", "Phone"] },

  { id: "education",
    label: "Highest education completed",
    type: "select",
    options: ["Less than high school",
              "High school or equivalent",
              "Some college",
              "Bachelor's degree",
              "Master's degree",
              "Doctoral or professional degree",
              "Prefer not to say"] },

  { id: "visionCorrection",
    label: "Vision correction worn now",
    type: "select",
    options: ["None", "Glasses", "Contact lenses", "Prefer not to say"] },

  { id: "raceEthnicity",
    label: "What is your race and/or ethnicity?",
    type: "checkboxes",
    help: "Select all that apply.",
    options: ["American Indian or Alaska Native",
              "Asian",
              "Black or African American",
              "Hispanic or Latino",
              "Middle Eastern or North African",
              "Native Hawaiian or Pacific Islander",
              "White",
              "Another race or ethnicity",
              "Prefer not to say"] },

  { id: "gamingFrequency",
    label: "How often do you play video or computer games?",
    type: "select",
    options: ["Never",
              "Less than once a week",
              "1-2 days per week",
              "3-5 days per week",
              "Almost every day",
              "Prefer not to say"] },

  { id: "sleepHoursLastNight",
    label: "How many hours did you sleep last night?",
    type: "number",
    min: 0,
    max: 24,
    placeholder: "e.g. 7.5" },

  { id: "currentSleepiness",
    label: "How sleepy do you feel right now?",
    type: "select",
    options: ["1 - Extremely alert",
              "2",
              "3 - Alert",
              "4",
              "5 - Neither alert nor sleepy",
              "6",
              "7 - Sleepy, but no difficulty staying awake",
              "8",
              "9 - Very sleepy, fighting sleep"] },

  { id: "participantId",
    label: "Participant ID or Prolific ID",
    type: "text",
    help: "If you are participating through Prolific, enter your Prolific ID. Otherwise, leave this blank to receive an anonymous ID.",
    placeholder: "e.g. 5f3c..." },

];
