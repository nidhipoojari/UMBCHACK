import 'server-only';

import { generateText, parseJsonObject } from '@/lib/gemini';

/**
 * Plans a value for each field on a real application form, from the
 * applicant's own profile. The ats-worker discovers the fields on the live
 * page; this asks Gemini what goes in each; the worker types the plan in and
 * stops for review. Nothing here submits anything.
 *
 * Two rules matter more than filling the form:
 *   - Nothing is invented. A field the profile cannot answer stays empty, with
 *     a reason the review screen shows.
 *   - Work authorisation, visa, pay, demographic, disability, veteran and
 *     background questions are never answered for the applicant. They are
 *     filtered out before the model sees them and again after it answers.
 */

const TIMEOUT_MS = 45_000;

/** One control on the page, as the worker found it. */
export type DiscoveredField = {
  /** CSS selector the worker will fill, passed back untouched. */
  selector: string;
  /** The visible label, or the placeholder, or the name attribute. */
  label: string;
  type: string;
  required: boolean;
  /** For a select or radio group. */
  options?: string[];
  maxLength?: number | null;
};

export type PlannedField = {
  selector: string;
  label: string;
  /** Empty means leave it blank; `reason` says why. */
  value: string;
  /** True for anything the applicant must answer themselves. */
  needsConfirmation: boolean;
  /** One sentence for the review screen. */
  reason: string;
};

const NEVER_ANSWER =
  /(sponsor|visa|work authoriz|work authoris|right to work|citizen|immigration|salary|compensation|pay expect|desired pay|race|ethnic|gender|sex |pronoun|disab|veteran|military|felony|conviction|background check|date of birth|age\b|sexual orientation)/i;

export function requiresHuman(label: string): boolean {
  return NEVER_ANSWER.test(label);
}

export type FillInputs = {
  jobTitle: string;
  company: string;
  /** Everything known about the applicant, as readable text. */
  evidence: string;
  fields: DiscoveredField[];
};

/** A value for every field. Throws when Gemini fails; the caller fills without a plan. */
export async function planFieldValues(input: FillInputs): Promise<PlannedField[]> {
  const forHuman = input.fields.filter((field) => requiresHuman(field.label));
  const forModel = input.fields.filter((field) => !requiresHuman(field.label));

  const planned: PlannedField[] = forHuman.map((field) => ({
    selector: field.selector,
    label: field.label,
    value: '',
    needsConfirmation: true,
    reason: 'You answer this one. We never answer work authorisation, pay, demographic or background questions for you.',
  }));

  if (forModel.length === 0) return planned;

  // Temperature 0: this is copying facts into boxes, not writing.
  const text = await generateText(prompt({ ...input, fields: forModel }), {
    json: true,
    temperature: 0,
    timeoutMs: TIMEOUT_MS,
  });

  const parsed = parseJsonObject(text) as { fields?: unknown };
  const list = Array.isArray(parsed?.fields) ? parsed.fields : [];
  const bySelector = new Map(forModel.map((field) => [field.selector, field]));

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const selector = typeof record.selector === 'string' ? record.selector : '';
    const field = bySelector.get(selector);
    // A selector the model made up is dropped, never typed into a page.
    if (!field) continue;
    bySelector.delete(selector);

    const value = typeof record.value === 'string' ? record.value : '';
    const reason = typeof record.reason === 'string' ? record.reason : '';
    planned.push({
      selector,
      label: field.label,
      value: requiresHuman(field.label) ? '' : trim(value, field.maxLength),
      needsConfirmation: requiresHuman(field.label) || value.trim() === '',
      reason: reason || (value.trim() ? 'Filled from your profile.' : 'Your profile does not answer this one.'),
    });
  }

  for (const field of bySelector.values()) {
    planned.push({
      selector: field.selector,
      label: field.label,
      value: '',
      needsConfirmation: true,
      reason: 'Not filled: nothing in your profile answers this.',
    });
  }

  return planned;
}

function trim(value: string, maxLength?: number | null): string {
  const clean = value.trim();
  return maxLength && maxLength > 0 ? clean.slice(0, maxLength) : clean;
}

function prompt(input: FillInputs): string {
  return [
    'You are filling in one real job application form for one real candidate. A human reviews',
    'everything you produce before anything is sent. Nothing you write is submitted by you.',
    '',
    'RULES:',
    '1. Use ONLY the EVIDENCE block. Never state a fact, a number, an employer, a tool or a date',
    '   that is not in it. A made-up claim on a real application is far worse than an empty box.',
    '2. If the evidence does not answer a field, return an EMPTY value and say so in `reason`.',
    '3. Never answer questions about work authorisation, visa or sponsorship, salary or pay',
    '   expectations, race, ethnicity, gender, age, disability, veteran status, criminal record',
    '   or background checks. If one reaches you, return an empty value.',
    '4. For a field with OPTIONS, the value must be EXACTLY one of the given options, copied',
    '   character for character. If none is supported by the evidence, return empty.',
    '5. For free-text questions ("why do you want to work here", "tell us about a project"),',
    '   write in the first person, plainly, 60 to 120 words, using only what the evidence',
    '   supports. No filler openers, no "I am excited to", no em dashes.',
    '6. Respect maxLength when it is given.',
    '7. `reason` is one short sentence for the candidate saying where the value came from or',
    '   why the box is empty. Address them as "you".',
    '',
    `ROLE: ${input.jobTitle || '(not recorded)'} at ${input.company || '(not recorded)'}`,
    '',
    '=== EVIDENCE ===',
    input.evidence.slice(0, 12_000) || '(no profile facts recorded)',
    '=== END EVIDENCE ===',
    '',
    '=== FIELDS ===',
    JSON.stringify(
      input.fields.map((field) => ({
        selector: field.selector,
        label: field.label,
        type: field.type,
        required: field.required,
        options: field.options?.length ? field.options : undefined,
        maxLength: field.maxLength ?? undefined,
      })),
      null,
      1,
    ),
    '=== END FIELDS ===',
    '',
    'Return exactly this JSON and nothing else. One entry per field above, same selectors:',
    '{"fields":[{"selector":"...","value":"...","reason":"..."}]}',
  ].join('\n');
}
