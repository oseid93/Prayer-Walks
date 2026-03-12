import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  Pressable,
  Modal,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getApiUrl } from "@/lib/query-client";
import { useAuth } from "@/lib/auth-context";
import { setMapFocusZone } from "@/lib/map-focus";

interface MemberStats {
  userId: string;
  displayName: string;
  role: string;
  sessionCount: number;
  totalDistance: number;
  totalDuration: number;
}

interface GroupStats {
  memberCount: number;
  sessionCount: number;
  totalDistance: number;
  totalDuration: number;
}

interface PriorityArea {
  id: string;
  name: string;
  color: string;
  coordinates: Array<{ latitude: number; longitude: number }>;
  createdAt: string;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

export default function GroupDetailScreen() {
  const { id, name } = useLocalSearchParams<{
    id: string;
    name: string;
  }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const [confirmRemove, setConfirmRemove] = useState<MemberStats | null>(null);
  const [confirmRoleChange, setConfirmRoleChange] = useState<{
    member: MemberStats;
    newRole: string;
  } | null>(null);

  const { user } = useAuth();

  const { data: myRoleData } = useQuery<{ role: string }>({
    queryKey: [`/api/groups/${id}/my-role`],
  });
  const isAdmin = myRoleData?.role === "admin";

  const { data: members, isLoading: membersLoading } = useQuery<MemberStats[]>({
    queryKey: [`/api/groups/${id}/members`],
    enabled: isAdmin,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<GroupStats>({
    queryKey: [`/api/groups/${id}/stats`],
    enabled: !isAdmin,
  });

  const { data: adminStats, isLoading: adminStatsLoading } = useQuery<GroupStats>({
    queryKey: [`/api/groups/${id}/stats`],
    enabled: isAdmin,
  });

  const { data: priorityAreas } = useQuery<PriorityArea[]>({
    queryKey: [`/api/groups/${id}/priority-areas`],
  });

  const deleteAreaMutation = useMutation({
    mutationFn: async (areaId: string) => {
      const url = new URL(
        `/api/groups/${id}/priority-areas/${areaId}`,
        getApiUrl(),
      );
      const res = await apiRequest("DELETE", url.pathname);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/groups/${id}/priority-areas`],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/my-priority-areas"] });
    },
    onError: () => {
      Alert.alert("Error", "Failed to delete priority zone");
    },
  });

  const handleZoneTap = useCallback((area: PriorityArea) => {
    if (!area.coordinates.length) return;
    const lats = area.coordinates.map((c) => c.latitude);
    const lngs = area.coordinates.map((c) => c.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const padding = 1.4;
    setMapFocusZone({
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * padding, 0.005),
      longitudeDelta: Math.max((maxLng - minLng) * padding, 0.005),
    });
    router.push("/(tabs)");
  }, [router]);

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const url = new URL(`/api/groups/${id}/members/${userId}`, getApiUrl());
      const res = await apiRequest("DELETE", url.pathname);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/groups/${id}/members`] });
      queryClient.invalidateQueries({ queryKey: [`/api/groups/${id}/stats`] });
      setConfirmRemove(null);
    },
    onError: () => {
      Alert.alert("Error", "Failed to remove member");
      setConfirmRemove(null);
    },
  });

