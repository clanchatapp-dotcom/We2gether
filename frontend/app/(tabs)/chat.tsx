import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Linking,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import Feather from "@react-native-vector-icons/feather";

import { api, mediaSource } from "@/src/api";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { usesNativeTabs } from "@/src/navigation";
import { formatUkTime } from "@/src/ukTime";
import { haptic } from "@/src/haptics";
import { useToast } from "@/src/components/Toast";
import { MediaViewer, ViewerItem } from "@/src/components/MediaViewer";

type Message = {
  id: string;
  type: string;
  text?: string;
  is_mine: boolean;
  sender_name?: string;
  privacy: string;
  media_path?: string;
  media_type?: string;
  one_time: boolean;
  consumed: boolean;
  can_open: boolean;
  read_at?: string | null;
  gif_url?: string;
  gif_title?: string;
};

type GifResult = {
  id: string;
  title?: string;
  images?: {
    fixed_width?: { url?: string; webp?: string };
    fixed_width_small?: { url?: string; webp?: string };
  };
};

const PRIVACY_OPTIONS = [
  { key: "none", label: "Normal" },
  { key: "no_save", label: "No saving" },
  { key: "one_time", label: "View once" },
];

export default function Chat() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const toast = useToast();
  const listRef = useRef<FlatList<Message>>(null);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [privacy, setPrivacy] = useState("none");
  const [gifOpen, setGifOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<GifResult[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [viewer, setViewer] = useState<{ items: ViewerItem[]; index: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const giphyKey = process.env.EXPO_PUBLIC_GIPHY_API_KEY?.trim() || "";

  const partnerQuery = useQuery({ queryKey: ["me"], queryFn: () => api.get("/couples/me") });
  const messagesQuery = useQuery<Message[]>({
    queryKey: ["messages"],
    queryFn: () => api.get("/messages"),
    refetchInterval: 4000,
  });
  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);
  const lastReadId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].is_mine && messages[i].read_at) return messages[i].id;
    }
    return null;
  }, [messages]);
  const regularMedia = useMemo(
    () => messages.filter(message => message.type === "media" && !message.one_time && message.media_path),
    [messages],
  );

  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => setAppActive(state === "active"));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!focused || !appActive || !messages.some(message => !message.is_mine && !message.read_at)) return;
    const last = messages[messages.length - 1];
    if (!last) return;
    api.post("/messages/read", { through_id: last.id })
      .then(() => queryClient.invalidateQueries({ queryKey: ["messages"] }))
      .catch(() => {});
  }, [focused, appActive, messages, queryClient]);

  const send = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setText("");
    setSending(true);
    haptic.light();
    try {
      await api.post("/messages/text", { text: value });
      await queryClient.invalidateQueries({ queryKey: ["messages"] });
    } catch {
      setText(value);
      toast.show("Message failed to send");
    } finally {
      setSending(false);
    }
  };

  const sendGif = async (gif: GifResult) => {
    const gifUrl = gif.images?.fixed_width?.url || gif.images?.fixed_width_small?.url;
    const previewUrl = gif.images?.fixed_width?.webp || gif.images?.fixed_width_small?.webp || gifUrl;
    if (!gifUrl) {
      toast.show("That GIF is unavailable");
      return;
    }
    setSending(true);
    try {
      await api.post("/messages/gif", {
        gif_id: gif.id,
        gif_url: gifUrl,
        preview_url: previewUrl,
        title: gif.title || "",
      });
      setGifOpen(false);
      setGifQuery("");
      await queryClient.invalidateQueries({ queryKey: ["messages"] });
      haptic.success();
    } catch (error: any) {
      toast.show(error?.message || "GIF failed to send");
    } finally {
      setSending(false);
    }
  };

  const loadGifs = async (query = "") => {
    if (!giphyKey) {
      toast.show("GIPHY is not configured in this build");
      return;
    }
    setGifLoading(true);
    try {
      const endpoint = query.trim()
        ? "https://api.giphy.com/v1/gifs/search"
        : "https://api.giphy.com/v1/gifs/trending";
      const params = new URLSearchParams({ api_key: giphyKey, limit: "24", rating: "g", bundle: "messaging_non_clips" });
      if (query.trim()) params.set("q", query.trim().slice(0, 50));
      const response = await fetch(`${endpoint}?${params.toString()}`);
      if (!response.ok) throw new Error(`GIPHY request failed (${response.status})`);
      const json = await response.json();
      setGifResults(Array.isArray(json?.data) ? json.data : []);
    } catch (error: any) {
      setGifResults([]);
      toast.show(error?.message || "Could not load GIFs");
    } finally {
      setGifLoading(false);
    }
  };

  const openGifs = () => {
    haptic.light();
    setGifOpen(open => {
      if (!open && gifResults.length === 0) void loadGifs();
      return !open;
    });
  };

  const pickAndSend = async (mediaType: "image" | "video", useCamera = false) => {
    setAttachOpen(false);
    const permission = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      if (!permission.canAskAgain) {
        toast.show(`Enable ${useCamera ? "camera" : "photo"} access in Settings`);
        Linking.openSettings();
      } else {
        toast.show(`${useCamera ? "Camera" : "Photo library"} access is needed to share`);
      }
      return;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: mediaType === "image" ? ["images"] : ["videos"],
      quality: 0.8,
      videoMaxDuration: 60,
    };
    const result = useCamera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.length) return;
    setSending(true);
    try {
      await api.uploadMedia(result.assets[0].uri, mediaType, privacy);
      setPrivacy("none");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages"] }),
        queryClient.invalidateQueries({ queryKey: ["gallery"] }),
      ]);
      haptic.success();
    } catch (error: any) {
      toast.show(error?.message || "Could not send media");
    } finally {
      setSending(false);
    }
  };

  const openMedia = async (message: Message) => {
    if (!message.media_path) return;
    if (message.one_time) {
      if (message.is_mine) return;
      if (message.consumed || !message.can_open) {
        toast.show("This one-time photo is gone");
        return;
      }
      try {
        await api.post(`/messages/${message.id}/open`, {});
        setViewer({
          items: [{ id: message.id, media_path: message.media_path, media_type: message.media_type, privacy: "one_time" }],
          index: 0,
        });
      } catch {
        toast.show("This one-time photo is gone");
        queryClient.invalidateQueries({ queryKey: ["messages"] });
      }
      return;
    }
    const items = regularMedia.map(item => ({
      id: item.id,
      media_path: item.media_path!,
      media_type: item.media_type,
      privacy: item.privacy,
    }));
    const index = items.findIndex(item => item.id === message.id);
    setViewer({ items, index: Math.max(0, index) });
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const mine = item.is_mine;
    const readLabel = mine && item.id === lastReadId && item.read_at
      ? <Text style={styles.readReceipt}>Read {formatUkTime(item.read_at)}</Text>
      : null;
    return (
      <View style={[styles.messageRow, mine ? styles.mineRow : styles.partnerRow]}>
        {item.type === "text" ? (
          <View style={[styles.bubble, mine ? styles.mineBubble : styles.partnerBubble]}>
            <Text style={[styles.messageText, mine ? styles.mineText : styles.partnerText]}>{item.text}</Text>
          </View>
        ) : item.type === "gif" || item.gif_url ? (
          <View style={[styles.gifBubble, mine ? styles.mineBubble : styles.partnerBubble]}>
            {item.gif_url ? <Image source={{ uri: item.gif_url }} style={styles.gifMessageImage} contentFit="cover" /> : null}
            <Text style={styles.gifAttribution}>GIF · GIPHY</Text>
          </View>
        ) : item.media_path ? (
          <Pressable onPress={() => void openMedia(item)} testID={`media-${item.id}`}>
            <Image source={mediaSource(item.media_path)} style={styles.media} contentFit="cover" />
            {item.media_type === "video" ? <View style={styles.playOverlay}><Feather name="play" size={26} color="#FFFFFF" /></View> : null}
            {item.one_time ? (
              <View style={styles.mediaLabel}>
                <Feather name={item.consumed ? "eye-off" : "eye"} size={14} color="#FFFFFF" />
                <Text style={styles.mediaLabelText}>{item.is_mine ? (item.consumed ? "Viewed once" : "One-time photo sent") : (item.consumed ? "Opened · gone" : "Tap to view once")}</Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
        {readLabel}
      </View>
    );
  };

  const partnerName = partnerQuery.data?.partner?.name || "Your partner";
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{partnerName.charAt(0).toUpperCase()}</Text></View>
        <View>
          <Text style={styles.partnerName}>{partnerName}</Text>
          <Text style={styles.headerSub}>{partnerQuery.data?.partner ? "just the two of you" : "waiting to connect"}</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior="translate-with-padding" keyboardVerticalOffset={0}>
        {messagesQuery.isLoading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : messages.length === 0 ? (
          <View style={styles.center}>
            <Feather name="message-circle" size={40} color={colors.brandSecondary} />
            <Text style={styles.emptyTitle}>Say hello 👋</Text>
            <Text style={styles.emptySub}>Your private conversation starts here.</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            style={styles.flex}
            data={messages}
            keyExtractor={message => message.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
          />
        )}

        {gifOpen ? (
          <View style={styles.gifPanel}>
            <View style={styles.gifHeader}>
              <Text style={styles.gifTitle}>GIFs</Text>
              <Text style={styles.gifPowered}>Powered by GIPHY</Text>
              <Pressable onPress={() => setGifOpen(false)} hitSlop={8}><Feather name="x" size={20} color={colors.onSurfaceSecondary} /></Pressable>
            </View>
            <View style={styles.gifSearchRow}>
              <TextInput
                value={gifQuery}
                onChangeText={setGifQuery}
                onSubmitEditing={() => void loadGifs(gifQuery)}
                placeholder="Search GIFs..."
                placeholderTextColor={colors.muted}
                style={styles.gifSearchInput}
                returnKeyType="search"
              />
              <Pressable style={styles.gifSearchButton} onPress={() => void loadGifs(gifQuery)} disabled={gifLoading}>
                <Feather name="search" size={17} color={colors.onBrandPrimary} />
              </Pressable>
            </View>
            {gifLoading ? (
              <View style={styles.gifLoading}><ActivityIndicator color={colors.brandPrimary} /></View>
            ) : gifResults.length ? (
              <FlatList
                data={gifResults}
                keyExtractor={gif => gif.id}
                numColumns={3}
                style={styles.gifGrid}
                contentContainerStyle={styles.gifGridContent}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item: gif }) => {
                  const uri = gif.images?.fixed_width_small?.webp || gif.images?.fixed_width?.webp || gif.images?.fixed_width_small?.url || gif.images?.fixed_width?.url;
                  return uri ? <Pressable style={styles.gifTile} onPress={() => void sendGif(gif)} disabled={sending}><Image source={{ uri }} style={styles.gifTileImage} contentFit="cover" /></Pressable> : null;
                }}
              />
            ) : (
              <View style={styles.gifEmpty}><Text style={styles.gifEmptyText}>{giphyKey ? "No GIFs found" : "GIPHY is not configured"}</Text></View>
            )}
          </View>
        ) : null}

        <View style={[styles.composer, { paddingBottom: usesNativeTabs ? insets.bottom : spacing.sm }]}>
          <Pressable style={styles.attachButton} onPress={() => { haptic.light(); setAttachOpen(true); }} testID="attach-btn" accessibilityLabel="Send a photo or video">
            <Feather name="plus" size={22} color={colors.brandPrimary} />
          </Pressable>
          <TextInput
            testID="chat-input"
            style={styles.input}
            placeholder="Write something sweet..."
            placeholderTextColor={colors.muted}
            value={text}
            onChangeText={setText}
            onSubmitEditing={send}
            returnKeyType="send"
            multiline
          />
          <Pressable style={[styles.gifButton, gifOpen && styles.gifButtonActive]} onPress={openGifs} disabled={sending} testID="gif-btn" accessibilityLabel="Choose a GIF">
            <Text style={[styles.gifButtonText, gifOpen && styles.gifButtonTextActive]}>GIF</Text>
          </Pressable>
          <Pressable style={[styles.sendButton, (!text.trim() || sending) && styles.sendDisabled]} onPress={send} disabled={!text.trim() || sending} testID="send-btn" accessibilityLabel="Send message">
            <Feather name="send" size={18} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={attachOpen} transparent animationType="slide" onRequestClose={() => setAttachOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setAttachOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Share a photo or video</Text>
          <Text style={styles.sheetLabel}>Privacy</Text>
          <View style={styles.privacyRow}>
            {PRIVACY_OPTIONS.map(option => (
              <Pressable key={option.key} style={[styles.privacyChip, privacy === option.key && styles.privacyChipActive]} onPress={() => setPrivacy(option.key)}>
                <Text style={[styles.privacyText, privacy === option.key && styles.privacyTextActive]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.sheetLabel}>Take now</Text>
          <View style={styles.pickRow}>
            <Pressable style={styles.snapButton} onPress={() => void pickAndSend("image", true)} testID="capture-photo"><Feather name="camera" size={21} color={colors.onBrandPrimary} /><Text style={styles.snapText}>Photo</Text></Pressable>
            <Pressable style={styles.snapButton} onPress={() => void pickAndSend("video", true)} testID="capture-video"><Feather name="video" size={21} color={colors.onBrandPrimary} /><Text style={styles.snapText}>Video</Text></Pressable>
          </View>
          <Text style={styles.sheetLabel}>Choose from library</Text>
          <View style={styles.pickRow}>
            <Pressable style={styles.pickButton} onPress={() => void pickAndSend("image")} testID="pick-photo"><Feather name="image" size={21} color={colors.onBrandTertiary} /><Text style={styles.pickText}>Photo</Text></Pressable>
            <Pressable style={styles.pickButton} onPress={() => void pickAndSend("video")} testID="pick-video"><Feather name="video" size={21} color={colors.onBrandTertiary} /><Text style={styles.pickText}>Video</Text></Pressable>
          </View>
        </View>
      </Modal>

      {viewer ? <MediaViewer visible items={viewer.items} initialIndex={viewer.index} onClose={() => { setViewer(null); queryClient.invalidateQueries({ queryKey: ["messages"] }); }} /> : null}
      {sending ? <View style={styles.sendingNotice}><ActivityIndicator color={colors.onSurfaceInverse} /><Text style={styles.sendingText}>Sending...</Text></View> : null}
    </View>
  );
}

const useStyles = makeStyles(c => ({
  root: { flex: 1, backgroundColor: c.surface },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: "Fraunces", fontSize: 18, fontWeight: "700", color: c.onBrandPrimary },
  partnerName: { fontFamily: "Fraunces", fontSize: 17, fontWeight: "700", color: c.onSurface },
  headerSub: { fontFamily: "Nunito", fontSize: 12, color: c.muted },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  emptyTitle: { fontFamily: "Fraunces", fontSize: 22, fontWeight: "700", color: c.onSurface, marginTop: spacing.md },
  emptySub: { fontFamily: "Nunito", fontSize: 14, color: c.muted },
  messageList: { padding: spacing.lg, paddingBottom: spacing.md },
  messageRow: { maxWidth: "82%", marginBottom: spacing.md },
  mineRow: { alignSelf: "flex-end", alignItems: "flex-end" },
  partnerRow: { alignSelf: "flex-start", alignItems: "flex-start" },
  bubble: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.lg },
  mineBubble: { backgroundColor: c.brandPrimary, borderBottomRightRadius: spacing.xs },
  partnerBubble: { backgroundColor: c.surfaceSecondary, borderBottomLeftRadius: spacing.xs },
  messageText: { fontFamily: "Nunito", fontSize: 15, lineHeight: 21 },
  mineText: { color: c.onBrandPrimary },
  partnerText: { color: c.onSurfaceSecondary },
  media: { width: 220, height: 260, borderRadius: radius.md, backgroundColor: c.surfaceSecondary },
  playOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.2)" },
  mediaLabel: { position: "absolute", bottom: spacing.sm, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  mediaLabelText: { color: "#FFFFFF", fontFamily: "Nunito", fontSize: 12, fontWeight: "700" },
  readReceipt: { fontFamily: "Nunito", fontSize: 11, color: c.muted, marginTop: 3 },
  gifBubble: { width: 230, borderRadius: radius.md, overflow: "hidden", padding: 3 },
  gifMessageImage: { width: 224, height: 170, borderRadius: radius.sm, backgroundColor: c.surfaceSecondary },
  gifAttribution: { fontFamily: "Nunito", fontSize: 9, fontWeight: "700", color: c.muted, paddingHorizontal: 5, paddingVertical: 2 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.divider },
  attachButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.brandTertiary },
  input: { flex: 1, backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, fontFamily: "Nunito", fontSize: 15, color: c.onSurface, maxHeight: 120, minHeight: 44 },
  gifButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.brandTertiary },
  gifButtonActive: { backgroundColor: c.brandPrimary },
  gifButtonText: { fontFamily: "Nunito", fontSize: 11, fontWeight: "900", color: c.brandPrimary },
  gifButtonTextActive: { color: c.onBrandPrimary },
  sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary },
  sendDisabled: { opacity: 0.55 },
  gifPanel: { height: 330, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.divider, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  gifHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xs, paddingBottom: spacing.sm },
  gifTitle: { fontFamily: "Fraunces", fontSize: 18, fontWeight: "700", color: c.onSurface },
  gifPowered: { flex: 1, fontFamily: "Nunito", fontSize: 10, color: c.muted },
  gifSearchRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  gifSearchInput: { flex: 1, height: 42, backgroundColor: c.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, fontFamily: "Nunito", fontSize: 14, color: c.onSurface },
  gifSearchButton: { width: 42, height: 42, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary },
  gifLoading: { flex: 1, alignItems: "center", justifyContent: "center" },
  gifGrid: { flex: 1 },
  gifGridContent: { paddingBottom: spacing.sm },
  gifTile: { width: "32%", aspectRatio: 1.25, marginRight: spacing.xs, marginBottom: spacing.xs, overflow: "hidden", borderRadius: radius.sm, backgroundColor: c.surfaceSecondary },
  gifTileImage: { width: "100%", height: "100%" },
  gifEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },
  gifEmptyText: { fontFamily: "Nunito", fontSize: 13, color: c.muted },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, marginBottom: spacing.lg },
  sheetTitle: { fontFamily: "Fraunces", fontSize: 20, fontWeight: "700", color: c.onSurface, marginBottom: spacing.lg },
  sheetLabel: { fontFamily: "Nunito", fontSize: 13, fontWeight: "700", color: c.onSurfaceTertiary, marginBottom: spacing.sm, marginTop: spacing.md },
  privacyRow: { flexDirection: "row", gap: spacing.sm },
  privacyChip: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceSecondary, borderWidth: 1.5, borderColor: c.border },
  privacyChipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  privacyText: { fontFamily: "Nunito", fontSize: 12, fontWeight: "600", color: c.onSurfaceTertiary },
  privacyTextActive: { color: c.onBrandPrimary },
  pickRow: { flexDirection: "row", gap: spacing.md },
  snapButton: { flex: 1, flexDirection: "row", gap: spacing.sm, alignItems: "center", justifyContent: "center", paddingVertical: spacing.lg, borderRadius: radius.md, backgroundColor: c.brandPrimary },
  snapText: { fontFamily: "Nunito", fontSize: 15, fontWeight: "700", color: c.onBrandPrimary },
  pickButton: { flex: 1, flexDirection: "row", gap: spacing.sm, alignItems: "center", justifyContent: "center", paddingVertical: spacing.lg, borderRadius: radius.md, backgroundColor: c.brandTertiary },
  pickText: { fontFamily: "Nunito", fontSize: 15, fontWeight: "700", color: c.onBrandTertiary },
  sendingNotice: { position: "absolute", top: 100, alignSelf: "center", flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: c.surfaceInverse, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 999 },
  sendingText: { fontFamily: "Nunito", fontSize: 14, color: c.onSurfaceInverse },
}));
