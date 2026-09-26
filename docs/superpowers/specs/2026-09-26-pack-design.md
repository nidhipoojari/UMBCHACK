# Pack — Offline Campus Agent for UMBC Students

**Date:** 2026-09-26 · **Event:** hackUMBC 2026 · **Team:** 4 · **Build window:** 24 h (Devpost deadline Sun 11:00 AM, target 10:00 AM)
**Status:** Design approved in chat; this spec is the build reference.

---

## 1. Summary

Pack is an Android app with a personal AI agent that runs on the phone (Gemma 4 E2B) and **works with no internet**. As a student uses it, the agent builds a private memory of their courses, skills and interests. When another Pack user is nearby, the two agents talk over Bluetooth and quietly check whether the students share interests. If they do, both phones suggest an icebreaker, and the students connect only if both agree. When the phone is online, the app also uses Gemini with Google Search to find UMBC events that fit the student's memory and sends a notification about them. **Last phase (built only after everything else works):** the local agent can open other apps for the student (Chrome, Calendar, Maps, SMS) with the details filled in.

**One-line pitch:** "Your offline campus sidekick that finds your people and your events — even in airplane mode."

## 2. Goals and success criteria

| # | Goal | Done when |
|---|---|---|
| G1 | Local agent works fully offline | In airplane mode (Bluetooth on), a chat turn with Gemma returns an answer in under 10 s on the demo phone |
| G2 | Agent-to-agent discovery and icebreaker | Two phones within 3 m discover each other, compute shared interests, and both show an icebreaker notification within 30 s |
| G3 | Both must opt in | Profiles are exchanged only after **both** users tap Connect; chat messages then travel over Bluetooth |
| G4 | Memory that grows as the app is used | Stating a new interest in chat adds a tag that changes the next match or event ranking |
| G5 | Proactive event suggestions (online) | With Wi-Fi on, Refresh returns at least 3 real UMBC-area events in structured form and sends a notification for the best match |
| G6 | Uses the DoIT dataset | Onboarding skill tags and the career card come from the bundled `campus.db` built from the hackUMBC dataset |
| G7 | Phone actions (**last phase, after the hour-16 checkpoint**) | "Add X to my calendar" opens the Calendar insert screen pre-filled; "open the event page" opens Chrome to the URL |

G1–G6 are the core; the app ships without G7 if time runs out.

**Out of scope:** iOS; accessibility-service UI automation (stretch goal only); multi-hop mesh relay; cloud sync of memory; accounts and login; publishing to the Play Store.

## 3. Hackathon tracks targeted

| Track | Our angle | Required evidence |
|---|---|---|
| **DoIT – Career Pathways & Degree ROI** (primary) | Memory is seeded from the DoIT dataset's skill vocabulary; an offline "students like you became…" career card; peer matches can suggest complementary skills | Devpost says which files are used (`course_catalog`, `alumni`, `employment_history`, `student_experience`); career card shown in the demo |
| **STARS – Community Impact** | UMBC students often feel isolated, and events are scattered across many channels | Impact plan (§11) |
| **MLH – Best Use of Gemini API** | Hybrid routing: Gemini + Search grounding for events | Code link + demo step |
| **Most Engaging Demo** | A judge holds phone B, which buzzes with an icebreaker | Demo script (§10) |
| **Overall / Best Entrepreneurial** | Offline-first, privacy-preserving social agent | Pitch: users, business model (campus licensing / student orgs promoting events) |
| **Health Beyond the Clinic** (secondary) | Student isolation and mental wellbeing | One pitch slide |
| **MLH – DigitalOcean** (optional) | Host the events cache endpoint (§6.6) on App Platform | Deployed URL |
| **MLH – GoDaddy domain** (10 min) | e.g. `findyourpack.tech` | Domain registered |

## 4. Architecture

