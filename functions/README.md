# functions/

Everything that runs outside the Next.js app. Four deployables, all in
`project-96b6d773-106a-457a-a46`, region `us-east1` except where noted.

| Directory | Runs as | Trigger | What it does |
| --- | --- | --- | --- |
| `job-scanner` | Cloud Run **Job** | manual (a schedule is not yet set) | Sweeps 74 ATS boards, writes `job_snapshots` |
| `job-matcher` | Cloud Run **Service** | `POST /match` | Ranks fresh US postings against a candidate |
| `agent-gateway` | Cloud Run **Service** ×2 | `POST /a2a/apply` | Verified agent-to-agent messaging |
| `extract-resume` | Cloud **Function** (gen 2), `us-east4` | new object in `gs://agenthire-uploads-…` | Resume upload → structured profile |

Schema for all of this lives in `../sql/`, not beside the code, so there is one
ordered migration history rather than several.

## agent-gateway runs twice

One image, two deployments, differing only in environment:

| Service | `AGENT_NAME` | accepts from | requires |
| --- | --- | --- | --- |
| `agent-gateway` | `agent://v1.employer.agenthire.biz` | applicant | `full_name, email, resume_url` |
| `applicant-agent` | `agent://v1.applicant.agenthire.biz` | employer | `job_id, message` |

The code is role-agnostic on purpose: an employer receiving an application and
a candidate receiving an invitation are the same verification problem.

## Private keys are not in this repo

Each registered agent signs with an EC P-256 key whose public half is pinned in
`a2a_agents`. The private halves are not committed and `.gitignore` refuses
`*.key` / `*.pem` under this directory. Losing one means re-registering that
agent with a fresh keypair, which is a row update — not a code change.

## Running the tests

`agent-gateway` has an adversarial battery that needs no database or network:

```
cd functions/agent-gateway && node test/attack-battery.mjs
```

It asserts the refusals — impersonation, tampering, `alg: none`, wrong
audience, expiry, off-domain endpoints, lookalike domains, revoked
registrations, unscored trust dimensions. Replay is the one check it does not
cover, because asserting it against a mock would only prove the mock works; it
is exercised against the real `PRIMARY KEY` in deployment.
