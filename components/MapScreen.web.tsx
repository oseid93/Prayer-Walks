import React from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useTracking } from "@/lib/tracking-context";
import { formatDuration, formatDistance } from "@/lib/coverage-utils";

export default function WebMapScreen() {
  const insets = useSafeAreaInsets();
  const webTopInset = 67;
  const {
    state,
    elapsedTime,
    distance,
    startTracking,
    stopTracking,
  } = useTracking();

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.webMapFallback}>
        <Feather name="map" size={48} color="#33C3F0" />
        <Text style={styles.webMapText}>
          Map view is available on mobile devices
        </Text>
        <Text style={styles.webMapSubtext}>
          Scan the QR code to open in Expo Go
        </Text>

        {state !== "idle" && (
          <View style={styles.webStatsContainer}>
            <View style={styles.statItem}>
              <Feather name="clock" size={20} color="#33C3F0" />
              <Text style={styles.statValue}>
                {formatDuration(elapsedTime)}
              </Text>
              <Text style={styles.statLabel}>Duration</Text>
            </View>
            <View style={styles.statItem}>
              <Feather name="navigation" size={20} color="#4CD964" />
              <Text style={styles.statValue}>{formatDistance(distance)}</Text>
              <Text style={styles.statLabel}>Distance</Text>
            </View>
          </View>
        )}

        <View style={styles.webControls}>
          {state === "idle" && (
            <Pressable
              onPress={startTracking}
              style={[styles.webButton, { backgroundColor: "#4CD964" }]}
            >
              <Feather name="play" size={20} color="#fff" />
              <Text style={styles.webButtonText}>Start Walking</Text>
            </Pressable>
          )}
          {state === "tracking" && (
            <Pressable
              onPress={stopTracking}
              style={[styles.webButton, { backgroundColor: "#FF3B30" }]}
            >
              <Feather name="square" size={20} color="#fff" />
              <Text style={styles.webButtonText}>Stop</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F0F23",
  },
  webMapFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 24,
  },
  webMapText: {
    fontSize: 18,
    color: "#FFFFFF",
    fontWeight: "600" as const,
    textAlign: "center",
    fontFamily: "Inter_600SemiBold",
  },
  webMapSubtext: {
    fontSize: 14,
    color: "#9CA3AF",
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  webStatsContainer: {
    flexDirection: "row",
    gap: 32,
    marginTop: 24,
    padding: 20,
    backgroundColor: "#1A1A2E",
    borderRadius: 16,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statValue: {
    fontSize: 16,
    fontWeight: "600" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_600SemiBold",
  },
  statLabel: {
    fontSize: 12,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
  },
  webControls: {
    marginTop: 16,
  },
  webButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  webButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600" as const,
    fontFamily: "Inter_600SemiBold",
  },
  webButtonRow: {
    flexDirection: "row",
    gap: 12,
  },
});
