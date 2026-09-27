/**
 * The profile pipeline: one package, deployed as four Cloud Functions (2nd gen),
 * wired together by events.
 *
 *   resume upload (GCS object finalized)
 *     └─ extract-resume ── publishes resume.parsed ──┬─ enrich-github    ─┐
 *                                                     ├─ enrich-linkedin  ─┼─ each publishes profile.enriched
 *                                                     └─ enrich-portfolio ─┘
 *
 * Every step writes to intake_events, which the onboarding loading page polls.
 * See deploy.sh for triggers and settings.
 */
import * as functions from '@google-cloud/functions-framework';

import { enrichGithub, enrichLinkedin, enrichPortfolio } from './enrich.js';
import { extractResume } from './extract.js';

functions.cloudEvent('extractResume', extractResume);
functions.cloudEvent('enrichGithub', enrichGithub);
functions.cloudEvent('enrichLinkedin', enrichLinkedin);
functions.cloudEvent('enrichPortfolio', enrichPortfolio);
