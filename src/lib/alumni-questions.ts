export const ALUMNI_QUESTIONS = [
  {
    id: 'first-role',
    label: 'How did you land it?',
    prompt: 'How did you land your first role?',
  },
  {
    id: 'stand-out',
    label: 'What helped you stand out?',
    prompt: 'What helped you stand out when you were applying?',
  },
  {
    id: 'do-differently',
    label: 'What would you change?',
    prompt: 'What would you do differently if you were starting again?',
  },
  {
    id: 'this-week',
    label: 'What should I do this week?',
    prompt: 'What is one useful thing I should do this week?',
  },
] as const;

export const DEFAULT_ALUMNI_QUESTION = ALUMNI_QUESTIONS[0].prompt;
