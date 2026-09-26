# agentHire + Career Pathways — Design Spec

**Date:** 2026-09-26 · **Event:** hackUMBC 2026 · **Team:** 4 · **Devpost deadline:** Sun 11:00 AM (our target: 10:00 AM)
**Status:** Replaces the earlier "Pack" spec. We are building agentHire and adding the DoIT Career Pathways & Degree ROI track to it. This file is the build reference.

> **Eligibility (read first).** hackUMBC rules: projects built on existing work are not eligible for prizes, and all code must be written after 12:00 PM Saturday. agentHire began as our VTHacks idea. **Nothing from the VTHacks codebase is copied in**: we rebuild from this repo (landing page first committed Sat 4:36 PM). Confirm with an organizer and say so on Devpost.

---

## 1. Summary

agentHire is a voice-first job application agent. A student talks to their agent. It matches them to roles by their actual skills and coursework, writes the application materials, and verifies that the employer is real before any private data leaves their hands. Verification means the employer's agent presents a domain-anchored identity and certificate and passes a Trust Index check. The same check runs in reverse on applicants.

**What we add for hackUMBC:** a **Career Pathways** layer built on the DoIT synthetic dataset. Before a student applies anywhere, their agent can answer *"Where will my degree actually take me?"* It works from 3,200 synthetic alumni and their job histories:

- where people on their major and track went,
- what the degree cost versus what it paid,
- which skills they are missing for a target role,
- and which UMBC courses teach those skills.

Every number the agent says is computed from the dataset and cites its cohort size (**n**). The model never invents a number.

**One-line pitch:** "Ask your agent where your degree leads. It answers from 3,200 alumni, names the gaps, and applies for you, but only to employers that can prove they're real."

## 2. Goals and success criteria

| # | Goal | Done when |
|---|---|---|
| G1 | Career pathway explorer | Choosing a major and track shows first jobs → later jobs as a clickable graph, with n, median salary and median months to the first job on each node |
| G2 | Degree ROI | For a major, track or student, shows net cost, loans, first salary distribution (P25/median/P75), and a payback estimate. A cohort with n < 20 is labelled "low confidence" |
| G3 | Skill gap from a real transcript | Signed in as a demo student (a real `campus_id` from `students_current.csv`), picking a target role lists the skills they already have from passed courses, the missing skills, and the catalog courses that teach them (with prerequisites and terms offered) |
| G4 | Grounded agent answers | "What could I do with my Data Science track?" returns an answer built from tool results, with n and the tool shown under the reply. It uses no number that isn't in a tool result |
| G5 | Voice | The same question asked out loud gets a spoken answer; the transcript drawer shows both sides |
| G6 | agentHire core loop | Roles matched to the student (coursework-aware) → employer verification (certificate + Trust Index, with a refusal path) → human confirmation before any field is released |
| G7 | Deployed | Live URL on DigitalOcean with a custom domain |

**Priority:** G1–G4 are the DoIT track and come first. G6 is the agentHire story. G5 and G7 are needed for the demo. If time runs short, G6 can be a scripted, seeded flow. The career features must be real.

**Out of scope:** real employer integrations or real application submission; real PKI (certificates are self-issued for the demo, and Devpost says so); mobile apps; accounts beyond demo sign-in; any real student data.

## 3. Hackathon tracks targeted

| Track | Our angle | Required evidence |
|---|---|---|
| **DoIT – Career Pathways & Degree ROI** (primary) | Pathway graph, ROI, a transcript-based skill-gap matcher, and a grounded voice advisor, all on DoIT's data | Devpost lists every file used (all six) and how; each demo step reads from the dataset |
| **Best Entrepreneurial Idea** | Universities license the career layer for career services; employers pay for verified-applicant intake | One pitch slide: users, pricing, pilot |
| **STARS – Community Impact** | UMBC students (many first-gen: `is_first_generation`) choose tracks and courses with little outcome data | Impact plan (§11) |
| **Most Engaging Demo** | The judge asks the agent a question out loud and then watches it refuse a fake employer | Demo script (§10) |
| **Overall** | Deep, grounded agent + real data + voice + security | — |
| **MLH – Gemini** | Gemini function calling drives every agent tool | Code link + demo step |
| **MLH – ElevenLabs** | Voice in and out | Demo step |
| **MLH – DigitalOcean / GoDaddy** | App Platform deploy; custom domain | Live URL |
| *Optional:* **CyberDawgs** | Agent identity verification is an access-control function | Only if we also write the extensive docs their rubric requires (Execution 20%). Decide at the hour-16 checkpoint |