```
┌──────────────────── Flutter app (Android only) ────────────────────┐
│ UI: Onboarding · Agent Chat · Nearby · Events · Career Card        │
├────────────────────────────────────────────────────────────────────┤
│ AgentCore — routes each request, runs the tool loop                │
│   ├─ LocalLLM   flutter_gemma → Gemma 4 E2B (fallback Gemma 3 1B)  │
│   ├─ CloudLLM   Gemini REST (Flash-Lite) + google_search grounding │
│   └─ Tools      core: remember · career_paths · search_events      │
│                 last phase: open_url · add_calendar_event ·        │
│                 open_maps · draft_sms                              │
│ Memory      sqflite (memory.db): facts, tags, embeddings           │
│ CampusPack  bundled read-only campus.db (from the DoIT dataset)    │
│ PeerMesh    nearby_connections, Strategy.P2P_CLUSTER               │
│ Notifier    flutter_local_notifications + workmanager              │
└────────────────────────────────────────────────────────────────────┘
```

**Routing rule (AgentCore):** default to LocalLLM. Use CloudLLM only when the device is online (`connectivity_plus`) **and** the task needs the web (event search, or a question the user explicitly marks "search the web"). Every feature except event search must work offline.

### 4.1 Packages (verify versions on hour 0)

| Need | Package |
|---|---|
| On-device LLM + embeddings | `flutter_gemma` (Gemma 4 E2B `.litertlm`; EmbeddingGemma for embeddings) |
| Bluetooth P2P | `nearby_connections` |
| Local DB | `sqflite` |
| Gemini | Plain REST via `http` (avoids SDK churn); model `gemini-3.5-flash-lite` or the newest Flash-Lite listed at ai.google.dev |
| Intents | `android_intent_plus`, `url_launcher` |
| Notifications / background | `flutter_local_notifications`, `workmanager` |
| Connectivity | `connectivity_plus` |
| Hashing | `crypto` |
| Permissions | `permission_handler` |

Android permissions: `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, `NEARBY_WIFI_DEVICES`, `ACCESS_FINE_LOCATION`, `POST_NOTIFICATIONS`, `INTERNET`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`. `minSdk 26`, target the latest SDK.

## 5. Data

### 5.1 CampusPack (`assets/campus.db`, built by `tools/build_campus_pack.py`)

Source: https://github.com/jasonpaluck/hackumbc-2026 (synthetic). Use `data/sample/` while building, then the full data for the final build. Remember: `Not Applicable` is a literal string, and the list columns are pipe-delimited.

| Table | Columns | Built from |
|---|---|---|
| `courses` | course_id, title, subject, level, difficulty | course_catalog |
| `course_skills` | course_id, skill | course_catalog.skill_tags, split on `\|` |
| `skills` | skill (unique, ~119 rows) | union of skill_tags and role_skill_tags |
| `track_outcomes` | major, track, first_job_title, job_family, n, median_salary, median_months_to_job | alumni grouped by major, track, first_job_title |
| `role_skills` | job_title, skill, freq | employment_history.role_skill_tags, entry-level roles |
| `activity_types` | experience_type, experience_name, n | student_experience |

Target size under 5 MB. The script prints row counts as a sanity check.

### 5.2 Memory (`memory.db`, on device, never leaves the phone except as in §6.3)

```sql
profile(id INTEGER PRIMARY KEY CHECK(id=1), first_name TEXT, major TEXT, track TEXT,
        class_level TEXT, share_first_name INTEGER DEFAULT 1);
memory_item(id INTEGER PRIMARY KEY, kind TEXT CHECK(kind IN ('fact','interest','course','event_feedback')),
            text TEXT NOT NULL, source TEXT, created_at INTEGER, embedding BLOB);
interest_tag(tag TEXT PRIMARY KEY, weight REAL DEFAULT 1.0, source TEXT, updated_at INTEGER);
peer(id TEXT PRIMARY KEY, display_name TEXT, shared_tags TEXT, connected_at INTEGER);
peer_message(id INTEGER PRIMARY KEY, peer_id TEXT, from_me INTEGER, body TEXT, ts INTEGER);
event_cache(id TEXT PRIMARY KEY, title TEXT, starts_at TEXT, location TEXT, url TEXT,
            tags TEXT, score REAL, notified INTEGER DEFAULT 0, fetched_at INTEGER);
```

**Tag vocabulary:** the dataset's ~119 skills plus a hand-written list of about 40 interest tags (e.g., `robotics`, `anime`, `basketball`, `hackathons`, `music-production`, `volunteering`). Every tag is lowercase and uses kebab-case. Tags outside the vocabulary are mapped to the nearest vocabulary tag by embedding similarity (cosine ≥ 0.75), or dropped.

