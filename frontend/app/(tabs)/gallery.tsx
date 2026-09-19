import { useMemo, useState, useCallback } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather";

import { makeStyles, spacing, radius, useTheme } from "@/src/theme";
import { api, mediaSource } from "@/src/api";
import { usesNativeTabs } from "@/src/navigation";
import { MediaViewer, ViewerItem } from "@/src/components/MediaViewer";
import { haptic } from "@/src/haptics";

type Media = { id: string; media_path: string; media_type?: string; privacy: string; sender_name?: string };

const EMPTY_IMG =
  "https://images.unsplash.com/photo-1632425033037-2f2310d26e93?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzJ8MHwxfHNlYXJjaHwyfHxjb3p5JTIwZW1wdHklMjBnYWxsZXJ5JTIwYWVzdGhldGljJTIwbm90ZWJvb2t8ZW58MHx8fHwxNzg5ODEwMTM3fDA&ixlib=rb-4.1.0&q=85";

export default function Gallery() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [viewer, setViewer] = useState<{ items: ViewerItem[]; index: number } | null>(null);

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const gap = spacing.sm;
  const cardW = (width - spacing.lg * 2 - gap) / 2;

  const q = useQuery<Media[]>({ queryKey: ["gallery"], queryFn: () => api.get("/gallery"), refetchInterval: 10000 });
  const items = q.data || [];

  const viewerItems = useMemo(
    () => items.map((m) => ({ id: m.id, media_path: m.media_path, media_type: m.media_type, privacy: m.privacy })),
    [items],
  );

  const open = useCallback((idx: number) => { haptic.light(); setViewer({ items: viewerItems, index: idx }); }, [viewerItems]);

  const renderItem = ({ item, index }: { item: Media; index: number }) => (
    <Pressable
      testID={`gallery-item-${item.id}`}
      onPress={() => open(index)}
      style={[styles.card, { width: cardW, height: index % 3 === 0 ? cardW * 1.35 : cardW }]}
    >
      <Image source={mediaSource(item.media_path)} style={styles.img} contentFit="cover" transition={200} />
      {item.media_type === "video" ? (
        <View style={styles.playOverlay}><Feather name="play" size={22} color="#FFFFFF" /></View>
      ) : null}
      {item.privacy === "no_save" ? (
        <View style={styles.lockBadge}><Feather name="lock" size={11} color="#FFFFFF" /></View>
      ) : null}
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
        <Text style={styles.hello}>our little collection</Text>
        <Text style={styles.title}>Gallery</Text>
      </View>

      {q.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Image source={{ uri: EMPTY_IMG }} style={styles.emptyImg} contentFit="cover" />
          <Text style={styles.emptyTitle}>No memories yet</Text>
          <Text style={styles.emptySub}>Share a photo in chat and it'll appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={{ gap, paddingHorizontal: spacing.lg }}
          contentContainerStyle={{ gap, paddingTop: spacing.md, paddingBottom: bottomChrome + spacing["2xl"] }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={colors.brandPrimary} />}
        />
      )}

      {viewer ? (
        <MediaViewer visible items={viewer.items} initialIndex={viewer.index} onClose={() => setViewer(null)} />
      ) : null}
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
  card: { borderRadius: radius.md, overflow: "hidden", backgroundColor: c.surfaceSecondary },
  img: { width: "100%", height: "100%" },
  playOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.2)" },
  lockBadge: { position: "absolute", top: spacing.sm, right: spacing.sm, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 999, padding: 5 },
}));