## 4. Architecture

```
┌──────────────────────── Next.js 16 app (one repo) ────────────────────────┐
│ UI (App Router)                                                           │
│   /            landing (done)                                             │
│   /signin      demo sign-in: pick a demo student                          │
│   /career      Pathways graph · ROI · Skill gap                           │
│   /apply       matched roles · verification · approval                    │
│   Voice widget + transcript drawer (on /career and /apply)                │
├───────────────────────────────────────────────────────────────────────────┤
│ Route handlers (server only)                                              │
│   POST /api/agent        Gemini tool loop (text in → text + tool cards)   │
│   GET  /api/career/*     JSON for the UI (same functions as the tools)    │
│   POST /api/verify       employer verification (ANS + cert + Trust Index) │
│   POST /api/voice/*      ElevenLabs token / webhook                       │
├───────────────────────────────────────────────────────────────────────────┤
│ lib/career   in-memory store built from the six CSVs at server start      │
│ lib/agent    tool schemas, system prompt, loop, number guard              │
│ lib/trust    identity resolution, certificate check, Trust Index          │
└───────────────────────────────────────────────────────────────────────────┘
```

**Key decision: one career library, two callers.** The functions in `lib/career` serve both the UI endpoints and the agent tools. The chart and the agent's sentence can never disagree, because they come from the same computation.

**Data loading:** the full dataset is ~22 MB and CC0-licensed, so we commit it under `data/doit/`. It is parsed once per server process, in about a second, and held in memory. No database is needed for the career layer. Use `data/doit/sample/` while developing and switch one env var (`DOIT_DATA=full`) for the demo.

### 4.1 Stack

| Need | Choice |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript. **Read `node_modules/next/dist/docs/` before writing routes; this Next version has breaking changes (see AGENTS.md)** |
| Styling | Existing `globals.css` design system (dark, Forum, card tokens) |
| Graph | `react-force-graph-2d` or a hand-built Sankey with `d3-sankey` (pick one on hour 0) |
| Charts | Hand-rolled SVG, or Recharts if it saves time |
| CSV | `csv-parse` (sync, server only) |
| LLM | Gemini API (`@google/genai`), newest Flash model, function calling |
| Voice | ElevenLabs Conversational AI agent with client tools, or ElevenLabs STT + TTS around our own `/api/agent` (decide in the hour 1–3 spike) |
| Deploy | DigitalOcean App Platform; GoDaddy domain |

## 5. Data

Source: <https://github.com/jasonpaluck/hackumbc-2026> (synthetic, CC0). There are six CSVs, all joining on `campus_id`. A `campus_id` is in `students_current.csv` **or** `alumni.csv`, never both.

### 5.1 Gotchas (from the dataset docs, verified)

- `Not Applicable` is a **literal string**. Filter it out before casting any numeric column.
- List columns (`skill_tags`, `role_skill_tags`, `prerequisite_ids`, `required_for_majors`, `typical_terms_offered`) are **pipe-delimited**.
- Booleans are `TRUE` / `FALSE`.
- `end_date` in `employment_history.csv` is blank only when `is_current` is `TRUE`.
- `first_destination = No Response` is ~15% of alumni and means **unknown, not unemployed**. Exclude it from placement rates and say so in the UI.
- Current students have **no** employment history.
- `skill_tags` (courses) and `role_skill_tags` (jobs) share **one vocabulary of 119 skills**, so skill gaps are plain set operations with no mapping table.

### 5.2 What the dataset contains (full set)

