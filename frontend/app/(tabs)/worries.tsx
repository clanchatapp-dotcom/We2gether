import { useState } from "react";
import { View, Text, Pressable, FlatList, Modal, TextInput, ActivityIndicator, RefreshControl } from "react-native";
import { Image } from "expo-image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather";

import { makeStyles, spacing, radius, useTheme } from "@/src/theme";
import { api } from "@/src/api";
import { usesNativeTabs } from "@/src/navigation";
import { haptic } from "@/src/haptics";
import { useToast } from "@/src/components/Toast";

type Comment = { id: string; text: string; author_name: string; is_mine: boolean };
type Worry = { id: string; text: string; author_name: string; is_mine: boolean; created_at: string; comments: Comment[] };

const EMPTY_IMG =
  "https://images.unsplash.com/photo-1603950227760-e609ce8e15b4?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA4Mzl8MHwxfHNlYXJjaHwxfHx3YXJtJTIwY29mZmVlJTIwY3VwJTIwbGV0dGVycyUyMGFlc3RoZXRpY3xlbnwwfHx8fDE3ODk4MTAxMzd8MA&ixlib=rb-4.1.0&q=85";

export default function Worries() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [compose, setCompose] = useState(false);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const q = useQuery<Worry[]>({ queryKey: ["worries"], queryFn: () => api.get("/worries"), refetchInterval: 8000 });
  const worries = q.data || [];

  const post = async () => {
    const t = text.trim();
    if (!t) { toast.show("Write your worry first"); return; }
    setPosting(true);
    haptic.medium();
    try {
      await api.post("/worries", { text: t });
      setText("");
      setCompose(false);
      qc.invalidateQueries({ queryKey: ["worries"] });
    } catch {
      toast.show("Could not share your worry");
    } finally {
      setPosting(false);
    }
  };

  const renderItem = ({ item }: { item: Worry }) => (
    <Pressable style={styles.card} onPress={() => router.push(`/worry/${item.id}`)} testID={`worry-${item.id}`}>
      <View style={styles.authorRow}>
        <View style={[styles.dot, item.is_mine ? styles.dotMine : styles.dotTheirs]} />
        <Text style={styles.author}>{item.author_name}</Text>
        <Text style={styles.authorTag}>{item.is_mine ? "you shared" : "shared"}</Text>
      </View>
      <Text style={styles.worryText}>{item.text}</Text>
      <View style={styles.footer}>
        <Feather name="message-square" size={14} color={colors.muted} />
        <Text style={styles.count}>
          {item.comments.length === 0 ? "Add a comment" : `${item.comments.length} comment${item.comments.length > 1 ? "s" : ""}`}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
        <Text style={styles.hello}>a safe place to share</Text>
        <Text style={styles.title}>Worries</Text>
      </View>

      {q.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : worries.length === 0 ? (
        <View style={styles.center}>
          <Image source={{ uri: EMPTY_IMG }} style={styles.emptyImg} contentFit="cover" />
          <Text style={styles.emptyTitle}>No worries shared</Text>
          <Text style={styles.emptySub}>It's a peaceful day. Share anything on your mind.</Text>
        </View>
      ) : (
        <FlatList
          data={worries}
          keyExtractor={(w) => w.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomChrome + 96 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={colors.brandPrimary} />}
        />
      )}

      <Pressable
        style={[styles.fab, { bottom: bottomChrome + spacing.lg }]}
        onPress={() => { haptic.light(); setCompose(true); }}
        testID="share-worry-btn"
      >
        <Feather name="edit-3" size={18} color={colors.onBrandPrimary} />
        <Text style={styles.fabText}>Share a worry</Text>
      </Pressable>

      <Modal visible={compose} transparent animationType="slide" onRequestClose={() => setCompose(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setCompose(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>What's weighing on you?</Text>
          <KeyboardAwareScrollView bottomOffset={16} showsVerticalScrollIndicator={false}>
            <TextInput
              testID="worry-input"
              style={styles.worryInput}
              placeholder="Take your time... your partner is here."
              placeholderTextColor={colors.muted}
              value={text}
              onChangeText={setText}
              multiline
              autoFocus
              maxLength={500}
            />
            <Pressable style={styles.postBtn} onPress={post} disabled={posting} testID="post-worry-btn">
              <Text style={styles.postText}>{posting ? "Sharing..." : "Share it"}</Text>
            </Pressable>
          </KeyboardAwareScrollView>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  hello: { fontFamily: "Caveat", fontSize: 22, color: c.brandPrimary },
  title: { fontFamily: "Fraunces", fontSize: 32, fontWeight: "700", color: c.onSurface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  emptyImg: { width: 160, height: 160, borderRadius: radius.lg, marginBottom: spacing.md },
  emptyTitle: { fontFamily: "Fraunces", fontSize: 20, fontWeight: "700", color: c.onSurface },
  emptySub: { fontFamily: "Nunito", fontSize: 14, color: c.muted, textAlign: "center" },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: c.border },
  authorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotMine: { backgroundColor: c.brandPrimary },
  dotTheirs: { backgroundColor: c.info },
  author: { fontFamily: "Nunito", fontSize: 14, fontWeight: "700", color: c.onSurface },
  authorTag: { fontFamily: "Caveat", fontSize: 16, color: c.muted },
  worryText: { fontFamily: "Nunito", fontSize: 16, lineHeight: 23, color: c.onSurfaceSecondary },
  footer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  count: { fontFamily: "Nunito", fontSize: 13, color: c.muted },
  fab: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.brandPrimary,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  fabText: { fontFamily: "Nunito", fontSize: 15, fontWeight: "700", color: c.onBrandPrimary },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, marginBottom: spacing.lg },
  sheetTitle: { fontFamily: "Fraunces", fontSize: 20, fontWeight: "700", color: c.onSurface, marginBottom: spacing.lg },
  worryInput: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, fontFamily: "Nunito", fontSize: 16, color: c.onSurface, minHeight: 120, borderWidth: 1, borderColor: c.border, textAlignVertical: "top" },
  postBtn: { marginTop: spacing.lg, backgroundColor: c.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center" },
  postText: { fontFamily: "Nunito", fontSize: 16, fontWeight: "700", color: c.onBrandPrimary },
}));
