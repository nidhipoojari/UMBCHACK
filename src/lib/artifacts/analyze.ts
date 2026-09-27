import { evaluateEligibility } from '@/lib/match/eligibility.mjs';
import { classifySkillGaps, matchCourses, requirementsFor, skillMentionedInText } from '@/lib/match/jd-skills.mjs';
import { extractSkills } from '@/lib/match/skill-extract.mjs';

import { tierRead } from './classify-tier.mjs';
import { allBullets, proseOf, type Bullet, type FactSource, type MatchProfile } from './facts';
import { textOverlapRead } from './jd-similarity.mjs';
import type { CachedMatch, JobSnapshot } from './job';

/**
 * The five instant reads of a posting against the applicant's profile. Every one
 * is a rule over text, with no model call, so the same inputs always give the
 * same answer. Each carries a `reason` sentence written next to the number it
 * explains.
 */

export type Tool = { id: string; label: string; reason: string; [key: string]: unknown };

export type RankedBullet = Bullet & { matched_requirements: string[]; score: number; reason: string };

export type Analysis = {
  tools: Tool[];
  model_calls: 0;
  description_available: boolean;
  description_chars: number;
};

const REQUIREMENT_SOURCE_REASON: Record<string, string> = {
  'requirements-section':
    'read from the posting’s own requirements section, so these are the things it actually asks for',
  'normalized-requirements-section':
    'read from the posting’s requirements section after re-flowing a run-together posting into lines',
  'whole-description-vocabulary':
    'this posting has no requirements section we could find, so these are technologies named anywhere in its text — mentioned, not necessarily required',
};

function skillGapTool(job: JobSnapshot, profile: MatchProfile): Tool {
  const requirements = requirementsFor(job.description_text);
  const gaps = classifySkillGaps(requirements.skills, profile.claimedSkills, profile.proseText);
  const courses = matchCourses(requirements.skills, profile.courses);
  const covered = gaps.existing.length + gaps.supportedByResume.length;
  const total = requirements.skills.length;

  const reason =
    total === 0
      ? 'No technology from our vocabulary appears in this posting at all. That is usually a ' +
        'non-technical posting or one whose description never loaded — it is not evidence that you ' +
        `match it. (${job.description_chars} characters of description text were scanned.)`
      : `${covered} of ${total} requirements are covered by your profile, ${gaps.gap.length} are not. ` +
        `The requirement list was ${REQUIREMENT_SOURCE_REASON[requirements.source] ?? requirements.source}.` +
        (courses.length ? ` ${courses.length} of your courses cover a requirement your work history does not.` : '');

  return {
    id: 'skill_gap',
    label: 'Skill gap for this job',
    requirement_count: total,
    requirement_source: requirements.source,
    saw_requirements_section: requirements.sawRequirementSection,
    // Listed versus proven by a bullet: two strengths of evidence, kept apart.
    claimed: gaps.existing,
    proven_by_your_bullets: gaps.supportedByResume,
    missing: gaps.gap,
    courses_covering_a_gap: courses,
    reason,
  };
}

/** Ranks the applicant's own bullets by how many requirements each names. Never writes one. */
function resumeOptimizerTool(job: JobSnapshot, facts: FactSource): Tool {
  const requirements = requirementsFor(job.description_text);
  const bullets = allBullets(facts.structured);

  const ranked: RankedBullet[] = bullets
    .map((bullet) => {
      const canon = extractSkills(bullet.text);
      const hits = requirements.skills.filter(
        (skill: string) => canon.has(skill) || skillMentionedInText(skill, bullet.text),
      );
      return {
        ...bullet,
        matched_requirements: hits,
        score: hits.length,
        reason: hits.length
          ? `Names ${hits.length} requirement${hits.length === 1 ? '' : 's'} this posting asks for: ${hits.join(', ')}.`
          : 'Names no requirement from this posting. Keep it — it is your history — but it should not lead.',
      };
    })
    // Stable within a score, so the applicant's own order survives.
    .sort((a, b) => b.score - a.score);

  const bulletText = bullets.map((b) => b.text).join('\n');
  const inBullets = extractSkills(bulletText);
  const unmentioned = requirements.skills.filter(
    (skill: string) => !inBullets.has(skill) && !skillMentionedInText(skill, bulletText),
  );

  const leading = ranked.filter((b) => b.score > 0);
  const reason =
    bullets.length === 0
      ? 'Your profile has no experience bullets yet, so there is nothing to reorder. Upload your resume first.'
      : `${leading.length} of your ${bullets.length} existing bullets name at least one requirement from this posting; ` +
        `lead with the ${Math.min(3, leading.length)} at the top. ` +
        `${unmentioned.length} requirement${unmentioned.length === 1 ? '' : 's'} appear in none of your bullets ` +
        '— that is a keyword gap, not a reason to write a bullet you did not earn.';

  return {
    id: 'resume_optimizer',
    label: 'Resume optimizer',
    bullets: ranked,
    bullets_that_lead: leading.length,
    bullets_total: bullets.length,
    requirements_no_bullet_mentions: unmentioned,
    reason,
    honesty_note:
      'This tool reorders your existing bullets and flags missing keywords. It never writes a ' +
      'bullet for you. If a requirement is missing from your resume because you have not done it, ' +
      'the right fix is a different job or a new project, not a new sentence.',
  };
}

function tierTool(job: JobSnapshot): Tool {
  const read = tierRead(job.job_title ?? '', job.description_text);
  return {
    id: 'role_tier',
    label: 'Role tier / seniority read',
    tier: read.tier,
    tier_label: read.label,
    years_required: read.years_required,
    title_contradicts_body: read.mismatch,
    reason: read.reason,
  };
}

/** Word overlap, shown beside the match score on purpose: they measure different things. */
function similarityTool(job: JobSnapshot, facts: FactSource, cachedMatch: CachedMatch | null): Tool {
  const read = textOverlapRead(job.description_text, proseOf(facts.structured));
  return {
    id: 'text_similarity',
    label: 'Fit similarity (text overlap)',
    percent: read.percent,
    decision: read.decision,
    stored_match_score: cachedMatch?.score ?? null,
    reason:
      read.reason +
      (cachedMatch
        ? ` For contrast, your match score for this job is ${cachedMatch.score} out of 100. That one` +
          ' comes from a model reading your resume against the posting; this one is word counting.'
        : ' There is no match score for this job to compare against.'),
  };
}

function eligibilityTool(job: JobSnapshot, profile: MatchProfile): Tool {
  const verdict = evaluateEligibility({ jdText: job.description_text }, profile.goals ?? {});
  return {
    id: 'eligibility',
    label: 'Eligibility read',
    eligibility: verdict.eligibility,
    reason:
      verdict.reason +
      (profile.goals
        ? ''
        : ' Your profile does not record work authorization or clearance yet, so those could not be' +
          ' checked against anything — this is an unchecked result, not a clear one.'),
  };
}

/** All five reads in one pass; they share the requirement extraction. */
export function analyze({
  job,
  profile,
  facts,
  cachedMatch,
}: {
  job: JobSnapshot;
  profile: MatchProfile;
  facts: FactSource;
  cachedMatch: CachedMatch | null;
}): Analysis {
  return {
    tools: [
      skillGapTool(job, profile),
      resumeOptimizerTool(job, facts),
      tierTool(job),
      similarityTool(job, facts, cachedMatch),
      eligibilityTool(job, profile),
    ],
    model_calls: 0,
    description_available: job.has_description,
    description_chars: job.description_chars,
  };
}
