import 'server-only';

import type { FunctionDeclaration } from './gemini';

/**
 * The agent's tools: what it declares to Gemini, and what runs when Gemini
 * calls one.
 *
 * PLACEHOLDER DATA. Every implementation below returns fixed sample numbers so
 * the loop can be built and demoed before the DoIT dataset functions land. Each
 * result carries `source: 'placeholder'`, and the handoff is one line per tool:
 * swap the body for the real function from lib/career, keep the result shape
 * (numbers plus the cohort size `n`), and the agent, the number check and the
 * UI need no change.
 */

export type ToolResult = Record<string, unknown> & { source: 'placeholder' | 'dataset' };

type Tool = {
  declaration: FunctionDeclaration;
  run: (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

const TOOLS: Tool[] = [
  {
    declaration: {
      name: 'career_pathways',
      description:
        'Where alumni of a major went: their most common first job titles, each with the share of the cohort and the cohort size n.',
      parameters: {
        type: 'OBJECT',
        properties: {
          major: { type: 'STRING', description: 'The major or track, e.g. "Computer Science" or "Data Science".' },
        },
        required: ['major'],
      },
    },
    run: (args) => ({
      source: 'placeholder',
      major: str(args.major) || 'Computer Science',
      n: 312,
      paths: [
        { first_job: 'Software Engineer', share_pct: 38, median_salary_usd: 92000 },
        { first_job: 'Data Analyst', share_pct: 21, median_salary_usd: 71000 },
        { first_job: 'IT Support Specialist', share_pct: 12, median_salary_usd: 54000 },
      ],
    }),
  },
  {
    declaration: {
      name: 'degree_roi',
      description:
        'Estimated return on a degree: median starting salary, median salary five years out, and years to pay back tuition, with cohort size n.',
      parameters: {
        type: 'OBJECT',
        properties: {
          major: { type: 'STRING', description: 'The major or track.' },
        },
        required: ['major'],
      },
    },
    run: (args) => ({
      source: 'placeholder',
      major: str(args.major) || 'Computer Science',
      n: 287,
      median_start_salary_usd: 78000,
      median_salary_year5_usd: 104000,
      payback_years: 2.6,
    }),
  },
  {
    declaration: {
      name: 'skill_gap',
      description:
        "Which skills a student already has for a target role (from courses they passed) and which are missing, with courses that teach the missing ones.",
      parameters: {
        type: 'OBJECT',
        properties: {
          target_role: { type: 'STRING', description: 'The job title the student wants, e.g. "Data Analyst".' },
        },
        required: ['target_role'],
      },
    },
    run: (args) => ({
      source: 'placeholder',
      target_role: str(args.target_role) || 'Data Analyst',
      have: ['Python', 'Statistics', 'SQL basics'],
      missing: [
        { skill: 'Data visualization', course: 'IS 428 Data Visualization' },
        { skill: 'Machine learning', course: 'CMSC 478 Machine Learning' },
      ],
    }),
  },
];

export const toolDeclarations: FunctionDeclaration[] = TOOLS.map((t) => t.declaration);

export async function runTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.declaration.name === name);
  if (!tool) return { source: 'placeholder', error: `Unknown tool ${name}.` };
  return tool.run(args);
}
