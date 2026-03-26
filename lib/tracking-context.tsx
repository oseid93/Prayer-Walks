import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform, Alert, Linking, AppState, AppStateStatus } from "react-native";
import { apiRequest } from "@/lib/query-client";
import { queryClient } from "@/lib/query-client";
import {
  BACKGROUND_LOCATION_TASK,
  BG_POINTS_KEY,
  BG_SESSION_KEY,
  BG_ACTIVE_KEY,
} from "@/lib/location-task";

interface TrackingPoint {
  latitude: number;
  longitude: number;
  timestamp: string;
  accuracy: number | null;
}

type TrackingState = "idle" | "tracking" | "paused";

export interface CompletedSession {
  distance: number;
  duration: number;
  startedAt: Date;
}

interface TrackingContextType {
  state: TrackingState;
  elapsedTime: number;
  distance: number;
  currentPoints: TrackingPoint[];
  currentLocation: { latitude: number; longitude: number } | null;
  heading: number | null;
  sessionId: string | null;
  startTracking: () => Promise<void>;
  pauseTracking: () => void;
  resumeTracking: () => void;
  stopTracking: () => Promise<void>;
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  centerOnLocation: () => Promise<void>;
  completedSession: CompletedSession | null;
  clearCompletedSession: () => void;
}

const TrackingContext = createContext<TrackingContextType | undefined>(undefined);

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  let bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

