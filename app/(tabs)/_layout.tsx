import { Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";

interface PendingRequestsSummary {
  total: number;
  branches: Array<{ branchId: string; name: string; count: number }>;
  teams: Array<{ teamId: string; name: string; count: number }>;
}

export default function TabLayout() {
  const { user } = useAuth();

  const { data: pending } = useQuery<PendingRequestsSummary>({
    queryKey: ["/api/my-pending-requests"],
    enabled: !!user,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const pendingCount = pending?.total ?? 0;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#33C3F0",
        tabBarInactiveTintColor: "#6B7280",
        headerShown: false,
        tabBarStyle: {
          position: "absolute" as const,
          backgroundColor: Platform.select({
            ios: "transparent",
            android: "#0F0F23",
            web: "#0F0F23",
          }),
          borderTopWidth: 0,
          elevation: 0,
          height: Platform.OS === "web" ? 84 : undefined,
        },
        tabBarBackground: () =>
          Platform.OS === "ios" ? (
            <BlurView
              intensity={100}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarIcon: ({ color, size }) => (
            <Feather name="clock" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: "Map",
          tabBarIcon: ({ color, size }) => (
            <Feather name="map" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Feather name="user" size={size} color={color} />
          ),
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: "#FF3B30",
            color: "#FFFFFF",
            fontSize: 11,
            fontWeight: "700",
            minWidth: 18,
            height: 18,
            lineHeight: 18,
          },
        }}
      />
    </Tabs>
  );
}
