#!/bin/bash
# Auto-deploy script: waits for Cloud Build to finish, then deploys real engine
# to Cloud Run GPU and rewires the backend.
#
# Run with: bash deploy-realgpu.sh
# Logs to: /tmp/iomixo-realgpu-deploy.log
set -euo pipefail

LOG=/tmp/iomixo-realgpu-deploy.log
exec > >(tee -a "$LOG") 2>&1

echo "=== $(date) — start auto-deploy ==="

PROJECT=iomixo-494817
IMAGE="europe-west1-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy/iomixo-ai-engine-real:v1"
SERVICE_NAME=iomixo-ai-engine-real
REGION=europe-west4
BACKEND_REGION=europe-west1
BACKEND_SERVICE=iomixo-backend

SUPABASE_URL="https://bpvvsuxehdmjpbachsaq.supabase.co"
SUPABASE_KEY="${SUPABASE_KEY}"
INTERNAL_KEY="iomixo-internal-key-2024"
BACKEND_URL="https://iomixo-backend-779794359511.europe-west1.run.app"

echo "Polling for latest build to complete…"
while true; do
  STATUS=$(gcloud builds list --limit=1 --format="value(status)" 2>/dev/null || echo "ERR")
  echo "  build status: $STATUS"
  case "$STATUS" in
    SUCCESS) echo "Build completed."; break ;;
    FAILURE|CANCELLED|TIMEOUT|EXPIRED|INTERNAL_ERROR) echo "Build failed: $STATUS — aborting."; exit 1 ;;
    *) sleep 30 ;;
  esac
done

echo ""
echo "Deploying ${SERVICE_NAME} to ${REGION} with L4 GPU…"
gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE" \
  --region="$REGION" \
  --gpu=1 \
  --gpu-type=nvidia-l4 \
  --no-gpu-zonal-redundancy \
  --no-cpu-throttling \
  --cpu=8 \
  --memory=16Gi \
  --min-instances=0 \
  --max-instances=2 \
  --timeout=3600 \
  --concurrency=1 \
  --no-allow-unauthenticated \
  --set-env-vars="BACKEND_URL=${BACKEND_URL},INTERNAL_API_KEY=${INTERNAL_KEY},SUPABASE_URL=${SUPABASE_URL},SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_KEY}" \
  --quiet

NEW_URL=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format="value(status.url)")
echo ""
echo "Deployed at: $NEW_URL"

echo ""
echo "Updating backend AI_ENGINE_URL → $NEW_URL"
gcloud run services update "$BACKEND_SERVICE" \
  --region="$BACKEND_REGION" \
  --update-env-vars="AI_ENGINE_URL=${NEW_URL}" \
  --quiet

echo ""
echo "Granting backend service account invoker role on real engine…"
BACKEND_SA=$(gcloud run services describe "$BACKEND_SERVICE" --region="$BACKEND_REGION" --format="value(spec.template.spec.serviceAccountName)")
if [ -z "$BACKEND_SA" ]; then
  BACKEND_SA="$(gcloud projects describe ${PROJECT} --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
fi
echo "  backend SA: $BACKEND_SA"
gcloud run services add-iam-policy-binding "$SERVICE_NAME" \
  --region="$REGION" \
  --member="serviceAccount:${BACKEND_SA}" \
  --role="roles/run.invoker" \
  --quiet || echo "  (binding may already exist)"

echo ""
echo "=== $(date) — auto-deploy COMPLETE ==="
echo ""
echo "New AI engine: $NEW_URL"
echo "Backend rewired."
echo "Test /health:"
gcloud run services proxy "$SERVICE_NAME" --region="$REGION" --port=9999 &
PROXY_PID=$!
sleep 5
curl -s http://localhost:9999/health || true
kill $PROXY_PID 2>/dev/null || true
echo ""
echo "Done. Check log at: $LOG"
