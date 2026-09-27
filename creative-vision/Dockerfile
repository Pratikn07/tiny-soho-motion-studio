FROM python:3.11-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/vision ./services/vision
COPY creative-vision ./creative-vision
RUN pip install --no-cache-dir -r creative-vision/requirements.txt

ENV PYTHONPATH=/app:/app/creative-vision
CMD ["python", "-m", "src.main"]