| File | Rows | We use it for |
|---|---|---|
| `alumni.csv` | 3,200 | Cohorts by `major` × `track` (2 majors, 10 major/track pairs); cost (`net_cost_usd`, `total_loans_usd`); first outcome (`first_destination`, `first_job_title`, `first_job_family`, `first_job_annual_salary_usd`, `months_to_first_job`, `first_job_region`) |
| `employment_history.csv` | ~6,000 | Career paths over time (`change_type`, `seniority_level`, `tenure_months`, `annual_salary_usd`); `role_skill_tags` for each of the 98 job titles; `cost_of_living_index` for real-salary comparisons |
| `course_catalog.csv` | 72 | Skill → course lookup; prerequisites; terms offered; difficulty |
| `transcripts.csv` | ~140,000 | A student's passed courses → the skills they already have |
| `students_current.csv` | 1,800 | Demo personas (major, track, class level, GPA, `tuition_paid_to_date_usd`, `is_first_generation`) |
| `student_experience.csv` | ~20,000 | "Alumni like you did…": which internships, hackathons and certifications correlate with outcomes |

### 5.3 Derived structures (`lib/career/store.ts`, built at load)

| Name | Shape | Built from |
|---|---|---|
| `cohorts` | `{major, track} → alumni[]` | alumni |
| `firstJobs` | `{major, track, first_job_title} → {n, salaries[], monthsToJob[]}` | alumni (employed only) |
| `transitions` | `{fromTitle, toTitle} → n` (edges for the graph; `change_type` kept for labels) | employment_history, each person's spells ordered by `start_date` |
| `roleSkills` | `job_title → Map<skill, freq>` (share of spells listing the skill) | employment_history.role_skill_tags |
| `skillCourses` | `skill → course[]` | course_catalog.skill_tags |
| `studentSkills` | `campus_id → Set<skill>` from courses with `credits_earned > 0` | transcripts ⋈ course_catalog |
| `experienceLift` | `{track, experience_type} → {n_with, n_without, median_salary_with, median_salary_without}` | student_experience ⋈ alumni |

## 6. Components

### 6.1 Career library (`lib/career`)

These are pure functions returning plain JSON. Each result carries `n` and a `source` string (e.g. `"alumni.csv: CS / Data Science, graduates 2015–2026, employed full-time"`).

| Function | Returns |
|---|---|
| `pathways({major, track, depth=2})` | Graph nodes (titles) and edges (n), plus each first job's n, median salary and median months to the job |
| `degreeRoi({major, track} \| {campusId})` | Net cost, loans, P25/median/P75 first salary, payback years = `net_cost_usd / (median salary × 0.15)` (share of salary to repayment is our stated assumption, adjustable in the UI), placement rate excluding No Response |
| `skillGap({campusId, targetTitle})` | `{have[], missing[], coverage%}`, where each missing skill carries its role frequency and the courses that teach it (prereqs, terms offered) |
| `rolesFor({campusId})` | Top 10 job titles by skill overlap with the student, each with n and median salary |
| `whatHelped({major, track})` | Experience types ranked by outcome difference, **worded as correlation, not cause** |

Unit tests (Vitest) run on the **sample** data: the `Not Applicable` handling, pipe splitting, a hand-checked median for one cohort, and a skill gap for one known student.

### 6.2 Agent (`lib/agent`)

- **Model:** Gemini with function calling. Tools map 1:1 onto §6.1 plus `find_roles` and `verify_employer` (§6.3).
- **Loop:** up to 4 tool rounds per user turn. Invalid tool arguments → return the validation error to the model once → fall back to a plain reply.
- **System prompt:** "You are agentHire, a UMBC student's career and application agent. Answer questions about outcomes, salaries or skills ONLY from tool results. Always state n. If n < 20, say the estimate is low-confidence. The data is synthetic; never present it as real UMBC outcomes. Never submit or release anything without the user's explicit yes."
- **Number guard (the part judges will poke at):** after the model replies, every number in the text is checked against the numbers in that turn's tool results, allowing rounding. If one doesn't match, the turn is regenerated once with a correction; if it still fails, the UI shows the tool card without the prose. The UI renders tool results as cards under the reply (graph, ROI, gap list), so the evidence is always visible.
- **Memory:** per-session list of stated goals and interests (e.g. "wants remote cybersecurity roles"), injected into the prompt. In memory only; nothing persists server-side beyond the session.

