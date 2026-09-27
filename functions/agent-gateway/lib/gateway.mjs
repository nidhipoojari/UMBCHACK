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
import { AUTH_SCHEME, READ_SCOPE, readClaimsUnverified, verify } from './envelope.mjs';
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

/** `Authorization: A2A <compact jws>`. Anything else is not a credential. */
function parseReadAuthorization(header) {
  // The compact-JWS alphabet plus the two dots. A regex rather than a split on
  // whitespace so that a header carrying extra parameters, or a second scheme,
  // is refused outright instead of being partly understood.
  const m = new RegExp(`^${AUTH_SCHEME}\\s+([A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+)$`, 'i')
    .exec(String(header ?? '').trim());
  return m ? m[1] : null;
}

/**
 * authorizeRead — who may read this agent's mailbox.
 *
 * THE PROBLEM THIS EXISTS FOR. handleInbound seals an application against
 * everyone on the path between two agents. GET /messages then served every
 * opened body to anyone who could reach the route, which made the sealing a
 * claim that ended at our own front door. Documenting that was honest and was
 * still the wrong behaviour.
 *
 * WHAT A CALLER MUST PRESENT. An `Authorization: A2A <jws>` header carrying an
 * envelope signed by THIS agent's own pinned key, addressed to itself, scoped
 * to `messages.read` and to the route being read, with a jti that has not been
 * used. Not a new scheme: the same signature check, the same a2a_agents row,
 * the same replay table as a message delivery.
 *
 * WHY iss MUST EQUAL ourAgentName. A mailbox belongs to one agent and the only
 * claim being made is "I am that agent". A registered *counterparty* proving
 * its own identity perfectly is still not this agent, and gets the same refusal
 * as a stranger — which is why the check below is an equality test against our
 * own name and not a membership test against the registry.
 *
 * WHY A HEADER AND NOT A QUERY PARAMETER. A credential in a URL ends up in
 * access logs, proxy logs, browser history and Referer headers — the exact
 * places a credential must not be, and the reason this route needed fixing.
 *
 * WHY NOT A BEARER TOKEN OR SHARED SECRET. It would be a second identity
 * scheme beside the one in a2a_agents, with its own distribution and rotation
 * story, and a bearer credential replays forever once captured. The P-256 keys
 * already exist, already rotate with an UPDATE, and already have a replay guard.
 *
 * WHY NOT mTLS. Cloud Run terminates TLS at its front end, so client
 * certificates would need a separate load balancer in front of it and a second
 * trust anchor beside the fingerprints already pinned here.
 *
 * WHY NOT MAKE THE ROUTE A POST SO THERE IS A BODY TO SIGN. A read is safe and
 * idempotent and should stay a GET; turning it into a POST to obtain a signable
 * body would cost those properties and buy nothing the header does not give.
 *
 * WHY THE SCOPE AND PATH ARE IN THE SIGNED PAYLOAD. Without them, any envelope
 * addressed to this agent would double as a read credential — including an
 * application captured in flight before it was delivered. The scope claim makes
 * the two kinds of envelope disjoint in both directions: a read credential has
 * an unsealed payload, and handleInbound refuses an unsealed body.
 *
 * WHAT AN ATTACKER WHO CAPTURES ONE OF THESE HEADERS CAN DO. Present it once,
 * inside its lifetime, and read this mailbox once — and in doing so cause the
 * legitimate request to be refused as a replay, which is a denial of service
 * that lands in the audit rather than passing unnoticed.
 *
 * WHAT THEY CANNOT DO. Use it after the legitimate request lands, because the
 * jti is burned by whichever arrives first. Use it more than about two minutes
 * after capture. Present it to the other gateway deployment, which has a
 * different `aud`. Turn it into an application, or any other write, because the
 * scope is signed. Mint a fresh one, which needs the agent's private key. Learn
 * anything from the header itself, which carries no body.
 *
 * WHAT THIS DOES NOT DO. It does not encrypt the response. The bodies come back
 * under TLS and under this check on who may ask, and they are not sealed to the
 * caller the way an inbound application is sealed to us.
 */
