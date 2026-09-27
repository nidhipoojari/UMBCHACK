import 'server-only';

import { db } from '@/lib/db';
import type { GameState } from '@/lib/game-contract';
import {
  APPLICANT_AGENT,
  EMPLOYER_AGENT,
  canActAs,
  agentPrivateKeyPem,
  employerGatewayUrl,
  invokerToken,
  ourFingerprint,
  ownEnvelopeJti,
  pinnedAgent,
  sealAndSign,
  signingKeyMatches,
} from '@/lib/a2a-identity';

/**
 * a2a-apply.ts — the outbound half of an application.
 *
 * WHAT WAS HERE BEFORE: nothing. /applicant/apply was four hard-coded rows and
 * no code in src/ had ever called the gateway; grepping for 'a2a/apply' found
 * no match outside functions/. The encryption, the replay table and the audit
 * trail were all real and all taken on faith, because nothing the product did
 * produced a row in them. This file is the call that was missing.
 *
 * THE SHAPE OF ONE APPLICATION:
 *
 *   1  read the employer agent's PINNED key out of a2a_agents
 *   2  build the body from the student's own profile rows
 *   3  seal it to that key and sign the result as the applicant agent
 *   4  POST it to the employer gateway over TLS, with a Cloud Run invoker token
 *   5  record what the gateway said — accepted or refused, in its own words
 *
 * Step 3 is `sealAndSign` from functions/agent-gateway/lib/envelope.mjs, called
 * and not reimplemented. It mints the jti, binds it into the ciphertext's AAD
 * alongside iss and aud, and only then signs — an order that matters (a jti
 * chosen after the seal could be swapped to slip a captured ciphertext past the
 * replay table) and that is not worth a second implementation getting right.
 *
 * WHAT THIS FILE NEVER DOES. It never sends a plaintext body, and it has no
 * path that could: the only thing it can put in an envelope is the return value
 * of sealAndSign. The gateway would refuse a plaintext body at step 5 of its
 * admission order anyway, and that refusal is the property the product claims,
 * so there is no "fall back to unsealed" branch to be found later and enabled.
 */

/** Trust dimensions in the order the gateway's policy lists them. */
type TrustDimension = { score: number; reason: string };
type TrustBlock = Record<'integrity' | 'identity' | 'solvency' | 'behavior' | 'safety', TrustDimension>;

/**
 * The fields the employer agent's card declares. A payload key outside this set
 * is not sent — see the `safety` dimension below for why that is a check and
 * not a tidy-up.
 */
const DECLARED_FIELDS = new Set([
  'full_name',
  'email',
  'resume_url',
  'cover_letter',
  'skills',
  'job_id',
]);

const REQUIRED_FIELDS = ['full_name', 'email', 'resume_url'] as const;

/**
 * Scores that sit either side of the gateway's floor (65 per dimension, 75
 * average). They are thresholds, not measurements, and the reason string
 * carries the actual finding — see the block comment on buildTrust().
 */
const PASSES = 90;
const FAILS = 20;

export type ApplyInput = {
  userId: string;
  /** The posting being applied to. Carried through to a2a_messages.job_id. */
  jobId: string;
  coverLetter?: string | null;
};

