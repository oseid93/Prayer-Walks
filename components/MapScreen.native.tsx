import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import MapView, { Polyline } from "react-native-maps";
import { useTracking } from "@/lib/tracking-context";
import { useAuth } from "@/lib/auth-context";
import { useQuery } from "@tanstack/react-query";
import {
  buildCoverageSegments,
  formatDuration,
  formatDistance,
} from "@/lib/coverage-utils";

interface RoutePointData {
  latitude: number;
  longitude: number;
}

export default function NativeMapScreen() {
  const insets = useSafeAreaInsets();
  const {
    state,
    elapsedTime,
    distance,
    currentPoints,
    currentLocation,
    startTracking,
    pauseTracking,
    resumeTracking,
    stopTracking,
  } = useTracking();
  const { user } = useAuth();
  const mapRef = useRef<MapView>(null);
  const [viewMode, setViewMode] = useState<"personal" | "group">("personal");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const { data: coveragePoints } = useQuery<RoutePointData[]>({
    queryKey: ["/api/coverage"],
    enabled: !!user,
  });

  const { data: groups } = useQuery<any[]>({
    queryKey: ["/api/groups"],
    enabled: !!user,
  });

  const { data: groupCoverage } = useQuery<RoutePointData[]>({
    queryKey: ["/api/groups", selectedGroupId, "coverage"],
    enabled: !!selectedGroupId && viewMode === "group",
  });

  const coverageData =
    viewMode === "group" && groupCoverage
      ? groupCoverage
      : coveragePoints || [];

  const coverageSegments = buildCoverageSegments(coverageData);

  const currentTrackPoints = currentPoints.map((p) => ({
    latitude: p.latitude,
    longitude: p.longitude,
  }));

  useEffect(() => {
    if (currentLocation && mapRef.current && state === "tracking") {
      mapRef.current.animateToRegion(
        {
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        },
        500,
      );
    }
  }, [currentLocation, state]);

  const initialRegion = currentLocation
    ? {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }
    : {
        latitude: 51.5074,
        longitude: -0.1278,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton={false}
        userInterfaceStyle="dark"
        testID="map-view"
      >
        {coverageSegments.map((seg, i) => (
          <Polyline
            key={`cov-${i}`}
            coordinates={[seg.start, seg.end]}
            strokeColor={seg.color}
            strokeWidth={seg.width}
            lineCap="round"
            lineJoin="round"
          />
        ))}

        {currentTrackPoints.length >= 2 && (
          <Polyline
            coordinates={currentTrackPoints}
            strokeColor="#33C3F0"
            strokeWidth={4}
            lineCap="round"
            lineJoin="round"
          />
        )}
      </MapView>

      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <View style={styles.modeToggle}>
          <Pressable
            onPress={() => setViewMode("personal")}
            style={[
              styles.modeButton,
              viewMode === "personal" && styles.modeButtonActive,
            ]}
          >
            <Feather
              name="user"
              size={16}
              color={viewMode === "personal" ? "#fff" : "#9CA3AF"}
            />
            <Text
              style={[
                styles.modeText,
                viewMode === "personal" && styles.modeTextActive,
              ]}
            >
              Me
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setViewMode("group");
              if (groups && groups.length > 0 && !selectedGroupId) {
                setSelectedGroupId(groups[0].id);
              }
            }}
            style={[
              styles.modeButton,
              viewMode === "group" && styles.modeButtonActive,
            ]}
          >
            <Feather
              name="users"
              size={16}
              color={viewMode === "group" ? "#fff" : "#9CA3AF"}
            />
            <Text
              style={[
                styles.modeText,
                viewMode === "group" && styles.modeTextActive,
              ]}
            >
              Group
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => {
            if (currentLocation && mapRef.current) {
              mapRef.current.animateToRegion(
                {
                  latitude: currentLocation.latitude,
                  longitude: currentLocation.longitude,
                  latitudeDelta: 0.005,
                  longitudeDelta: 0.005,
                },
                500,
              );
            }
          }}
          style={styles.locationButton}
        >
          <Feather name="crosshair" size={20} color="#33C3F0" />
        </Pressable>
      </View>

      {state !== "idle" && (
        <View style={[styles.statsOverlay, { top: insets.top + 60 }]}>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Feather name="clock" size={16} color="#33C3F0" />
              <Text style={styles.statValue}>
                {formatDuration(elapsedTime)}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Feather name="navigation" size={16} color="#4CD964" />
              <Text style={styles.statValue}>{formatDistance(distance)}</Text>
            </View>
          </View>
        </View>
      )}

      <View style={styles.legend}>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: "#4CD964" }]} />
          <Text style={styles.legendText}>1x</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: "#FFCC00" }]} />
          <Text style={styles.legendText}>2-3x</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: "#FF9500" }]} />
          <Text style={styles.legendText}>4-5x</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: "#FF3B30" }]} />
          <Text style={styles.legendText}>6+</Text>
        </View>
      </View>

      <View style={styles.controlsContainer}>
        {state === "idle" && (
          <Pressable
            onPress={startTracking}
            style={({ pressed }) => [
              styles.fab,
              { backgroundColor: "#4CD964", opacity: pressed ? 0.8 : 1 },
            ]}
            testID="start-tracking"
          >
            <Feather name="play" size={28} color="#fff" />
          </Pressable>
        )}
        {state === "tracking" && (
          <View style={styles.controlsRow}>
            <Pressable
              onPress={pauseTracking}
              style={({ pressed }) => [
                styles.controlButton,
                { backgroundColor: "#FF9500", opacity: pressed ? 0.8 : 1 },
              ]}
              testID="pause-tracking"
            >
              <Feather name="pause" size={24} color="#fff" />
            </Pressable>
            <Pressable
              onPress={stopTracking}
              style={({ pressed }) => [
                styles.controlButton,
                { backgroundColor: "#FF3B30", opacity: pressed ? 0.8 : 1 },
              ]}
              testID="stop-tracking"
            >
              <Feather name="square" size={24} color="#fff" />
            </Pressable>
          </View>
        )}
        {state === "paused" && (
          <View style={styles.controlsRow}>
            <Pressable
              onPress={resumeTracking}
              style={({ pressed }) => [
                styles.controlButton,
                { backgroundColor: "#4CD964", opacity: pressed ? 0.8 : 1 },
              ]}
              testID="resume-tracking"
            >
              <Feather name="play" size={24} color="#fff" />
            </Pressable>
            <Pressable
              onPress={stopTracking}
              style={({ pressed }) => [
                styles.controlButton,
                { backgroundColor: "#FF3B30", opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Feather name="square" size={24} color="#fff" />
            </Pressable>
          </View>
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
  topBar: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 10,
  },
  modeToggle: {
    flexDirection: "row",
    backgroundColor: "rgba(15, 15, 35, 0.9)",
    borderRadius: 12,
    padding: 4,
  },
  modeButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  modeButtonActive: {
    backgroundColor: "#33C3F0",
  },
  modeText: {
    fontSize: 13,
    color: "#9CA3AF",
    fontFamily: "Inter_500Medium",
  },
  modeTextActive: {
    color: "#FFFFFF",
  },
  locationButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(15, 15, 35, 0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  statsOverlay: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 10,
  },
  statsRow: {
    flexDirection: "row",
    backgroundColor: "rgba(15, 15, 35, 0.9)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statDivider: {
    width: 1,
    height: 20,
    backgroundColor: "#2D2D44",
  },
  statValue: {
    fontSize: 16,
    fontWeight: "600" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_600SemiBold",
  },
  legend: {
    position: "absolute",
    right: 16,
    bottom: 140,
    backgroundColor: "rgba(15, 15, 35, 0.9)",
    borderRadius: 10,
    padding: 10,
    gap: 6,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
  },
  controlsContainer: {
    position: "absolute",
    bottom: 100,
    alignSelf: "center",
    zIndex: 10,
  },
  fab: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  controlsRow: {
    flexDirection: "row",
    gap: 16,
  },
  controlButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});
