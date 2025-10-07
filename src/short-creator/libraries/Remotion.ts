import z from "zod";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import { ensureBrowser } from "@remotion/renderer";

import { Config as AppConfig } from "../../config";
import { shortVideoSchema } from "../../components/utils";
import { logger } from "../../logger";
import { withRetry, retryConditions } from "../../utils/retry";
import { OrientationEnum } from "../../types/shorts";
import { getOrientationConfig } from "../../components/utils";

export class Remotion {
  constructor(
    private bundled: string,
    private config: AppConfig,
  ) {}

  static async init(config: AppConfig): Promise<Remotion> {
    await ensureBrowser();

    logger.debug({ devMode: config.devMode, packageDirPath: config.packageDirPath }, "Remotion init - checking paths");
    
    const entryPoint = path.join(
      config.packageDirPath,
      "dist", // Always use dist in production container
      "components",
      "root",
      "index.js",
    );
    
    logger.debug({ entryPoint, devMode: config.devMode }, "Remotion entry point");

    const bundled = await bundle({
      entryPoint,
      webpackOverride: (webpackConfig) => {
        webpackConfig.resolve = webpackConfig.resolve || {};
        webpackConfig.resolve.alias = {
          ...webpackConfig.resolve.alias,
          "@": path.join(config.packageDirPath, "dist"), // Always use dist in production container
        };
        return webpackConfig;
      },
    });

    return new Remotion(bundled, config);
  }

  async render(
    data: z.infer<typeof shortVideoSchema>,
    id: string,
    orientation: OrientationEnum,
  ) {
    return withRetry(async () => {
      const { component } = getOrientationConfig(orientation);

      const composition = await selectComposition({
        serveUrl: this.bundled,
        id: component,
        inputProps: data,
      });

      logger.debug({ component, videoID: id }, "Rendering video with Remotion");

      const outputLocation = path.join(this.config.videosDirPath, `${id}.mp4`);

      await renderMedia({
        codec: "h264",
        composition,
        serveUrl: this.bundled,
        outputLocation,
        inputProps: data,
        onProgress: ({ progress }) => {
          logger.debug(`Rendering ${id} ${Math.floor(progress * 100)}% complete`);
        },
        // preventing memory issues with docker
        concurrency: this.config.concurrency,
        offthreadVideoCacheSizeInBytes: this.config.videoCacheSizeInBytes,
      });

      logger.debug(
        {
          outputLocation,
          component,
          videoID: id,
        },
        "Video rendered with Remotion",
      );
    }, {
      maxAttempts: 3, // More robust retries for transient render failures
      delayMs: 5000,
      backoffMultiplier: 2,
      maxDelayMs: 60000,
      retryCondition: retryConditions.video
    });
  }

  async testRender(outputLocation: string) {
    const composition = await selectComposition({
      serveUrl: this.bundled,
      id: "TestVideo",
    });

    await renderMedia({
      codec: "h264",
      composition,
      serveUrl: this.bundled,
      outputLocation,
      onProgress: ({ progress }) => {
        logger.debug(
          `Rendering test video: ${Math.floor(progress * 100)}% complete`,
        );
      },
      // preventing memory issues with docker
      concurrency: this.config.concurrency,
      offthreadVideoCacheSizeInBytes: this.config.videoCacheSizeInBytes,
    });
  }
}
