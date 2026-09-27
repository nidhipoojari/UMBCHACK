/**
 * register-agent.mjs — pins one agent's public key.
 *
 * The PRIVATE key is generated outside this job and never travels here: the
 * registry only ever needs the public half, and a job that could see private
 * keys would be a far more attractive target than one that cannot.
 */
import { query } from './lib/db.mjs';
import { fingerprint } from './lib/envelope.mjs';

const name = process.env.REG_AGENT_NAME;
const role = process.env.REG_AGENT_ROLE;
const endpoint = process.env.REG_AGENT_ENDPOINT;
const pem = Buffer.from(process.env.REG_AGENT_PUBKEY_B64 ?? '', 'base64').toString('utf8');
if (!name || !role || !endpoint || !pem) throw new Error('REG_AGENT_* env vars are required');

await query(
  `INSERT INTO a2a_agents (agent_name, role, endpoint, public_key_pem, key_fingerprint)
   VALUES ($1,$2,$3,$4,$5)
   ON CONFLICT (agent_name) DO UPDATE
     SET public_key_pem = EXCLUDED.public_key_pem,
         key_fingerprint = EXCLUDED.key_fingerprint,
         endpoint = EXCLUDED.endpoint,
         revoked_at = NULL`,
  [name, role, endpoint, pem, fingerprint(pem)],
);
const { rows } = await query('SELECT agent_name, role, key_fingerprint FROM a2a_agents ORDER BY agent_name');
console.log('registered:', JSON.stringify(rows));
process.exit(0);
