import 'server-only';

import { db } from '@/lib/db';

/**
 * The agent-to-agent menu: who this deployment will speak to, and what the
 * gateway decided about every envelope that arrived.
 *
 * READ-ONLY, ON PURPOSE. Nothing here writes. The trail is produced by the
 * gateway and by `connectToAlumnus` in lib/alumni.ts; a page that could edit
 * its own audit trail would not be an audit trail. Every number this module
 * returns is a COUNT or an aggregate over rows that already exist — the same
 * rule lib/alumni.ts follows for XP, and for the same reason: a stored total is
 * a second source of truth that drifts the first time a row moves.
 *
 * THE REFUSALS ARE THE PRODUCT. A filter you cannot interrogate is
 * indistinguishable from a bug, so a refused envelope is not an error to be
 * swallowed — it is the evidence that the pinning, the replay window and the
 * trust floor are doing something. They are carried all the way to the UI with
 * their reasons intact, never collapsed into a status code.
 *
 * NO CAST ANYWHERE. Unlike `alumni`, the a2a tables are properly typed — but
 * the counts are still selected as ::text and parsed in JS, because pg returns
 * bigint as a string and `count(*)` silently arriving as "12" instead of 12 is
 * the kind of thing that renders as "012" somewhere downstream.
 */

/** The scheme every agent in this deployment is named under. */
const ALUMNI_PREFIX = 'agent://v1.alumni.agenthire.biz/';
const APPLICANT_AGENT = 'agent://v1.applicant.agenthire.biz';

/**
 * How many audit rows the feed carries.
 *
 * The whole trail is twelve rows today and would fit, but this page is the one
 * that gets opened after a demo has been hammered at, so the query is bounded.
 * Bounded at the newest end: an audit feed truncated at the *old* end still
 * tells the truth, one truncated at the new end does not.
 */
const FEED_LIMIT = 60;

export type AgentKind = 'registered' | 'alumni' | 'unregistered';

export type AgentCard = {
  agentName: string;
  kind: AgentKind;
  role: string | null;
  endpoint: string | null;
  /** SHA-256 of the registered public key. Null means no key is pinned at all. */
  fingerprint: string | null;
  registeredAt: string | null;
  revokedAt: string | null;
  /**
   * Envelopes in the trail that CLAIMED this name — not envelopes this agent
   * proved it sent. The distinction is the entire point of the registry: the
   * name is asserted by the caller, the fingerprint is what turns it into an
   * identity, and some of these counts are refusals precisely because the two
   * did not match.
   */
  accepted: number;
  refused: number;
  lastSeen: string | null;
  /** Alumni agents only: the envelope id the introduction was sent under. */
  jti: string | null;
};

/** The identity this student's own envelopes are signed by. */
export type SelfAgent = {
  agentName: string;
  fingerprint: string | null;
  endpoint: string | null;
  registered: boolean;
  /** Introductions this student has actually sent. One connection row each. */
  sent: number;
  accepted: number;
  refused: number;
};

export type TrailStats = {
  envelopes: number;
  accepted: number;
  refused: number;
  /** Distinct jti values. Fewer than `envelopes` means a replay was caught. */
  envelopeIds: number;
  agentsSeen: number;
  agentsPinned: number;
  agentsUnknown: number;
  lastSeen: string | null;
};

export type AuditEntry = {
  auditId: string;
  occurredAt: string;
  direction: string;
  agentName: string | null;
  jti: string | null;
  decision: string;
  reasons: string[];
  payloadHash: string | null;
};

export type Defence = {
  key: string;
  title: string;
  /** What this check is for, in one line. Static text, never a number. */
  blurb: string;
  /** Refusal reasons in the trail that matched. 0 means never fired. */
  matched: number;
  /** A real reason string, verbatim. Null when the defence has never fired. */
  example: string | null;
  lastSeen: string | null;
};

export type Rank = {
  title: string;
  seen: number;
  total: number;
  /** Reasons that matched no defence. Surfaced so nothing is quietly dropped. */
  unclassified: number;
};

export type A2AView = {
  self: SelfAgent;
  registered: AgentCard[];
  alumni: AgentCard[];
  unregistered: AgentCard[];
  trail: TrailStats;
  defences: Defence[];
  rank: Rank;
  feed: AuditEntry[];
};

