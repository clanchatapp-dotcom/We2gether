import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, FlatList, Image, Pressable, Text, TextInput, View, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather";

import { api, mediaSource } from "@/src/api";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { usesNativeTabs } from "@/src/navigation";
import { formatUkTime } from "@/src/ukTime";
import { haptic } from "@/src/haptics";
import { useToast } from "@/src/components/Toast";

type Message = {
  id: string;
  type: string;
  text?: string;
  is_mine: boolean;
  sender_name?: string;
  media_path?: string;
  media_type?: string;
  read_at?: string | null;
};

export default function Chat() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const toast = useToast();
  const listRef = useRef<FlatList<Message>>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");

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

  const partnerName = partnerQuery.data?.partner?.name || "Your partner";
  const renderMessage = ({ item }: { item: Message }) => {
    const mine = item.is_mine;
    return (
      <View style={[styles.messageRow, mine ? styles.mineRow : styles.partnerRow]}>
        {item.type === "text" ? (
          <View style={[styles.bubble, mine ? styles.mineBubble : styles.partnerBubble]}>
            <Text style={[styles.messageText, mine ? styles.mineText : styles.partnerText]}>{item.text}</Text>
          </View>
        ) : item.media_path ? (
          <Image source={mediaSource(item.media_path)} style={styles.media} resizeMode="cover" />
        ) : null}
        {mine && item.id === lastReadId && item.read_at ? (
          <Text style={styles.readReceipt}>Read {formatUkTime(item.read_at)}</Text>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{partnerName.charAt(0).toUpperCase()}</Text></View>
        <View>
          <Text style={styles.partnerName}>{partnerName}</Text>
          <Text style={styles.headerSub}>{partnerQuery.data?.partner ? "just the two of you" : "waiting to connect"}</Text>
        </View>
      </View>
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
      <View style={[styles.composer, { paddingBottom: usesNativeTabs ? insets.bottom : spacing.sm }]}>
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
        <Pressable style={[styles.sendButton, (!text.trim() || sending) && styles.sendDisabled]} onPress={send} disabled={!text.trim() || sending} testID="send-btn">
          <Feather name="send" size={18} color={colors.onBrandPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles(c => ({
  root: { flex: 1, backgroundColor: c.surface },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: c.divider },
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
  media: { width: 200, height: 240, borderRadius: radius.md, backgroundColor: c.surfaceSecondary },
  readReceipt: { fontFamily: "Nunito", fontSize: 11, color: c.muted, marginTop: 3 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.divider },
  input: { flex: 1, backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, fontFamily: "Nunito", fontSize: 15, color: c.onSurface, maxHeight: 120, minHeight: 44 },
  sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary },
  sendDisabled: { opacity: 0.55 },
}));
