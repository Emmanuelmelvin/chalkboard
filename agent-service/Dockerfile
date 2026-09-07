FROM python:3.12-slim AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1
# ffmpeg for Edge-TTS mp3 -> PCM decode (voice speak path)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
COPY requirements ./requirements
RUN pip install --no-cache-dir -r requirements.txt
# Uncomment to bake heavy optional deps into the image:
# RUN pip install --no-cache-dir -r requirements/optional/all.txt
COPY app.py config.py errors.py logger.py system_info.py http_client.py requirements.txt ./
COPY SYSTEM_INFO.md ./SYSTEM_INFO.md
COPY agent ./agent
COPY tools ./tools
COPY voice ./voice
COPY memory ./memory
ENV NODE_ENV=production
EXPOSE 8080
# Production: gunicorn (not Flask's dev server) with sync workers.
# Dev still uses `python app.py` via `make dev` / `npm run dev:agent`.
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--threads", "4", "--timeout", "120", "--access-logfile", "-", "--error-logfile", "-", "app:app"]
