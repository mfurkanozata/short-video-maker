import { OrientationEnum } from "./../types/shorts";
/* eslint-disable @remotion/deterministic-randomness */
import fs from "fs-extra";
import cuid from "cuid";
import path from "path";
import https from "https";
import http from "http";
import axios from "axios";

import { Kokoro } from "./libraries/Kokoro";
import { Remotion } from "./libraries/Remotion";
import { FasterWhisper } from "./libraries/FasterWhisper";
import { FFMpeg } from "./libraries/FFmpeg";
import { PexelsAPI } from "./libraries/Pexels";
import { Config } from "../config";
import { logger } from "../logger";
import { withRetry, retryConditions } from "../utils/retry";
import { MusicManager } from "./music";
import type {
  SceneInput,
  RenderConfig,
  Scene,
  VideoStatus,
  MusicMoodEnum,
  MusicTag,
  MusicForVideo,
  QuestionVideoInput,
  Caption,
  QuestionSpecs,
} from "../types/shorts";
import { VoiceEnum } from "../types/shorts";

export class ShortCreator {
  private queue: {
    sceneInput: SceneInput[];
    config: RenderConfig;
    id: string;
    skipCaptions?: boolean;
    questionVideoData?: {
      specs: string[];
      unknownSpec: string;
      answer: string;
      scene1Duration: number;
      scene2Duration: number;
    };
  }[] = [];
  constructor(
    private config: Config,
    private remotion: Remotion,
    private kokoro: Kokoro,
    private whisper: FasterWhisper,
    private ffmpeg: FFMpeg,
    private pexelsApi: PexelsAPI,
    private musicManager: MusicManager,
  ) {}

  public status(id: string): VideoStatus {
    const videoPath = this.getVideoPath(id);
    if (this.queue.find((item) => item.id === id)) {
      return "processing";
    }
    if (fs.existsSync(videoPath)) {
      return "ready";
    }
    return "failed";
  }

  public addToQueue(sceneInput: SceneInput[], config: RenderConfig): string {
    // todo add mutex lock
    const id = cuid();
    this.queue.push({
      sceneInput,
      config,
      id,
    });
    if (this.queue.length === 1) {
      this.processQueue();
    }
    return id;
  }

  private async processQueue(): Promise<void> {
    // todo add a semaphore
    if (this.queue.length === 0) {
      return;
    }
    const { sceneInput, config, id, skipCaptions, questionVideoData } = this.queue[0];
    logger.debug(
      { sceneInput, config, id },
      "Processing video item in the queue",
    );
    try {
      await this.createShort(id, sceneInput, config, skipCaptions, questionVideoData);
      logger.debug({ id }, "Video created successfully");
    } catch (error: unknown) {
      logger.error(error, "Error creating video");
    } finally {
      this.queue.shift();
      this.processQueue();
    }
  }

