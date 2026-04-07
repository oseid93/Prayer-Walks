import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  Pressable,
  TextInput,
  Modal,
  Platform,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Share,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/query-client";
import { useTracking } from "@/lib/tracking-context";
import { useAuth } from "@/lib/auth-context";

interface Group {
  id: string;
  name: string;
  code: string;
  role: string;
  createdAt: string;
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const router = useRouter();
  const { state: trackingState, startTracking } = useTracking();
  const { user, logout } = useAuth();
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  // Tab bar height + sign out button area reserved at the bottom
  const tabBarHeight = Platform.OS === "web" ? 84 : 49;
  const signOutAreaHeight = insets.bottom + tabBarHeight + 68;

  // Push the divider line to exactly the halfway point of the screen.
  // Fixed heights above the spacer: title (~56px) + accountCard (~88px) + accountCard marginBottom (24px) ≈ 168px
  const ABOVE_SPACER_HEIGHT = 168;
  const groupsSpacer = Math.max(
    0,
    screenHeight / 2 - (insets.top + webTopInset + ABOVE_SPACER_HEIGHT)
  );

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showStartWalkModal, setShowStartWalkModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);

  const [joinedGroupName, setJoinedGroupName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [error, setError] = useState("");

  const {
    data: groups,
    isLoading,
    isRefetching,
  } = useQuery<Group[]>({
    queryKey: ["/api/groups"],
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/groups", { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setShowCreateModal(false);
      setGroupName("");
      setError("");
    },
    onError: (err: any) => {
      setError(err.message || "Failed to create group");
    },
  });

  const joinMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/groups/join", { code });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setShowJoinModal(false);
      setJoinCode("");
      setError("");
      setJoinedGroupName(data.name || "the group");
      setShowStartWalkModal(true);
    },
    onError: (err: any) => {
      setError(err.message || "Failed to join group");
    },
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
    onError: (err: any) => {
      setError(err.message || "Failed to update name");
    },
  });

  const leaveMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const res = await apiRequest("DELETE", `/api/groups/${groupId}/leave`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
    },
    onError: (err: any) => {
      Alert.alert("Error", err.message || "Failed to leave group");
    },
  });

  const handleCreate = () => {
    if (!groupName.trim()) {
      setError("Please enter a group name");
      return;
    }
    createMutation.mutate(groupName.trim());
  };

  const handleJoin = () => {
    if (!joinCode.trim()) {
      setError("Please enter a group code");
      return;
    }
    joinMutation.mutate(joinCode.trim().toUpperCase());
  };

  const handleUpdateName = () => {
    if (!newDisplayName.trim()) {
      setError("Please enter a name");
      return;
    }
    updateNameMutation.mutate(newDisplayName.trim());
  };

  const handleShareCode = async (group: Group) => {
    try {
      await Share.share({
        message: `Join my Prayer Walks group "${group.name}"! Use code: ${group.code}`,
      });
    } catch (_e) {}
  };

  const handleLeaveGroup = (group: Group) => {
    Alert.alert(
      "Leave Group",
      `Are you sure you want to leave "${group.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => leaveMutation.mutate(group.id),
        },
      ],
    );
  };

  const handleLogout = () => {
    Alert.alert(
      "Sign Out",
      "Are you sure you want to sign out?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out",
          style: "destructive",
          onPress: () => logout(),
        },
      ],
    );
  };

  const handleStartWalkFromJoin = async () => {
    setShowStartWalkModal(false);
    if (trackingState === "idle") {
      await startTracking();
      router.navigate("/");
    }
  };

  const displayName = user?.displayName ?? user?.username ?? "Account";
  const initial = displayName.charAt(0).toUpperCase();

  const renderGroup = ({ item }: { item: Group }) => (
    <View style={styles.groupCard}>
      <Pressable
        onPress={() =>
          router.push({
            pathname: "/group-detail",
            params: { id: item.id, name: item.name, role: item.role },
          })
        }
        style={styles.groupCardMain}
      >
        <View style={styles.groupIcon}>
          <Feather name="users" size={20} color="#33C3F0" />
        </View>
        <View style={styles.groupInfo}>
          <View style={styles.groupNameRow}>
            <Text style={styles.groupName}>{item.name}</Text>
            {item.role === "admin" && (
              <View style={styles.adminBadge}>
                <Feather name="shield" size={10} color="#FFCC00" />
                <Text style={styles.adminBadgeText}>Admin</Text>
              </View>
            )}
          </View>
          <View style={styles.codeContainer}>
            <Text style={styles.codeLabel}>Code: </Text>
            <Text style={styles.codeValue}>{item.code}</Text>
          </View>
        </View>
      </Pressable>
      <View style={styles.groupActions}>
        <Pressable
          onPress={() => handleShareCode(item)}
          style={({ pressed }) => [
            styles.iconBtn,
            { backgroundColor: "rgba(51, 195, 240, 0.1)", opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Feather name="share" size={16} color="#33C3F0" />
        </Pressable>
        <Pressable
          onPress={() => handleLeaveGroup(item)}
          style={({ pressed }) => [
            styles.iconBtn,
            { backgroundColor: "rgba(255, 59, 48, 0.1)", opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Feather name="log-out" size={16} color="#FF3B30" />
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <Text style={styles.title}>Profile</Text>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: signOutAreaHeight + 16 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => queryClient.invalidateQueries({ queryKey: ["/api/groups"] })}
            tintColor="#33C3F0"
          />
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
            {user?.email ? (
              <Text style={styles.accountEmail}>{user.email}</Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => {
              setNewDisplayName(user?.displayName ?? "");
              setError("");
              setShowAccountModal(true);
            }}
            style={({ pressed }) => [styles.editBtn, { opacity: pressed ? 0.6 : 1 }]}
            hitSlop={8}
          >
            <Feather name="edit-2" size={16} color="#33C3F0" />
          </Pressable>
        </View>

        {/* Spacer to push the divider to roughly the halfway point of the screen */}
        {groupsSpacer > 0 && <View style={{ height: groupsSpacer }} />}

        {/* Divider */}
        <View style={styles.sectionDivider} />

        {/* Groups section */}
        <Text style={styles.sectionLabel}>My Groups</Text>

        <View style={styles.actionButtons}>
          <Pressable
            onPress={() => {
              setError("");
              setShowCreateModal(true);
            }}
            style={({ pressed }) => [
              styles.actionButton,
              { backgroundColor: "#33C3F0", opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Feather name="plus" size={18} color="#fff" />
            <Text style={styles.actionButtonText}>Create</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setError("");
              setShowJoinModal(true);
            }}
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: "transparent",
                borderWidth: 1,
                borderColor: "#33C3F0",
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Feather name="log-in" size={18} color="#33C3F0" />
            <Text style={[styles.actionButtonText, { color: "#33C3F0" }]}>Join</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#33C3F0" />
          </View>
        ) : !groups || groups.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Feather name="users" size={40} color="#6B7280" />
            <Text style={styles.emptyText}>No groups yet</Text>
            <Text style={styles.emptySubtext}>
              Create a group or join one with a code to share coverage with friends
            </Text>
          </View>
        ) : (
          <View style={styles.groupsList}>
            {groups.map((item) => (
              <React.Fragment key={item.id}>{renderGroup({ item })}</React.Fragment>
            ))}
          </View>
        )}

      </ScrollView>

      {/* Sign Out pinned just above the tab bar */}
      <Pressable
        onPress={handleLogout}
        style={({ pressed }) => [
          styles.signOutBtn,
          {
            bottom: insets.bottom + tabBarHeight + 12,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Feather name="log-out" size={18} color="#FF3B30" />
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>

      {/* Account Details Modal */}
      <Modal
        visible={showAccountModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAccountModal(false)}
      >
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
              onPress={handleUpdateName}
              disabled={updateNameMutation.isPending}
              style={({ pressed }) => [
                styles.modalButton,
                { opacity: pressed || updateNameMutation.isPending ? 0.8 : 1 },
              ]}
            >
              {updateNameMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalButtonText}>Save Changes</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Create Group Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Group</Text>
              <Pressable onPress={() => setShowCreateModal(false)}>
                <Feather name="x" size={24} color="#FFFFFF" />
              </Pressable>
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="Group name"
              placeholderTextColor="#9CA3AF"
              value={groupName}
              onChangeText={setGroupName}
              autoFocus
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable
              onPress={handleCreate}
              disabled={createMutation.isPending}
              style={({ pressed }) => [
                styles.modalButton,
                { opacity: pressed || createMutation.isPending ? 0.8 : 1 },
              ]}
            >
              {createMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalButtonText}>Create</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Join Group Modal */}
      <Modal
        visible={showJoinModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowJoinModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Join Group</Text>
              <Pressable onPress={() => setShowJoinModal(false)}>
                <Feather name="x" size={24} color="#FFFFFF" />
              </Pressable>
            </View>
            <TextInput
              style={[styles.modalInput, styles.codeInput]}
              placeholder="Enter 6-character code"
              placeholderTextColor="#9CA3AF"
              value={joinCode}
              onChangeText={(text) => setJoinCode(text.toUpperCase())}
              maxLength={6}
              autoCapitalize="characters"
              autoFocus
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable
              onPress={handleJoin}
              disabled={joinMutation.isPending}
              style={({ pressed }) => [
                styles.modalButton,
                { opacity: pressed || joinMutation.isPending ? 0.8 : 1 },
              ]}
            >
              {joinMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalButtonText}>Join</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Post-join start walk prompt */}
      <Modal
        visible={showStartWalkModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStartWalkModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.successIcon}>
              <Feather name="check-circle" size={48} color="#4CD964" />
            </View>
            <Text style={styles.successTitle}>Joined {joinedGroupName}!</Text>
            <Text style={styles.successSubtext}>
              Start walking to contribute to your group's coverage
            </Text>
            <Pressable
              onPress={handleStartWalkFromJoin}
              style={({ pressed }) => [
                styles.modalButton,
                { opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <View style={styles.startWalkRow}>
                <Feather name="play" size={18} color="#FFFFFF" />
                <Text style={styles.modalButtonText}>Start Walking</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => setShowStartWalkModal(false)} style={styles.skipButton}>
              <Text style={styles.skipText}>Maybe Later</Text>
            </Pressable>
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
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "700" as const,
    color: "#FFFFFF",
    marginTop: 16,
    marginBottom: 20,
    fontFamily: "Inter_700Bold",
  },
  scrollContent: {
    gap: 0,
  },
  accountCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A2E",
    borderRadius: 16,
    padding: 16,
    gap: 14,
    marginBottom: 24,
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(51, 195, 240, 0.2)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(51, 195, 240, 0.4)",
  },
  avatarInitial: {
    fontSize: 24,
    fontWeight: "700" as const,
    color: "#33C3F0",
    fontFamily: "Inter_700Bold",
  },
  accountTextBlock: {
    flex: 1,
    gap: 3,
  },
  accountDisplayName: {
    fontSize: 18,
    fontWeight: "600" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_600SemiBold",
  },
  accountUsername: {
    fontSize: 13,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
  },
  accountEmail: {
    fontSize: 12,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  editBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(51, 195, 240, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  sectionDivider: {
    height: 1,
    backgroundColor: "#2D2D44",
    marginVertical: 8,
  },
  signOutBtn: {
    position: "absolute",
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255, 59, 48, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 59, 48, 0.2)",
  },
  signOutText: {
    fontSize: 15,
    fontWeight: "600" as const,
    color: "#FF3B30",
    fontFamily: "Inter_600SemiBold",
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: "#6B7280",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 24,
    marginBottom: 16,
  },
  actionButtons: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600" as const,
    fontFamily: "Inter_600SemiBold",
  },
  groupsList: {
    gap: 10,
  },
  groupCard: {
    backgroundColor: "#1A1A2E",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
  },
  groupCardMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  groupIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(51, 195, 240, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  groupInfo: {
    flex: 1,
    gap: 4,
  },
  groupNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  groupName: {
    fontSize: 16,
    fontWeight: "600" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_600SemiBold",
  },
  adminBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255, 204, 0, 0.12)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  adminBadgeText: {
    fontSize: 11,
    color: "#FFCC00",
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600" as const,
  },
  codeContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  codeLabel: {
    fontSize: 13,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
  },
  codeValue: {
    fontSize: 13,
    color: "#33C3F0",
    fontWeight: "600" as const,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 2,
  },
  groupActions: {
    flexDirection: "row",
    gap: 8,
    marginLeft: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingContainer: {
    paddingTop: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyContainer: {
    paddingTop: 40,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContent: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#1A1A2E",
    borderRadius: 16,
    padding: 24,
    gap: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
  },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  fieldLabel: {
    fontSize: 14,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
  },
  fieldValue: {
    fontSize: 14,
    color: "#FFFFFF",
    fontFamily: "Inter_500Medium",
    fontWeight: "500" as const,
  },
  fieldDivider: {
    height: 1,
    backgroundColor: "#2D2D44",
  },
  inputLabel: {
    fontSize: 13,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
    marginBottom: -8,
  },
  modalInput: {
    backgroundColor: "#0F0F23",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#2D2D44",
    fontFamily: "Inter_400Regular",
  },
  codeInput: {
    fontSize: 20,
    letterSpacing: 4,
    textAlign: "center",
    fontFamily: "Inter_600SemiBold",
  },
  errorText: {
    color: "#FF3B30",
    fontSize: 14,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  modalButton: {
    backgroundColor: "#33C3F0",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  modalButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600" as const,
    fontFamily: "Inter_600SemiBold",
  },
  successIcon: {
    alignItems: "center",
    paddingTop: 8,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: "#FFFFFF",
    textAlign: "center",
    fontFamily: "Inter_700Bold",
  },
  successSubtext: {
    fontSize: 14,
    color: "#9CA3AF",
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  startWalkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  skipButton: {
    paddingVertical: 8,
    alignItems: "center",
  },
  skipText: {
    color: "#9CA3AF",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
});
