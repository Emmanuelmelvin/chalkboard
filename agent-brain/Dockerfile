FROM python:3.12-slim AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py master.py toolspec.py stt.py ./
COPY ../agent-service/SYSTEM_INFO.md ./SYSTEM_INFO.md
ENV BRAIN_SYSTEM_INFO=/app/SYSTEM_INFO.md
EXPOSE 8081
CMD ["python", "app.py"]
