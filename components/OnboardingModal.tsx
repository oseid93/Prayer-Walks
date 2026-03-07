import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  TextInput,
  Modal,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/query-client";
import { useAuth } from "@/lib/auth-context";

interface OnboardingModalProps {
  visible: boolean;
  onDismiss: () => void;
}

export default function OnboardingModal({ visible, onDismiss }: OnboardingModalProps) {
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const { setIsNewUser } = useAuth();

  const joinMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/groups/join", { code });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setJoinCode("");
      setError("");
      setIsNewUser(false);
      onDismiss();
    },
    onError: (err: any) => {
      setError(err.message || "Invalid code");
    },
  });

  const handleJoin = () => {
    if (!joinCode.trim()) {
      setError("Please enter a group code");
      return;
    }
    joinMutation.mutate(joinCode.trim().toUpperCase());
  };

  const handleSkip = () => {
    setIsNewUser(false);
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleSkip}
    >
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.iconWrap}>
            <Feather name="users" size={48} color="#33C3F0" />
          </View>
          <Text style={styles.title}>Join a Group</Text>
          <Text style={styles.subtitle}>
            Got a group code from a friend? Enter it below to start
            tracking together.
          </Text>

          <TextInput
            style={styles.codeInput}
            placeholder="Enter 6-character code"
            placeholderTextColor="#9CA3AF"
            value={joinCode}
            onChangeText={(text) => setJoinCode(text.toUpperCase())}
            maxLength={6}
            autoCapitalize="characters"
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            onPress={handleJoin}
            disabled={joinMutation.isPending}
            style={({ pressed }) => [
              styles.joinButton,
              { opacity: pressed || joinMutation.isPending ? 0.8 : 1 },
            ]}
          >
            {joinMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.joinButtonText}>Join Group</Text>
            )}
          </Pressable>

          <Pressable onPress={handleSkip} style={styles.skipButton}>
            <Text style={styles.skipText}>Skip for now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  content: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#1A1A2E",
    borderRadius: 16,
    padding: 24,
    gap: 16,
    alignItems: "center",
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: "rgba(51, 195, 240, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "700" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 14,
    color: "#9CA3AF",
    textAlign: "center",
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  codeInput: {
    width: "100%",
    backgroundColor: "#0F0F23",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 20,
    color: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#2D2D44",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 4,
    textAlign: "center",
  },
  errorText: {
    color: "#FF3B30",
    fontSize: 14,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  joinButton: {
    width: "100%",
    backgroundColor: "#33C3F0",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  joinButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600" as const,
    fontFamily: "Inter_600SemiBold",
  },
  skipButton: {
    paddingVertical: 8,
  },
  skipText: {
    color: "#9CA3AF",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
});
