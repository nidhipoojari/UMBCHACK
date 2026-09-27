#!/usr/bin/env bash
# Deploys the live interviewer relay to Cloud Run as `interview-live`, built
# from the Dockerfile in this folder.
#
# Public ingress, because browsers connect to it directly over a WebSocket.
# Every call still needs a ticket the web app signed for one interview session
# with interview-live-secret, and connections from other sites' pages are
# refused by origin. It calls Gemini Live on Vertex AI as the service account.
#
# Usage: ./deploy.sh          create the secret if missing, then deploy
#        ./deploy.sh --web    also give the web app the secret it signs with
set -euo pipefail
cd "$(dirname "$0")"

PROJECT=project-96b6d773-106a-457a-a46
REGION=us-east4
SERVICE=interview-live
SECRET=interview-live-secret
# The default compute account: it reads secrets project-wide and can call Vertex AI.
SA=349500970232-compute@developer.gserviceaccount.com
WEB_SERVICE=ssrproject96b6d773106a4
WEB_REGION=us-east1

gcloud secrets describe "$SECRET" --project="$PROJECT" >/dev/null 2>&1 ||
  openssl rand -hex 32 | tr -d '\r\n' |
    gcloud secrets create "$SECRET" --project="$PROJECT" --replication-policy=automatic --data-file=-

# A call lasts up to 15 minutes, so the request timeout is an hour and each
# instance holds many calls: the relay only moves audio.
gcloud run deploy "$SERVICE" \
  --project="$PROJECT" --region="$REGION" \
  --source=. \
  --service-account="$SA" \
  --allow-unauthenticated \
  --memory=512Mi --cpu=1 --timeout=3600s \
  --concurrency=40 --max-instances=3 --session-affinity \
  --set-secrets=INTERVIEW_LIVE_SECRET="$SECRET":latest

if [[ "${1:-}" == "--web" ]]; then
  gcloud run services update "$WEB_SERVICE" --project="$PROJECT" --region="$WEB_REGION" \
    --update-secrets=INTERVIEW_LIVE_SECRET="$SECRET":latest --quiet >/dev/null
fi

gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.url)'