export function TrackingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<TrackingState>("idle");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [distance, setDistance] = useState(0);
  const [currentPoints, setCurrentPoints] = useState<TrackingPoint[]>([]);
  const [currentLocation, setCurrentLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [completedSession, setCompletedSession] = useState<CompletedSession | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const headingSubRef = useRef<Location.LocationSubscription | null>(null);
  const pointsBufferRef = useRef<TrackingPoint[]>([]);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedTimeRef = useRef<number>(0);
  const sessionStartedAtRef = useRef<Date>(new Date());
  const prevLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const isTrackingActiveRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const distanceRef = useRef<number>(0);
  const currentPointsRef = useRef<TrackingPoint[]>([]);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Keep refs in sync with state so callbacks always see current values
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { distanceRef.current = distance; }, [distance]);
  useEffect(() => { currentPointsRef.current = currentPoints; }, [currentPoints]);

  // Drain any points buffered by the background task into our in-memory state
  const mergeBackgroundPoints = useCallback(async () => {
    if (Platform.OS === "web") return;
    if (!isTrackingActiveRef.current) return;
    try {
      const raw = await AsyncStorage.getItem(BG_POINTS_KEY);
      if (!raw) return;
      await AsyncStorage.removeItem(BG_POINTS_KEY);
      const bgPoints: TrackingPoint[] = JSON.parse(raw);
      if (bgPoints.length === 0) return;

      // Use ref so we don't need currentPoints in deps
      const prev = currentPointsRef.current;
      const existingTs = new Set(prev.map((p) => p.timestamp));
      const newPts = bgPoints.filter((p) => !existingTs.has(p.timestamp));
      if (newPts.length === 0) return;

      // Merge and sort chronologically
      const all = [...prev, ...newPts].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      // Calculate extra distance from the newly inserted background points
      let extraDist = 0;
      for (const pt of newPts) {
        const idx = all.findIndex((p) => p.timestamp === pt.timestamp);
        if (idx > 0) {
          const before = all[idx - 1];
          extraDist += haversineDistance(
            before.latitude, before.longitude,
            pt.latitude, pt.longitude,
          );
        }
      }

      // Buffer new points for server sync
      newPts.forEach((p) => pointsBufferRef.current.push(p));

      // Batch all state updates together
      setCurrentPoints(all);
      if (extraDist > 0.001) {
        setDistance((d) => {
          const next = d + extraDist;
          distanceRef.current = next;
          return next;
        });
      }
      if (all.length >= 2) {
        const last = all[all.length - 1];
        const secondLast = all[all.length - 2];
        setHeading(
          calculateBearing(
            secondLast.latitude, secondLast.longitude,
            last.latitude, last.longitude,
          ),
        );
      }
    } catch {
      // Non-fatal
    }
  }, []);

  // Listen for app foregrounding to pick up background-buffered points
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (nextState) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextState === "active"
      ) {
        await mergeBackgroundPoints();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [mergeBackgroundPoints]);

  const promptBackgroundPermission = useCallback(async () => {
    if (Platform.OS === "web") return;
    try {
      const { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
      if (bgStatus === "granted") return;
      Alert.alert(
        "Enable 'Always On' Location",
        "For your walks to be recorded even when your screen locks or you switch apps, please select \"Always\" when prompted.",
        [
          { text: "Not Now", style: "cancel" },
          {
            text: "Continue",
            onPress: async () => {
              try {
                const { status: newBgStatus } = await Location.requestBackgroundPermissionsAsync();
                if (newBgStatus !== "granted") {
                  Alert.alert(
                    "Background Location Needed",
                    "To track walks when your screen is off, go to Settings and set location access to \"Always\".",
                    [
                      { text: "Not Now", style: "cancel" },
                      { text: "Open Settings", onPress: () => Linking.openSettings() },
                    ],
                  );
                }
              } catch {
                // Background location not available in this build environment
              }
            },
          },
        ],
      );
    } catch {
      // Background permission API not available in this build environment (e.g. Expo Go)
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (Platform.OS === "web") {
        setHasPermission(true);
        return;
      }
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") {
        const { status: newStatus } = await Location.requestForegroundPermissionsAsync();
        setHasPermission(newStatus === "granted");
      } else {
        setHasPermission(true);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === "web") {
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                setCurrentLocation({
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                });
              },
              () => {},
            );
          }
          return;
        }
        if (hasPermission) {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          setCurrentLocation({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        }
      } catch {}
    })();
  }, [hasPermission]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === "web") {
      setHasPermission(true);
      return true;
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    const granted = status === "granted";
    setHasPermission(granted);
    if (granted) {
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setCurrentLocation({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
      } catch {}
      await promptBackgroundPermission();
    }
    return granted;
  }, [promptBackgroundPermission]);

  const centerOnLocation = useCallback(async () => {
    if (Platform.OS === "web") return;
    try {
      if (!hasPermission) {
        const granted = await requestPermission();
        if (!granted) return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setCurrentLocation({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    } catch {}
  }, [hasPermission, requestPermission]);

  const syncPoints = useCallback(
    async (sid: string) => {
      // Also pull in any background-buffered points before syncing
      await mergeBackgroundPoints();

      if (pointsBufferRef.current.length === 0) return;
      const pointsToSync = [...pointsBufferRef.current];
      pointsBufferRef.current = [];
      try {
        await apiRequest("POST", `/api/sessions/${sid}/points`, {
          points: pointsToSync,
        });
      } catch {
        pointsBufferRef.current = [...pointsToSync, ...pointsBufferRef.current];
      }
    },
    [mergeBackgroundPoints],
  );

  const startLocationWatch = useCallback(async () => {
    if (Platform.OS === "web") {
      if (navigator.geolocation) {
        const watchId = navigator.geolocation.watchPosition(
          (pos) => {
            if (!isTrackingActiveRef.current) {
              setCurrentLocation({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              });
              return;
            }
            const point: TrackingPoint = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              timestamp: new Date().toISOString(),
              accuracy: pos.coords.accuracy,
            };
            setCurrentPoints((prev) => {
              if (prev.length > 0) {
                const last = prev[prev.length - 1];
                const d = haversineDistance(
                  last.latitude,
                  last.longitude,
                  point.latitude,
                  point.longitude,
                );
                setDistance((prevDist) => prevDist + d);
                setHeading(
                  calculateBearing(
                    last.latitude,
                    last.longitude,
                    point.latitude,
                    point.longitude,
                  ),
                );
              }
              return [...prev, point];
            });
            setCurrentLocation({
              latitude: point.latitude,
              longitude: point.longitude,
            });
            pointsBufferRef.current.push(point);
          },
          () => {},
          { enableHighAccuracy: true },
        );
        locationSubRef.current = {
          remove: () => navigator.geolocation.clearWatch(watchId),
        } as any;
      }
      return;
    }

    // Native: foreground watch (real-time UI updates while app is visible)
    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 2000,
        distanceInterval: 3,
      },
      (loc) => {
        setCurrentLocation({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });

        if (!isTrackingActiveRef.current) return;

        const point: TrackingPoint = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          timestamp: new Date(loc.timestamp).toISOString(),
          accuracy: loc.coords.accuracy,
        };

        const prev = prevLocationRef.current;
        if (prev) {
          const d = haversineDistance(
            prev.latitude,
            prev.longitude,
            point.latitude,
            point.longitude,
          );
          if (d > 0.002) {
            setDistance((prevDist) => prevDist + d);
            setHeading(
              calculateBearing(
                prev.latitude,
                prev.longitude,
                point.latitude,
                point.longitude,
              ),
            );
          }
        }
        prevLocationRef.current = {
          latitude: point.latitude,
          longitude: point.longitude,
        };

        setCurrentPoints((prevPts) => [...prevPts, point]);
        pointsBufferRef.current.push(point);
      },
    );
    locationSubRef.current = sub;

    // Native: start OS-level background location task so tracking
    // continues when the screen locks or the app is backgrounded
    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isRegistered) {
        await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 5000,
          distanceInterval: 5,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: "Prayer Walk in Progress",
            notificationBody: "Recording your walk in the background.",
            notificationColor: "#33C3F0",
          },
          pausesUpdatesAutomatically: false,
          activityType: Location.ActivityType.Fitness,
        });
      }
    } catch {
      // startLocationUpdatesAsync not available in Expo Go — foreground-only tracking still works
    }

    try {
      const headingSub = await Location.watchHeadingAsync((h) => {
        if (h.trueHeading >= 0) {
          setHeading(h.trueHeading);
        } else if (h.magHeading >= 0) {
          setHeading(h.magHeading);
        }
      });
      headingSubRef.current = headingSub;
    } catch {}
  }, []);

  const stopLocationWatch = useCallback(async () => {
    if (locationSubRef.current) {
      locationSubRef.current.remove();
      locationSubRef.current = null;
    }
    if (headingSubRef.current) {
      headingSubRef.current.remove();
      headingSubRef.current = null;
    }
    if (Platform.OS !== "web") {
      try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
        if (isRegistered) {
          await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        }
      } catch {}
    }
  }, []);

  const startTracking = useCallback(async () => {
    if (Platform.OS !== "web") {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") {
        const { status: newStatus } = await Location.requestForegroundPermissionsAsync();
        if (newStatus !== "granted") {
          Alert.alert(
            "Permission Required",
            "Location permission is needed to track your walks.",
          );
          return;
        }
        setHasPermission(true);
      }
      await promptBackgroundPermission();
    }

    try {
      let res: Response | null = null;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await apiRequest("POST", "/api/sessions");
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < 1) await new Promise((r) => setTimeout(r, 1500));
        }
      }
      if (!res) throw lastErr;

      const session = await res.json();
      const sid = session.id;
      setSessionId(sid);
      sessionIdRef.current = sid;

      // Clear any stale background buffer from a previous session
      await AsyncStorage.multiRemove([BG_POINTS_KEY]);

      // Persist session ID and active flag for the background task
      if (Platform.OS !== "web") {
        await AsyncStorage.multiSet([
          [BG_SESSION_KEY, sid],
          [BG_ACTIVE_KEY, "true"],
        ]);
      }

      setCurrentPoints([]);
      setDistance(0);
      setElapsedTime(0);
      prevLocationRef.current = null;
      pointsBufferRef.current = [];
      distanceRef.current = 0;

      startTimeRef.current = Date.now();
      pausedTimeRef.current = 0;
      sessionStartedAtRef.current = new Date();

      timerRef.current = setInterval(() => {
        const now = Date.now();
        const elapsed = Math.floor(
          (now - startTimeRef.current - pausedTimeRef.current) / 1000,
        );
        setElapsedTime(elapsed);
      }, 1000);

      isTrackingActiveRef.current = true;
      await startLocationWatch();

      syncIntervalRef.current = setInterval(() => {
        if (sessionIdRef.current) syncPoints(sessionIdRef.current);
      }, 15000);

      setState("tracking");
    } catch (err) {
      console.error("Failed to start tracking:", err);
      const msg = err instanceof Error ? err.message : "";
      const isNetwork =
        msg.toLowerCase().includes("network") ||
        msg.toLowerCase().includes("connection") ||
        msg.toLowerCase().includes("fetch failed");
      Alert.alert(
        "Couldn't Start Walk",
        isNetwork
          ? "No internet connection. Please check your signal and try again."
          : "Something went wrong starting your session. Please try again.",
      );
    }
  }, [syncPoints, startLocationWatch, promptBackgroundPermission]);

  const pauseTracking = useCallback(() => {
    isTrackingActiveRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    pausedTimeRef.current += Date.now() - startTimeRef.current - pausedTimeRef.current - elapsedTime * 1000;
    setState("paused");
  }, [elapsedTime]);

  const resumeTracking = useCallback(async () => {
    isTrackingActiveRef.current = true;
    const resumeStart = Date.now();
    startTimeRef.current = resumeStart - elapsedTime * 1000;
    pausedTimeRef.current = 0;

    timerRef.current = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTimeRef.current) / 1000);
      setElapsedTime(elapsed);
    }, 1000);

    setState("tracking");
  }, [elapsedTime]);

  const clearCompletedSession = useCallback(() => {
    setCompletedSession(null);
  }, []);

  const stopTracking = useCallback(async () => {
    isTrackingActiveRef.current = false;

    const summary: CompletedSession = {
      distance: distanceRef.current,
      duration: elapsedTime,
      startedAt: sessionStartedAtRef.current,
    };

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }

    // Signal background task to stop recording
    if (Platform.OS !== "web") {
      try {
        await AsyncStorage.setItem(BG_ACTIVE_KEY, "false");
      } catch {}
    }

    await stopLocationWatch();

    // Flush any remaining background points before ending session
    await mergeBackgroundPoints();

    if (sessionId) {
      try {
        await syncPoints(sessionId);
      } catch {}
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await apiRequest("PUT", `/api/sessions/${sessionId}/end`, {
            totalDistance: distanceRef.current,
            totalDuration: elapsedTime,
          });
          break;
        } catch {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          } else {
            console.warn("Could not end session, will sync next time");
          }
        }
      }
    }

    // Clean up AsyncStorage
    if (Platform.OS !== "web") {
      try {
        await AsyncStorage.multiRemove([BG_SESSION_KEY, BG_ACTIVE_KEY, BG_POINTS_KEY]);
      } catch {}
    }

    queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/coverage"] });

    setState("idle");
    setSessionId(null);
    sessionIdRef.current = null;
    setCurrentPoints([]);
    currentPointsRef.current = [];
    setElapsedTime(0);
    setDistance(0);
    distanceRef.current = 0;
    setHeading(null);
    prevLocationRef.current = null;
    pointsBufferRef.current = [];

    setCompletedSession(summary);
  }, [sessionId, elapsedTime, syncPoints, stopLocationWatch, mergeBackgroundPoints]);

  return (
    <TrackingContext.Provider
      value={{
        state,
        elapsedTime,
        distance,
        currentPoints,
        currentLocation,
        heading,
        sessionId,
        startTracking,
        pauseTracking,
        resumeTracking,
        stopTracking,
        hasPermission,
        requestPermission,
        centerOnLocation,
        completedSession,
        clearCompletedSession,
      }}
    >
      {children}
    </TrackingContext.Provider>
  );
}

export function useTracking() {
  const context = useContext(TrackingContext);
  if (!context) {
    throw new Error("useTracking must be used within TrackingProvider");
  }
  return context;
}
