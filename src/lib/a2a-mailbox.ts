import 'server-only';

import {
  EMPLOYER_AGENT,
  agentPrivateKeyPem,
  canActAs,
  employerGatewayUrl,
  invokerToken,
  ownEnvelopeJti,
  readAuthorizationHeader,
  signReadRequest,
} from '@/lib/a2a-identity';

/**
 * a2a-mailbox.ts — the employer's side of the wire.
 *
 * WHY THIS ASKS THE AGENT INSTEAD OF SELECTING FROM a2a_messages.
 *
 * The rows are in a database this process can already reach; `SELECT ... FROM
 * a2a_messages WHERE to_agent = ...` would be four lines, need no key, and
 * return the same data. It was rejected, for one reason that survives scrutiny
 * and one that does not.
 *
 * The one that survives: the mailbox has an access rule, and the rule lives in
 * the gateway. gateway.authorizeRead() requires an envelope signed by the
 * mailbox owner's own pinned key, addressed to itself, scoped to
 * `messages.read` AND to the route, with an unused jti — and it audits every
 * read, accepted or refused. Reading around it by going straight to the table
 * would mean the product's claim ("a signed credential is required to read a
 * mailbox") held for anyone who came in the front door and not for the one
 * caller that actually reads it. Twenty-four of the attack battery's cases are
 * about that rule; none of them would be exercised by anything real.
 *
 * The one that does not survive, and is stated so it is not mistaken for a
 * reason: this does NOT keep the employer's mail away from agentHire. agentHire
 * runs both agents, owns the database, and opens the body at the gateway. The
 * sealing protects an application from everyone on the path between the two
 * agents; it has never protected it from us, the schema comment on
 * a2a_messages says so, and routing this read over HTTP does not change it.
 *
 * WHAT THIS COSTS. The web tier has to hold the EMPLOYER agent's private key as
 * well as the applicant's, because a read credential can only be minted by the
 * mailbox owner. That is a real widening of the blast radius of a compromise of
 * this process, and it buys a demonstrated access rule rather than a
 * confidentiality property. It is the honest trade and it is worth writing down
 * on both sides.
 *
 * NO SILENT FALLBACK. If this deployment has no employer key, or the gateway
 * refuses the credential, the caller gets the refusal and its reasons. It does
 * not quietly drop to a SQL read — a fallback that bypasses the check under
 * load or misconfiguration is the check not existing.
 */

export type MailboxMessage = {
  messageId: string;
  receivedAt: string;
  kind: string;
  fromAgent: string;
  fromRole: string;
  jobId: string | null;
  /** The opened application body. Whatever the sender chose to include. */
  payload: Record<string, unknown>;
  status: string;
  /** Resolved by the gateway's LEFT JOIN; null when we never scanned the job. */
  jobTitle: string | null;
  companyName: string | null;
};

export type MailboxResult =
  | {
      ok: true;
      agent: string;
      messages: MailboxMessage[];
      /** The envelope id this read was authorized under. It is in a2a_audit. */
      credentialJti: string | null;
    }
  | {
      ok: false;
      agent: string;
      /** The gateway's own words when it refused; ours when we never asked. */
      reasons: string[];
      /** 401 means nothing was presented, 403 means it was and was refused. */
      status: number | null;
    };

type GatewayRow = {
  message_id: string | number;
  received_at: string;
  kind: string;
  from_agent: string;
  from_role: string;
  job_id: string | null;
  payload: Record<string, unknown> | null;
  status: string;
  job_title: string | null;
  company_name: string | null;
};

/**
 * The route the credential is scoped to.
 *
 * It must be the string the gateway compares against, which server.mjs sets to
 * '/messages' — not req.url. The handler reads no query parameters, so there is
 * nothing in a query string that could widen what comes back; binding the
 * credential to a fuller URL would mean re-signing for a filter that does not
 * exist. Written as a constant beside the fetch so the two cannot drift without
 * it being visible in one screen.
 */
const READ_PATH = '/messages';

export async function readEmployerMailbox(): Promise<MailboxResult> {
  if (!canActAs('employer')) {
    return {
      ok: false,
      agent: EMPLOYER_AGENT,
      status: null,
      reasons: [
        `This deployment holds no identity key for ${EMPLOYER_AGENT}, so it cannot mint a ` +
          'read credential for that mailbox. Mount the a2a-employer-agent-key secret and set ' +
          'A2A_EMPLOYER_KEY_FILE. Nothing is read without one.',
      ],
    };
  }

  // A fresh credential per read. It is good for 60 seconds (plus the 60s of
  // clock skew verify() allows every envelope), single-use, and burned by the
  // gateway's replay table the moment it lands — so caching one to save a
  // signature would produce a credential that is refused the second time it is
  // used, which is the replay guard working and would look like a bug.
  const credential: string = signReadRequest({
    agentName: EMPLOYER_AGENT,
    path: READ_PATH,
    privateKeyPem: agentPrivateKeyPem('employer'),
  });

  const base = employerGatewayUrl();
  const token = await invokerToken(base);

  let res: Response;
  try {
    res = await fetch(`${base}${READ_PATH}`, {
      headers: {
        // `Authorization` belongs to the AGENT LAYER here, so the Cloud Run
        // invoker token cannot go in it. The two schemes genuinely collide on
        // this route: Cloud Run reads Authorization for IAM, and the gateway
        // reads it for the A2A credential. X-Serverless-Authorization is the
        // documented way out — Cloud Run checks it instead, strips it, and
        // passes Authorization through untouched.
        //
        // The apply POST has no such collision: its A2A envelope travels in the
        // request body, which leaves Authorization free for the Bearer. Hence
        // the two paths carrying the invoker token in different headers, which
        // would otherwise look like an inconsistency.
        authorization: readAuthorizationHeader(credential),
        ...(token ? { 'x-serverless-authorization': `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return {
      ok: false,
      agent: EMPLOYER_AGENT,
      status: null,
      reasons: [
        `Could not reach the employer agent at ${base}: ` +
          `${err instanceof Error ? err.message : 'connection failed'}.`,
      ],
    };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { reasons?: string[]; error?: string };
    return {
      ok: false,
      agent: EMPLOYER_AGENT,
      status: res.status,
      // The gateway's reasons are passed through verbatim. A refused read with
      // no readable reason is indistinguishable from a bug — the same rule the
      // message pipeline follows, and the reason authorizeRead() returns them.
      reasons:
        body.reasons ??
        [body.error ?? `The employer agent answered ${res.status} with no reason given.`],
    };
  }

  const body = (await res.json()) as { agent?: string; messages?: GatewayRow[] };
  return {
    ok: true,
    agent: body.agent ?? EMPLOYER_AGENT,
    // Read back off the credential this process just minted, so the screen can
    // name the a2a_audit row this read produced. The gateway audits an accepted
    // read under this jti with the scope it was granted.
    credentialJti: ownEnvelopeJti(credential),
    messages: (body.messages ?? []).map((r) => ({
      messageId: String(r.message_id),
      receivedAt: r.received_at,
      kind: r.kind,
      fromAgent: r.from_agent,
      fromRole: r.from_role,
      jobId: r.job_id,
      payload: r.payload ?? {},
      status: r.status,
      jobTitle: r.job_title,
      companyName: r.company_name,
    })),
  };
}
