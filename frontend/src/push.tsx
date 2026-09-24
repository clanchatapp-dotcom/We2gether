import React, { useEffect, useRef, useState } from "react";
import { AppState, Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import * as Notifications from "expo-notifications";

import { useAuth } from "@/src/auth";
import { storage } from "@/src/utils/storage";
import { makeStyles, spacing, radius, useTheme } from "@/src/theme";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const NUDGE_KEY = "pushNudgeAt";
const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

type RegisterResult = { status: string; canAskAgain?: boolean };

// Ask permission (once, respecting canAskAgain), grab the native FCM/APNs token,
// and register it with the backend relay. Never throws to the caller.
export async function registerForPush(userId: string): Promise<RegisterResult> {
  if (Platform.OS === "web") return { status: "web" };
  try {
    let { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status !== "granted" && canAskAgain) {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
      canAskAgain = req.canAskAgain;
    }
    if (status !== "granted") return { status, canAskAgain };

    const tokenResp = await Notifications.getDevicePushTokenAsync();
    await fetch(`${BASE}/api/register-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        platform: Platform.OS,
        device_token: tokenResp.data,
      }),
    });
    return { status };
  } catch (e) {
    console.warn("registerForPush failed", e);
    return { status: "error" };
  }
}

// Mounted inside the providers. Registers on login + every foreground, and shows
// a weekly "Open Settings" nudge when the user has permanently denied permission.
export function PushManager() {
  const { userId } = useAuth();
  const [nudge, setNudge] = useState(false);
  const styles = useStyles();
  const { colors } = useTheme();
  const registered = useRef(false);

  const run = React.useCallback(async () => {
    if (!userId || Platform.OS === "web") return;
    const res = await registerForPush(userId);
    if (res.status === "denied" && res.canAskAgain === false) {
      const last = await storage.getItem<number>(NUDGE_KEY, 0);
      if (!last || Date.now() - Number(last) > ONE_WEEK) setNudge(true);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      registered.current = false;
      return;
    }
    if (!registered.current) {
      registered.current = true;
      run();
    }
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") run();
    });
    return () => sub.remove();
  }, [userId, run]);

  const dismissNudge = async (openSettings: boolean) => {
    await storage.setItem(NUDGE_KEY, Date.now());
    setNudge(false);
    if (openSettings) Linking.openSettings();
  };

  return (
    <Modal visible={nudge} transparent animationType="fade" onRequestClose={() => dismissNudge(false)}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="push-nudge-modal">
          <Text style={styles.title}>Stay in the loop 💞</Text>
          <Text style={styles.body}>
            Turn on notifications so you never miss a message, mood or worry from your partner.
          </Text>
          <Pressable
            testID="push-nudge-settings"
            style={styles.primaryBtn}
            onPress={() => dismissNudge(true)}
          >
            <Text style={styles.primaryText}>Open Settings</Text>
          </Pressable>
          <Pressable
            testID="push-nudge-later"
            style={styles.secondaryBtn}
            onPress={() => dismissNudge(false)}
          >
            <Text style={[styles.secondaryText, { color: colors.muted }]}>Maybe later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  title: { fontFamily: "Fraunces", fontSize: 22, color: c.onSurface, marginBottom: spacing.sm },
  body: { fontFamily: "Nunito", fontSize: 15, color: c.onSurfaceSecondary, lineHeight: 22, marginBottom: spacing.lg },
  primaryBtn: {
    backgroundColor: c.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  primaryText: { fontFamily: "Nunito", fontSize: 16, color: c.onBrandPrimary, fontWeight: "700" },
  secondaryBtn: { paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xs },
  secondaryText: { fontFamily: "Nunito", fontSize: 15 },
}));
