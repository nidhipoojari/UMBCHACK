/**
 * agent-key.mjs — where this deployment's own private key comes from.
 *
 * Registration only ever handles public halves (see register-agent.mjs). This
 * is the one place the private half enters the process, and it exists so that
 * there is exactly one such place to audit.
 *
 * TWO SOURCES, IN THIS ORDER, AND WHY.
 *
 *   AGENT_PRIVATE_KEY_FILE — a path to a Secret Manager volume mount. Preferred
 *     because a mounted secret is not in the environment block, so it does not
 *     appear in `gcloud run services describe`, in a crash dump of environ, or
 *     in the log line some future handler writes when it dumps process.env to
 *     debug something else.
 *
 *   AGENT_PRIVATE_KEY_PEM_B64 — base64 PEM in the environment. Kept only
 *     because local development and the attack battery need a way in without a
 *     volume, and base64 so that a multi-line PEM survives a shell.
 *
 * FAIL FAST, NOT LAZILY. A gateway with no key still passes /health and still
 * accepts connections; it just refuses every message once it reaches the point
 * of opening one — which looks like every sender being at fault. Better to
 * refuse to start.
 *
 * The key file itself is never in this repository: .gitignore refuses
 * functions/**\/*.key and functions/**\/*.pem, and nothing here writes one.
 */
import { readFileSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';

/**
 * `env` is any record of the two names below, not necessarily process.env. The
 * parameter was always there for tests; the web tier now uses it to load the
 * applicant and employer keys from a different pair of variables in one process,
 * which is why the type is written out — without it a caller in TypeScript is
 * told to supply a whole ProcessEnv, NODE_ENV and all, for a function that reads
 * exactly two keys.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string} the PEM, parsed and checked
 */
export function loadAgentPrivateKeyPem(env = process.env) {
  const path = env.AGENT_PRIVATE_KEY_FILE;
  const b64 = env.AGENT_PRIVATE_KEY_PEM_B64;

  let pem;
  if (path) {
    try {
      pem = readFileSync(path, 'utf8');
    } catch (err) {
      throw new Error(`AGENT_PRIVATE_KEY_FILE=${path} could not be read: ${err.message}`);
    }
  } else if (b64) {
    pem = Buffer.from(b64, 'base64').toString('utf8');
  } else {
    throw new Error(
      'No agent identity key. Set AGENT_PRIVATE_KEY_FILE (a mounted secret) or ' +
      'AGENT_PRIVATE_KEY_PEM_B64. Generate one with: ' +
      "openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt",
    );
  }

  // Parse now so a malformed or wrong-curve key is a startup failure with a
  // readable message, rather than an exception inside a request handler. The
  // error is re-thrown without the key's contents for the obvious reason.
  let key;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new Error('Agent identity key is not a readable PEM private key.');
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('Agent identity key must be EC P-256, to match the keys pinned in a2a_agents.');
  }
  return pem;
}
