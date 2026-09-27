/**
 * identity.mjs — agent names, and what a name is allowed to imply.
 *
 * A name looks like `agent://v1.applicant.agenthire.biz`. The domain is not
 * decoration: an agent's endpoint hostname MUST sit under the domain its own
 * name claims. Without that rule a registered name could point its endpoint at
 * any host on the internet, and "verified agent" would mean only "verified
 * string".
 */
const NAME_RE = /^agent:\/\/v(\d+)\.([a-z0-9-]+)\.(.+)$/i;

export function parseAgentName(name) {
  const m = NAME_RE.exec(String(name ?? ''));
  if (!m) return null;
  return { version: Number(m[1]), role: m[2].toLowerCase(), domain: m[3].toLowerCase() };
}

export function hostUnderDomain(hostname, domain) {
  const h = String(hostname ?? '').toLowerCase();
  const d = String(domain ?? '').toLowerCase();
  // Endswith alone would let `notagenthire.biz` pass for `agenthire.biz`, so the
  // suffix match is anchored on a dot.
  return h === d || h.endsWith(`.${d}`);
}

/**
 * Structural checks on a registry entry. Cheap, deterministic, and independent
 * of whether we trust the agent — an entry can be perfectly well-formed and
 * still be refused by policy.
 */
export function checkAgentRecord(record) {
  const reasons = [];
  const parsed = parseAgentName(record?.agent_name);
  if (!parsed) reasons.push('Agent name is not a versioned agent:// name.');
  if (record?.revoked_at) reasons.push('Agent registration has been revoked.');

  let url = null;
  try {
    url = new URL(record?.endpoint ?? '');
  } catch {
    reasons.push('Agent endpoint is not a valid URL.');
  }
  if (url && url.protocol !== 'https:') reasons.push('Agent endpoint is not HTTPS.');
  if (url && parsed && !hostUnderDomain(url.hostname, parsed.domain)) {
    reasons.push(`Endpoint host ${url.hostname} is not under the domain ${parsed.domain} its name claims.`);
  }
  if (parsed && record?.role && parsed.role !== record.role) {
    reasons.push(`Name claims role ${parsed.role} but registration says ${record.role}.`);
  }
  return { ok: reasons.length === 0, reasons, parsed };
}
