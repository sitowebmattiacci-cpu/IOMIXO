#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  MASHFUSION AI — RunPod GPU Worker Bootstrap Script
#
#  This script provisions a RunPod serverless pod as a GPU Celery
#  worker consuming the gpu_heavy queue (stem separation only).
#
#  Usage:
#    1. Create RunPod serverless endpoint using Dockerfile.gpu
#    2. Set the environment variables listed below as Pod Secrets
#    3. Use this script as the pod startup command, OR bake it
#       into the container CMD in Dockerfile.gpu
#
#  RunPod setup:
#    - Template: Custom (use mashfusion/ai-engine-gpu image)
#    - GPU: RTX A4000 (16 GB VRAM) — sufficient for htdemucs_6s
#    - Min workers: 0 (scale to zero when queue empty)
#    - Max workers: 3 (3 simultaneous stem separations)
#    - Idle timeout: 60 seconds before scale-down
#
#  Required environment variables (set as RunPod secrets):
#    REDIS_URL              redis://:<password>@<host>:<port>/0
#    CELERY_BROKER_URL      redis://:<password>@<host>:<port>/0
#    CELERY_RESULT_URL      redis://:<password>@<host>:<port>/1
#    BACKEND_URL            https://api.mashfusion.ai
#    INTERNAL_API_KEY       <shared secret with backend>
#    AWS_ACCESS_KEY_ID      <s3 key>
#    AWS_SECRET_ACCESS_KEY  <s3 secret>
#    AWS_S3_BUCKET          mashfusion-audio
#    AWS_S3_REGION          us-east-1
#    SUPABASE_URL           <supabase project url>
#    SUPABASE_SERVICE_ROLE_KEY <service role key>
#    DEMUCS_MODEL           htdemucs_6s
# ════════════════════════════════════════════════════════════════

set -euo pipefail

WORKER_TYPE="gpu"
QUEUE="gpu_heavy"
CONCURRENCY=1             # 1 job per GPU — Demucs uses full GPU
MAX_TASKS_PER_CHILD=10    # restart after 10 jobs to free VRAM

echo "════════════════════════════════════════"
echo " MASHFUSION GPU Worker Bootstrap"
echo " Queue:       ${QUEUE}"
echo " Concurrency: ${CONCURRENCY}"
echo " GPU:         $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || echo 'not detected')"
echo "════════════════════════════════════════"

# ── Validate required env vars ────────────────────────────────
REQUIRED_VARS=(
  REDIS_URL
  CELERY_BROKER_URL
  BACKEND_URL
  INTERNAL_API_KEY
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_S3_BUCKET
)

for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: Required environment variable '$var' is not set."
    exit 1
  fi
done

# ── Create temp directory ─────────────────────────────────────
TMP_DIR="${TMP_DIR:-/tmp/mashfusion}"
mkdir -p "${TMP_DIR}"
echo "Temp directory: ${TMP_DIR}"

# ── Pre-warm Demucs model if not cached ───────────────────────
MODEL="${DEMUCS_MODEL:-htdemucs_6s}"
echo "Pre-warming Demucs model: ${MODEL}..."
python3 -c "
import os, sys
os.environ['TORCH_HOME'] = '/models'
try:
    import demucs.pretrained
    demucs.pretrained.get_model('${MODEL}')
    print('[bootstrap] Demucs model ready.')
except Exception as e:
    print(f'[bootstrap] WARNING: Model pre-warm failed: {e}')
" || true

# ── Check GPU availability ────────────────────────────────────
python3 -c "
import torch
if torch.cuda.is_available():
    gpu = torch.cuda.get_device_name(0)
    vram = torch.cuda.get_device_properties(0).total_memory / 1e9
    print(f'[bootstrap] CUDA ready: {gpu} ({vram:.1f} GB VRAM)')
else:
    print('[bootstrap] WARNING: CUDA not available — running on CPU')
"

# ── Register worker with backend ──────────────────────────────
WORKER_ID="gpu-worker@$(hostname)"
python3 -c "
import httpx, os, sys
try:
    r = httpx.post(
        os.environ['BACKEND_URL'] + '/internal/worker-heartbeat',
        json={
            'worker_id':   '${WORKER_ID}',
            'worker_type': 'gpu',
            'queues':      ['gpu_heavy'],
            'status':      'online',
        },
        headers={'X-Internal-API-Key': os.environ['INTERNAL_API_KEY']},
        timeout=10,
    )
    print(f'[bootstrap] Worker registered: HTTP {r.status_code}')
except Exception as e:
    print(f'[bootstrap] WARNING: Could not register worker: {e}')
" || true

# ── Start Celery GPU worker ───────────────────────────────────
echo "Starting Celery worker on queue: ${QUEUE}..."
exec celery \
  -A workers.celery_worker worker \
  --loglevel=info \
  --concurrency="${CONCURRENCY}" \
  --prefetch-multiplier=1 \
  -Q "${QUEUE}" \
  -n "${WORKER_ID}" \
  --max-tasks-per-child="${MAX_TASKS_PER_CHILD}" \
  --without-gossip \
  --without-mingle
