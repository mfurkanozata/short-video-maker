import axios from "axios";
import { logger } from "../../config";

export interface PiperTTSOptions {
  text: string;
  voice?: string;
  serverUrl?: string;
}

export class PiperTTS {
  private serverUrl: string;

  constructor(serverUrl: string = "http://piper-tts:5001") {
    this.serverUrl = serverUrl;
  }

  async generateAudio(options: PiperTTSOptions): Promise<ArrayBuffer> {
    try {
      const { text, voice = "tr_TR-dfki-medium" } = options;

      logger.debug({ text, voice }, "Generating audio with Piper TTS");

      const response = await axios.post(
        `${this.serverUrl}/tts`,
        {
          text,
          voice,
        },
        {
          responseType: "arraybuffer",
          timeout: 30000, // 30 seconds timeout
        }
      );

      if (response.status === 200) {
        logger.debug(
          { text, voice, audioSize: response.data.byteLength },
          "Audio generated successfully with Piper TTS"
        );
        return response.data;
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      logger.error({ error, options }, "Error generating audio with Piper TTS");
      throw error;
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.serverUrl}/health`);
      return response.status === 200;
    } catch (error) {
      logger.error({ error }, "Piper TTS health check failed");
      return false;
    }
  }

  getAvailableVoices(): string[] {
    return [
      "tr_TR-dfki-medium", // Turkish - DFKI - Medium quality
      "tr_TR-dfki-low",    // Turkish - DFKI - Low quality
      "tr_TR-dfki-high",   // Turkish - DFKI - High quality
    ];
  }
}
