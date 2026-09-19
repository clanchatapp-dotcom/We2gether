import { Platform } from "react-native";
import { Tabs } from "expo-router";
import Feather from "@react-native-vector-icons/feather";
import { usesNativeTabs } from "@/src/navigation";
import { useTheme } from "@/src/theme";

function NativeTabsLayout() {
  const { NativeTabs } = require("expo-router/unstable-native-tabs");
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf="heart.fill" />
        <NativeTabs.Trigger.Label>Us</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chat">
        <NativeTabs.Trigger.Icon sf="message.fill" />
        <NativeTabs.Trigger.Label>Chat</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="gallery">
        <NativeTabs.Trigger.Icon sf="photo.on.rectangle.fill" />
        <NativeTabs.Trigger.Label>Gallery</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="worries">
        <NativeTabs.Trigger.Icon sf="cloud.fill" />
        <NativeTabs.Trigger.Label>Worries</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function JsTabsLayout() {
  const { colors } = useTheme();
  const icon =
    (name: any) =>
    ({ color, size }: { color: string; size: number }) =>
      <Feather name={name} size={size} color={color} />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontFamily: "Nunito", fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Us", tabBarIcon: icon("heart") }} />
      <Tabs.Screen name="chat" options={{ title: "Chat", tabBarIcon: icon("message-circle") }} />
      <Tabs.Screen name="gallery" options={{ title: "Gallery", tabBarIcon: icon("image") }} />
      <Tabs.Screen name="worries" options={{ title: "Worries", tabBarIcon: icon("cloud-drizzle") }} />
    </Tabs>
  );
}

export default function TabsLayout() {
  return usesNativeTabs ? <NativeTabsLayout /> : <JsTabsLayout />;
}