**How memory grows:**
1. Onboarding: the student picks a major, a track and courses taken → the courses' skills are saved as `interest_tag` with weight 1.0 and source `course`. They also tick interests from the hand-written list.
2. Chat: after each user turn, the model calls the `remember` tool (§6.2) when the user shares a fact or interest. The tag weight goes up by 0.5 (maximum 3.0).
3. Event feedback: 👍 adds 0.3 to that event's tags, and 👎 subtracts 0.3.

Retrieval for chat context: embed the user message, take the top 5 `memory_item` rows by cosine similarity (brute force is fine at this size), plus the top 10 tags by weight, and inject them into the system prompt.

## 6. Components

### 6.1 LocalLLM
- Model: Gemma 4 E2B instruction-tuned, LiteRT-LM format, **downloaded on first launch** (about 2.5 GB) to app storage, not bundled in the APK. Load both demo phones the night before.
- Fallback: Gemma 3 1B if E2B takes longer than 10 s per turn or won't load.
- Keep one model instance per app session. Stream tokens to the UI.

### 6.2 Tools (function calling)

The model emits JSON matching one of these schemas. AgentCore validates it; if the JSON is invalid, it retries once with the error message, then falls back to a plain-text answer.

**Core tools (build first):**

| Tool | Args | Effect |
|---|---|---|
| `remember` | `{text, tags[]}` | Insert into `memory_item`; add weight to tags |
| `career_paths` | `{major?, track?}` | Query `track_outcomes` and `role_skills` → shown as the Career Card |
| `search_events` | `{}` | Only offered when online; hands off to CloudLLM (§6.4) |

**Phone-action tools (last phase — start only after the hour-16 G1–G6 checkpoint passes):**

| Tool | Args | Effect |
|---|---|---|
| `open_url` | `{url}` | `ACTION_VIEW` → Chrome |
| `add_calendar_event` | `{title, start_iso, end_iso?, location?}` | `Intent.ACTION_INSERT` on `CalendarContract.Events`, pre-filled |
| `open_maps` | `{query}` | `geo:0,0?q=<query>` intent |
| `draft_sms` | `{body, to?}` | `ACTION_SENDTO smsto:` — the user presses send themselves |

Every action tool opens the target app. Nothing is sent or saved without the user confirming in that app. Until this phase is built, the Event detail screen offers only a plain "Open page" link via `url_launcher`.

**System prompt (local):** a short persona ("You are Pack, a UMBC student's offline sidekick"), today's date, the profile, the top tags, the retrieved memories, the tool schemas, and the instruction "Call a tool when an action is requested; call `remember` when the user shares a stable fact or interest."

### 6.3 PeerMesh (Bluetooth protocol)

- Service ID: `edu.umbc.pack.v1`. Strategy: `P2P_CLUSTER`.
- Endpoint name: a random 6-character ID, **changed every 10 minutes** (restart advertising). It never contains a name or a stable ID.
- Advertise and discover while the Nearby screen is open, or while a foreground service is running (type `connectedDevice`).
- Connections are auto-accepted for the handshake only. All payloads are UTF-8 JSON `BYTES`, each with a `type` and `msg_id` (UUID, used to drop duplicates).

**Messages:**
```jsonc
{"type":"HELLO","msg_id":"…","v":1,"nonce":"<16B base64>"}
{"type":"TAGS","msg_id":"…","hashes":["<8B hex>", …]}   // up to 20 top tags
{"type":"INTEREST","msg_id":"…","want_connect":true}
{"type":"PROFILE","msg_id":"…","first_name":"Ava","shared_tags":["robotics","ml"]}
{"type":"CHAT","msg_id":"…","body":"hey!","ts":1790000000}
{"type":"BYE","msg_id":"…"}
```

