import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  Audio,
  OffthreadVideo,
  interpolate,
  Loop,
} from "remotion";
import { z } from "zod";
import "./fonts.css";

import {
  calculateVolume,
  createCaptionPages,
  shortVideoSchema,
} from "../utils";

const fontFamily = "'Wix Madefor Display'";

export const LandscapeVideo: React.FC<z.infer<typeof shortVideoSchema>> = ({
  scenes,
  music,
  config,
  questionVideoData,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const captionBackgroundColor = config.captionBackgroundColor ?? "#FFFF00";

  const activeStyle = {
    backgroundColor: captionBackgroundColor,
    padding: "10px",
    marginLeft: "-10px",
    marginRight: "-10px",
    borderRadius: "10px",
  };

  const captionPosition = config.captionPosition ?? "center";
  let captionStyle = {};
  if (captionPosition === "top") {
    captionStyle = { top: 100 };
  }
  if (captionPosition === "center") {
    captionStyle = { top: "50%", transform: "translateY(-50%)" };
  }
  if (captionPosition === "bottom") {
    captionStyle = { bottom: 100 };
  }

  const [musicVolume, musicMuted] = calculateVolume(config.musicVolume);

  return (
    <AbsoluteFill style={{ backgroundColor: "white" }}>
      <Audio
        loop
        src={music.url}
        startFrom={music.start * fps}
        endAt={music.end * fps}
        volume={() => musicVolume}
        muted={musicMuted}
      />

      {scenes.map((scene, i) => {
        const { captions, audio, video } = scene;
        const pages = createCaptionPages({
          captions,
          lineMaxLength: 30,
          lineCount: 1,
          maxDistanceMs: 1000,
        });

        // Calculate the start and end time of the scene
        const startFrame =
          scenes.slice(0, i).reduce((acc, curr) => {
            return acc + curr.audio.duration;
          }, 0) * fps;
        // Duration should be only this scene's audio duration (plus padding on last scene)
        let durationInFrames = Math.round(scene.audio.duration * fps);
        if (config.paddingBack && i === scenes.length - 1) {
          durationInFrames += Math.round((config.paddingBack / 1000) * fps);
        }

        // Local frame inside this scene to reset animations per scene
        const localFrame = Math.max(
          0,
          Math.min(frame - startFrame, durationInFrames),
        );

        // Slow zoom-in (Ken Burns) for the background video across the scene
        const scale = interpolate(
          localFrame,
          [0, Math.max(1, Math.round(durationInFrames * 0.6))],
          [1, 1.12],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );

        return (
          <Sequence
            from={startFrame}
            durationInFrames={durationInFrames}
            key={`scene-${i}`}
          >
            <Loop durationInFrames={durationInFrames}>
              <OffthreadVideo
                src={video}
                muted
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  transform: `scale(${scale})`,
                  transformOrigin: "50% 50%",
                }}
              />
            </Loop>
            <Audio src={audio.url} />
            {/* SFX removed */}
            

            
            {pages.map((page, j) => {
              return (
                <Sequence
                  key={`scene-${i}-page-${j}`}
                  from={Math.round((page.startMs / 1000) * fps)}
                  durationInFrames={Math.round(
                    ((page.endMs - page.startMs) / 1000) * fps,
                  )}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      width: "100%",
                      ...captionStyle,
                    }}
                  >
                    {page.lines.map((line, k) => {
                      return (
                        <p
                          style={{
                            fontSize: "8em",
                            fontFamily: fontFamily,
                            fontWeight: "black",
                            color: "white",
                            WebkitTextStroke: "2px black",
                            WebkitTextFillColor: "white",
                            textShadow: "0px 0px 10px black",
                            textAlign: "center",
                            width: "100%",
                            // uppercase
                            textTransform: "uppercase",
                          }}
                          key={`scene-${i}-page-${j}-line-${k}`}
                        >
                          {line.texts.map((text, l) => {
                            const active =
                              frame >=
                                startFrame + (text.startMs / 1000) * fps &&
                              frame <= startFrame + (text.endMs / 1000) * fps;
                            return (
                              <>
                                <span
                                  style={{
                                    fontWeight: "bold",
                                    ...(active ? activeStyle : {}),
                                  }}
                                  key={`scene-${i}-page-${j}-line-${k}-text-${l}`}
                                >
                                  {text.text}
                                </span>
                                {l < line.texts.length - 1 ? " " : ""}
                              </>
                            );
                          })}
                        </p>
                      );
                    })}
                  </div>
                </Sequence>
              );
            })}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
