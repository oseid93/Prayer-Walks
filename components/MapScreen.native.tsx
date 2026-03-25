import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Modal,
  TextInput,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import MapView, { Polyline, Polygon, Marker, Camera } from "react-native-maps";
import * as Location from "expo-location";
import { useTracking } from "@/lib/tracking-context";
import { useAuth } from "@/lib/auth-context";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getApiUrl } from "@/lib/query-client";
import {
  buildCoveragePolylines,
  formatDuration,
  formatDistance,
} from "@/lib/coverage-utils";
import { useFocusEffect } from "expo-router";
import { subscribeMapFocus, consumeMapFocusZone } from "@/lib/map-focus";
import TutorialModal from "@/components/TutorialModal";

interface RoutePointData {
  latitude: number;
  longitude: number;
  sessionId?: string;
  timestamp?: string;
}

interface PriorityArea {
  id: string;
  groupId: string;
  name: string;
  color: string;
  coordinates: Array<{ latitude: number; longitude: number }>;
}

interface GroupWithRole {
  id: string;
  name: string;
  role: string;
}

const AREA_COLORS = [
  { value: "#FF9500", label: "Orange" },
  { value: "#FF3B30", label: "Red" },
  { value: "#AF52DE", label: "Purple" },
  { value: "#33C3F0", label: "Blue" },
  { value: "#FF2D55", label: "Pink" },
  { value: "#4CD964", label: "Green" },
];

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function NativeMapScreen() {
  const insets = useSafeAreaInsets();
  const {
    state,
    elapsedTime,
    distance,
    currentPoints,
    currentLocation,
    heading,
    startTracking,
    pauseTracking,
    resumeTracking,
    stopTracking,
    centerOnLocation,
    completedSession,
    clearCompletedSession,
  } = useTracking();
  const { user } = useAuth();
  const mapRef = useRef<MapView>(null);
  const [viewMode, setViewMode] = useState<"personal" | "group">("personal");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [initialLocationSet, setInitialLocationSet] = useState(false);
  const isFollowingRef = useRef(false);
  const lastCameraUpdateRef = useRef(0);

  // Draw mode state
  const [drawMode, setDrawMode] = useState(false);
  const [drawVertices, setDrawVertices] = useState<
    Array<{ latitude: number; longitude: number }>
  >([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [areaName, setAreaName] = useState("");
  const [saveGroupId, setSaveGroupId] = useState<string | null>(null);
  const [areaColor, setAreaColor] = useState(AREA_COLORS[0].value);
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted" || cancelled) return;
      const last = await Location.getLastKnownPositionAsync();
      if (last && !cancelled) {
        mapRef.current?.animateToRegion(
          {
            latitude: last.coords.latitude,
            longitude: last.coords.longitude,
            latitudeDelta: 0.008,
            longitudeDelta: 0.008,
          },
          300,
        );
        setInitialLocationSet(true);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,
      });
      if (!cancelled) {
        mapRef.current?.animateToRegion(
          {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            latitudeDelta: 0.008,
            longitudeDelta: 0.008,
          },
          300,
        );
        setInitialLocationSet(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { data: coveragePoints } = useQuery<RoutePointData[]>({
    queryKey: ["/api/coverage"],
    enabled: !!user,
  });

  const { data: groups } = useQuery<GroupWithRole[]>({
    queryKey: ["/api/groups"],
    enabled: !!user,
  });

  const { data: groupCoverage } = useQuery<RoutePointData[]>({
    queryKey: ["/api/groups", selectedGroupId, "coverage"],
    enabled: !!selectedGroupId && viewMode === "group",
  });

  const { data: priorityAreas } = useQuery<PriorityArea[]>({
    queryKey: ["/api/my-priority-areas"],
    enabled: !!user,
    refetchInterval: 30000,
  });

  const adminGroups = groups?.filter((g) => g.role === "admin") ?? [];
  const isAdminAny = adminGroups.length > 0;

  const coverageData =
    viewMode === "group" && groupCoverage
      ? groupCoverage
      : coveragePoints || [];

  const coveragePolylines = buildCoveragePolylines(coverageData);

  const currentTrackPoints = currentPoints.map((p) => ({
    latitude: p.latitude,
    longitude: p.longitude,
  }));

  useEffect(() => {
    if (currentLocation && mapRef.current && !initialLocationSet) {
      mapRef.current.animateToRegion(
        {
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008,
        },
        1000,
      );
      setInitialLocationSet(true);
    }
  }, [currentLocation, initialLocationSet]);

  useEffect(() => {
    if (state === "tracking") {
      isFollowingRef.current = true;
    } else {
      isFollowingRef.current = false;
    }
  }, [state]);

  useEffect(() => {
    if (
      currentLocation &&
      mapRef.current &&
      state === "tracking" &&
      isFollowingRef.current
    ) {
      const now = Date.now();
      if (now - lastCameraUpdateRef.current < 1500) return;
      lastCameraUpdateRef.current = now;
      const camera: Camera = {
        center: {
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
        },
        zoom: 17,
        heading: heading ?? 0,
        pitch: 45,
        altitude: 500,
      };
      mapRef.current.animateCamera(camera, { duration: 600 });
    }
  }, [currentLocation, heading, state]);

  useFocusEffect(
    useCallback(() => {
      const zone = consumeMapFocusZone();
      if (zone && mapRef.current) {
        setTimeout(() => {
          mapRef.current?.animateToRegion(zone, 600);
        }, 200);
      }
      const unsub = subscribeMapFocus((zone) => {
        setTimeout(() => {
          mapRef.current?.animateToRegion(zone, 600);
        }, 200);
      });
      return unsub;
    }, []),
  );

  const handleCenterOnLocation = useCallback(async () => {
    isFollowingRef.current = true;
    lastCameraUpdateRef.current = 0;
    const loc = currentLocation;
    if (loc && mapRef.current) {
      if (state === "tracking") {
        const camera: Camera = {
          center: { latitude: loc.latitude, longitude: loc.longitude },
          zoom: 17,
          heading: heading ?? 0,
          pitch: 45,
          altitude: 500,
        };
        mapRef.current.animateCamera(camera, { duration: 500 });
      } else {
        mapRef.current.animateToRegion(
          {
            latitude: loc.latitude,
            longitude: loc.longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          },
          500,
        );
      }
    } else {
      await centerOnLocation();
    }
  }, [centerOnLocation, currentLocation, state, heading]);

  const handleMapPress = useCallback(
    (e: any) => {
      if (!drawMode) return;
      const { coordinate } = e.nativeEvent;
      setDrawVertices((prev) => [...prev, coordinate]);
    },
    [drawMode],
  );

  const handleEnterDrawMode = useCallback(() => {
    if (adminGroups.length === 1) {
      setSaveGroupId(adminGroups[0].id);
    } else {
      setSaveGroupId(null);
    }
    setDrawVertices([]);
    setAreaName("");
    setAreaColor(AREA_COLORS[0].value);
    setDrawMode(true);
  }, [adminGroups]);

  const handleCancelDraw = useCallback(() => {
    setDrawMode(false);
    setDrawVertices([]);
  }, []);

  const handleUndoVertex = useCallback(() => {
    setDrawVertices((prev) => prev.slice(0, -1));
  }, []);

  const shareCompletedSessionOnWhatsApp = useCallback(async () => {
    if (!completedSession) return;
    const dateStr = completedSession.startedAt.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const message =
      `🚶 I just completed a prayer walk!\n\n` +
      `📅 ${dateStr}\n` +
      `📍 Distance: ${formatDistance(completedSession.distance)}\n` +
      `⏱ Duration: ${formatDuration(completedSession.duration)}`;
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
        Alert.alert("WhatsApp not found", "Install WhatsApp to share your walk.", [{ text: "OK" }]);
      }
    }
  }, [completedSession]);

  const saveMutation = useMutation({
    mutationFn: async ({
      groupId,
      name,
      coordinates,
      color,
    }: {
      groupId: string;
      name: string;
      coordinates: Array<{ latitude: number; longitude: number }>;
      color: string;
    }) => {
      const url = new URL(`/api/groups/${groupId}/priority-areas`, getApiUrl());
      const res = await apiRequest("POST", url.pathname, {
        name,
        coordinates,
        color,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to save");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-priority-areas"] });
      queryClient.invalidateQueries({
        queryKey: [`/api/groups/${variables.groupId}/priority-areas`],
      });
      setShowSaveModal(false);
      setDrawMode(false);
      setDrawVertices([]);
      setAreaName("");
    },
    onError: (err: any) => {
      Alert.alert("Error", err.message || "Failed to save priority area");
    },
  });

  const handleSaveArea = useCallback(() => {
    if (!areaName.trim()) {
      Alert.alert("Name required", "Please give this area a name");
      return;
    }
    const gid = saveGroupId ?? adminGroups[0]?.id;
    if (!gid) return;
    saveMutation.mutate({
      groupId: gid,
      name: areaName.trim(),
      coordinates: drawVertices,
      color: areaColor,
    });
  }, [areaName, saveGroupId, adminGroups, drawVertices, areaColor, saveMutation]);

  const initialRegion = {
    latitude: 51.5074,
    longitude: -0.1278,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  };

  const canSave = drawVertices.length >= 3;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        userInterfaceStyle="dark"
        testID="map-view"
        onPanDrag={() => {
          isFollowingRef.current = false;
        }}
        onPress={handleMapPress}
      >
        {/* Saved priority area polygons */}
        {priorityAreas?.map((area) => (
          <Polygon
            key={area.id}
            coordinates={area.coordinates}
            fillColor={hexToRgba(area.color, 0.2)}
            strokeColor={area.color}
            strokeWidth={2}
          />
        ))}

        {/* In-progress draw polygon */}
        {drawMode && drawVertices.length >= 2 && (
          <Polyline
            coordinates={[...drawVertices, drawVertices[0]]}
            strokeColor={areaColor}
            strokeWidth={2}
            lineDashPattern={[6, 4]}
          />
        )}

        {/* Draw vertex markers */}
        {drawMode &&
          drawVertices.map((v, i) => (
            <Marker
              key={`v-${i}`}
              coordinate={v}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View
                style={[
                  styles.vertexDot,
                  i === 0 && styles.vertexDotFirst,
                  { borderColor: areaColor },
                ]}
              />
            </Marker>
          ))}

        {/* Coverage heat map polylines */}
        {coveragePolylines.map((poly, i) => (
          <Polyline
            key={`cov-${i}`}
            coordinates={poly.coordinates}
            strokeColor={poly.color}
            strokeWidth={poly.width}
            lineCap="round"
            lineJoin="round"
          />
        ))}

        {/* Active session track */}
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

      {/* Top bar - mode toggle or draw banner */}
      {drawMode ? (
        <View style={[styles.drawBanner, { top: insets.top + 8 }]}>
          <Feather name="edit-2" size={14} color={areaColor} />
          <Text style={styles.drawBannerText}>
            {drawVertices.length === 0
              ? "Tap the map to place points"
              : drawVertices.length === 1
                ? "Keep tapping to draw your area"
                : drawVertices.length === 2
                  ? "One more point to finish"
                  : `${drawVertices.length} points — ready to save`}
          </Text>
          {drawVertices.length > 0 && (
            <Pressable onPress={handleUndoVertex} hitSlop={8}>
              <Feather name="corner-left-up" size={16} color="#9CA3AF" />
            </Pressable>
          )}
        </View>
      ) : (
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
        </View>
      )}

      {/* Session stats overlay */}
      {state !== "idle" && (
        <View style={[styles.statsOverlay, { top: insets.top + 60 }]}>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Feather name="clock" size={16} color="#33C3F0" />
              <Text style={styles.statValue}>{formatDuration(elapsedTime)}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Feather name="navigation" size={16} color="#4CD964" />
              <Text style={styles.statValue}>{formatDistance(distance)}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Info button */}
      {!drawMode && (
        <Pressable
          onPress={() => setShowTutorial(true)}
          style={({ pressed }) => [styles.infoButton, { opacity: pressed ? 0.7 : 1 }]}
          testID="info-button"
          hitSlop={8}
        >
          <Feather name="info" size={20} color="#9CA3AF" />
        </Pressable>
      )}

      {/* Controls */}
      <View style={styles.controlsContainer}>
        {drawMode ? (
          <View style={styles.controlsRow}>
            <Pressable
              onPress={handleCancelDraw}
              style={({ pressed }) => [
                styles.drawActionBtn,
                { backgroundColor: "rgba(15,15,35,0.9)", opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Feather name="x" size={20} color="#FF3B30" />
              <Text style={[styles.drawActionText, { color: "#FF3B30" }]}>Cancel</Text>
            </Pressable>
            {canSave && (
              <Pressable
                onPress={() => setShowSaveModal(true)}
                style={({ pressed }) => [
                  styles.drawActionBtn,
                  { backgroundColor: areaColor, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Feather name="check" size={20} color="#fff" />
                <Text style={[styles.drawActionText, { color: "#fff" }]}>Save Zone</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.controlsRow}>
            {/* Left: always crosshair */}
            <Pressable
              onPress={handleCenterOnLocation}
              style={({ pressed }) => [
                styles.secondaryButton,
                { opacity: pressed ? 0.8 : 1 },
              ]}
              testID="center-location"
            >
              <Feather name="crosshair" size={22} color="#33C3F0" />
            </Pressable>

            {/* Middle: draw (idle+admin) | pause (tracking) | resume (paused) */}
            {state === "idle" && isAdminAny ? (
              <Pressable
                onPress={handleEnterDrawMode}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { opacity: pressed ? 0.8 : 1 },
                ]}
                testID="draw-zone"
              >
                <Feather name="edit-2" size={20} color="#FF9500" />
              </Pressable>
            ) : state === "tracking" ? (
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
            ) : state === "paused" ? (
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
            ) : null}

            {/* Right: green play FAB when idle, red stop (same size as pause) when active */}
            {state === "idle" ? (
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
            ) : (
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
            )}
          </View>
        )}
      </View>

      {/* Save Zone Modal */}
      <Modal
        visible={showSaveModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSaveModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Name this Zone</Text>
              <Pressable onPress={() => setShowSaveModal(false)}>
                <Feather name="x" size={22} color="#9CA3AF" />
              </Pressable>
            </View>

            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Town Centre, Park Area…"
              placeholderTextColor="#6B7280"
              value={areaName}
              onChangeText={setAreaName}
              autoFocus
            />

            {/* Color picker */}
            <Text style={styles.sectionLabel}>Colour</Text>
            <View style={styles.colorRow}>
              {AREA_COLORS.map((c) => (
                <Pressable
                  key={c.value}
                  onPress={() => setAreaColor(c.value)}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: c.value },
                    areaColor === c.value && styles.colorSwatchSelected,
                  ]}
                >
                  {areaColor === c.value && (
                    <Feather name="check" size={14} color="#fff" />
                  )}
                </Pressable>
              ))}
            </View>

            {/* Group selector (if admin of multiple groups) */}
            {adminGroups.length > 1 && (
              <>
                <Text style={styles.sectionLabel}>Group</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.groupScroll}
                >
                  {adminGroups.map((g) => (
                    <Pressable
                      key={g.id}
                      onPress={() => setSaveGroupId(g.id)}
                      style={[
                        styles.groupChip,
                        saveGroupId === g.id && {
                          backgroundColor: areaColor,
                          borderColor: areaColor,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.groupChipText,
                          saveGroupId === g.id && { color: "#fff" },
                        ]}
                      >
                        {g.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )}

            <Pressable
              onPress={handleSaveArea}
              disabled={saveMutation.isPending}
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: areaColor, opacity: pressed || saveMutation.isPending ? 0.8 : 1 },
              ]}
            >
              <Text style={styles.saveButtonText}>
                {saveMutation.isPending ? "Saving…" : "Save Priority Zone"}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Session Summary Modal */}
      <Modal
        visible={!!completedSession}
        transparent
        animationType="slide"
        onRequestClose={clearCompletedSession}
      >
        <View style={styles.summaryOverlay}>
          <View style={[styles.summarySheet, { paddingBottom: insets.bottom + 24 }]}>
            {/* Header */}
            <View style={styles.summaryHeader}>
              <View style={styles.summaryCheckCircle}>
                <Feather name="check" size={28} color="#fff" />
              </View>
              <Text style={styles.summaryTitle}>Prayer Walk Complete!</Text>
              <Text style={styles.summarySubtitle}>
                {completedSession?.startedAt.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </View>

            {/* Stats */}
            <View style={styles.summaryStatsRow}>
              <View style={styles.summaryStatCard}>
                <Feather name="navigation" size={20} color="#4CD964" />
                <Text style={styles.summaryStatValue}>
                  {formatDistance(completedSession?.distance ?? 0)}
                </Text>
                <Text style={styles.summaryStatLabel}>Distance</Text>
              </View>
              <View style={styles.summaryStatDivider} />
              <View style={styles.summaryStatCard}>
                <Feather name="clock" size={20} color="#33C3F0" />
                <Text style={styles.summaryStatValue}>
                  {formatDuration(completedSession?.duration ?? 0)}
                </Text>
                <Text style={styles.summaryStatLabel}>Duration</Text>
              </View>
            </View>

            {/* Share button */}
            <Pressable
              onPress={shareCompletedSessionOnWhatsApp}
              style={({ pressed }) => [
                styles.summaryShareBtn,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Feather name="share-2" size={22} color="#fff" />
              <Text style={styles.summaryShareText}>Share on WhatsApp</Text>
            </Pressable>

            {/* Dismiss */}
            <Pressable
              onPress={clearCompletedSession}
              style={({ pressed }) => [
                styles.summaryDismissBtn,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={styles.summaryDismissText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <TutorialModal
        visible={showTutorial}
        onDismiss={() => setShowTutorial(false)}
      />
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
    justifyContent: "flex-start",
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
  drawBanner: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(15, 15, 35, 0.95)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    zIndex: 10,
  },
  drawBannerText: {
    flex: 1,
    fontSize: 13,
    color: "#FFFFFF",
    fontFamily: "Inter_500Medium",
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
  infoButton: {
    position: "absolute",
    left: 16,
    bottom: 140,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(15, 15, 35, 0.9)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
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
    alignItems: "center",
    gap: 14,
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
  secondaryButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(15, 15, 35, 0.9)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  drawActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  drawActionText: {
    fontSize: 15,
    fontWeight: "600" as const,
    fontFamily: "Inter_600SemiBold",
  },
  vertexDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderWidth: 2,
  },
  vertexDotFirst: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 3,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#1A1A2E",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 14,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 18,
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
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: "#6B7280",
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  colorRow: {
    flexDirection: "row",
    gap: 10,
  },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  colorSwatchSelected: {
    transform: [{ scale: 1.2 }],
    shadowOpacity: 0.5,
  },
  groupScroll: {
    flexGrow: 0,
  },
  groupChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#2D2D44",
    marginRight: 8,
  },
  groupChipText: {
    fontSize: 14,
    color: "#9CA3AF",
    fontFamily: "Inter_500Medium",
  },
  saveButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
  },
  summaryOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  summarySheet: {
    backgroundColor: "#1A1A2E",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 32,
    paddingHorizontal: 24,
    gap: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 16,
  },
  summaryHeader: {
    alignItems: "center",
    gap: 10,
  },
  summaryCheckCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#4CD964",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#4CD964",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  summaryTitle: {
    fontSize: 22,
    fontWeight: "700" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  summarySubtitle: {
    fontSize: 13,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  summaryStatsRow: {
    flexDirection: "row",
    backgroundColor: "#0F0F23",
    borderRadius: 16,
    overflow: "hidden",
  },
  summaryStatCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 20,
    gap: 6,
  },
  summaryStatDivider: {
    width: 1,
    backgroundColor: "#2D2D44",
  },
  summaryStatValue: {
    fontSize: 22,
    fontWeight: "700" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
  },
  summaryStatLabel: {
    fontSize: 12,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  summaryShareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#25D366",
    borderRadius: 16,
    paddingVertical: 18,
  },
  summaryShareText: {
    fontSize: 17,
    fontWeight: "700" as const,
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },
  summaryDismissBtn: {
    alignItems: "center",
    paddingVertical: 12,
  },
  summaryDismissText: {
    fontSize: 15,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
  },
});
