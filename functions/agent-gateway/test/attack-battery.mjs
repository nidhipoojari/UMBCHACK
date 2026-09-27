/**
 * attack-battery.mjs — the failure cases, not the happy path.
 *
 * Everything here runs offline. The envelope, sealing, identity and trust
 * layers take no database, and the gateway pipeline is driven against an
 * in-memory stand-in for the four tables it writes.
 *
 * WHAT THE STAND-IN DOES AND DOES NOT PROVE. It replaces STORAGE, never a
 * check. The replay case below proves that the gateway asks whether a jti has
 * been seen and refuses when told yes — which is the part that lives in this
 * repository and the part a refactor can break. It does not prove Postgres
 * enforces a PRIMARY KEY; that is asserted against the real table in
 * deployment, because asserting it here would only prove the stand-in works.
 *
 * Every key in this file is generated at run time. Nothing is committed, and
 * .gitignore refuses functions/**\/*.key and functions/**\/*.pem so that a
 * fixture key cannot quietly become one.
 */
import { generateKeyPairSync } from 'node:crypto';
import assert from 'node:assert/strict';
import { sign, sealAndSign, verify, fingerprint } from '../lib/envelope.mjs';
import { seal, unseal, isSealed, hashCiphertext, publicKeyPemFrom } from '../lib/sealing.mjs';
import { handleInbound } from '../lib/gateway.mjs';
import { checkAgentRecord } from '../lib/identity.mjs';
import { evaluateTrust } from '../lib/trust.mjs';

const kp = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    pub: publicKey.export({ type: 'spki', format: 'pem' }),
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
};

const applicant = kp();
const attacker = kp();
const us = kp();          // the receiving gateway's identity key
const otherAgent = kp();  // a second recipient, for the wrong-key cases

