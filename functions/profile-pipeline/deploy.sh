#!/usr/bin/env bash
# Deploys the profile pipeline: five Cloud Functions (2nd gen) from this one
# package, wired by events.
#
#   extract-resume    Eventarc: GCS object finalized in the uploads bucket
#   enrich-github     Eventarc: Pub/Sub topic resume-parsed
#   enrich-linkedin   Eventarc: Pub/Sub topic resume-parsed
#   enrich-portfolio  Eventarc: Pub/Sub topic resume-parsed
#   match-jobs        Eventarc: Pub/Sub topic resume-parsed; calls job-matcher
#                     (Cloud Run, us-east1, IAM-only) and publishes jobs.matched
#
# The enrichers publish profile.enriched to the profile-enriched topic, for
# anything downstream (matching, notifications) to subscribe to.
#
# Usage: ./deploy.sh            deploy all five
#        ./deploy.sh extract-resume enrich-github   deploy some
set -euo pipefail
cd "$(dirname "$0")"

PROJECT=project-96b6d773-106a-457a-a46
REGION=us-east4
BUCKET=agenthire-uploads-349500970232
SA=resume-extractor@${PROJECT}.iam.gserviceaccount.com
MATCHER_URL=https://job-matcher-nsw4gvibpq-ue.a.run.app
ENV="PROJECT_ID=$PROJECT,INSTANCE_CONNECTION_NAME=$PROJECT:$REGION:agenthire-db,DB_USER=agenthire_app,DB_NAME=agenthire,GEMINI_MODEL=gemini-flash-latest,GEMINI_LOCATION=global,MATCHER_URL=$MATCHER_URL"

deploy() { # name entry-point trigger-flags...
  local name=$1 entry=$2
  shift 2
  gcloud functions deploy "$name" \
    --gen2 --project="$PROJECT" --region="$REGION" --runtime=nodejs22 \
    --source=. --entry-point="$entry" \
    --service-account="$SA" --trigger-service-account="$SA" \
    --memory=512Mi --timeout=300s --max-instances=5 \
    --set-env-vars="$ENV" \
    --set-secrets=DB_PASSWORD=agenthire-db-password:latest \
    "$@"
}

TARGETS=("$@")
# True when no targets were named (deploy everything) or when $1 was named.
want() { [ ${#TARGETS[@]} -eq 0 ] || [[ " ${TARGETS[*]} " == *" $1 "* ]]; }

if want extract-resume; then
  deploy extract-resume extractResume \
    --trigger-event-filters=type=google.cloud.storage.object.v1.finalized \
    --trigger-event-filters=bucket="$BUCKET" \
    --trigger-location="$REGION"
fi
if want enrich-github; then deploy enrich-github enrichGithub --trigger-topic=resume-parsed; fi
if want enrich-linkedin; then deploy enrich-linkedin enrichLinkedin --trigger-topic=resume-parsed; fi
if want enrich-portfolio; then deploy enrich-portfolio enrichPortfolio --trigger-topic=resume-parsed; fi
if want match-jobs; then
  # The function calls job-matcher with its own identity, and announces results.
  gcloud run services add-iam-policy-binding job-matcher --project="$PROJECT" --region=us-east1     --member="serviceAccount:$SA" --role=roles/run.invoker --quiet >/dev/null
  gcloud pubsub topics describe jobs-matched --project="$PROJECT" >/dev/null 2>&1 ||
    gcloud pubsub topics create jobs-matched --project="$PROJECT"
  deploy match-jobs matchJobs --trigger-topic=resume-parsed
fi
