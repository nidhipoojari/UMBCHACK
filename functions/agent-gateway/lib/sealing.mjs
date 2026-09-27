/**
 * sealing.mjs — confidentiality for the message body.
 *
 * WHY THIS FILE EXISTS. envelope.mjs signs. A signature proves who wrote a
 * message and that nobody changed it; it does not hide it. Until now an
 * application — name, email, resume URL — travelled in a base64url claims
 * segment that anyone who could read the channel could read too: a logging
 * proxy, a load balancer that records bodies, a misconfigured CDN, anyone on
 * the path. Calling that "encrypted" was wrong, and this is the fix.
 *
 * THREE MECHANISMS, THREE DIFFERENT PROPERTIES. They are not interchangeable
 * and none of them subsumes another:
 *
 *   ECDH + HKDF-SHA256  → CONFIDENTIALITY. Only a holder of the recipient's
 *                         private key can derive the content key, so only the
 *                         recipient can read the body.
 *   AES-256-GCM tag     → INTEGRITY OF THE CIPHERTEXT, plus binding to the
 *                         envelope context via the AAD. A single flipped bit,
 *                         or a ciphertext lifted into a different envelope,
 *                         fails to decrypt rather than decrypting to garbage.
 *   ES256 signature     → AUTHENTICITY AND NON-REPUDIATION (envelope.mjs).
 *                         GCM's tag says "whoever held the content key wrote
 *                         this". Only the signature says *which registered
 *                         agent* did, in a form a third party can check later.
 *
 * WHY EPHEMERAL-STATIC ECDH AND NOT STATIC-STATIC. The obvious construction is
 * ECDH between the sender's pinned identity key and the recipient's pinned
 * identity key: both halves are already in a2a_agents, and no new field has to
 * travel. It was rejected for one reason — it has no forward secrecy. That
 * pair of long-lived keys derives the same secret for every message they ever
 * exchange, so one leaked private key retroactively decrypts every application
 * ever sent to or from that agent, including the ones already captured off the
 * wire. Here the sender generates a throwaway P-256 keypair per message and
 * discards the private half immediately; compromising a pinned identity key
 * later exposes messages sent to it from that point on, but cannot unlock a
 * transcript recorded before the compromise.
 *
 * The thing static-static would have bought — the shared secret itself proving
 * the sender's identity — we already have from the signature, and get in a
 * stronger form: a GCM tag convinces only the recipient, who could have forged
 * it, while a signature convinces anyone. So static-static costs forward
 * secrecy and buys nothing this envelope did not already have.
 *
 * The recipient's half of the exchange is still exactly the P-256 public key
 * pinned in a2a_agents. That pinning is what makes "sealed to the recipient"
 * mean anything: without it an attacker would simply hand the sender its own
 * public key and read everything.
 *
 * NO DEPENDENCY. node:crypto does P-256 ECDH, HKDF and AES-GCM directly. A
 * crypto library here would be a larger trusted base than this file, and the
 * whole point of the file is that it can be read.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

/** Bumped if any of the parameters below change. Carried in the blob so a
 *  receiver refuses a scheme it does not implement instead of guessing. */
export const SEAL_VERSION = 'a2a-seal-1';

const CURVE = 'prime256v1';          // P-256 — the curve a2a_agents already pins
const HKDF_HASH = 'sha256';
const KEY_BYTES = 32;                // AES-256
const SALT_BYTES = 32;               // = HashLen, the HKDF-recommended salt size
const IV_BYTES = 12;                 // the only nonce length GCM is proven at
const TAG_BYTES = 16;                // full-length tag; see assertions below

/**
 * HKDF `info` is a fixed domain-separation label, NOT the message context.
 * Its job is to guarantee that a key derived here can never collide with a key
 * derived from the same ECDH secret for some other purpose added later. The
 * per-message binding is the AAD instead, so that the two inputs have one job
 * each rather than both carrying the same thing.
 */
const HKDF_INFO = Buffer.from(`${SEAL_VERSION} content-key aes-256-gcm`, 'utf8');

const b64u = buf => Buffer.from(buf).toString('base64url');
const B64U_CHARS = /^[A-Za-z0-9_-]+$/;

/**
 * Buffer.from(s, 'base64url') is lenient: it skips characters it cannot use
 * rather than failing, so two different strings can decode to the same bytes
 * and a receiver can be shown a field that is not the field the sender signed.
 * Re-encoding and comparing rejects every non-canonical spelling.
 */
