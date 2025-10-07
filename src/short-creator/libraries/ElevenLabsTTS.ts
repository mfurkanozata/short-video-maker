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
        stability = 0.5,
        similarityBoost = 1,
        style = 1.0,
        useSpeakerBoost = true,
      } = options;

      // Use ElevenLabs text-to-dialogue endpoint
      // Keep compatibility with existing callers by mapping our options
      const url = `${this.baseUrl}/text-to-dialogue`;

      const payload = {
        inputs: [
          {
            text,
            voice_id: voiceId,
          },
        ],
        language_code: "tr",
        model_id: modelId,
        settings: {
          stability,
          // Map additional options to equivalent dialogue settings when relevant in future
        },
        apply_text_normalization: "on",
      } as const;

      logger.debug({ url, voiceId, modelId }, "Calling ElevenLabs TTS");

      const response = await axios.post(url, payload, {
        responseType: "arraybuffer",
        headers: {
          "xi-api-key": this.apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        timeout: 180000,
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


