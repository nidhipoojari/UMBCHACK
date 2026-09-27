/**
 * attack-battery.mjs — the failure cases, not the happy path.
 *
 * Everything here runs offline: the envelope, identity and trust layers take no
 * database, so the security-relevant logic is testable without infrastructure.
 * Replay is the one check that needs Postgres, and it is asserted against the
 * PRIMARY KEY in an integration test rather than mocked here — a mocked replay
 * test proves the mock works.
 */
import { generateKeyPairSync } from 'node:crypto';
import assert from 'node:assert/strict';
import { sign, verify, fingerprint } from '../lib/envelope.mjs';
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
