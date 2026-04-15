import React, { useState, useMemo, useCallback } from "react";
import { StyleSheet, View, Text, Pressable, Platform, ActivityIndicator, Alert, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/query-client";
import { useAuth } from "@/lib/auth-context";
import { setMapFocusZone } from "@/lib/map-focus";

interface MemberStats { userId: string; displayName: string; role: string; sessionCount: number; totalDistance: number; totalDuration: number; }
interface BranchStats { memberCount: number; sessionCount: number; totalDistance: number; totalDuration: number; }
interface PriorityArea { id: string; name: string; color: string; coordinates: Array<{ latitude: number; longitude: number }>; }

function fmtDist(km: number) { return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`; }
function fmtDur(s: number) { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; }

export default function BranchDetailScreen() {
  const { id, name, role } = useLocalSearchParams<{ id: string; name: string; role: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const isAdmin = role === "admin";

  const { data: stats } = useQuery<BranchStats>({ queryKey: [`/api/branches/${id}/stats`] });
  const { data: members, isLoading: membersLoading } = useQuery<MemberStats[]>({
    queryKey: [`/api/branches/${id}/members`],
    enabled: isAdmin,
  });
  const { data: priorityAreas } = useQuery<PriorityArea[]>({ queryKey: [`/api/branches/${id}/priority-areas`] });

  type SortKey = "walks" | "distance" | "name";
  const [sortBy, setSortBy] = useState<SortKey>("walks");
  const sorted = useMemo(() => {
    if (!members) return [];
    return [...members].sort((a, b) =>
      sortBy === "walks" ? b.sessionCount - a.sessionCount :
      sortBy === "distance" ? b.totalDistance - a.totalDistance :
      a.displayName.localeCompare(b.displayName)
    );
  }, [members, sortBy]);

  const deleteAreaMutation = useMutation({
    mutationFn: async (areaId: string) => { await apiRequest("DELETE", `/api/branches/${id}/priority-areas/${areaId}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/branches/${id}/priority-areas`] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-priority-areas"] });
    },
    onError: () => Alert.alert("Error", "Failed to delete priority zone"),
  });

  const roleMutation = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: string }) => {
      await apiRequest("PATCH", `/api/branches/${id}/members/${userId}/role`, { role: newRole });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/branches/${id}/members`] }),
    onError: () => Alert.alert("Error", "Failed to update role"),
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => { await apiRequest("DELETE", `/api/branches/${id}/members/${userId}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/branches/${id}/members`] });
      queryClient.invalidateQueries({ queryKey: [`/api/branches/${id}/stats`] });
    },
    onError: () => Alert.alert("Error", "Failed to remove member"),
  });

  const handleZoneTap = useCallback((area: PriorityArea) => {
    if (!area.coordinates.length) return;
    const lats = area.coordinates.map((c) => c.latitude);
    const lngs = area.coordinates.map((c) => c.longitude);
    setMapFocusZone({
      latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
      longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
      latitudeDelta: Math.max((Math.max(...lats) - Math.min(...lats)) * 1.4, 0.005),
      longitudeDelta: Math.max((Math.max(...lngs) - Math.min(...lngs)) * 1.4, 0.005),
    });
    router.push("/(tabs)");
  }, [router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]} hitSlop={8}>
          <Feather name="arrow-left" size={22} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{name}</Text>
        <View style={styles.rolePill}>
          <Feather name={isAdmin ? "shield" : "user"} size={12} color={isAdmin ? "#FFCC00" : "#9CA3AF"} />
          <Text style={[styles.rolePillText, { color: isAdmin ? "#FFCC00" : "#9CA3AF" }]}>{isAdmin ? "Admin" : "Member"}</Text>
        </View>
      </View>

      {stats && (
        <View style={styles.statsRow}>
          {[
            { icon: "users", value: stats.memberCount, label: "Members", color: "#4CD964" },
            { icon: "activity", value: stats.sessionCount, label: "Walks", color: "#33C3F0" },
            { icon: "map-pin", value: fmtDist(stats.totalDistance), label: "Distance", color: "#FF9500" },
            { icon: "clock", value: fmtDur(stats.totalDuration), label: "Time", color: "#FF3B30" },
          ].map((s) => (
            <View key={s.label} style={styles.statCard}>
              <Feather name={s.icon as any} size={18} color={s.color} />
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {isAdmin ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Members</Text>
              <View style={styles.sortPills}>
                {(["walks", "distance", "name"] as SortKey[]).map((k) => (
                  <Pressable key={k} onPress={() => setSortBy(k)} style={[styles.sortPill, sortBy === k && styles.sortPillActive]}>
                    <Text style={[styles.sortPillText, sortBy === k && styles.sortPillTextActive]}>{k.charAt(0).toUpperCase() + k.slice(1)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {membersLoading ? (
              <ActivityIndicator color="#4CD964" style={{ marginVertical: 20 }} />
            ) : !members || members.length === 0 ? (
              <Text style={styles.emptyText}>No members yet</Text>
            ) : sorted.map((m) => (
              <View key={m.userId} style={styles.memberCard}>
                <View style={[styles.memberAvatar, { backgroundColor: "#4CD964" }]}>
                  <Text style={styles.memberInitial}>{m.displayName.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.memberInfo}>
                  <View style={styles.memberNameRow}>
                    <Text style={styles.memberName}>{m.displayName}</Text>
                    {m.role === "admin" && <View style={styles.adminBadge}><Text style={styles.adminBadgeText}>Admin</Text></View>}
                    {m.userId === user?.id && <View style={styles.youBadge}><Text style={styles.youBadgeText}>You</Text></View>}
                  </View>
                  <Text style={styles.memberStatText}>{m.sessionCount} walks · {fmtDist(m.totalDistance)}</Text>
                </View>
                {m.userId !== user?.id && (
                  <View style={styles.memberActions}>
                    <Pressable
                      onPress={() => Alert.alert(
                        m.role === "admin" ? "Remove Admin" : "Make Admin",
                        `${m.role === "admin" ? "Remove admin role from" : "Grant admin role to"} ${m.displayName}?`,
                        [{ text: "Cancel", style: "cancel" }, { text: "Confirm", onPress: () => roleMutation.mutate({ userId: m.userId, newRole: m.role === "admin" ? "participant" : "admin" }) }]
                      )}
                      style={styles.actionBtn} hitSlop={8}
                    >
                      <Feather name={m.role === "admin" ? "shield-off" : "shield"} size={16} color={m.role === "admin" ? "#FF9500" : "#4CD964"} />
                    </Pressable>
                    <Pressable
                      onPress={() => Alert.alert("Remove Member", `Remove ${m.displayName}?`, [
                        { text: "Cancel", style: "cancel" },
                        { text: "Remove", style: "destructive", onPress: () => removeMutation.mutate(m.userId) },
                      ])}
                      style={styles.actionBtn} hitSlop={8}
                    >
                      <Feather name="user-x" size={16} color="#FF3B30" />
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </>
        ) : (
          <View style={styles.memberMessage}>
            <Feather name="lock" size={32} color="#4B5563" />
            <Text style={styles.memberMessageTitle}>Members visible to admins only</Text>
          </View>
        )}

        {/* Priority Zones */}
        <Text style={[styles.sectionTitle, { marginTop: 20, marginBottom: 12 }]}>Priority Zones</Text>
        {!priorityAreas || priorityAreas.length === 0 ? (
          <View style={styles.zonesEmpty}>
            <Feather name="map" size={24} color="#4B5563" />
            <Text style={styles.emptyText}>{isAdmin ? "No zones yet. Draw one on the map." : "No priority zones for this branch."}</Text>
          </View>
        ) : priorityAreas.map((area) => (
          <Pressable
            key={area.id}
            onPress={() => handleZoneTap(area)}
            style={({ pressed }) => [styles.zoneCard, { opacity: pressed ? 0.75 : 1 }]}
          >
            <View style={[styles.zoneColorBar, { backgroundColor: area.color }]} />
            <View style={styles.zoneInfo}>
              <Text style={styles.zoneName}>{area.name}</Text>
              <Text style={styles.zonePoints}>{area.coordinates.length} points — tap to view</Text>
            </View>
            {isAdmin && (
              <Pressable
                onPress={() => Alert.alert("Delete Zone", `Remove "${area.name}"?`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: () => deleteAreaMutation.mutate(area.id) },
                ])}
                style={styles.actionBtn} hitSlop={8}
              >
                <Feather name="trash-2" size={16} color="#FF3B30" />
              </Pressable>
            )}
          </Pressable>
        ))}
        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F0F23" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  backBtn: { padding: 4 },
  title: { flex: 1, fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  rolePill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#1A1A35", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  rolePillText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  statsRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: "#1A1A35", borderRadius: 12, padding: 10, alignItems: "center", gap: 4 },
  statValue: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6B7280" },
  scroll: { paddingHorizontal: 16 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  sortPills: { flexDirection: "row", gap: 6 },
  sortPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: "#1A1A35" },
  sortPillActive: { backgroundColor: "#4CD964" },
  sortPillText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  sortPillTextActive: { color: "#0F0F23" },
  memberCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#1A1A35", borderRadius: 12, padding: 12, marginBottom: 8, gap: 12 },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  memberInitial: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  memberInfo: { flex: 1 },
  memberNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  memberName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  memberStatText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  adminBadge: { backgroundColor: "rgba(255,204,0,0.12)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  adminBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#FFCC00" },
  youBadge: { backgroundColor: "rgba(51,195,240,0.12)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  youBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#33C3F0" },
  memberActions: { flexDirection: "row", gap: 4 },
  actionBtn: { padding: 6 },
  memberMessage: { alignItems: "center", paddingVertical: 32, gap: 12 },
  memberMessageTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#9CA3AF" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center" },
  zonesEmpty: { alignItems: "center", gap: 8, paddingVertical: 20 },
  zoneCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#1A1A35", borderRadius: 12, marginBottom: 8, overflow: "hidden" },
  zoneColorBar: { width: 4, alignSelf: "stretch" },
  zoneInfo: { flex: 1, padding: 14 },
  zoneName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  zonePoints: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
});
