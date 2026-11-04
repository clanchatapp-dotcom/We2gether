import { StyleProp, Text, View, ViewStyle } from "react-native";
import Feather from "@react-native-vector-icons/feather";
import { formatMinutesLeft, useMinutesLeft } from "@/src/useMinutesLeft";

// Live "Xm left" pill for one-hour media.
export function ExpiryBadge({
  expiresAt,
  style,
  testID,
}: {
  expiresAt?: string | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const mins = useMinutesLeft(expiresAt);
  return (
    <View
      testID={testID}
      style={[
        {
          position: "absolute",
          top: 8,
          left: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 3,
          backgroundColor: "rgba(0,0,0,0.6)",
          borderRadius: 999,
          paddingHorizontal: 7,
          paddingVertical: 4,
        },
        style,
      ]}
    >
      <Feather name="clock" size={11} color="#FFFFFF" />
      <Text style={{ fontFamily: "Nunito", fontSize: 11, fontWeight: "700", color: "#FFFFFF" }}>
        {formatMinutesLeft(mins)}
      </Text>
    </View>
  );
}
