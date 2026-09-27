# functions/

Everything that runs outside the Next.js app. Four deployables, all in
`project-96b6d773-106a-457a-a46`, region `us-east1` except where noted.

| Directory | Runs as | Trigger | What it does |
| --- | --- | --- | --- |
| `job-scanner` | Cloud Run **Job** | manual (a schedule is not yet set) | Sweeps 74 ATS boards, writes `job_snapshots` |
| `job-matcher` | Cloud Run **Service** | `POST /match` | Ranks fresh US postings against a candidate |
| `agent-gateway` | Cloud Run **Service** ×2 | `POST /a2a/apply` | Verified, sealed agent-to-agent messaging |
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

## Signing and sealing are two different things

The envelope does both, and the distinction is load-bearing — this section used
to be shorter, and shorter was wrong.

**Signing** (`lib/envelope.mjs`, ES256 over P-256) gives **authenticity and
non-repudiation**: the receiver knows which registered agent wrote the envelope,
and can still prove it to a third party afterwards. It gives **no
confidentiality whatsoever**. A JWS claims segment is base64url, not ciphertext;
anyone who can read the channel reads the application.

**Sealing** (`lib/sealing.mjs`) is what gives **confidentiality**. The body is
encrypted to the recipient before the envelope is signed:

| | |
| --- | --- |
| Key agreement | ECDH P-256 — a per-message ephemeral sender key against the recipient's key pinned in `a2a_agents` |
| Key derivation | HKDF-SHA256, 32-byte random salt per message. The raw ECDH output is never used as a key |
| Cipher | AES-256-GCM, fresh 12-byte nonce per message, full 16-byte tag |
| Binding | The GCM AAD is `["a2a-seal-1", iss, aud, jti]`, so a ciphertext does not open in a different envelope |

The sender key is ephemeral rather than its pinned identity key, which costs a
field on the wire and buys forward secrecy: static-static ECDH between two
long-lived keys derives the same secret forever, so one leaked private key would
retroactively open every application ever exchanged with that agent, including
captured ones. The authenticity that static-static would have provided we
already have from the signature, in a stronger form.

**A signed plaintext body is refused.** Encryption that the sender can decline
is not a property of the endpoint.

### What this protects against, and what it does not

Prevented: reading an application off the channel; altering a ciphertext
undetected; opening a body without the recipient's private key; moving a
ciphertext into another envelope, to another recipient, or under a fresh `jti`;
delivering a captured envelope twice; downgrading to an unencrypted body.

**Not** prevented: the receiving gateway reading the body — it necessarily
opens it, and `a2a_messages.payload` stores it. Traffic analysis: who talks to
whom, when, and roughly how long the message was, are all still visible. And a
sender that seals to the wrong public key is sealing to whoever supplied it —
compare the fingerprint on the agent card against the one pinned in your own
registry rather than trusting the card alone.

`a2a_audit` records a SHA-256 of the **sealed** body and never a body, sealed or
opened. Both halves of that are enforced: `hashCiphertext()` throws if handed
anything that is not already ciphertext, and `a2a_audit_hash_ck` in the schema
refuses a `payload_hash` that is not a 43-character base64url digest.

## Reading a mailbox

`GET /messages` returns bodies that have been opened, so it asks who is calling.
It used to ask nobody, which made the confidentiality above a claim that ended
at our own front door.

A caller presents an `Authorization` header carrying an envelope signed by
**this agent's own pinned key**, addressed to itself, scoped to `messages.read`
and to the route:

```
Authorization: A2A <compact JWS>
payload:       { "scope": "messages.read", "path": "/messages" }
iss = aud =    this agent's name          # a mailbox belongs to one agent
ttl:           60s (plus verify()'s 60s skew allowance — two minutes worst case)
```

`signReadRequest()` and `readAuthorizationHeader()` in `lib/envelope.mjs` build
it. No new scheme: the same signature check, the same `a2a_agents` row, the same
`a2a_seen_envelopes` replay guard as a message delivery. A read with no
credential gets `401` and a `WWW-Authenticate` header saying what to send; one
that is presented and refused gets `403`. Either way the reasons come back and
the refusal lands in `a2a_audit` — a refused read with no readable reason is
indistinguishable from a bug.

