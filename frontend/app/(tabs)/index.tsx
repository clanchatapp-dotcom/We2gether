import { useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Share } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather";

import { makeStyles, spacing, radius, useTheme } from "@/src/theme";
import { api } from "@/src/api";
import { usesNativeTabs } from "@/src/navigation";
import { useAuth } from "@/src/auth";
import { haptic } from "@/src/haptics";
import { MoodSheet } from "@/src/components/MoodSheet";
import { ukDaysSince } from "@/src/ukTime";

function daysSince(dateStr?: string) {
  // Counted in UK calendar days, matching the backend's uk_today() — so
  // the count doesn't jump around depending on which partner's phone (and
  // timezone) happens to be looking at it.
  return ukDaysSince(dateStr);
}

function MoodCard({ name, mood, isMe, onSet }: any) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.moodCard} testID={`mood-card-${isMe ? "me" : "partner"}`}>
      <Text style={styles.moodName}>{name || (isMe ? "You" : "Partner")}</Text>
      {mood ? (
        <>
          <Text style={styles.moodBigEmoji}>{mood.emoji}</Text>
          <Text style={styles.moodBigLabel}>{mood.label}</Text>
          {mood.note ? <Text style={styles.moodNote}>“{mood.note}”</Text> : null}
        </>
      ) : (
        <View style={styles.emptyMood}>
          <Feather name="sun" size={26} color={colors.muted} />
          <Text style={styles.emptyMoodText}>{isMe ? "Not set yet" : "Waiting..."}</Text>
        </View>
      )}
      {isMe ? (
        <Pressable style={styles.moodSetBtn} onPress={onSet} testID="set-mood-btn">
          <Text style={styles.moodSetText}>{mood ? "Update" : "Set mood"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function Home() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuth();
  const [sheet, setSheet] = useState(false);

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const meQ = useQuery({ queryKey: ["me"], queryFn: () => api.get("/couples/me") });
  const moodsQ = useQuery({ queryKey: ["moods"], queryFn: () => api.get("/moods"), refetchInterval: 8000 });

  if (meQ.isLoading) {
    return (
      <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
    );
  }

  const couple = meQ.data;
  const moods = moodsQ.data?.moods || {};
  const myMood = couple?.me ? moods[couple.me.user_id] : null;
  const partnerMood = couple?.partner ? moods[couple.partner.user_id] : null;

  const shareCode = async () => {
    haptic.medium();
    await Share.share({ message: `Join our private 2gether space 💞 Use code: ${couple.code}` });
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: bottomChrome + spacing["2xl"], paddingHorizontal: spacing.xl }}
        showsVerticalScrollIndicator={false}
        refreshControl={undefined}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>together since</Text>
            <Text style={styles.since}>{couple?.since_date || "today"}</Text>
            <Text style={styles.days}>{daysSince(couple?.since_date)} days of us 💞</Text>
          </View>
          <Pressable style={styles.signOut} onPress={() => { haptic.light(); signOut(); }} testID="sign-out-btn">
            <Feather name="log-out" size={18} color={colors.muted} />
          </Pressable>
        </View>

        {!couple?.paired ? (
          <View style={styles.inviteCard} testID="invite-card">
            <Feather name="user-plus" size={22} color={colors.onBrandTertiary} />
            <Text style={styles.inviteTitle}>Invite your partner</Text>
            <Text style={styles.inviteSub}>Share this code so they can join your space.</Text>
            <View style={styles.codeBox}>
              <Text style={styles.code} testID="couple-code">{couple?.code}</Text>
            </View>
            <Pressable style={styles.shareBtn} onPress={shareCode} testID="share-code-btn">
              <Feather name="share-2" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.shareText}>Share code</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Today's moods</Text>
        <View style={styles.moodRow}>
          <MoodCard name={couple?.me?.name} mood={myMood} isMe onSet={() => { haptic.light(); setSheet(true); }} />
          <MoodCard name={couple?.partner?.name} mood={partnerMood} isMe={false} />
        </View>
        <Text style={styles.resetHint}>Moods gently clear at midnight UK time 🌙</Text>

        <Text style={styles.sectionTitle}>Our space</Text>
        <View style={styles.actionsGrid}>
          <Pressable style={styles.action} onPress={() => router.push("/(tabs)/chat")} testID="quick-chat">
            <View style={[styles.actionIcon, { backgroundColor: colors.brandTertiary }]}>
              <Feather name="message-circle" size={22} color={colors.onBrandTertiary} />
            </View>
            <Text style={styles.actionText}>Chat</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={() => router.push("/(tabs)/gallery")} testID="quick-gallery">
            <View style={[styles.actionIcon, { backgroundColor: colors.surfaceTertiary }]}>
              <Feather name="image" size={22} color={colors.onSurfaceTertiary} />
            </View>
            <Text style={styles.actionText}>Gallery</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={() => router.push("/(tabs)/worries")} testID="quick-worries">
            <View style={[styles.actionIcon, { backgroundColor: colors.surfaceSecondary }]}>
              <Feather name="cloud-drizzle" size={22} color={colors.onSurfaceSecondary} />
            </View>
            <Text style={styles.actionText}>Worries</Text>
          </Pressable>
        </View>
      </ScrollView>

      <MoodSheet visible={sheet} onClose={() => setSheet(false)} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.surface },
  headerRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.xl },
  hello: { fontFamily: "Caveat", fontSize: 22, color: c.brandPrimary },
  since: { fontFamily: "Fraunces", fontSize: 34, fontWeight: "700", color: c.onSurface },
  days: { fontFamily: "Nunito", fontSize: 14, color: c.onSurfaceTertiary, marginTop: 2 },
  signOut: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  inviteCard: {
    backgroundColor: c.brandTertiary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  inviteTitle: { fontFamily: "Fraunces", fontSize: 20, fontWeight: "700", color: c.onBrandTertiary, marginTop: spacing.sm },
  inviteSub: { fontFamily: "Nunito", fontSize: 14, color: c.onBrandTertiary, textAlign: "center", marginTop: spacing.xs, marginBottom: spacing.lg },
  codeBox: { backgroundColor: c.surface, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, marginBottom: spacing.lg },
  code: { fontFamily: "Fraunces", fontSize: 30, fontWeight: "700", letterSpacing: 6, color: c.onSurface },
  shareBtn: { flexDirection: "row", gap: spacing.sm, backgroundColor: c.brandPrimary, borderRadius: radius.pill, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, alignItems: "center" },
  shareText: { fontFamily: "Nunito", fontSize: 15, fontWeight: "700", color: c.onBrandPrimary },
  sectionTitle: { fontFamily: "Fraunces", fontSize: 20, fontWeight: "700", color: c.onSurface, marginBottom: spacing.md },
  moodRow: { flexDirection: "row", gap: spacing.md },
  moodCard: { flex: 1, backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, alignItems: "center", borderWidth: 1, borderColor: c.border, minHeight: 170 },
  moodName: { fontFamily: "Nunito", fontSize: 14, fontWeight: "700", color: c.onSurfaceSecondary },
  moodBigEmoji: { fontSize: 44, marginTop: spacing.sm },
  moodBigLabel: { fontFamily: "Nunito", fontSize: 15, fontWeight: "700", color: c.onSurface, marginTop: spacing.xs },
  moodNote: { fontFamily: "Caveat", fontSize: 18, color: c.onSurfaceTertiary, textAlign: "center", marginTop: spacing.xs },
  emptyMood: { alignItems: "center", marginTop: spacing.lg, gap: spacing.sm },
  emptyMoodText: { fontFamily: "Nunito", fontSize: 13, color: c.muted },
  moodSetBtn: { marginTop: spacing.md, backgroundColor: c.brandPrimary, borderRadius: radius.pill, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  moodSetText: { fontFamily: "Nunito", fontSize: 13, fontWeight: "700", color: c.onBrandPrimary },
  resetHint: { fontFamily: "Nunito", fontSize: 12, color: c.muted, textAlign: "center", marginTop: spacing.md, marginBottom: spacing.xl },
  actionsGrid: { flexDirection: "row", gap: spacing.md },
  action: { flex: 1, backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, paddingVertical: spacing.lg, alignItems: "center", borderWidth: 1, borderColor: c.border },
  actionIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  actionText: { fontFamily: "Nunito", fontSize: 13, fontWeight: "600", color: c.onSurfaceSecondary },
}));