const US = 'agent://v1.employer.agenthire.biz';
const THEM = 'agent://v1.applicant.agenthire.biz';
const goodTrust = Object.fromEntries(
  ['integrity', 'identity', 'solvency', 'behavior', 'safety'].map(d => [d, { score: 90, reason: 'clean record' }]),
);

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name} ${detail}`); }
};

console.log('\nenvelope');
const good = sign({ payload: { full_name: 'A' }, issuer: THEM, audience: US, privateKeyPem: applicant.priv });
check('control: genuine envelope verifies',
  verify(good, { publicKeyPem: applicant.pub, expectedIssuer: THEM, expectedAudience: US }).ok);

check('impersonation: signed with another key is refused',
  !verify(good, { publicKeyPem: attacker.pub, expectedIssuer: THEM, expectedAudience: US }).ok);

const tampered = (() => {
  const p = good.split('.');
  const claims = JSON.parse(Buffer.from(p[1], 'base64url').toString());
  claims.payload.full_name = 'B';
  p[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return p.join('.');
})();
check('tampering: modified payload breaks the signature',
  !verify(tampered, { publicKeyPem: applicant.pub, expectedIssuer: THEM, expectedAudience: US }).ok);

const algNone = (() => {
  const p = good.split('.');
  p[0] = Buffer.from(JSON.stringify({ alg: 'none', typ: 'agenthire-a2a+jws' })).toString('base64url');
  return p.join('.');
})();
check('alg confusion: "none" is refused',
  !verify(algNone, { publicKeyPem: applicant.pub, expectedIssuer: THEM, expectedAudience: US }).ok);

const wrongAud = sign({ payload: {}, issuer: THEM, audience: 'agent://v1.employer.example.com', privateKeyPem: applicant.priv });
check('wrong audience: addressed elsewhere is refused',
  !verify(wrongAud, { publicKeyPem: applicant.pub, expectedIssuer: THEM, expectedAudience: US }).ok);

const expired = sign({ payload: {}, issuer: THEM, audience: US, privateKeyPem: applicant.priv, ttlSeconds: -300 });
check('expiry: stale envelope is refused',
  !verify(expired, { publicKeyPem: applicant.pub, expectedIssuer: THEM, expectedAudience: US }).ok);

check('malformed: non-JWS input is refused',
  !verify('not-a-jws', { publicKeyPem: applicant.pub }).ok);

console.log('\nidentity');
const rec = o => ({ agent_name: THEM, role: 'applicant', endpoint: 'https://agenthire.biz/a2a/apply', ...o });
check('control: well-formed record passes', checkAgentRecord(rec()).ok);
check('plaintext endpoint is refused', !checkAgentRecord(rec({ endpoint: 'http://agenthire.biz/x' })).ok);
check('endpoint off-domain is refused', !checkAgentRecord(rec({ endpoint: 'https://evil.com/x' })).ok);
check('lookalike domain is refused', !checkAgentRecord(rec({ endpoint: 'https://notagenthire.biz/x' })).ok);
check('revoked registration is refused', !checkAgentRecord(rec({ revoked_at: new Date() })).ok);
check('role confusion in the name is refused',
  !checkAgentRecord(rec({ agent_name: 'agent://v1.employer.agenthire.biz', role: 'applicant' })).ok);
check('unversioned name is refused', !checkAgentRecord(rec({ agent_name: 'agent://applicant.agenthire.biz' })).ok);

console.log('\ntrust');
check('control: strong scores pass', evaluateTrust(goodTrust).ok);
check('score without a reason is refused',
  !evaluateTrust({ ...goodTrust, safety: { score: 99 } }).ok);
check('one dimension below floor is refused',
  !evaluateTrust({ ...goodTrust, behavior: { score: 40, reason: 'multiple complaints' } }).ok);
check('passing floors but weak average is refused',
  !evaluateTrust(Object.fromEntries(['integrity','identity','solvency','behavior','safety']
    .map(d => [d, { score: 70, reason: 'thin history' }]))).ok);
check('missing dimension is refused', !evaluateTrust({ integrity: { score: 90, reason: 'x' } }).ok);

/* ------------------------------------------------------------------ *
 * confidentiality — what the signature above does NOT give us.
 *
 * Signing proves who wrote a message and that nobody changed it. Every case
 * above is about that, and not one of them stops a reader on the path from
 * reading the application. These are the cases that do.
 * ------------------------------------------------------------------ */
console.log('\nconfidentiality');

// A distinctive marker: if it ever shows up somewhere it should not, the test
// can say so without guessing at field names.
const SECRET = 'MARKER-ssn-000-00-4242-MARKER';
const BODY = { full_name: 'A', email: `${SECRET}@example.com`, resume_url: 'https://example.com/r.pdf' };
const ctx = (jti, iss = THEM, aud = US) => ({ iss, aud, jti });

const sealed = seal({ plaintext: BODY, recipientPublicKeyPem: us.pub, context: ctx('j-1') });

check('control: a sealed body opens for the intended recipient',
  (() => {
    const r = unseal({ sealed, recipientPrivateKeyPem: us.priv, context: ctx('j-1') });
    return r.ok && r.plaintext.email === BODY.email;
  })());

// The point of the whole exercise, stated as a test rather than as a claim in a
// comment: the bytes that go on the wire do not contain the body.
const sealedEnvelope = sealAndSign({
  plaintext: BODY, issuer: THEM, audience: US,
  privateKeyPem: applicant.priv, recipientPublicKeyPem: us.pub,
});
check('the wire carries no plaintext: the marker is absent from the envelope',
  !sealedEnvelope.includes(SECRET)
  && !sealedEnvelope.split('.').some(p => Buffer.from(p, 'base64url').toString('latin1').includes(SECRET)));

check('the signed envelope still verifies and its body is sealed',
  (() => {
    const v = verify(sealedEnvelope, { publicKeyPem: applicant.pub, expectedIssuer: THEM, expectedAudience: US });
    return v.ok && isSealed(v.claims.payload);
  })());

// Tampering, at the two levels it can happen. An attacker on the wire hits the
// signature first; the direct case is what the GCM tag is for, and is what a
// bug or a compromised intermediate that could re-sign would hit.
const flip = (b64, i = 0) => {
  const buf = Buffer.from(b64, 'base64url');
  buf[i] ^= 0x01;
  return buf.toString('base64url');
};
check('tampered ciphertext: a single flipped bit fails the GCM tag',
  !unseal({ sealed: { ...sealed, ct: flip(sealed.ct) }, recipientPrivateKeyPem: us.priv, context: ctx('j-1') }).ok);
check('tampered nonce is refused',
  !unseal({ sealed: { ...sealed, iv: flip(sealed.iv) }, recipientPrivateKeyPem: us.priv, context: ctx('j-1') }).ok);
check('tampered HKDF salt is refused',
  !unseal({ sealed: { ...sealed, salt: flip(sealed.salt) }, recipientPrivateKeyPem: us.priv, context: ctx('j-1') }).ok);
check('substituted ephemeral key is refused',
  !unseal({
    sealed: { ...sealed, epk: seal({ plaintext: {}, recipientPublicKeyPem: us.pub, context: ctx('j-1') }).epk },
    recipientPrivateKeyPem: us.priv, context: ctx('j-1'),
  }).ok);

check('tampered ciphertext inside an envelope breaks the signature first',
  (() => {
    const p = sealedEnvelope.split('.');
    const claims = JSON.parse(Buffer.from(p[1], 'base64url').toString());
    claims.payload.ct = flip(claims.payload.ct);
    p[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return !verify(p.join('.'), { publicKeyPem: applicant.pub, expectedIssuer: THEM, expectedAudience: US }).ok;
  })());

// Wrong key. Holding *a* valid P-256 private key is not holding the right one.
check('wrong-key decrypt: another agent\'s key does not open it',
  !unseal({ sealed, recipientPrivateKeyPem: otherAgent.priv, context: ctx('j-1') }).ok);
check('wrong-key decrypt: the sender\'s own key does not open it',
  !unseal({ sealed, recipientPrivateKeyPem: applicant.priv, context: ctx('j-1') }).ok);
check('a body sealed to someone else does not open for us',
  !unseal({
    sealed: seal({ plaintext: BODY, recipientPublicKeyPem: otherAgent.pub, context: ctx('j-1') }),
    recipientPrivateKeyPem: us.priv, context: ctx('j-1'),
  }).ok);

// AAD binding. A ciphertext is not a portable object: it belongs to one
// envelope, addressed to one agent, carrying one jti.
check('ciphertext lifted into an envelope with a fresh jti does not open',
  !unseal({ sealed, recipientPrivateKeyPem: us.priv, context: ctx('j-2') }).ok);
check('ciphertext re-addressed to another audience does not open',
  !unseal({ sealed, recipientPrivateKeyPem: us.priv, context: ctx('j-1', THEM, 'agent://v1.employer.example.com') }).ok);
check('ciphertext re-attributed to another issuer does not open',
  !unseal({ sealed, recipientPrivateKeyPem: us.priv, context: ctx('j-1', 'agent://v1.applicant.example.com', US) }).ok);

// Parameter downgrades a sender does not get to choose for us.
check('truncated authentication tag is refused',
  !unseal({
    sealed: { ...sealed, tag: Buffer.from(sealed.tag, 'base64url').subarray(0, 12).toString('base64url') },
    recipientPrivateKeyPem: us.priv, context: ctx('j-1'),
  }).ok);
check('short nonce is refused',
  !unseal({
    sealed: { ...sealed, iv: Buffer.from(sealed.iv, 'base64url').subarray(0, 8).toString('base64url') },
    recipientPrivateKeyPem: us.priv, context: ctx('j-1'),
  }).ok);
check('an ephemeral key on another curve is refused',
  !unseal({
    sealed: {
      ...sealed,
      epk: generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
        .publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    },
    recipientPrivateKeyPem: us.priv, context: ctx('j-1'),
  }).ok);
check('an unknown seal version is refused', !isSealed({ ...sealed, v: 'a2a-seal-2' }));
check('non-canonical base64url is refused',
  !unseal({ sealed: { ...sealed, ct: `${sealed.ct}=` }, recipientPrivateKeyPem: us.priv, context: ctx('j-1') }).ok);

// Two seals of the same body must not be the same bytes — otherwise the
// ciphertext is a stable identifier and an observer learns from repetition
// alone which applications are the same document.
check('the same body sealed twice produces different ciphertext',
  seal({ plaintext: BODY, recipientPublicKeyPem: us.pub, context: ctx('j-1') }).ct !== sealed.ct);

// The audit hash cannot be handed a body.
check('hashCiphertext refuses plaintext', (() => {
  try { hashCiphertext(BODY); return false; } catch { return true; }
})());
check('hashCiphertext of a sealed body is a 43-char base64url digest',
  /^[A-Za-z0-9_-]{43}$/.test(hashCiphertext(sealed)));
check('hashCiphertext distinguishes two seals of the same body',
  hashCiphertext(seal({ plaintext: BODY, recipientPublicKeyPem: us.pub, context: ctx('j-1') })) !== hashCiphertext(sealed));

check('publicKeyPemFrom recovers the public half', publicKeyPemFrom(us.priv).trim() === us.pub.trim());

/* ------------------------------------------------------------------ *
 * the gateway pipeline, end to end and offline.
 *
 * The stand-in below replaces the four tables handleInbound writes. It is
 * storage, not policy: a2a_seen_envelopes is a Set that raises 23505 on a
 * duplicate because that is what the PRIMARY KEY does, and the refusal under
 * test is the gateway's reaction to it.
 * ------------------------------------------------------------------ */
console.log('\ngateway');

const REGISTRY = {
  agent_name: THEM, role: 'applicant',
  endpoint: 'https://agenthire.biz/a2a/apply',
  public_key_pem: applicant.pub, key_fingerprint: fingerprint(applicant.pub),
  revoked_at: null,
};

function fakeDb() {
  const seen = new Set();
  const audits = [];
  const messages = [];
  return {
    audits,
    messages,
    async query(text, params = []) {
      if (text.includes('FROM a2a_agents')) {
        return { rows: params[0] === REGISTRY.agent_name ? [REGISTRY] : [] };
      }
      if (text.includes('INTO a2a_seen_envelopes')) {
        if (seen.has(params[0])) {
          const e = new Error('duplicate key value violates unique constraint');
          e.code = '23505';
          throw e;
        }
        seen.add(params[0]);
        return { rows: [] };
      }
      if (text.includes('INTO a2a_audit')) {
        audits.push({ agent: params[1], jti: params[2], decision: params[3], reasons: params[4], hash: params[5] });
        return { rows: [] };
      }
      if (text.includes('INTO a2a_messages')) {
        messages.push({ jti: params[0], payload: params[6] });
        return { rows: [{ message_id: messages.length }] };
      }
      throw new Error(`unexpected statement in the offline stand-in: ${text.slice(0, 40)}`);
    },
  };
}

const inbound = (db, jws, extra = {}) => handleInbound({
  jws, db, trust: goodTrust,
  ourAgentName: US, ourPrivateKeyPem: us.priv,
  acceptedIssuerRole: 'applicant',
  requiredFields: ['full_name', 'email', 'resume_url'],
  ...extra,
});

{
  const db = fakeDb();
  const envelope = sealAndSign({
    plaintext: BODY, issuer: THEM, audience: US,
    privateKeyPem: applicant.priv, recipientPublicKeyPem: us.pub,
  });

  const first = await inbound(db, envelope);
  check('control: a sealed, signed, trusted envelope is accepted', first.accepted === true, JSON.stringify(first.reasons));
  check('the opened body reaches a2a_messages', db.messages[0]?.payload?.email === BODY.email);

  // THE REPLAY CASE. Byte-for-byte the same envelope, captured off the wire and
  // sent again. Nothing about it is forged — it is genuinely signed, genuinely
  // sealed, genuinely fresh — which is exactly why the jti is the only thing
  // that can stop it, and why an attacker cannot change the jti without
  // breaking the signature.
  const second = await inbound(db, envelope);
  check('replay: a captured envelope is refused on its second delivery', second.accepted === false);
  check('replay: the refusal says so', /already been delivered/.test(second.reasons?.[0] ?? ''));
  check('replay: it does not produce a second message row', db.messages.length === 1);

  // The audit trail, which outlives the message.
  check('audit: every row carries a ciphertext digest, never a body',
    db.audits.length > 0 && db.audits.every(a => a.hash === null || /^[A-Za-z0-9_-]{43}$/.test(a.hash)));
  check('audit: the marker appears in no audit row',
    !JSON.stringify(db.audits).includes(SECRET));
  check('audit: the accepted row hashes the ciphertext the sender sent',
    db.audits[0].hash === hashCiphertext(
      JSON.parse(Buffer.from(envelope.split('.')[1], 'base64url').toString()).payload));
  check('the response does not echo the opened body',
    !('payload' in first) && !JSON.stringify(first).includes(SECRET));
}

{
  // Downgrade. A correctly signed envelope from a registered agent whose body
  // was simply never sealed. Nothing on the wire did this — the sender did — and
  // accepting it would mean the confidentiality held only when convenient.
  const db = fakeDb();
  const plain = sign({ payload: BODY, issuer: THEM, audience: US, privateKeyPem: applicant.priv });
  const r = await inbound(db, plain);
  check('downgrade: a signed plaintext body is refused', r.accepted === false);
  check('downgrade: the refusal names the missing seal', /not sealed/.test(r.reasons?.[0] ?? ''));
  check('downgrade: nothing derived from the plaintext is written',
    db.audits.every(a => a.hash === null) && !JSON.stringify(db.audits).includes(SECRET));
}

{
  // Sealed to the wrong key — an agent that used a stale copy of our card, or
  // one that was fed an attacker's key. Authentic, and still refused.
  const db = fakeDb();
  const misdirected = sealAndSign({
    plaintext: BODY, issuer: THEM, audience: US,
    privateKeyPem: applicant.priv, recipientPublicKeyPem: otherAgent.pub,
  });
  const r = await inbound(db, misdirected);
  check('a body sealed to another key is refused by the gateway', r.accepted === false);
  check('the refusal does not say which of the two failures it was',
    /tag does not verify/.test(r.reasons?.[0] ?? ''));
  check('a refused decrypt still leaves a ciphertext digest in the audit',
    db.audits.some(a => /^[A-Za-z0-9_-]{43}$/.test(a.hash)));
}

{
  // An unregistered sender. It can seal to our published key — the key is
  // public, that is the point — but it has no row, so it has no key we would
  // check its signature against.
  const db = fakeDb();
  const stranger = sealAndSign({
    plaintext: BODY, issuer: 'agent://v1.applicant.evil.example', audience: US,
    privateKeyPem: attacker.priv, recipientPublicKeyPem: us.pub,
  });
  check('an unregistered agent is refused however well it seals',
    (await inbound(db, stranger)).accepted === false);
}

{
  // A registered agent's name with someone else's signature.
  const db = fakeDb();
  const impersonation = sealAndSign({
    plaintext: BODY, issuer: THEM, audience: US,
    privateKeyPem: attacker.priv, recipientPublicKeyPem: us.pub,
  });
  const r = await inbound(db, impersonation);
  check('impersonation through the full pipeline is refused', r.accepted === false);
  check('impersonation does not burn the real agent\'s jti',
    db.audits.every(a => a.decision === 'refused'));
}

{
  // Configuration, not attack: a deployment with no identity key must refuse
  // rather than accept something it cannot read.
  const db = fakeDb();
  const envelope = sealAndSign({
    plaintext: BODY, issuer: THEM, audience: US,
    privateKeyPem: applicant.priv, recipientPublicKeyPem: us.pub,
  });
  const r = await inbound(db, envelope, { ourPrivateKeyPem: null });
  check('a gateway with no identity key refuses instead of accepting blind', r.accepted === false);
  check('and says the fault is ours', /fault on our side/.test(r.reasons?.[0] ?? ''));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
