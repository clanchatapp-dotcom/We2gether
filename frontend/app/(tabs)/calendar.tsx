import { useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  Modal,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather";
import { format, addDays, isToday, isTomorrow, parseISO } from "date-fns";

import { makeStyles, spacing, radius, useTheme } from "@/src/theme";
import { api } from "@/src/api";
import { usesNativeTabs } from "@/src/navigation";
import { haptic } from "@/src/haptics";
import { useToast } from "@/src/components/Toast";

type EventItem = {
  id: string;
  title: string;
  note?: string;
  event_date: string; // YYYY-MM-DD
  author_name: string;
  is_mine: boolean;
  created_at: string;
};

type Row =
  | { kind: "header"; key: string; date: string }
  | { kind: "event"; key: string; event: EventItem };

const EMPTY_IMG =
  "https://images.unsplash.com/photo-1506784983877-45594efa4cbe?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA4Mzl8MHwxfHNlYXJjaHwxfHxjYWxlbmRhciUyMHBsYW5uZXIlMjBhZXN0aGV0aWN8ZW58MHx8fHwxNzg5ODEwMTM3fDA&ixlib=rb-4.1.0&q=85";

function dayLabel(dateStr: string) {
  const d = parseISO(dateStr);
  if (isToday(d)) return `Today · ${format(d, "EEE d MMM")}`;
  if (isTomorrow(d)) return `Tomorrow · ${format(d, "EEE d MMM")}`;
  return format(d, "EEEE · d MMM yyyy");
}

// A cross-platform date strip: today + next 89 days (events auto-expire in the
// past anyway, so there's no reason to pick a past date).
const DATE_OPTIONS = Array.from({ length: 90 }, (_, i) => {
  const d = addDays(new Date(), i);
  return { value: format(d, "yyyy-MM-dd"), label: format(d, "EEE"), day: format(d, "d"), mon: format(d, "MMM") };
});

export default function Calendar() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const toast = useToast();

  const [compose, setCompose] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(DATE_OPTIONS[0].value);
  const [posting, setPosting] = useState(false);

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const q = useQuery<EventItem[]>({ queryKey: ["events"], queryFn: () => api.get("/events"), refetchInterval: 8000 });
  const events = useMemo(() => q.data || [], [q.data]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    let lastDate = "";
    for (const e of events) {
      if (e.event_date !== lastDate) {
        out.push({ kind: "header", key: `h-${e.event_date}`, date: e.event_date });
        lastDate = e.event_date;
      }
      out.push({ kind: "event", key: e.id, event: e });
    }
    return out;
  }, [events]);

  const openCompose = () => {
    haptic.light();
    setTitle("");
    setNote("");
    setDate(DATE_OPTIONS[0].value);
    setCompose(true);
  };

  const post = async () => {
    const t = title.trim();
    if (!t) { toast.show("Give your event a title"); return; }
    setPosting(true);
    haptic.medium();
    try {
      await api.post("/events", { title: t, note: note.trim(), event_date: date });
      setCompose(false);
      qc.invalidateQueries({ queryKey: ["events"] });
    } catch (e: any) {
      toast.show(e?.message || "Could not add your event");
    } finally {
      setPosting(false);
    }
  };

  const remove = async (item: EventItem) => {
    haptic.light();
    try {
      await api.del(`/events/${item.id}`);
      qc.invalidateQueries({ queryKey: ["events"] });
    } catch (e: any) {
      toast.show(e?.message || "Could not remove event");
    }
  };

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === "header") {
      return (
        <View style={styles.dayHeader}>
          <Feather name="calendar" size={14} color={colors.brandPrimary} />
          <Text style={styles.dayHeaderText}>{dayLabel(item.date)}</Text>
        </View>
      );
    }
    const e = item.event;
    return (
      <View style={styles.card} testID={`event-${e.id}`}>
        <View style={[styles.accent, e.is_mine ? styles.accentMine : styles.accentTheirs]} />
        <View style={styles.cardBody}>
          <Text style={styles.eventTitle}>{e.title}</Text>
          {e.note ? <Text style={styles.eventNote}>{e.note}</Text> : null}
          <View style={styles.authorRow}>
            <View style={[styles.dot, e.is_mine ? styles.dotMine : styles.dotTheirs]} />
            <Text style={styles.author}>added by {e.author_name}</Text>
          </View>
        </View>
        {e.is_mine ? (
          <Pressable style={styles.deleteBtn} onPress={() => remove(e)} testID={`event-delete-${e.id}`} hitSlop={8}>
            <Feather name="trash-2" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
    );
  };

  const selected = DATE_OPTIONS.find((d) => d.value === date);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
        <Text style={styles.hello}>things to look forward to</Text>
        <Text style={styles.title}>Calendar</Text>
      </View>

      {q.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : events.length === 0 ? (
        <View style={styles.center}>
          <Image source={{ uri: EMPTY_IMG }} style={styles.emptyImg} contentFit="cover" />
          <Text style={styles.emptyTitle}>Nothing planned yet</Text>
          <Text style={styles.emptySub}>Add a date night, trip or reminder — your partner will see it too.</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          renderItem={renderRow}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomChrome + 96 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={colors.brandPrimary} />}
        />
      )}

      <Pressable
        style={[styles.fab, { bottom: bottomChrome + spacing.lg }]}
        onPress={openCompose}
        testID="add-event-btn"
      >
        <Feather name="plus" size={18} color={colors.onBrandPrimary} />
        <Text style={styles.fabText}>Add event</Text>
      </Pressable>

      <Modal visible={compose} transparent animationType="slide" onRequestClose={() => setCompose(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setCompose(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>{"What's coming up?"}</Text>
          <KeyboardAwareScrollView bottomOffset={16} showsVerticalScrollIndicator={false}>
            <TextInput
              testID="event-title-input"
              style={styles.input}
              placeholder="Event title (e.g. Anniversary dinner)"
              placeholderTextColor={colors.muted}
              value={title}
              onChangeText={setTitle}
              maxLength={80}
              autoFocus
            />
            <TextInput
              testID="event-note-input"
              style={[styles.input, styles.noteInput]}
              placeholder="Add a note (optional)"
              placeholderTextColor={colors.muted}
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={200}
            />
            <Text style={styles.pickLabel}>
              When? <Text style={styles.pickLabelValue}>{selected ? `${selected.label} ${selected.day} ${selected.mon}` : ""}</Text>
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateStrip}>
              {DATE_OPTIONS.map((d) => {
                const active = d.value === date;
                return (
                  <Pressable
                    key={d.value}
                    testID={`date-${d.value}`}
                    onPress={() => { setDate(d.value); haptic.light(); }}
                    style={[styles.dateChip, active && styles.dateChipActive]}
                  >
                    <Text style={[styles.dateChipDow, active && styles.dateChipTextActive]}>{d.label}</Text>
                    <Text style={[styles.dateChipDay, active && styles.dateChipTextActive]}>{d.day}</Text>
                    <Text style={[styles.dateChipMon, active && styles.dateChipTextActive]}>{d.mon}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable style={styles.postBtn} onPress={post} disabled={posting} testID="save-event-btn">
              <Text style={styles.postText}>{posting ? "Adding..." : "Add to calendar"}</Text>
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
  dayHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.sm },
  dayHeaderText: { fontFamily: "Nunito", fontSize: 13, fontWeight: "700", color: c.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5 },
  card: { flexDirection: "row", backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  accent: { width: 5 },
  accentMine: { backgroundColor: c.brandPrimary },
  accentTheirs: { backgroundColor: c.info },
  cardBody: { flex: 1, padding: spacing.lg, gap: 4 },
  eventTitle: { fontFamily: "Fraunces", fontSize: 17, fontWeight: "700", color: c.onSurface },
  eventNote: { fontFamily: "Nunito", fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  authorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotMine: { backgroundColor: c.brandPrimary },
  dotTheirs: { backgroundColor: c.info },
  author: { fontFamily: "Caveat", fontSize: 16, color: c.muted },
  deleteBtn: { padding: spacing.md, alignItems: "center", justifyContent: "center" },
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
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: spacing.xl, paddingTop: spacing.md, maxHeight: "88%" },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, marginBottom: spacing.lg },
  sheetTitle: { fontFamily: "Fraunces", fontSize: 20, fontWeight: "700", color: c.onSurface, marginBottom: spacing.lg },
  input: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, fontFamily: "Nunito", fontSize: 16, color: c.onSurface, borderWidth: 1, borderColor: c.border, marginBottom: spacing.md },
  noteInput: { minHeight: 72, textAlignVertical: "top" },
  pickLabel: { fontFamily: "Nunito", fontSize: 13, fontWeight: "700", color: c.onSurfaceTertiary, marginBottom: spacing.sm, marginTop: spacing.xs },
  pickLabelValue: { fontFamily: "Nunito", fontWeight: "700", color: c.brandPrimary },
  dateStrip: { gap: spacing.sm, paddingBottom: spacing.md, paddingRight: spacing.lg },
  dateChip: { width: 60, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceSecondary, borderWidth: 1.5, borderColor: c.border },
  dateChipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  dateChipDow: { fontFamily: "Nunito", fontSize: 12, fontWeight: "600", color: c.muted },
  dateChipDay: { fontFamily: "Fraunces", fontSize: 20, fontWeight: "700", color: c.onSurface, marginVertical: 2 },
  dateChipMon: { fontFamily: "Nunito", fontSize: 11, color: c.muted },
  dateChipTextActive: { color: c.onBrandPrimary },
  postBtn: { marginTop: spacing.sm, backgroundColor: c.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center" },
  postText: { fontFamily: "Nunito", fontSize: 16, fontWeight: "700", color: c.onBrandPrimary },
}));
