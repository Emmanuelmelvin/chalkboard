FROM python:3.12-slim AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1
# ffmpeg for Edge-TTS mp3 -> PCM decode (voice speak path)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py config.py errors.py logger.py system_info.py http_client.py requirements.txt ./
COPY SYSTEM_INFO.md ./SYSTEM_INFO.md
COPY agent ./agent
COPY tools ./tools
COPY voice ./voice
COPY memory ./memory
ENV NODE_ENV=production
EXPOSE 8080
CMD ["python", "app.py"]