export type ApplyOutcome = {
  ok: boolean;
  /** Present when ok is false: why, in words a student can act on. */
  error?: string;
  /**
   * The gateway said yes. Distinct from `ok`: a refusal that arrived as a
   * well-formed answer from the gateway is a successful exchange with a
   * negative result, and the student should see the reasons rather than a
   * generic failure.
   */
  accepted: boolean;
  /** The gateway's own reason strings, verbatim, refusals included. */
  reasons: string[];
  /** The envelope id. Null only when nothing was ever sent. */
  jti: string | null;
  /** a2a_messages.message_id, when the gateway stored one. */
  messageId: string | null;
  /**
   * SHA-256 of the sealed body, as the gateway computed it. The sender can
   * recompute this from the bytes it sent and confirm the message the employer
   * holds is the message it sent — which is the whole of the receipt. It is
   * also exactly what lands in a2a_audit.payload_hash, and never a body.
   */
  ciphertextSha256: string | null;
  employerAgent: string;
  /** Employer agent's pinned key fingerprint — what the body was sealed to. */
  sealedTo: string | null;
  /**
   * Same meaning as ConnectOutcome.counted in game-contract.ts: false when the
   * attempt was refused or was a repeat. It is the only game-facing fact this
   * file can state truthfully today.
   */
  counted: boolean;
  /**
   * NULL UNTIL THE GAME LAYER EXISTS, AND DELIBERATELY NOT INVENTED.
   *
   * game-contract.ts defines ConnectOutcome as carrying a full GameState —
   * energy, streak, level, achievements, routes. Every one of those is derived
   * from rows by rules that are being written in a different worktree, and I
   * cannot produce them here without either duplicating that work or making up
   * numbers. Making them up is the thing this codebase refuses to do: a page
   * that shows a plausible-looking level for an action that did not compute one
   * is worse than a page that shows nothing.
   *
   * So the field is typed as the contract's own GameState and left null. When
   * `gameState(userId)` lands, filling it in is one line, and this outcome
   * becomes assignable to ConnectOutcome with `counted`, `ok` and `error`
   * already meaning what the contract says they mean. The contract's types are
   * not changed by this file — two other agents are building against them.
   */
  game: GameState | null;
};

/**
 * THE TRUST BLOCK, AND THE HONEST READING OF IT.
 *
 * The gateway's step 8 runs evaluateTrust() over five scored dimensions that
 * arrive in the REQUEST BODY — that is, the sender scores itself, and the
 * receiver applies its floors to numbers the sender chose. Cryptographically
 * that establishes nothing: an attacker who can send at all can write 100s.
 *
 * What it is actually worth is attribution. The envelope carrying the block is
 * signed by a key pinned in a2a_agents, so a false claim is a false claim by a
 * named agent, recorded in a2a_audit under that name and unrepudiable
 * afterwards. That is a different and much weaker property than verification,
 * and it is the only one on offer without an issuer the receiver trusts to
 * score third parties — which this deployment does not have.
 *
 * Given that, the least dishonest thing a sender can do is make the numbers
 * mechanical and put the evidence in the words. So:
 *
 *   - There are two scores, one above the floor and one below it. No gradients.
 *     A 78 would imply a measurement to two significant figures that nothing
 *     here performed.
 *   - `identity`, `integrity` and `safety` are REAL CHECKS this code runs
 *     before sending, and they can fail. `behavior` carries real counts out of
 *     a2a_audit. `solvency` is the one dimension that cannot be made to mean
 *     anything for an individual applicant, and its reason says exactly that
 *     rather than dressing a constant up as a finding.
 *   - A failed check is reported as a failed check and the message is sent
 *     anyway, so the gateway does the refusing and the refusal lands in the
 *     audit trail. Suppressing the send would hide from the trail the one kind
 *     of event the trail exists for.
 */
