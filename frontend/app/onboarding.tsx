import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Feather from "@react-native-vector-icons/feather";

import { makeStyles, spacing, radius, useTheme } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useToast } from "@/src/components/Toast";
import { haptic } from "@/src/haptics";

export default function Onboarding() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setSession } = useAuth();
  const toast = useToast();

  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.show("Tell us your name first");
      return;
    }
    if (mode === "join" && !code.trim()) {
      toast.show("Enter your partner's code");
      return;
    }
    setLoading(true);
    haptic.medium();
    try {
      const res =
        mode === "create"
          ? await api.post("/couples/create", { name: name.trim() })
          : await api.post("/couples/join", { name: name.trim(), code: code.trim() });
      await setSession(res.user_id);
      haptic.success();
      router.replace("/(tabs)");
    } catch (e: any) {
      toast.show(e.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing["2xl"] }]}
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoWrap}>
          <Image source={require("../assets/images/logo.png")} style={styles.logo} contentFit="contain" transition={300} />
        </View>
        <Text style={styles.hello}>welcome to your little corner</Text>
        <Text style={styles.title}>Just the two of us</Text>
        <Text style={styles.subtitle}>
          A private space for you and your partner. Connect with a code, then share moods, memories and quiet worries.
        </Text>

        <View style={styles.segment}>
          <Pressable
            testID="mode-create"
            style={[styles.segBtn, mode === "create" && styles.segBtnActive]}
            onPress={() => { setMode("create"); haptic.light(); }}
          >
            <Text style={[styles.segText, mode === "create" && styles.segTextActive]}>Start a space</Text>
          </Pressable>
          <Pressable
            testID="mode-join"
            style={[styles.segBtn, mode === "join" && styles.segBtnActive]}
            onPress={() => { setMode("join"); haptic.light(); }}
          >
            <Text style={[styles.segText, mode === "join" && styles.segTextActive]}>Join with a code</Text>
          </Pressable>
        </View>

        <View style={styles.field}>
          <Feather name="user" size={18} color={colors.muted} />
          <TextInput
            testID="name-input"
            style={styles.input}
            placeholder="Your name"
            placeholderTextColor={colors.muted}
            value={name}
            onChangeText={setName}
            maxLength={24}
            returnKeyType="next"
          />
        </View>

        {mode === "join" ? (
          <View style={styles.field}>
            <Feather name="key" size={18} color={colors.muted} />
            <TextInput
              testID="code-input"
              style={[styles.input, { letterSpacing: 3, textTransform: "uppercase" }]}
              placeholder="6-digit code"
              placeholderTextColor={colors.muted}
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              maxLength={6}
              autoCapitalize="characters"
              returnKeyType="done"
            />
          </View>
        ) : null}

        <Pressable testID="onboarding-submit" style={styles.cta} onPress={submit} disabled={loading}>
          {loading ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <>
              <Text style={styles.ctaText}>{mode === "create" ? "Create our space" : "Join now"}</Text>
              <Feather name="heart" size={18} color={colors.onBrandPrimary} />
            </>
          )}
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.xl },
  logoWrap: { alignItems: "center", marginBottom: spacing.lg },
  logo: { width: 150, height: 150, borderRadius: radius.lg },
  hello: { fontFamily: "Caveat", fontSize: 26, color: c.brandPrimary, marginBottom: -spacing.xs, textAlign: "center" },
  title: { fontFamily: "Fraunces", fontSize: 34, color: c.onSurface, fontWeight: "700", textAlign: "center" },
  subtitle: { fontFamily: "Nunito", fontSize: 15, lineHeight: 22, color: c.onSurfaceTertiary, marginTop: spacing.sm, marginBottom: spacing.xl, textAlign: "center" },
  segment: { flexDirection: "row", backgroundColor: c.surfaceSecondary, borderRadius: radius.pill, padding: spacing.xs, marginBottom: spacing.lg },
  segBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.pill, alignItems: "center" },
  segBtnActive: { backgroundColor: c.brandPrimary },
  segText: { fontFamily: "Nunito", fontSize: 14, color: c.onSurfaceTertiary, fontWeight: "600" },
  segTextActive: { color: c.onBrandPrimary },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: spacing.md,
  },
  input: { flex: 1, fontFamily: "Nunito", fontSize: 16, color: c.onSurface, paddingVertical: spacing.lg },
  cta: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: c.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
  },
  ctaText: { fontFamily: "Nunito", fontSize: 17, fontWeight: "700", color: c.onBrandPrimary },
}));
