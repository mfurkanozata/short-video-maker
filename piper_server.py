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
            data = json.loads(post_data.decode('utf-8'))
            
            text = data.get('text', '')
            voice_model = data.get('voice', 'tr_TR-dfki-medium')
            
            if not text:
                self.send_error(400, "Text is required")
                return
            
            # Generate audio
            audio_data = self.generate_audio(text, voice_model)
            
            if audio_data:
                # Send audio response
                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Content-Length', str(len(audio_data)))
                self.end_headers()
                self.wfile.write(audio_data)
            else:
                self.send_error(500, "Failed to generate audio")
                
        except Exception as e:
            print(f"Error: {e}")
            self.send_error(500, f"Internal Server Error: {str(e)}")
    
    def generate_audio(self, text, voice_model):
        try:
            # Initialize voice if not already done
            if self.voice is None:
                model_path = f"./models/{voice_model}.onnx"
                config_path = f"./models/{voice_model}.onnx.json"
                
                if not os.path.exists(model_path):
                    print(f"Model not found: {model_path}")
                    return None
                
                self.voice = PiperVoice.load(model_path, config_path)
                print(f"Voice model loaded: {voice_model}")
            
            # Generate audio - Piper returns AudioChunk objects
            audio_chunks = self.voice.synthesize(text)
            print(f"Audio chunks type: {type(audio_chunks)}")
            
            # Collect raw audio data
            raw_audio_data = b''
            sample_rate = 22050  # Default Piper sample rate
            channels = 1  # Mono
            
            for i, chunk in enumerate(audio_chunks):
                print(f"Chunk {i} type: {type(chunk)}")
                # Use audio_int16_bytes property from AudioChunk
                if hasattr(chunk, 'audio_int16_bytes'):
                    print(f"Chunk {i} using audio_int16_bytes")
                    raw_audio_data += chunk.audio_int16_bytes
                    # Get sample rate from first chunk
                    if i == 0 and hasattr(chunk, 'sample_rate'):
                        sample_rate = chunk.sample_rate
                        channels = chunk.sample_channels
                else:
                    print(f"Chunk {i} no audio_int16_bytes attr")
                    break
            
            # Create WAV header
            wav_header = self.create_wav_header(len(raw_audio_data), sample_rate, channels)
            
            # Combine header and audio data
            audio_data = wav_header + raw_audio_data
            
            return audio_data
            
        except Exception as e:
            print(f"Audio generation error: {e}")
            return None
    
    def create_wav_header(self, data_length, sample_rate, channels):
        """Create WAV header for the audio data"""
        # WAV header structure
        header = bytearray(44)
        
        # RIFF header
        header[0:4] = b'RIFF'
        header[4:8] = (36 + data_length).to_bytes(4, 'little')  # File size
        header[8:12] = b'WAVE'
        
        # fmt chunk
        header[12:16] = b'fmt '
        header[16:20] = (16).to_bytes(4, 'little')  # fmt chunk size
        header[20:22] = (1).to_bytes(2, 'little')   # Audio format (PCM)
        header[22:24] = channels.to_bytes(2, 'little')  # Channels
        header[24:28] = sample_rate.to_bytes(4, 'little')  # Sample rate
        header[28:32] = (sample_rate * channels * 2).to_bytes(4, 'little')  # Byte rate
        header[32:34] = (channels * 2).to_bytes(2, 'little')  # Block align
        header[34:36] = (16).to_bytes(2, 'little')  # Bits per sample
        
        # data chunk
        header[36:40] = b'data'
        header[40:44] = data_length.to_bytes(4, 'little')  # Data size
        
        return header
    
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
    # Create models directory if it doesn't exist
    models_dir = Path("./models")
    models_dir.mkdir(exist_ok=True)
    
    # Check if Turkish model exists
    tr_model = "tr_TR-dfki-medium"
    model_path = models_dir / f"{tr_model}.onnx"
    
    if not model_path.exists():
        print(f"Turkish model not found: {model_path}")
        print("Please download the model manually from:")
        print("https://huggingface.co/rhasspy/piper-voices/tree/main/tr/tr_TR/dfki/medium")
        print("and place it in the ./models directory")
        return
    
    # Start server
    server_address = ('localhost', 5001)
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