function strictUnb64u(value, what) {
  if (typeof value !== 'string' || !B64U_CHARS.test(value)) {
    throw new Error(`${what} is not base64url`);
  }
  const buf = Buffer.from(value, 'base64url');
  if (b64u(buf) !== value) throw new Error(`${what} is not canonical base64url`);
  return buf;
}

/**
 * The additional authenticated data: which protocol version, from whom, to
 * whom, and which message. GCM authenticates it without encrypting it, so a
 * ciphertext cut out of one envelope and pasted into another — re-addressed to
 * a different agent, or given a fresh jti to slip past the replay table — fails
 * its tag rather than decrypting.
 *
 * JSON rather than a delimiter-joined string: JSON escaping makes the encoding
 * injective for free, so `["a","bc"]` and `["ab","c"]` cannot collide, and it
 * does not depend on an assumption about which characters an agent name may
 * contain.
 */
function contextAad(context) {
  const { iss, aud, jti } = context ?? {};
  if (!iss || !aud || !jti) {
    throw new Error('sealing context requires iss, aud and jti');
  }
  return Buffer.from(JSON.stringify([SEAL_VERSION, String(iss), String(aud), String(jti)]), 'utf8');
}

/**
 * An EC key of the wrong curve is not a formatting problem, it is the invalid
 * curve / small subgroup family of attacks: hand the victim a point on a curve
 * whose group has tiny factors and their "shared secret" leaks their private
 * key a few bits at a time. node's diffieHellman refuses a mismatched pair,
 * but that is a side effect of its implementation rather than a check we asked
 * for, so it is asserted here where it can be read.
 */
function assertP256(key, what) {
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== CURVE) {
    throw new Error(`${what} is not a P-256 key`);
  }
  return key;
}

/** Derive the content key. Separate so seal and unseal cannot drift apart. */
function contentKey(privateKey, publicKey, salt) {
  const shared = diffieHellman({ privateKey, publicKey });
  const key = Buffer.from(hkdfSync(HKDF_HASH, shared, salt, HKDF_INFO, KEY_BYTES));
  // Raw ECDH output is a curve point's x-coordinate: it is not uniformly
  // distributed and using it directly as an AES key is the classic misuse.
  // HKDF-SHA256 with a per-message salt is what makes it key material.
  shared.fill(0);
  return key;
}

/**
 * Best-effort erasure. V8 may already have copied these bytes elsewhere and
 * nothing here can reach that copy, so this narrows the window in which a heap
 * dump yields a content key — it does not close it. Said plainly because a
 * comment claiming the key is gone would be the same kind of overclaim this
 * file exists to correct.
 */
const wipe = (...buffers) => { for (const b of buffers) b?.fill?.(0); };

/**
 * Seal a body for one recipient.
 *
 * @param plaintext              any JSON-serialisable value
 * @param recipientPublicKeyPem  the P-256 key pinned for that agent
 * @param context                { iss, aud, jti } — must match at unseal
 * @returns the sealed blob, all fields base64url, safe to put on the wire
 */
export function seal({ plaintext, recipientPublicKeyPem, context }) {
  const recipient = assertP256(createPublicKey(recipientPublicKeyPem), 'recipient key');
  const aad = contextAad(context);

  // The ephemeral private half never leaves this function and is never stored;
  // that is the whole of the forward secrecy argument in the header comment.
  const eph = generateKeyPairSync('ec', { namedCurve: CURVE });
  const salt = randomBytes(SALT_BYTES);
  const key = contentKey(eph.privateKey, recipient, salt);

  // A random 96-bit nonce rather than a counter. A counter is the stronger
  // choice only where a single writer keeps state; this runs on Cloud Run,
  // where instances start cold and in parallel, so a counter would reset and
  // repeat — and a repeated nonce under one GCM key discloses the XOR of two
  // plaintexts and the authentication subkey. The key here is fresh per
  // message anyway (new ephemeral keypair, new salt), so the nonce never has
  // to carry uniqueness on its own.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(plaintext ?? null), 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  wipe(key);

  return {
    v: SEAL_VERSION,
    // SPKI DER rather than PEM: a PEM inside a JSON string differs by line
    // endings and wrapping between platforms, and those differences would show
    // up as decryption failures that look like attacks.
    epk: b64u(eph.publicKey.export({ type: 'spki', format: 'der' })),
    salt: b64u(salt),
    iv: b64u(iv),
    ct: b64u(ct),
    tag: b64u(tag),
  };
}

/**
 * Shape check only — says nothing about whether the blob decrypts. Used to
 * tell "this sender did not encrypt at all" apart from "this did not open",
 * which are different refusals with different fixes.
 */
