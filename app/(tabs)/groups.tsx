import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  TextInput,
  Modal,
  Platform,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Share,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/query-client";
import { useAuth } from "@/lib/auth-context";

interface Church {
  id: string;
  name: string;
  code: string;
  role: string;
}

interface Branch {
  id: string;
  churchId: string;
  name: string;
  role: string | null;
  memberCount: number;
  myStatus: "active" | "pending" | null;
}

interface Team {
  id: string;
  branchId: string;
  name: string;
  role: string | null;
  memberCount: number;
  myStatus: "active" | "pending" | null;
}

interface PendingRequestsSummary {
  total: number;
  branches: Array<{ branchId: string; name: string; count: number }>;
  teams: Array<{ teamId: string; name: string; count: number }>;
}

export default function GroupsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const [showCreateChurchModal, setShowCreateChurchModal] = useState(false);
  const [showJoinChurchModal, setShowJoinChurchModal] = useState(false);
  const [showCreateBranchModal, setShowCreateBranchModal] = useState(false);
  const [showCreateTeamModal, setShowCreateTeamModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);

  const [churchName, setChurchName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [branchName, setBranchName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [error, setError] = useState("");

  const {
    data: churches,
    isLoading: churchLoading,
    isRefetching: churchRefetching,
    refetch: refetchChurches,
  } = useQuery<Church[]>({ queryKey: ["/api/churches"] });

  const church = churches?.[0] ?? null;

  const {
    data: branches,
    isLoading: branchLoading,
    refetch: refetchBranches,
  } = useQuery<Branch[]>({
    queryKey: [`/api/churches/${church?.id}/branches`],
    enabled: !!church,
  });

  // The user's actual direct branch membership (used for Teams section + leave action).
  // A user can only be a direct member of one branch per church, identified by myStatus === 'active'.
  const myBranch = branches?.find((b) => b.myStatus === "active") ?? null;
  // Every branch the user has access to (direct membership OR elevated via church-admin role).
  // For a church admin this is every branch; for a normal member it's just their one branch.
  const accessibleBranches = branches?.filter((b) => b.role !== null) ?? [];

  const {
    data: teams,
    isLoading: teamLoading,
    refetch: refetchTeams,
  } = useQuery<Team[]>({
    queryKey: [`/api/branches/${myBranch?.id}/teams`],
    enabled: !!myBranch,
  });

  const { data: pendingSummary, refetch: refetchPending } = useQuery<PendingRequestsSummary>({
    queryKey: ["/api/my-pending-requests"],
    enabled: !!user,
  });

  const pendingForBranch = (branchId: string) =>
    pendingSummary?.branches.find((b) => b.branchId === branchId)?.count ?? 0;
  const pendingForTeam = (teamId: string) =>
    pendingSummary?.teams.find((t) => t.teamId === teamId)?.count ?? 0;

  const createChurchMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/churches", { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/churches"] });
      setShowCreateChurchModal(false);
      setChurchName("");
      setError("");
    },
    onError: (err: any) => setError(err.message || "Failed to create church"),
  });

  const joinChurchMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/churches/join", { code });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/churches"] });
      setShowJoinChurchModal(false);
      setJoinCode("");
      setError("");
    },
    onError: (err: any) => setError(err.message || "Church not found"),
  });

  const leaveChurchMutation = useMutation({
    mutationFn: async (churchId: string) => {
      const res = await apiRequest("DELETE", `/api/churches/${churchId}/leave`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/churches"] });
    },
    onError: (err: any) => Alert.alert("Error", err.message || "Failed to leave church"),
  });

  const createBranchMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", `/api/churches/${church?.id}/branches`, { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/churches/${church?.id}/branches`] });
      setShowCreateBranchModal(false);
      setBranchName("");
      setError("");
    },
    onError: (err: any) => setError(err.message || "Failed to create branch"),
  });

  const joinBranchMutation = useMutation({
    mutationFn: async (branchId: string) => {
      const res = await apiRequest("POST", `/api/churches/${church?.id}/branches/${branchId}/join`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/churches/${church?.id}/branches`] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-pending-requests"] });
    },
    onError: (err: any) => Alert.alert("Error", err.message || "Failed to join branch"),
  });

  const leaveBranchMutation = useMutation({
    mutationFn: async (branchId: string) => {
      const res = await apiRequest("DELETE", `/api/branches/${branchId}/leave`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/churches/${church?.id}/branches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/branches/${myBranch?.id}/teams`] });
    },
    onError: (err: any) => Alert.alert("Error", err.message || "Failed to leave branch"),
  });

  const createTeamMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", `/api/branches/${myBranch?.id}/teams`, { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/branches/${myBranch?.id}/teams`] });
      setShowCreateTeamModal(false);
      setTeamName("");
      setError("");
    },
    onError: (err: any) => setError(err.message || "Failed to create team"),
  });

  const joinTeamMutation = useMutation({
    mutationFn: async (teamId: string) => {
      const res = await apiRequest("POST", `/api/branches/${myBranch?.id}/teams/${teamId}/join`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/branches/${myBranch?.id}/teams`] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-pending-requests"] });
    },
    onError: (err: any) => Alert.alert("Error", err.message || "Failed to join team"),
  });

  const leaveTeamMutation = useMutation({
    mutationFn: async (teamId: string) => {
      const res = await apiRequest("DELETE", `/api/teams/${teamId}/leave`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/branches/${myBranch?.id}/teams`] });
    },
    onError: (err: any) => Alert.alert("Error", err.message || "Failed to leave team"),
  });

  const updateNameMutation = useMutation({
    mutationFn: async (displayName: string) => {
      const res = await apiRequest("PATCH", "/api/auth/profile", { displayName });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setShowAccountModal(false);
      setNewDisplayName("");
      setError("");
    },
    onError: (err: any) => setError(err.message || "Failed to update name"),
  });

  const handleShareCode = async () => {
    if (!church) return;
    try {
      await Share.share({
        message: `Join our church "${church.name}" on Prayer Walks! Code: ${church.code}`,
      });
    } catch (_e) {}
  };

  const handleLeaveChurch = () => {
    if (!church) return;
    Alert.alert(
      "Leave Church",
      `Leave "${church.name}"? You will also leave your branch and all teams.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: () => leaveChurchMutation.mutate(church.id) },
      ],
    );
  };

  const handleLeaveBranch = () => {
    if (!myBranch) return;
    Alert.alert(
      "Leave Branch",
      `Leave "${myBranch.name}"? You will also be removed from all its teams.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: () => leaveBranchMutation.mutate(myBranch.id) },
      ],
    );
  };

  const handleLeaveTeam = (team: Team) => {
    Alert.alert(
      "Leave Team",
      `Leave "${team.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: () => leaveTeamMutation.mutate(team.id) },
      ],
    );
  };

  const displayName = user?.displayName ?? user?.username ?? "Account";
  const initial = displayName.charAt(0).toUpperCase();
  const isChurchAdmin = church?.role === "admin";
  const isBranchAdmin = myBranch?.role === "admin";

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => logout() },
    ]);
  };

  const onRefresh = () => {
    refetchChurches();
    if (church) refetchBranches();
    if (myBranch) refetchTeams();
    refetchPending();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <Text style={styles.title}>Profile</Text>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={
          <RefreshControl refreshing={churchRefetching} onRefresh={onRefresh} tintColor="#33C3F0" />
        }
      >
        {/* Account card */}
        <View style={styles.accountCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
          <View style={styles.accountTextBlock}>
            <Text style={styles.accountDisplayName}>{displayName}</Text>
            <Text style={styles.accountUsername}>@{user?.username}</Text>
          </View>
          <Pressable
            onPress={() => { setNewDisplayName(user?.displayName ?? ""); setError(""); setShowAccountModal(true); }}
            style={({ pressed }) => [styles.editBtn, { opacity: pressed ? 0.6 : 1 }]}
            hitSlop={8}
          >
            <Feather name="edit-2" size={16} color="#33C3F0" />
          </Pressable>
        </View>

        <View style={styles.sectionDivider} />

        {/* ── No church yet ── */}
        {churchLoading ? (
          <ActivityIndicator color="#33C3F0" style={{ marginTop: 32 }} />
        ) : !church ? (
          <>
            <Text style={styles.sectionLabel}>My Church</Text>
            <View style={styles.emptyCard}>
              <Feather name="home" size={32} color="#4B5563" />
              <Text style={styles.emptyTitle}>No church yet</Text>
              <Text style={styles.emptySubtext}>Create a new church or join one with a code</Text>
            </View>
            <View style={styles.actionRow}>
              <Pressable
                onPress={() => { setError(""); setShowCreateChurchModal(true); }}
                style={({ pressed }) => [styles.actionBtn, { backgroundColor: "#33C3F0", opacity: pressed ? 0.8 : 1 }]}
              >
                <Feather name="plus" size={18} color="#fff" />
                <Text style={styles.actionBtnText}>Create Church</Text>
              </Pressable>
              <Pressable
                onPress={() => { setError(""); setShowJoinChurchModal(true); }}
                style={({ pressed }) => [styles.actionBtnOutline, { opacity: pressed ? 0.8 : 1 }]}
              >
                <Feather name="log-in" size={18} color="#33C3F0" />
                <Text style={[styles.actionBtnText, { color: "#33C3F0" }]}>Join Church</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            {/* ── Church header ── */}
            <View style={styles.levelHeader}>
              <View style={styles.levelHeaderLeft}>
                <Feather name="home" size={16} color="#33C3F0" />
                <Text style={styles.levelHeaderLabel}>Church</Text>
              </View>
              <View style={styles.levelHeaderRight}>
                {isChurchAdmin && (
                  <View style={styles.adminBadge}>
                    <Feather name="shield" size={10} color="#FFCC00" />
                    <Text style={styles.adminBadgeText}>Admin</Text>
                  </View>
                )}
              </View>
            </View>

            <Pressable
              onPress={() => router.push({ pathname: "/church-detail", params: { id: church.id, name: church.name, role: church.role } })}
              style={({ pressed }) => [styles.entityCard, { opacity: pressed ? 0.85 : 1 }]}
            >
              <View style={styles.entityCardMain}>
                <Text style={styles.entityName}>{church.name}</Text>
                <View style={styles.codeRow}>
                  <Text style={styles.codeLabel}>Code: </Text>
                  <Text style={styles.codeValue}>{church.code}</Text>
                </View>
              </View>
              <View style={styles.entityCardActions}>
                <Pressable onPress={handleShareCode} style={styles.iconAction} hitSlop={8}>
                  <Feather name="share" size={16} color="#33C3F0" />
                </Pressable>
                <Pressable onPress={handleLeaveChurch} style={styles.iconAction} hitSlop={8}>
                  <Feather name="log-out" size={16} color="#FF3B30" />
                </Pressable>
              </View>
            </Pressable>

            {/* ── Branches ── */}
            <View style={styles.levelHeader}>
              <View style={styles.levelHeaderLeft}>
                <Feather name="git-branch" size={16} color="#4CD964" />
                <Text style={styles.levelHeaderLabel}>Branch</Text>
              </View>
              {isChurchAdmin && (
                <Pressable
                  onPress={() => { setError(""); setShowCreateBranchModal(true); }}
                  style={({ pressed }) => [styles.smallBtn, { opacity: pressed ? 0.7 : 1 }]}
                  hitSlop={4}
                >
                  <Feather name="plus" size={14} color="#4CD964" />
                  <Text style={[styles.smallBtnText, { color: "#4CD964" }]}>New</Text>
                </Pressable>
              )}
            </View>

            {branchLoading ? (
              <ActivityIndicator color="#4CD964" style={{ marginVertical: 12 }} />
            ) : !branches || branches.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptySubtext}>
                  {isChurchAdmin ? "Create the first branch for your church." : "No branches yet — ask your church admin to create one."}
                </Text>
              </View>
            ) : accessibleBranches.length > 0 ? (
              <>
                {accessibleBranches.map((branch) => {
                  const isDirectMember = branch.myStatus === "active";
                  const branchIsAdmin = branch.role === "admin";
                  return (
                    <Pressable
                      key={branch.id}
                      onPress={() => router.push({ pathname: "/branch-detail", params: { id: branch.id, name: branch.name, role: branch.role ?? "participant" } })}
                      style={({ pressed }) => [styles.entityCard, { borderLeftColor: "#4CD964", opacity: pressed ? 0.85 : 1 }]}
                    >
                      <View style={styles.entityCardMain}>
                        <Text style={styles.entityName}>{branch.name}</Text>
                        <Text style={styles.memberCount}>{branch.memberCount} member{branch.memberCount !== 1 ? "s" : ""}</Text>
                      </View>
                      <View style={styles.entityCardActions}>
                        {branchIsAdmin && pendingForBranch(branch.id) > 0 && (
                          <View style={styles.pendingBadge}>
                            <Feather name="bell" size={10} color="#fff" />
                            <Text style={styles.pendingBadgeText}>{pendingForBranch(branch.id)}</Text>
                          </View>
                        )}
                        {branchIsAdmin && (
                          <View style={styles.adminBadge}>
                            <Feather name="shield" size={10} color="#FFCC00" />
                            <Text style={styles.adminBadgeText}>Admin</Text>
                          </View>
                        )}
                        {isDirectMember && (
                          <Pressable onPress={handleLeaveBranch} style={styles.iconAction} hitSlop={8}>
                            <Feather name="log-out" size={16} color="#FF3B30" />
                          </Pressable>
                        )}
                      </View>
                    </Pressable>
                  );
                })}

                {/* Inline Teams section — only when the user has a single direct branch.
                    For church admins with multiple branches, teams are managed by tapping into each branch. */}
                {myBranch && accessibleBranches.length === 1 && (
                  <>
                {/* ── Teams ── */}
                <View style={styles.levelHeader}>
                  <View style={styles.levelHeaderLeft}>
                    <Feather name="users" size={16} color="#FF9500" />
                    <Text style={styles.levelHeaderLabel}>Teams</Text>
                  </View>
                  {isBranchAdmin && (
                    <Pressable
                      onPress={() => { setError(""); setShowCreateTeamModal(true); }}
                      style={({ pressed }) => [styles.smallBtn, { opacity: pressed ? 0.7 : 1 }]}
                      hitSlop={4}
                    >
                      <Feather name="plus" size={14} color="#FF9500" />
                      <Text style={[styles.smallBtnText, { color: "#FF9500" }]}>New</Text>
                    </Pressable>
                  )}
                </View>

                {teamLoading ? (
                  <ActivityIndicator color="#FF9500" style={{ marginVertical: 12 }} />
                ) : !teams || teams.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptySubtext}>
                      {isBranchAdmin ? "Create the first team for your branch." : "No teams yet — ask your branch admin to create one."}
                    </Text>
                  </View>
                ) : (
                  teams.map((team) => (
                    <Pressable
                      key={team.id}
                      onPress={() => router.push({ pathname: "/team-detail", params: { id: team.id, name: team.name, role: team.role ?? "none" } })}
                      style={({ pressed }) => [styles.entityCard, { borderLeftColor: "#FF9500", opacity: pressed ? 0.85 : 1 }]}
                    >
                      <View style={styles.entityCardMain}>
                        <Text style={styles.entityName}>{team.name}</Text>
                        <Text style={styles.memberCount}>{team.memberCount} member{team.memberCount !== 1 ? "s" : ""}</Text>
                      </View>
                      <View style={styles.entityCardActions}>
                        {team.role !== null ? (
                          <>
                            {team.role === "admin" && pendingForTeam(team.id) > 0 && (
                              <View style={styles.pendingBadge}>
                                <Feather name="bell" size={10} color="#fff" />
                                <Text style={styles.pendingBadgeText}>{pendingForTeam(team.id)}</Text>
                              </View>
                            )}
                            {team.role === "admin" && (
                              <View style={styles.adminBadge}>
                                <Feather name="shield" size={10} color="#FFCC00" />
                                <Text style={styles.adminBadgeText}>Admin</Text>
                              </View>
                            )}
                            {team.role === "participant" && (
                              <View style={[styles.adminBadge, { backgroundColor: "rgba(76,217,100,0.15)" }]}>
                                <Text style={[styles.adminBadgeText, { color: "#4CD964" }]}>Joined</Text>
                              </View>
                            )}
                            <Pressable
                              onPress={() => handleLeaveTeam(team)}
                              style={styles.iconAction}
                              hitSlop={8}
                              onStartShouldSetResponder={() => true}
                            >
                              <Feather name="log-out" size={16} color="#FF3B30" />
                            </Pressable>
                          </>
                        ) : team.myStatus === "pending" ? (
                          <View style={styles.pendingPill} testID={`team-pending-${team.id}`}>
                            <Feather name="clock" size={12} color="#FF9500" />
                            <Text style={styles.pendingPillText}>Pending</Text>
                          </View>
                        ) : (
                          <Pressable
                            onPress={() => joinTeamMutation.mutate(team.id)}
                            disabled={joinTeamMutation.isPending}
                            style={({ pressed }) => [styles.joinBtn, { opacity: pressed ? 0.7 : 1 }]}
                          >
                            {joinTeamMutation.isPending ? (
                              <ActivityIndicator size="small" color="#FF9500" />
                            ) : (
                              <Text style={styles.joinBtnText}>Join</Text>
                            )}
                          </Pressable>
                        )}
                      </View>
                    </Pressable>
                  ))
                )}
                  </>
                )}
              </>
            ) : (
              <>
                <Text style={styles.pickBranchHint}>Pick a branch to join:</Text>
                {branches.map((branch) => (
                  <View
                    key={branch.id}
                    style={[styles.entityCard, { borderLeftColor: "#4CD964" }]}
                  >
                    <View style={styles.entityCardMain}>
                      <Text style={styles.entityName}>{branch.name}</Text>
                      <Text style={styles.memberCount}>{branch.memberCount} member{branch.memberCount !== 1 ? "s" : ""}</Text>
                    </View>
                    {branch.myStatus === "pending" ? (
                      <View
                        style={[styles.pendingPill, { backgroundColor: "rgba(76,217,100,0.15)" }]}
                        testID={`branch-pending-${branch.id}`}
                      >
                        <Feather name="clock" size={12} color="#4CD964" />
                        <Text style={[styles.pendingPillText, { color: "#4CD964" }]}>Pending</Text>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => joinBranchMutation.mutate(branch.id)}
                        disabled={joinBranchMutation.isPending}
                        style={({ pressed }) => [styles.joinBtn, { opacity: pressed ? 0.7 : 1 }]}
                      >
                        {joinBranchMutation.isPending ? (
                          <ActivityIndicator size="small" color="#4CD964" />
                        ) : (
                          <Text style={[styles.joinBtnText, { color: "#4CD964" }]}>Join</Text>
                        )}
                      </Pressable>
                    )}
                  </View>
                ))}
              </>
            )}
          </>
        )}

        <View style={{ height: 24 }} />
        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [styles.signOutBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Feather name="log-out" size={18} color="#FF3B30" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </Pressable>
      </ScrollView>

      {/* ── Account Modal ── */}
      <Modal visible={showAccountModal} transparent animationType="fade" onRequestClose={() => setShowAccountModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Account Details</Text>
              <Pressable onPress={() => setShowAccountModal(false)}>
                <Feather name="x" size={24} color="#FFFFFF" />
              </Pressable>
            </View>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Username</Text>
              <Text style={styles.fieldValue}>@{user?.username}</Text>
            </View>
            <View style={styles.fieldDivider} />
            <Text style={styles.inputLabel}>Display Name</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Your display name"
              placeholderTextColor="#9CA3AF"
              value={newDisplayName}
              onChangeText={setNewDisplayName}
              autoFocus
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable
              onPress={() => { if (!newDisplayName.trim()) { setError("Please enter a name"); return; } updateNameMutation.mutate(newDisplayName.trim()); }}
              disabled={updateNameMutation.isPending}
              style={({ pressed }) => [styles.modalButton, { opacity: pressed || updateNameMutation.isPending ? 0.8 : 1 }]}
            >
              {updateNameMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalButtonText}>Save Changes</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Create Church Modal ── */}
      <Modal visible={showCreateChurchModal} transparent animationType="fade" onRequestClose={() => setShowCreateChurchModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Church</Text>
              <Pressable onPress={() => setShowCreateChurchModal(false)}>
                <Feather name="x" size={24} color="#FFFFFF" />
              </Pressable>
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="Church name"
              placeholderTextColor="#9CA3AF"
              value={churchName}
              onChangeText={setChurchName}
              autoFocus
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable
              onPress={() => { if (!churchName.trim()) { setError("Please enter a name"); return; } createChurchMutation.mutate(churchName.trim()); }}
              disabled={createChurchMutation.isPending}
              style={({ pressed }) => [styles.modalButton, { opacity: pressed || createChurchMutation.isPending ? 0.8 : 1 }]}
            >
              {createChurchMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalButtonText}>Create</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Join Church Modal ── */}
      <Modal visible={showJoinChurchModal} transparent animationType="fade" onRequestClose={() => setShowJoinChurchModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Join Church</Text>
              <Pressable onPress={() => setShowJoinChurchModal(false)}>
                <Feather name="x" size={24} color="#FFFFFF" />
              </Pressable>
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="Enter 6-character code"
              placeholderTextColor="#9CA3AF"
              value={joinCode}
              onChangeText={setJoinCode}
              autoCapitalize="characters"
              autoFocus
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable
              onPress={() => { if (!joinCode.trim()) { setError("Please enter a code"); return; } joinChurchMutation.mutate(joinCode.trim().toUpperCase()); }}
              disabled={joinChurchMutation.isPending}
              style={({ pressed }) => [styles.modalButton, { opacity: pressed || joinChurchMutation.isPending ? 0.8 : 1 }]}
            >
              {joinChurchMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalButtonText}>Join</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Create Branch Modal ── */}
      <Modal visible={showCreateBranchModal} transparent animationType="fade" onRequestClose={() => setShowCreateBranchModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Branch</Text>
              <Pressable onPress={() => setShowCreateBranchModal(false)}>
                <Feather name="x" size={24} color="#FFFFFF" />
              </Pressable>
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="Branch name (e.g. North Campus)"
              placeholderTextColor="#9CA3AF"
              value={branchName}
              onChangeText={setBranchName}
              autoFocus
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable
              onPress={() => { if (!branchName.trim()) { setError("Please enter a name"); return; } createBranchMutation.mutate(branchName.trim()); }}
              disabled={createBranchMutation.isPending}
              style={({ pressed }) => [styles.modalButton, { opacity: pressed || createBranchMutation.isPending ? 0.8 : 1 }]}
            >
              {createBranchMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalButtonText}>Create</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Create Team Modal ── */}
      <Modal visible={showCreateTeamModal} transparent animationType="fade" onRequestClose={() => setShowCreateTeamModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Team</Text>
              <Pressable onPress={() => setShowCreateTeamModal(false)}>
                <Feather name="x" size={24} color="#FFFFFF" />
              </Pressable>
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="Team name (e.g. Monday Group)"
              placeholderTextColor="#9CA3AF"
              value={teamName}
              onChangeText={setTeamName}
              autoFocus
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable
              onPress={() => { if (!teamName.trim()) { setError("Please enter a name"); return; } createTeamMutation.mutate(teamName.trim()); }}
              disabled={createTeamMutation.isPending}
              style={({ pressed }) => [styles.modalButton, { opacity: pressed || createTeamMutation.isPending ? 0.8 : 1 }]}
            >
              {createTeamMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalButtonText}>Create</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F0F23" },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#FFFFFF", paddingHorizontal: 20, paddingBottom: 12 },
  scrollContent: { paddingHorizontal: 20 },

  accountCard: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#1A1A35", borderRadius: 16,
    padding: 16, marginBottom: 20, gap: 14,
  },
  avatarCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#33C3F0", alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  accountTextBlock: { flex: 1 },
  accountDisplayName: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  accountUsername: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  editBtn: { padding: 6 },

  sectionDivider: { height: 1, backgroundColor: "#1E1E3A", marginBottom: 20 },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },

  emptyCard: {
    backgroundColor: "#1A1A35", borderRadius: 12, padding: 24,
    alignItems: "center", gap: 8, marginBottom: 16,
  },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#9CA3AF" },
  emptySubtext: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center" },

  actionRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  actionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 12,
  },
  actionBtnOutline: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: "#33C3F0",
  },
  actionBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },

  levelHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 8, marginTop: 4,
  },
  levelHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  levelHeaderRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  levelHeaderLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.8 },

  smallBtn: { flexDirection: "row", alignItems: "center", gap: 4, padding: 4 },
  smallBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  entityCard: {
    backgroundColor: "#1A1A35", borderRadius: 12, padding: 14,
    flexDirection: "row", alignItems: "center", marginBottom: 10,
    borderLeftWidth: 3, borderLeftColor: "#33C3F0",
  },
  entityCardMain: { flex: 1 },
  entityName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  memberCount: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  codeRow: { flexDirection: "row", marginTop: 2 },
  codeLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280" },
  codeValue: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#33C3F0" },
  entityCardActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconAction: { padding: 6 },

  adminBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "rgba(255,204,0,0.12)", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
  },
  adminBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#FFCC00" },

  pendingBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "#FF3B30", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
  },
  pendingBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#FFFFFF" },

  joinBtn: {
    backgroundColor: "rgba(255,149,0,0.15)", borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: "rgba(255,149,0,0.3)",
  },
  joinBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FF9500" },

  pendingPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(255,149,0,0.15)", borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: "rgba(255,149,0,0.3)",
  },
  pendingPillText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#FF9500" },

  pickBranchHint: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginBottom: 8 },

  signOutBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 12,
    backgroundColor: "rgba(255,59,48,0.08)", borderWidth: 1, borderColor: "rgba(255,59,48,0.2)",
  },
  signOutText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FF3B30" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 20 },
  modalContent: { backgroundColor: "#1A1A35", borderRadius: 20, padding: 24, width: "100%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  modalInput: {
    backgroundColor: "#0F0F23", borderRadius: 10, padding: 14,
    color: "#FFFFFF", fontFamily: "Inter_400Regular", fontSize: 15, marginBottom: 12,
  },
  modalButton: { backgroundColor: "#33C3F0", borderRadius: 10, padding: 14, alignItems: "center" },
  modalButtonText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  errorText: { color: "#FF3B30", fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 8 },

  fieldRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  fieldValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  fieldDivider: { height: 1, backgroundColor: "#0F0F23", marginBottom: 16 },
  inputLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginBottom: 6 },
});
