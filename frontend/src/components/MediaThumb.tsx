import React, { useEffect, useState } from "react";
import { Platform, StyleProp, View, ImageStyle } from "react-native";
import { Image } from "expo-image";
import { mediaSource } from "@/src/api";
import { makeVideoThumb } from "@/src/videoThumb";

const generated = new Map<string, string | null>();

// Preview for a chat/gallery tile: the image itself, or a still frame for videos.
export function MediaThumb({
  mediaPath,
  thumbPath,
  mediaType,
  blurred,
  style,
  testID,
}: {
  mediaPath: string;
  thumbPath?: string | null;
  mediaType?: string;
  blurred?: boolean;
  style: StyleProp<ImageStyle>;
  testID?: string;
}) {
  const isVideo = mediaType === "video";
  const [local, setLocal] = useState<string | null>(
    () => generated.get(mediaPath) ?? null,
  );

  // Older videos have no stored thumbnail, so grab a frame on the device.
  useEffect(() => {
    if (!isVideo || thumbPath || generated.has(mediaPath)) return;
    let alive = true;
    const src = mediaSource(mediaPath) as { uri: string; headers?: Record<string, string> };
    makeVideoThumb(src.uri, src.headers).then((t) => {
      generated.set(mediaPath, t);
      if (alive) setLocal(t);
    });
    return () => {
      alive = false;
    };
  }, [isVideo, thumbPath, mediaPath]);

  const source = !isVideo
    ? mediaSource(mediaPath)
    : thumbPath
    ? mediaSource(thumbPath)
    : local
    ? { uri: local }
    : null;

  if (!source) return <View style={style as any} testID={testID} />;

  return (
    <Image
      source={source}
      style={style}
      contentFit="cover"
      transition={200}
      blurRadius={blurred ? (Platform.OS === "web" ? 30 : 60) : 0}
      testID={testID}
    />
  );
}
