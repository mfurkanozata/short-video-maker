import {
  VoiceEnum,
  type kokoroModelPrecision,
  type Voices,
} from "../../types/shorts";
import { logger } from "../../config";
import { PiperTTS } from "./PiperTTS";
import { ElevenLabsTTS } from "./ElevenLabsTTS";
import { stripBracketDirectives } from "../../utils/text";

export class Kokoro {
  private piperTTS: PiperTTS;
  private eleven?: ElevenLabsTTS;

  constructor(private language: string = "en") {
    const url = process.env.PIPER_TTS_URL || "http://piper-tts:5001";
    this.piperTTS = new PiperTTS(url);
    if (process.env.ELEVENLABS_API_KEY) {
      try {
        this.eleven = new ElevenLabsTTS(process.env.ELEVENLABS_API_KEY);
      } catch (e) {
        // ignore init error, will fallback to Piper
      }
    }
  }

  async generate(
    text: string,
    voice: Voices,
  ): Promise<{
    audio: ArrayBuffer;
    audioLength: number;
  }> {
    const sanitizedText = stripBracketDirectives(text);
    // Allow raw ElevenLabs voice ID via config.voice coming from the request payload
    // Detect ElevenLabs voice IDs (usually long alphanumeric IDs)
    const voiceStr = String(voice || '');
    const isElevenLabsId = /^[A-Za-z0-9_-]{16,}$/i.test(voiceStr);
    const providedVoiceId = isElevenLabsId ? voiceStr : '';
    const envVoiceId = process.env.ELEVENLABS_VOICE_ID || "";
    const elevenVoiceId = providedVoiceId || envVoiceId;
    const useEleven = !!this.eleven && !!(process.env.ELEVENLABS_API_KEY) && !!elevenVoiceId;

    if (useEleven && this.eleven) {
      try {
        logger.debug({ text: sanitizedText, voice, language: this.language, elevenVoiceId }, "Using ElevenLabs TTS");
        // Use raw text for maximum speed (no added pauses)
        const audio = await this.eleven.synthesize({
          text: sanitizedText,
          voiceId: elevenVoiceId,
        });
        // ElevenLabs returns MP3 by default; calculate duration dynamically using actual bitrate
        const audioLength = await this.calculateAudioDuration(audio);
        return { audio, audioLength };
      } catch (e) {
        logger.warn({ e }, "ElevenLabs failed, falling back to Piper");
      }
    }

    try {
      logger.debug({ text: sanitizedText, voice, language: this.language }, "Using Piper TTS");
      const piperVoice = this.mapKokoroVoiceToPiper(voice);
      const audio = await this.piperTTS.generateAudio({
        text: this.enhanceText(sanitizedText),
        voice: piperVoice,
      });
      const audioLength = audio.byteLength / (22050 * 2);
      logger.debug({ text, voice, audioLength, language: this.language }, "Audio generated with Piper TTS");
      return { audio, audioLength };
    } catch (error) {
      logger.error({ error }, "Piper TTS failed");
      throw new Error(`Piper TTS error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Calculate audio duration dynamically using actual bitrate
  private async calculateAudioDuration(audio: ArrayBuffer): Promise<number> {
    try {
      // Create a temporary file to analyze with ffprobe
      const tempPath = `/tmp/temp_audio_${Date.now()}.mp3`;
      const fs = require('fs');
      fs.writeFileSync(tempPath, Buffer.from(audio));
      
      // Use ffprobe to get actual duration and bitrate
      const { execSync } = require('child_process');
      const ffprobeOutput = execSync(`ffprobe -v quiet -print_format json -show_format "${tempPath}"`, { encoding: 'utf8' });
      const metadata = JSON.parse(ffprobeOutput);
      
      // Clean up temp file
      fs.unlinkSync(tempPath);
      
      const duration = parseFloat(metadata.format.duration);
      logger.debug({ 
        fileSize: audio.byteLength, 
        duration, 
        bitrate: metadata.format.bit_rate,
        calculatedDuration: audio.byteLength / (parseInt(metadata.format.bit_rate) / 8)
      }, "Audio duration calculated dynamically");
      
      return duration;
    } catch (error) {
      logger.warn({ error }, "Failed to calculate audio duration dynamically, falling back to estimation");
      // Fallback to improved estimation for ElevenLabs MP3 (128kbps)
      // ElevenLabs MP3 files are typically 128kbps = 16kB/s
      // But we need to account for MP3 overhead, so use a slightly lower rate
      return audio.byteLength / 14000; // More accurate estimation for ElevenLabs MP3
    }
  }

  // Map Kokoro voices to available Piper voices
  private mapKokoroVoiceToPiper(kokoroVoice: Voices): string {
    const voiceMap: Record<string, string> = {
      'af_heart': 'tr_TR-dfki-medium', // Default to Turkish for now
      'af_soft': 'tr_TR-dfki-medium',
      'af_strong': 'tr_TR-dfki-medium',
      'af_gentle': 'tr_TR-dfki-medium',
      'af_energetic': 'tr_TR-dfki-medium',
      'af_calm': 'tr_TR-dfki-medium',
      'af_cheerful': 'tr_TR-dfki-medium',
      'af_sad': 'tr_TR-dfki-medium',
      'af_angry': 'tr_TR-dfki-medium',
      'af_fearful': 'tr_TR-dfki-medium',
      'af_disgusted': 'tr_TR-dfki-medium',
      'af_surprised': 'tr_TR-dfki-medium',
    };
    
    return voiceMap[kokoroVoice] || 'tr_TR-dfki-medium';
  }

  static async init(dtype: kokoroModelPrecision, language: string | null = "en"): Promise<Kokoro> {
    // No need to initialize Kokoro TTS, just return Piper TTS wrapper
    return new Kokoro(language || "en");
  }

  listAvailableVoices(): Voices[] {
    const voices = Object.values(VoiceEnum) as Voices[];
    return voices;
  }

  // Enhanced text preprocessing for better TTS
  private enhanceText(text: string): string {
    // Keep Turkish characters but add proper spacing and punctuation
    text = text
      // Add proper spacing around punctuation for better TTS
      .replace(/([.!?])\s*([a-zA-ZğüşıöçĞÜŞİÖÇ])/g, '$1 $2')
      .replace(/([a-zA-ZğüşıöçĞÜŞİÖÇ])\s*([,;:])/g, '$1$2 ')
      
      // Normalize common abbreviations and numbers
      .replace(/(\d+)\s*([a-zA-ZğüşıöçĞÜŞİÖÇ])/g, '$1 $2')
      .replace(/([a-zA-ZğüşıöçĞÜŞİÖÇ])\s*(\d+)/g, '$1 $2')
      
      // Add slight pauses for better rhythm
      .replace(/([.!?])\s+/g, '$1... ')
      
      // Remove extra spaces and normalize
      .replace(/\s+/g, ' ')
      .trim();
    
    return text;
  }
}
