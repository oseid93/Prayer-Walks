import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import * as Location from "expo-location";
import { Platform, Alert } from "react-native";
import { apiRequest } from "@/lib/query-client";
import { queryClient } from "@/lib/query-client";

interface TrackingPoint {
  latitude: number;
  longitude: number;
  timestamp: string;
  accuracy: number | null;
}

type TrackingState = "idle" | "tracking" | "paused";

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

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const headingSubRef = useRef<Location.LocationSubscription | null>(null);
  const pointsBufferRef = useRef<TrackingPoint[]>([]);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedTimeRef = useRef<number>(0);
  const prevLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);

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
    }
    return granted;
  }, []);

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
      if (pointsBufferRef.current.length === 0) return;
      const pointsToSync = [...pointsBufferRef.current];
      pointsBufferRef.current = [];
      try {
        await apiRequest("POST", `/api/sessions/${sid}/points`, {
          points: pointsToSync,
        });
      } catch (err) {
        pointsBufferRef.current = [...pointsToSync, ...pointsBufferRef.current];
      }
    },
    [],
  );

  const startLocationWatch = useCallback(async () => {
    if (Platform.OS === "web") {
      if (navigator.geolocation) {
        const watchId = navigator.geolocation.watchPosition(
          (pos) => {
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
    } else {
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 3000,
          distanceInterval: 5,
        },
        (loc) => {
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
          setCurrentLocation({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
          pointsBufferRef.current.push(point);
        },
      );
      locationSubRef.current = sub;

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
    }
  }, []);

  const stopLocationWatch = useCallback(() => {
    if (locationSubRef.current) {
      locationSubRef.current.remove();
      locationSubRef.current = null;
    }
    if (headingSubRef.current) {
      headingSubRef.current.remove();
      headingSubRef.current = null;
    }
  }, []);

  const startTracking = useCallback(async () => {
    const permitted = await requestPermission();
    if (!permitted) {
      Alert.alert(
        "Permission Required",
        "Location permission is needed to track your walks.",
      );
      return;
    }

    try {
      const res = await apiRequest("POST", "/api/sessions");
      const session = await res.json();
      const sid = session.id;
      setSessionId(sid);

      setCurrentPoints([]);
      setDistance(0);
      setElapsedTime(0);
      prevLocationRef.current = null;
      pointsBufferRef.current = [];

      startTimeRef.current = Date.now();
      pausedTimeRef.current = 0;

      timerRef.current = setInterval(() => {
        const now = Date.now();
        const elapsed = Math.floor(
          (now - startTimeRef.current - pausedTimeRef.current) / 1000,
        );
        setElapsedTime(elapsed);
      }, 1000);

      await startLocationWatch();

      syncIntervalRef.current = setInterval(() => {
        syncPoints(sid);
      }, 15000);

      setState("tracking");
    } catch (err) {
      console.error("Failed to start tracking:", err);
      Alert.alert("Error", "Failed to start tracking session.");
    }
  }, [requestPermission, syncPoints, startLocationWatch]);

  const pauseTracking = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopLocationWatch();
    pausedTimeRef.current += Date.now() - startTimeRef.current - pausedTimeRef.current - elapsedTime * 1000;
    setState("paused");
  }, [elapsedTime, stopLocationWatch]);

  const resumeTracking = useCallback(async () => {
    const resumeStart = Date.now();
    startTimeRef.current = resumeStart - elapsedTime * 1000;
    pausedTimeRef.current = 0;

    timerRef.current = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTimeRef.current) / 1000);
      setElapsedTime(elapsed);
    }, 1000);

    await startLocationWatch();

    setState("tracking");
  }, [elapsedTime, startLocationWatch]);

  const stopTracking = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopLocationWatch();
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }

    if (sessionId) {
      await syncPoints(sessionId);
      try {
        await apiRequest("PUT", `/api/sessions/${sessionId}/end`, {
          totalDistance: distance,
          totalDuration: elapsedTime,
        });
      } catch (err) {
        console.error("Failed to end session:", err);
      }
    }

    queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/coverage"] });

    setState("idle");
    setSessionId(null);
    setCurrentPoints([]);
    setElapsedTime(0);
    setDistance(0);
    setHeading(null);
    prevLocationRef.current = null;
    pointsBufferRef.current = [];
  }, [sessionId, distance, elapsedTime, syncPoints, stopLocationWatch]);

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
