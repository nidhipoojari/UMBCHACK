/**
 * gateway.mjs — the inbound decision. One function, one ordered pipeline.
 *
 * ORDER IS THE DESIGN. Each step may only use facts established by the steps
 * before it, and the first failure stops the rest:
 *
 *   1  read the claimed issuer      — untrusted, used ONLY to pick a registry row
 *   2  fetch that row               — no row means no key means no trust
 *   3  structural checks            — https, domain anchoring, not revoked
 *   4  verify the signature         — everything above becomes trustworthy here
 *   5  the body must be sealed      — refuse a plaintext body, do not "accept" it
 *   6  role check                   — an employer may not apply as a candidate
 *   7  claim the jti                — exactly once, enforced by a PRIMARY KEY
 *   8  trust policy                 — verified identity is not permission
 *   9  open the sealed body         — the first step that touches our private key
 *  10  required fields              — only now is the payload worth reading
 *
 * Putting the signature check first would be circular (we need the issuer to
 * find the key). Putting the trust check before the signature would mean
 * scoring an agent that has not proven it is that agent.
 *
 * WHY DECRYPTION IS NEARLY LAST. It is the only step that uses our private key,
 * and it is the most expensive. Everything above it is free or nearly so, so an
 * unregistered, unsigned, stale or replayed envelope is turned away without
 * ever reaching a private-key operation — which is what keeps this endpoint from
 * being a CPU amplifier for an anonymous attacker.
 *
 * WHY THE PLAINTEXT NEVER REACHES audit(). The audit trail is retained long
 * after a message is, and is read by more people than the message is. It
 * records hashCiphertext() of the sealed body and nothing else; the refusal at
 * step 5 is what makes that unconditional, because a body that was never sealed
 * is refused rather than hashed.
 */
import { readClaimsUnverified, verify } from './envelope.mjs';
import { hashCiphertext, isSealed, unseal } from './sealing.mjs';
import { checkAgentRecord, parseAgentName } from './identity.mjs';
import { evaluateTrust } from './trust.mjs';

/**
 * The default storage: the real pool, reached through a dynamic import.
 *
 * A static `import { query } from './db.mjs'` would pull in pg and the Cloud SQL
 * connector the moment anything touched this module, so the attack battery
 * could not load the decision pipeline at all without first installing a
 * database driver it never uses. The import is cached after the first call, so
 * this costs one already-resolved promise per query in production and buys the
 * property that the security logic is exercisable with nothing installed.
 */
const defaultDb = {
  async query(text, params) {
    const { query } = await import('./db.mjs');
    return query(text, params);
  },
};

/**
 * `payloadHash` is named for the column it writes and is ALWAYS a
 * hashCiphertext() digest — 43 base64url characters, enforced again by
 * a2a_audit_hash_ck in the schema. There is no path by which a body reaches
 * this function.
 */
