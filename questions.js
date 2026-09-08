/* =============================================================================
 * questions.js — V5.15.1 participant flow
 * -----------------------------------------------------------------------------
 * BEFORE THE GAME: six essential questions only.
 * AFTER THE GAME: background, current-state, distraction, and task-feedback
 * questions. The post-task survey is displayed in participant-facing sections
 * by js/core/experiment.js.
 * ============================================================================= */

export const DEMOGRAPHIC_QUESTIONS = [
  {
    id: "age",
    label: "What is your age in years?",
    type: "number",
    required: true,
    placeholder: "e.g. 24",
    min: 18,
    max: 120,
  },
  {
    id: "dominantHand",
    label: "Which hand do you primarily use for everyday activities such as writing?",
    type: "select",
    required: true,
    options: ["Right", "Left", "Mixed / no clear preference", "Prefer not to say"],
  },
  {
    id: "sexAtBirth",
    label: "What sex were you assigned at birth?",
    type: "select",
    required: true,
    options: ["Female", "Male", "Intersex", "Prefer not to say"],
  },
  {
    id: "genderIdentity",
    label: "What is your current gender identity?",
    type: "select",
    required: true,
    options: ["Woman", "Man", "Non-binary", "Another gender identity", "Prefer not to say"],
  },
  {
    id: "raceEthnicity",
    label: "What is your race and/or ethnicity?",
    type: "checkboxes",
    required: true,
    help: "Select all that apply.",
    options: [
      "American Indian or Alaska Native",
      "Asian",
      "Black or African American",
      "Hispanic or Latino",
      "Middle Eastern or North African",
      "Native Hawaiian or Pacific Islander",
      "White",
      "Another race or ethnicity",
      "Prefer not to say",
    ],
  },
  {
    id: "householdIncome",
    label: "What is the approximate annual income, before taxes, of the household that primarily supports you financially?",
    type: "select",
    required: true,
    help: "If you are financially dependent on a parent or guardian, report the household that primarily supports you. If you are financially independent, report your own household.",
    options: [
      "Less than $25,000",
      "$25,000-$49,999",
      "$50,000-$74,999",
      "$75,000-$99,999",
      "$100,000-$149,999",
      "$150,000-$199,999",
      "$200,000 or more",
      "Prefer not to say",
    ],
  },
];