function buildTrust(facts: {
  keyMatches: boolean;
  sealedToFingerprint: string;
  undeclaredFields: string[];
  delivered: number;
  refused: number;
}): TrustBlock {
  const { keyMatches, sealedToFingerprint, undeclaredFields, delivered, refused } = facts;

  return {
    identity: keyMatches
      ? {
          score: PASSES,
          reason:
            `Checked: the SPKI fingerprint of the key signing this envelope equals the one ` +
            `pinned for ${APPLICANT_AGENT} in a2a_agents. It proves which deployment sent this, ` +
            `not which student asked for it — there is no per-student key.`,
        }
      : {
          score: FAILS,
          reason:
            `Checked and FAILED: this deployment is holding a key whose fingerprint does not ` +
            `match the one pinned for ${APPLICANT_AGENT}. The signature will not verify either.`,
        },

    integrity: {
      score: PASSES,
      reason:
        `Checked: the body of this envelope is a2a-seal-1 ciphertext, sealed by ECDH P-256 to ` +
        `the recipient key pinned as ${sealedToFingerprint}, with the AAD bound to this ` +
        `envelope's iss, aud and jti. Taken from the registry row, not from the agent card.`,
    },

    safety:
      undeclaredFields.length === 0
        ? {
            score: PASSES,
            reason:
              'Checked: every field in the body is one the recipient\'s agent card declares. ' +
              'Nothing else about the student — phone, location, GitHub, transcript — is in it.',
          }
        : {
            score: FAILS,
            reason:
              `Checked and FAILED: the body carries field(s) the recipient never asked for: ` +
              `${undeclaredFields.join(', ')}.`,
          },

    behavior: {
      score: PASSES,
      reason:
        `Counted from a2a_audit: ${delivered} envelope(s) under this name accepted, ` +
        `${refused} refused. Refusals are reported here rather than filtered out; the ` +
        `recipient can read the same rows.`,
    },

    solvency: {
      // 75 and not 90: it is the aggregate floor exactly, which is the lowest
      // value that does not drag a fully-checked message under the average.
      // Scoring it 90 would let a dimension nothing measured carry weight.
      score: 75,
      reason:
        'NOT MEASURED. Solvency is a question about a counterparty who owes something — it ' +
        'has no meaning for a student sending an application, and this deployment holds no ' +
        'financial fact about them. The number is the policy floor, not a finding.',
    },
  };
}

type ApplicantFacts = {
  full_name: string;
  email: string;
  resume_url: string;
  skills: string[];
};

/**
 * The student's own rows, which are the only source for the body.
 *
 * RESUME_URL IS A gs:// LOCATOR AND NOT A SIGNED URL, ON PURPOSE. Minting a
 * signed URL would make the field a bearer capability: anyone who later reads
 * a2a_messages.payload — where the opened body sits in the clear, by design —
 * could fetch the PDF, and the link would outlive any interest the employer had
 * in it. A locator names the object and grants nothing; reading it still goes
 * through storage.rules, which allow only the owner. That is a weaker field and
 * the honest one, and the employer has to ask for access rather than find it
 * lying in a row.
 */
async function applicantFacts(userId: string): Promise<{ facts: ApplicantFacts | null; missing: string[] }> {
  const { rows } = await db.query<{
    full_name: string | null;
    email: string | null;
    storage_path: string | null;
    skills: string[] | null;
  }>(
    `SELECT p.full_name,
            p.email,
            d.storage_path,
            coalesce(
              -- raw_skill, not skill: the skill column is the lower-cased key
              -- the matcher joins on, and sending "typescript" to a human reader
              -- when the resume said "TypeScript" is a small lie about what
              -- they wrote.
              (SELECT array_agg(DISTINCT s.raw_skill)
                 FROM profile_skills s
                WHERE s.user_id = p.user_id
                  AND s.source_document_id = l.document_id
                  AND s.raw_skill IS NOT NULL),
              '{}'
            ) AS skills
       FROM applicant_profiles p
       LEFT JOIN latest_resume l ON l.user_id = p.user_id
       LEFT JOIN intake_documents d ON d.document_id = l.document_id
      WHERE p.user_id = $1`,
    [userId],
  );

  const row = rows[0];
  const candidate = {
    full_name: (row?.full_name ?? '').trim(),
    email: (row?.email ?? '').trim(),
    resume_url: (row?.storage_path ?? '').trim(),
    skills: row?.skills ?? [],
  };

  // The gateway refuses a body missing any of these at step 10. Finding it out
  // here as well is not a duplicated gate — it is the difference between
  // telling the student "upload a resume first" and burning a jti to be told
  // "Payload is missing required field(s): resume_url" by a machine.
  const missing = REQUIRED_FIELDS.filter((f) => candidate[f] === '');
  if (missing.length > 0) return { facts: null, missing };
  return { facts: candidate, missing: [] };
}

