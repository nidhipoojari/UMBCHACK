/**
 * verification.ts — the two things a student needs to know about an employer,
 * and nothing else.
 *
 * WHY TWO BADGES AND NOT A SCORE. A student reading a job is not auditing a
 * security posture; they are deciding whether to spend an afternoon on an
 * application. "Registered" and "secure" are the two facts that change that
 * decision. Everything else the registry knows — fingerprints, endpoints,
 * envelope counts, revocation dates — is evidence FOR those two facts, and
 * belongs behind them rather than beside them.
 *
 * THESE RULES ARE A MIRROR, NOT A SECOND OPINION. `checkAgentRecord()` in
 * functions/agent-gateway/lib/identity.mjs is what actually decides whether an
 * envelope from this agent is accepted. What follows reproduces that rule so a
 * badge can be drawn without a round trip to the gateway. It is a copy, and a
 * copy can drift — so it is deliberately the SAME shape, in the same order,
 * with the same dot-anchored host check. If the gateway's rule changes, this
 * file is wrong until it changes too, and the badge would then claim something
 * the gateway does not honour. That is the failure mode to watch for; it is
 * better than the alternative of inventing a looser rule here, which would put
 * a reassuring badge on an agent the gateway itself would refuse.
 */

/** `agent://v1.employer.agenthire.biz` → version, role, domain. */
const NAME_RE = /^agent:\/\/v(\d+)\.([a-z0-9-]+)\.(.+)$/i;

export type ParsedAgentName = { version: number; role: string; domain: string };

export function parseAgentName(name: string | null | undefined): ParsedAgentName | null {
  const m = NAME_RE.exec(String(name ?? ''));
  if (!m) return null;
  return { version: Number(m[1]), role: m[2].toLowerCase(), domain: m[3].toLowerCase() };
}

/**
 * Is `hostname` the domain itself, or beneath it?
 *
 * The dot is load-bearing. A bare endsWith would let `notagenthire.biz` satisfy
 * `agenthire.biz`, which is the exact shape of a lookalike-domain attack — and
 * this badge exists to tell a student that attack did not happen.
 */
export function hostUnderDomain(hostname: string, domain: string): boolean {
  const h = hostname.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

export type AgentRecord = {
  agentName: string;
  role?: string | null;
  endpoint?: string | null;
  fingerprint?: string | null;
  revokedAt?: string | null;
  registeredAt?: string | null;
};

export type Verification = {
  /** Known to the platform: a registry row, a pinned key, not revoked. */
  registered: boolean;
  /** Registered AND every structural check the gateway makes passes. */
  secure: boolean;
  /** The domain the name claims, which the endpoint must sit under. */
  domain: string | null;
  /** Why `secure` is false. Empty when it is true. Shown on demand, never by default. */
  failures: string[];
  /** The checks themselves, so the badge can show its working. */
  checks: { label: string; passed: boolean; detail: string }[];
};

/**
 * SECURE IS NOT A SUPERSET OF NICE-TO-HAVE. Each check below can refuse an
 * envelope at the gateway, so each one is a reason a student should not treat
 * the agent as the party it claims to be. None of them are advisory.
 */
export function verifyAgent(record: AgentRecord | null | undefined): Verification {
  const checks: Verification['checks'] = [];
  const failures: string[] = [];

  if (!record) {
    return {
      registered: false,
      secure: false,
      domain: null,
      failures: ['This agent has no registration on the platform.'],
      checks: [{ label: 'Registered', passed: false, detail: 'No entry in the agent registry.' }],
    };
  }

  const parsed = parseAgentName(record.agentName);
  const hasKey = Boolean(record.fingerprint);
  const revoked = Boolean(record.revokedAt);
  const registered = Boolean(parsed) && hasKey && !revoked;

  checks.push({
    label: 'Registered as an agent',
    passed: Boolean(parsed) && hasKey,
    detail: hasKey
      ? 'A public key is pinned for this name, so a signature can be checked against it.'
      : 'No public key is pinned, so nothing it sends can be checked.',
  });
  if (!parsed) failures.push('The name is not a versioned agent:// name.');
  if (!hasKey) failures.push('No public key is pinned for this agent.');

  checks.push({
    label: 'Registration is current',
    passed: !revoked,
    detail: revoked ? `Revoked ${record.revokedAt}.` : 'Not revoked.',
  });
  if (revoked) failures.push('This registration has been revoked.');

  let url: URL | null = null;
  try {
    url = new URL(record.endpoint ?? '');
  } catch {
    url = null;
  }

  const https = url?.protocol === 'https:';
  checks.push({
    label: 'Encrypted endpoint',
    passed: https,
    detail: url ? `Messages go to ${url.protocol}//${url.host}` : 'Its endpoint is not a valid URL.',
  });
  if (!url) failures.push('Its endpoint is not a valid URL.');
  else if (!https) failures.push('Its endpoint is not HTTPS.');

  const anchored = Boolean(url && parsed && hostUnderDomain(url.hostname, parsed.domain));
  checks.push({
    label: 'Domain matches its name',
    passed: anchored,
    detail:
      url && parsed
        ? anchored
          ? `${url.hostname} sits under ${parsed.domain}, the domain its name claims.`
          : `${url.hostname} is NOT under ${parsed.domain}, the domain its name claims.`
        : 'Cannot be checked without a valid endpoint and name.',
  });
  if (url && parsed && !anchored) {
    failures.push(`Endpoint ${url.hostname} is not under the domain ${parsed.domain} its name claims.`);
  }

  const roleMatches = !parsed || !record.role || parsed.role === record.role;
  checks.push({
    label: 'Role matches its name',
    passed: roleMatches,
    detail: roleMatches
      ? `Registered as ${record.role ?? parsed?.role ?? 'unknown'}.`
      : `Name claims ${parsed?.role} but it is registered as ${record.role}.`,
  });
  if (!roleMatches) failures.push(`Name claims ${parsed?.role} but registration says ${record.role}.`);

  return {
    registered,
    secure: registered && https && anchored && roleMatches,
    domain: parsed?.domain ?? null,
    failures,
    checks,
  };
}
