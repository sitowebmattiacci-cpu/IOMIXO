FROM python:3.11-slim

# System deps — ffmpeg, libsndfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    libsndfile1-dev \
    build-essential \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download Demucs models into /models (baked into image)
RUN python -c "import demucs.pretrained; demucs.pretrained.get_model('htdemucs_6s')" || true

ENV MODELS_DIR=/models
ENV TMP_DIR=/tmp/mashfusion
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

COPY . .

# Default: run FastAPI app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
