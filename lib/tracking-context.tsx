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
import { logTracking } from "@/lib/tracking-log";
import {
  haversineDistance,
  calculateBearing,
  mergeTrackPoints,
  foregroundStep,
  elapsedSeconds,
  finalizeFromPoints,
} from "@/lib/tracking-math";
import { drainBuffer, requeueFailed } from "@/lib/tracking-buffer";

interface TrackingPoint {
  latitude: number;
  longitude: number;
  timestamp: string;
  accuracy: number | null;
}

type TrackingState = "idle" | "tracking";

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
  stopTracking: () => Promise<void>;
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  centerOnLocation: () => Promise<void>;
  completedSession: CompletedSession | null;
  clearCompletedSession: () => void;
}

const TrackingContext = createContext<TrackingContextType | undefined>(undefined);

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
  const sessionStartedAtRef = useRef<Date>(new Date());
  const prevLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const isTrackingActiveRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const distanceRef = useRef<number>(0);
  const currentPointsRef = useRef<TrackingPoint[]>([]);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isStartingRef = useRef(false);
  const recoveryRanRef = useRef(false);

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

      // Use ref so we don't need currentPoints in deps. mergeTrackPoints keeps
      // a full chronological sort (never an append-only tail) so a contiguous
      // block of points captured while the screen was LOCKED is inserted in its
      // correct position even if a fresh foreground fix has already landed after
      // app-return — dropping those would lose exactly the background segment
      // this feature exists to record. See lib/tracking-math.ts (unit-tested).
      const prev = currentPointsRef.current;
      const { merged: all, extraDistance: extraDist, heading: newHeading, added: newPts } =
        mergeTrackPoints(prev, bgPoints);

      logTracking(
        "foreground_merge",
        {
          buffered: bgPoints.length,
          merged: newPts.length,
          duplicates: bgPoints.length - newPts.length,
          totalPoints: all.length,
        },
        { remote: true },
      );

      if (newPts.length === 0) return;

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
      if (newHeading !== null) {
        setHeading(newHeading);
      }
    } catch (e: any) {
      logTracking("foreground_merge_error", { message: e?.message ?? String(e) });
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

  // Cold-start recovery: if a walk was still flagged active at last app exit
  // (i.e. iOS suspended/terminated the app mid-walk), the in-memory tracking
  // state is gone but the OS background task may have buffered points. On
  // launch, flush those buffered points into the session and finalize it from
  // its persisted points so the locked segment is saved instead of lost as a
  // straight line. Runs once per app launch.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (recoveryRanRef.current) return;
    recoveryRanRef.current = true;

    (async () => {
      try {
        const [active, sid] = await Promise.all([
          AsyncStorage.getItem(BG_ACTIVE_KEY),
          AsyncStorage.getItem(BG_SESSION_KEY),
        ]);
        // Only recover a session left active at exit, and only on a fresh
        // launch where no in-memory tracking is running.
        if (
          active !== "true" ||
          !sid ||
          isTrackingActiveRef.current ||
          sessionIdRef.current
        ) {
          return;
        }

        logTracking("recovery_detected", { sessionId: sid }, { remote: true });

        // Stop any lingering OS location task from the killed session.
        try {
          const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
          if (isRegistered) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        } catch {}

        // Flush background-buffered points into the session. If this fails
        // (e.g. offline at launch), keep the flags so the next launch retries
        // rather than discarding the buffered locked segment.
        let bufferedCount = 0;
        try {
          const raw = await AsyncStorage.getItem(BG_POINTS_KEY);
          if (raw) {
            const bufferedPts: TrackingPoint[] = JSON.parse(raw);
            bufferedCount = bufferedPts.length;
            if (bufferedPts.length > 0) {
              await apiRequest("POST", `/api/sessions/${sid}/points`, {
                points: bufferedPts,
              });
            }
          }
        } catch (e: any) {
          logTracking("recovery_flush_error", {
            message: e?.message ?? String(e),
            bufferedCount,
          });
          return; // keep flags for retry next launch
        }

        // Finalize from persisted points (distance + duration from timestamps).
        try {
          const res = await apiRequest("GET", `/api/sessions/${sid}/points`);
          const points: Array<{
            latitude: number;
            longitude: number;
            timestamp: string;
          }> = await res.json();
          const { distance: dist, duration, count } = finalizeFromPoints(points);
          await apiRequest("PUT", `/api/sessions/${sid}/end`, {
            totalDistance: dist,
            totalDuration: duration,
          });
          logTracking(
            "recovery_finalized",
            { sessionId: sid, points: count, distance: dist, duration, bufferedCount },
            { remote: true },
          );
          queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
          queryClient.invalidateQueries({ queryKey: ["/api/coverage"] });
        } catch (e: any) {
          logTracking("recovery_finalize_error", { message: e?.message ?? String(e) });
          return; // keep flags for retry next launch
        }

        // Success — clear recovery flags so we don't re-process this session.
        try {
          await AsyncStorage.multiRemove([BG_SESSION_KEY, BG_ACTIVE_KEY, BG_POINTS_KEY]);
        } catch {}
      } catch (e: any) {
        logTracking("recovery_error", { message: e?.message ?? String(e) });
      }
    })();
  }, []);

  const promptBackgroundPermission = useCallback(async () => {
    if (Platform.OS === "web") return;
    try {
      const { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
      logTracking("bg_permission_status", { status: bgStatus });
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
                logTracking("bg_permission_requested", { status: newBgStatus });
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
      const { toSync, remaining } = drainBuffer(pointsBufferRef.current);
      pointsBufferRef.current = remaining;
      try {
        await apiRequest("POST", `/api/sessions/${sid}/points`, {
          points: toSync,
        });
      } catch {
        pointsBufferRef.current = requeueFailed(toSync, pointsBufferRef.current);
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
      return { backgroundReady: false };
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

        // Skip inaccurate foreground fixes (e.g. cell-tower lock > 50 m)
        if (loc.coords.accuracy !== null && loc.coords.accuracy > 50) return;

        const point: TrackingPoint = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          timestamp: new Date(loc.timestamp).toISOString(),
          accuracy: loc.coords.accuracy,
        };

        const step = foregroundStep(prevLocationRef.current, point);
        if (step.moved) {
          setDistance((prevDist) => prevDist + step.distanceDelta);
          if (step.heading !== null) {
            setHeading(step.heading);
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
    // continues when the screen locks or the app is backgrounded.
    // Note: always attempt startLocationUpdatesAsync directly — the
    // isTaskRegisteredAsync guard was unreliable and could silently skip
    // this call. The defineTask() in location-task.ts makes the task
    // available; startLocationUpdatesAsync is what registers it with iOS.
    //
    // OS-termination backstop (evaluated): iOS standard location updates do
    // NOT relaunch the app after termination; only significant-location-change
    // (SLC) monitoring does. expo-location does not expose SLC in Expo Go, so
    // we cannot enable it here without ejecting. The implemented backstop is
    // therefore the cold-start recovery effect above, which on next launch
    // flushes any buffered points and finalizes an interrupted session so the
    // locked segment is preserved rather than lost.
    let backgroundReady = false;
    try {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 2000,
        distanceInterval: 0,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "Prayer Walk in Progress",
          notificationBody: "Recording your walk in the background.",
          notificationColor: "#33C3F0",
        },
        pausesUpdatesAutomatically: false,
        activityType: Location.ActivityType.Fitness,
        deferredUpdatesInterval: 0,
        deferredUpdatesDistance: 0,
      });
      // Confirm iOS actually registered the task and started delivering
      // updates — startLocationUpdatesAsync can resolve without the task
      // being live (e.g. missing "Always" permission / Expo Go).
      const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      backgroundReady = registered && started;
      logTracking(
        "bg_updates_started",
        { registered, started, backgroundReady },
        { remote: true },
      );
    } catch (e: any) {
      // startLocationUpdatesAsync not available in Expo Go — foreground-only tracking still works
      logTracking(
        "bg_updates_start_failed",
        { message: e?.message ?? String(e) },
        { remote: true },
      );
    }

    // NOTE: We intentionally do NOT subscribe to the magnetometer compass
    // (Location.watchHeadingAsync) here. The compass reports which way the
    // phone is physically pointing, which fires constantly and would overwrite
    // the direction-of-travel bearing used to orient the navigation camera.
    // Held in a hand or pocket, that made the map spin to face the wrong
    // direction. Heading is now derived solely from movement (point-to-point
    // bearing in the foreground watch and background merge), which is the
    // correct course-up behaviour for a walk tracker.

    return { backgroundReady };
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
    // Guard against double-starts: a rapid double-tap (or re-render) could fire
    // startTracking twice while state is still "idle", creating two sessions.
    if (isStartingRef.current || isTrackingActiveRef.current || sessionIdRef.current) {
      logTracking("start_ignored_duplicate");
      return;
    }
    isStartingRef.current = true;

    let bgGranted = false;
    if (Platform.OS !== "web") {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") {
        const { status: newStatus } = await Location.requestForegroundPermissionsAsync();
        if (newStatus !== "granted") {
          isStartingRef.current = false;
          Alert.alert(
            "Permission Required",
            "Location permission is needed to track your walks.",
          );
          return;
        }
        setHasPermission(true);
      }
      await promptBackgroundPermission();
      try {
        const { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
        bgGranted = bgStatus === "granted";
      } catch {
        bgGranted = false;
      }
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

      logTracking("session_started", { sessionId: sid, bgGranted }, { remote: true });

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
      sessionStartedAtRef.current = new Date();

      timerRef.current = setInterval(() => {
        setElapsedTime(elapsedSeconds(startTimeRef.current, Date.now()));
      }, 1000);

      isTrackingActiveRef.current = true;
      const watchResult = await startLocationWatch();
      const backgroundReady = watchResult?.backgroundReady ?? false;

      syncIntervalRef.current = setInterval(() => {
        if (sessionIdRef.current) syncPoints(sessionIdRef.current);
      }, 15000);

      setState("tracking");

      // Surface background-tracking readiness: if "Always" permission isn't
      // granted or the OS background task didn't actually start, the walk will
      // only be recorded while the screen is on — warn the user instead of
      // silently producing a straight line across the locked segment.
      if (Platform.OS !== "web" && (!bgGranted || !backgroundReady)) {
        Alert.alert(
          "Background Tracking Off",
          "Your walk has started, but it may stop recording when your screen locks. For an accurate route, set location access to \"Always\" in Settings and keep the app open.",
          [
            { text: "Continue Anyway", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ],
        );
      }
    } catch (err) {
      console.error("Failed to start tracking:", err);
      logTracking("start_failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      // Roll back any partial start so a retry isn't blocked by the guard
      isTrackingActiveRef.current = false;
      setSessionId(null);
      sessionIdRef.current = null;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
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
    } finally {
      isStartingRef.current = false;
    }
  }, [syncPoints, startLocationWatch, promptBackgroundPermission]);


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
      let ended = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await apiRequest("PUT", `/api/sessions/${sessionId}/end`, {
            totalDistance: distanceRef.current,
            totalDuration: elapsedTime,
          });
          ended = true;
          break;
        } catch {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          } else {
            console.warn("Could not end session, will sync next time");
          }
        }
      }
      logTracking(
        "session_stopped",
        {
          sessionId,
          ended,
          points: currentPointsRef.current.length,
          distance: distanceRef.current,
          duration: elapsedTime,
        },
        { remote: true },
      );
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
