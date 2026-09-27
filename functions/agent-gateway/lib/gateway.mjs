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
 *   5  role check                   — an employer may not apply as a candidate
 *   6  claim the jti                — exactly once, enforced by a PRIMARY KEY
 *   7  trust policy                 — verified identity is not permission
 *   8  required fields              — only now is the payload worth reading
 *
 * Putting the signature check first would be circular (we need the issuer to
 * find the key). Putting the trust check before the signature would mean
 * scoring an agent that has not proven it is that agent.
 */
import { query } from './db.mjs';
import { readClaimsUnverified, verify, hashPayload } from './envelope.mjs';
import { checkAgentRecord, parseAgentName } from './identity.mjs';
import { evaluateTrust } from './trust.mjs';

async function audit({ direction, agentName, jti, decision, reasons, payloadHash }) {
  try {
    await query(
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
async function claimJti(jti, agentName, expUnix) {
  try {
    await query(
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

export async function handleInbound({ jws, ourAgentName, acceptedIssuerRole, requiredFields, trust }) {
  const refuse = async (reasons, agentName, jti, payloadHash) => {
    await audit({ direction: 'inbound', agentName, jti, decision: 'refused', reasons, payloadHash });
    return { accepted: false, reasons };
  };

  // 1 — untrusted read, solely to choose a registry row.
  const claimed = readClaimsUnverified(jws);
  if (!claimed?.iss) return refuse(['Envelope carries no issuer.']);

  // 2 — the key we will check against. No row, no conversation.
  const { rows } = await query('SELECT * FROM a2a_agents WHERE agent_name = $1', [claimed.iss]);
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
  const payloadHash = hashPayload(claims.payload);

  // 5 — role confusion. A registered employer is still not a candidate.
  const senderRole = parseAgentName(record.agent_name)?.role;
  if (acceptedIssuerRole && senderRole !== acceptedIssuerRole) {
    return refuse(
      [`This endpoint accepts messages from a ${acceptedIssuerRole}; ${record.agent_name} is a ${senderRole}.`],
      record.agent_name, claims.jti, payloadHash,
    );
  }

  // 6 — replay. Claimed after verification so an unverified envelope cannot
  // burn a genuine jti and lock the real message out.
  if (!(await claimJti(claims.jti, record.agent_name, claims.exp))) {
    return refuse(['This envelope has already been delivered once.'], record.agent_name, claims.jti, payloadHash);
  }

  // 7 — trust. Identity proven; permission still outstanding.
  const t = evaluateTrust(trust);
  if (!t.ok) return refuse(t.reasons, record.agent_name, claims.jti, payloadHash);

  // 8 — only now is the payload worth reading.
  const missing = (requiredFields ?? []).filter(f => {
    const v = claims.payload?.[f];
    return v === undefined || v === null || String(v).trim() === '';
  });
  if (missing.length > 0) {
    return refuse([`Payload is missing required field(s): ${missing.join(', ')}.`], record.agent_name, claims.jti, payloadHash);
  }

  // 9 — persist. An accepted message that leaves no record is a handshake with
  // nothing behind it: the sender was told "yes" and nobody can act on it.
  // Written AFTER every gate so the table only ever holds messages we accepted.
  const kind = senderRole === 'applicant' ? 'application' : 'invitation';
  let messageId = null;
  try {
    const { rows: ins } = await query(
      `INSERT INTO a2a_messages (jti, kind, from_agent, to_agent, from_role, job_id, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (jti) DO NOTHING
       RETURNING message_id`,
      [claims.jti, kind, record.agent_name, ourAgentName, senderRole,
       claims.payload?.job_id ?? null, claims.payload ?? {}],
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

  await audit({
    direction: 'inbound', agentName: record.agent_name, jti: claims.jti,
    decision: 'accepted', reasons: [], payloadHash,
  });
  return {
    accepted: true, agent: record.agent_name, role: senderRole,
    kind, message_id: messageId, payload: claims.payload, jti: claims.jti,
  };
}
