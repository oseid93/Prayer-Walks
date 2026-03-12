import React, { useRef, useEffect, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Linking,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import MapView, { Polyline, Marker } from "react-native-maps";
import { formatDuration, formatDistance } from "@/lib/coverage-utils";

interface Session {
  id: string;
  startedAt: string;
  endedAt: string | null;
  totalDistance: number;
  totalDuration: number;
}

interface RoutePoint {
  latitude: number;
  longitude: number;
}

function RouteMap({ points }: { points: RoutePoint[] }) {
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (mapRef.current && points.length >= 2) {
      const timer = setTimeout(() => {
        mapRef.current?.fitToCoordinates(points, {
          edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
          animated: true,
        });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [points]);

  const startPoint = points[0];
  const endPoint = points[points.length - 1];

  return (
    <MapView
      ref={mapRef}
      style={styles.map}
      userInterfaceStyle="dark"
      showsCompass={false}
      showsUserLocation={false}
      scrollEnabled={true}
      zoomEnabled={true}
      rotateEnabled={true}
      initialRegion={{
        latitude: startPoint.latitude,
        longitude: startPoint.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }}
    >
      <Polyline
        coordinates={points}
        strokeColor="#33C3F0"
        strokeWidth={4}
        lineCap="round"
        lineJoin="round"
      />
      <Marker coordinate={startPoint} pinColor="#4CD964" title="Start" />
      <Marker coordinate={endPoint} pinColor="#FF3B30" title="End" />
    </MapView>
  );
}

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: points, isLoading: pointsLoading } = useQuery<RoutePoint[]>({
    queryKey: [`/api/sessions/${id}/points`],
    enabled: !!id,
  });

  const { data: sessions } = useQuery<Session[]>({
    queryKey: ["/api/sessions"],
  });

  const session = sessions?.find((s) => s.id === id);

  const formatDate = (dateStr: string): string => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const shareOnWhatsApp = useCallback(async () => {
    if (!session) return;

    const date = formatDate(session.startedAt);
    const distance = formatDistance(session.totalDistance || 0);
    const duration = formatDuration(session.totalDuration || 0);

    const message =
      `🚶 Just completed a walk with StreetCover!\n\n` +
      `📅 ${date}\n` +
      `📍 Distance: ${distance}\n` +
      `⏱ Duration: ${duration}\n\n` +
      `Tracking every street I walk 🗺️`;

    const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(message)}`;
    const webUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;

    const canOpen = await Linking.canOpenURL(whatsappUrl);
    if (canOpen) {
      await Linking.openURL(whatsappUrl);
    } else {
      const canOpenWeb = await Linking.canOpenURL(webUrl);
      if (canOpenWeb) {
        await Linking.openURL(webUrl);
      } else {
        Alert.alert(
          "WhatsApp not found",
          "Install WhatsApp to share your walk.",
          [{ text: "OK" }]
        );
      }
    }
  }, [session]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          testID="back-button"
        >
          <Feather name="arrow-left" size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Walk Details</Text>
        <Pressable
          onPress={shareOnWhatsApp}
          style={styles.shareButton}
          disabled={!session}
          testID="share-whatsapp-button"
        >
          <Feather name="share-2" size={20} color={session ? "#25D366" : "#4B5563"} />
        </Pressable>
      </View>

      {session && (
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Feather name="calendar" size={14} color="#9CA3AF" />
            <Text style={styles.statText}>
              {formatDate(session.startedAt)}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Feather name="clock" size={14} color="#33C3F0" />
            <Text style={styles.statText}>
              {formatDuration(session.totalDuration || 0)}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Feather name="navigation" size={14} color="#4CD964" />
            <Text style={styles.statText}>
              {formatDistance(session.totalDistance || 0)}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.mapContainer}>
        {pointsLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color="#33C3F0" />
          </View>
        ) : !points || points.length === 0 ? (
          <View style={styles.centerContainer}>
            <Feather name="map" size={40} color="#6B7280" />
            <Text style={styles.emptyText}>No GPS points recorded</Text>
            <Text style={styles.emptySubText}>Try a longer walk to see your route here</Text>
          </View>
        ) : points.length < 2 ? (
          <View style={styles.centerContainer}>
            <Feather name="map-pin" size={40} color="#6B7280" />
            <Text style={styles.emptyText}>Route too short to display</Text>
            <Text style={styles.emptySubText}>Only {points.length} point recorded — walk a bit further</Text>
          </View>
        ) : (
          <RouteMap points={points} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F0F23",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1A1A2E",
    alignItems: "center",
    justifyContent: "center",
  },
  shareButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1A1A2E",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_600SemiBold",
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#1A1A2E",
    marginHorizontal: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statText: {
    fontSize: 13,
    color: "#FFFFFF",
    fontFamily: "Inter_400Regular",
  },
  mapContainer: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#1A1A2E",
  },
  map: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  emptySubText: {
    fontSize: 12,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 4,
    paddingHorizontal: 24,
  },
});
