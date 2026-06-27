import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatDistance, formatDuration } from "@/lib/coverage-utils";
import { useTracking } from "@/lib/tracking-context";

const BUBBLE_W = 96;
const BUBBLE_H = 88;
const EDGE_MARGIN = 12;
const SWIPE_DX = 110;
const SWIPE_VX = 0.5;
const SWIPE_VX_FLOOR = 0.3;

export default function WalkProgressBubble() {
  const { state, elapsedTime, distance, stopTracking } = useTracking();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [hidden, setHidden] = useState(false);

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;
  const minX = EDGE_MARGIN;
  const maxX = width - BUBBLE_W - EDGE_MARGIN;
  const minY = insets.top + webTop + EDGE_MARGIN;
  const maxY = height - BUBBLE_H - insets.bottom - webBottom - EDGE_MARGIN;

  const defaultPos = () => ({
    x: maxX,
    y: Math.min(Math.max(height * 0.38, minY), maxY),
  });

  const pan = useRef(new Animated.ValueXY(defaultPos())).current;
  const posRef = useRef(defaultPos());
  const pulse = useRef(new Animated.Value(0)).current;
  const prevState = useRef(state);

  // Keep the latest absolute position in a ref for clamping / snapping.
  useEffect(() => {
    const id = pan.addListener((v) => {
      posRef.current = v;
    });
    return () => pan.removeListener(id);
  }, [pan]);

  // Re-clamp into bounds when the screen size / insets change (e.g. rotation,
  // window resize) so the bubble can never get stranded off-screen.
  useEffect(() => {
    const x = Math.min(Math.max(posRef.current.x, minX), maxX);
    const y = Math.min(Math.max(posRef.current.y, minY), maxY);
    if (x !== posRef.current.x || y !== posRef.current.y) {
      posRef.current = { x, y };
      pan.setValue({ x, y });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minX, maxX, minY, maxY]);

  // Pulsing "recording" badge.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Reset visibility + position each time a new walk begins.
  useEffect(() => {
    if (state === "tracking" && prevState.current !== "tracking") {
      setHidden(false);
      const dp = defaultPos();
      pan.setValue(dp);
      posRef.current = dp;
    }
    prevState.current = state;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const snapToEdge = (x: number, y: number) => {
    const clampedY = Math.min(Math.max(y, minY), maxY);
    const targetX = x + BUBBLE_W / 2 < width / 2 ? minX : maxX;
    posRef.current = { x: targetX, y: clampedY };
    Animated.spring(pan, {
      toValue: { x: targetX, y: clampedY },
      friction: 7,
      useNativeDriver: false,
    }).start();
  };

  const openMap = () => {
    router.navigate("/");
  };

  const confirmEnd = () => {
    snapToEdge(posRef.current.x, posRef.current.y);
    Alert.alert(
      "End walk?",
      "Stop tracking and save this walk.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "End walk",
          style: "destructive",
          onPress: () => {
            stopTracking().catch(() => {});
          },
        },
      ],
      { cancelable: true },
    );
  };

  const hideBubble = () => {
    Animated.timing(pan, {
      toValue: { x: width + 80, y: posRef.current.y },
      duration: 200,
      useNativeDriver: false,
    }).start(() => setHidden(true));
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        pan.setOffset(posRef.current);
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_, g) => {
        pan.flattenOffset();
        const { dx, dy, vx } = g;
        // Horizontal-dominant so a vertical reposition can't read as a swipe.
        const horizDominant = Math.abs(dx) > Math.abs(dy) * 1.5;
        // Require BOTH meaningful displacement AND a consistent fling velocity,
        // OR a fast flick — a slow careful drag decelerates near 0 and won't fire.
        const flingLeft =
          horizDominant &&
          ((dx < -SWIPE_DX && vx < -SWIPE_VX_FLOOR) || vx < -SWIPE_VX);
        const flingRight =
          horizDominant &&
          ((dx > SWIPE_DX && vx > SWIPE_VX_FLOOR) || vx > SWIPE_VX);
        const movedLittle = Math.abs(dx) < 6 && Math.abs(dy) < 6;

        if (movedLittle) {
          openMap();
          return;
        }
        if (flingLeft) {
          confirmEnd();
          return;
        }
        if (flingRight) {
          hideBubble();
          return;
        }
        snapToEdge(posRef.current.x, posRef.current.y);
      },
    }),
  ).current;

  if (state !== "tracking" || hidden) return null;

  return (
    <Animated.View
      style={[
        styles.bubble,
        { transform: [{ translateX: pan.x }, { translateY: pan.y }] },
      ]}
      {...panResponder.panHandlers}
    >
      <View style={styles.badgeRow}>
        <Animated.View
          style={[
            styles.recDot,
            {
              opacity: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0.25],
              }),
              transform: [
                {
                  scale: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.5],
                  }),
                },
              ],
            },
          ]}
        />
        <Text style={styles.recText}>REC</Text>
      </View>

      <View style={styles.statRow}>
        <Feather name="clock" size={12} color="#33C3F0" />
        <Text style={styles.timeText}>{formatDuration(elapsedTime)}</Text>
      </View>
      <View style={styles.statRow}>
        <Feather name="navigation" size={12} color="#4CD964" />
        <Text style={styles.distText}>{formatDistance(distance)}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: "absolute",
    top: 0,
    left: 0,
    width: BUBBLE_W,
    height: BUBBLE_H,
    backgroundColor: "rgba(15, 15, 35, 0.95)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2D2D44",
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    zIndex: 9999,
    elevation: 12,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 2,
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FF3B30",
  },
  recText: {
    fontSize: 10,
    letterSpacing: 1,
    color: "#FF3B30",
    fontFamily: "Inter_700Bold",
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  timeText: {
    fontSize: 14,
    color: "#FFFFFF",
    fontFamily: "Inter_600SemiBold",
  },
  distText: {
    fontSize: 12,
    color: "#9CA3AF",
    fontFamily: "Inter_500Medium",
  },
});
