#!/usr/bin/env python3
"""
Test Piper TTS locally
"""

from piper import PiperVoice
import struct

def test_piper_local():
    # Load voice
    voice = PiperVoice.load('./models/tr_TR-dfki-medium.onnx', './models/tr_TR-dfki-medium.onnx.json')
    print('Voice loaded successfully')
    
    # Synthesize audio
    chunks = list(voice.synthesize('Merhaba'))
    print(f'Generated {len(chunks)} chunks')
    
    if chunks:
        chunk = chunks[0]
        sample_rate = chunk.sample_rate
        audio_data = chunk.audio_int16_bytes
        data_length = len(audio_data)
        
        print(f'Sample rate: {sample_rate}')
        print(f'Audio data length: {data_length}')
        print(f'Audio data type: {type(audio_data)}')
        
        # Create WAV header
        wav_header = struct.pack('<4sI4s4sIHHIIHH4sI',
            b'RIFF', 36 + data_length, b'WAVE', b'fmt ',
            16, 1, 1, sample_rate, sample_rate * 2, 2, 16,
            b'data', data_length)
        
        # Write WAV file
        with open('test_local.wav', 'wb') as f:
            f.write(wav_header + audio_data)
        
        print(f'Local WAV created: {len(wav_header + audio_data)} bytes')
        return True
    else:
        print('No audio chunks generated')
        return False

if __name__ == '__main__':
    test_piper_local()
