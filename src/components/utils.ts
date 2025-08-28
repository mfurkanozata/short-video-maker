import { z } from "zod";
import {
  type Caption,
  type CaptionPage,
  type CaptionLine,
  type OrientationEnum,
  MusicVolumeEnum,
  type QuestionSpecs,
} from "../types/shorts";
import { AvailableComponentsEnum, type OrientationConfig } from "./types";

export const shortVideoSchema = z.object({
  scenes: z.array(
    z.object({
      captions: z.custom<Caption[]>(),
      audio: z.object({
        url: z.string(),
        duration: z.number(),
      }),
      video: z.string(),
    }),
  ),
  config: z.object({
    paddingBack: z.number().optional(),
    captionPosition: z.enum(["top", "center", "bottom"]).optional(),
    captionBackgroundColor: z.string().optional(),
    durationMs: z.number(),
    musicVolume: z.nativeEnum(MusicVolumeEnum).optional(),
  }),
  music: z.object({
    file: z.string(),
    url: z.string(),
    start: z.number(),
    end: z.number(),
  }),
  questionVideoData: z.object({
    specs: z.array(z.string()),
    unknownSpec: z.string(),
    answer: z.string(),
    scene1Duration: z.number(),
    scene2Duration: z.number(),
  }).optional(),
});

export function createCaptionPages({
  captions,
  lineMaxLength,
  lineCount,
  maxDistanceMs,
}: {
  captions: Caption[];
  lineMaxLength: number;
  lineCount: number;
  maxDistanceMs: number;
}) {
  const pages = [];
  let currentPage: CaptionPage = {
    startMs: 0,
    endMs: 0,
    lines: [],
  };
  let currentLine: CaptionLine = {
    texts: [],
  };

  captions.forEach((caption, i) => {
    // Check if we need to start a new page due to time gap
    if (i > 0 && caption.startMs - currentPage.endMs > maxDistanceMs) {
      // Add current line if not empty
      if (currentLine.texts.length > 0) {
        currentPage.lines.push(currentLine);
      }
      // Add current page if not empty
      if (currentPage.lines.length > 0) {
        pages.push(currentPage);
      }
      // Start new page
      currentPage = {
        startMs: caption.startMs,
        endMs: caption.endMs,
        lines: [],
      };
      currentLine = {
        texts: [],
      };
    }

    // Check if adding this caption exceeds the line length
    const currentLineText = currentLine.texts.map((t) => t.text).join(" ");
    if (
      currentLine.texts.length > 0 &&
      currentLineText.length + 1 + caption.text.length > lineMaxLength
    ) {
      // Line is full, add it to current page
      currentPage.lines.push(currentLine);
      currentLine = {
        texts: [],
      };

      // Check if page is full
      if (currentPage.lines.length >= lineCount) {
        // Page is full, add it to pages
        pages.push(currentPage);
        // Start new page
        currentPage = {
          startMs: caption.startMs,
          endMs: caption.endMs,
          lines: [],
        };
      }
    }

    // Add caption to current line
    currentLine.texts.push({
      text: caption.text,
      startMs: caption.startMs,
      endMs: caption.endMs,
    });

    // Update page timing
    currentPage.endMs = caption.endMs;
    if (i === 0 || currentPage.startMs === 0) {
      currentPage.startMs = caption.startMs;
    } else {
      currentPage.startMs = Math.min(currentPage.startMs, caption.startMs);
    }
  });

  // Don't forget to add the last line and page
  if (currentLine.texts.length > 0) {
    currentPage.lines.push(currentLine);
  }
  if (currentPage.lines.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}

export function getOrientationConfig(orientation: OrientationEnum) {
  const config: Record<OrientationEnum, OrientationConfig> = {
    portrait: {
      width: 1080,
      height: 1920,
      component: AvailableComponentsEnum.PortraitVideo,
    },
    landscape: {
      width: 1920,
      height: 1080,
      component: AvailableComponentsEnum.LandscapeVideo,
    },
  };

  return config[orientation];
}

export function calculateVolume(
  level: MusicVolumeEnum = MusicVolumeEnum.high,
): [number, boolean] {
  switch (level) {
    case "muted":
      return [0, true];
    case "low":
      return [0.2, false];
    case "medium":
      return [0.45, false];
    case "high":
      return [0.7, false];
    default:
      return [0.7, false];
  }
}
