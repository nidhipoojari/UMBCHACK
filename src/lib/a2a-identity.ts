import 'server-only';

import { db } from '@/lib/db';

// The crypto is NOT reimplemented here. These are the gateway's own modules,
// imported across the package boundary on purpose: a second signing or sealing
// path in the web tier is a second thing to get wrong, and the two would drift
// the first time either was touched. functions/agent-gateway/lib/*.mjs depend on
// nothing but node:crypto, so importing them costs no dependency — and it means
// the 95 cases in functions/agent-gateway/test/attack-battery.mjs are exercising
// the exact code this file calls.
//
// This module is the ONLY place in src/ that reaches into the gateway package,
// and the only place a private key enters the web process. Both are deliberate:
// there is one file to audit for either question.
import {
  fingerprint,
  readAuthorizationHeader,
  readClaimsUnverified,
  sealAndSign,
  signReadRequest,
} from '../../functions/agent-gateway/lib/envelope.mjs';
import { publicKeyPemFrom } from '../../functions/agent-gateway/lib/sealing.mjs';
import { loadAgentPrivateKeyPem } from '../../functions/agent-gateway/lib/agent-key.mjs';

export { fingerprint, readAuthorizationHeader, sealAndSign, signReadRequest };

/**
 * NOT TRUSTED, and re-exported under a name that says so. In the gateway this
 * exists to solve a bootstrapping problem — you must read the claimed issuer to
 * know which key to check it against. In this package it has exactly one use:
 * reading back the jti of an envelope THIS PROCESS JUST MINTED, so a screen can
 * point at the matching a2a_audit row. No decision is ever taken on what it
 * returns, and it is never called on anything that arrived from outside.
 */
export function ownEnvelopeJti(jws: string): string | null {
  const claims = readClaimsUnverified(jws) as { jti?: string } | null;
  return claims?.jti ?? null;
}

/** The two agents this deployment operates. Both live under agenthire.biz. */
export const APPLICANT_AGENT = 'agent://v1.applicant.agenthire.biz';
export const EMPLOYER_AGENT = 'agent://v1.employer.agenthire.biz';

export type AgentSide = 'applicant' | 'employer';

/**
 * WHOSE IDENTITY THE WEB TIER SPEAKS WITH, AND WHAT THAT DOES NOT PROVE.
 *
 * There is no per-student key. A student signs in with Firebase; they do not
 * hold a P-256 keypair, and nothing in this product mints one for them. So when
 * a student presses Apply, THE SERVER SIGNS ON THEIR BEHALF as
 * `agent://v1.applicant.agenthire.biz`, using the one key registered for that
 * name.
 *
 * WHAT THE SIGNATURE ON AN APPLICATION THEREFORE PROVES:
 *   - that this envelope was emitted by a process holding the applicant agent's
 *     registered private key — i.e. by agentHire's own backend;
 *   - that the body has not been altered since, and was sealed to the employer
 *     agent's pinned key;
 *   - that the body was addressed to that one employer agent and to no other.
 *
 * WHAT IT DOES NOT PROVE:
 *   - that any particular student authorised it. The gateway cannot tell one
 *     student's application from another's, because from its side they are all
 *     the same issuer. The `uid` that reached the API route is verified — by
 *     `verifyIdToken`, against Google's published keys — but that check happens
 *     entirely inside agentHire and is invisible to the gateway. A reader of
 *     a2a_audit sees "the applicant agent sent one", never "Riley sent one".
 *   - anything at all if agentHire's own backend is compromised. One key
 *     signing for every student means one key whose theft impersonates every
 *     student. A per-student key would narrow that blast radius; it would also
 *     need key generation, storage, recovery and rotation for people who did
 *     not ask for a keypair, and would still be held by this server, so it
 *     would move the problem rather than solve it. The choice is recorded here
 *     rather than papered over, because the alternative is a product that
 *     claims non-repudiation per student and does not have it.
 *
 * SO WHAT IS THE STUDENT-LEVEL RECORD? It is the row the application leaves in
 * this deployment's own tables, joined by jti. That is an agentHire claim, on
 * agentHire's word — which is a weaker thing than a signature and is described
 * as such everywhere it appears.
 */
const KEY_ENV: Record<AgentSide, { file: string; b64: string }> = {
  applicant: { file: 'A2A_APPLICANT_KEY_FILE', b64: 'A2A_APPLICANT_KEY_PEM_B64' },
  employer: { file: 'A2A_EMPLOYER_KEY_FILE', b64: 'A2A_EMPLOYER_KEY_PEM_B64' },
};

/**
 * Cached per side, because loading re-reads a file and re-parses a PEM and the
 * result cannot change without a new revision. Held as a module-level constant
 * and never logged, never returned to a handler, never put in a response.
 */
const keyCache = new Map<AgentSide, string>();

/**
 * @throws when no key is configured for that side, with the reason.
 *
 * WHY THIS REUSES THE GATEWAY'S LOADER RATHER THAN READING THE FILE ITSELF.
 * loadAgentPrivateKeyPem() already refuses a key that is not EC P-256, already
 * prefers a mounted secret over an environment variable and says why, and
 * already re-throws without the key's contents. Writing four lines of
 * readFileSync here would lose all of that and would be a second place to fix
 * when any of it changes. Its `env` parameter exists precisely so a caller can
 * point it at a different pair of variables, which is what the shim below does.
 */
export function agentPrivateKeyPem(side: AgentSide): string {
  const cached = keyCache.get(side);
  if (cached) return cached;

  const names = KEY_ENV[side];
  // A two-variable shim, not the real environment. Deliberately NOT
  // `{...process.env, ...}`: spreading would let a stray AGENT_PRIVATE_KEY_FILE
  // meant for the gateway decide which key the web tier signs with, and that is
  // the one substitution that must not be possible silently.
  const pem = loadAgentPrivateKeyPem({
    AGENT_PRIVATE_KEY_FILE: process.env[names.file],
    AGENT_PRIVATE_KEY_PEM_B64: process.env[names.b64],
  });
  keyCache.set(side, pem);
  return pem;
}