export async function authorizeRead({ authorization, ourAgentName, path, db = defaultDb }) {
  // `presented` is the 401/403 distinction: nothing offered versus something
  // offered and refused. Every refusal is audited, because a read refused
  // without a readable reason is indistinguishable from a bug — the same rule
  // the message pipeline follows.
  const refuse = async (reasons, { agentName = null, jti = null, presented = true } = {}) => {
    await audit(db, {
      direction: 'inbound', agentName, jti, decision: 'refused', reasons,
      // A read carries no body, so there is no body to hash. NULL rather than
      // a digest of the scope claim: payload_hash means one thing, and a column
      // that sometimes means something else is not an audit trail.
      payloadHash: null,
    });
    return { ok: false, presented, reasons };
  };

  const jws = parseReadAuthorization(authorization);
  if (!jws) {
    return refuse(
      [`This mailbox requires an ${AUTH_SCHEME} credential: an envelope signed by ${ourAgentName}, scoped to ${READ_SCOPE}.`],
      { presented: Boolean(String(authorization ?? '').trim()) },
    );
  }

  // Untrusted, and used only to decide which row to fetch — the same
  // bootstrapping problem, and the same rule, as handleInbound step 1.
  const claimed = readClaimsUnverified(jws);
  if (!claimed?.iss) return refuse(['Read credential carries no issuer.']);

  if (claimed.iss !== ourAgentName) {
    return refuse(
      [`This mailbox belongs to ${ourAgentName}; the credential is signed as ${claimed.iss}.`],
      { agentName: claimed.iss, jti: claimed.jti },
    );
  }

  const { rows } = await db.query('SELECT * FROM a2a_agents WHERE agent_name = $1', [ourAgentName]);
  const record = rows[0];
  if (!record) {
    // Our own name is not in the registry, so there is no pinned key to check a
    // credential against. Refusing is the only safe reading of that, and the
    // message says whose fault it is.
    console.error(`this deployment's agent name ${ourAgentName} is not registered; mailbox reads cannot be authorized`);
    return refuse(
      ['This deployment has no registry entry, so a read cannot be authorized against a pinned key. This is a fault on our side.'],
      { agentName: ourAgentName, jti: claimed.jti },
    );
  }

  // Structural checks apply to us too. A revoked registration stops reads as
  // well as messages, which is the point of revoking one.
  const structural = checkAgentRecord(record);
  if (!structural.ok) return refuse(structural.reasons, { agentName: ourAgentName, jti: claimed.jti });

  const verified = verify(jws, {
    publicKeyPem: record.public_key_pem,
    expectedIssuer: ourAgentName,
    expectedAudience: ourAgentName,
  });
  if (!verified.ok) return refuse(verified.reasons, { agentName: ourAgentName, jti: claimed.jti });
  const { claims } = verified;

  const scope = claims.payload?.scope;
  const forPath = claims.payload?.path;
  if (scope !== READ_SCOPE) {
    return refuse(
      [`This credential is scoped to ${scope ?? 'nothing'}; reading this mailbox requires ${READ_SCOPE}.`],
      { agentName: ourAgentName, jti: claims.jti },
    );
  }
  if (forPath !== path) {
    return refuse(
      [`This credential is scoped to ${forPath ?? 'no route'}, not to ${path}.`],
      { agentName: ourAgentName, jti: claims.jti },
    );
  }

  // Replay, on the same table and by the same mechanism as a delivery: the
  // INSERT is the check. Claimed last so that a credential refused for any
  // reason above does not burn a jti the legitimate caller would then be
  // unable to use.
  if (!(await claimJti(db, claims.jti, ourAgentName, claims.exp))) {
    return refuse(['This read credential has already been used once.'], { agentName: ourAgentName, jti: claims.jti });
  }

  await audit(db, {
    direction: 'inbound', agentName: ourAgentName, jti: claims.jti, decision: 'accepted',
    // An accepted read is recorded as what it was. Without this a reader of the
    // table would have to infer "this row is a read, not a delivery" from
    // payload_hash being NULL, which is an accident waiting to be relied on.
    reasons: [`Authorized read of ${path}, scope ${READ_SCOPE}.`],
    payloadHash: null,
  });
  return { ok: true, agent: ourAgentName, jti: claims.jti };
}
