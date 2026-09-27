#!/usr/bin/env bash
# Deploys the autofill worker to Cloud Run as `ats-worker`, built from the
# Dockerfile in this folder.
#
# IAM-only: --no-allow-unauthenticated, so callers need roles/run.invoker AND
# the shared secret (ats-worker-token, sent as x-ats-token). It runs in
# review-only mode: ATS_ALLOW_SUBMIT is never set here.
#
# Usage: ./deploy.sh          create the secret if missing, then deploy
#        ./deploy.sh --iam    also grant the web app permission to call it
set -euo pipefail
cd "$(dirname "$0")"

PROJECT=project-96b6d773-106a-457a-a46
REGION=us-east4
SERVICE=ats-worker
SECRET=ats-worker-token
# The default compute account: it already reads secrets project-wide and runs
# the web app's backend.
SA=349500970232-compute@developer.gserviceaccount.com
WEB_SA=349500970232-compute@developer.gserviceaccount.com

gcloud secrets describe "$SECRET" --project="$PROJECT" >/dev/null 2>&1 ||
  openssl rand -hex 32 | tr -d '\r\n' |
    gcloud secrets create "$SECRET" --project="$PROJECT" --replication-policy=automatic --data-file=-

gcloud run deploy "$SERVICE" \
  --project="$PROJECT" --region="$REGION" \
  --source=. \
  --service-account="$SA" \
  --no-allow-unauthenticated \
  --memory=2Gi --cpu=1 --timeout=180s \
  --concurrency=2 --max-instances=3 \
  --set-secrets=ATS_WORKER_TOKEN="$SECRET":latest

if [[ "${1:-}" == "--iam" ]]; then
  gcloud run services add-iam-policy-binding "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --member="serviceAccount:$WEB_SA" --role=roles/run.invoker --quiet >/dev/null
  # The web app also calls Gemini on Vertex AI.
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$WEB_SA" --role=roles/aiplatform.user --condition=None --quiet >/dev/null
fi

gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.url)'
