import React, { useState, useMemo, useCallback } from "react";
import { StyleSheet, View, Text, Pressable, Platform, ActivityIndicator, Alert, ScrollView, Modal, TextInput } from "react-native";
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
interface Team { id: string; name: string; role: string | null; memberCount: number; sessionCount: number; totalDistance: number; }
interface PendingRequest { userId: string; displayName: string; requestedAt: string; }
interface PendingTeam { id: string; name: string; requestedByName: string; createdAt: string; }

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

export default function BranchDetailScreen() {
  const { id, name, role } = useLocalSearchParams<{ id: string; name: string; role: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const isAdmin = role === "admin";

  const [dateFilter, setDateFilter] = useState<DateFilter | null>(null);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const statsUrl = buildStatsUrl(`/api/branches/${id}/stats`, isAdmin ? dateFilter : null, customFrom, customTo);

  const { data: stats } = useQuery<BranchStats>({ queryKey: [statsUrl] });
  const { data: members, isLoading: membersLoading } = useQuery<MemberStats[]>({
    queryKey: [`/api/branches/${id}/members`],
    enabled: isAdmin,
  });
  const { data: pendingRequests } = useQuery<PendingRequest[]>({
    queryKey: [`/api/branches/${id}/requests`],
    enabled: isAdmin,
  });
  const { data: priorityAreas } = useQuery<PriorityArea[]>({ queryKey: [`/api/branches/${id}/priority-areas`] });
  const { data: teams } = useQuery<Team[]>({ queryKey: [`/api/branches/${id}/teams`] });
  const { data: pendingTeams } = useQuery<PendingTeam[]>({
    queryKey: [`/api/branches/${id}/team-creation-requests`],
    enabled: isAdmin,
  });

  const approveTeamMutation = useMutation({
    mutationFn: async (teamId: string) => { await apiRequest("POST", `/api/branches/${id}/team-creation-requests/${teamId}/approve`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/branches/${id}/team-creation-requests`] });
      queryClient.invalidateQueries({ queryKey: [`/api/branches/${id}/teams`] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-teams"] });
    },
    onError: (err: Error) => Alert.alert("Error", err.message || "Failed to approve team"),
  });

  const rejectTeamMutation = useMutation({
    mutationFn: async (teamId: string) => { await apiRequest("DELETE", `/api/branches/${id}/team-creation-requests/${teamId}`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/branches/${id}/team-creation-requests`] }),
    onError: () => Alert.alert("Error", "Failed to reject team"),
  });

  const PAGE_SIZE = 10;
  const [membersExpanded, setMembersExpanded] = useState(true);
  const [membersVisible, setMembersVisible] = useState(PAGE_SIZE);

  type SortKey = "walks" | "distance" | "name";
  const [sortBy, setSortBy] = useState<SortKey>("walks");
  const handleSetSortBy = (k: SortKey) => { setSortBy(k); setMembersVisible(PAGE_SIZE); };
  const sorted = useMemo(() => {
    if (!members) return [];
    return [...members].sort((a, b) =>
      sortBy === "walks" ? b.sessionCount - a.sessionCount :
      sortBy === "distance" ? b.totalDistance - a.totalDistance :
      a.displayName.localeCompare(b.displayName)
    );
  }, [members, sortBy]);

  const approveMutation = useMutation({
    mutationFn: async (userId: string) => { await apiRequest("POST", `/api/branches/${id}/requests/${userId}/approve`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/branches/${id}/requests`] });
      queryClient.invalidateQueries({ queryKey: [`/api/branches/${id}/members`] });
      queryClient.invalidateQueries({ queryKey: [statsUrl] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-pending-requests"] });
    },
    onError: () => Alert.alert("Error", "Failed to approve request"),
  });

  const rejectMutation = useMutation({
    mutationFn: async (userId: string) => { await apiRequest("DELETE", `/api/branches/${id}/requests/${userId}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/branches/${id}/requests`] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-pending-requests"] });
    },
    onError: () => Alert.alert("Error", "Failed to reject request"),
  });

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
      queryClient.invalidateQueries({ queryKey: [statsUrl] });
    },
    onError: () => Alert.alert("Error", "Failed to remove member"),
  });

  const [showTeamModal, setShowTeamModal] = useState(false);
  const [teamName, setTeamName] = useState("");
  const createTeamMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", `/api/branches/${id}/teams`, { name });
      return res.json();
    },
    onSuccess: (data: { status?: string; name?: string }) => {
      queryClient.invalidateQueries({ queryKey: [`/api/branches/${id}/teams`] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-teams"] });
      setShowTeamModal(false);
      setTeamName("");
      if (data?.status === "pending") {
        Alert.alert("Request Sent", `Your request to create "${data.name}" has been sent to the branch admin for approval.`);
      }
    },
    onError: (err: Error) => Alert.alert("Error", err.message || "Failed to create team"),
  });
  const submitTeam = () => {
    const n = teamName.trim();
    if (!n) { Alert.alert("Required", "Please enter a team name"); return; }
    createTeamMutation.mutate(n);
  };

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
            { icon: "users" as const, value: stats.memberCount, label: "Members", color: "#4CD964" },
            { icon: "activity" as const, value: stats.sessionCount, label: "Walks", color: "#33C3F0" },
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
            <Pressable onPress={() => setMembersExpanded((v) => !v)} style={styles.sectionRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={styles.sectionTitle}>Members</Text>
                {members && <Text style={styles.memberCountLabel}>{members.length}</Text>}
              </View>
              <Feather name={membersExpanded ? "chevron-up" : "chevron-down"} size={16} color="#6B7280" />
            </Pressable>
            {membersExpanded && (
              <>
                <View style={[styles.sortPills, { marginBottom: 12 }]}>
                  {(["walks", "distance", "name"] as SortKey[]).map((k) => (
                    <Pressable key={k} onPress={() => handleSetSortBy(k)} style={[styles.sortPill, sortBy === k && styles.sortPillActive]}>
                      <Text style={[styles.sortPillText, sortBy === k && styles.sortPillTextActive]}>{k.charAt(0).toUpperCase() + k.slice(1)}</Text>
                    </Pressable>
                  ))}
                </View>
                {membersLoading ? (
                  <ActivityIndicator color="#4CD964" style={{ marginVertical: 20 }} />
                ) : !members || members.length === 0 ? (
                  <Text style={styles.emptyText}>No members yet</Text>
                ) : (
                  <>
                    {sorted.slice(0, membersVisible).map((m) => (
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
                    {sorted.length > PAGE_SIZE && (
                      <Pressable
                        onPress={() => {
                          if (membersVisible >= sorted.length) {
                            setMembersVisible(PAGE_SIZE);
                          } else {
                            setMembersVisible((v) => Math.min(v + PAGE_SIZE, sorted.length));
                          }
                        }}
                        style={styles.showMoreBtn}
                      >
                        <Text style={styles.showMoreText}>
                          {membersVisible >= sorted.length
                            ? "Show less"
                            : `Show ${Math.min(PAGE_SIZE, sorted.length - membersVisible)} more · ${sorted.length} total`}
                        </Text>
                        <Feather name={membersVisible >= sorted.length ? "chevron-up" : "chevron-down"} size={14} color="#6B7280" />
                      </Pressable>
                    )}
                  </>
                )}
              </>
            )}
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

        {/* Pending Team Creation Requests — admin only */}
        {isAdmin && pendingTeams && pendingTeams.length > 0 && (
          <>
            <View style={[styles.sectionRow, { marginTop: 20 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={styles.sectionTitle}>Team Requests</Text>
                <View style={styles.badgePill}>
                  <Text style={styles.badgePillText}>{pendingTeams.length}</Text>
                </View>
              </View>
            </View>
            {pendingTeams.map((t) => (
              <View key={t.id} style={styles.requestCard}>
                <View style={styles.teamIcon}>
                  <Feather name="users" size={16} color="#FF9500" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.zoneName}>{t.name}</Text>
                  <Text style={styles.zonePoints}>Requested by {t.requestedByName}</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    testID={`approve-team-${t.id}`}
                    onPress={() => approveTeamMutation.mutate(t.id)}
                    style={[styles.reqBtn, styles.reqBtnApprove]}
                    hitSlop={8}
                  >
                    <Feather name="check" size={15} color="#0F0F23" />
                  </Pressable>
                  <Pressable
                    testID={`reject-team-${t.id}`}
                    onPress={() => Alert.alert("Reject Team", `Reject "${t.name}"?`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Reject", style: "destructive", onPress: () => rejectTeamMutation.mutate(t.id) },
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

        {/* Teams section */}
        <View style={[styles.sectionRow, { marginTop: 20, marginBottom: 12 }]}>
          <Text style={styles.sectionTitle}>Teams</Text>
          <Pressable
            testID="create-team-btn"
            onPress={() => setShowTeamModal(true)}
            style={({ pressed }) => [styles.createBtn, { opacity: pressed ? 0.75 : 1 }]}
          >
            <Feather name="plus" size={14} color="#0F0F23" />
            <Text style={styles.createBtnText}>{isAdmin ? "Create Team" : "Request Team"}</Text>
          </Pressable>
        </View>
        {!teams || teams.length === 0 ? (
          <View style={styles.zonesEmpty}>
            <Feather name="users" size={24} color="#4B5563" />
            <Text style={styles.emptyText}>{isAdmin ? "No teams yet." : "No teams in this branch."}</Text>
          </View>
        ) : [...teams].sort((a, b) =>
          sortBy === "walks" ? b.sessionCount - a.sessionCount :
          sortBy === "distance" ? b.totalDistance - a.totalDistance :
          a.name.localeCompare(b.name)
        ).map((t) => (
          <Pressable
            key={t.id}
            onPress={() => router.push({ pathname: "/team-detail", params: { id: t.id, name: t.name, role: t.role ?? (isAdmin ? "admin" : "participant") } })}
            style={({ pressed }) => [styles.teamCard, { opacity: pressed ? 0.75 : 1 }]}
          >
            <View style={styles.teamIcon}>
              <Feather name="users" size={18} color="#FF9500" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.zoneName}>{t.name}</Text>
              <Text style={styles.zonePoints}>
                {t.memberCount} {t.memberCount === 1 ? "member" : "members"} · {t.sessionCount} walks · {fmtDist(t.totalDistance)}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color="#6B7280" />
          </Pressable>
        ))}

        <View style={{ height: 80 }} />
      </ScrollView>

      <Modal visible={showTeamModal} transparent animationType="fade" onRequestClose={() => setShowTeamModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{isAdmin ? "Create Team" : "Request Team"}</Text>
            {!isAdmin && (
              <Text style={styles.modalHelp}>Your request will be sent to the branch admin for approval.</Text>
            )}
            <TextInput
              testID="team-name-input"
              value={teamName}
              onChangeText={setTeamName}
              placeholder="Team name"
              placeholderTextColor="#6B7280"
              style={styles.modalInput}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submitTeam}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => { setShowTeamModal(false); setTeamName(""); }} style={[styles.modalBtn, styles.modalBtnGhost]}>
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="team-submit-btn"
                onPress={submitTeam}
                disabled={createTeamMutation.isPending}
                style={[styles.modalBtn, styles.modalBtnPrimary, createTeamMutation.isPending && { opacity: 0.6 }]}
              >
                {createTeamMutation.isPending
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
  filterPillActive: { backgroundColor: "#4CD964", borderColor: "#4CD964" },
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
  sortPillActive: { backgroundColor: "#4CD964" },
  sortPillText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  sortPillTextActive: { color: "#0F0F23" },
  memberCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#1A1A35", borderRadius: 12, padding: 12, marginBottom: 8, gap: 12 },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#4CD964", alignItems: "center", justifyContent: "center" },
  memberInitial: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  memberInfo: { flex: 1 },
  memberNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  memberName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  memberStatText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  adminBadge: { backgroundColor: "rgba(255,204,0,0.12)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  adminBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#FFCC00" },
  youBadge: { backgroundColor: "rgba(51,195,240,0.12)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  youBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#33C3F0" },
  memberCountLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280", backgroundColor: "#1A1A35", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  showMoreBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, marginBottom: 4 },
  showMoreText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },
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
  teamCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#1A1A35", borderRadius: 12, padding: 14, marginBottom: 8, gap: 12 },
  teamIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,149,0,0.15)", alignItems: "center", justifyContent: "center" },
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
});