**Handshake:**
1. Both sides send `HELLO` with a random nonce. `session_salt = SHA256(sort(nonceA, nonceB))`.
2. Both send `TAGS`, where each hash is `HMAC-SHA256(session_salt, tag)` truncated to 8 bytes, covering their top 20 tags by weight.
3. Each side computes the overlap locally. If the overlap has 2 or more tags → LocalLLM writes a one-sentence icebreaker from **its own** plain-text copies of the overlapping tags → local notification: "Someone nearby also likes robotics & ML — '…icebreaker…'. Connect?"
4. When a user taps Connect → send `INTEREST`. When a phone has both sent and received `INTEREST` → exchange `PROFILE` → save a `peer` row → open the chat.
5. If the overlap is under 2 tags, or no one taps within 5 minutes → send `BYE` and disconnect. Suppress re-matching the same pairing for 30 minutes (keyed on the nonce pair, stored in memory only).

**Honest privacy note (put this on Devpost):** salted hashes stop passive listeners and cross-session tracking. They do **not** stop an active peer from guessing tags from our small vocabulary. Stretch goal: Diffie-Hellman PSI (blinding each tag with a per-session secret) so a peer learns only the overlap.

Reliability: auto-reconnect once on disconnect; a manual "Scan again" button; the demo needs Bluetooth and Wi-Fi radios switched on (Nearby no longer toggles them for apps).

### 6.4 CloudLLM and Events
- Trigger: a `workmanager` periodic task every 3 h (when online), plus a Refresh button on the Events screen.
- Request: Gemini `generateContent` with the `google_search` tool enabled. Prompt: "Find 5–8 public events at or near UMBC (Baltimore County, MD) in the next 7 days relevant to these interests: {top 8 tags}. Return only JSON: [{title, starts_at_iso, location, url, tags[]}]." Parse the JSON leniently: strip code fences and discard items missing a title or date.
- Ranking: `score = cosine(embed(title+tags), profile_vector) + 0.2 × tag_overlap_count`, where `profile_vector` is the tag embeddings averaged by weight. Upsert into `event_cache`.
- Notify for the top 1–2 events with a score above a threshold that haven't been notified yet: "🎉 ML Club lightning talks Thu 6pm — matches your interest in ML." Tapping it opens Event detail with an Open page link (Add to calendar and Directions are added in the last phase, reusing the phone-action tools).
- Fallback: `assets/events_fallback.json` (checked by hand on Saturday) is used when offline or rate-limited.
- API key: compile-time `--dart-define=GEMINI_KEY=…`, never committed. (The optional DigitalOcean proxy in §6.6 removes the key from the APK.)

### 6.5 UI screens
1. **Onboarding**: first name → major/track (from `campus.db`) → courses taken (multi-select) → interest chips → model download progress.
2. **Agent Chat**: streaming replies; tool results appear as cards (Career Card, "Opened Calendar").
3. **Nearby**: a pulsing radar animation, a live count of discovered agents, match cards with the icebreaker and Connect, and a list of connected peers leading into Bluetooth chat.
4. **Events**: ranked list, 👍/👎, Refresh, and an offline badge when showing cached or fallback results.
5. **Me**: tags with weights (editable and deletable), a "Forget everything" button, and a Bluetooth sharing toggle.

### 6.6 Optional: events proxy (DigitalOcean)
A tiny FastAPI service with `POST /events {tags[]}` that calls Gemini, caches results for 1 h, and returns the JSON. Build it only if time allows after hour 16.

## 7. Error handling

| Failure | Behavior |
|---|---|
| Model not downloaded or fails to load | Chat shows "Offline brain loading…"; offer the Gemma 3 1B fallback |
| Model outputs an invalid tool call | Retry once with the error, then reply in plain text |
| Bluetooth permission denied | Nearby screen explains why and links to settings |
| Peer drops mid-handshake | Discard the session state; rediscovery restarts the handshake |
| Gemini error, 429, or offline | Use `event_cache`, then `events_fallback.json`; show the offline badge |
| Intent target app missing | Toast "No app found for this action" |

## 8. Testing
- **Unit (Dart):** tag hashing and overlap (both sides get the same result), event JSON parsing (fences, missing fields), ranking, tool-call validation.
- **Python:** `build_campus_pack.py` checks row counts and that the pipe-delimited columns split correctly.
- **Device checks (manual, on both phones):** G1–G6 as a checklist at hour 16; G1–G7 at hour 21 if the last phase was built.
- **Two-emulator note:** Nearby does not work between emulators, so all Bluetooth testing needs the two real phones.

