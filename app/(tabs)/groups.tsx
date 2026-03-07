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
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/query-client";
import { useTracking } from "@/lib/tracking-context";

interface Group {
  id: string;
  name: string;
  code: string;
  createdAt: string;
}

export default function GroupsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state: trackingState, startTracking } = useTracking();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showStartWalkModal, setShowStartWalkModal] = useState(false);
  const [joinedGroupName, setJoinedGroupName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
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

  const handleShareCode = async (group: Group) => {
    try {
      await Share.share({
        message: `Join my StreetCover group "${group.name}"! Use code: ${group.code}`,
      });
    } catch (_e) {}
  };

  const handleStartWalkFromJoin = async () => {
    setShowStartWalkModal(false);
    if (trackingState === "idle") {
      await startTracking();
      router.navigate("/");
    }
  };

  const renderGroup = ({ item }: { item: Group }) => (
    <View style={styles.groupCard}>
      <View style={styles.groupIcon}>
        <Feather name="users" size={20} color="#33C3F0" />
      </View>
      <View style={styles.groupInfo}>
        <Text style={styles.groupName}>{item.name}</Text>
        <View style={styles.codeContainer}>
          <Text style={styles.codeLabel}>Code: </Text>
          <Text style={styles.codeValue}>{item.code}</Text>
        </View>
      </View>
      <Pressable
        onPress={() => handleShareCode(item)}
        style={({ pressed }) => [
          styles.shareButton,
          pressed && { opacity: 0.6 },
        ]}
      >
        <Feather name="share" size={18} color="#33C3F0" />
      </Pressable>
    </View>
  );

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + webTopInset },
      ]}
    >
      <Text style={styles.title}>Groups</Text>

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
          <Text style={[styles.actionButtonText, { color: "#33C3F0" }]}>
            Join
          </Text>
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
            Create a group or join one with a code to share coverage with
            friends
          </Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          renderItem={renderGroup}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() =>
                queryClient.invalidateQueries({ queryKey: ["/api/groups"] })
              }
              tintColor="#33C3F0"
            />
          }
          scrollEnabled={groups.length > 0}
        />
      )}

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
            <Text style={styles.successTitle}>
              Joined {joinedGroupName}!
            </Text>
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
            <Pressable
              onPress={() => setShowStartWalkModal(false)}
              style={styles.skipButton}
            >
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
    marginBottom: 16,
    fontFamily: "Inter_700Bold",
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
  listContent: {
    paddingBottom: Platform.OS === "web" ? 84 : 100,
    gap: 10,
  },
  groupCard: {
    backgroundColor: "#1A1A2E",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
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
  groupName: {
    fontSize: 16,
    fontWeight: "600" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_600SemiBold",
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
  shareButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(51, 195, 240, 0.1)",
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