export const POST_TASK_QUESTIONS = [
  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  {
    id: "device",
    section: "Your setup",
    label: "What type of computer did you use for this study?",
    type: "select",
    required: true,
    options: ["Laptop", "Desktop computer", "Other", "Prefer not to say"],
  },
  {
    id: "webcamType",
    section: "Your setup",
    label: "What type of webcam did you use?",
    type: "select",
    required: true,
    options: ["Built-in webcam", "External webcam", "Not sure", "Prefer not to say"],
  },

  // ---------------------------------------------------------------------------
  // Background
  // ---------------------------------------------------------------------------
  {
    id: "education",
    section: "About you",
    label: "What is the highest level of education you have completed?",
    type: "select",
    options: [
      "Less than high school",
      "High school or equivalent",
      "Some college",
      "Bachelor's degree",
      "Master's degree",
      "Doctoral or professional degree",
      "Prefer not to say",
    ],
  },
  {
    id: "employmentStatus",
    section: "About you",
    label: "What is your current employment status?",
    type: "select",
    options: [
      "Employed full-time",
      "Employed part-time",
      "Student",
      "Not currently employed",
      "Retired",
      "Other",
      "Prefer not to say",
    ],
  },
  {
    id: "occupation",
    section: "About you",
    label: "What is your current or most recent occupation?",
    type: "text",
    help: "If you are a student and have not held an occupation, you may enter \"Student\".",
    placeholder: "e.g. Software engineer, teacher, student",
  },

  // ---------------------------------------------------------------------------
  // Experience
  // ---------------------------------------------------------------------------
  {
    id: "gamingFrequency",
    section: "Your experience",
    label: "How often do you play video or computer games?",
    type: "select",
    options: [
      "Never",
      "Less than once a week",
      "1-2 days per week",
      "3-5 days per week",
      "Almost every day",
      "Prefer not to say",
    ],
  },
  {
    id: "dailyComputerUse",
    section: "Your experience",
    label: "On a typical day, approximately how many hours do you use a desktop or laptop computer?",
    type: "number",
    min: 0,
    max: 24,
    placeholder: "e.g. 6.5",
  },
  {
    id: "physicalActivityDays",
    section: "Your experience",
    label: "On how many days in a typical week do you do at least 30 minutes of moderate or vigorous physical activity?",
    type: "number",
    min: 0,
    max: 7,
    placeholder: "e.g. 3",
  },
  {
    id: "visionCorrection",
    section: "Your experience",
    label: "Were you wearing vision correction during this study?",
    type: "select",
    options: ["None", "Glasses", "Contact lenses", "Prefer not to say"],
  },
  {
    id: "movementCondition",
    section: "Your experience",
    label: "Do you have a health condition that affects your arm or hand movement, coordination, or sensation?",
    type: "select",
    options: ["No", "Yes", "Prefer not to say"],
  },

  // ---------------------------------------------------------------------------
  // Current state
  // ---------------------------------------------------------------------------
  {
    id: "sleepHoursLastNight",
    section: "How you feel today",
    label: "How many hours did you sleep last night?",
    type: "number",
    min: 0,
    max: 24,
    placeholder: "e.g. 7.5",
  },
  {
    id: "currentSleepiness",
    section: "How you feel today",
    label: "How sleepy do you feel right now?",
    type: "select",
    options: [
      "1 - Extremely alert",
      "2 - Very alert",
      "3 - Alert",
      "4 - Rather alert",
      "5 - Neither alert nor sleepy",
      "6 - Some signs of sleepiness",
      "7 - Sleepy, but no effort to keep awake",
      "8 - Sleepy, some effort to keep awake",
      "9 - Very sleepy, fighting sleep",
    ],
  },

  // ---------------------------------------------------------------------------
  // Distraction
  // ---------------------------------------------------------------------------
  {
    id: "distracted",
    section: "Distractions",
    label: "Were you distracted at any point during the game?",
    type: "select",
    required: true,
    options: ["No", "Yes", "Not sure"],
  },
  {
    id: "distractionDescription",
    section: "Distractions",
    label: "If yes, what distracted you?",
    type: "textarea",
    placeholder: "Optional",
  },

  // ---------------------------------------------------------------------------
  // Structured task feedback — streamlined to avoid overlapping participant questions.
  // ---------------------------------------------------------------------------
  {
    id: "instructionsClear",
    section: "Your experience with the game",
    label: "The instructions were clear.",
    type: "likert",
    required: true,
  },
  {
    id: "calibrationEasy",
    section: "Your experience with the game",
    label: "The calibration was easy to understand and follow.",
    type: "likert",
    required: true,
  },
  {
    id: "taskTooDifficult",
    section: "Your experience with the game",
    label: "The game felt too difficult.",
    type: "likert",
    required: true,
  },
  {
    id: "physicalDiscomfort",
    section: "Your experience with the game",
    label: "My hand, arm, or shoulder felt tired or uncomfortable during the game.",
    type: "likert",
    required: true,
  },
  {
    id: "trackingSmoothReliable",
    section: "Your experience with the game",
    label: "The hand tracking and cursor control worked smoothly.",
    type: "likert",
    required: true,
  },
  {
    id: "treasureEngaging",
    section: "Your experience with the game",
    label: "The treasure-hunt theme made the game more engaging.",
    type: "likert",
    required: true,
  },
  {
    id: "tooLongRepetitive",
    section: "Your experience with the game",
    label: "The game felt too long or repetitive.",
    type: "likert",
    required: true,
  },

  // ---------------------------------------------------------------------------
  // Optional feedback
  // ---------------------------------------------------------------------------
  {
    id: "changeOneThing",
    section: "Anything else?",
    label: "Is there anything you would change about the game?",
    type: "textarea",
    required: false,
    placeholder: "Optional",
  },
];

export const POST_TASK_LIKERT_SCALE = {
  1: "Strongly disagree",
  2: "Disagree",
  3: "Neither agree nor disagree",
  4: "Agree",
  5: "Strongly agree",
};