/**
 * The checks the gateway can refuse on.
 *
 * WHY A TABLE OF PATTERNS AND NOT A COLUMN. `reasons` is free text written by
 * whichever check fired, and it embeds the offending value ("Agent agent://…
 * is not registered with us"), so grouping on the raw string would scatter one
 * defence across as many buckets as there are attackers. Matching is therefore
 * done here, over the real strings, and the count is still a COUNT — a defence
 * shows as seen only when an actual audit row matched it. Nothing is seeded,
 * and a defence that has never fired stays at zero rather than being softened
 * into a plausible-looking number.
 *
 * `duplicate` is in the list at zero today. Leaving it out until it fires would
 * be tidier and would also be a lie by omission: it is a check the code makes,
 * so it belongs on the board as something not yet triggered.
 */
const DEFENCES: readonly { key: string; title: string; blurb: string; test: RegExp }[] = [
  {
    key: 'identity',
    title: 'Unregistered caller',
    blurb: 'The name on the envelope has no row in the registry, so there is no key to check it against.',
    test: /is not registered with us/i,
  },
  {
    key: 'signature',
    title: 'Signature mismatch',
    blurb: 'The envelope was signed, but not by the key pinned to the name it claims.',
    test: /signature does not verify/i,
  },
  {
    key: 'replay',
    title: 'Replayed envelope',
    blurb: 'This envelope id has been delivered once already. A second delivery is a replay.',
    test: /already been delivered once/i,
  },
  {
    key: 'audience',
    title: 'Wrong audience',
    blurb: 'The envelope names someone else as its recipient. Forwarding it would make us the attacker.',
    test: /addressed to .*, not to us/i,
  },
  {
    key: 'schema',
    title: 'Incomplete payload',
    blurb: 'A required field is missing, so the request is refused rather than half-applied.',
    test: /missing required field/i,
  },
  {
    key: 'trust',
    title: 'Below the trust floor',
    blurb: 'The caller is who it says it is, and is still not trusted enough on solvency, behaviour or the aggregate.',
    test: /trust dimension|aggregate trust/i,
  },
  {
    key: 'duplicate',
    title: 'Already spoken to',
    blurb: 'A second approach to the same alumnus. Recorded as a refusal instead of silently doing nothing.',
    test: /duplicate: already connected/i,
  },
];

/**
 * Titles by how much of the filter the trail has actually exercised.
 *
 * Indexed by the number of defences seen, so the array is one longer than
 * DEFENCES. This is the only "game" number on the page and it is still a count
 * of real rows: it moves when a check fires, not when a button is pressed.
 */
const RANK_TITLES = [
  'Untested',
  'First probe',
  'Probed',
  'Filter holding',
  'Filter proven',
  'Well interrogated',
  'Thoroughly interrogated',
  'Fully mapped',
];

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);
const num = (value: string | null | undefined): number => Number(value ?? 0);

type AgentRow = {
  agent_name: string;
  role: string | null;
  endpoint: string | null;
  key_fingerprint: string | null;
  registered_at: Date | null;
  revoked_at: Date | null;
  accepted: string;
  refused: string;
  last_seen: Date | null;
};

/**
 * Everything the agents page shows, for one signed-in student.
 *
 * The queries run together because none of them depends on another's result,
 * and the page is worthless half-rendered: a roster without its trail invites
 * exactly the "looks fine to me" reading the audit exists to prevent.
 */
