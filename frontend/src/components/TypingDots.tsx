import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
} from "react-native-reanimated";

function Dot({ delay, color }: { delay: number; color: string }) {
  const o = useSharedValue(0.3);
  useEffect(() => {
    o.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 480, easing: Easing.inOut(Easing.ease) }), -1, true),
    );
  }, [delay, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }, style]}
    />
  );
}

export function TypingDots({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
      <Dot delay={0} color={color} />
      <Dot delay={160} color={color} />
      <Dot delay={320} color={color} />
    </View>
  );
}
