import axios from "axios";
import { logger } from "../../config";

export interface PiperTTSOptions {
  text: string;
  voice?: string;
  serverUrl?: string;
  speakingRate?: number;
  lengthScale?: number;
  noiseScale?: number;
  noiseW?: number;
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

  private enhanceTextForNaturalSpeech(text: string): string {
    // Add natural pauses after sentences and punctuation
    let enhancedText = text
      // Add longer pause after sentences
      .replace(/([.!?])\s+/g, '$1... ')
      // Add medium pause after commas
      .replace(/,\s+/g, ', ')
      // Add short pause after colons and semicolons  
      .replace(/([;:])\s+/g, '$1. ')
      // Ensure proper spacing around numbers
      .replace(/(\d+)\s*([a-zA-ZçğıöşüÇĞIİÖŞÜ])/g, '$1 $2');

    // Split into sentences for better prosody
    const sentences = enhancedText.split(/([.!?])/);
    const processedSentences = [];
    
    for (let i = 0; i < sentences.length; i += 2) {
      const sentence = sentences[i];
      const punctuation = sentences[i + 1] || '';
      
      if (sentence && sentence.trim()) {
        // Add natural breathing pause between sentences
        processedSentences.push(sentence.trim() + punctuation + (punctuation ? '...' : ''));
      }
    }
    
    return processedSentences.join(' ');
  }

  async generateAudio(options: PiperTTSOptions): Promise<ArrayBuffer> {
    const { 
      text, 
      voice = "tr_TR-dfki-medium",
      speakingRate = 1.0,
      lengthScale = 1.1, // Slightly slower for more natural speech
      noiseScale = 0.667, // Add slight randomness for naturalness
      noiseW = 0.8 // Slight prosody variation
    } = options;
    
    // Enhance text for more natural speech
    const enhancedText = this.enhanceTextForNaturalSpeech(text);
    
    logger.debug({ 
      originalText: text, 
      enhancedText, 
      voice, 
      speakingRate, 
      lengthScale 
    }, "Generating enhanced audio with Piper TTS");

    // Try each URL until one works
    for (const url of this.fallbackUrls) {
      try {
        logger.debug({ url }, "Trying Piper TTS server");
        
        const requestData = {
          text: enhancedText,
          voice,
          speaker_id: 0,
          length_scale: lengthScale,
          noise_scale: noiseScale,
          noise_w: noiseW
        };
        
        const response = await axios.post(
          `${url}/tts`,
          requestData,
          {
            responseType: "arraybuffer",
            timeout: 15000, // Increased timeout for larger models
          }
        );

        if (response.status === 200) {
          logger.debug(
            { 
              originalText: text,
              enhancedText, 
              voice, 
              audioSize: response.data.byteLength, 
              url,
              speakingRate,
              lengthScale
            },
            "Enhanced audio generated successfully with Piper TTS"
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