  const roleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const url = new URL(
        `/api/groups/${id}/members/${userId}/role`,
        getApiUrl(),
      );
      const res = await apiRequest("PATCH", url.pathname, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/groups/${id}/members`] });
      setConfirmRoleChange(null);
    },
    onError: () => {
      Alert.alert("Error", "Failed to update role");
      setConfirmRoleChange(null);
    },
  });

  const renderMember = ({ item }: { item: MemberStats }) => (
    <View style={styles.memberCard}>
      <View style={styles.memberAvatar}>
        <Text style={styles.memberInitial}>
          {item.displayName.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.memberInfo}>
        <View style={styles.memberNameRow}>
          <Text style={styles.memberName}>{item.displayName}</Text>
          {item.role === "admin" && (
            <View style={styles.adminBadge}>
              <Text style={styles.adminBadgeText}>Admin</Text>
            </View>
          )}
          {item.userId === user?.id && (
            <View style={styles.youBadge}>
              <Text style={styles.youBadgeText}>You</Text>
            </View>
          )}
        </View>
        <View style={styles.memberStats}>
          <View style={styles.statPill}>
            <Feather name="activity" size={11} color="#9CA3AF" />
            <Text style={styles.statPillText}>{item.sessionCount} walks</Text>
          </View>
          <View style={styles.statPill}>
            <Feather name="map-pin" size={11} color="#9CA3AF" />
            <Text style={styles.statPillText}>
              {formatDistance(item.totalDistance)}
            </Text>
          </View>
          <View style={styles.statPill}>
            <Feather name="clock" size={11} color="#9CA3AF" />
            <Text style={styles.statPillText}>
              {formatDuration(item.totalDuration)}
            </Text>
          </View>
        </View>
      </View>
      {item.userId !== user?.id && (
        <View style={styles.memberActions}>
          <Pressable
            onPress={() =>
              setConfirmRoleChange({
                member: item,
                newRole: item.role === "admin" ? "participant" : "admin",
              })
            }
            style={({ pressed }) => [
              styles.actionBtn,
              { opacity: pressed ? 0.6 : 1 },
            ]}
            hitSlop={8}
          >
            <Feather
              name={item.role === "admin" ? "shield-off" : "shield"}
              size={16}
              color={item.role === "admin" ? "#FF9500" : "#33C3F0"}
            />
          </Pressable>
          <Pressable
            onPress={() => setConfirmRemove(item)}
            style={({ pressed }) => [
              styles.actionBtn,
              { opacity: pressed ? 0.6 : 1 },
            ]}
            hitSlop={8}
          >
            <Feather name="user-x" size={16} color="#FF3B30" />
          </Pressable>
        </View>
      )}
    </View>
  );

  const currentStats = isAdmin ? adminStats : stats;
  const currentStatsLoading = isAdmin ? adminStatsLoading : statsLoading;

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + webTopInset },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
          hitSlop={8}
        >
          <Feather name="arrow-left" size={22} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.rolePill}>
          <Feather
            name={isAdmin ? "shield" : "user"}
            size={12}
            color={isAdmin ? "#FFCC00" : "#9CA3AF"}
          />
          <Text
            style={[
              styles.rolePillText,
              { color: isAdmin ? "#FFCC00" : "#9CA3AF" },
            ]}
          >
            {isAdmin ? "Admin" : "Member"}
          </Text>
        </View>
      </View>

      {currentStatsLoading ? null : currentStats ? (
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Feather name="users" size={18} color="#33C3F0" />
            <Text style={styles.statValue}>{currentStats.memberCount}</Text>
            <Text style={styles.statLabel}>Members</Text>
          </View>
          <View style={styles.statCard}>
            <Feather name="activity" size={18} color="#4CD964" />
            <Text style={styles.statValue}>{currentStats.sessionCount}</Text>
            <Text style={styles.statLabel}>Walks</Text>
          </View>
          <View style={styles.statCard}>
            <Feather name="map-pin" size={18} color="#FF9500" />
            <Text style={styles.statValue}>
              {formatDistance(currentStats.totalDistance)}
            </Text>
            <Text style={styles.statLabel}>Distance</Text>
          </View>
          <View style={styles.statCard}>
            <Feather name="clock" size={18} color="#FF3B30" />
            <Text style={styles.statValue}>
              {formatDuration(currentStats.totalDuration)}
            </Text>
            <Text style={styles.statLabel}>Time</Text>
          </View>
        </View>
      ) : null}

      {isAdmin ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <Text style={styles.sectionTitle}>Members</Text>
          {membersLoading ? (
            <ActivityIndicator color="#33C3F0" style={{ marginVertical: 20 }} />
          ) : !members || members.length === 0 ? (
            <Text style={styles.emptyText}>No members yet</Text>
          ) : (
            members.map((item) => (
              <React.Fragment key={item.userId}>
                {renderMember({ item })}
                <View style={{ height: 8 }} />
              </React.Fragment>
            ))
          )}

          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Priority Zones</Text>
          {!priorityAreas || priorityAreas.length === 0 ? (
            <View style={styles.zonesEmpty}>
              <Feather name="map" size={24} color="#4B5563" />
              <Text style={styles.zonesEmptyText}>
                No zones yet. Draw one on the map.
              </Text>
            </View>
          ) : (
            priorityAreas.map((area) => (
              <Pressable
                key={area.id}
                style={({ pressed }) => [
                  styles.zoneCard,
                  { opacity: pressed ? 0.75 : 1 },
                ]}
                onPress={() => handleZoneTap(area)}
              >
                <View style={[styles.zoneColorBar, { backgroundColor: area.color }]} />
                <View style={styles.zoneInfo}>
                  <Text style={styles.zoneName}>{area.name}</Text>
                  <Text style={styles.zonePoints}>
                    {area.coordinates.length} points — tap to view on map
                  </Text>
                </View>
                <Pressable
                  onPress={() =>
                    Alert.alert(
                      "Delete Zone",
                      `Remove "${area.name}"? This cannot be undone.`,
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () => deleteAreaMutation.mutate(area.id),
                        },
                      ],
                    )
                  }
                  style={({ pressed }) => [
                    styles.actionBtn,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                  hitSlop={8}
                >
                  <Feather name="trash-2" size={16} color="#FF3B30" />
                </Pressable>
              </Pressable>
            ))
          )}
          <View style={{ height: 100 }} />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.participantContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.participantMessage}>
            <Feather name="lock" size={32} color="#4B5563" />
            <Text style={styles.participantTitle}>Group Overview</Text>
            <Text style={styles.participantSubtext}>
              Only admins can see individual member details. Your walks
              contribute to the shared group stats above.
            </Text>
          </View>

          {priorityAreas && priorityAreas.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Priority Zones</Text>
              {priorityAreas.map((area) => (
                <Pressable
                  key={area.id}
                  style={({ pressed }) => [
                    styles.zoneCard,
                    { marginBottom: 8, opacity: pressed ? 0.75 : 1 },
                  ]}
                  onPress={() => handleZoneTap(area)}
                >
                  <View style={[styles.zoneColorBar, { backgroundColor: area.color }]} />
                  <View style={styles.zoneInfo}>
                    <Text style={styles.zoneName}>{area.name}</Text>
                    <Text style={styles.zonePoints}>
                      {area.coordinates.length} points — tap to view on map
                    </Text>
                  </View>
                  <Feather name="map-pin" size={16} color="#6B7280" style={{ marginRight: 14 }} />
                </Pressable>
              ))}
            </>
          )}
        </ScrollView>
      )}

      <Modal
        visible={!!confirmRemove}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmRemove(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Feather name="user-x" size={32} color="#FF3B30" style={{ alignSelf: "center" }} />
            <Text style={styles.modalTitle}>Remove Member</Text>
            <Text style={styles.modalBody}>
              Remove{" "}
              <Text style={{ color: "#FFFFFF", fontFamily: "Inter_600SemiBold" }}>
                {confirmRemove?.displayName}
              </Text>{" "}
              from this group? They will lose access immediately.
            </Text>
            <View style={styles.modalButtons}>
              <Pressable
                onPress={() => setConfirmRemove(null)}
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.cancelBtn,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  confirmRemove && removeMutation.mutate(confirmRemove.userId)
                }
                disabled={removeMutation.isPending}
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.dangerBtn,
                  { opacity: pressed || removeMutation.isPending ? 0.7 : 1 },
                ]}
              >
                {removeMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.dangerBtnText}>Remove</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!confirmRoleChange}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmRoleChange(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Feather
              name={
                confirmRoleChange?.newRole === "admin" ? "shield" : "shield-off"
              }
              size={32}
              color={
                confirmRoleChange?.newRole === "admin" ? "#FFCC00" : "#FF9500"
              }
              style={{ alignSelf: "center" }}
            />
            <Text style={styles.modalTitle}>
              {confirmRoleChange?.newRole === "admin"
                ? "Make Admin"
                : "Remove Admin"}
            </Text>
            <Text style={styles.modalBody}>
              {confirmRoleChange?.newRole === "admin"
                ? `Give ${confirmRoleChange?.member.displayName} admin access? They will be able to manage members.`
                : `Remove admin access from ${confirmRoleChange?.member.displayName}? They will become a participant.`}
            </Text>
            <View style={styles.modalButtons}>
              <Pressable
                onPress={() => setConfirmRoleChange(null)}
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.cancelBtn,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  confirmRoleChange &&
                  roleMutation.mutate({
                    userId: confirmRoleChange.member.userId,
                    role: confirmRoleChange.newRole,
                  })
                }
                disabled={roleMutation.isPending}
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.confirmBtn,
                  { opacity: pressed || roleMutation.isPending ? 0.7 : 1 },
                ]}
              >
                {roleMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmBtnText}>Confirm</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#1A1A2E",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
  },
  rolePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#1A1A2E",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  rolePillText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600" as const,
  },
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#1A1A2E",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    gap: 6,
  },
  statValue: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
  },
  statLabel: {
    fontSize: 10,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: "#6B7280",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === "web" ? 84 : 100,
    gap: 8,
  },
  memberCard: {
    backgroundColor: "#1A1A2E",
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  memberAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(51, 195, 240, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  memberInitial: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: "#33C3F0",
    fontFamily: "Inter_700Bold",
  },
  memberInfo: {
    flex: 1,
    gap: 6,
  },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  memberName: {
    fontSize: 15,
    fontWeight: "600" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_600SemiBold",
  },
  adminBadge: {
    backgroundColor: "rgba(255, 204, 0, 0.15)",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  adminBadgeText: {
    fontSize: 11,
    color: "#FFCC00",
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600" as const,
  },
  youBadge: {
    backgroundColor: "rgba(51, 195, 240, 0.12)",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  youBadgeText: {
    fontSize: 11,
    color: "#33C3F0",
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600" as const,
  },
  memberStats: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  statPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  statPillText: {
    fontSize: 11,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
  },
  memberActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
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
    paddingBottom: 100,
  },
  emptyText: {
    fontSize: 16,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  participantContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  zonesEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 16,
    backgroundColor: "#1A1A2E",
    borderRadius: 12,
    marginBottom: 8,
  },
  zonesEmptyText: {
    fontSize: 14,
    color: "#4B5563",
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  zoneCard: {
    backgroundColor: "#1A1A2E",
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    marginBottom: 8,
  },
  zoneColorBar: {
    width: 5,
    alignSelf: "stretch",
  },
  zoneInfo: {
    flex: 1,
    padding: 14,
    gap: 3,
  },
  zoneName: {
    fontSize: 15,
    fontWeight: "600" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_600SemiBold",
  },
  zonePoints: {
    fontSize: 12,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
  },
  participantMessage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 40,
    gap: 12,
    paddingHorizontal: 24,
  },
  participantTitle: {
    fontSize: 18,
    fontWeight: "600" as const,
    color: "#9CA3AF",
    fontFamily: "Inter_600SemiBold",
  },
  participantSubtext: {
    fontSize: 14,
    color: "#4B5563",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContent: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#1A1A2E",
    borderRadius: 16,
    padding: 24,
    gap: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  modalBody: {
    fontSize: 14,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelBtn: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  cancelBtnText: {
    color: "#9CA3AF",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600" as const,
  },
  dangerBtn: {
    backgroundColor: "#FF3B30",
  },
  dangerBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600" as const,
  },
  confirmBtn: {
    backgroundColor: "#33C3F0",
  },
  confirmBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600" as const,
  },
});
