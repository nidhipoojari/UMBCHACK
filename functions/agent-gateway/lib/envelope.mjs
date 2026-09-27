/**
 * envelope.mjs — the signed message format two agents use to talk.
 *
 * A message is a compact JWS (ES256) over a small set of claims. The point is
 * that a receiver can answer three questions from the envelope alone, before it
 * looks at the payload at all:
 *
 *   who sent this   — `iss`, proven by the signature of a key we have pinned
 *   was it for us   — `aud` must equal our own agent name
 *   is it fresh     — `iat`/`exp`, and `jti` seen at most once
 *
 * WHAT THIS FILE DOES AND DOES NOT GIVE YOU. Everything here is about
 * AUTHENTICITY: who wrote the envelope, and that its bytes have not changed
 * since. None of it is confidentiality — the claims segment is base64url, not
 * ciphertext, and anyone who can read the channel can read it. Confidentiality
 * is sealing.mjs, and `sealAndSign` below is the composition the gateway
 * actually requires: the body is sealed first, and the signature is then taken
 * over the sealed body.
 *
 * WHY THE SIGNATURE GOES OUTSIDE THE ENCRYPTION AND NOT THE OTHER WAY ROUND.
 * Signing the ciphertext lets a receiver reject an unauthenticated envelope
 * before spending a private-key operation on it, which keeps decryption off the
 * path an anonymous attacker can reach. It also means the sealed blob's public
 * fields — the ephemeral key, the salt, the nonce — are covered by the
 * signature, so they cannot be swapped by anyone on the wire. The cost is that
 * the signature proves who *sent* the envelope rather than who *wrote* the
 * plaintext; the AAD binding in sealing.mjs ties the two together by covering
 * iss, aud and jti, so a ciphertext cannot be re-signed by a different agent
 * and still open.
 *
 * Deliberately no dependency: node's crypto does ES256 over P-256 directly, and
 * a JWS library would be a larger trusted base than the forty lines below.
 *
 * A NOTE ON ORDER. readClaimsUnverified() exists because of a genuine
 * bootstrapping problem: to find the key that verifies a message you must first
 * know who the message says it is from. Its output decides WHICH registry row to
 * fetch and nothing else. Nothing it returns is trusted, and callers must not
 * branch on it beyond that lookup — which is why it is named to be awkward to
 * misuse.
 */
import { createSign, createVerify, createHash, randomUUID } from 'node:crypto';
import { seal } from './sealing.mjs';

export const ALG = 'ES256';
export const TYP = 'agenthire-a2a+jws';
export const MAX_AGE_SECONDS = 120;

const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = str => Buffer.from(str, 'base64url');

/** sha256 of a DER SPKI public key, base64url. This is what the registry pins. */
export function fingerprint(publicKeyPem) {
  const der = createHash('sha256')
    .update(Buffer.from(publicKeyPem.replace(/-----[^-]+-----|\s/g, ''), 'base64'))
    .digest();
  return b64u(der);
}

/**
 * The JWS layer on its own. `payload` is signed as given and NOT encrypted —
 * callers that handle anything a third party should not read want sealAndSign()
 * below. `jti` is a parameter only so that sealAndSign can bind the same value
 * into the ciphertext's AAD before the claims are built; nothing else should
 * supply it, because a jti chosen twice is a replay of your own message.
 */
