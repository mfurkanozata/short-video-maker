FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements-piper.txt .
RUN pip install --no-cache-dir -r requirements-piper.txt

# Copy Piper TTS server
COPY piper_server.py .

# Create models directory and download Turkish model
RUN mkdir -p models && \
    cd models && \
    curl -L -o tr_TR-dfki-medium.onnx https://huggingface.co/rhasspy/piper-voices/resolve/main/tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx && \
    curl -L -o tr_TR-dfki-medium.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/main/tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx.json

# Expose port
EXPOSE 5001

# Start Piper TTS server
CMD ["python", "-u", "piper_server.py"]
