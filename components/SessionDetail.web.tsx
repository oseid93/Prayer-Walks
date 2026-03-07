import React from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { formatDuration, formatDistance } from "@/lib/coverage-utils";

interface Session {
  id: string;
  startedAt: string;
  endedAt: string | null;
  totalDistance: number;
  totalDuration: number;
}

interface RoutePoint {
  latitude: number;
  longitude: number;
}

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: points, isLoading: pointsLoading } = useQuery<RoutePoint[]>({
    queryKey: ["/api/sessions", id, "points"],
    enabled: !!id,
  });

  const { data: sessions } = useQuery<Session[]>({
    queryKey: ["/api/sessions"],
  });

  const session = sessions?.find((s) => s.id === id);

  const formatDate = (dateStr: string): string => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 67 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          testID="back-button"
        >
          <Feather name="arrow-left" size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Walk Details</Text>
        <View style={{ width: 40 }} />
      </View>

      {session && (
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Feather name="calendar" size={14} color="#9CA3AF" />
            <Text style={styles.statText}>
              {formatDate(session.startedAt)}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Feather name="clock" size={14} color="#33C3F0" />
            <Text style={styles.statText}>
              {formatDuration(session.totalDuration || 0)}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Feather name="navigation" size={14} color="#4CD964" />
            <Text style={styles.statText}>
              {formatDistance(session.totalDistance || 0)}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.mapContainer}>
        {pointsLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color="#33C3F0" />
          </View>
        ) : (
          <View style={styles.centerContainer}>
            <Feather name="map" size={40} color="#6B7280" />
            <Text style={styles.emptyText}>
              Route map available on mobile
            </Text>
            {points && (
              <Text style={styles.subText}>
                {points.length} points recorded
              </Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F0F23",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1A1A2E",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_600SemiBold",
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#1A1A2E",
    marginHorizontal: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statText: {
    fontSize: 13,
    color: "#FFFFFF",
    fontFamily: "Inter_400Regular",
  },
  mapContainer: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#1A1A2E",
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
  },
  subText: {
    fontSize: 13,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
  },
});
