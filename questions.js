/* =============================================================================
 * questions.js: participant background and current-state questions asked before the task starts.
 * =============================================================================
 *
 * THIS FILE IS MEANT TO BE EDITED. Add, remove, or reorder the entries in
 * DEMOGRAPHIC_QUESTIONS below and reload the page. Nothing else needs changing:
 * the form builds itself, validates itself, and the answers are saved under
 * `demographics` in each session.
 *
 * After editing, open preview.html to see your questions the way participants
 * will, and to have common mistakes pointed out.
 *
 * Full guide with examples: docs/EDITING-QUESTIONS.md
 *
 * ---------------------------------------------------------------------------
 * ADDING A QUESTION
 * ---------------------------------------------------------------------------
 * Copy one of the entries below and change it. Every question needs an `id`
 * and a `label`. The `id` becomes the column name in your data, so use short
 * names without spaces, and do not reuse one.
 *
 *     { id: "handedness", label: "Dominant hand", type: "select",
 *       options: ["Right", "Left"] }
 *
 * ---------------------------------------------------------------------------
 * THE FIVE TYPES
 * ---------------------------------------------------------------------------
 *     type: "select"     a drop-down. Needs `options`.
 *     type: "radio"      the same, but all choices shown at once. Needs `options`.
 *     type: "checkboxes" choose any number. Needs `options`. Saved as a list.
 *     type: "number"     a number box. Optional `min` and `max`.
 *     type: "text"       a single line of text.
 *     type: "textarea"   a larger box for a longer answer.
 *
 * ---------------------------------------------------------------------------
 * OPTIONAL SETTINGS ON ANY QUESTION
 * ---------------------------------------------------------------------------
 *     required: true     participant cannot continue without answering.
 *                        Shown with a red asterisk. Defaults to false.
 *     help: "..."        smaller grey text under the label.
 *     placeholder: "..." greyed-out example inside a text or number box.
 *
 * ---------------------------------------------------------------------------
 * ONE SPECIAL ID
 * ---------------------------------------------------------------------------
 * A question with id "participantId" is also used as the participant's ID in
 * your data. If they arrived from Prolific it is filled in for them. If they
 * leave it blank they are given a random anonymous ID instead. Delete this
 * question if you do not want to ask for it.
 *
 * To skip demographics entirely, set DEMOGRAPHIC_QUESTIONS to an empty list:
 *     export const DEMOGRAPHIC_QUESTIONS = [];
 */

export const DEMOGRAPHIC_QUESTIONS = [

  // -------------------------------------------------------------------------
  // Core demographics
  // -------------------------------------------------------------------------

  { id: "age",
    label: "What is your age in years?",
    type: "number",
    required: true,
    placeholder: "e.g. 42",
    min: 18,
    max: 120 },

  { id: "sexAtBirth",
    label: "What sex were you assigned at birth, on your original birth certificate?",
    type: "select",
    required: true,
    options: ["Female",
              "Male",
              "Intersex",
              "Prefer not to say"] },

  { id: "genderIdentity",
    label: "What is your current gender identity?",
    type: "select",
    options: ["Woman",
              "Man",
              "Non-binary",
              "Another gender identity",
              "Prefer not to say"] },

  { id: "dominantHand",
    label: "Which hand do you primarily use for everyday activities such as writing?",
    type: "select",
    required: true,
    options: ["Right",
              "Left",
              "Mixed / no clear preference",
              "Prefer not to say"] },

  { id: "device",
    label: "What type of device are you using to complete this study?",
    type: "select",
    required: true,
    options: ["Laptop",
              "Desktop computer",
              "Tablet",
              "Phone"] },

  { id: "education",
    label: "What is the highest level of education you have completed?",
    type: "select",
    options: ["Less than high school",
              "High school or equivalent",
              "Some college",
              "Bachelor's degree",
              "Master's degree",
              "Doctoral or professional degree",
              "Prefer not to say"] },

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

  { id: "householdIncome",
    label: "What is the approximate total annual income, before taxes, of the household that primarily supports you financially?",
    type: "select",
    help: "If you are financially dependent on a parent or guardian, please report their household income. If you are financially independent, please report the income of your own household. Do not include roommates unless you share finances with them.",
    options: ["Less than $25,000",
              "$25,000-$49,999",
              "$50,000-$74,999",
              "$75,000-$99,999",
              "$100,000-$149,999",
              "$150,000-$199,999",
              "$200,000 or more",
              "Prefer not to say"] },

  { id: "employmentStatus",
    label: "What is your current employment status?",
    type: "select",
    options: ["Employed full-time",
              "Employed part-time",
              "Student",
              "Not currently employed",
              "Retired",
              "Other",
              "Prefer not to say"] },

  { id: "occupation",
    label: "Please describe your current or most recent occupation.",
    type: "text",
    help: "If you are a student and have not held an occupation, you may enter \"Student\".",
    placeholder: "e.g. Software engineer, teacher, student" },

  // -------------------------------------------------------------------------
  // Motor-relevant experience and health
  // -------------------------------------------------------------------------

  { id: "gamingFrequency",
    label: "How often do you play video or computer games?",
    type: "select",
    options: ["Never",
              "Less than once a week",
              "1-2 days per week",
              "3-5 days per week",
              "Almost every day",
              "Prefer not to say"] },

  { id: "dailyComputerUse",
    label: "On a typical day, approximately how many hours do you use a desktop or laptop computer?",
    type: "number",
    min: 0,
    max: 24,
    placeholder: "e.g. 6.5" },

  { id: "physicalActivityDays",
    label: "On how many days in a typical week do you engage in at least 30 minutes of moderate or vigorous physical activity?",
    type: "number",
    min: 0,
    max: 7,
    placeholder: "e.g. 3" },

  { id: "visionCorrection",
    label: "Are you currently wearing any vision correction while completing this study?",
    type: "select",
    options: ["None",
              "Glasses",
              "Contact lenses",
              "Prefer not to say"] },

  { id: "movementCondition",
    label: "Do you have any neurological, musculoskeletal, or other medical condition that affects your arm or hand movement, coordination, or sensation?",
    type: "select",
    options: ["No",
              "Yes",
              "Prefer not to say"] },

  // -------------------------------------------------------------------------
  // Current state
  // -------------------------------------------------------------------------

  { id: "sleepHoursLastNight",
    label: "How many hours did you sleep last night?",
    type: "number",
    min: 0,
    max: 24,
    placeholder: "e.g. 7.5" },

  { id: "currentSleepiness",
    label: "How sleepy do you feel right now?",
    type: "select",
    help: "Select the option that best describes how you feel at this moment.",
    options: ["1 - Extremely alert",
              "2 - Very alert",
              "3 - Alert",
              "4 - Rather alert",
              "5 - Neither alert nor sleepy",
              "6 - Some signs of sleepiness",
              "7 - Sleepy, but no effort to keep awake",
              "8 - Sleepy, some effort to keep awake",
              "9 - Very sleepy, great effort to keep awake, fighting sleep"] },

  // -------------------------------------------------------------------------
  // Participant ID
  // -------------------------------------------------------------------------

  { id: "participantId",
    label: "Participant ID or Prolific ID",
    type: "text",
    help: "If you are participating through Prolific, enter your Prolific ID. Otherwise, leave this blank to receive an anonymous ID.",
    placeholder: "e.g. 5f3c..." }

];
