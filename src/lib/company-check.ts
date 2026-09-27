import 'server-only';

/**
 * Is the company behind a posting a real, operating employer? Answered from
 * evidence we can check ourselves:
 *
 *   ats     the posting came from the company's own applicant tracking system
 *           through that system's API. A Greenhouse, Ashby or Lever board is a
 *           paid account tied to a real company, so this decides the tier.
 *   domain  corroboration, only when the posting links to the company's own
 *           site: it must complete an HTTPS handshake with a publicly issued
 *           certificate. A posting that links to a board gets no guessed domain,
 *           because a wrong guess would count against a real company.
 *
 * This says "a real company that runs a real hiring pipeline", nothing more.
 */

const ATS_API_SOURCES = new Map<string, string>([
  ['greenhouse-api', 'Greenhouse'],
  ['ashby-api', 'Ashby'],
  ['lever-api', 'Lever'],
]);

export type CompanySignal = {
  name: 'ats' | 'domain';
  passed: boolean;
  reason: string;
};

export type CompanyTier = 'known_employer' | 'unverified';

export type CompanyAssessment = {
  domain: string;
  tier: CompanyTier;
  signals: CompanySignal[];
  summary: string;
};

async function checkDomain(domain: string | null): Promise<CompanySignal> {
  if (!domain) {
    return {
      name: 'domain',
      passed: false,
      reason: 'The posting links to an applicant tracking system rather than the company’s own site, so there was no domain to check.',
    };
  }
  try {
    // Node rejects a bad or mismatched certificate, so any response passes.
    const response = await fetch(`https://${domain}`, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    return {
      name: 'domain',
      passed: true,
      reason: `${domain} serves HTTPS with a certificate a public authority issued for it (HTTP ${response.status}).`,
    };
  } catch {
    return {
      name: 'domain',
      passed: false,
      reason: `${domain} did not complete an HTTPS handshake, so we could not confirm the company operates it.`,
    };
  }
}

function checkAts(source: string | null): CompanySignal {
  const ats = source ? ATS_API_SOURCES.get(source) : undefined;
  if (ats) {
    return {
      name: 'ats',
      passed: true,
      reason: `The posting came from the company’s own ${ats} account through the ${ats} API, not from a scraped page.`,
    };
  }
  return {
    name: 'ats',
    passed: false,
    reason: source
      ? `The posting came from ${source}, which does not by itself tie it to a company-run hiring system.`
      : 'The posting has no recorded source, so it is not tied to a company-run hiring system.',
  };
}

export async function assessCompany(input: {
  /** Only when the posting itself names it. */
  postedDomain: string | null;
  source: string | null;
  companyName: string;
}): Promise<CompanyAssessment> {
  const ats = checkAts(input.source);
  const domain = await checkDomain(input.postedDomain);
  const tier: CompanyTier = ats.passed ? 'known_employer' : 'unverified';

  const atsName = ATS_API_SOURCES.get(input.source ?? '') ?? 'an applicant tracking system';
  const summary =
    tier === 'known_employer'
      ? `${input.companyName} is a real employer: this posting came from its own ${atsName} account${domain.passed ? ` and it operates ${input.postedDomain}` : ''}.`
      : `${input.companyName} could not be confirmed as an operating employer.`;

  return { domain: input.postedDomain ?? '', tier, signals: [ats, domain], summary };
}