  private async performPreFlightChecks(skipCaptions?: boolean): Promise<void> {
    logger.debug({ skipCaptions }, "Pre-flight checks called with skipCaptions parameter");
    
    // Skip Faster-Whisper check if captions are disabled
    if (skipCaptions) {
      logger.debug("Skipping Faster-Whisper pre-flight check (captions disabled)");
      return;
    }

    logger.debug("Performing pre-flight checks for Faster-Whisper");
    
    try {
      // Find the smallest WAV file in temp directory for testing
      const tempDir = this.config.tempDirPath;
      const wavFiles = fs.readdirSync(tempDir)
        .filter(file => file.endsWith('.wav'))
        .map(file => ({
          name: file,
          path: path.join(tempDir, file),
          size: fs.statSync(path.join(tempDir, file)).size
        }))
        .sort((a, b) => a.size - b.size);

      if (wavFiles.length === 0) {
        throw new Error("No WAV files found for Faster-Whisper testing");
      }

      const testWavFile = wavFiles[0];
      logger.debug({ testFile: testWavFile.name, size: testWavFile.size }, "Using smallest WAV file for Faster-Whisper test");
      
      // Try with current model first, then fallback to tiny if needed
      const modelsToTry = ['base', 'tiny'];
      let lastError: Error | null = null;
      
      for (const model of modelsToTry) {
        try {
          logger.debug({ model }, "Testing Faster-Whisper with model");
          
          // Test Faster-Whisper transcription with timeout
          const captions = await Promise.race([
            this.whisper.CreateCaption(testWavFile.path, "test", model),
            new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error(`Faster-Whisper test timeout after 30 seconds with ${model} model`)), 30000)
            )
          ]);
          
          if (captions.length === 0) {
            throw new Error(`Faster-Whisper returned empty captions with ${model} model`);
          }
          
          logger.debug({ model }, "Pre-flight check passed: Faster-Whisper is working");
          return; // Success, exit the method
          
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Unknown error');
          logger.warn({ model, error: lastError.message }, `Faster-Whisper test failed with ${model} model, trying next model`);
          
          // If this is not the last model, continue to next one
          if (model !== modelsToTry[modelsToTry.length - 1]) {
            continue;
          }
        }
      }
      
      // If we get here, all models failed
      throw lastError || new Error("All Faster-Whisper models failed");
      
    } catch (error) {
      logger.error({ error }, "Pre-flight check failed: Faster-Whisper is not working with any model");
      throw new Error(`Pre-flight check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async createShort(
    videoId: string,
    inputScenes: SceneInput[],
    config: RenderConfig,
    skipCaptions?: boolean,
    questionVideoData?: {
      specs: string[];
      unknownSpec: string;
      answer: string;
      scene1Duration: number;
      scene2Duration: number;
    },
  ): Promise<string> {
    // DEV_MODE: Use existing temp files for quick testing
    logger.debug({ devMode: this.config.devMode, envDevMode: process.env.DEV_MODE }, "Checking DEV_MODE status");
    if (this.config.devMode) {
      logger.debug({ videoId, sceneCount: inputScenes.length }, "DEV_MODE is active, using existing temp files");
      return this.createShortDevMode(videoId, inputScenes, config, skipCaptions, questionVideoData);
    }

    // Pre-flight check: ensure Faster-Whisper is working before using paid services
    await this.performPreFlightChecks(skipCaptions);
    
    logger.debug(
      {
        inputScenes,
        config,
      },
      "Creating short video",
    );
    const scenes: Scene[] = [];
    let totalDuration = 0;
    const excludeVideoIds = [];
    const tempFiles = [];

    const orientation: OrientationEnum =
      config.orientation || OrientationEnum.portrait;

    let index = 0;
    for (const scene of inputScenes) {
      const audio = await this.kokoro.generate(
        scene.text,
        config.voice ?? "af_heart",
      );
      
      let { audioLength } = audio;
      const { audio: audioStream } = audio;

      // For question videos, override duration with custom values
      if (questionVideoData) {
        if (index === 0) {
          audioLength = questionVideoData.scene1Duration;
        } else {
          audioLength = questionVideoData.scene2Duration;
        }
      } else {
        // add the paddingBack in seconds to the last scene for regular videos
        if (index + 1 === inputScenes.length && config.paddingBack) {
          audioLength += config.paddingBack / 1000;
        }
      }

      const tempId = cuid();
      const tempWavFileName = `${tempId}.wav`;
      const tempMp3FileName = `${tempId}.mp3`;
      const tempVideoFileName = `${tempId}.mp4`;
      const tempWavPath = path.join(this.config.tempDirPath, tempWavFileName);
      const tempMp3Path = path.join(this.config.tempDirPath, tempMp3FileName);
      const tempVideoPath = path.join(
        this.config.tempDirPath,
        tempVideoFileName,
      );
      // Add all temp files to cleanup
      tempFiles.push(tempWavPath, tempMp3Path);
      tempFiles.push(tempVideoPath.replace('.mp4', '_pollinations.png'));
      tempFiles.push(tempVideoPath.replace('.mp4', '_from_image.mp4'));

      await this.ffmpeg.saveNormalizedAudio(audioStream, tempWavPath);
      
      // Skip captions for question videos
      let captions: Caption[] = [];
      if (!skipCaptions) {
        captions = await this.whisper.CreateCaption(tempWavPath, scene.text);
      }

      await this.ffmpeg.saveToMp3(audioStream, tempMp3Path);
      // Prefer OpenAI Images for vertical (1080x1920) if OPENAI_API_KEY is provided
      const tempImagePath = tempVideoPath.replace('.mp4', '_image.png');
      const searchPrompt = scene.searchTerms.join(" ").replace(/\s+/g, " ");
      const useOpenAI = !!process.env.OPENAI_API_KEY;
      if (useOpenAI) {
        try {
          await this.generateOpenAIImage(searchPrompt, tempImagePath);
        } catch (error) {
          logger.warn({ error }, "OpenAI image generation failed, falling back to Pollinations");
          const pollinationsImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(searchPrompt)}?width=768&height=1365&model=turbo&nologo=true`;
          await this.downloadPollinationsImage(pollinationsImageUrl, tempImagePath);
        }
      } else {
        const pollinationsImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(searchPrompt)}?width=768&height=1365&model=turbo&nologo=true`;
        await this.downloadPollinationsImage(pollinationsImageUrl, tempImagePath);
      }
      
      const tempVideoFromImagePath = tempVideoPath.replace('.mp4', '_from_image.mp4');
      await this.convertImageToVideo(tempImagePath, tempVideoFromImagePath, audioLength);
      
      // Use local HTTP server for OffthreadVideo - Remotion only accepts http/https
      const videoUrl = `http://localhost:${this.config.port}/api/tmp/${tempVideoFileName.replace('.mp4', '_from_image.mp4')}`;
      
      logger.debug({ 
        searchTerms: scene.searchTerms,
        provider: useOpenAI ? 'openai' : 'pollinations',
        duration: audioLength,
        outputPath: tempVideoFromImagePath 
      }, "Created video from generated image");

      // SFX removed - scenes without sound effects
      scenes.push({
        captions,
        video: videoUrl,
        audio: {
          url: `http://localhost:${this.config.port}/api/tmp/${tempMp3FileName}`,
          duration: audioLength,
        },
        // sfx: removed
      });

      totalDuration += audioLength;
      index++;
    }
    if (config.paddingBack) {
      totalDuration += config.paddingBack / 1000;
    }

    const selectedMusic = this.findMusic(totalDuration, config.music);
    logger.debug({ selectedMusic }, "Selected music for the video");

    await this.remotion.render(
      {
        music: selectedMusic,
        scenes,
        config: {
          durationMs: totalDuration * 1000,
          paddingBack: config.paddingBack,
          ...{
            captionBackgroundColor: config.captionBackgroundColor,
            captionPosition: config.captionPosition,
          },
          musicVolume: config.musicVolume,
        },
        questionVideoData, // Pass question video data for display
      },
      videoId,
      orientation,
    );

    for (const file of tempFiles) {
      fs.removeSync(file);
    }

    return videoId;
  }

  public getVideoPath(videoId: string): string {
    return path.join(this.config.videosDirPath, `${videoId}.mp4`);
  }

  public deleteVideo(videoId: string): void {
    const videoPath = this.getVideoPath(videoId);
    fs.removeSync(videoPath);
    logger.debug({ videoId }, "Deleted video file");
  }

  public getVideo(videoId: string): Buffer {
    const videoPath = this.getVideoPath(videoId);
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video ${videoId} not found`);
    }
    return fs.readFileSync(videoPath);
  }

  private findMusic(videoDuration: number, musicInput?: string | MusicMoodEnum): MusicForVideo {
    // If musicInput is provided, try to find by keyword or mood
    if (musicInput) {
      // Try keyword-based search first
      const keywordMatch = this.musicManager.findMusicByKeyword(musicInput as string);
      if (keywordMatch) {
        return keywordMatch;
      }
      
      // If not found by keyword, try mood-based search
      const moodMatch = this.musicManager.musicList().find((music) => 
        music.mood === musicInput
      );
      if (moodMatch) {
        return moodMatch;
      }
    }
    
    // Fallback to random selection from all music
    const musicFiles = this.musicManager.musicList();
    return musicFiles[Math.floor(Math.random() * musicFiles.length)];
  }

  public ListAvailableMusicTags(): MusicTag[] {
    const tags = new Set<MusicTag>();
    this.musicManager.musicList().forEach((music) => {
      tags.add(music.mood as MusicTag);
    });
    return Array.from(tags.values());
  }

  public listAllVideos(): { id: string; status: VideoStatus }[] {
    const videos: { id: string; status: VideoStatus }[] = [];

    // Check if videos directory exists
    if (!fs.existsSync(this.config.videosDirPath)) {
      return videos;
    }

    // Read all files in the videos directory
    const files = fs.readdirSync(this.config.videosDirPath);

    // Filter for MP4 files and extract video IDs
    for (const file of files) {
      if (file.endsWith(".mp4")) {
        const videoId = file.replace(".mp4", "");

        let status: VideoStatus = "ready";
        const inQueue = this.queue.find((item) => item.id === videoId);
        if (inQueue) {
          status = "processing";
        }

        videos.push({ id: videoId, status });
      }
    }

    // Add videos that are in the queue but not yet rendered
    for (const queueItem of this.queue) {
      const existingVideo = videos.find((v) => v.id === queueItem.id);
      if (!existingVideo) {
        videos.push({ id: queueItem.id, status: "processing" });
      }
    }

    return videos;
  }

  public ListAvailableVoices(): string[] {
    return this.kokoro.listAvailableVoices();
  }

  public ListSortedMusic(): Array<{ index: number; file: string; mood: string }> {
    return this.musicManager.getSortedMusicList();
  }

  public addQuestionVideoToQueue(input: QuestionVideoInput): string {
    const id = cuid();
    
    // Get selected music by index
    const selectedMusic = this.musicManager.getMusicByIndex(input.musicIndex);
    if (!selectedMusic) {
      throw new Error(`Invalid music index: ${input.musicIndex}`);
    }

    // Scene 1: Question with specs overlay
    const questionScene: SceneInput = {
      text: input.question,
      language: input.config?.voice?.startsWith('tr_') ? 'tr' : 'en',
      searchTerms: input.questionImageTerm,
      inputProvider: 'pollinations'
    };

    // Scene 2: Answer with voice
    const answerScene: SceneInput = {
      text: input.answer,
      language: input.config?.voice?.startsWith('tr_') ? 'tr' : 'en',
      searchTerms: input.answerImageTerm,
      inputProvider: 'pollinations'
    };

    // Set up config with custom music and NO captions
    const config: RenderConfig = {
      ...input.config,
      captionPosition: undefined, // No captions
      captionBackgroundColor: undefined, // No captions
      music: selectedMusic.mood as MusicMoodEnum,
      orientation: input.config?.orientation || OrientationEnum.portrait,
      voice: input.config?.voice || VoiceEnum.af_heart
    };

    // Add to queue with special flag for question videos and extended data
    this.queue.push({
      sceneInput: [questionScene, answerScene],
      config,
      id,
      skipCaptions: true, // Custom flag for question videos
      questionVideoData: {
        specs: input.specs || [],
        unknownSpec: input.unknownSpec,
        answer: input.answer,
        scene1Duration: input.scene1Duration,
        scene2Duration: input.scene2Duration,
      },
    });

    // Process queue asynchronously
    this.processQueue();

    return id;
  }

  private async downloadVideoWithRetry(url: string, filePath: string, retries: number): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.downloadVideoWithValidation(url, filePath);
        logger.debug(`Video downloaded successfully to ${filePath} on attempt ${attempt}`);
        return;
      } catch (error) {
        logger.warn({ error, attempt, retries }, `Video download attempt ${attempt} failed`);
        
        // Clean up failed download
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (cleanupError) {
          logger.warn({ cleanupError }, "Failed to cleanup incomplete download");
        }

        if (attempt === retries) {
          throw new Error(`Failed to download video after ${retries} attempts: ${error}`);
        }

        // Wait before retry (exponential backoff)
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  private async downloadVideoWithValidation(url: string, filePath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = 30000; // 30 seconds timeout
      let downloadedBytes = 0;
      let expectedBytes = 0;

      const fileStream = fs.createWriteStream(filePath);
      
      const request = https.get(url, (response: http.IncomingMessage) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download video: ${response.statusCode} ${response.statusMessage}`));
          return;
        }

        // Get expected file size
        const contentLength = response.headers['content-length'];
        if (contentLength) {
          expectedBytes = parseInt(contentLength, 10);
          logger.debug({ expectedBytes, url }, "Starting video download");
        }

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
        });

        response.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close();
          
          // Validate download completion
          if (expectedBytes > 0 && downloadedBytes !== expectedBytes) {
            reject(new Error(`Incomplete download: got ${downloadedBytes} bytes, expected ${expectedBytes}`));
            return;
          }

          // Validate file exists and has content
          try {
            const stats = fs.statSync(filePath);
            if (stats.size === 0) {
              reject(new Error("Downloaded file is empty"));
              return;
            }
            
            logger.debug({ 
              filePath, 
              downloadedBytes, 
              expectedBytes, 
              actualSize: stats.size 
            }, "Video download validation successful");
            
            resolve();
          } catch (statError) {
            reject(new Error(`Failed to validate downloaded file: ${statError}`));
          }
        });

        fileStream.on("error", (error) => {
          fs.unlink(filePath, () => {});
          reject(error);
        });
      });

      request.setTimeout(timeout, () => {
        request.destroy();
        fs.unlink(filePath, () => {});
        reject(new Error(`Download timeout after ${timeout}ms`));
      });

      request.on("error", (error) => {
        fs.unlink(filePath, () => {});
        reject(error);
      });
    });
  }

  private async reencodeVideoForRemotion(inputPath: string, outputPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      logger.debug({ inputPath, outputPath }, "Re-encoding video for Remotion compatibility");
      
      // FFmpeg command for Remotion-compatible encoding
      const ffmpeg = require('fluent-ffmpeg');
      
      ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .format('mp4')
        .outputOptions([
          '-preset fast',
          '-crf 23',
          '-pix_fmt yuv420p',
          '-movflags +faststart',
          '-r 25' // Standard frame rate
        ])
        .size('1080x1920') // Simple resolution setting
        .on('start', (commandLine: string) => {
          logger.debug({ commandLine }, "FFmpeg re-encoding started");
        })
        .on('progress', (progress: any) => {
          if (progress.percent) {
            logger.debug({ percent: Math.round(progress.percent) }, "Video re-encoding progress");
          }
        })
        .on('end', () => {
          logger.debug({ outputPath }, "Video re-encoding completed successfully");
          resolve();
        })
        .on('error', (error: any) => {
          logger.error({ error, inputPath, outputPath }, "Video re-encoding failed");
          reject(new Error(`Video re-encoding failed: ${error.message}`));
        })
        .save(outputPath);
    });
  }

  private async convertImageToVideo(imagePath: string, outputPath: string, durationSeconds: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Pad duration to ensure Remotion compositor can fetch the last frame without off-by-one
      const fps = 30;
      const paddedDuration = Math.ceil(durationSeconds * fps) / fps + 0.1;
      logger.debug({ imagePath, outputPath, durationSeconds, paddedDuration }, "Converting image to video");
      
      const ffmpeg = require('fluent-ffmpeg');
      
      // Create a video from static image with exact duration - optimized for Remotion
      ffmpeg(imagePath)
        .inputOptions([
          '-loop 1', // Loop the image
          `-t ${paddedDuration}` // Set duration with slight padding to avoid last-frame miss
        ])
        .videoCodec('libx264')
        .outputOptions([
          '-pix_fmt yuv420p', // Ensure compatibility
          `-r ${fps}`, // Constant FPS
          '-vf scale=1080:1920:flags=lanczos', // High quality scaling
          '-preset ultrafast', // Fast encoding
          '-crf 18', // High quality
          '-movflags +faststart', // Optimize for streaming
          // Do not use -shortest to avoid early cutoffs on some environments
        ])
        .format('mp4')
        .on('start', (commandLine: string) => {
          logger.debug({ commandLine }, "Image to video conversion started");
        })
        .on('progress', (progress: any) => {
          if (progress.percent) {
            logger.debug({ percent: Math.round(progress.percent) }, "Image to video conversion progress");
          }
        })
        .on('end', () => {
          logger.debug({ outputPath, durationSeconds }, "Image to video conversion completed");
          resolve();
        })
        .on('error', (error: any) => {
          logger.error({ error, imagePath, outputPath }, "Image to video conversion failed");
          reject(new Error(`Image to video conversion failed: ${error.message}`));
        })
        .save(outputPath);
    });
  }

    private async downloadPollinationsImage(imageUrl: string, outputPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      logger.debug({ imageUrl, outputPath }, "Downloading Pollinations AI image");

      const https = require('https');
      const fs = require('fs');

      const fileStream = fs.createWriteStream(outputPath);
      
      const makeRequest = (url: string, followRedirects: boolean = true) => {
        const request = https.get(url, (response: any) => {
          logger.debug({ statusCode: response.statusCode, url }, "Pollinations AI response");
          
          // Handle redirects
          if (response.statusCode === 301 || response.statusCode === 302) {
            if (followRedirects && response.headers.location) {
              logger.debug({ redirectTo: response.headers.location }, "Following redirect");
              makeRequest(response.headers.location, false);
              return;
            }
          }
          
          if (response.statusCode !== 200) {
            reject(new Error(`Failed to download image: ${response.statusCode} ${response.statusMessage}`));
            return;
          }

          response.pipe(fileStream);
          fileStream.on("finish", () => {
            fileStream.close();
            try {
              const stats = fs.statSync(outputPath);
              if (stats.size === 0) {
                reject(new Error("Downloaded image is empty"));
                return;
              }
              logger.debug({ outputPath, size: stats.size }, "Pollinations image downloaded successfully");
              resolve();
            } catch (statError) {
              reject(new Error(`Failed to validate downloaded image: ${statError}`));
            }
          });

          fileStream.on("error", (error: any) => {
            fs.unlink(outputPath, () => {});
            reject(error);
          });
        });

        request.setTimeout(120000, () => {
          request.destroy();
          fs.unlink(outputPath, () => {});
          reject(new Error("Download timeout after 120s"));
        });

        request.on("error", (error: any) => {
          fs.unlink(outputPath, () => {});
          reject(error);
        });
      };

      makeRequest(imageUrl);
    });
  }

  private async generateOpenAIImage(prompt: string, outputPath: string): Promise<void> {
    return withRetry(async () => {
      const apiKey = process.env.OPENAI_API_KEY as string;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY not set');
      }
      // OpenAI Images API compatible request
      const body = {
        model: 'gpt-image-1',
        prompt,
        size: '1024x1536', // portrait format for GPT-Image-1 (supported sizes: 1024x1024, 1024x1536, 1536x1024)
        quality: 'high' // GPT-Image-1 supports: auto, high, medium, low
      };
      const res = await axios.post('https://api.openai.com/v1/images/generations', body, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 180000, // 2 minutes timeout for GPT-Image-1
      });
      const b64 = res.data?.data?.[0]?.b64_json as string;
      if (!b64) throw new Error('OpenAI did not return image');
      const buffer = Buffer.from(b64, 'base64');
      fs.writeFileSync(outputPath, buffer);
      logger.debug({ outputPath, prompt }, 'OpenAI image saved');
    }, {
      maxAttempts: 3,
      delayMs: 2000,
      backoffMultiplier: 2,
      maxDelayMs: 10000,
      retryCondition: retryConditions.openai
    });
  }

  // Test helpers
  public async testGenerateImage(prompt: string): Promise<{ tmpFile: string }>{
    const tempId = cuid();
    const tempImageFileName = `${tempId}_test_image.png`;
    const tempImagePath = path.join(this.config.tempDirPath, tempImageFileName);
    const useOpenAI = !!process.env.OPENAI_API_KEY;
    const searchPrompt = prompt.replace(/\s+/g, ' ');
    if (useOpenAI) {
      try {
        await this.generateOpenAIImage(searchPrompt, tempImagePath);
      } catch (error) {
        logger.warn({ error }, 'OpenAI test image failed, falling back to Pollinations');
        const pollinationsImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(searchPrompt)}?width=768&height=1365&model=turbo&nologo=true`;
        await this.downloadPollinationsImage(pollinationsImageUrl, tempImagePath);
      }
    } else {
      const pollinationsImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(searchPrompt)}?width=768&height=1365&model=turbo&nologo=true`;
      await this.downloadPollinationsImage(pollinationsImageUrl, tempImagePath);
    }
    return { tmpFile: tempImageFileName };
  }

  public async testGenerateTTS(text: string, voice?: string): Promise<{ tmpMp3: string; duration: number }>{
    const { audio, audioLength } = await this.kokoro.generate(text, (voice as any) ?? VoiceEnum.af_heart);
    const tempId = cuid();
    const tempMp3FileName = `${tempId}_test_tts.mp3`;
    const tempMp3Path = path.join(this.config.tempDirPath, tempMp3FileName);
    await this.ffmpeg.saveToMp3(audio, tempMp3Path);
    return { tmpMp3: tempMp3FileName, duration: audioLength };
  }

  public async testAssembleImageAndAudio(tmpImage: string, durationSeconds: number): Promise<{ tmpVideo: string }>{
    const tempId = cuid();
    const tmpImagePath = path.join(this.config.tempDirPath, tmpImage);
    const tmpVideoFileName = `${tempId}_test_from_image.mp4`;
    const tmpVideoPath = path.join(this.config.tempDirPath, tmpVideoFileName);
    await this.convertImageToVideo(tmpImagePath, tmpVideoPath, durationSeconds);
    return { tmpVideo: tmpVideoFileName };
  }

  public async testElevenLabsTTS(text: string, voiceId: string): Promise<{ tmpMp3: string; duration: number }> {
    // Import ElevenLabsTTS directly for testing
    const { ElevenLabsTTS } = await import("./libraries/ElevenLabsTTS.js");
    
    if (!process.env.ELEVENLABS_API_KEY) {
      throw new Error("ELEVENLABS_API_KEY is not set");
    }
    
    const elevenLabs = new ElevenLabsTTS(process.env.ELEVENLABS_API_KEY);
    
    logger.debug({ text, voiceId }, "Testing ElevenLabs TTS with v3 model");
    
    const audio = await elevenLabs.synthesize({
      text,
      voiceId,
      modelId: "eleven_v3"
    });
    
    const tempId = cuid();
    const tempMp3FileName = `${tempId}_elevenlabs_test.mp3`;
    const tempMp3Path = path.join(this.config.tempDirPath, tempMp3FileName);
    
    // Save audio buffer directly to file
    await fs.writeFile(tempMp3Path, Buffer.from(audio));
    
    // Estimate duration (ElevenLabs returns MP3, estimate ~3kB/s for duration)
    const duration = audio.byteLength / 3000;
    
    logger.debug({ tempMp3FileName, duration, audioSize: audio.byteLength }, "ElevenLabs TTS test completed");
    
    return { tmpMp3: tempMp3FileName, duration };
  }

  private async createShortDevMode(
    videoId: string,
    inputScenes: SceneInput[],
    config: RenderConfig,
    skipCaptions?: boolean,
    questionVideoData?: {
      specs: string[];
      unknownSpec: string;
      answer: string;
      scene1Duration: number;
      scene2Duration: number;
    },
  ): Promise<string> {
    logger.debug({ videoId, sceneCount: inputScenes.length }, "Creating video in DEV_MODE using existing temp files");
    
    const scenes: Scene[] = [];
    let totalDuration = 0;
    const tempFiles = [];

    const orientation: OrientationEnum = config.orientation || OrientationEnum.portrait;

    // Get existing temp files
    const existingAudioFiles = await this.getExistingTempFiles('*.mp3');
    const existingImageFiles = await this.getExistingTempFiles('*.png');
    
    logger.debug({ 
      audioFiles: existingAudioFiles.length, 
      imageFiles: existingImageFiles.length 
    }, "Found existing temp files for DEV_MODE");

    for (let index = 0; index < inputScenes.length; index++) {
      // Use random existing audio file
      const randomAudioFile = existingAudioFiles[Math.floor(Math.random() * existingAudioFiles.length)];
      const randomImageFile = existingImageFiles[Math.floor(Math.random() * existingImageFiles.length)];
      
      // Calculate audio duration dynamically
      const audioDuration = await this.getAudioDuration(randomAudioFile);
      
      // Create video from existing image
      const tempVideoFileName = `${cuid()}.mp4`;
      const tempVideoPath = path.join(this.config.tempDirPath, tempVideoFileName);
      const tempVideoFromImagePath = tempVideoPath.replace('.mp4', '_from_image.mp4');
      
      await this.convertImageToVideo(randomImageFile, tempVideoFromImagePath, audioDuration);
      
      // Add to cleanup
      tempFiles.push(tempVideoFromImagePath);
      
      // Use local HTTP server for OffthreadVideo
      const videoUrl = `http://localhost:${this.config.port}/api/tmp/${tempVideoFileName.replace('.mp4', '_from_image.mp4')}`;
      const audioUrl = `http://localhost:${this.config.port}/api/tmp/${path.basename(randomAudioFile)}`;
      
      logger.debug({ 
        audioFile: path.basename(randomAudioFile),
        imageFile: path.basename(randomImageFile),
        duration: audioDuration,
        index 
      }, "Using existing temp files for scene");

      // Generate simple time-distributed captions from input text for DEV_MODE
      const devCaptions = this.generateNaiveCaptions(
        inputScenes[index]?.text || "",
        audioDuration,
      );

      scenes.push({
        captions: devCaptions,
        video: videoUrl,
        audio: {
          url: audioUrl,
          duration: audioDuration,
        },
      });

      totalDuration += audioDuration;
    }

    // Add padding to last scene if specified
    if (config.paddingBack) {
      totalDuration += config.paddingBack / 1000;
    }

    const selectedMusic = this.findMusic(totalDuration, config.music);
    logger.debug({ selectedMusic }, "Selected music for DEV_MODE video");

    await this.remotion.render(
      {
        music: selectedMusic,
        scenes,
        config: {
          durationMs: totalDuration * 1000,
          paddingBack: config.paddingBack,
          ...{
            captionBackgroundColor: config.captionBackgroundColor,
            captionPosition: config.captionPosition,
          },
          musicVolume: config.musicVolume,
        },
        questionVideoData,
      },
      videoId,
      orientation,
    );

    // Clean up temp files
    for (const file of tempFiles) {
      fs.removeSync(file);
    }

    logger.debug({ videoId, totalDuration }, "DEV_MODE video created successfully");
    return videoId;
  }

  // Create evenly distributed captions over the audio duration for DEV_MODE
  private generateNaiveCaptions(text: string, durationSeconds: number): Caption[] {
    const normalized = (text || "").replace(/\s+/g, " ").trim();
    if (!normalized) return [];
    const words = normalized.split(" ");
    const totalMs = Math.max(1, Math.round(durationSeconds * 1000));
    const perWordMs = Math.max(1, Math.floor(totalMs / words.length));

    const captions: Caption[] = [];
    let current = 0;
    for (let i = 0; i < words.length; i++) {
      const startMs = current;
      // Ensure last word ends exactly at totalMs
      const endMs = i === words.length - 1 ? totalMs : Math.min(totalMs, startMs + perWordMs);
      captions.push({ text: words[i], startMs, endMs });
      current = endMs;
    }
    return captions;
  }

  private async getExistingTempFiles(pattern: string): Promise<string[]> {
    const fs = require('fs');
    const glob = require('glob');
    
    try {
      const files = glob.sync(path.join(this.config.tempDirPath, pattern));
      return files.filter((file: string) => {
        // Filter out pollinations files and check if file exists
        const fileName = path.basename(file);
        return fs.existsSync(file) && !fileName.includes('pollinations');
      });
    } catch (error) {
      logger.warn({ error, pattern }, "Failed to get existing temp files");
      return [];
    }
  }

  private async getAudioDuration(audioPath: string): Promise<number> {
    try {
      const { execSync } = require('child_process');
      const ffprobeOutput = execSync(`ffprobe -v quiet -print_format json -show_format "${audioPath}"`, { encoding: 'utf8' });
      const metadata = JSON.parse(ffprobeOutput);
      return parseFloat(metadata.format.duration);
    } catch (error) {
      logger.warn({ error, audioPath }, "Failed to get audio duration, using default");
      return 10; // Default 10 seconds
    }
  }
}
