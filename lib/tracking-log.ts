import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest } from "@/lib/query-client";

// Persisted, capped diagnostic log for the GPS tracking pipeline.
// Written from both the foreground TrackingProvider and the OS-level
// background location task (they share AsyncStorage). Lets us answer
// "did the background task ever fire, and why did it stop?" after a walk.
export const TRACKING_LOG_KEY = "@pw_tracking_log";
const MAX_LOG_ENTRIES = 400;

export interface TrackingLogEntry {
  ts: string;
  event: string;
  data?: Record<string, unknown>;
}

export async function logTracking(
  event: string,
  data?: Record<string, unknown>,
  options?: { remote?: boolean },
): Promise<void> {
  const entry: TrackingLogEntry = {
    ts: new Date().toISOString(),
    event,
    ...(data ? { data } : {}),
  };

  try {
    console.log(`[tracking] ${event}`, data ? JSON.stringify(data) : "");
  } catch {}

  try {
    const raw = await AsyncStorage.getItem(TRACKING_LOG_KEY);
    const arr: TrackingLogEntry[] = raw ? JSON.parse(raw) : [];
    arr.push(entry);
    const trimmed =
      arr.length > MAX_LOG_ENTRIES ? arr.slice(arr.length - MAX_LOG_ENTRIES) : arr;
    await AsyncStorage.setItem(TRACKING_LOG_KEY, JSON.stringify(trimmed));
  } catch {}

  // Best-effort server telemetry so lifecycle events are visible in server
  // logs (where the original failure was investigated). Only used from the
  // foreground context — the background task persists locally and the
  // foreground flushes a summary on the next merge.
  if (options?.remote) {
    try {
      await apiRequest("POST", "/api/telemetry/tracking", { event, data });
    } catch {}
  }
}

export async function getTrackingLog(): Promise<TrackingLogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(TRACKING_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearTrackingLog(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TRACKING_LOG_KEY);
  } catch {}
}
