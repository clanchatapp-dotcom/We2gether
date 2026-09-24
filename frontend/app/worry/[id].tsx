import { useState } from "react";
import { View, Text, TextInput, Pressable, FlatList, ActivityIndicator } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather";

import { makeStyles, spacing, radius, useTheme } from "@/src/theme";
import { api } from "@/src/api";
import { haptic } from "@/src/haptics";
import { useToast } from "@/src/components/Toast";

type Comment = { id: string; text: string; author_name: string; is_mine: boolean };
type Worry = { id: string; text: string; author_name: string; is_mine: boolean; comments: Comment[] };

export default function WorryDetail() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const q = useQuery<Worry[]>({ queryKey: ["worries"], queryFn: () => api.get("/worries"), refetchInterval: 5000 });
  const worry = (q.data || []).find((w) => w.id === id);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setText("");
    setSending(true);
    haptic.light();
    try {
      await api.post(`/worries/${id}/comments`, { text: t });
      qc.invalidateQueries({ queryKey: ["worries"] });
    } catch {
      toast.show("Could not add comment");
      setText(t);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} testID="worry-back">
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Worry</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior="translate-with-padding">
        {q.isLoading || !worry ? (
          <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <FlatList
            data={worry.comments}
            keyExtractor={(c) => c.id}
            ListHeaderComponent={
              <View style={styles.worryCard}>
                <View style={styles.authorRow}>
                  <View style={[styles.dot, worry.is_mine ? styles.dotMine : styles.dotTheirs]} />
                  <Text style={styles.author}>{worry.author_name}</Text>
                  <Text style={styles.authorTag}>shared this</Text>
                </View>
                <Text style={styles.worryText}>{worry.text}</Text>
                <Text style={styles.commentsHeading}>
                  {worry.comments.length === 0 ? "No comments yet — be the first" : "Comments"}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={[styles.comment, item.is_mine ? styles.commentMine : styles.commentTheirs]}>
                <Text style={styles.commentAuthor}>{item.author_name}</Text>
                <Text style={styles.commentText}>{item.text}</Text>
              </View>
            )}
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.lg }}
            showsVerticalScrollIndicator={false}
          />
        )}

        <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.sm }]}>
          <TextInput
            testID="comment-input"
            style={styles.input}
            placeholder="Leave a caring comment..."
            placeholderTextColor={colors.muted}
            value={text}
            onChangeText={setText}
            multiline
          />
          <Pressable style={styles.sendBtn} onPress={send} disabled={sending || !text.trim()} testID="comment-send">
            <Feather name="send" size={18} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "Fraunces", fontSize: 18, fontWeight: "700", color: c.onSurface },
  worryCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg, borderWidth: 1, borderColor: c.border },
  authorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotMine: { backgroundColor: c.brandPrimary },
  dotTheirs: { backgroundColor: c.info },
  author: { fontFamily: "Nunito", fontSize: 14, fontWeight: "700", color: c.onSurface },
  authorTag: { fontFamily: "Caveat", fontSize: 16, color: c.muted },
  worryText: { fontFamily: "Nunito", fontSize: 17, lineHeight: 25, color: c.onSurfaceSecondary },
  commentsHeading: { fontFamily: "Nunito", fontSize: 13, fontWeight: "700", color: c.muted, marginTop: spacing.lg },
  comment: { borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, maxWidth: "88%" },
  commentMine: { backgroundColor: c.brandTertiary, alignSelf: "flex-end" },
  commentTheirs: { backgroundColor: c.surfaceSecondary, alignSelf: "flex-start", borderWidth: 1, borderColor: c.border },
  commentAuthor: { fontFamily: "Nunito", fontSize: 12, fontWeight: "700", color: c.onSurfaceTertiary, marginBottom: 2 },
  commentText: { fontFamily: "Nunito", fontSize: 15, lineHeight: 21, color: c.onSurface },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.surface },
  input: { flex: 1, backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: "Nunito", fontSize: 15, color: c.onSurface, maxHeight: 120, minHeight: 44 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary },
}));
