import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  Audio,
  OffthreadVideo,
} from "remotion";
import { z } from "zod";
import { loadFont } from "@remotion/google-fonts/BarlowCondensed";

import {
  calculateVolume,
  createCaptionPages,
  shortVideoSchema,
} from "../utils";

const { fontFamily } = loadFont(); // "Barlow Condensed"

export const PortraitVideo: React.FC<z.infer<typeof shortVideoSchema>> = ({
  scenes,
  music,
  config,
  questionVideoData,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const captionBackgroundColor = config.captionBackgroundColor ?? "blue";

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
          lineMaxLength: 20,
          lineCount: 1,
          maxDistanceMs: 1000,
        });

        // Calculate the start and end time of the scene
        const startFrame =
          scenes.slice(0, i).reduce((acc, curr) => {
            return acc + curr.audio.duration;
          }, 0) * fps;
        let durationInFrames =
          scenes.slice(0, i + 1).reduce((acc, curr) => {
            return acc + curr.audio.duration;
          }, 0) * fps;
        if (config.paddingBack && i === scenes.length - 1) {
          durationInFrames += (config.paddingBack / 1000) * fps;
        }

        return (
          <Sequence
            from={startFrame}
            durationInFrames={durationInFrames}
            key={`scene-${i}`}
          >
            <OffthreadVideo src={video} muted />
            <Audio src={audio.url} />
            
            {/* Show specs overlay on first scene (question) */}
            {i === 0 && questionVideoData && (
              <div
                style={{
                  position: "absolute",
                  top: 80,
                  left: 40,
                  right: 40,
                  backgroundColor: "rgba(0, 0, 0, 0.9)",
                  borderRadius: "25px",
                  padding: "40px",
                  color: "white",
                  fontFamily: fontFamily,
                }}
              >
                {questionVideoData.specs.map((spec, index) => (
                  <div
                    key={index}
                    style={{
                      fontSize: "4.5em",
                      fontWeight: "black",
                      marginBottom: "20px",
                      textAlign: "center",
                      textTransform: "uppercase",
                    }}
                  >
                    {spec}
                  </div>
                ))}
                
                {/* Unknown spec highlighted in red */}
                <div
                  style={{
                    fontSize: "6em",
                    fontWeight: "black",
                    marginTop: "30px",
                    textAlign: "center",
                    color: "#FF0000",
                    textTransform: "uppercase",
                  }}
                >
                  {questionVideoData.unknownSpec}: ???
                </div>
              </div>
            )}
            
            {/* Show answer overlay on second scene */}
            {i === 1 && questionVideoData && (
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: 40,
                  right: 40,
                  transform: "translateY(-50%)",
                  backgroundColor: "rgba(0, 0, 0, 0.9)",
                  borderRadius: "25px",
                  padding: "60px",
                  color: "white",
                  fontFamily: fontFamily,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: "5em",
                    fontWeight: "black",
                    marginBottom: "30px",
                    color: "#FFD700",
                    textTransform: "uppercase",
                  }}
                >
                  {questionVideoData.unknownSpec}:
                </div>
                <div
                  style={{
                    fontSize: "7em",
                    fontWeight: "black",
                    color: "#00FF00",
                    textTransform: "uppercase",
                  }}
                >
                  {questionVideoData.answer}
                </div>
              </div>
            )}
            
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
                            fontSize: "6em",
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
