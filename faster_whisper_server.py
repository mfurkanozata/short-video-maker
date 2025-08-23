#!/usr/bin/env python3
"""
Faster-Whisper HTTP Server for high-performance transcription
Uses CTranslate2 backend with INT8 quantization for speed and efficiency
"""

import json
import os
import sys
import tempfile
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse
import traceback
from typing import List, Dict, Any

try:
    from faster_whisper import WhisperModel
except ImportError:
    print("Faster-Whisper not found. Please install it first: pip install faster-whisper")
    sys.exit(1)

class FasterWhisperHandler(BaseHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self.model = None
        self.model_name = None
        super().__init__(*args, **kwargs)

    def do_POST(self):
        if self.path == '/transcribe':
            self.handle_transcribe()
        else:
            self.send_error(404, "Not Found")

    def handle_transcribe(self):
        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            print(f"Received transcription request: {len(post_data)} bytes")
            
            try:
                data = json.loads(post_data.decode('utf-8'))
            except json.JSONDecodeError as e:
                print(f"JSON parse error: {e}")
                self.send_error(400, f"Invalid JSON: {str(e)}")
                return

            # Parameters
            audio_path = data.get('audio_path', '')
            model_size = data.get('model', 'large-v3')
            language = data.get('language', 'tr')
            compute_type = data.get('compute_type', 'int8')  # int8, int16, float16, float32
            device = data.get('device', 'cpu')
            num_workers = data.get('num_workers', 1)
            
            print(f"Processing transcription: audio='{audio_path}', model='{model_size}', language='{language}', compute_type='{compute_type}'")

            if not audio_path or not os.path.exists(audio_path):
                self.send_error(400, f"Audio file not found: {audio_path}")
                return

            transcription_result = self.transcribe_audio(
                audio_path, model_size, language, compute_type, device, num_workers
            )

            if transcription_result:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                response_data = json.dumps(transcription_result, ensure_ascii=False, indent=2)
                self.send_header('Content-Length', str(len(response_data.encode('utf-8'))))
                self.end_headers()
                self.wfile.write(response_data.encode('utf-8'))
                print(f"Transcription completed successfully: {len(transcription_result.get('segments', []))} segments")
            else:
                self.send_error(500, "Failed to transcribe audio")

        except Exception as e:
            print(f"Error in handle_transcribe: {e}")
            traceback.print_exc()
            self.send_error(500, f"Internal Server Error: {str(e)}")

    def transcribe_audio(self, audio_path: str, model_size: str, language: str, compute_type: str, device: str, num_workers: int) -> Dict[str, Any]:
        try:
            # Load model if not already loaded or if model changed
            if self.model is None or self.model_name != model_size:
                print(f"Loading Faster-Whisper model: {model_size} with {compute_type} quantization on {device}")
                
                # Initialize model with optimizations
                self.model = WhisperModel(
                    model_size,
                    device=device,
                    compute_type=compute_type,
                    num_workers=num_workers,
                    # Additional optimizations
                    download_root="./models/faster-whisper",
                    local_files_only=False
                )
                self.model_name = model_size
                print(f"Model loaded successfully: {model_size}")

            # Transcribe with word-level timestamps
            print(f"Starting transcription of: {audio_path}")
            segments, info = self.model.transcribe(
                audio_path,
                language=language,
                beam_size=5,  # Good balance between speed and accuracy
                word_timestamps=True,  # Enable word-level timestamps
                vad_filter=True,  # Voice activity detection for better accuracy
                vad_parameters=dict(min_silence_duration_ms=500),  # Minimum silence duration
                initial_prompt=None,  # Could be used for context
                temperature=[0.0, 0.2, 0.4],  # Multiple temperatures for fallback
                compression_ratio_threshold=2.4,
                log_prob_threshold=-1.0,
                no_speech_threshold=0.6,
                condition_on_previous_text=True
            )

            # Convert segments to our format
            transcription_result = {
                "language": info.language,
                "language_probability": info.language_probability,
                "duration": info.duration,
                "segments": []
            }

            for segment in segments:
                segment_data = {
                    "id": segment.id,
                    "seek": segment.seek,
                    "start": segment.start,
                    "end": segment.end,
                    "text": segment.text.strip(),
                    "tokens": [],
                    "temperature": segment.temperature,
                    "avg_logprob": segment.avg_logprob,
                    "compression_ratio": segment.compression_ratio,
                    "no_speech_prob": segment.no_speech_prob,
                    "words": []
                }

                # Add word-level timestamps if available
                if hasattr(segment, 'words') and segment.words:
                    for word in segment.words:
                        word_data = {
                            "start": word.start,
                            "end": word.end,
                            "word": word.word,
                            "probability": getattr(word, 'probability', 1.0)
                        }
                        segment_data["words"].append(word_data)

                transcription_result["segments"].append(segment_data)
                print(f"Processed segment {segment.id}: '{segment.text[:50]}...'")

            print(f"Transcription completed: {len(transcription_result['segments'])} segments, duration: {info.duration:.2f}s")
            return transcription_result

        except Exception as e:
            print(f"Transcription error: {e}")
            traceback.print_exc()
            return None

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = {
                "status": "ok", 
                "service": "faster-whisper",
                "model": self.model_name if self.model_name else "not_loaded"
            }
            self.wfile.write(json.dumps(response).encode())
        elif self.path == '/models':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            available_models = [
                "tiny", "tiny.en", "base", "base.en", "small", "small.en", 
                "medium", "medium.en", "large-v1", "large-v2", "large-v3", "large-v3-turbo"
            ]
            response = {"available_models": available_models}
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_error(404, "Not Found")

    def log_message(self, format, *args):
        print(f"[Faster-Whisper Server] {format % args}")

def main():
    models_dir = Path("./models/faster-whisper")
    models_dir.mkdir(parents=True, exist_ok=True)
    
    print("Faster-Whisper Server starting...")
    print("Features:")
    print("- CTranslate2 backend for optimized inference")
    print("- INT8 quantization for speed and memory efficiency")
    print("- Word-level timestamps")
    print("- Voice Activity Detection (VAD)")
    print("- Multi-temperature fallback for difficult audio")
    print("- Automatic model downloading")
    
    server_address = ('0.0.0.0', 5002)
    httpd = HTTPServer(server_address, FasterWhisperHandler)
    print(f"Faster-Whisper Server running on http://0.0.0.0:5002")
    print("Health check: GET /health")
    print("Available models: GET /models")
    print("Transcribe: POST /transcribe")
    print("Example request body:")
    print(json.dumps({
        "audio_path": "/path/to/audio.wav",
        "model": "large-v3",
        "language": "tr",
        "compute_type": "int8",
        "device": "cpu",
        "num_workers": 1
    }, indent=2))

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down Faster-Whisper server...")
        httpd.shutdown()

if __name__ == "__main__":
    main()
