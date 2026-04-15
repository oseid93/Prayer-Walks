import React, { useRef, useEffect, useCallback, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Linking,
  Alert,
  Share,
  ScrollView,
  TextInput,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import MapView, { Polyline, Marker } from "react-native-maps";
import { formatDuration, formatDistance } from "@/lib/coverage-utils";
import { apiRequest, queryClient } from "@/lib/query-client";

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
  timestamp?: string;
}

interface SessionNote {
  id: string;
  text: string;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
}

function RouteMap({ points, notes }: { points: RoutePoint[]; notes: SessionNote[] }) {
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
      {notes.map((note, i) =>
        note.latitude != null && note.longitude != null ? (
          <Marker
            key={note.id}
            coordinate={{ latitude: note.latitude, longitude: note.longitude }}
            title={`Note ${i + 1}`}
            description={note.text}
            pinColor="#FF9500"
          />
        ) : null,
      )}
    </MapView>
  );
}

function generateGPX(session: Session, points: RoutePoint[]): string {
  const date = new Date(session.startedAt).toISOString();
  const trkpts = points
    .map((p) => {
      const ts = p.timestamp ? new Date(p.timestamp).toISOString() : date;
      return `      <trkpt lat="${p.latitude.toFixed(7)}" lon="${p.longitude.toFixed(7)}">\n        <time>${ts}</time>\n      </trkpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Prayer Walks" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Prayer Walk ${new Date(session.startedAt).toLocaleDateString()}</name>
    <time>${date}</time>
  </metadata>
  <trk>
    <name>Prayer Walk</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteText, setNoteText] = useState("");

  const { data: points, isLoading: pointsLoading } = useQuery<RoutePoint[]>({
    queryKey: [`/api/sessions/${id}/points`],
    enabled: !!id,
  });

  const { data: sessions } = useQuery<Session[]>({
    queryKey: ["/api/sessions"],
  });

  const { data: notes } = useQuery<SessionNote[]>({
    queryKey: [`/api/sessions/${id}/notes`],
    enabled: !!id,
  });

  const session = sessions?.find((s) => s.id === id);

  const addNoteMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", `/api/sessions/${id}/notes`, { text });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/sessions/${id}/notes`] });
      setShowNoteModal(false);
      setNoteText("");
    },
    onError: () => Alert.alert("Error", "Failed to save note"),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      await apiRequest("DELETE", `/api/sessions/${id}/notes/${noteId}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/sessions/${id}/notes`] }),
    onError: () => Alert.alert("Error", "Failed to delete note"),
  });

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

  const formatTime = (dateStr: string): string => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  const shareOnWhatsApp = useCallback(async () => {
    if (!session) return;
    const date = formatDate(session.startedAt);
    const distance = formatDistance(session.totalDistance || 0);
    const duration = formatDuration(session.totalDuration || 0);
    const message =
      `I just completed a prayer walk!\n\n` +
      `${date}\n` +
      `Distance: ${distance}\n` +
      `Duration: ${duration}`;
    const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(message)}`;
    const webUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    const canOpen = await Linking.canOpenURL(whatsappUrl);
    if (canOpen) {
      await Linking.openURL(whatsappUrl);
    } else {
      const canOpenWeb = await Linking.canOpenURL(webUrl);
      if (canOpenWeb) await Linking.openURL(webUrl);
      else Alert.alert("WhatsApp not found", "Install WhatsApp to share your walk.", [{ text: "OK" }]);
    }
  }, [session]);

  const exportGPX = useCallback(async () => {
    if (!session || !points || points.length === 0) {
      Alert.alert("No Data", "No GPS points to export.");
      return;
    }
    const gpx = generateGPX(session, points);
    try {
      await Share.share({
        message: gpx,
        title: `Prayer Walk ${new Date(session.startedAt).toLocaleDateString()}.gpx`,
      });
    } catch (_e) {}
  }, [session, points]);

  const handleDeleteNote = (noteId: string) => {
    Alert.alert("Delete Note", "Remove this prayer note?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteNoteMutation.mutate(noteId) },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-button">
          <Feather name="arrow-left" size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Walk Details</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={exportGPX} style={styles.iconBtn} testID="export-gpx-button">
            <Feather name="download" size={20} color="#4CD964" />
          </Pressable>
          <Pressable onPress={shareOnWhatsApp} style={styles.iconBtn} disabled={!session} testID="share-whatsapp-button">
            <Feather name="share-2" size={20} color={session ? "#25D366" : "#4B5563"} />
          </Pressable>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
        {session && (
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Feather name="calendar" size={14} color="#9CA3AF" />
              <Text style={styles.statText}>{formatDate(session.startedAt)}</Text>
            </View>
            <View style={styles.statItem}>
              <Feather name="clock" size={14} color="#33C3F0" />
              <Text style={styles.statText}>{formatDuration(session.totalDuration || 0)}</Text>
            </View>
            <View style={styles.statItem}>
              <Feather name="navigation" size={14} color="#4CD964" />
              <Text style={styles.statText}>{formatDistance(session.totalDistance || 0)}</Text>
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
            <RouteMap points={points} notes={notes ?? []} />
          )}
        </View>

        {/* Prayer Notes Section */}
        <View style={styles.notesSection}>
          <View style={styles.notesSectionHeader}>
            <Text style={styles.notesSectionTitle}>Prayer Notes</Text>
            <Pressable
              onPress={() => { setNoteText(""); setShowNoteModal(true); }}
              style={({ pressed }) => [styles.addNoteBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name="plus" size={16} color="#FF9500" />
              <Text style={styles.addNoteBtnText}>Add Note</Text>
            </Pressable>
          </View>

          {!notes || notes.length === 0 ? (
            <View style={styles.notesEmpty}>
              <Text style={styles.notesEmptyText}>No prayer notes for this walk</Text>
            </View>
          ) : (
            notes.map((note) => (
              <View key={note.id} style={styles.noteCard}>
                <View style={styles.noteIcon}>
                  <Feather name="feather" size={16} color="#FF9500" />
                </View>
                <View style={styles.noteContent}>
                  <Text style={styles.noteText}>{note.text}</Text>
                  <Text style={styles.noteTime}>{formatTime(note.createdAt)}</Text>
                </View>
                <Pressable onPress={() => handleDeleteNote(note.id)} style={styles.noteDeleteBtn} hitSlop={8}>
                  <Feather name="trash-2" size={14} color="#FF3B30" />
                </Pressable>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Add Note Modal */}
      <Modal visible={showNoteModal} transparent animationType="fade" onRequestClose={() => setShowNoteModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Prayer Note</Text>
              <Pressable onPress={() => setShowNoteModal(false)}>
                <Feather name="x" size={24} color="#FFFFFF" />
              </Pressable>
            </View>
            <TextInput
              style={styles.noteInput}
              placeholder="What did you pray for here?"
              placeholderTextColor="#6B7280"
              value={noteText}
              onChangeText={setNoteText}
              multiline
              numberOfLines={4}
              autoFocus
              textAlignVertical="top"
            />
            <Pressable
              onPress={() => { if (!noteText.trim()) return; addNoteMutation.mutate(noteText.trim()); }}
              disabled={addNoteMutation.isPending || !noteText.trim()}
              style={({ pressed }) => [styles.saveNoteBtn, { opacity: pressed || addNoteMutation.isPending || !noteText.trim() ? 0.6 : 1 }]}
            >
              {addNoteMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveNoteBtnText}>Save Note</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F0F23" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { fontSize: 18, fontWeight: "600" as const, color: "#FFFFFF", fontFamily: "Inter_600SemiBold" },
  headerActions: { flexDirection: "row", gap: 4 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#1A1A2E", alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#1A1A2E", marginHorizontal: 16, borderRadius: 12, marginBottom: 12 },
  statItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  statText: { fontSize: 13, color: "#FFFFFF", fontFamily: "Inter_400Regular" },
  mapContainer: { height: 280, marginHorizontal: 16, marginBottom: 12, borderRadius: 16, overflow: "hidden", backgroundColor: "#1A1A2E" },
  map: { flex: 1 },
  centerContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyText: { fontSize: 14, color: "#9CA3AF", fontFamily: "Inter_400Regular", textAlign: "center" },
  emptySubText: { fontSize: 12, color: "#6B7280", fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 4, paddingHorizontal: 24 },
  notesSection: { marginHorizontal: 16 },
  notesSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  notesSectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  addNoteBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,149,0,0.12)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,149,0,0.3)" },
  addNoteBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FF9500" },
  notesEmpty: { padding: 20, alignItems: "center" },
  notesEmptyText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280" },
  noteCard: { flexDirection: "row", alignItems: "flex-start", backgroundColor: "#1A1A2E", borderRadius: 10, padding: 12, marginBottom: 8, gap: 10 },
  noteIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(255,149,0,0.12)", alignItems: "center", justifyContent: "center" },
  noteContent: { flex: 1 },
  noteText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#FFFFFF", lineHeight: 20 },
  noteTime: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 4 },
  noteDeleteBtn: { padding: 4 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 20 },
  modalContent: { backgroundColor: "#1A1A35", borderRadius: 20, padding: 24, width: "100%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  noteInput: { backgroundColor: "#0F0F23", borderRadius: 10, padding: 14, color: "#FFFFFF", fontFamily: "Inter_400Regular", fontSize: 15, minHeight: 100, marginBottom: 16 },
  saveNoteBtn: { backgroundColor: "#FF9500", borderRadius: 10, padding: 14, alignItems: "center" },
  saveNoteBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
