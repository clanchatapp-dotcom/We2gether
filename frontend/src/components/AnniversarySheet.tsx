import { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, Modal, ScrollView } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { makeStyles, spacing, radius } from "@/src/theme";
import { api } from "@/src/api";
import { haptic } from "@/src/haptics";
import { useToast } from "@/src/components/Toast";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function daysInMonth(year: number, month0: number) {
  return new Date(year, month0 + 1, 0).getDate();
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function AnniversarySheet({
  visible,
  initialDate,
  onClose,
}: {
  visible: boolean;
  initialDate?: string;
  onClose: () => void;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const toast = useToast();

  const now = new Date();
  const thisYear = now.getFullYear();
  const YEARS = useMemo(
    () => Array.from({ length: 60 }, (_, i) => thisYear - i),
    [thisYear],
  );

  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(now.getMonth());
  const [day, setDay] = useState(now.getDate());
  const [saving, setSaving] = useState(false);

  // Seed from the couple's existing anniversary whenever the sheet opens.
  useEffect(() => {
    if (!visible) return;
    const src = initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : null;
    if (src) {
      const [y, m, d] = src.split("-").map((n) => parseInt(n, 10));
      setYear(y);
      setMonth(m - 1);
      setDay(d);
    }
  }, [visible, initialDate]);

  const maxDay = daysInMonth(year, month);
  const days = useMemo(() => Array.from({ length: maxDay }, (_, i) => i + 1), [maxDay]);
  const safeDay = Math.min(day, maxDay);

  const save = async () => {
    setSaving(true);
    haptic.medium();
    const date = `${year}-${pad(month + 1)}-${pad(safeDay)}`;
    try {
      await api.post("/couples/anniversary", { date });
      haptic.success();
      qc.invalidateQueries({ queryKey: ["me"] });
      onClose();
    } catch (e: any) {
      toast.show(e?.message || "Could not save your date");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.grabber} />
        <Text style={styles.title}>When did your story begin?</Text>
        <Text style={styles.sub}>This becomes your “together since” date.</Text>

        <Text style={styles.label}>Month</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {MONTHS.map((m, i) => {
            const active = i === month;
            return (
              <Pressable
                key={m}
                testID={`anniv-month-${i}`}
                onPress={() => { setMonth(i); haptic.light(); }}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{m}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={styles.label}>Day</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {days.map((d) => {
            const active = d === safeDay;
            return (
              <Pressable
                key={d}
                testID={`anniv-day-${d}`}
                onPress={() => { setDay(d); haptic.light(); }}
                style={[styles.dayChip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{d}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={styles.label}>Year</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {YEARS.map((y) => {
            const active = y === year;
            return (
              <Pressable
                key={y}
                testID={`anniv-year-${y}`}
                onPress={() => { setYear(y); haptic.light(); }}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{y}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable style={styles.saveBtn} onPress={save} disabled={saving} testID="anniv-save-btn">
          <Text style={styles.saveText}>{saving ? "Saving..." : "Save our date"}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, marginBottom: spacing.lg },
  title: { fontFamily: "Fraunces", fontSize: 22, fontWeight: "700", color: c.onSurface },
  sub: { fontFamily: "Nunito", fontSize: 14, color: c.muted, marginTop: spacing.xs, marginBottom: spacing.md },
  label: { fontFamily: "Nunito", fontSize: 13, fontWeight: "700", color: c.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.md, marginBottom: spacing.sm },
  strip: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: { flexShrink: 0, paddingHorizontal: spacing.lg, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary, borderWidth: 1.5, borderColor: c.border },
  dayChip: { flexShrink: 0, width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary, borderWidth: 1.5, borderColor: c.border },
  chipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  chipText: { fontFamily: "Nunito", fontSize: 15, fontWeight: "700", color: c.onSurfaceSecondary },
  chipTextActive: { color: c.onBrandPrimary },
  saveBtn: { marginTop: spacing.xl, backgroundColor: c.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center" },
  saveText: { fontFamily: "Nunito", fontSize: 16, fontWeight: "700", color: c.onBrandPrimary },
}));