/** True when this deployment can act as that agent at all. Never throws. */
export function canActAs(side: AgentSide): boolean {
  try {
    agentPrivateKeyPem(side);
    return true;
  } catch {
    return false;
  }
}

export type PinnedAgent = {
  agentName: string;
  role: string;
  endpoint: string;
  publicKeyPem: string;
  keyFingerprint: string;
  revokedAt: string | null;
};

/**
 * The counterparty's key, FROM THE REGISTRY AND NOT FROM ITS AGENT CARD.
 *
 * The card at /.well-known/agent-card.json serves the same public key over
 * HTTPS, and taking it from there would be easier and would be the whole of the
 * attack: a sender that seals to whatever key answered the connection has
 * sealed to whoever answered the connection, and TLS only says the host is the
 * host the DNS pointed at. The pinned row in a2a_agents is what makes "sealed
 * to the employer" mean something, so it is the only source used here. The card
 * remains useful for NOTICING a rotation — fetch it, compare fingerprints,
 * refuse the difference — but never for deciding to accept one.
 */
export async function pinnedAgent(agentName: string): Promise<PinnedAgent | null> {
  const { rows } = await db.query<{
    agent_name: string;
    role: string;
    endpoint: string;
    public_key_pem: string;
    key_fingerprint: string;
    revoked_at: Date | null;
  }>(
    `SELECT agent_name, role, endpoint, public_key_pem, key_fingerprint, revoked_at
       FROM a2a_agents WHERE agent_name = $1`,
    [agentName],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    agentName: row.agent_name,
    role: row.role,
    endpoint: row.endpoint,
    publicKeyPem: row.public_key_pem,
    keyFingerprint: row.key_fingerprint,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
  };
}

/**
 * Does the key we would sign with match the key pinned for the name we would
 * sign as?
 *
 * The gateway's step 4 answers the same question with the signature itself and
 * refuses if it disagrees, so this is not a second gate — it is the difference
 * between a refusal a student can read ("this deployment is holding the wrong
 * key") and one that reads "Signature does not verify against the registered
 * key", which points the blame at the sender's competence rather than at the
 * deployment's configuration. It is also what the `identity` trust dimension
 * reports, so it has to be computed either way.
 */
export function signingKeyMatches(side: AgentSide, pinned: PinnedAgent): boolean {
  return fingerprint(publicKeyPemFrom(agentPrivateKeyPem(side))) === pinned.keyFingerprint;
}

/** The fingerprint of the key this deployment would sign with, for display. */
export function ourFingerprint(side: AgentSide): string {
  return fingerprint(publicKeyPemFrom(agentPrivateKeyPem(side)));
}

/* ------------------------------------------------------------------ *
 * Transport.
 * ------------------------------------------------------------------ */

/**
 * Where the employer agent actually answers.
 *
 * NOT `a2a_agents.endpoint`. That column holds the agent's PUBLISHED address
 * (https://agenthire.biz/a2a/apply) and its job is to be checked, not dialled:
 * identity.checkAgentRecord anchors it under the domain the name claims, which
 * is how a registered name is stopped from pointing its endpoint at any host on
 * the internet. The address we dial is deployment configuration — today a Cloud
 * Run service URL that is not under agenthire.biz and would fail that very
 * anchoring rule — so conflating the two would mean either dialling something
 * unverified or publishing something unroutable.
 *
 * The two converge once the published address is fronted onto the service. Until
 * then this is set explicitly, and the mismatch is a deployment fact rather than
 * a silent fallback.
 */
export function employerGatewayUrl(): string {
  return (
    process.env.A2A_EMPLOYER_GATEWAY_URL ??
    'https://agent-gateway-nsw4gvibpq-ue.a.run.app'
  ).replace(/\/+$/, '');
}

/**
 * The Cloud Run invoker token.
 *
 * THIS IS NOT THE A2A CREDENTIAL AND DOES NOT REPLACE IT. It is Google IAM
 * deciding whether this service account may open a connection to that service
 * at all; everything the gateway does about WHO IS SPEAKING — the pinned key,
 * the audience, the jti, the seal — happens after, inside the body. Two layers
 * that answer different questions: "may this process reach the host" and "may
 * this agent say this thing". Losing either would not be caught by the other.
 *
 * WHY THE METADATA SERVER RATHER THAN google-auth-library. The token is one
 * unauthenticated GET against a link-local address that only exists inside the
 * instance. Pulling in an auth library to make that request would add a
 * dependency — and one more package with credential access — to save four
 * lines.
 *
 * Returns null when there is no source. The caller sends without the header and
 * lets Cloud Run's own 403 be the error, which is a truthful message about
 * access rather than a guess this code would have to invent.
 */
export async function invokerToken(audience: string): Promise<string | null> {
  // Set from `gcloud auth print-identity-token` for local work. Kept because
  // the metadata server does not exist on a laptop, and the alternative was
  // being unable to exercise the real gateway outside Cloud Run at all.
  const supplied = process.env.A2A_INVOKER_ID_TOKEN?.trim();
  if (supplied) return supplied;

  // K_SERVICE is set by Cloud Run and by nothing else. Checking it first means a
  // laptop never waits on a 169.254 address that will not answer.
  if (!process.env.K_SERVICE) return null;

  try {
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity' +
        `?audience=${encodeURIComponent(audience)}`,
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return null;
    return (await res.text()).trim() || null;
  } catch {
    return null;
  }
}