export async function a2aView(userId: string): Promise<A2AView> {
  const [registeredRes, unknownRes, alumniRes, trailRes, reasonRes, feedRes, sentRes, mineRes] =
    await Promise.all([
      // The registry itself, with the trail counted beside it. LEFT JOIN, so a
      // freshly registered agent that has never been spoken to still appears —
      // "registered and silent" is a real state and an INNER JOIN would hide it.
      db.query<AgentRow>(
        `SELECT g.agent_name, g.role, g.endpoint, g.key_fingerprint,
                g.registered_at, g.revoked_at,
                count(a.audit_id) FILTER (WHERE a.decision = 'accepted')::text AS accepted,
                count(a.audit_id) FILTER (WHERE a.decision = 'refused')::text AS refused,
                max(a.occurred_at) AS last_seen
           FROM a2a_agents g
           LEFT JOIN a2a_audit a ON a.agent_name = g.agent_name
          GROUP BY g.agent_name, g.role, g.endpoint, g.key_fingerprint,
                   g.registered_at, g.revoked_at
          ORDER BY g.registered_at`,
      ),

      // Names that turned up in the trail with no registry row behind them.
      // These are the most informative rows on the page and they exist only as
      // the difference between two tables, which is why they are their own
      // query rather than a flag on the one above.
      db.query<{ agent_name: string; accepted: string; refused: string; last_seen: Date | null }>(
        `SELECT a.agent_name,
                count(*) FILTER (WHERE a.decision = 'accepted')::text AS accepted,
                count(*) FILTER (WHERE a.decision = 'refused')::text AS refused,
                max(a.occurred_at) AS last_seen
           FROM a2a_audit a
           LEFT JOIN a2a_agents g ON g.agent_name = a.agent_name
          WHERE a.agent_name IS NOT NULL AND g.agent_name IS NULL
          GROUP BY a.agent_name
          ORDER BY max(a.occurred_at) DESC`,
      ),

      // This student's alumni agents.
      //
      // JOINED ON agent_name, NOT ON jti. `connectToAlumnus` writes the first
      // approach's jti onto the connection row and then leaves it alone, while
      // a repeat approach is audited under a fresh jti. Joining on jti would
      // therefore find the accept and silently lose every later refusal —
      // dropping exactly the rows this page exists to show.
      db.query<{
        campus_id: string;
        jti: string;
        created_at: Date;
        accepted: string;
        refused: string;
        last_seen: Date | null;
      }>(
        `SELECT c.campus_id, c.jti, c.created_at,
                count(a.audit_id) FILTER (WHERE a.decision = 'accepted')::text AS accepted,
                count(a.audit_id) FILTER (WHERE a.decision = 'refused')::text AS refused,
                max(a.occurred_at) AS last_seen
           FROM alumni_connections c
           LEFT JOIN a2a_audit a ON a.agent_name = $2 || c.campus_id
          WHERE c.user_id = $1
          GROUP BY c.campus_id, c.jti, c.created_at
          ORDER BY c.created_at DESC
          LIMIT 24`,
        [userId, ALUMNI_PREFIX],
      ),

      db.query<{
        envelopes: string;
        accepted: string;
        refused: string;
        envelope_ids: string;
        agents_seen: string;
        last_seen: Date | null;
      }>(
        `SELECT count(*)::text AS envelopes,
                count(*) FILTER (WHERE decision = 'accepted')::text AS accepted,
                count(*) FILTER (WHERE decision = 'refused')::text AS refused,
                count(DISTINCT jti)::text AS envelope_ids,
                count(DISTINCT agent_name)::text AS agents_seen,
                max(occurred_at) AS last_seen
           FROM a2a_audit`,
      ),

      // One row per distinct reason string, which is what the defence board is
      // built from. Grouping in SQL keeps this bounded by the number of
      // distinct refusals rather than by the size of the trail.
      db.query<{ reason: string; n: string; last_seen: Date }>(
        `SELECT r AS reason, count(*)::text AS n, max(occurred_at) AS last_seen
           FROM a2a_audit, unnest(reasons) AS r
          GROUP BY r
          ORDER BY count(*) DESC, max(occurred_at) DESC`,
      ),

      db.query<{
        audit_id: string;
        occurred_at: Date;
        direction: string;
        agent_name: string | null;
        jti: string | null;
        decision: string;
        reasons: string[] | null;
        payload_hash: string | null;
      }>(
        `SELECT audit_id::text, occurred_at, direction, agent_name, jti,
                decision, reasons, payload_hash
           FROM a2a_audit
          ORDER BY occurred_at DESC, audit_id DESC
          LIMIT $1`,
        [FEED_LIMIT],
      ),

      db.query<{ sent: string }>(
        `SELECT count(*)::text AS sent FROM alumni_connections WHERE user_id = $1`,
        [userId],
      ),

      // What the trail says about this student's own traffic specifically.
      // a2a_audit has no user_id — it is a record of envelopes, not of people —
      // so "mine" can only mean envelopes sent under agent names this student's
      // own connection rows account for. Anything broader would be someone
      // else's traffic shown as theirs.
      db.query<{ accepted: string; refused: string }>(
        `SELECT count(*) FILTER (WHERE decision = 'accepted')::text AS accepted,
                count(*) FILTER (WHERE decision = 'refused')::text AS refused
           FROM a2a_audit
          WHERE agent_name IN (
                  SELECT $2 || campus_id FROM alumni_connections WHERE user_id = $1
                )`,
        [userId, ALUMNI_PREFIX],
      ),
    ]);

  const registered: AgentCard[] = registeredRes.rows.map((row) => ({
    agentName: row.agent_name,
    kind: 'registered',
    role: row.role,
    endpoint: row.endpoint,
    fingerprint: row.key_fingerprint,
    registeredAt: iso(row.registered_at),
    revokedAt: iso(row.revoked_at),
    accepted: num(row.accepted),
    refused: num(row.refused),
    lastSeen: iso(row.last_seen),
    jti: null,
  }));

  const unregistered: AgentCard[] = unknownRes.rows.map((row) => ({
    agentName: row.agent_name,
    kind: 'unregistered',
    role: null,
    endpoint: null,
    fingerprint: null,
    registeredAt: null,
    revokedAt: null,
    accepted: num(row.accepted),
    refused: num(row.refused),
    lastSeen: iso(row.last_seen),
    jti: null,
  }));

  // Alumni agents carry no fingerprint and that is not an omission to be
  // papered over: they are addressed through this gateway rather than dialled
  // directly, so there is no key of theirs to pin. The card says so rather than
  // leaving a blank where a fingerprint would go.
  const alumni: AgentCard[] = alumniRes.rows.map((row) => ({
    agentName: `${ALUMNI_PREFIX}${row.campus_id}`,
    kind: 'alumni',
    role: 'alumnus',
    endpoint: null,
    fingerprint: null,
    registeredAt: iso(row.created_at),
    revokedAt: null,
    accepted: num(row.accepted),
    refused: num(row.refused),
    lastSeen: iso(row.last_seen),
    jti: row.jti,
  }));

  const t = trailRes.rows[0];
  const trail: TrailStats = {
    envelopes: num(t?.envelopes),
    accepted: num(t?.accepted),
    refused: num(t?.refused),
    envelopeIds: num(t?.envelope_ids),
    agentsSeen: num(t?.agents_seen),
    agentsPinned: registered.length,
    agentsUnknown: unregistered.length,
    lastSeen: iso(t?.last_seen ?? null),
  };

  // Each reason is offered to every defence, so a row carrying two reasons
  // counts towards both — which is what the trail actually says happened.
  let unclassified = 0;
  const tally = new Map<string, { matched: number; example: string | null; lastSeen: Date | null }>();
  for (const row of reasonRes.rows) {
    const hits = DEFENCES.filter((d) => d.test.test(row.reason));
    if (hits.length === 0) unclassified += num(row.n);
    for (const hit of hits) {
      const current = tally.get(hit.key) ?? { matched: 0, example: null, lastSeen: null };
      current.matched += num(row.n);
      // The first reason wins because the query is ordered commonest first: the
      // example shown should be the one a reader is most likely to meet.
      current.example ??= row.reason;
      if (!current.lastSeen || row.last_seen > current.lastSeen) current.lastSeen = row.last_seen;
      tally.set(hit.key, current);
    }
  }

  const defences: Defence[] = DEFENCES.map((d) => {
    const hit = tally.get(d.key);
    return {
      key: d.key,
      title: d.title,
      blurb: d.blurb,
      matched: hit?.matched ?? 0,
      example: hit?.example ?? null,
      lastSeen: iso(hit?.lastSeen ?? null),
    };
  });

  const seen = defences.filter((d) => d.matched > 0).length;
  const rank: Rank = {
    title: RANK_TITLES[Math.min(seen, RANK_TITLES.length - 1)],
    seen,
    total: DEFENCES.length,
    unclassified,
  };

  const feed: AuditEntry[] = feedRes.rows.map((row) => ({
    auditId: row.audit_id,
    occurredAt: row.occurred_at.toISOString(),
    direction: row.direction,
    agentName: row.agent_name,
    jti: row.jti,
    decision: row.decision,
    reasons: row.reasons ?? [],
    payloadHash: row.payload_hash,
  }));

  // The student's own identity is the registered applicant agent, not an agent
  // of their own. Saying so on the card is better than implying a per-student
  // key that does not exist: what tells one student's envelopes from another's
  // is the jti, and the page should not pretend otherwise.
  const applicant = registered.find((a) => a.agentName === APPLICANT_AGENT) ?? null;
  const mine = mineRes.rows[0];
  const self: SelfAgent = {
    agentName: APPLICANT_AGENT,
    fingerprint: applicant?.fingerprint ?? null,
    endpoint: applicant?.endpoint ?? null,
    registered: applicant !== null,
    sent: num(sentRes.rows[0]?.sent),
    accepted: num(mine?.accepted),
    refused: num(mine?.refused),
  };

  return { self, registered, alumni, unregistered, trail, defences, rank, feed };
}
