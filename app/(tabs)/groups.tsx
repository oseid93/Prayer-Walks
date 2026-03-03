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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/query-client";

interface Group {
  id: string;
  name: string;
  code: string;
  createdAt: string;
}

export default function GroupsScreen() {
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setShowJoinModal(false);
      setJoinCode("");
      setError("");
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
});