### 6.3 agentHire core (`lib/trust` + `/apply`)

The landing page promises the following; build it to match, but seeded:

1. **Matched roles:** a seeded set of ~12 postings. Each posting's required skills come from `roleSkills` for its title, so matching uses the same vocabulary as the skill gap. Match score = weighted skill overlap, with the gaps named.
2. **Employer verification:** each posting has an employer agent record: an ANS-style name (`ans://v1.0.0.employer.<domain>`), a self-issued certificate, and five Trust Index dimensions, each with a score and a one-line reason. Two seeded employers **fail** (bad certificate chain; domain mismatch). The agent refuses out loud and releases nothing.
3. **Release order:** ANS resolve → certificate check → Trust Index → policy gate → **human confirm** → fields released. Each step is logged and shown as it passes.
4. **Materials:** Gemini drafts a tailored resume summary and cover letter from the student's transcript skills and experiences. Shown for approval; nothing is sent anywhere.

### 6.4 Voice

The voice widget uses the existing `AgentFaceLive` (3D face, moods: idle / listening / thinking / speaking / happy / refusing) and the transcript drawer already styled in `globals.css` (`--drawer-w`). Speech in goes to `/api/agent` and the reply is spoken. Face mood follows state; `refusing` on a failed verification. Keyboard and screen-reader paths must still work with voice off; that is part of the landing page's promise.

### 6.5 UI screens

