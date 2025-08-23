#!/usr/bin/env python3
"""
Piper TTS HTTP Server for Turkish Text-to-Speech
"""

import json
import os
import sys
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse
import base64
import struct

# No need to modify Python path in Docker container
# Piper TTS is already installed via requirements-piper.txt

try:
    from piper import PiperVoice
except ImportError:
    print("Piper TTS not found. Please install it first.")
    sys.exit(1)

class PiperTTSHandler(BaseHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self.voice = None
        super().__init__(*args, **kwargs)

    def do_POST(self):
        if self.path == '/tts':
            self.handle_tts()
        else:
            self.send_error(404, "Not Found")

    def handle_tts(self):
        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            print(f"Received data: {post_data}")
            
            try:
                data = json.loads(post_data.decode('utf-8'))
            except json.JSONDecodeError as e:
                print(f"JSON parse error: {e}")
                print(f"Raw data: {post_data}")
                self.send_error(400, f"Invalid JSON: {str(e)}")
                return

            text = data.get('text', '')
            voice_model = data.get('voice', 'tr_TR-dfki-medium')

            print(f"Processing TTS request: text='{text}', voice='{voice_model}'")

            if not text:
                self.send_error(400, "Text is required")
                return

            audio_data = self.generate_audio(text, voice_model)

            if audio_data:
                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Content-Length', str(len(audio_data)))
                self.end_headers()
                self.wfile.write(audio_data)
                print(f"Audio generated successfully: {len(audio_data)} bytes")
            else:
                self.send_error(500, "Failed to generate audio")

        except Exception as e:
            print(f"Error in handle_tts: {e}")
            import traceback
            traceback.print_exc()
            self.send_error(500, f"Internal Server Error: {str(e)}")

    def generate_audio(self, text, voice_model):
        try:
            if self.voice is None:
                model_path = f"./models/{voice_model}.onnx"
                config_path = f"./models/{voice_model}.onnx.json"

                if not os.path.exists(model_path):
                    print(f"Model not found: {model_path}")
                    return None

                self.voice = PiperVoice.load(model_path, config_path)
                print(f"Voice model loaded: {voice_model}")

            # For this Piper TTS version, we need to use synthesize_wav
            # or create a temporary file
            import tempfile
            import os
            
            # Create temporary WAV file
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_wav:
                temp_wav_path = temp_wav.name
            
            try:
                # Use synthesize_wav which writes directly to file
                self.voice.synthesize_wav(text, temp_wav_path)
                print(f"Audio written to temporary file: {temp_wav_path}")
                
                # Read the generated WAV file
                with open(temp_wav_path, 'rb') as f:
                    audio_data = f.read()
                
                print(f"WAV file read: {len(audio_data)} bytes")
                return audio_data
                
            finally:
                # Clean up temporary file
                if os.path.exists(temp_wav_path):
                    os.unlink(temp_wav_path)
                    print(f"Temporary file cleaned up: {temp_wav_path}")

        except Exception as e:
            print(f"Audio generation error: {e}")
            import traceback
            traceback.print_exc()
            return None

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = {"status": "ok", "service": "piper-tts"}
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_error(404, "Not Found")

    def log_message(self, format, *args):
        print(f"[Piper TTS Server] {format % args}")

def main():
    models_dir = Path("./models")
    models_dir.mkdir(exist_ok=True)
    tr_model = "tr_TR-dfki-medium"
    model_path = models_dir / f"{tr_model}.onnx"

    if not model_path.exists():
        print(f"Turkish model not found: {model_path}")
        print("Please download the model manually from:")
        print("https://huggingface.co/rhasspy/piper-voices/tree/main/tr/tr_TR/dfki/medium")
        print("and place it in the ./models directory")
        return

    server_address = ('0.0.0.0', 5001)
    httpd = HTTPServer(server_address, PiperTTSHandler)
    print(f"Piper TTS Server starting on http://localhost:5001")
    print(f"Turkish model: {tr_model}")
    print("Use POST /tts with JSON body: {\"text\": \"Merhaba dünya\", \"voice\": \"tr_TR-dfki-medium\"}")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.shutdown()

if __name__ == "__main__":
    main()
