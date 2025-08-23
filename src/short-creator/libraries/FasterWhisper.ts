import axios from "axios";
import { logger } from "../../config";
import { Config } from "../../config";
import type { Caption } from "../../types/shorts";

export interface FasterWhisperOptions {
  audioPath: string;
  model?: string;
  language?: string;
  computeType?: "int8" | "int16" | "float16" | "float32";
  device?: "cpu" | "cuda";
  numWorkers?: number;
}

export interface WhisperSegment {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: any[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
  words: WhisperWord[];
}

export interface WhisperWord {
  start: number;
  end: number;
  word: string;
  probability: number;
}

export interface FasterWhisperResponse {
  language: string;
  language_probability: number;
  duration: number;
  segments: WhisperSegment[];
}

export const ErrorFasterWhisper = new Error("There was an error with Faster-Whisper");

export class FasterWhisper {
  private serverUrl: string;
  private fallbackUrls: string[];

  constructor(private config: Config, serverUrl: string = "http://faster-whisper:5002") {
    this.serverUrl = serverUrl;
    this.fallbackUrls = [
      "http://faster-whisper:5002",
      "http://localhost:5002",
      "http://127.0.0.1:5002"
    ];
  }

  static async init(config: Config): Promise<FasterWhisper> {
    const instance = new FasterWhisper(config);
    
    // Test connectivity
    await instance.checkHealth();
    logger.debug("Faster-Whisper service is healthy");
    
    return instance;
  }

  async checkHealth(): Promise<boolean> {
    for (const url of this.fallbackUrls) {
      try {
        const response = await axios.get(`${url}/health`, { timeout: 5000 });
        if (response.status === 200) {
          this.serverUrl = url;
          logger.debug({ url, model: response.data.model }, "Faster-Whisper health check passed");
          return true;
        }
      } catch (error: any) {
        logger.warn({ error: error.message, url }, "Faster-Whisper health check failed for URL");
        continue;
      }
    }
    
    logger.error("All Faster-Whisper URLs failed health check");
    return false;
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.serverUrl}/models`);
      return response.data.available_models || [];
    } catch (error) {
      logger.error({ error }, "Failed to get available models");
      return [];
    }
  }

  async transcribe(options: FasterWhisperOptions): Promise<FasterWhisperResponse> {
    const {
      audioPath,
      model = this.config.whisperModel,
      language = this.config.language || "tr",
      computeType = "int8", // Default to INT8 for speed and efficiency
      device = "cpu",
      numWorkers = 1
    } = options;

    logger.debug({
      audioPath,
      model,
      language,
      computeType,
      device,
      numWorkers
    }, "Starting Faster-Whisper transcription");

    // Try each URL until one works
    for (const url of this.fallbackUrls) {
      try {
        logger.debug({ url }, "Trying Faster-Whisper server");

        const requestData = {
          audio_path: audioPath,
          model,
          language,
          compute_type: computeType,
          device,
          num_workers: numWorkers
        };

        const response = await axios.post(
          `${url}/transcribe`,
          requestData,
          {
            timeout: 120000, // 2 minutes timeout for large audio files
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        if (response.status === 200) {
          logger.debug({
            audioPath,
            model,
            language,
            segmentCount: response.data.segments?.length || 0,
            duration: response.data.duration,
            url
          }, "Faster-Whisper transcription completed successfully");

          // Update serverUrl to working one for future requests
          this.serverUrl = url;
          return response.data;
        }
      } catch (error: any) {
        logger.warn({ 
          error: error.message, 
          url, 
          audioPath 
        }, "Failed to transcribe with Faster-Whisper server, trying next URL");
        continue;
      }
    }

    // If all URLs failed, throw error
    const error = new Error(`All Faster-Whisper servers failed. Tried: ${this.fallbackUrls.join(', ')}`);
    logger.error({ error, options }, "Error transcribing with Faster-Whisper");
    throw error;
  }

  async CreateCaption(audioPath: string): Promise<Caption[]> {
    logger.debug({ audioPath }, "Starting to transcribe audio with Faster-Whisper");

    try {
      const transcriptionResult = await this.transcribe({ audioPath });
      
      logger.debug({ 
        audioPath, 
        segmentCount: transcriptionResult.segments.length,
        language: transcriptionResult.language,
        duration: transcriptionResult.duration
      }, "Faster-Whisper transcription finished, creating captions");

      const captions: Caption[] = [];

      // Process segments and create captions with word-level timing
      transcriptionResult.segments.forEach((segment) => {
        if (!segment.text || segment.text.trim() === "") {
          return;
        }

        // If word-level timestamps are available, use them for more precise captions
        if (segment.words && segment.words.length > 0) {
          segment.words.forEach((word) => {
            if (word.word && word.word.trim()) {
              captions.push({
                text: word.word,
                startMs: Math.round(word.start * 1000),
                endMs: Math.round(word.end * 1000),
              });
            }
          });
        } else {
          // Fallback to segment-level timing
          // Split text into words and estimate timing
          const words = segment.text.trim().split(/\s+/);
          const segmentDuration = segment.end - segment.start;
          const wordDuration = segmentDuration / words.length;

          words.forEach((word, index) => {
            if (word.trim()) {
              const wordStart = segment.start + (index * wordDuration);
              const wordEnd = segment.start + ((index + 1) * wordDuration);
              
              captions.push({
                text: ` ${word}`, // Add space for natural reading
                startMs: Math.round(wordStart * 1000),
                endMs: Math.round(wordEnd * 1000),
              });
            }
          });
        }
      });

      // Filter out very short captions and merge consecutive words
      const processedCaptions = this.optimizeCaptions(captions);

      logger.debug({ 
        audioPath, 
        originalCaptions: captions.length,
        processedCaptions: processedCaptions.length
      }, "Captions created and optimized");

      return processedCaptions;

    } catch (error) {
      logger.error({ error, audioPath }, "Error creating captions with Faster-Whisper");
      throw ErrorFasterWhisper;
    }
  }

  private optimizeCaptions(captions: Caption[]): Caption[] {
    if (captions.length === 0) return captions;

    const optimized: Caption[] = [];
    let currentCaption = { ...captions[0] };

    for (let i = 1; i < captions.length; i++) {
      const nextCaption = captions[i];
      
      // Merge captions if they're very close in time (less than 100ms gap)
      const gap = nextCaption.startMs - currentCaption.endMs;
      
      if (gap < 100 && currentCaption.text.length + nextCaption.text.length < 50) {
        // Merge captions
        currentCaption.text += nextCaption.text;
        currentCaption.endMs = nextCaption.endMs;
      } else {
        // Save current caption and start new one
        if (currentCaption.text.trim()) {
          optimized.push(currentCaption);
        }
        currentCaption = { ...nextCaption };
      }
    }

    // Don't forget the last caption
    if (currentCaption.text.trim()) {
      optimized.push(currentCaption);
    }

    return optimized;
  }
}
