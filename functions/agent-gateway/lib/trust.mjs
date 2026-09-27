/**
 * trust.mjs — whether a verified agent is one we will actually deal with.
 *
 * Identity and trust are separate gates on purpose. Proving cryptographically
 * that you are `agent://v1.employer.example.com` says nothing about whether you
 * should receive a student's contact details; a confirmed identity is exactly
 * what a bad actor registers. So verification answers "who", and this answers
 * "should we".
 *
 * Every dimension must carry a score AND a reason. A bare number is refused:
 * an unexplained score is not evidence, and the whole product claim is that a
 * refusal can be justified out loud.
 */
export const TRUST_DIMENSIONS = ['integrity', 'identity', 'solvency', 'behavior', 'safety'];

export const DEFAULT_POLICY = Object.freeze({
  minimumDimensionScore: 65,
  minimumAverageScore: 75,
});

export function evaluateTrust(trust, policy = DEFAULT_POLICY) {
  const reasons = [];
  const scores = [];

  for (const name of TRUST_DIMENSIONS) {
    const d = trust?.[name];
    const score = Number(d?.score);
    const why = typeof d?.reason === 'string' && d.reason.trim().length > 0;
    if (!Number.isFinite(score) || !why) {
      reasons.push(`Trust dimension "${name}" is missing a score or its justification.`);
      continue;
    }
    if (score < policy.minimumDimensionScore) {
      reasons.push(`Trust dimension "${name}" scored ${score}, below the minimum of ${policy.minimumDimensionScore}. ${d.reason}`);
    }
    scores.push(score);
  }

  if (scores.length === TRUST_DIMENSIONS.length) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg < policy.minimumAverageScore) {
      reasons.push(`Aggregate trust ${avg.toFixed(1)} is below the minimum of ${policy.minimumAverageScore}.`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}
