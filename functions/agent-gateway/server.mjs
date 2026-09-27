/**
 * server.mjs — the agent endpoint. Thin on purpose: every decision lives in
 * gateway.mjs so it can be exercised by the attack battery without a socket.
 */
import { createServer } from 'node:http';
import { handleInbound } from './lib/gateway.mjs';
import { query } from './lib/db.mjs';
import { readFile } from 'node:fs/promises';

const OUR_NAME = process.env.AGENT_NAME ?? 'agent://v1.employer.agenthire.biz';
const ACCEPTS_ROLE = process.env.ACCEPTED_ISSUER_ROLE ?? 'applicant';
const REQUIRED = (process.env.REQUIRED_FIELDS ?? 'full_name,email,resume_url').split(',');

const server = createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });

  // What this agent has accepted. The LEFT JOIN is where job_id linkage is
  // resolved: a message referencing a posting we never scanned still shows,
  // with the job fields null, rather than being hidden.
  if (req.method === 'GET' && req.url.startsWith('/messages')) {
    const { rows } = await query(
      `SELECT m.message_id, m.received_at, m.kind, m.from_agent, m.from_role,
              m.job_id, m.payload, m.status,
              j.job_title, j.company_name
         FROM a2a_messages m
         LEFT JOIN job_snapshots j ON j.job_id = m.job_id
        WHERE m.to_agent = $1
        ORDER BY m.received_at DESC
        LIMIT 50`,
      [OUR_NAME],
    );
    return send(200, { agent: OUR_NAME, count: rows.length, messages: rows });
  }

  // The agent card is public by design: an agent that will not say how to talk
  // to it cannot be talked to.
  if (req.method === 'GET' && req.url === '/.well-known/agent-card.json') {
    return send(200, JSON.parse(await readFile(new URL('./agent-card.json', import.meta.url), 'utf8')));
  }

  if (req.method !== 'POST' || !req.url.startsWith('/a2a/apply')) {
    return send(404, { error: 'POST /a2a/apply' });
  }

  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const result = await handleInbound({
      jws: body.jws,
      trust: body.trust,
      ourAgentName: OUR_NAME,
      acceptedIssuerRole: ACCEPTS_ROLE,
      requiredFields: REQUIRED,
    });
    // 403 rather than 400: the envelope was well-formed, we declined it. The
    // reasons are returned because a refusal the sender cannot understand is
    // indistinguishable from a bug.
    return send(result.accepted ? 200 : 403, result);
  } catch (err) {
    console.error(err);
    return send(500, { error: 'internal error' });
  }
});

server.listen(Number(process.env.PORT) || 8080, () => {
  console.log(`agent gateway listening as ${OUR_NAME}`);
});
