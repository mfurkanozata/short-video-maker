import {
  VoiceEnum,
  type kokoroModelPrecision,
  type Voices,
} from "../../types/shorts";
import { logger } from "../../config";
import { ElevenLabsTTS } from "./ElevenLabsTTS";
import { stripBracketDirectives } from "../../utils/text";

export class Kokoro {
  private eleven?: ElevenLabsTTS;

  constructor(private language: string = "en") {
    if (process.env.ELEVENLABS_API_KEY) {
      try {
        this.eleven = new ElevenLabsTTS(process.env.ELEVENLABS_API_KEY);
      } catch (e) {
        // surface init error since we no longer fallback
        throw e;
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
    const elevenDevMode = process.env.ELEVEN_DEV_MODE === 'true';
    const elevenVoiceId = providedVoiceId || envVoiceId;
    
    // ELEVEN_DEV_MODE: Use any available voice, fallback to default if none specified
    const finalVoiceId = elevenDevMode && !elevenVoiceId ? "5IRSuKNUc0nJnSPPuxMI" : elevenVoiceId;
    
    const useEleven = !!this.eleven && !!(process.env.ELEVENLABS_API_KEY) && (!!finalVoiceId || elevenDevMode);
    if (!useEleven || !this.eleven) {
      throw new Error("ElevenLabs is required but not properly configured (missing API key or voiceId)");
    }

    logger.debug({ text: sanitizedText, voice, language: this.language, elevenVoiceId: finalVoiceId, elevenDevMode }, "Using ElevenLabs TTS");
    const audio = await this.eleven.synthesize({
      text: sanitizedText,
      voiceId: finalVoiceId,
    });
    const audioLength = await this.calculateAudioDuration(audio);
    return { audio, audioLength };
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

  static async init(dtype: kokoroModelPrecision, language: string | null = "en"): Promise<Kokoro> {
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