async function audit(db, { direction, agentName, jti, decision, reasons, payloadHash }) {
  try {
    await db.query(
      `INSERT INTO a2a_audit (direction, agent_name, jti, decision, reasons, payload_hash)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [direction, agentName ?? null, jti ?? null, decision, reasons ?? [], payloadHash ?? null],
    );
  } catch (err) {
    // An unwritable audit row must not turn a correct refusal into a 500, but it
    // is never silent: an audit trail with gaps is worse than one with none.
    console.error('audit write failed:', err instanceof Error ? err.message : err);
  }
}

/** Claim a jti. Returns false if it has been seen — the INSERT is the check. */
async function claimJti(db, jti, agentName, expUnix) {
  try {
    await db.query(
      `INSERT INTO a2a_seen_envelopes (jti, agent_name, expires_at)
       VALUES ($1,$2,to_timestamp($3))`,
      [jti, agentName, expUnix],
    );
    return true;
  } catch (err) {
    if (err?.code === '23505') return false; // unique_violation
    throw err;
  }
}

/**
 * `db` is a seam, defaulting to the real pool, so the attack battery can drive
 * this whole pipeline offline. It substitutes the *storage*, never a check: the
 * replay refusal below is still this function asking and believing the answer,
 * and in production the answer comes from a PRIMARY KEY.
 *
 * `ourPrivateKeyPem` is this deployment's identity key. It is read from a
 * mounted secret at startup (see agent-key.mjs) and is the one input here that
 * must never appear in the repository.
 */
export async function handleInbound({
  jws, ourAgentName, ourPrivateKeyPem, acceptedIssuerRole, requiredFields, trust, db = defaultDb,
}) {
  const refuse = async (reasons, agentName, jti, payloadHash) => {
    await audit(db, { direction: 'inbound', agentName, jti, decision: 'refused', reasons, payloadHash });
    return { accepted: false, reasons };
  };

  // 1 — untrusted read, solely to choose a registry row.
  const claimed = readClaimsUnverified(jws);
  if (!claimed?.iss) return refuse(['Envelope carries no issuer.']);

  // 2 — the key we will check against. No row, no conversation.
  const { rows } = await db.query('SELECT * FROM a2a_agents WHERE agent_name = $1', [claimed.iss]);
  const record = rows[0];
  if (!record) return refuse([`Agent ${claimed.iss} is not registered with us.`], claimed.iss, claimed.jti);

  // 3 — structural. Cheap, and independent of any signature.
  const structural = checkAgentRecord(record);
  if (!structural.ok) return refuse(structural.reasons, record.agent_name, claimed.jti);

  // 4 — the load-bearing step. Nothing above was trustworthy until now.
  const verified = verify(jws, {
    publicKeyPem: record.public_key_pem,
    expectedIssuer: record.agent_name,
    expectedAudience: ourAgentName,
  });
  if (!verified.ok) return refuse(verified.reasons, record.agent_name, claimed.jti);
  const { claims } = verified;

  // 5 — confidentiality is not optional, and a downgrade is a refusal.
  // An attacker on the wire cannot strip the seal (that would break the
  // signature), but a sender could simply not apply it — through an old client,
  // a bug, or on purpose — and accepting that would mean the property this
  // endpoint advertises held only when the sender felt like it. Refused before
  // anything is hashed, so a plaintext body leaves no derivative behind either.
  if (!isSealed(claims.payload)) {
    return refuse(
      ['Envelope body is not sealed. This endpoint accepts only a body encrypted to its published key; a signed plaintext body is refused.'],
      record.agent_name, claims.jti,
    );
  }
  // From here every audit row carries the ciphertext digest. hashCiphertext
  // throws on anything that is not already sealed, so this line cannot become a
  // hash of a body no matter what is edited above it.
  const payloadHash = hashCiphertext(claims.payload);

  // 6 — role confusion. A registered employer is still not a candidate.
  const senderRole = parseAgentName(record.agent_name)?.role;
  if (acceptedIssuerRole && senderRole !== acceptedIssuerRole) {
    return refuse(
      [`This endpoint accepts messages from a ${acceptedIssuerRole}; ${record.agent_name} is a ${senderRole}.`],
      record.agent_name, claims.jti, payloadHash,
    );
  }

  // 7 — replay. Claimed after verification so an unverified envelope cannot
  // burn a genuine jti and lock the real message out, and before decryption so
  // that a captured envelope replayed a thousand times costs us a single INSERT
  // each rather than a thousand ECDH operations.
  if (!(await claimJti(db, claims.jti, record.agent_name, claims.exp))) {
    return refuse(['This envelope has already been delivered once.'], record.agent_name, claims.jti, payloadHash);
  }

  // 8 — trust. Identity proven; permission still outstanding.
  const t = evaluateTrust(trust);
  if (!t.ok) return refuse(t.reasons, record.agent_name, claims.jti, payloadHash);

  // 9 — open the body. The AAD is the VERIFIED iss/aud/jti, not the ones the
  // envelope asked us to assume: that is what makes a ciphertext cut out of
  // another envelope fail here instead of decrypting.
  if (!ourPrivateKeyPem) {
    console.error('no agent private key configured; cannot open sealed bodies');
    return refuse(
      ['Sealed body could not be opened because this deployment has no identity key configured; this is a fault on our side.'],
      record.agent_name, claims.jti, payloadHash,
    );
  }
  const opened = unseal({
    sealed: claims.payload,
    recipientPrivateKeyPem: ourPrivateKeyPem,
    context: { iss: claims.iss, aud: claims.aud, jti: claims.jti },
  });
  if (!opened.ok) return refuse(opened.reasons, record.agent_name, claims.jti, payloadHash);
  const payload = opened.plaintext;

  // 10 — only now is the payload worth reading.
  const missing = (requiredFields ?? []).filter(f => {
    const v = payload?.[f];
    return v === undefined || v === null || String(v).trim() === '';
  });
  if (missing.length > 0) {
    return refuse([`Payload is missing required field(s): ${missing.join(', ')}.`], record.agent_name, claims.jti, payloadHash);
  }

  // 11 — persist. An accepted message that leaves no record is a handshake with
  // nothing behind it: the sender was told "yes" and nobody can act on it.
  // Written AFTER every gate so the table only ever holds messages we accepted.
  //
  // THE OPENED BODY IS STORED IN THE CLEAR, and that is the honest scope of the
  // sealing: it protects the message in transit, from everyone between the two
  // agents. It does not protect it from us. a2a_messages is the delivery
  // destination — an application nobody can read is not an application — so the
  // plaintext lands here and only here, under the database's own access
  // controls and the 30-day retention the agent card publishes. a2a_audit,
  // which outlives it, still sees only the ciphertext digest.
  const kind = senderRole === 'applicant' ? 'application' : 'invitation';
  let messageId = null;
  try {
    const { rows: ins } = await db.query(
      `INSERT INTO a2a_messages (jti, kind, from_agent, to_agent, from_role, job_id, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (jti) DO NOTHING
       RETURNING message_id`,
      [claims.jti, kind, record.agent_name, ourAgentName, senderRole,
       payload?.job_id ?? null, payload ?? {}],
    );
    messageId = ins[0]?.message_id ?? null;
  } catch (err) {
    // Storage failing after every gate passed is OUR fault, not the sender's.
    // Telling them "accepted" for a message we dropped would be a lie, so this
    // refuses — and says plainly that the refusal is not about them.
    console.error('message persist failed:', err instanceof Error ? err.message : err);
    return refuse(['Accepted but could not be stored; this is a fault on our side, please retry.'],
      record.agent_name, claims.jti, payloadHash);
  }

  await audit(db, {
    direction: 'inbound', agentName: record.agent_name, jti: claims.jti,
    decision: 'accepted', reasons: [], payloadHash,
  });
  // THE RESPONSE DOES NOT ECHO THE BODY. It used to return `payload`, which
  // was harmless while nothing was encrypted and is not harmless now: the
  // response travels the same channel the request was sealed against, so
  // echoing the opened body would hand the plaintext straight back to whoever
  // the sealing was meant to keep it from. The sender already has it. What goes
  // back is the receipt — that we accepted it, and the ciphertext digest, which
  // the sender can recompute to confirm we hold the message it sent.
  return {
    accepted: true, agent: record.agent_name, role: senderRole,
    kind, message_id: messageId, jti: claims.jti, ciphertext_sha256: payloadHash,
  };
}
