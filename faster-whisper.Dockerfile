FROM python:3.11-slim

WORKDIR /app

# Install system dependencies with retry logic
RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements-faster-whisper.txt .
RUN pip install --no-cache-dir -r requirements-faster-whisper.txt

# Copy Faster-Whisper server
COPY faster_whisper_server.py .

# Create models directory
RUN mkdir -p models/faster-whisper

# Expose port
EXPOSE 5002

# Start Faster-Whisper server
CMD ["python", "-u", "faster_whisper_server.py"]