/** Accepted/refused counts for our own agent name, for the behavior dimension. */
async function ourAuditCounts(): Promise<{ delivered: number; refused: number }> {
  const { rows } = await db.query<{ accepted: string; refused: string }>(
    `SELECT count(*) FILTER (WHERE decision = 'accepted')::text AS accepted,
            count(*) FILTER (WHERE decision = 'refused')::text  AS refused
       FROM a2a_audit WHERE agent_name = $1`,
    [APPLICANT_AGENT],
  );
  return { delivered: Number(rows[0]?.accepted ?? 0), refused: Number(rows[0]?.refused ?? 0) };
}

const blank: ApplyOutcome = {
  ok: false,
  accepted: false,
  reasons: [],
  jti: null,
  messageId: null,
  ciphertextSha256: null,
  employerAgent: EMPLOYER_AGENT,
  sealedTo: null,
  counted: false,
  game: null,
};

/**
 * `ok: false` means NO DECISION WAS OBTAINED — no key, no registry row, no
 * route to the agent. It is a fault on our side, and `error` says so.
 */
const fail = (error: string): ApplyOutcome => ({ ...blank, error });

/**
 * `ok: true, accepted: false` means A DECISION WAS OBTAINED AND IT WAS NO. The
 * distinction matters to the screen: the first is "try again", the second is
 * "here is what the other side said, in its own words". Collapsing them would
 * turn every legible refusal into a generic failure, which is the one thing the
 * audit trail exists to prevent.
 */
const refused = (reasons: string[], extra: Partial<ApplyOutcome> = {}): ApplyOutcome => ({
  ...blank,
  ok: true,
  reasons,
  ...extra,
});