## 9. Team split and timeline

| Owner | Area |
|---|---|
| **P1 – Mesh** | PeerMesh, handshake, Nearby UI, Bluetooth chat |
| **P2 – Brain** | flutter_gemma setup, AgentCore, core tools, chat UI; phone-action tools in the last phase |
| **P3 – Memory & Data** | `build_campus_pack.py`, `campus.db`, memory.db, embeddings, onboarding, Career Card |
| **P4 – Cloud & Story** | Gemini events, ranking, notifications, workmanager, fallback JSON, Devpost, pitch, video, domain |

| Hours | Milestone |
|---|---|
| 0–1 | Flutter scaffold in the repo; agree on package versions; each person on their own branch |
| 1–4 | **Risk spikes:** Gemma replies on phone A (P2); two phones exchange JSON over Nearby (P1); `campus.db` built (P3); Gemini with grounding returns events JSON (P4) |
| 4–10 | Each component works on its own against stub interfaces |
| 10–16 | Integration: onboarding → memory → match → icebreaker; chat → core tools; events → notification |
| 16 | Run the G1–G6 checklist; freeze core features |
| 16–20 | Polish UI and fix bugs on the core |
| 20–21 | **Last phase:** phone-action tools (G7) — only if G1–G6 are solid; otherwise skip |
| 21–23 | Record the backup video, write the Devpost page, rehearse the pitch twice |
| 23–24 | Submit (target 10:00 AM) |

**Kill switches:** if Gemma isn't replying on the phone by hour 4 → switch to Gemma 3 1B. If Nearby isn't exchanging messages by hour 6 → drop the chat and keep only match plus icebreaker. If it's still broken at hour 10, show matching as a two-phone QR-scan fallback and be upfront about it.

## 10. Demo script (≈3 min, 2 phones)
1. "Everything you see runs in airplane mode." Show both phones (airplane mode on, Bluetooth on).
2. Phone A chat: "What could I do with my Data Science track?" → Career Card from DoIT data (offline).
3. Hand phone B to the judge. Both phones buzz: "Someone nearby also loves robotics & ML — 'Ask them what they'd build with a Jetson.'" Both tap Connect → Bluetooth chat.
4. Turn Wi-Fi on → Refresh events → Gemini returns real events → notification arrives.
5. *(Only if G7 was built)* Phone A: "Add that event to my calendar and show me how to get there." → Calendar opens pre-filled, then Maps.
6. Close: privacy (hashed tags, double opt-in, memory stays on the phone), impact metrics, tracks.

## 11. Impact plan (STARS)
- **Problem:** commuter-heavy campus and scattered event channels → students struggle to find peers and events.
- **Metrics:** connections made per active user per week; share of event notifications that lead to an "Add to calendar"; a 2-question belonging survey (UCLA-3 loneliness short form) before and after 2 weeks.
- **Pilot:** 50 students recruited through 3 student organizations. Metrics are logged on the device and shared only if the student opts in.
- **Environmental cost note:** on-device inference avoids data-center calls for most requests; only event search uses the cloud.

## 12. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Gemma is slow or runs out of memory on the phones | Medium | Test at hour 1; Gemma 3 1B fallback; keep prompts short |
| 2.5 GB model download over venue Wi-Fi | High | Download at home the night before; keep a copy on a laptop and push it with `adb push` |
| Nearby is flaky in a noisy hall | Medium | Phones within 1–2 m; both radios on; foreground screen; reconnect; backup video |
| Gemini free-tier limits | Low | Flash-Lite; caching; fallback JSON |
| Model hallucinates event details | Medium | Events come only from grounded Gemini; show the URL; the user confirms in Calendar |
| Scope creep | High | Hour-16 feature freeze; out-of-scope list in §2 |

## 13. Stretch goals (only after G1–G6 pass)

Priority order after the core: **phone-action tools (G7) come first**, then the items below.

1. Diffie-Hellman PSI for tag matching.
2. One scripted accessibility-service action (e.g., search inside Chrome).
3. DigitalOcean events proxy (§6.6).
4. "Complementary skills" matches (you know Python, they want to learn it) using `role_skills` gaps.
