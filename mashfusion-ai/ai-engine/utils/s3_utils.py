"""Supabase Storage helpers for the AI engine.

Downloads and uploads audio files via Supabase Storage REST API.
The service-role key is used so the worker can access private buckets.
"""

import os
import requests
from pathlib import Path
from loguru import logger
from config import get_settings

_settings = get_settings()

# Bucket names — must match what the backend creates
_UPLOADS_BUCKET  = "track-uploads"
_OUTPUTS_BUCKET  = "generated-outputs"

# Supabase Storage REST base URL
_STORAGE_URL = f"{_settings.supabase_url}/storage/v1"

_HEADERS = {
    "Authorization": f"Bearer {_settings.supabase_service_role_key}",
    "apikey": _settings.supabase_service_role_key,
}


def download_from_storage(storage_path: str, local_path: str) -> None:
    """Download a file from the track-uploads bucket to `local_path`."""
    url = f"{_STORAGE_URL}/object/{_UPLOADS_BUCKET}/{storage_path}"
    response = requests.get(url, headers=_HEADERS, stream=True, timeout=120)
    response.raise_for_status()

    Path(local_path).parent.mkdir(parents=True, exist_ok=True)
    with open(local_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)

    logger.info(f"Downloaded {storage_path} → {local_path}")


def upload_to_storage(
    local_path: str,
    storage_path: str,
    content_type: str = "audio/wav",
    bucket: str = _OUTPUTS_BUCKET,
) -> str:
    """Upload a local file to Supabase Storage. Returns the storage path."""
    url = f"{_STORAGE_URL}/object/{bucket}/{storage_path}"
    headers = {**_HEADERS, "Content-Type": content_type, "x-upsert": "true"}

    with open(local_path, "rb") as f:
        response = requests.post(url, headers=headers, data=f, timeout=300)
    response.raise_for_status()

    logger.info(f"Uploaded {local_path} → {bucket}/{storage_path}")
    return storage_path


def get_signed_download_url(storage_path: str, expires_in: int = 3600, bucket: str = _OUTPUTS_BUCKET) -> str:
    """Generate a signed download URL for a file in Supabase Storage."""
    url = f"{_STORAGE_URL}/object/sign/{bucket}/{storage_path}"
    response = requests.post(
        url,
        headers={**_HEADERS, "Content-Type": "application/json"},
        json={"expiresIn": expires_in},
        timeout=15,
    )
    response.raise_for_status()
    data = response.json()
    signed_url = data.get("signedURL") or data.get("signedUrl", "")
    if not signed_url:
        raise ValueError(f"Supabase did not return a signed URL: {data}")
    # Supabase returns a relative path — make it absolute
    if signed_url.startswith("/"):
        signed_url = f"{_settings.supabase_url}/storage/v1{signed_url}"
    return signed_url


# ── Legacy aliases — keep tasks.py callers working ───────────────
def download_from_s3(key: str, local_path: str) -> None:
    download_from_storage(key, local_path)


def upload_to_s3(local_path: str, key: str, content_type: str = "audio/wav") -> str:
    return upload_to_storage(local_path, key, content_type)


def delete_from_s3(key: str, bucket: str = _OUTPUTS_BUCKET) -> None:
    """Delete a single file from Supabase Storage."""
    url = f"{_STORAGE_URL}/object/{bucket}/{key}"
    response = requests.delete(url, headers=_HEADERS, timeout=15)
    if response.status_code == 404:
        logger.debug(f"delete_from_s3: key not found (already deleted?): {key}")
        return
    response.raise_for_status()
    logger.info(f"Deleted from storage: {bucket}/{key}")


def list_s3_prefix(prefix: str, bucket: str = _OUTPUTS_BUCKET) -> list[str]:
    """
    List all file keys under a given prefix in Supabase Storage.
    Returns a list of storage paths (not full URLs).
    """
    url = f"{_STORAGE_URL}/object/list/{bucket}"
    payload = {
        "prefix": prefix.rstrip("/"),
        "limit":  1000,
        "offset": 0,
    }
    response = requests.post(
        url,
        headers={**_HEADERS, "Content-Type": "application/json"},
        json=payload,
        timeout=15,
    )
    if response.status_code == 404:
        return []
    response.raise_for_status()
    items = response.json() or []
    return [f"{prefix.rstrip('/')}/{item['name']}" for item in items if item.get("name")]