export function isSealed(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.v !== SEAL_VERSION) return false;
  return ['epk', 'salt', 'iv', 'ct', 'tag']
    .every(f => typeof value[f] === 'string' && value[f].length > 0 && B64U_CHARS.test(value[f]));
}

/**
 * @returns {{ok: true, plaintext: any} | {ok: false, reasons: string[]}}
 *
 * ON THE COARSENESS OF THE FAILURE REASON. "wrong key" and "altered
 * ciphertext" are reported as one refusal because they are genuinely
 * indistinguishable here: both are a GCM tag that does not verify, and there is
 * no computation that separates them. Reporting them separately would mean
 * inventing a distinction — and a receiver that tells an attacker which of its
 * guesses was closer is an oracle.
 */
export function unseal({ sealed, recipientPrivateKeyPem, context }) {
  if (!isSealed(sealed)) {
    return {
      ok: false,
      reasons: [`Message body is not a ${SEAL_VERSION} sealed body; this endpoint does not accept a plaintext body.`],
    };
  }

  let ours;
  let epk;
  let salt;
  let iv;
  let ct;
  let tag;
  let aad;
  try {
    ours = assertP256(createPrivateKey(recipientPrivateKeyPem), 'our identity key');
    epk = assertP256(
      createPublicKey({ key: strictUnb64u(sealed.epk, 'epk'), format: 'der', type: 'spki' }),
      "sender's ephemeral key",
    );
    salt = strictUnb64u(sealed.salt, 'salt');
    iv = strictUnb64u(sealed.iv, 'iv');
    ct = strictUnb64u(sealed.ct, 'ct');
    tag = strictUnb64u(sealed.tag, 'tag');
    aad = contextAad(context);
  } catch (err) {
    return { ok: false, reasons: [`Sealed body is malformed: ${err instanceof Error ? err.message : 'unreadable'}.`] };
  }

  // GCM accepts 12..16 byte tags and node will happily verify a short one. A
  // 12-byte tag lets a forger succeed about 2^32 times more often than a
  // 16-byte tag, and a sender does not get to choose that for us.
  if (tag.length !== TAG_BYTES) {
    return { ok: false, reasons: [`Authentication tag is ${tag.length} bytes; only a full ${TAG_BYTES}-byte tag is accepted.`] };
  }
  if (iv.length !== IV_BYTES) {
    return { ok: false, reasons: [`Nonce is ${iv.length} bytes; GCM is only used here with ${IV_BYTES}.`] };
  }
  if (salt.length !== SALT_BYTES) {
    return { ok: false, reasons: [`HKDF salt is ${salt.length} bytes; ${SALT_BYTES} are required.`] };
  }

  let key = null;
  let plaintextBuf = null;
  try {
    key = contentKey(ours, epk, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    plaintextBuf = Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    return {
      ok: false,
      reasons: ['Sealed body did not open: the authentication tag does not verify. The ciphertext was altered, or it was not sealed to our current key.'],
    };
  } finally {
    wipe(key);
  }

  try {
    return { ok: true, plaintext: JSON.parse(plaintextBuf.toString('utf8')) };
  } catch {
    return { ok: false, reasons: ['Sealed body opened but its contents are not JSON.'] };
  } finally {
    wipe(plaintextBuf);
  }
}

/**
 * The audit hash. Over the sealed blob's own fields, in a fixed order, so the
 * digest identifies exactly one wire artefact: the same plaintext sealed twice
 * produces two different hashes, which is correct — they are two different
 * deliveries.
 *
 * THE POINT OF THE TYPE ERROR. a2a_audit.payload_hash must never be able to
 * hold a body. This function is the only thing the gateway is allowed to
 * produce that column from, and it refuses anything that is not a sealed blob
 * rather than hashing it — so a future edit that passes plaintext here fails
 * loudly instead of quietly writing a hash of someone's email address into a
 * long-lived table. The database CHECK constraint in schema-a2a.sql is the
 * second half of the same guarantee.
 */
export function hashCiphertext(sealed) {
  if (!isSealed(sealed)) {
    throw new TypeError('hashCiphertext accepts only a sealed body; it must never be given plaintext.');
  }
  return createHash('sha256')
    .update(sealed.v).update('\0')
    .update(sealed.epk).update('\0')
    .update(sealed.salt).update('\0')
    .update(sealed.iv).update('\0')
    .update(sealed.ct).update('\0')
    .update(sealed.tag)
    .digest('base64url');
}

/** The public half of our identity key, for publishing in the agent card. */
export function publicKeyPemFrom(privateKeyPem) {
  const priv = assertP256(createPrivateKey(privateKeyPem), 'our identity key');
  return createPublicKey(priv).export({ type: 'spki', format: 'pem' });
}
