/* feedback-questions.js
 *
 * Post-experiment participant feedback for the single-hand Treasure Hunt task.
 * Likert items are required; open-ended items are optional.
 */

export const FEEDBACK_SCALE = {
  min: 1,
  max: 5,
  labels: {
    1: "Strongly disagree",
    2: "Disagree",
    3: "Neither agree nor disagree",
    4: "Agree",
    5: "Strongly agree",
  },
};

export const FEEDBACK_QUESTIONS = [
  {
    id: "instructionsClear",
    type: "likert",
    section: "Instructions & Understanding",
    text: "The instructions were clear.",
    required: true,
  },
  {
    id: "knewWhatToDo",
    type: "likert",
    section: "Instructions & Understanding",
    text: "I knew what I was supposed to do throughout the experiment.",
    required: true,
  },
  {
    id: "calibrationEasy",
    type: "likert",
    section: "Instructions & Understanding",
    text: "The calibration procedure was easy to understand and follow.",
    required: true,
  },
  {
    id: "taskTooDifficult",
    type: "likert",
    section: "Difficulty & Movement",
    text: "The task felt too difficult.",
    required: true,
  },
  {
    id: "movementSpeedReasonable",
    type: "likert",
    section: "Difficulty & Movement",
    text: "The required movement speed felt reasonable.",
    required: true,
  },
  {
    id: "physicalDiscomfort",
    type: "likert",
    section: "Physical Comfort",
    text: "My hand, arm, or shoulder felt tired or uncomfortable during the experiment.",
    required: true,
  },
  {
    id: "trackingSmoothReliable",
    type: "likert",
    section: "Hand Tracking & Control",
    text: "The hand-tracking and cursor control worked smoothly and reliably throughout the experiment.",
    required: true,
  },
  {
    id: "treasureEngaging",
    type: "likert",
    section: "Engagement & Task Length",
    text: "The treasure-hunt theme made the task more engaging.",
    required: true,
  },
  {
    id: "tooLongRepetitive",
    type: "likert",
    section: "Engagement & Task Length",
    text: "The experiment felt too long or repetitive.",
    required: true,
  },
  {
    id: "breaksSufficient",
    type: "likert",
    section: "Engagement & Task Length",
    text: "The breaks during the experiment were sufficient.",
    required: true,
  },
  {
    id: "confusingFrustratingUncomfortable",
    type: "textarea",
    section: "Optional Feedback",
    text: "Was there any part of the experiment that was confusing, frustrating, or uncomfortable?",
    required: false,
    placeholder: "Optional",
  },
  {
    id: "changeOneThing",
    type: "textarea",
    section: "Optional Feedback",
    text: "If you could change one thing about the experiment, what would you change?",
    required: false,
    placeholder: "Optional",
  },
];

export const FEEDBACK_QUESTIONNAIRE_VERSION = 1;
