import React from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  Platform,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { queryClient } from "@/lib/query-client";
import { formatDuration, formatDistance } from "@/lib/coverage-utils";

interface Session {
  id: string;
  startedAt: string;
  endedAt: string | null;
  totalDistance: number;
  totalDuration: number;
  isActive: boolean;
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const {
    data: sessions,
    isLoading,
    isRefetching,
  } = useQuery<Session[]>({
    queryKey: ["/api/sessions"],
  });

  const completedSessions = (sessions || []).filter((s) => !s.isActive);

  const totalDistance = completedSessions.reduce(
    (sum, s) => sum + (s.totalDistance || 0),
    0,
  );
  const totalTime = completedSessions.reduce(
    (sum, s) => sum + (s.totalDuration || 0),
    0,
  );

  const formatDate = (dateStr: string): string => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;

    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  };

  const renderSession = ({ item }: { item: Session }) => (
    <Pressable
      style={({ pressed }) => [
        styles.sessionCard,
        pressed && styles.sessionCardPressed,
      ]}
      onPress={() => router.push(`/session/${item.id}`)}
      testID={`session-${item.id}`}
    >
      <View style={styles.sessionHeader}>
        <Text style={styles.sessionDate}>{formatDate(item.startedAt)}</Text>
        <View style={styles.sessionRight}>
          {item.isActive && (
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>Active</Text>
            </View>
          )}
          <Feather name="chevron-right" size={18} color="#6B7280" />
        </View>
      </View>
      <View style={styles.sessionStats}>
        <View style={styles.sessionStat}>
          <Feather name="clock" size={14} color="#33C3F0" />
          <Text style={styles.sessionStatValue}>
            {formatDuration(item.totalDuration || 0)}
          </Text>
        </View>
        <View style={styles.sessionStat}>
          <Feather name="navigation" size={14} color="#4CD964" />
          <Text style={styles.sessionStatValue}>
            {formatDistance(item.totalDistance || 0)}
          </Text>
        </View>
      </View>
    </Pressable>
  );

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + webTopInset },
      ]}
    >
      <Text style={styles.title}>Walking History</Text>

      <View style={styles.summaryContainer}>
        <View style={styles.summaryCard}>
          <Feather name="map-pin" size={20} color="#33C3F0" />
          <Text style={styles.summaryValue}>{completedSessions.length}</Text>
          <Text style={styles.summaryLabel}>Walks</Text>
        </View>
        <View style={styles.summaryCard}>
          <Feather name="navigation" size={20} color="#4CD964" />
          <Text style={styles.summaryValue}>{formatDistance(totalDistance)}</Text>
          <Text style={styles.summaryLabel}>Total Distance</Text>
        </View>
        <View style={styles.summaryCard}>
          <Feather name="clock" size={20} color="#FF9500" />
          <Text style={styles.summaryValue}>{formatDuration(totalTime)}</Text>
          <Text style={styles.summaryLabel}>Total Time</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#33C3F0" />
        </View>
      ) : completedSessions.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Feather name="map" size={40} color="#6B7280" />
          <Text style={styles.emptyText}>No walks yet</Text>
          <Text style={styles.emptySubtext}>
            Start tracking from the Map tab to see your history here
          </Text>
        </View>
      ) : (
        <FlatList
          data={completedSessions}
          renderItem={renderSession}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() =>
                queryClient.invalidateQueries({
                  queryKey: ["/api/sessions"],
                })
              }
              tintColor="#33C3F0"
            />
          }
          scrollEnabled={completedSessions.length > 0}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F0F23",
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "700" as const,
    color: "#FFFFFF",
    marginTop: 16,
    marginBottom: 16,
    fontFamily: "Inter_700Bold",
  },
  summaryContainer: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 20,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: "#1A1A2E",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    gap: 6,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  summaryLabel: {
    fontSize: 11,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
  },
  listContent: {
    paddingBottom: Platform.OS === "web" ? 84 : 100,
    gap: 10,
  },
  sessionCard: {
    backgroundColor: "#1A1A2E",
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  sessionCardPressed: {
    backgroundColor: "#252540",
  },
  sessionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sessionRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sessionDate: {
    fontSize: 15,
    fontWeight: "600" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_600SemiBold",
  },
  activeBadge: {
    backgroundColor: "rgba(76, 217, 100, 0.2)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  activeBadgeText: {
    fontSize: 11,
    color: "#4CD964",
    fontWeight: "600" as const,
    fontFamily: "Inter_600SemiBold",
  },
  sessionStats: {
    flexDirection: "row",
    gap: 20,
  },
  sessionStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sessionStatValue: {
    fontSize: 14,
    color: "#FFFFFF",
    fontFamily: "Inter_400Regular",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingBottom: 100,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_600SemiBold",
  },
  emptySubtext: {
    fontSize: 14,
    color: "#9CA3AF",
    textAlign: "center",
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 40,
  },
});
