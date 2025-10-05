import axios from "axios";
import { logger } from "../../config";
import { withRetry, retryConditions } from "../../utils/retry";

export interface ElevenLabsTTSOptions {
  text: string;
  voiceId: string; // e.g. lV90UmdRoVFQHzkxUPeu
  modelId?: string; // optional model, default to eleven_v3 (alpha)
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
}

export class ElevenLabsTTS {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string) {
    const envKey = process.env.ELEVENLABS_API_KEY;
    this.apiKey = apiKey || (envKey as string);
    this.baseUrl = "https://api.elevenlabs.io/v1";

    if (!this.apiKey) {
      throw new Error(
        "ELEVENLABS_API_KEY is not set. Please add it to your environment (.env)."
      );
    }
  }

  async synthesize(options: ElevenLabsTTSOptions): Promise<ArrayBuffer> {
    return withRetry(async () => {
      const {
        text,
        voiceId,
        modelId = "eleven_v3",
        stability = 1,
        similarityBoost = 1,
        style = 1.0,
        useSpeakerBoost = true,
      } = options;

      // Use the new endpoint format with output_format parameter
      // Eleven v3 (alpha) supports 70+ languages with enhanced emotional control
      const url = `${this.baseUrl}/text-to-speech/${voiceId}?output_format=mp3_44100_128`;

      const payload = {
        text,
        model_id: modelId, // eleven_v3 - latest and most advanced model
        voice_settings: {
          stability,
          similarity_boost: similarityBoost,
          style,
          use_speaker_boost: useSpeakerBoost,
        },
      };

      logger.debug({ url, voiceId, modelId }, "Calling ElevenLabs TTS");

      const response = await axios.post(url, payload, {
        responseType: "arraybuffer",
        headers: {
          "xi-api-key": this.apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        timeout: 30000,
      });

      if (response.status !== 200) {
        throw new Error(`ElevenLabs TTS failed with status ${response.status}`);
      }

      return response.data as ArrayBuffer;
    }, {
      maxAttempts: 5,
      delayMs: 1500,
      backoffMultiplier: 2,
      maxDelayMs: 20000,
      retryCondition: retryConditions.elevenlabs,
      jitter: true
    });
  }
}