/** One row per attempt, sent or not. See sql/007_a2a_applications.sql. */
async function record(
  input: ApplyInput,
  outcome: { jti: string | null; accepted: boolean; reasons: string[] },
): Promise<void> {
  await db.query(
    `INSERT INTO a2a_applications (user_id, job_id, jti, accepted, reasons)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [input.userId, input.jobId, outcome.jti, outcome.accepted, outcome.reasons],
  );
}

/**
 * Send one application, as the applicant agent, to the employer agent.
 *
 * WHAT AN ATTACKER ON THE PATH BETWEEN THESE TWO SERVICES CAN DO WITH WHAT
 * LEAVES HERE. They can see that an envelope went from the applicant agent to
 * the employer agent, when, and how big it was. They can drop it. They cannot
 * read the body, which is AES-256-GCM under a key derived from an ephemeral
 * ECDH exchange with the employer's pinned key. They cannot alter any part of
 * it, because the signature covers the sealed blob's public parameters as well
 * as its ciphertext. They cannot re-address it to another agent or re-sign it
 * as another sender, because iss, aud and jti are in the GCM AAD and the
 * ciphertext will not open against a different set. They cannot replay it,
 * because the jti is claimed once against a PRIMARY KEY. Recording the traffic
 * and stealing the employer's key later does not open what they recorded,
 * because the sender's half of the exchange was thrown away at seal time.
 *
 * WHAT THEY CAN DO THAT THIS DOES NOT STOP. Traffic analysis, as above. And if
 * they compromise this process, everything: it holds the applicant agent's
 * private key and it reads the student's profile rows, so it can write and send
 * whatever it likes. Nothing in the envelope protects against the party that
 * mints it.
 */
export async function sendApplication(input: ApplyInput): Promise<ApplyOutcome> {
  if (!canActAs('applicant')) {
    return fail(
      'This deployment has no applicant identity key, so it cannot sign an envelope. ' +
        'Mount the a2a-applicant-agent-key secret and set A2A_APPLICANT_KEY_FILE.',
    );
  }

  // A repeat is refused HERE rather than at the gateway, and that is the one
  // refusal in this flow that is ours to make. The gateway would accept a
  // second application for the same posting quite correctly — it is a different
  // envelope with a different jti, and "this student already applied" is a fact
  // about a student, which the envelope does not carry and the gateway has no
  // way to know. Sending it anyway would spend a real delivery to land a
  // duplicate in the employer's mailbox.
  //
  // It is recorded, not silently dropped: a filter you cannot interrogate is
  // indistinguishable from a bug. But it is recorded HERE and not in a2a_audit
  // — nothing crossed the wire, and writing an "outbound refused" row by hand
  // would put a decision in the trail that no gateway ever made.
  const repeat = await db.query<{ sent_at: Date; jti: string | null }>(
    `SELECT sent_at, jti FROM a2a_applications
      WHERE user_id = $1 AND job_id = $2 AND accepted
      LIMIT 1`,
    [input.userId, input.jobId],
  );
  if (repeat.rowCount && repeat.rowCount > 0) {
    const first = repeat.rows[0];
    const reason =
      `You have already applied to this posting. The first application went out as envelope ` +
      `${first.jti ?? 'unknown'} on ${first.sent_at.toISOString()} and the employer agent ` +
      `accepted it; a second would be a duplicate in their mailbox, so nothing was sent.`;
    await record(input, { jti: null, accepted: false, reasons: [reason] });
    return refused([reason]);
  }

  const employer = await pinnedAgent(EMPLOYER_AGENT);
  if (!employer) {
    return fail(`${EMPLOYER_AGENT} has no row in the agent registry, so there is no key to seal to.`);
  }
  if (employer.revokedAt) {
    return fail(`${EMPLOYER_AGENT} has been revoked; nothing is sent to a revoked registration.`);
  }

  const { facts, missing } = await applicantFacts(input.userId);
  if (!facts) {
    const names = missing.map((f) => (f === 'resume_url' ? 'a parsed resume' : f.replace('_', ' ')));
    return fail(`Your profile is missing ${names.join(' and ')}. Nothing is sent half-complete.`);
  }

  const cover = input.coverLetter?.trim();
  const payload: Record<string, unknown> = {
    full_name: facts.full_name,
    email: facts.email,
    resume_url: facts.resume_url,
    job_id: input.jobId,
    ...(facts.skills.length > 0 ? { skills: facts.skills } : {}),
    ...(cover ? { cover_letter: cover } : {}),
  };

  const undeclaredFields = Object.keys(payload).filter((k) => !DECLARED_FIELDS.has(k));

  // Our own registry row, to check the key we are about to sign with against
  // the key pinned for the name we are about to sign as. A missing row is not
  // an error here — the gateway refuses an unregistered issuer at its step 2,
  // which is a better place for that refusal to be recorded than this one.
  const self = await pinnedAgent(APPLICANT_AGENT);
  const keyMatches = self !== null && signingKeyMatches('applicant', self);
  const counts = await ourAuditCounts();

  // Sealed here and nowhere else. `sealAndSign` mints the jti, seals the body
  // to the employer's pinned key with { iss, aud, jti } as the AAD, and signs
  // the sealed blob — never the plaintext.
  const jws: string = sealAndSign({
    plaintext: payload,
    issuer: APPLICANT_AGENT,
    audience: EMPLOYER_AGENT,
    privateKeyPem: agentPrivateKeyPem('applicant'),
    recipientPublicKeyPem: employer.publicKeyPem,
  });

  const trust = buildTrust({
    keyMatches,
    sealedToFingerprint: employer.keyFingerprint,
    undeclaredFields,
    delivered: counts.delivered,
    refused: counts.refused,
  });

  const base = employerGatewayUrl();
  const token = await invokerToken(base);

  let res: Response;
  try {
    res = await fetch(`${base}/a2a/apply`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jws, trust }),
      // Twenty seconds is generous for one ECDH and two inserts, and is well
      // inside the envelope's own 120-second life — so when it does time out,
      // the envelope may still be in flight and may still be delivered. That is
      // why the catch below refuses to claim either way.
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    // The envelope may or may not have arrived. Saying "sent" would be a guess
    // and saying "not sent" would be a different guess, so it says neither.
    return {
      ...fail(
        `Could not reach the employer agent at ${base}: ` +
          `${err instanceof Error ? err.message : 'connection failed'}. ` +
          'Whether the envelope arrived is unknown; a retry mints a new envelope id.',
      ),
      sealedTo: employer.keyFingerprint,
    };
  }

  const body = (await res.json().catch(() => ({}))) as {
    accepted?: boolean;
    reasons?: string[];
    jti?: string;
    message_id?: string | number | null;
    ciphertext_sha256?: string;
    error?: string;
  };

  // 403 with reasons is the gateway declining; anything else with no reasons is
  // a transport or deployment problem and should not be dressed up as one.
  if (!body.reasons && body.accepted === undefined) {
    return {
      ...fail(
        `The employer agent answered ${res.status} without a decision` +
          `${body.error ? `: ${body.error}` : ''}. This is a fault on the path, not a refusal.`,
      ),
      sealedTo: employer.keyFingerprint,
    };
  }

  const accepted = body.accepted === true;
  // The jti is read back off the envelope we minted rather than taken from the
  // response, so a refusal that never echoes one is still recorded against the
  // envelope it was about. They agree when both are present — the gateway's
  // jti comes from the claims it verified — and if they ever did not, ours is
  // the one that names the bytes we sent.
  const jti = ownEnvelopeJti(jws);
  const reasons = body.reasons ?? [];
  await record(input, { jti, accepted, reasons });

  return {
    ok: true,
    accepted,
    reasons,
    jti,
    messageId: body.message_id != null ? String(body.message_id) : null,
    ciphertextSha256: body.ciphertext_sha256 ?? null,
    employerAgent: EMPLOYER_AGENT,
    sealedTo: employer.keyFingerprint,
    counted: accepted,
    game: null,
  };
}

/** Every attempt this student has made, newest first. Refusals included. */
export async function applicationHistory(userId: string): Promise<
  { jobId: string; jti: string | null; sentAt: string; accepted: boolean; reasons: string[] }[]
> {
  const { rows } = await db.query<{
    job_id: string;
    jti: string | null;
    sent_at: Date;
    accepted: boolean;
    reasons: string[] | null;
  }>(
    `SELECT job_id, jti, sent_at, accepted, reasons
       FROM a2a_applications WHERE user_id = $1
      ORDER BY sent_at DESC LIMIT 50`,
    [userId],
  );
  return rows.map((r) => ({
    jobId: r.job_id,
    jti: r.jti,
    sentAt: r.sent_at.toISOString(),
    accepted: r.accepted,
    reasons: r.reasons ?? [],
  }));
}

/** The identity facts the apply screen shows above the button. */
export async function applyContext(userId: string): Promise<{
  applicantAgent: string;
  /** Null when this deployment holds no applicant key. */
  ourFingerprint: string | null;
  employer: { agentName: string; endpoint: string; fingerprint: string; revokedAt: string | null } | null;
  gatewayUrl: string;
  /** Required fields the student has not got yet. Empty means ready to send. */
  missing: string[];
}> {
  const employer = await pinnedAgent(EMPLOYER_AGENT);
  const { missing } = await applicantFacts(userId);
  return {
    applicantAgent: APPLICANT_AGENT,
    ourFingerprint: canActAs('applicant') ? ourFingerprint('applicant') : null,
    employer: employer
      ? {
          agentName: employer.agentName,
          endpoint: employer.endpoint,
          fingerprint: employer.keyFingerprint,
          revokedAt: employer.revokedAt,
        }
      : null,
    gatewayUrl: employerGatewayUrl(),
    missing,
  };
}
