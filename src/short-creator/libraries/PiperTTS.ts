import axios from "axios";
import { logger } from "../../config";

export interface PiperTTSOptions {
  text: string;
  voice?: string;
  serverUrl?: string;
}

export class PiperTTS {
  private serverUrl: string;
  private fallbackUrls: string[];

  constructor(serverUrl: string = "http://piper-tts:5001") {
    this.serverUrl = serverUrl;
    this.fallbackUrls = [
      "http://piper-tts:5001",
      "http://localhost:5001",
      "http://127.0.0.1:5001"
    ];
  }

  async generateAudio(options: PiperTTSOptions): Promise<ArrayBuffer> {
    const { text, voice = "tr_TR-dfki-medium" } = options;
    logger.debug({ text, voice }, "Generating audio with Piper TTS");

    // Try each URL until one works
    for (const url of this.fallbackUrls) {
      try {
        logger.debug({ url }, "Trying Piper TTS server");
        
        const response = await axios.post(
          `${url}/tts`,
          {
            text,
            voice,
          },
          {
            responseType: "arraybuffer",
            timeout: 10000, // 10 seconds timeout per attempt
          }
        );

        if (response.status === 200) {
          logger.debug(
            { text, voice, audioSize: response.data.byteLength, url },
            "Audio generated successfully with Piper TTS"
          );
          // Update serverUrl to working one for future requests
          this.serverUrl = url;
          return response.data;
        }
      } catch (error: any) {
        logger.warn({ error: error.message, url }, "Failed to connect to Piper TTS server, trying next URL");
        continue;
      }
    }

    // If all URLs failed, throw error
    const error = new Error(`All Piper TTS servers failed. Tried: ${this.fallbackUrls.join(', ')}`);
    logger.error({ error, options }, "Error generating audio with Piper TTS");
    throw error;
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
