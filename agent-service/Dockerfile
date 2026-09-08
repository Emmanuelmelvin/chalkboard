FROM python:3.12-slim AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1
# ffmpeg is only the *fallback* mp3 decoder now (PyAV handles it in-process),
# but keep it so a stream PyAV chokes on still plays.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
COPY requirements ./requirements
RUN pip install --no-cache-dir -r requirements.txt -r requirements/optional/all.txt
# Bake the piper voice into the image. The whole point of a local TTS backend is
# not to need the network at request time, so this must never be a lazy
# first-utterance download in production.
ARG PIPER_VOICE=en_US-amy-medium
ENV PIPER_VOICE=${PIPER_VOICE} \
    PIPER_VOICE_DIR=/app/voices \
    PIPER_AUTO_DOWNLOAD=false
RUN python -m piper.download_voices "${PIPER_VOICE}" --download-dir /app/voices \
  && ls -la /app/voices
COPY app.py config.py errors.py logger.py system_info.py http_client.py requirements.txt ./
COPY SYSTEM_INFO.md ./SYSTEM_INFO.md
COPY agent ./agent
COPY tools ./tools
COPY voice ./voice
COPY memory ./memory
ENV NODE_ENV=production
EXPOSE 8080
# Production: gunicorn (not Flask's dev server).  Sessions live in process;
# using multiple workers would split the registry and create duplicate agents.
# Dev still uses `python app.py` via `make dev` / `npm run dev:agent`.
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "4", "--timeout", "120", "--access-logfile", "-", "--error-logfile", "-", "app:app"]
