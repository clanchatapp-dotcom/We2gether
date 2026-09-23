import React, { useState, useCallback } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  useWindowDimensions,
  FlatList,
  Platform,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import Feather from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ScreenCapture from "expo-screen-capture";

import { makeStyles, spacing, useTheme } from "@/src/theme";
import { api, mediaSource, mediaVideoUri } from "@/src/api";
import { haptic } from "@/src/haptics";

// Key used to scope preventScreenCaptureAsync/allowScreenCaptureAsync calls
// to this component, so it never clobbers screen-capture state some other
// screen may be managing.
const CAPTURE_KEY = "media-viewer-protected";

function isProtected(item?: ViewerItem | null) {
  return !!item && (item.privacy === "no_save" || item.privacy === "one_time");
}

export type ViewerItem = {
  id: string;
  media_path: string;
  media_type?: string;
  privacy?: string;
};

const AImage = Animated.createAnimatedComponent(Image);

function ZoomableImage({
  item,
  width,
  height,
  onZoomChange,
}: {
  item: ViewerItem;
  width: number;
  height: number;
  onZoomChange: (z: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);

  const setZoom = useCallback((z: boolean) => onZoomChange(z), [onZoomChange]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, savedScale.value * e.scale);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.02) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedScale.value = 1;
        runOnJS(setZoom)(false);
      } else {
        runOnJS(setZoom)(true);
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        tx.value = sx.value + e.translationX;
        ty.value = sy.value + e.translationY;
      }
    })
    .onEnd(() => {
      sx.value = tx.value;
      sy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedScale.value = 1;
        runOnJS(setZoom)(false);
      } else {
        scale.value = withTiming(2.5);
        savedScale.value = 2.5;
        runOnJS(setZoom)(true);
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const aStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={{ width, height, justifyContent: "center", alignItems: "center" }}>
        <AImage
          source={mediaSource(item.media_path)}
          style={[{ width, height }, aStyle]}
          contentFit="contain"
          testID={`viewer-image-${item.id}`}
        />
      </Animated.View>
    </GestureDetector>
  );
}

function VideoPage({ item, width, height, active }: { item: ViewerItem; width: number; height: number; active: boolean }) {
  const player = useVideoPlayer(mediaVideoUri(item.media_path), (p) => {
    p.loop = true;
  });
  React.useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);
  return <VideoView style={{ width, height }} player={player} contentFit="contain" nativeControls />;
}

export function MediaViewer({
  visible,
  items,
  initialIndex,
  onClose,
}: {
  visible: boolean;
  items: ViewerItem[];
  initialIndex: number;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const [index, setIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  React.useEffect(() => {
    if (visible) {
      setIndex(initialIndex);
      setZoomed(false);
    }
  }, [visible, initialIndex]);

  const current = items[index];
  const protectedItem = isProtected(current);
  const canSave =
    current && current.privacy !== "no_save" && current.privacy !== "one_time" && Platform.OS !== "web";

  // Block OS-level screenshots/recordings (fully effective on Android via
  // FLAG_SECURE; iOS has no way to block the shutter, so we detect it below
  // instead). Re-evaluated whenever the visible item's protection changes,
  // and always released when the viewer closes or unmounts.
  React.useEffect(() => {
    if (Platform.OS === "web") return;
    if (visible && protectedItem) {
      ScreenCapture.preventScreenCaptureAsync(CAPTURE_KEY).catch(() => {});
    } else {
      ScreenCapture.allowScreenCaptureAsync(CAPTURE_KEY).catch(() => {});
    }
    return () => {
      ScreenCapture.allowScreenCaptureAsync(CAPTURE_KEY).catch(() => {});
    };
  }, [visible, protectedItem]);

  // iOS (and any Android device where FLAG_SECURE gets bypassed) can still
  // take a screenshot — we can't stop it, so at least let the sender know,
  // the way Snapchat does, and tell the viewer we noticed.
  React.useEffect(() => {
    if (!visible || Platform.OS === "web") return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    // Older Android needs a storage-read permission to fire the screenshot
    // callback at all; iOS always reports granted. Never blocks rendering.
    ScreenCapture.requestPermissionsAsync()
      .catch(() => ({ granted: false }))
      .then((perm) => {
        if (cancelled || !perm.granted) return;
        sub = ScreenCapture.addScreenshotListener(() => {
          if (!protectedItem || !current) return;
          haptic.warning();
          // Notify the sender (best-effort), then give the viewer an
          // unmissable, blocking confirmation that their partner was told.
          api.post(`/messages/${current.id}/screenshot`, {}).catch(() => {});
          Alert.alert(
            "Screenshot detected",
            "Your partner has been notified that you took a screenshot of their protected photo.",
            [{ text: "OK", style: "default" }],
            { cancelable: false },
          );
        });
      });
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [visible, protectedItem, current]);

  const onSave = useCallback(async () => {
    if (!current || saving) return;
    setSaving(true);
    try {
      const MediaLibrary = require("expo-media-library");
      const FileSystem = require("expo-file-system/legacy");
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        setToast("Photos permission needed to save");
        setSaving(false);
        return;
      }
      const target = `${FileSystem.cacheDirectory}${current.id}.${current.media_type === "video" ? "mp4" : "jpg"}`;
      const src = mediaSource(current.media_path) as any;
      const dl = await FileSystem.downloadAsync(src.uri, target, {
        headers: src.headers || {},
      });
      await MediaLibrary.saveToLibraryAsync(dl.uri);
      haptic.success();
      setToast("Saved to your device");
    } catch {
      setToast("Could not save");
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 1800);
    }
  }, [current, saving]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <FlatList
          data={items}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          showsHorizontalScrollIndicator={false}
          keyExtractor={(it) => it.id}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / width);
            setIndex(i);
            setZoomed(false);
          }}
          renderItem={({ item, index: i }) =>
            item.media_type === "video" ? (
              <VideoPage item={item} width={width} height={height} active={i === index} />
            ) : (
              <ZoomableImage item={item} width={width} height={height} onZoomChange={setZoomed} />
            )
          }
        />

        <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable style={styles.iconBtn} onPress={onClose} testID="viewer-close">
            <Feather name="x" size={24} color={colors.onSurfaceInverse} />
          </Pressable>
          <Text style={styles.counter}>
            {items.length > 1 ? `${index + 1} / ${items.length}` : ""}
          </Text>
          {canSave ? (
            <Pressable style={styles.iconBtn} onPress={onSave} testID="viewer-save">
              <Feather name={saving ? "loader" : "download"} size={22} color={colors.onSurfaceInverse} />
            </Pressable>
          ) : (
            <View style={styles.iconBtn}>
              {current?.privacy === "no_save" ? (
                <Feather name="lock" size={20} color={colors.onSurfaceInverse} />
              ) : null}
            </View>
          )}
        </View>

        {current?.privacy === "no_save" ? (
          <View style={[styles.badge, { bottom: insets.bottom + spacing.xl }]}>
            <Feather name="lock" size={13} color={colors.onSurfaceInverse} />
            <Text style={styles.badgeText}>Saving disabled by sender</Text>
          </View>
        ) : null}

        {toast ? (
          <View style={[styles.toast, { bottom: insets.bottom + spacing.xl }]}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: "#000000" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  counter: { color: "#FFFFFF", fontFamily: "Nunito", fontSize: 15 },
  badge: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
  },
  badgeText: { color: "#FFFFFF", fontFamily: "Nunito", fontSize: 13 },
  toast: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: c.surfaceInverse,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 999,
  },
  toastText: { color: c.onSurfaceInverse, fontFamily: "Nunito", fontSize: 14 },
}));
