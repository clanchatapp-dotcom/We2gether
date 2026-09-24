import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus, Pressable, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather";
import { pingBackend } from "@/src/api";
import { makeStyles, spacing, radius, useTheme } from "@/src/theme";

type Status = "checking" | "ok" | "down";

/**
 * Silent when the backend answers. If the server is asleep or unreachable it
 * shows a warning banner at the top, keeps retrying in the background, and
 * disappears the moment the backend responds. Re-checks on foreground so a
 * server that fell asleep while the app was open is caught too.
 */
export function BackendHealth() {
  const [status, setStatus] = useState<Status>("checking");
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const runningRef = useRef(false);
  const mountedRef = useRef(true);

  const check = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      // Keep trying until reachable; the first ping also wakes a sleeping Render dyno.
      while (mountedRef.current) {
        const ok = await pingBackend();
        if (!mountedRef.current) return;
        if (ok) {
          setStatus("ok");
          return;
        }
        setStatus("down");
        await new Promise((r) => setTimeout(r, 4000));
      }
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    check();
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") check();
    });
    return () => {
      mountedRef.current = false;
      sub.remove();
    };
  }, [check]);

  if (status !== "down") return null;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + spacing.sm }]}>
      <Animated.View entering={FadeInUp} exiting={FadeOutUp} style={styles.banner} testID="backend-health-banner">
        <Feather name="wifi-off" size={18} color={colors.onWarning} style={styles.icon} />
        <Text style={styles.text} testID="backend-health-text">
          Can&apos;t reach the server — it may be waking up. Retrying…
        </Text>
        <Pressable
          onPress={check}
          hitSlop={8}
          style={styles.retry}
          testID="backend-health-retry"
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.warning,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    maxWidth: "100%",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  icon: { marginRight: spacing.sm },
  text: {
    flex: 1,
    color: c.onWarning,
    fontFamily: "Nunito",
    fontSize: 13,
  },
  retry: {
    marginLeft: spacing.sm,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: c.onWarning,
  },
  retryText: {
    color: c.warning,
    fontFamily: "Nunito",
    fontSize: 13,
    fontWeight: "700",
  },
}));
