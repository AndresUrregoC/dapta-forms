import type { FormConfig } from '@quill/types';

/**
 * The form configs the skill's recipes show. Typed as `FormConfig` so the
 * compiler checks them against the real contract, and validated in the specs
 * against the JSON Schema the zip ships, so a recipe can never teach an agent a
 * config the API would refuse.
 *
 * Every step has a `question` (the API refuses an empty one on any step but a
 * reveal, message or scheduler) and none uses a field without a control in the
 * editor.
 */

/** A scored quiz: two scored questions, then name and email, and three result ranges. */
export const QUIZ_CONFIG: FormConfig = {
  version: 1,
  title: 'Which plan fits your team?',
  cover: {
    enabled: true,
    headline: 'Find the right plan in one minute',
    subheadline: 'Four quick questions and you get a recommendation.',
    ctaText: 'Start',
  },
  steps: [
    {
      key: 'team_size',
      type: 'multiple_choice',
      question: 'How many people are on your team?',
      required: true,
      options: [
        { label: 'Just me', value: 'solo', points: 0 },
        { label: '2 to 10', value: 'small', points: 5 },
        { label: 'More than 10', value: 'large', points: 10 },
      ],
    },
    {
      key: 'budget',
      type: 'slider',
      question: 'What is your monthly budget in USD?',
      required: true,
      min: 0,
      max: 1000,
      step: 50,
      sliderScoring: [
        { min: 0, max: 199, points: 0 },
        { min: 200, max: 599, points: 5 },
        { min: 600, max: 1000, points: 10 },
      ],
    },
    {
      key: 'name',
      type: 'name',
      question: 'What is your name?',
      required: true,
    },
    {
      key: 'email',
      type: 'email',
      question: 'Where should we send your result?',
      placeholder: 'you@example.com',
      required: true,
    },
  ],
  scoring: { enabled: true },
  outcomes: [
    {
      id: 'starter',
      label: 'Starter',
      minScore: 0,
      maxScore: 7,
      message: 'Starter covers a small team. We sent the details to [email].',
    },
    {
      id: 'growth',
      label: 'Growth',
      minScore: 8,
      maxScore: 14,
      message: 'Growth fits a team that is scaling. We sent the details to [email].',
    },
    {
      id: 'scale',
      label: 'Scale',
      minScore: 15,
      message: 'Scale is built for larger teams. Someone will reach out soon.',
      redirectUrl: 'https://example.com/scale',
    },
  ],
};

/** A short lead form, the starting point of the edit recipe. */
export const LEAD_CONFIG: FormConfig = {
  version: 1,
  title: 'Talk to us',
  steps: [
    { key: 'name', type: 'name', question: 'What is your name?', required: true },
    { key: 'email', type: 'email', question: 'What is your work email?', required: true },
    {
      key: 'interest',
      type: 'multiple_choice',
      question: 'What are you interested in?',
      required: true,
      options: [
        { label: 'A demo', value: 'demo' },
        { label: 'Pricing', value: 'pricing' },
        { label: 'Something else', value: 'other' },
      ],
    },
  ],
};

/** `LEAD_CONFIG` after the edit recipe: one question reworded, one option added. */
export const LEAD_CONFIG_EDITED: FormConfig = {
  ...LEAD_CONFIG,
  steps: LEAD_CONFIG.steps.map((step) =>
    step.key === 'interest'
      ? {
          ...step,
          question: 'What brings you here today?',
          options: [...(step.options ?? []), { label: 'A partnership', value: 'partnership' }],
        }
      : step,
  ),
};

/** Every example, by name, for the specs. */
export const EXAMPLE_CONFIGS: Record<string, FormConfig> = {
  quiz: QUIZ_CONFIG,
  lead: LEAD_CONFIG,
  leadEdited: LEAD_CONFIG_EDITED,
};