export function sign({ payload, issuer, audience, privateKeyPem, ttlSeconds = MAX_AGE_SECONDS, jti = randomUUID() }) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuer,
    aud: audience,
    jti,
    iat: now,
    exp: now + ttlSeconds,
    payload,
  };
  const header = { alg: ALG, typ: TYP };
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  // dsaEncoding 'ieee-p1363' is the raw r||s form JWS requires; node's default
  // is DER, which verifies nowhere else.
  const sig = createSign('SHA256')
    .update(signingInput)
    .sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64u(sig)}`;
}

/** NOT TRUSTED. Only for choosing which registry row to fetch. See header. */
export function readClaimsUnverified(jws) {
  const parts = String(jws ?? '').split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(unb64u(parts[1]).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * @returns {{ok: true, claims: object} | {ok: false, reasons: string[]}}
 *
 * Every check that can fail contributes a reason rather than a bare false, so a
 * refusal can be audited and explained to a human instead of appearing as an
 * unexplained rejection.
 */
export function verify(jws, { publicKeyPem, expectedIssuer, expectedAudience, maxAgeSeconds = MAX_AGE_SECONDS }) {
  const reasons = [];
  const parts = String(jws ?? '').split('.');
  if (parts.length !== 3) return { ok: false, reasons: ['Envelope is not a compact JWS.'] };

  let header;
  let claims;
  try {
    header = JSON.parse(unb64u(parts[0]).toString('utf8'));
    claims = JSON.parse(unb64u(parts[1]).toString('utf8'));
  } catch {
    return { ok: false, reasons: ['Envelope header or claims are not valid JSON.'] };
  }

  // Pinning alg rejects the "alg": "none" and algorithm-substitution families
  // outright rather than relying on the verifier to be asked for the right one.
  if (header.alg !== ALG) reasons.push(`Unsupported algorithm ${header.alg}; only ${ALG} is accepted.`);
  if (header.typ !== TYP) reasons.push(`Unexpected envelope type ${header.typ}.`);

  const signingInput = `${parts[0]}.${parts[1]}`;
  let signatureOk = false;
  try {
    signatureOk = createVerify('SHA256')
      .update(signingInput)
      .verify({ key: publicKeyPem, dsaEncoding: 'ieee-p1363' }, unb64u(parts[2]));
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) reasons.push('Signature does not verify against the registered key.');

  if (expectedIssuer && claims.iss !== expectedIssuer) {
    reasons.push('Issuer does not match the agent whose key signed this.');
  }
  if (expectedAudience && claims.aud !== expectedAudience) {
    reasons.push(`Envelope is addressed to ${claims.aud ?? 'nobody'}, not to us.`);
  }
  if (!claims.jti) reasons.push('Envelope has no jti, so replay cannot be prevented.');

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.iat !== 'number' || typeof claims.exp !== 'number') {
    reasons.push('Envelope is missing iat/exp.');
  } else {
    // A 60s skew allowance both ways: clocks differ, and an envelope rejected
    // for being two seconds early is a support ticket, not an attack.
    if (claims.exp < now - 60) reasons.push('Envelope has expired.');
    if (claims.iat > now + 60) reasons.push('Envelope is issued in the future.');
    if (now - claims.iat > maxAgeSeconds + 60) reasons.push(`Envelope is older than ${maxAgeSeconds}s.`);
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, claims };
}

/**
 * The form the gateway actually accepts: body sealed to the recipient, then the
 * whole thing signed.
 *
 * The jti is minted here rather than inside sign() because it has to exist
 * before the seal does — it is part of the AAD, which is what stops a
 * ciphertext being lifted into a second envelope with a fresh jti to get past
 * the replay table.
 *
 * `recipientPublicKeyPem` is the recipient's pinned P-256 key, and where it came
 * from decides whether any of this means anything: a sender that takes it from
 * whoever answered the connection has sealed to whoever answered the
 * connection. It must come from the sender's own a2a_agents row for that agent.
 * The recipient's agent card serves the same key over HTTPS, but the card is
 * not itself signed, so it is good for discovering a rotation and not for
 * deciding to trust one — compare its fingerprint against the pinned row.
 */
export function sealAndSign({
  plaintext, issuer, audience, privateKeyPem, recipientPublicKeyPem, ttlSeconds = MAX_AGE_SECONDS,
}) {
  const jti = randomUUID();
  const sealed = seal({
    plaintext,
    recipientPublicKeyPem,
    context: { iss: issuer, aud: audience, jti },
  });
  return sign({ payload: sealed, issuer, audience, privateKeyPem, ttlSeconds, jti });
}

/**
 * hashPayload() USED TO LIVE HERE and was what wrote a2a_audit.payload_hash.
 * It is gone deliberately: it would hash whatever it was handed, so with a
 * plaintext body in scope it was one refactor away from putting a digest of a
 * candidate's email into a table that outlives the message. The audit hash now
 * comes from sealing.hashCiphertext(), which refuses anything that is not
 * already ciphertext.
 */