A registered counterparty proving its own identity perfectly is still not this
agent and gets the same refusal as a stranger. `iss` must equal our own name;
the check is an equality test, not a membership test against the registry.

**A captured credential** can be presented once, inside its lifetime, before the
legitimate caller uses it — one read, and a denial of service against the real
caller, who is then refused as a replay. It cannot be used afterwards (the `jti`
is burned by whichever arrives first), or after roughly two minutes, or against
the other deployment (different `aud`), or turned into an application (the scope
is signed, and `/a2a/apply` refuses an unsealed body). Minting a fresh one needs
the agent's private key.

Why a header and not a query parameter: a credential in a URL ends up in access
logs, proxy logs, browser history and `Referer` headers. Why not a bearer token:
a second identity scheme with its own rotation story, replayable forever once
captured. Why not mTLS: Cloud Run terminates TLS at its front end, so client
certificates would need a separate load balancer and a second trust anchor
beside the fingerprints already pinned here.

**What this does not do:** it does not encrypt the response. The bodies come
back under TLS and under this check on who may ask; they are not sealed to the
caller the way an inbound application is sealed to us. The route is not
advertised on the agent card, because it is an operator route rather than an
agent-to-agent capability.

## Private keys are not in this repo

Each registered agent signs with an EC P-256 key whose public half is pinned in
`a2a_agents`. The same key is now also the recipient half of the ECDH exchange.
The private halves are not committed and `.gitignore` refuses `*.key` / `*.pem`
under this directory. Losing one means re-registering that agent with a fresh
keypair, which is a row update — not a code change.

Each gateway deployment needs its own private key to open what is sealed to it:

```
AGENT_PRIVATE_KEY_FILE=/secrets/agent-key/latest     # a Secret Manager mount — preferred
AGENT_PRIVATE_KEY_PEM_B64=<base64 PKCS#8 PEM>        # local development only
```

A mount is preferred because it is not in the environment block, so it does not
appear in `gcloud run services describe` or in whatever future log line dumps
`process.env`. The service refuses to start without one — a gateway that cannot
open a message would otherwise look like every sender being at fault. Generate
one with:

```
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt
```

**Each deployment must also register itself.** Its own `a2a_agents` row is the
pinned key a mailbox read is checked against, so without it `GET /messages`
refuses every caller and says the fault is ours. `register-agent.mjs` takes the
public half:

```
REG_AGENT_NAME=agent://v1.employer.agenthire.biz \
REG_AGENT_ROLE=employer \
REG_AGENT_ENDPOINT=https://agenthire.biz/a2a/apply \
REG_AGENT_PUBKEY_B64=$(openssl ec -in agent.key -pubout | base64 -w0) \
node register-agent.mjs
```

## Running the tests

`agent-gateway` has an adversarial battery that needs no database, no network
and no `npm install`:

```
cd functions/agent-gateway && node test/attack-battery.mjs
```

It asserts the refusals — impersonation, tampering, `alg: none`, wrong
audience, expiry, off-domain endpoints, lookalike domains, revoked
registrations, unscored trust dimensions; for the sealed body: tampered
ciphertext, a wrong-key decrypt, a ciphertext lifted into another envelope, a
truncated GCM tag, an off-curve ephemeral key, and a plaintext-body downgrade;
and for mailbox reads: an unauthenticated read, a read signed by another
registered agent, our own name signed by the wrong key, a replayed credential,
one scoped to another route or without the scope at all, an expired one, a
credential for the other deployment, a read against a revoked registration, and
an application envelope presented as a read credential (and the reverse).

The gateway pipeline runs end to end against an in-memory stand-in for its four
tables. That stand-in replaces **storage, not policy**: the replay case proves
the gateway asks whether a `jti` has been seen and refuses when told yes, which
is the part that lives in this repository. It does not prove Postgres enforces a
`PRIMARY KEY` — that is still asserted against the real table in deployment,
because asserting it here would only prove the stand-in works.
