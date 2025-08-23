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
            speaker_id = data.get('speaker_id', 0)
            length_scale = data.get('length_scale', 1.0)  # Speech speed control
            noise_scale = data.get('noise_scale', 0.667)  # Add naturalness
            noise_w = data.get('noise_w', 0.8)  # Prosody variation

            print(f"Processing enhanced TTS request: text='{text}', voice='{voice_model}', length_scale={length_scale}, noise_scale={noise_scale}, noise_w={noise_w}")

            if not text:
                self.send_error(400, "Text is required")
                return

            audio_data = self.generate_audio(text, voice_model, speaker_id, length_scale, noise_scale, noise_w)

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

    def generate_audio(self, text, voice_model, speaker_id=0, length_scale=1.0, noise_scale=0.667, noise_w=0.8):
        try:
            if self.voice is None:
                model_path = f"./models/{voice_model}.onnx"
                config_path = f"./models/{voice_model}.onnx.json"

                if not os.path.exists(model_path):
                    print(f"Model not found: {model_path}")
                    return None

                self.voice = PiperVoice.load(model_path, config_path)
                print(f"Voice model loaded: {voice_model}")

            print(f"Generating audio with enhanced parameters: length_scale={length_scale}, noise_scale={noise_scale}, noise_w={noise_w}")

            # Try modern API with enhanced parameters: returns iterable of AudioChunk
            try:
                # Use enhanced synthesis parameters for more natural speech
                audio_chunks = self.voice.synthesize(
                    text, 
                    speaker_id=speaker_id,
                    length_scale=length_scale,  # Controls speech speed (1.0 = normal, >1.0 = slower)
                    noise_scale=noise_scale,    # Controls randomness for naturalness (0.667 = good balance)
                    noise_w=noise_w            # Controls prosody variation (0.8 = natural variation)
                )
                
                # Ensure it's iterable and not None
                if audio_chunks is None:
                    raise TypeError("synthesize returned None")
                raw_audio_data = b''
                sample_rate = 22050
                channels = 1
                count = 0
                for i, chunk in enumerate(audio_chunks):
                    count += 1
                    if hasattr(chunk, 'audio_int16_bytes'):
                        raw_audio_data += chunk.audio_int16_bytes
                        if i == 0 and hasattr(chunk, 'sample_rate'):
                            sample_rate = chunk.sample_rate
                            channels = getattr(chunk, 'sample_channels', 1)
                    else:
                        print(f"Chunk {i} missing audio_int16_bytes, stopping")
                        break
                if count == 0 or not raw_audio_data:
                    print("No chunks or empty audio from modern API; falling back")
                    raise TypeError("empty audio from iterable API")
                # Build WAV header and return
                data_length = len(raw_audio_data)
                wav_header = struct.pack('<4sI4s4sIHHIIHH4sI',
                    b'RIFF', 36 + data_length, b'WAVE', b'fmt ',
                    16, 1, channels, sample_rate, sample_rate * channels * 2, 2 * channels, 16,
                    b'data', data_length)
                return wav_header + raw_audio_data
            except (TypeError, AttributeError) as e:
                # Legacy API: requires a wave.Wave_write as wav_file (may not support enhanced parameters)
                print(f"Modern enhanced synthesize API failed ({e}); trying legacy wav_file API")
                import tempfile
                import wave
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_wav:
                    temp_wav_path = temp_wav.name
                try:
                    wav_writer = wave.open(temp_wav_path, 'wb')
                    try:
                        # Try legacy API with parameters if supported
                        try:
                            self.voice.synthesize(
                                text, 
                                wav_writer,
                                speaker_id=speaker_id,
                                length_scale=length_scale,
                                noise_scale=noise_scale,
                                noise_w=noise_w
                            )
                        except TypeError:
                            # Fallback to basic legacy API without enhanced parameters
                            print("Legacy API doesn't support enhanced parameters, using basic synthesis")
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
    httpd = HTTPServer(server_address, PiperTTSHandler)
    print(f"Piper TTS Server starting on http://0.0.0.0:5001")
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
