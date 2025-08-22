import {
  VoiceEnum,
  type kokoroModelPrecision,
  type Voices,
} from "../../types/shorts";
import { logger } from "../../config";
import { PiperTTS } from "./PiperTTS";

export class Kokoro {
  private piperTTS: PiperTTS;

  constructor(private language: string = "en") {
    this.piperTTS = new PiperTTS();
  }

  async generate(
    text: string,
    voice: Voices,
  ): Promise<{
    audio: ArrayBuffer;
    audioLength: number;
  }> {
    // Always use Piper TTS for all languages
    try {
      logger.debug({ text, voice, language: this.language }, "Using Piper TTS");
      
      // Map Kokoro voices to Piper voices
      const piperVoice = this.mapKokoroVoiceToPiper(voice);
      
      const audio = await this.piperTTS.generateAudio({
        text: this.enhanceText(text),
        voice: piperVoice
      });
      
      // Calculate audio length (approximate)
      const audioLength = audio.byteLength / (22050 * 2); // 22050 Hz, 16-bit, mono
      
      logger.debug({ text, voice, audioLength, language: this.language }, "Audio generated with Piper TTS");
      
      return {
        audio,
        audioLength,
      };
    } catch (error) {
      logger.error({ error }, "Piper TTS failed");
      throw new Error(`Piper TTS error: ${error instanceof Error ? error.message : String(error)}`);
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

  static async init(dtype: kokoroModelPrecision, language: string = "en"): Promise<Kokoro> {
    // No need to initialize Kokoro TTS, just return Piper TTS wrapper
    return new Kokoro(language);
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
