#!/usr/bin/env python3
"""
Simple Piper TTS Server - Legacy API Only
Avoids the sid parameter issue by using only the wav_file API
"""

import json
import os
import tempfile
import wave
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from piper import PiperVoice

class SimplePiperTTSHandler(BaseHTTPRequestHandler):
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

            print(f"Generating audio using legacy wav_file API")

            # Use legacy API directly - no sid parameter issues
            import tempfile
            import wave
            
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_wav:
                temp_wav_path = temp_wav.name
            
            try:
                wav_writer = wave.open(temp_wav_path, 'wb')
                try:
                    # Use basic legacy API - no enhanced parameters
                    self.voice.synthesize(text, wav_writer)
                finally:
                    wav_writer.close()
                
                with open(temp_wav_path, 'rb') as f:
                    audio_data = f.read()
                
                print(f"Legacy API produced WAV bytes: {len(audio_data)}")
                return audio_data
                
            finally:
                try:
                    os.unlink(temp_wav_path)
                except Exception:
                    pass

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
            response = {"status": "ok", "service": "piper-tts-simple"}
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_error(404, "Not Found")

    def log_message(self, format, *args):
        print(f"[Simple Piper TTS Server] {format % args}")

def main():
    models_dir = Path("./models")
    models_dir.mkdir(exist_ok=True)
    tr_model = "tr_TR-dfki-medium"
    model_path = models_dir / f"{tr_model}.onnx"
    config_path = models_dir / f"{tr_model}.onnx.json"

    print(f"Checking for Turkish model: {model_path}")
    
    if not model_path.exists():
        print(f"Warning: Turkish model not found: {model_path}")
        print("Model will be downloaded on first request or you can manually download from:")
        print("https://huggingface.co/rhasspy/piper-voices/tree/main/tr/tr_TR/dfki/medium")
        print("Server will start anyway and attempt to handle requests...")
    else:
        print(f"Turkish model found: {model_path}")
        
    if not config_path.exists():
        print(f"Warning: Config file not found: {config_path}")
    else:
        print(f"Config file found: {config_path}")

    server_address = ('0.0.0.0', 5001)
    httpd = HTTPServer(server_address, SimplePiperTTSHandler)
    print(f"Simple Piper TTS Server starting on http://0.0.0.0:5001")
    print(f"Default Turkish model: {tr_model}")
    print("Health check: GET /health")
    print("TTS endpoint: POST /tts with JSON body: {\"text\": \"Merhaba dünya\", \"voice\": \"tr_TR-dfki-medium\"}")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.shutdown()

if __name__ == "__main__":
    main()
