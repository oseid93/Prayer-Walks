import React, { useState, useMemo } from "react";
import { StyleSheet, View, Text, Pressable, Platform, ActivityIndicator, Alert, ScrollView, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/query-client";
import { useAuth } from "@/lib/auth-context";

interface MemberStats { userId: string; displayName: string; role: string; sessionCount: number; totalDistance: number; totalDuration: number; }
interface TeamStats { memberCount: number; sessionCount: number; totalDistance: number; totalDuration: number; }
interface PendingRequest { userId: string; displayName: string; requestedAt: string; }

type DateFilter = "7d" | "30d" | "custom";

function fmtDist(km: number) { return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`; }
function fmtDur(s: number) { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; }

function buildStatsUrl(base: string, filter: DateFilter | null, customFrom: string, customTo: string): string {
  if (!filter) return base;
  const now = new Date();
  if (filter === "7d") {
    const from = new Date(now); from.setDate(from.getDate() - 7);
    return `${base}?from=${from.toISOString()}&to=${now.toISOString()}`;
  }
  if (filter === "30d") {
    const from = new Date(now); from.setDate(from.getDate() - 30);
    return `${base}?from=${from.toISOString()}&to=${now.toISOString()}`;
  }
  if (filter === "custom" && customFrom && customTo) {
    return `${base}?from=${new Date(customFrom).toISOString()}&to=${new Date(customTo + "T23:59:59").toISOString()}`;
  }
  return base;
}

export default function TeamDetailScreen() {
  const { id, name, role } = useLocalSearchParams<{ id: string; name: string; role: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const isAdmin = role === "admin";
  const isMember = role === "admin" || role === "participant";

  const [dateFilter, setDateFilter] = useState<DateFilter | null>(null);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const statsUrl = buildStatsUrl(`/api/teams/${id}/stats`, isAdmin ? dateFilter : null, customFrom, customTo);

  const { data: stats } = useQuery<TeamStats>({
    queryKey: [statsUrl],
    enabled: isMember,
  });
  const { data: members, isLoading: membersLoading } = useQuery<MemberStats[]>({
    queryKey: [`/api/teams/${id}/members`],
    enabled: isAdmin,
  });
  const { data: pendingRequests } = useQuery<PendingRequest[]>({
    queryKey: [`/api/teams/${id}/requests`],
    enabled: isAdmin,
  });

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

  const approveMutation = useMutation({
    mutationFn: async (userId: string) => { await apiRequest("POST", `/api/teams/${id}/requests/${userId}/approve`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/teams/${id}/requests`] });
      queryClient.invalidateQueries({ queryKey: [`/api/teams/${id}/members`] });
      queryClient.invalidateQueries({ queryKey: [statsUrl] });
    },
    onError: () => Alert.alert("Error", "Failed to approve request"),
  });

  const rejectMutation = useMutation({
    mutationFn: async (userId: string) => { await apiRequest("DELETE", `/api/teams/${id}/requests/${userId}`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/teams/${id}/requests`] }),
    onError: () => Alert.alert("Error", "Failed to reject request"),
  });

  const roleMutation = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: string }) => {
      await apiRequest("PATCH", `/api/teams/${id}/members/${userId}/role`, { role: newRole });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/teams/${id}/members`] }),
    onError: () => Alert.alert("Error", "Failed to update role"),
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => { await apiRequest("DELETE", `/api/teams/${id}/members/${userId}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/teams/${id}/members`] });
      queryClient.invalidateQueries({ queryKey: [statsUrl] });
    },
    onError: () => Alert.alert("Error", "Failed to remove member"),
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]} hitSlop={8}>
          <Feather name="arrow-left" size={22} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{name}</Text>
        <View style={styles.rolePill}>
          <Feather name={isAdmin ? "shield" : "user"} size={12} color={isAdmin ? "#FFCC00" : "#9CA3AF"} />
          <Text style={[styles.rolePillText, { color: isAdmin ? "#FFCC00" : "#9CA3AF" }]}>
            {isAdmin ? "Admin" : isMember ? "Member" : "Guest"}
          </Text>
        </View>
      </View>

      {isAdmin && (
        <View style={styles.filterRow}>
          {(["7d", "30d", "custom"] as DateFilter[]).map((f) => (
            <Pressable
              key={f}
              onPress={() => setDateFilter(dateFilter === f ? null : f)}
              style={[styles.filterPill, dateFilter === f && styles.filterPillActive]}
            >
              <Text style={[styles.filterPillText, dateFilter === f && styles.filterPillTextActive]}>
                {f === "7d" ? "Last 7 Days" : f === "30d" ? "Last 30 Days" : "Custom"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {isAdmin && dateFilter === "custom" && (
        <View style={styles.customDateRow}>
          <TextInput
            value={customFrom}
            onChangeText={setCustomFrom}
            placeholder="From YYYY-MM-DD"
            placeholderTextColor="#6B7280"
            style={styles.dateInput}
          />
          <Text style={styles.dateSep}>—</Text>
          <TextInput
            value={customTo}
            onChangeText={setCustomTo}
            placeholder="To YYYY-MM-DD"
            placeholderTextColor="#6B7280"
            style={styles.dateInput}
          />
        </View>
      )}

      {stats && (
        <View style={styles.statsRow}>
          {([
            { icon: "users" as const, value: stats.memberCount, label: "Members", color: "#FF9500" },
            { icon: "activity" as const, value: stats.sessionCount, label: "Walks", color: "#33C3F0" },
            { icon: "map-pin" as const, value: fmtDist(stats.totalDistance), label: "Distance", color: "#4CD964" },
            { icon: "clock" as const, value: fmtDur(stats.totalDuration), label: "Time", color: "#FF3B30" },
          ]).map((s) => (
            <View key={s.label} style={styles.statCard}>
              <Feather name={s.icon} size={18} color={s.color} />
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Pending Join Requests — admin only */}
        {isAdmin && pendingRequests && pendingRequests.length > 0 && (
          <>
            <View style={styles.sectionRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={styles.sectionTitle}>Join Requests</Text>
                <View style={styles.badgePill}>
                  <Text style={styles.badgePillText}>{pendingRequests.length}</Text>
                </View>
              </View>
            </View>
            {pendingRequests.map((req) => (
              <View key={req.userId} style={styles.requestCard}>
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberInitial}>{req.displayName.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{req.displayName}</Text>
                  <Text style={styles.memberStatText}>Awaiting approval</Text>
                </View>
                <View style={styles.memberActions}>
                  <Pressable
                    onPress={() => approveMutation.mutate(req.userId)}
                    style={[styles.reqBtn, styles.reqBtnApprove]}
                    hitSlop={8}
                  >
                    <Feather name="check" size={15} color="#0F0F23" />
                  </Pressable>
                  <Pressable
                    onPress={() => Alert.alert("Reject Request", `Reject ${req.displayName}'s request?`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Reject", style: "destructive", onPress: () => rejectMutation.mutate(req.userId) },
                    ])}
                    style={[styles.reqBtn, styles.reqBtnReject]}
                    hitSlop={8}
                  >
                    <Feather name="x" size={15} color="#FF3B30" />
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        )}

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
              <ActivityIndicator color="#FF9500" style={{ marginVertical: 20 }} />
            ) : !members || members.length === 0 ? (
              <Text style={styles.emptyText}>No members yet</Text>
            ) : sorted.map((m) => (
              <View key={m.userId} style={styles.memberCard}>
                <View style={[styles.memberAvatar, { backgroundColor: "#FF9500" }]}>
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
                        `${m.role === "admin" ? "Remove admin from" : "Make admin"}: ${m.displayName}?`,
                        [{ text: "Cancel", style: "cancel" }, { text: "Confirm", onPress: () => roleMutation.mutate({ userId: m.userId, newRole: m.role === "admin" ? "participant" : "admin" }) }]
                      )}
                      style={styles.actionBtn} hitSlop={8}
                    >
                      <Feather name={m.role === "admin" ? "shield-off" : "shield"} size={16} color={m.role === "admin" ? "#FF9500" : "#33C3F0"} />
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
            <Feather name="users" size={32} color="#FF9500" />
            <Text style={styles.memberMessageTitle}>Team Overview</Text>
            <Text style={styles.memberMessageSub}>Your walks contribute to the shared team stats above. Only admins can see individual member details.</Text>
          </View>
        )}
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
  filterRow: { flexDirection: "row", paddingHorizontal: 16, gap: 6, marginBottom: 8 },
  filterPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: "#1A1A35", borderWidth: 1, borderColor: "#2A2A45" },
  filterPillActive: { backgroundColor: "#FF9500", borderColor: "#FF9500" },
  filterPillText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  filterPillTextActive: { color: "#0F0F23" },
  customDateRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  dateInput: { flex: 1, backgroundColor: "#1A1A35", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, color: "#FFFFFF", fontFamily: "Inter_400Regular", fontSize: 13 },
  dateSep: { color: "#6B7280", fontSize: 14 },
  statsRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: "#1A1A35", borderRadius: 12, padding: 10, alignItems: "center", gap: 4 },
  statValue: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6B7280" },
  scroll: { paddingHorizontal: 16 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  badgePill: { backgroundColor: "#FF3B30", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  badgePillText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  requestCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#1E1A35", borderRadius: 12, padding: 12, marginBottom: 8, gap: 12, borderWidth: 1, borderColor: "#2A2A50" },
  reqBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  reqBtnApprove: { backgroundColor: "#4CD964" },
  reqBtnReject: { backgroundColor: "rgba(255,59,48,0.12)" },
  sortPills: { flexDirection: "row", gap: 6 },
  sortPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: "#1A1A35" },
  sortPillActive: { backgroundColor: "#FF9500" },
  sortPillText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  sortPillTextActive: { color: "#0F0F23" },
  memberCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#1A1A35", borderRadius: 12, padding: 12, marginBottom: 8, gap: 12 },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#FF9500", alignItems: "center", justifyContent: "center" },
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
  memberMessage: { alignItems: "center", paddingVertical: 40, gap: 12 },
  memberMessageTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#9CA3AF" },
  memberMessageSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center" },
});
