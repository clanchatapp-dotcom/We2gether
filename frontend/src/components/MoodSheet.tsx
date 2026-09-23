import { useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, Modal } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather";

import { makeStyles, spacing, radius, useTheme } from "@/src/theme";
import { api } from "@/src/api";
import { MOOD_OPTIONS, MoodOption } from "@/src/mood-options";
import { haptic } from "@/src/haptics";
import { useToast } from "@/src/components/Toast";

export function MoodSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<MoodOption | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!selected) {
      toast.show("Pick how you feel");
      return;
    }
    setSaving(true);
    try {
      await api.post("/moods", { emoji: selected.emoji, label: selected.label, note });
      haptic.success();
      qc.invalidateQueries({ queryKey: ["moods"] });
      setSelected(null);
      setNote("");
      onClose();
    } catch {
      toast.show("Could not save your mood");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.grabber} />
        <Text style={styles.sheetTitle}>How are you feeling today?</Text>
        <KeyboardAwareScrollView bottomOffset={16} showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
          <View style={styles.moodGrid}>
            {MOOD_OPTIONS.map((m) => (
              <Pressable
                key={m.label}
                testID={`mood-${m.label}`}
                style={[styles.moodChip, selected?.label === m.label && styles.moodChipActive]}
                onPress={() => { setSelected(m); haptic.success(); }}
              >
                <Text style={styles.moodEmoji}>{m.emoji}</Text>
                <Text style={[styles.moodLabel, selected?.label === m.label && styles.moodLabelActive]}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            testID="mood-note-input"
            style={styles.noteInput}
            placeholder="Add a little note (optional)"
            placeholderTextColor={colors.muted}
            value={note}
            onChangeText={setNote}
            maxLength={120}
            multiline
          />
        </KeyboardAwareScrollView>
        <Pressable testID="mood-save" style={styles.saveBtn} onPress={save} disabled={saving}>
          <Text style={styles.saveText}>{saving ? "Saving..." : "Save mood"}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, marginBottom: spacing.lg },
  sheetTitle: { fontFamily: "Fraunces", fontSize: 22, fontWeight: "700", color: c.onSurface, marginBottom: spacing.lg },
  moodGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  moodChip: {
    width: "31%",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1.5,
    borderColor: c.border,
  },
  moodChipActive: { backgroundColor: c.brandTertiary, borderColor: c.brandPrimary },
  moodEmoji: { fontSize: 30 },
  moodLabel: { fontFamily: "Nunito", fontSize: 12, color: c.onSurfaceTertiary, marginTop: spacing.xs, fontWeight: "600" },
  moodLabelActive: { color: c.onBrandTertiary },
  noteInput: {
    marginTop: spacing.lg,
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontFamily: "Nunito",
    fontSize: 15,
    color: c.onSurface,
    minHeight: 64,
    borderWidth: 1,
    borderColor: c.border,
  },
  saveBtn: { marginTop: spacing.lg, backgroundColor: c.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center" },
  saveText: { fontFamily: "Nunito", fontSize: 16, fontWeight: "700", color: c.onBrandPrimary },
}));
