import "react-native-gesture-handler";
import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { ActivityIndicator, LogBox, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider, useAuth } from "@/src/auth";
import { ToastProvider } from "@/src/components/Toast";
import { PushManager } from "@/src/push";
import { useTheme } from "@/src/theme";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync().catch(() => {});

// --- Push: foreground display behavior (module scope, before any component) ---
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// --- Push: Android default channel (module scope) ---
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
  });
}

function ThemedStack() {
  const { colors } = useTheme();
  const { ready } = useAuth();
  // Wait until the stored session is loaded so no screen fires an authed
  // request before X-User-Id is set (avoids transient 401s on cold deep-links).
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="worry/[id]" options={{ presentation: "card" }} />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  const router = useRouter();

  const [loaded] = useFonts({
    Fraunces: require("../assets/fonts/Fraunces.ttf"),
    Nunito: require("../assets/fonts/Nunito.ttf"),
    "Nunito-Italic": require("../assets/fonts/Nunito-Italic.ttf"),
    Caveat: require("../assets/fonts/Caveat.ttf"),
    Feather: require("@react-native-vector-icons/feather/fonts/Feather.ttf"),
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  // --- Push: tap handlers (warm + cold start) ---
  useEffect(() => {
    if (Platform.OS === "web") return;

    const openFromData = (data: any) => {
      const url = data?.deeplink || data?.action_url;
      if (!url) return;
      if (typeof url === "string" && url.startsWith("http")) Linking.openURL(url);
      else router.push(url);
    };

    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
      openFromData(response.notification.request.content.data || {});
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) openFromData(response.notification.request.content.data || {});
    });

    return () => {
      tapSub.remove();
    };
  }, [router]);

  if (!loaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <KeyboardProvider>
                <ToastProvider>
                  <ThemedStack />
                  <PushManager />
                </ToastProvider>
              </KeyboardProvider>
            </AuthProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
