import { OrientationEnum } from "./../types/shorts";
/* eslint-disable @remotion/deterministic-randomness */
import fs from "fs-extra";
import cuid from "cuid";
import path from "path";
import https from "https";
import http from "http";

import { Kokoro } from "./libraries/Kokoro";
import { Remotion } from "./libraries/Remotion";
import { FasterWhisper } from "./libraries/FasterWhisper";
import { FFMpeg } from "./libraries/FFmpeg";
import { PexelsAPI } from "./libraries/Pexels";
import { Config } from "../config";
import { logger } from "../logger";
import { MusicManager } from "./music";
import type {
  SceneInput,
  RenderConfig,
  Scene,
  VideoStatus,
  MusicMoodEnum,
  MusicTag,
  MusicForVideo,
} from "../types/shorts";

export class ShortCreator {
  private queue: {
    sceneInput: SceneInput[];
    config: RenderConfig;
    id: string;
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
    const { sceneInput, config, id } = this.queue[0];
    logger.debug(
      { sceneInput, config, id },
      "Processing video item in the queue",
    );
    try {
      await this.createShort(id, sceneInput, config);
      logger.debug({ id }, "Video created successfully");
    } catch (error: unknown) {
      logger.error(error, "Error creating video");
    } finally {
      this.queue.shift();
      this.processQueue();
    }
  }

  private async createShort(
    videoId: string,
    inputScenes: SceneInput[],
    config: RenderConfig,
  ): Promise<string> {
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

      // add the paddingBack in seconds to the last scene
      if (index + 1 === inputScenes.length && config.paddingBack) {
        audioLength += config.paddingBack / 1000;
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
      const captions = await this.whisper.CreateCaption(tempWavPath, scene.text);

      await this.ffmpeg.saveToMp3(audioStream, tempMp3Path);
      // Use Pollinations AI for dynamic image generation
      const searchPrompt = scene.searchTerms.join(" ").replace(/\s+/g, "");
      const pollinationsImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(searchPrompt)}`;
      
      // Download Pollinations image and convert to video
      const tempImagePath = tempVideoPath.replace('.mp4', '_pollinations.png');
      await this.downloadPollinationsImage(pollinationsImageUrl, tempImagePath);
      
      const tempVideoFromImagePath = tempVideoPath.replace('.mp4', '_from_image.mp4');
      await this.convertImageToVideo(tempImagePath, tempVideoFromImagePath, audioLength);
      
      // Use local HTTP server for OffthreadVideo - Remotion only accepts http/https
      const videoUrl = `http://localhost:${this.config.port}/api/tmp/${tempVideoFileName.replace('.mp4', '_from_image.mp4')}`;
      
      logger.debug({ 
        searchTerms: scene.searchTerms, 
        pollinationsUrl: pollinationsImageUrl,
        duration: audioLength,
        outputPath: tempVideoFromImagePath 
      }, "Created video from Pollinations AI image");

      scenes.push({
        captions,
        video: videoUrl,
        audio: {
          url: `http://localhost:${this.config.port}/api/tmp/${tempMp3FileName}`,
          duration: audioLength,
        },
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

  private findMusic(videoDuration: number, tag?: MusicMoodEnum): MusicForVideo {
    const musicFiles = this.musicManager.musicList().filter((music) => {
      if (tag) {
        return music.mood === tag;
      }
      return true;
    });
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
      logger.debug({ imagePath, outputPath, durationSeconds }, "Converting image to video");
      
      const ffmpeg = require('fluent-ffmpeg');
      
      // Create a video from static image with exact duration - optimized for Remotion
      ffmpeg(imagePath)
        .inputOptions([
          '-loop 1', // Loop the image
          `-t ${durationSeconds}` // Set exact duration
        ])
        .videoCodec('libx264')
        .outputOptions([
          '-pix_fmt yuv420p', // Ensure compatibility
          '-r 30', // 30 FPS for smoother playback
          '-vf scale=1080:1920:flags=lanczos', // High quality scaling
          '-preset ultrafast', // Fast encoding
          '-crf 18', // High quality
          '-movflags +faststart', // Optimize for streaming
          '-shortest' // End when duration is reached
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
      const request = https.get(imageUrl, (response: any) => {
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
      
      request.setTimeout(30000, () => {
        request.destroy();
        fs.unlink(outputPath, () => {});
        reject(new Error("Download timeout after 30s"));
      });
      
      request.on("error", (error: any) => {
        fs.unlink(outputPath, () => {});
        reject(error);
      });
    });
  }
}
