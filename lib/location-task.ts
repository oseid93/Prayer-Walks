import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const BACKGROUND_LOCATION_TASK = "prayer-walks-bg-location";
export const BG_POINTS_KEY = "@pw_bg_points";
export const BG_SESSION_KEY = "@pw_bg_session";
export const BG_ACTIVE_KEY = "@pw_bg_active";

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
  if (error) {
    console.warn("Background location task error:", error.message);
    return;
  }
  if (!data) return;

  try {
    const isActive = await AsyncStorage.getItem(BG_ACTIVE_KEY);
    if (isActive !== "true") return;

    const sessionId = await AsyncStorage.getItem(BG_SESSION_KEY);
    if (!sessionId) return;

    const { locations } = data as {
      locations: Array<{
        coords: {
          latitude: number;
          longitude: number;
          accuracy: number | null;
        };
        timestamp: number;
      }>;
    };

    const existing = await AsyncStorage.getItem(BG_POINTS_KEY);
    const buffered: object[] = existing ? JSON.parse(existing) : [];

    const newPoints = locations
      .filter((loc) => loc.coords.accuracy === null || loc.coords.accuracy <= 50)
      .map((loc) => ({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        timestamp: new Date(loc.timestamp).toISOString(),
        accuracy: loc.coords.accuracy,
      }));

    await AsyncStorage.setItem(
      BG_POINTS_KEY,
      JSON.stringify([...buffered, ...newPoints]),
    );
  } catch {
    // Storage errors in background are non-fatal
  }
});
