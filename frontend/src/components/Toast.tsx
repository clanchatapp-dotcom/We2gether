import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles, spacing } from "@/src/theme";

type ToastContextType = { show: (msg: string) => void };
const ToastContext = createContext<ToastContextType>({ show: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<any>(null);
  const insets = useSafeAreaInsets();
  const styles = useStyles();

  const show = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2200);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {msg ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wrap, { paddingTop: insets.top + spacing.md }]}>
          <Animated.View entering={FadeInDown} exiting={FadeOutUp} style={styles.toast}>
            <Text style={styles.text} testID="app-toast">{msg}</Text>
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const useStyles = makeStyles((c) => ({
  wrap: { alignItems: "center", justifyContent: "flex-start" },
  toast: {
    backgroundColor: c.surfaceInverse,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 999,
    maxWidth: "88%",
  },
  text: { color: c.onSurfaceInverse, fontFamily: "Nunito", fontSize: 14, textAlign: "center" },
}));