1. **Sign in:** pick one of 3 curated demo students (chosen on Saturday for interesting data: e.g. a first-gen CS/Data Science junior, an IS/Cybersecurity Management sophomore, a CS/General senior). Shows "synthetic data" clearly.
2. **Career → Pathways:** major/track picker; graph; side panel for the selected node (n, salary band, months to job, top skills).
3. **Career → ROI:** cost vs. salary chart, payback slider (repayment share), cohort comparison between two tracks.
4. **Career → Skill gap:** target role picker (default: the student's top `rolesFor` match); have / missing lists; the courses to take next, with prerequisites and next term offered.
5. **Apply:** matched roles; verification ladder; approval step; drafted materials.
6. **Agent** (drawer on every screen): chat + voice, tool cards inline.

## 7. Error handling

| Failure | Behavior |
|---|---|
| Cohort n < 20 | Show the value with a "low confidence (n = …)" badge; the agent says so |
| Cohort n = 0 | "No alumni in the data match this"; offer the closest broader cohort (drop the track) |
| Gemini error / rate limit | Career pages keep working (they don't need the LLM); the agent shows "Agent unavailable, the charts below are live" |
| Number guard fails twice | Show tool cards only, no prose |
| Voice fails (mic denied, ElevenLabs down) | Fall back to text chat; banner explains |
| Verification step fails | Agent refuses, face goes to `refusing`, no fields released, reason shown |

## 8. Testing

- **Vitest:** the career library on sample data (§6.1), number guard (matches, rounding, rejects an invented figure), match score, verification ladder (pass and both fail cases).
- **Manual checklist at hour 16:** G1–G6 on the deployed URL, on venue Wi-Fi, in Chrome.
- **Reality check:** spot-check 3 agent answers against a pandas query in a notebook (`scripts/check.py`) and paste the matching numbers into the Devpost write-up.

## 9. Team split and timeline

| Owner | Area |
|---|---|
| **P1 – Career data** | `data/doit/`, `lib/career`, tests, `/api/career/*` |
| **P2 – Career UI** | `/career` screens: graph, ROI, skill gap; tool cards reused by the agent |
| **P3 – Agent & voice** | Gemini tool loop, number guard, memory, voice widget, transcript drawer |
| **P4 – agentHire core & story** | `/apply`, `lib/trust`, seeded postings/employers, demo sign-in, deploy + domain, Devpost, video, pitch |

Times are wall-clock, starting from now (Sat ~5 PM).

| When | Milestone |
|---|---|
| Sat 5–6 PM | Pull dataset into `data/doit/`; agree API shapes (`types/career.ts`); each person on their own branch |
| 6–9 PM | **Risk spikes:** store loads + one `pathways()` result (P1); graph renders mock JSON (P2); Gemini calls one tool end-to-end (P3); ElevenLabs round-trip (P3); verification ladder with seeded data (P4) |
| 9 PM–2 AM | Features on real data; **deploy by 10 PM**, then redeploy continuously |
| 2 AM | **Hour-16 checkpoint:** G1–G6 checklist; feature freeze; decide CyberDawgs yes/no |
| 2–6 AM | Sleep in two shifts; bug fixes |
| 6–8:30 AM | Polish, demo data, number spot-checks |
| 8:30–9:30 AM | Record video; Devpost write-up |
| 9:30–10 AM | **Submit** (all tracks ticked, repo public) |

**Kill switches:** if voice isn't round-tripping by 9 PM → text chat only, and keep the face animating on text replies. If the graph library fights us by 11 PM → a ranked list of paths with n and salary. If `/apply` isn't done by the 2 AM checkpoint → script it with seeded data; the career layer is the priority.

## 10. Demo script (≈3 min)

1. **Hook (15 s):** "Every UMBC student asks where their degree actually takes them. The data exists; students never see it."
2. **Sign in** as the first-gen CS / Data Science junior (synthetic, and we say so).
3. **Judge asks out loud:** "What can I do with my track?" → the agent answers with n. The pathway graph lights up; click *Data Analyst → Senior Data Analyst*.
4. **ROI:** compare Data Science vs. General; drag the repayment slider.
5. **Skill gap:** target *Machine Learning Engineer I* → missing skills → "Take CMSC 478 Intro to ML next spring (prereqs: CMSC 341, STAT 355, MATH 301)." Pick the demo student so this is true for them.
6. **Apply:** the agent finds matching roles; one employer **fails** verification → the face turns red and the agent says "Stopped. That employer could not prove who it is." A second employer passes → approval prompt → materials drafted.
7. **Close (30 s):** every number is grounded (show a tool card with n), impact plan, business model.

## 11. Impact plan (STARS)

- **Problem:** students choose tracks, courses and internships with little view of outcomes; first-gen students get the least guidance.
- **Metrics:** career-clarity survey (1–5) before and after one session; share of students who add a recommended course to their plan; advisor minutes saved per appointment (advisor estimate); number of what-if comparisons explored.
- **Pilot:** one advising office, 50 students over 4 weeks, opt-in, using UMBC's real (de-identified) outcome data in place of the synthetic set.
- **Honesty:** the demo data is synthetic; conclusions are about the tool, not about real UMBC outcomes.

## 12. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Crowded DoIT field ("AI advisor" entries) | High | Lead with grounding (n on everything, number guard) and the transcript-based skill gap; most teams won't use transcripts |
| LLM states an invented number | Medium | Number guard + tool cards; spot-checks in Devpost |
| Too much scope (career + agentHire) | High | Career layer first; `/apply` can be seeded; 2 AM freeze |
| Voice flaky in a loud hall | Medium | Push-to-talk; text fallback; recorded backup video |
| Next.js 16 API differences | Medium | Read the bundled docs before writing routes (AGENTS.md) |
| Eligibility challenge (prior project) | Medium | Everything written from Sat 12 PM in this repo; git history shows it; confirm with organizers |

## 13. Stretch goals (only after the 2 AM checkpoint passes)

1. Region view: first-job regions with salary adjusted by `cost_of_living_index`.
2. Four-year planner: remaining courses in prerequisite order, with terms offered.
3. Employer-side view: the employer agent verifying an applicant agent (the "runs both ways" claim).
4. CyberDawgs docs pack: threat model, verification protocol, edge cases, known limitations.
