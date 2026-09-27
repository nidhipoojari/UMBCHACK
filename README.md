<div align="center">

# ◐ agentHire

**A voice-first job application agent. Neither side moves until both prove who they are.**

*Built at hackUMBC 2026 (Sep 26–27) by a team of four. The applicant's agent finds the roles, drafts the materials and applies. It does that only after the employer's agent proves it is real, and every message between the two agents is signed and encrypted.*

[![Live](https://img.shields.io/badge/Live-agentHire-0b2545?logo=firebase&logoColor=white)](https://project-96b6d773-106a-457a-a46.web.app)
[![Next.js](https://img.shields.io/badge/Next.js%2016-App%20Router-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![AI](https://img.shields.io/badge/AI-Gemini%20on%20Vertex%20AI-4285F4?logo=googlegemini&logoColor=white)](#-api-reference)
[![Voice](https://img.shields.io/badge/Voice-ElevenLabs-000000?logo=elevenlabs&logoColor=white)](#%EF%B8%8F-voice)
[![Cloud](https://img.shields.io/badge/Cloud-Cloud%20Run%20%C2%B7%20Cloud%20SQL%20%C2%B7%20Firebase-4285F4?logo=googlecloud&logoColor=white)](#%EF%B8%8F-deployment)
[![A2A](https://img.shields.io/badge/A2A-ES256%20%C2%B7%20ECDH%20%C2%B7%20AES--256--GCM-2e7d32)](#-the-agent-to-agent-trust-protocol)

</div>

> **Living document.** This README grows with the project. The [changelog](#-changelog) at the bottom records what changed and when.

---

## 📖 Why this exists

Job hunting is broken on both sides of the table:

| Problem | What it looks like |
|---|---|
| **Applications disappear** | Hundreds of applications, most never answered, and no word on which ones were even read. |
| **The same form, every time** | Name, school, dates, the same PDF uploaded again, retyped on every company's applicant tracking system. |
| **Some doors are fake** | Postings that exist only to collect resumes, from companies that were never hiring. |
| **Employers drown too** | Fabricated and mass-generated applicants make it hard to find the real ones. |

agentHire gives the student an **agent** that does the work, and it adds a **handshake**. Before any private data leaves the student's side, the employer's agent must present a verifiable identity and pass a trust check. The same check runs in reverse on applicants. If either side cannot prove who it is, the agent **refuses out loud** and releases nothing.

Two rules shaped every decision:

| Rule | What it meant in practice |
|---|---|
| **Every number is grounded** | The model never invents a figure. Career answers come from tool results over the dataset and cite their cohort size (*n*). Drafted documents pass a fact gate before they can be printed. |
| **Nothing leaves without proof and consent** | Applications travel as signed **and** encrypted envelopes. The autofill worker fills a real form but never submits it. The agent never applies without an explicit yes. |

---

## 🏆 Tracks we're entering

| Track | What we built for it |
|---|---|
| **Overall** | A full product: resume intake → enrichment → job matching → gap interview → drafting → verified agent-to-agent apply → a live voice **mock interview** for roles you reach, with a voice agent on every page |
| **DoIT: Navigating the Future: Career Pathways & Degree ROI** | The hackUMBC alumni and campus dataset loaded into Postgres; a **coursework twin** for every applicant (one dataset student's transcript, matched to their resume, shown on Profile and counted when real job postings are ranked); an alumni network built on it; and a spoken **gap interview** that compares the student's skills and coursework with what real postings ask for |
| **CyberDawgs Cybersecurity Application** | The A2A gateway: ES256-signed envelopes, ECDH + AES-256-GCM sealing, replay protection, a trust index and an offline attack battery. *Requires the extensive documentation in the [trust protocol](#-the-agent-to-agent-trust-protocol) section and `functions/README.md`* |
| **Best Entrepreneurial Idea** | A two-sided product for students and employers, where verified identity is the moat |
| **STARS: Community Impact & Social Innovation** | Built for UMBC students and the Baltimore-area employers who hire them: introductions to alumni who already got the job, protection from fake postings, and skills from coursework that resumes leave out. See [community impact](#-community-impact-umbc--baltimore) for the need, the impact and how we would measure it |
| **Most Engaging Demo** | Tap the agent's face and it introduces itself out loud; on the dashboard, drag the floating agent anywhere, press its mic nose and ask *"what are my top matches?"*; then watch it refuse an employer that cannot prove who it is; move a role to Interviewing and rehearse with a **live voice interviewer** |
| **MLH: Best Use of Gemini API** | Gemini runs the resume extraction, the enrichers, match reranking, document drafting, autofill planning and the agent's tool loop, which answers questions about your own profile, matches, pipeline and coursework through function calls and decides for itself when a conversation is over. **Gemini Live** (native audio) is the mock interviewer, and Gemini writes the grounded conversation between your agent and the employer's |
| **MLH: Best Use of ElevenLabs** | agentHire's voice: a saved intro clip on the landing page, a spoken **gap interview** on the Jobs page, and a **floating voice agent** on every dashboard page you can talk to hands-free (Scribe speech-to-text + Flash text-to-speech) |

---

## 🤝 Community impact (UMBC & Baltimore)

**The need.** A job search is hardest for the students with the fewest connections: those who are the first in their family to go to college, who commute, or who work while studying, and don't know anyone who already has the job they want. The same students lose the most to fake postings that exist only to collect a resume, a phone number or an ID, and to hours of retyping the same application on site after site. Employers in the Baltimore area, meanwhile, have trouble telling real applicants from mass-generated ones.

**What agentHire does about it**, using what's built today:

| Community need | What the student gets |
|---|---|
| No one to ask | The **alumni network** introduces them to UMBC alumni from their major who already got there, and the agent makes the introduction |
| Fake postings and data harvesting | The agent **verifies every employer first** and releases nothing to one that can't prove who it is |
| Skills a resume leaves out | The **coursework twin** and the spoken **gap interview** bring out what they learned in class and outside it, and re-rank their matches |
| Hours of repetitive forms | **Autofill** and drafted materials, always approved by the student before anything is sent |
| Different ways of working | **Voice first**, with a typed option for every step, keyboard reachable, with captions for everything the agent says |

**Measuring it.** Most of what matters is already recorded by the app, so a pilot can be measured without new tracking:

| Outcome | How we would measure it | Recorded in |
|---|---|---|
| Students reach people who can help | Alumni introductions made, and questions asked, per student | `alumni_connections` |
| Students apply sooner and more often | Time from sign-up to first application, applications per student per week | `application_events` |
| Applications turn into interviews | Share of applications that reach the interviewing stage | `application_events` |
| Students are protected from fake employers | Employers refused, and why, before any data left the student | `a2a_audit` |
| Hidden skills come to light | Skills confirmed in the gap interview, and how far the affected matches moved | `profile_gaps`, `job_matches` |
| Students feel more confident | A short survey at sign-up and after four weeks | Opt-in survey |

**A realistic pilot.** One semester with an opt-in cohort recruited through the UMBC Career Center and student organizations, measured against the same students' starting point. Results are reported in aggregate only, and anything that separates first-generation or commuter students comes from the opt-in survey, never inferred. The next step is Baltimore-area employers joining as verified employers, then other University System of Maryland campuses.

---

## ✨ What's in it

| Feature | Description | Status |
|---|---|---|
| 🗣️ **Talking agent face** | A three.js face with six moods (idle, listening, thinking, speaking, happy, refusing). Tap it on the landing page and it introduces itself in its ElevenLabs voice. The clip is a saved file, so it costs nothing to play. | ✅ |
| 📄 **Resume intake** | A PDF goes straight to Cloud Storage. A Cloud Function reads it with Gemini into a versioned profile, and the progress page streams each step live. | ✅ |
| 🔎 **Profile enrichment** | GitHub (REST API), LinkedIn (Gemini with Google Search grounding) and the applicant's portfolio site, fanned out over Pub/Sub. | ✅ |
| 🧭 **Job scanning** | A Cloud Run Job sweeps 74 employer job boards through their public ATS JSON APIs (Greenhouse, Ashby, Lever), with no scraping and no LLM. | ✅ |
| 🎯 **Job matching** | Postgres full-text retrieval, then an eligibility gate (sponsorship, citizenship, clearance), then a Gemini rerank giving a 0–100 fit, a reason, and the skills you have and lack. | ✅ |
| 🧰 **Job toolbox** | Five instant rule-based reads of a posting, plus Gemini drafts (cover letter, answers, resume) behind a **fact gate**: a document that claims something your profile cannot back up cannot be printed. | ✅ |
| 🏢 **Employer check** | Is this company real? Checks where the posting came from, plus a live HTTPS handshake to the company's domain. | ✅ |
| ✍️ **Autofill (never submits)** | Gemini plans the answers, and a Playwright worker on Cloud Run fills the real Greenhouse, Lever or Ashby form and returns a screenshot. Submission is disabled at deploy time. | ✅ |
| 📋 **Pipeline board** | Seven stages (saved → applied → interviewing → offer → accepted, rejected, withdrawn) as columns across the page, stored as events rather than overwritten status. Change a role's stage from its card; save a role straight from the Jobs list. Roles at Interviewing or Offer get a **Start interview** button. | ✅ |
| 🔐 **Verified agent-to-agent apply** | Applying lives in the Agents tab's missions: the applicant agent seals and signs an application to the employer agent, and the employer reads its mailbox with a single-use signed credential. | ✅ |
| 🕵️ **Agents tab** | The A2A registry and a live audit trail of every envelope: who sent it, whether it verified, and why it was refused if it was. | ✅ |
| 🎓 **Alumni network** | Alumni matched to the student from the hackUMBC dataset, shown as mission cards, with agent-to-agent introductions. The Agents tab shows each exchange, with the cryptographic evidence one tap deeper. | ✅ |
| 🎮 **Game layer** | Daily energy, streaks, XP, levels and achievements for reaching out, all derived from existing rows with nothing extra stored. | ✅ |
| 🎓 **Coursework twin** | While the resume is processing, each applicant is matched to **one** current student from the hackUMBC dataset whose passed courses best fit the resume: same major, then the skills those courses teach (the dataset's 119-tag vocabulary), class level, track and course titles. No model call. It's made once and never changes, even after a new upload, and no student is given to two applicants. Shown on Profile, labelled synthetic, and counted as partial evidence when roles are ranked. Never added to the resume or to anything drafted. | ✅ |
| 🎤 **Gap interview** | On the Jobs page, the agent counts the skills your matched roles keep asking for that your resume doesn't show, and asks about the top two or three **out loud** (or in a typed form). Gemini turns each answer into a verdict with your own evidence, then only the roles those answers touch are re-scored, each rising by a capped amount. Answers never become resume lines, so the fact gate can't be fooled by a spoken "yes". | ✅ |
| 🎙️ **Mock interview room** | Rehearse for a role you've reached (Interviewing or Offer): a **live voice interviewer on Gemini Live** asks role-specific questions through a Cloud Run relay (`services/interview-live`) that keeps credentials server-side. The room owns the question order, each answer gets an instant critique, and the session ends with a readout. Every turn is saved to `voice_turns`. A typed and Gemini text-to-speech path covers a missing mic or relay. | ✅ |
| 🤝 **Agent dialogue** | For a role, your agent and the employer's agent hold a short conversation (up to ten messages, with a follow-up question), written by Gemini from your own profile and the posting's text. Stored apart from the real signed messages (`agent_dialogue`, not `a2a_messages`) and labelled as generated, so a written exchange can never pass for a delivered one. | ✅ |
| 🗣️ **Floating voice agent** | A draggable 3D agentHire face on every applicant page (it stays put as you switch tabs, like the chat). Press it, or its **mic-shaped nose**, to talk: it greets you, listens hands-free, answers out loud and listens again; press again to mute (a slash appears through the mic) or just say goodbye. Drag it anywhere; it remembers the spot and steps aside when the chat drawer opens. It answers from your own records: profile, top matches, pipeline and coursework. | ✅ |
| 💬 **Agent chat** | The right-hand chat drawer is the same agent, typed. It shows **one shared conversation**: what you typed, what you said to the floating agent (marked with a microphone), and a line for everything the agent looked up. Ask out loud and follow up in writing, or the other way round. It survives tab changes and reloads. | ✅ |
| 🎙️ **Voice routes** | ElevenLabs Scribe v2 (speech-to-text) and Flash v2.5 (text-to-speech) behind sign-in and a per-user rate limit, powering the gap interview and the floating agent. | ✅ |
| 🧑‍💼 **Employer mailbox** | Applications from verified applicant agents arrive sealed and signed; the employer opens them with a single-use signed credential. | ✅ |
| 🌌 **Landing page** | A WebGL star field, a 13-beat scroll story (including two "Built for students" beats on the alumni network and the game layer), a cost ledger, a fraud gate and a handshake explainer. | ✅ |

---

## 🛠️ Tech Stack

<table>
<tr><td valign="top" width="50%">

**Frontend**
- **Next.js 16 App Router** + **React 19** + **TypeScript**
- Plain CSS with a design-token layer (`globals.css`, `workspace.css`), no UI kit
- **three.js** via `@react-three/fiber` for the agent face and the star field
- **Motion** and **anime.js** for UI motion, **Lenis** for smooth scroll
- `lucide-react` icons, `next/font` (Forum) for zero-layout-shift type

</td><td valign="top" width="50%">

**AI & Voice**
- **Gemini on Vertex AI**: `@google/genai` with the service account for the pipeline and drafting, and REST with a Vertex Express key for the agent loop (`gemini-3.8-flash`, low thinking)
- Function calling with a bounded tool loop and grounded replies
- Google Search grounding for LinkedIn enrichment
- **ElevenLabs**: Scribe v2 (STT), Flash v2.5 (TTS), Multilingual v2 for the saved intro, voice "Charlie"

</td></tr>
<tr><td valign="top">

**Backend & Data**
- Next.js **Route Handlers**, all behind Firebase ID-token verification (`jose` against Google's JWKS)
- **Cloud SQL for PostgreSQL** via the Cloud SQL connector and `pg`; 16 SQL migrations
- Event-sourced pipeline (`application_events` → `latest_application_state` view)
- **Cloud Functions gen2** triggered by Eventarc (GCS upload) and **Pub/Sub** (`resume-parsed` → `profile-enriched` / `jobs-matched`)
- **Playwright** Chromium on Cloud Run for form autofill

</td><td valign="top">

**Security (A2A)**
- **ES256 (P-256) compact JWS** envelopes with `iss/aud/jti/iat/exp` and a 120 s maximum age
- **ECDH P-256 → HKDF-SHA256 → AES-256-GCM** sealing, with the envelope bound in the AAD
- Replay protection via a primary key on seen envelope IDs
- Domain-anchored agent names (`agent://v1.<role>.<domain>`), revocation, and a 5-dimension trust index
- Only `node:crypto`, with no crypto dependencies

</td></tr>
<tr><td valign="top">

**Cloud & Delivery**
- **Firebase Hosting** (web frameworks backend) in `us-east1` and **Firebase Auth** (email + Google)
- **Cloud Run**: agent gateway ×2, job matcher, ATS worker, the **interview-live** relay to Gemini Live (WebSocket, HMAC-signed session tickets); a Cloud Run **Job** for the scanner
- **Secret Manager** for every credential; **Cloud Storage** with owner-only rules
- **GitHub Actions** with Workload Identity Federation (no stored keys); a preview channel per PR, live deploy on `main`

</td><td valign="top">

**Accessibility & UX**
- The star field and the agent's face hold still under `prefers-reduced-motion`
- `aria-live` captions for everything the agent says, including every question and answer in the gap interview
- Keyboard-reachable face button, labelled controls, focus-visible outlines
- A two-colour system (paper and ink) with one typeface, Forum, across every page and field

</td></tr>
</table>

---

## 🏗️ Architecture

```mermaid
flowchart TD
    subgraph web["Next.js 16 on Firebase Hosting (frameworks backend)"]
        LP["Landing page<br/>agent face, star field, story"]
        WS["Applicant and employer workspaces<br/>jobs, gap interview, pipeline, network, agents, profile, mailbox"]
        API["Route handlers<br/>Firebase ID token on every call"]
    end
    subgraph data["Data"]
        SQL[("Cloud SQL Postgres<br/>users, profiles, jobs, matches,<br/>pipeline, artifacts, a2a, alumni dataset")]
        GCS[("Cloud Storage<br/>resume uploads")]
    end
    subgraph pipeline["Resume pipeline (Cloud Functions gen2)"]
        EX["extract-resume<br/>Gemini reads the PDF"]
        EN["enrich-github / linkedin / portfolio"]
        MJ["match-jobs<br/>full-text + eligibility + Gemini rerank"]
    end
    subgraph run["Cloud Run"]
        SC["job-scanner (Job)<br/>74 boards via ATS JSON APIs"]
        JM["job-matcher"]
        GW["agent-gateway<br/>employer agent + applicant agent"]
        AW["ats-worker<br/>Playwright autofill, never submits"]
    end
    GEM["Gemini on Vertex AI"]
    EL["ElevenLabs<br/>Scribe + Flash"]

    WS --> API
    LP -->|saved intro clip| LP
    API --> SQL
    WS -->|PDF upload| GCS
    GCS -->|object finalized| EX
    EX -->|resume-parsed| EN
    EX -->|resume-parsed| MJ
    EX --> GEM
    EN --> GEM
    MJ --> GEM
    EX --> SQL
    EN --> SQL
    MJ --> SQL
    SC --> SQL
    JM --> SQL
    API -->|drafts, autofill plan, agent loop| GEM
    API -->|voice| EL
    API -->|sealed + signed envelope| GW
    API -->|fill form| AW
    GW --> SQL
```

**A verified application, end to end:**

```
student approves an apply mission in the Agents tab
   → POST /api/a2a/apply                      (Firebase token, applicant role)
   → body sealed: ephemeral ECDH P-256 → HKDF-SHA256 → AES-256-GCM
   → sealed body signed: ES256 compact JWS  {iss, aud, jti, iat, exp ≤ 120 s}
   → agent-gateway /a2a/apply
        1. parse JWS, allow only ES256        6. check the name is anchored to its domain
        2. look up the sender's registered key 7. check the trust index (5 dims ≥ 65, mean ≥ 75)
        3. verify the signature                8. reject a replayed jti (primary key)
        4. check audience + expiry             9. decrypt, refusing plaintext
        5. refuse revoked registrations       10. store the message, audit the ciphertext hash
   → employer opens Applicants
   → GET /api/a2a/mailbox  → single-use signed read credential → gateway /messages
```

Every refusal is written to `a2a_audit` with its reason and shows up in the **Agents** tab. **A refused application releases nothing.**

---

## 🔐 The agent-to-agent trust protocol

| Piece | File | What it guarantees |
|---|---|---|
| **Identity** | `functions/agent-gateway/lib/identity.mjs` | Names look like `agent://v1.employer.agenthire.biz`. The endpoint must be HTTPS on a host under the claimed domain (dot-anchored, so lookalike domains fail), the role must match the name, and revoked registrations are refused. |
| **Envelope** | `lib/envelope.mjs` | ES256 compact JWS, `typ: agenthire-a2a+jws`, maximum age 120 s, key fingerprint = SHA-256 of the SPKI DER. |
| **Sealing** | `lib/sealing.mjs` | Ephemeral-static ECDH P-256 → HKDF-SHA256 (32-byte salt) → AES-256-GCM (12-byte nonce, 16-byte tag), with AAD `["a2a-seal-1", iss, aud, jti]`. The body is sealed before signing, so the signature covers the ciphertext. |
| **Trust index** | `lib/trust.mjs` | Five dimensions (integrity, identity, solvency, behavior, safety), each with a score **and a written reason**. Each must be at least 65, and the mean at least 75. |
| **Agent card** | `agent-card.json` | Publishes the scheme, encryption spec, required fields, trust policy and 30-day retention. |
| **Attack battery** | `test/attack-battery.mjs` | Offline checks that each of these is refused: impersonation, tampering, `alg:none`, wrong audience, expiry, lookalike domains, revoked keys, truncated or tampered GCM data, off-curve keys, plaintext downgrade, replay, and bad mailbox credentials. |

Run the battery: `node functions/agent-gateway/test/attack-battery.mjs`. The full protocol notes are in [`functions/README.md`](functions/README.md).

---

## 🎙️ Voice

| Piece | Where | Notes |
|---|---|---|
| **Landing intro** | `public/agenthire-intro.mp3` + `AgentGreeter.tsx` | *"Hi, I'm agentHire, your voice-first job agent. I match you to roles and verify every employer first."* Generated once with ElevenLabs, then served as a static file, so **playing it costs nothing**. If the line changes, the clip must be regenerated. |
| **Speech → text** | `POST /api/voice/stt` | ElevenLabs `scribe_v2`, with a 2 MB cap. |
| **Text → speech** | `POST /api/voice/tts` | ElevenLabs `eleven_flash_v2_5` in agentHire's voice, with an 800-char cap. The 40 most recent short lines are cached in memory. |
| **Floating agent** | `FloatingAgent.tsx` + `useVoiceAgent.ts` | Hands-free loop: listen, detect the end of speech from loudness, speech-to-text, `/api/agent`, text-to-speech, listen again. Every turn is written to the shared conversation (`conversation.tsx`) the chat drawer shows. Its greeting, *"Hi, I'm agentHire. Ask me about your job matches, your pipeline, or your profile."*, is a saved clip (`public/agenthire-dashboard-hello.mp3`), so switching it on costs nothing. |
| **Scripted voice** | `src/components/useVoiceIO.ts` | Speak one line, hear one answer, with the Firebase token attached. The gap interview uses it; stopping part-way drops into the typed form with what was already heard filled in. |
| **Mock interview** | `services/interview-live` + `/api/interview/[jobId]/*` | The browser streams 16 kHz microphone audio over a WebSocket to the relay, which talks to `gemini-live-2.5-flash-native-audio` on Vertex AI and streams the interviewer's 24 kHz voice back. A connection needs a ticket the web app signed for that one session. Without the relay, questions are read by Gemini text-to-speech and answers transcribed by Gemini. |

Both voice routes require sign-in and are limited to 60 calls per 10 minutes per user, so a runaway loop cannot drain credits.

---

## 🎨 Design System

One typeface everywhere. The landing page and the core workspace use two colours, paper and ink, with every other shade as ink at a lower opacity. The Network and Agents screens add an accent palette (violet, teal, coral, green) to tell activities and states apart.

| Token | Purpose |
|---|---|
| `--paper` `#ffffff` · `--ink` `#0b2545` | The only two colours on the site |
| `--line` · `--line-strong` · `--muted` · `--card` · `--wash` | Ink at 3–60% opacity for hairlines, secondary text and surfaces |
| `--font-sans` | **Forum**, self-hosted through `next/font`, used on every page, button and form field |
| `--radius` · `--glow` | Rounded cards, and a soft ink shadow on hover in place of borders |
| `--gutter` · `--page-inset` · `--nav-h` | Layout rhythm; full-bleed sections realign to the text column |

Wherever colour carries meaning, the same state also has an icon and a text label, so nothing depends on colour alone.

---

## 📁 Project Structure

```
.
├── src/
│   ├── app/
│   │   ├── page.tsx                 Landing page: face, star field, story, pathways
│   │   ├── signin/ · signup/        Firebase Auth (email + Google), role picked at sign-up
│   │   ├── applicant/               Workspace: overview, intake, jobs, job page, pipeline,
│   │   │                            network, apply, agents, profile, activity, account
│   │   ├── employer/                Workspace: overview, applicants mailbox, candidates, activity
│   │   └── api/                     Route handlers (see API reference)
│   ├── components/
│   │   ├── AgentFace*.tsx           The agent's face: SVG, three.js, lazy loader
│   │   ├── AgentGreeter.tsx         Tap-to-hear intro on the landing page
│   │   ├── useVoiceAgent.ts         Hands-free voice loop
│   │   ├── useVoiceIO.ts            Scripted voice: speak a line, hear an answer
│   │   ├── Starfield*.tsx           WebGL star field
│   │   ├── workspace/               Shell, nav, chat drawer, floating agent, shared conversation,
│   │   │                            jobs, pipeline, A2A, alumni, coursework
│   │   └── game/                    Energy, streak, XP, achievements, level-up
│   └── lib/
│       ├── agent/                   Gemini tool loop: client, tools (career + your own records), loop
│       ├── artifacts/               Posting reads, drafting, fact gate, print view
│       ├── match/ · autofill/       Eligibility, skill extraction, autofill evidence
│       ├── a2a-*.ts                 Applicant/employer agent keys, apply, mailbox
│       ├── coursework.ts            Coursework twin: resume → dataset student, transcript, rerank evidence
│       ├── gaps.ts                  Gap interview: rank gaps, ask, judge answers, rerank
│       ├── elevenlabs.ts            STT + TTS
│       ├── verify-token.ts          Firebase ID-token verification
│       └── db.ts · sql.ts           Postgres pool via the Cloud SQL connector
├── functions/
│   ├── agent-gateway/               A2A gateway (Cloud Run), dataset loader, attack battery
│   ├── profile-pipeline/            Extract, enrich ×3, match-jobs (Cloud Functions gen2)
│   ├── extract-resume/              Earlier cut of the pipeline without match-jobs
│   ├── job-scanner/                 Board sweeper (Cloud Run Job)
│   └── job-matcher/                 Skill + title matcher (Cloud Run)
├── services/ats-worker/             Playwright autofill (Cloud Run, private)
├── services/interview-live/         Mock-interview relay to Gemini Live (Cloud Run, WebSocket)
├── sql/                             001–010 Postgres migrations
├── public/agenthire-intro.mp3       Saved voice intro
├── storage.rules                    Owner-only, PDF-only, 10 MB, no overwrite
├── firebase.json                    Hosting with the web frameworks backend
└── .github/workflows/               Build + deploy (preview per PR, live on main)
```

---

## 🚀 Quick Start

**Prerequisites:** Node 20+, and access to the team's GCP project for secrets.

```bash
git clone https://github.com/nidhipoojari/UMBCHACK.git
cd UMBCHACK
npm install
cp .env.example .env.local        # then fill in the secrets below
npm run dev
```

Open **http://localhost:3000**. The landing page works with no secrets at all. Signing in needs Firebase (public values are already in `.env.example`), and the workspaces need the database.

**Secrets** live in Secret Manager in `project-96b6d773-106a-457a-a46`. Never commit them.

| Env var | Secret Manager name | Needed for |
|---|---|---|
| `DB_PASSWORD` | `agenthire-db-password` | Anything that reads or writes Postgres |
| `GEMINI_API_KEY` | `agenthire-gemini-api-key` | The career agent (`/api/agent`) |
| `ELEVENLABS_API_KEY` | `elevenlabs-api-key` | The voice routes |
| `ATS_WORKER_TOKEN` | `ats-worker-token` | Autofill |
| `A2A_*_KEY_PEM_B64` | agent key secrets | Applying and reading the mailbox |

```bash
gcloud secrets versions access latest --secret=agenthire-gemini-api-key \
  --project=project-96b6d773-106a-457a-a46
```

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint (including the React Compiler rules) |

---

## 🌐 API Reference

Every route requires a Firebase ID token (`Authorization: Bearer <token>`). "Applicant" means the account must also have the applicant role.

| Method & path | Access | What it does |
|---|---|---|
| `POST /api/users` | signed in | Record the sign-in, create the role profile, return the account |
| `GET /api/intake/[documentId]` | owner | Resume-processing status and step log |
| `GET /api/matches` | signed in | Latest job matches for the student |
| `GET /api/jobs/[jobId]` | applicant | Posting, saved match, pipeline stage |
| `GET·POST /api/jobs/[jobId]/analyze` | applicant | Five instant rule-based reads of the posting |
| `GET /api/jobs/[jobId]/toolbox` | applicant | Reads, existing drafts, whether drafting is possible |
| `POST /api/jobs/[jobId]/generate` | applicant | Gemini draft (cover letter, answers, resume) + fact gate |
| `GET /api/jobs/[jobId]/artifacts` | applicant | Saved drafts |
| `GET /api/jobs/[jobId]/print/[artifactId]` | applicant | Printable view; refuses drafts that failed the fact gate |
| `GET /api/jobs/[jobId]/employer` | applicant | Is this company real? |
| `POST /api/jobs/autofill` | applicant | Gemini plan + Playwright fill; never submits |
| `GET /api/pipeline` · `POST /api/pipeline/status` | applicant | Pipeline board and stage changes |
| `GET /api/alumni` · `POST /api/alumni/connect` | signed in | Alumni network and introductions (429 when energy is spent) |
| `GET /api/game` | signed in | Energy, streak, XP, level |
| `GET /api/a2a` | signed in | Agent roster and audit counts |
| `GET·POST /api/a2a/apply` | applicant | List matches, send a sealed application |
| `GET /api/a2a/mailbox` | employer | Read the employer agent's inbox |
| `GET·POST /api/coursework` | applicant | GET: the coursework twin's transcript for Profile. POST: match one now if there is none (idempotent; 409 without a parsed resume) |
| `GET·POST /api/gaps` | applicant | GET: the skills the gap interview would cover. POST: start it (up to 3 spoken questions) |
| `POST /api/gaps/answers` | applicant | Judge the answers, save them on `profile_gaps`, re-score the touched matches (409 if nothing was asked, 429 while a rerank is running) |
| `POST /api/agent` | signed in | One turn with the agent: career tools, your own profile / matches / pipeline / coursework (by your verified uid, never the model's arguments), and `end_conversation`. Returns `{ reply, toolCalls, end? }` |
| `GET /api/interview/[jobId]/session` | applicant | Everything the interview room needs (locked unless the role is at Interviewing or Offer) |
| `POST /api/interview/[jobId]/live` | applicant | A signed ticket and URL for one live call with the interviewer |
| `POST /api/interview/[jobId]/speak` · `/transcribe` | applicant | A question read aloud by Gemini; a spoken answer transcribed by Gemini |
| `POST /api/interview/[jobId]/turn` · `/finish` | applicant | Log and critique one answer; end the session and return the readout |
| `GET·POST /api/agents/dialogue` | applicant | Read, or write once, the agents' generated conversation about one role |
| `POST /api/voice/stt` · `/tts` | signed in, rate-limited | ElevenLabs speech in and out |

---

## ☁️ Deployment

```
push to main  →  GitHub Actions (WIF, no stored keys)  →  next build  →  firebase deploy --only hosting
pull request  →  same build  →  preview channel pr-<n> (expires in 7 days)
```

- The web app runs on **Firebase Hosting's web frameworks backend** in `us-east1`, so route handlers run server-side.
- Backend services deploy separately with their own `deploy.sh` scripts (Cloud Functions in `us-east4`, Cloud Run services and jobs).
- New server-side secrets must be added to the hosting backend's environment before the routes that use them work in production.

---

## 🗺️ Routes

| Route | Contents | Status |
|---|---|---|
| `/` | Landing page: agent face with voice intro, star field, story, pathways | ✅ |
| `/signin` · `/signup` | Email or Google; `?role=applicant\|employer` | ✅ |
| `/applicant/intake/resume` → `/progress` | Upload a PDF, watch the profile build and the coursework twin get matched; Next leads to the gap interview | ✅ |
| `/applicant` | Redirects to Jobs (the overview now lives there) | ✅ |
| `/applicant/jobs` · `/jobs/[jobId]` | Matches with the spoken gap interview, and the job page with toolbox, employer check and autofill | ✅ |
| `/applicant/pipeline` | Seven stage columns, stage control on each card, **Start interview** for Interviewing / Offer | ✅ |
| `/applicant/interview/[jobId]` | The mock interview room with the live voice interviewer | ✅ |
| `/applicant/network` | Alumni network + game HUD | ✅ |
| `/applicant/agents` | Agent missions (apply, outreach), A2A registry and audit. `/applicant/apply` redirects here | ✅ |
| `/applicant/profile` · `/account` | Profile facts, the Coursework card, account | ✅ |
| every `/applicant/*` page | The floating voice agent and the chat drawer, sharing one conversation | ✅ |
| `/employer/applicants` | Mailbox of verified applications | ✅ |

---

## 🧾 Data, attribution & AI use

- **Dataset:** alumni, students, transcripts, employment history, experience and the course catalog come from the hackUMBC 2026 dataset (`jasonpaluck/hackumbc-2026`), loaded by `functions/agent-gateway/load-dataset.mjs`. The DoIT track describes it as **synthetic**; nothing in agentHire should be read as real UMBC outcomes. Each applicant's coursework twin is a synthetic student's transcript standing in for their own, and is labelled that way everywhere it appears.
- **career-ops (MIT):** the ATS providers, URL and user-agent helpers in `functions/job-scanner/lib/` and parts of the job-matcher skill and title matching are adapted from [santifer/career-ops](https://github.com/santifer/career-ops) v1.33.0, © 2026 Santiago Fernández de Valderrama, under the MIT License (`functions/job-scanner/lib/LICENSE.career-ops`). Several helpers in `src/lib/artifacts/` carry the same MIT header.
- **AI use:** the team built this with Claude as a coding assistant. At runtime, Gemini powers extraction, enrichment, matching, drafting, autofill planning and the agent, and ElevenLabs provides the voice.

---

## 📝 Changelog

| When (EDT) | What changed |
|---|---|
| Sun Sep 27, ~07:45 | Mock interview room with a live Gemini Live voice interviewer (`services/interview-live`, `voice_turns`); generated agent-to-agent dialogue per role (`agent_dialogue`, up to ten messages with a follow-up); pipeline as stage columns with the stage control on each card; save roles from Jobs; clickable job cards and banded fit scores; Overview folded into Jobs |
| Sun Sep 27, ~05:20 | Floating voice agent on every applicant page (draggable, mic-nose switch, hands-free, answers from your own profile, matches, pipeline and coursework, ends itself on goodbye); the chat drawer connected to the agent, showing one shared typed + spoken conversation |
| Sun Sep 27, ~05:15 | README: community impact section for the STARS track (the need, what agentHire does about it, and how a UMBC pilot would measure it from data the app already records); tracks and features described as they work today |
| Sun Sep 27, ~04:15 | Coursework twin: every applicant matched once to a unique hackUMBC dataset student during resume processing, a Coursework card on Profile, and coursework counted as partial evidence in the gap interview's re-ranking (`coursework_twins`, `009`); apply moved into agent missions |
| Sun Sep 27, ~03:35 | Landing page speaks to students: two new "Built for students" beats in How it works (alumni network, streaks and XP), student card and feature marquee updated |
| Sun Sep 27, ~02:45 | Gap interview on the Jobs page (spoken or typed, capped re-scoring of affected matches); alumni network and Agents tab revamped as missions with a secure agent line; avatar initials back in Forum |
| Sun Sep 27, ~02:00 | Voice agent: Gemini tool loop, ElevenLabs STT/TTS routes, tap-to-hear saved intro on the landing page; Forum across every page and form field; this README |
| Sun Sep 27, ~01:30 | Pipeline board, job page, toolbox with fact gate, autofill worker; employer apply + mailbox via the gateway; game layer (energy, streak, XP, levels) |
| Sat Sep 26 – Sun Sep 27 | A2A gateway with signing, sealing and the attack battery; alumni network on the hackUMBC dataset; job scanner + matcher |
| Sat Sep 26, evening | Firebase auth, applicant/employer workspaces, resume intake pipeline, server deploy on Firebase Hosting |
| Sat Sep 26, afternoon | Landing page, agent face, star field |

---

<div align="center">

**Live:** [agentHire](https://project-96b6d773-106a-457a-a46.web.app) · **Repo:** [nidhipoojari/UMBCHACK](https://github.com/nidhipoojari/UMBCHACK)

Built at **hackUMBC 2026** by **Nidhi Poojari**, **Tarang Nair**, **Vijay Vanapalli** and **Krutika Raut** — Baltimore, MD

</div>
