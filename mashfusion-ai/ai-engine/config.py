from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # ── Backend callback ─────────────────────────────────────────
    backend_url:         str = "http://backend:4000"
    internal_api_key:    str = ""

    # ── Redis / Celery ───────────────────────────────────────────
    redis_url:             str = "redis://redis:6379/0"
    celery_broker_url:     str = "redis://redis:6379/0"
    celery_result_backend: str = "redis://redis:6379/1"

    # ── AWS S3 ───────────────────────────────────────────────────
    aws_access_key_id:     str = ""
    aws_secret_access_key: str = ""
    aws_s3_bucket:         str = ""
    aws_s3_region:         str = "us-east-1"

    # ── Supabase Storage ─────────────────────────────────────────
    supabase_url:              str = ""
    supabase_service_role_key: str = ""

    # ── Processing ───────────────────────────────────────────────
    models_dir:          str = "/models"
    tmp_dir:             str = "/tmp/mashfusion"
    demucs_model:        str = "htdemucs_6s"   # 6-stem: drums, bass, other, vocals, guitar, piano
    max_audio_duration:  int = 600             # 10 minutes

    # ── Worker identity ──────────────────────────────────────────
    worker_type:        str = "cpu"            # gpu | cpu | cleanup | beat
    worker_concurrency: int = 4

    # ── Cost optimization ─────────────────────────────────────────
    # Maximum concurrent jobs for free-plan users across all workers.
    # When this many free jobs are active, new free jobs are deferred.
    free_concurrency_cap: int = 2

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()
