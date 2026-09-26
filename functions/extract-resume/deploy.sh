#!/usr/bin/env bash
# Deploys the extract-resume Cloud Function (2nd gen).
#
# Trigger: Eventarc, on every object finalized in the uploads bucket. The
# function ignores anything outside applicants/<uid>/resumes/<uuid>.pdf.
# Runs as the resume-extractor service account (Cloud SQL client, Vertex AI
# user, read access to the bucket, and the DB password secret).
set -euo pipefail
cd "$(dirname "$0")"

PROJECT=project-96b6d773-106a-457a-a46
REGION=us-east4
BUCKET=agenthire-uploads-349500970232
SA=resume-extractor@${PROJECT}.iam.gserviceaccount.com

gcloud functions deploy extract-resume \
  --gen2 \
  --project="$PROJECT" \
  --region="$REGION" \
  --runtime=nodejs22 \
  --source=. \
  --entry-point=extractResume \
  --trigger-event-filters=type=google.cloud.storage.object.v1.finalized \
  --trigger-event-filters=bucket="$BUCKET" \
  --trigger-location="$REGION" \
  --service-account="$SA" \
  --trigger-service-account="$SA" \
  --memory=512Mi \
  --timeout=300s \
  --max-instances=5 \
  --set-env-vars=PROJECT_ID=$PROJECT,INSTANCE_CONNECTION_NAME=$PROJECT:$REGION:agenthire-db,DB_USER=agenthire_app,DB_NAME=agenthire,GEMINI_MODEL=gemini-flash-latest,GEMINI_LOCATION=global \
  --set-secrets=DB_PASSWORD=agenthire-db-password:latest
