import React, { useState, useMemo } from "react";
import { StyleSheet, View, Text, Pressable, Modal, Platform, ActivityIndicator, Alert, ScrollView, Share, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/query-client";
import { useAuth } from "@/lib/auth-context";

interface MemberStats {
  userId: string;
  displayName: string;
  role: string;
  sessionCount: number;
  totalDistance: number;
  totalDuration: number;
}
interface ChurchStats { memberCount: number; sessionCount: number; totalDistance: number; totalDuration: number; }
interface Branch { id: string; name: string; role: string | null; memberCount: number; }
interface PendingBranch { id: string; name: string; requestedByName: string; createdAt: string; }

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

export default function ChurchDetailScreen() {
  const { id, name, role } = useLocalSearchParams<{ id: string; name: string; role: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const isAdmin = role === "admin";

  const [dateFilter, setDateFilter] = useState<DateFilter | null>(null);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const statsUrl = buildStatsUrl(`/api/churches/${id}/stats`, isAdmin ? dateFilter : null, customFrom, customTo);

  const { data: stats } = useQuery<ChurchStats>({ queryKey: [statsUrl] });
  const { data: members, isLoading: membersLoading } = useQuery<MemberStats[]>({
    queryKey: [`/api/churches/${id}/members`],
    enabled: isAdmin,
  });
  const { data: branches } = useQuery<Branch[]>({ queryKey: [`/api/churches/${id}/branches`] });
  const { data: pendingBranches } = useQuery<PendingBranch[]>({
    queryKey: [`/api/churches/${id}/branch-creation-requests`],
    enabled: isAdmin,
  });

  const approveBranchMutation = useMutation({
    mutationFn: async (branchId: string) => { await apiRequest("POST", `/api/churches/${id}/branch-creation-requests/${branchId}/approve`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/churches/${id}/branch-creation-requests`] });
      queryClient.invalidateQueries({ queryKey: [`/api/churches/${id}/branches`] });
    },
    onError: (err: Error) => Alert.alert("Error", err.message || "Failed to approve branch"),
  });

  const rejectBranchMutation = useMutation({
    mutationFn: async (branchId: string) => { await apiRequest("DELETE", `/api/churches/${id}/branch-creation-requests/${branchId}`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/churches/${id}/branch-creation-requests`] }),
    onError: () => Alert.alert("Error", "Failed to reject branch"),
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

  const roleMutation = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: string }) => {
      await apiRequest("PATCH", `/api/churches/${id}/members/${userId}/role`, { role: newRole });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/churches/${id}/members`] }),
    onError: () => Alert.alert("Error", "Failed to update role"),
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => { await apiRequest("DELETE", `/api/churches/${id}/members/${userId}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/churches/${id}/members`] });
      queryClient.invalidateQueries({ queryKey: [statsUrl] });
    },
    onError: () => Alert.alert("Error", "Failed to remove member"),
  });

  const [showBranchModal, setShowBranchModal] = useState(false);
  const [branchName, setBranchName] = useState("");
  const createBranchMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", `/api/churches/${id}/branches`, { name });
      return res.json();
    },
    onSuccess: (data: { status?: string; name?: string }) => {
      queryClient.invalidateQueries({ queryKey: [`/api/churches/${id}/branches`] });
      setShowBranchModal(false);
      setBranchName("");
      if (data?.status === "pending") {
        Alert.alert("Request Sent", `Your request to create "${data.name}" has been sent to the church admin for approval.`);
      }
    },
    onError: (err: Error) => Alert.alert("Error", err.message || "Failed to create branch"),
  });
  const submitBranch = () => {
    const n = branchName.trim();
    if (!n) { Alert.alert("Required", "Please enter a branch name"); return; }
    createBranchMutation.mutate(n);
  };

  const handleShare = async () => {
    try { await Share.share({ message: `Join our church "${name}" on Prayer Walks! Code from the Profile tab.` }); } catch (_) {}
  };

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
            { icon: "users" as const, value: stats.memberCount, label: "Members", color: "#33C3F0" },
            { icon: "activity" as const, value: stats.sessionCount, label: "Walks", color: "#4CD964" },
            { icon: "map-pin" as const, value: fmtDist(stats.totalDistance), label: "Distance", color: "#FF9500" },
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
              <ActivityIndicator color="#33C3F0" style={{ marginVertical: 20 }} />
            ) : sorted.map((m) => (
              <View key={m.userId} style={styles.memberCard}>
                <View style={styles.memberAvatar}>
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
            <Feather name="lock" size={32} color="#4B5563" />
            <Text style={styles.memberMessageTitle}>Members visible to admins only</Text>
            <Text style={styles.memberMessageSub}>Your walks contribute to the shared stats above.</Text>
          </View>
        )}
        {/* Pending Branch Creation Requests — admin only */}
        {isAdmin && pendingBranches && pendingBranches.length > 0 && (
          <>
            <View style={[styles.sectionRow, { marginTop: 20 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={styles.sectionTitle}>Branch Requests</Text>
                <View style={styles.badgePill}>
                  <Text style={styles.badgePillText}>{pendingBranches.length}</Text>
                </View>
              </View>
            </View>
            {pendingBranches.map((b) => (
              <View key={b.id} style={styles.requestCard}>
                <View style={styles.branchIcon}>
                  <Feather name="git-branch" size={16} color="#4CD964" />
                </View>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{b.name}</Text>
                  <Text style={styles.memberStatText}>Requested by {b.requestedByName}</Text>
                </View>
                <View style={styles.memberActions}>
                  <Pressable
                    testID={`approve-branch-${b.id}`}
                    onPress={() => approveBranchMutation.mutate(b.id)}
                    style={[styles.reqBtn, styles.reqBtnApprove]}
                    hitSlop={8}
                  >
                    <Feather name="check" size={15} color="#0F0F23" />
                  </Pressable>
                  <Pressable
                    testID={`reject-branch-${b.id}`}
                    onPress={() => Alert.alert("Reject Branch", `Reject "${b.name}"?`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Reject", style: "destructive", onPress: () => rejectBranchMutation.mutate(b.id) },
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

        {/* Branches section */}
        <View style={[styles.sectionRow, { marginTop: 20, marginBottom: 12 }]}>
          <Text style={styles.sectionTitle}>Branches</Text>
          <Pressable
            testID="create-branch-btn"
            onPress={() => setShowBranchModal(true)}
            style={({ pressed }) => [styles.createBtn, { opacity: pressed ? 0.75 : 1 }]}
          >
            <Feather name="plus" size={14} color="#0F0F23" />
            <Text style={styles.createBtnText}>{isAdmin ? "Create Branch" : "Request Branch"}</Text>
          </Pressable>
        </View>
        {!branches || branches.length === 0 ? (
          <View style={styles.memberMessage}>
            <Feather name="git-branch" size={24} color="#4B5563" />
            <Text style={styles.memberMessageSub}>No branches yet.</Text>
          </View>
        ) : branches.map((b) => (
          <Pressable
            key={b.id}
            onPress={() => router.push({ pathname: "/branch-detail", params: { id: b.id, name: b.name, role: b.role ?? "participant" } })}
            style={({ pressed }) => [styles.branchCard, { opacity: pressed ? 0.75 : 1 }]}
          >
            <View style={styles.branchIcon}>
              <Feather name="git-branch" size={18} color="#4CD964" />
            </View>
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>{b.name}</Text>
              <Text style={styles.memberStatText}>{b.memberCount} {b.memberCount === 1 ? "member" : "members"}</Text>
            </View>
            <Feather name="chevron-right" size={18} color="#6B7280" />
          </Pressable>
        ))}

        <View style={{ height: 80 }} />
      </ScrollView>

      <Modal visible={showBranchModal} transparent animationType="fade" onRequestClose={() => setShowBranchModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{isAdmin ? "Create Branch" : "Request Branch"}</Text>
            {!isAdmin && (
              <Text style={styles.modalHelp}>Your request will be sent to the church admin for approval.</Text>
            )}
            <TextInput
              testID="branch-name-input"
              value={branchName}
              onChangeText={setBranchName}
              placeholder="Branch name"
              placeholderTextColor="#6B7280"
              style={styles.modalInput}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submitBranch}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => { setShowBranchModal(false); setBranchName(""); }} style={[styles.modalBtn, styles.modalBtnGhost]}>
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="branch-submit-btn"
                onPress={submitBranch}
                disabled={createBranchMutation.isPending}
                style={[styles.modalBtn, styles.modalBtnPrimary, createBranchMutation.isPending && { opacity: 0.6 }]}
              >
                {createBranchMutation.isPending
                  ? <ActivityIndicator color="#0F0F23" />
                  : <Text style={styles.modalBtnPrimaryText}>Create</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  filterPillActive: { backgroundColor: "#33C3F0", borderColor: "#33C3F0" },
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
  sortPills: { flexDirection: "row", gap: 6 },
  sortPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: "#1A1A35" },
  sortPillActive: { backgroundColor: "#33C3F0" },
  sortPillText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  sortPillTextActive: { color: "#0F0F23" },
  memberCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#1A1A35", borderRadius: 12, padding: 12, marginBottom: 8, gap: 12 },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#33C3F0", alignItems: "center", justifyContent: "center" },
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
  branchCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#1A1A35", borderRadius: 12, padding: 14, marginBottom: 8, gap: 12 },
  branchIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(76,217,100,0.15)", alignItems: "center", justifyContent: "center" },
  createBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#4CD964", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16 },
  createBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#0F0F23" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 400, backgroundColor: "#1A1A35", borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFFFFF", marginBottom: 14 },
  modalInput: { backgroundColor: "#0F0F23", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: "#FFFFFF", fontFamily: "Inter_400Regular", fontSize: 15, marginBottom: 16 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  modalBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, minWidth: 80, alignItems: "center" },
  modalBtnGhost: { backgroundColor: "transparent" },
  modalBtnGhostText: { color: "#9CA3AF", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modalBtnPrimary: { backgroundColor: "#4CD964" },
  modalBtnPrimaryText: { color: "#0F0F23", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modalHelp: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginBottom: 12, marginTop: -8 },
  badgePill: { backgroundColor: "#FF3B30", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  badgePillText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  requestCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#1E1A35", borderRadius: 12, padding: 12, marginBottom: 8, gap: 12, borderWidth: 1, borderColor: "#2A2A50" },
  reqBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  reqBtnApprove: { backgroundColor: "#4CD964" },
  reqBtnReject: { backgroundColor: "rgba(255,59,48,0.12)" },
});
