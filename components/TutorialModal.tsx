import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Modal,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

interface TutorialModalProps {
  visible: boolean;
  onDismiss: () => void;
}

interface Slide {
  iconName: keyof typeof Feather.glyphMap;
  iconColor: string;
  iconBg: string;
  title: string;
  body: string;
  detail?: React.ReactNode;
}

function CoverageKey() {
  const dots: { color: string; label: string }[] = [
    { color: "#4CD964", label: "1×" },
    { color: "#FFCC00", label: "2–3×" },
    { color: "#FF9500", label: "4–5×" },
    { color: "#FF3B30", label: "6+×" },
  ];
  return (
    <View style={detail.row}>
      {dots.map((d) => (
        <View key={d.color} style={detail.keyItem}>
          <View style={[detail.dot, { backgroundColor: d.color }]} />
          <Text style={detail.keyLabel}>{d.label}</Text>
        </View>
      ))}
    </View>
  );
}

function ControlsRow() {
  const buttons = [
    { icon: "crosshair" as const, bg: "rgba(15,15,35,0.9)", color: "#33C3F0", label: "Centre" },
    { icon: "pause" as const, bg: "#FF9500", color: "#fff", label: "Pause" },
    { icon: "square" as const, bg: "#FF3B30", color: "#fff", label: "Stop" },
  ];
  return (
    <View style={detail.row}>
      {buttons.map((b) => (
        <View key={b.icon} style={detail.btnItem}>
          <View style={[detail.btnCircle, { backgroundColor: b.bg }]}>
            <Feather name={b.icon} size={18} color={b.color} />
          </View>
          <Text style={detail.btnLabel}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}

const SLIDES: Slide[] = [
  {
    iconName: "map",
    iconColor: "#33C3F0",
    iconBg: "rgba(51,195,240,0.15)",
    title: "Welcome to StreetCover",
    body: "Track your prayer walks and watch your community fill with colour as you cover every street.",
  },
  {
    iconName: "play",
    iconColor: "#4CD964",
    iconBg: "rgba(76,217,100,0.15)",
    title: "Start a Prayer Walk",
    body: "Tap the green ▶ button to begin recording. Your route is traced live on the map as you walk.",
    detail: (
      <View style={detail.playRow}>
        <View style={[detail.fabCircle, { backgroundColor: "#4CD964" }]}>
          <Feather name="play" size={24} color="#fff" />
        </View>
        <Feather name="arrow-right" size={18} color="#4B5563" />
        <View style={[detail.btnCircle, { backgroundColor: "#FF9500" }]}>
          <Feather name="pause" size={18} color="#fff" />
        </View>
        <View style={[detail.btnCircle, { backgroundColor: "#FF3B30" }]}>
          <Feather name="square" size={18} color="#fff" />
        </View>
      </View>
    ),
  },
  {
    iconName: "navigation",
    iconColor: "#4CD964",
    iconBg: "rgba(76,217,100,0.15)",
    title: "Map Controls",
    body: "The ⊕ crosshair centres the map on you. While walking, pause or stop your session at any time.",
    detail: <ControlsRow />,
  },
  {
    iconName: "activity",
    iconColor: "#FF9500",
    iconBg: "rgba(255,149,0,0.15)",
    title: "Coverage Heat Map",
    body: "Streets light up as you walk them. Colours build from green → yellow → orange → red the more times you pray a street.",
    detail: <CoverageKey />,
  },
  {
    iconName: "clock",
    iconColor: "#33C3F0",
    iconBg: "rgba(51,195,240,0.15)",
    title: "Walk History",
    body: "Every walk is saved in History. Tap any session to see your route on the map, or share it on WhatsApp.",
    detail: (
      <View style={detail.row}>
        <View style={detail.btnItem}>
          <View style={[detail.btnCircle, { backgroundColor: "rgba(15,15,35,0.9)" }]}>
            <Feather name="map" size={18} color="#33C3F0" />
          </View>
          <Text style={detail.btnLabel}>Route</Text>
        </View>
        <View style={detail.btnItem}>
          <View style={[detail.btnCircle, { backgroundColor: "#25D366" }]}>
            <Feather name="share-2" size={18} color="#fff" />
          </View>
          <Text style={detail.btnLabel}>Share</Text>
        </View>
      </View>
    ),
  },
  {
    iconName: "users",
    iconColor: "#33C3F0",
    iconBg: "rgba(51,195,240,0.15)",
    title: "Prayer Groups",
    body: "Join a group to combine coverage with friends. Admins can draw priority areas on the map to guide where to pray next.",
  },
  {
    iconName: "check-circle",
    iconColor: "#4CD964",
    iconBg: "rgba(76,217,100,0.15)",
    title: "You're all set!",
    body: "Start covering your community in prayer — one street at a time.",
  },
];

export default function TutorialModal({ visible, onDismiss }: TutorialModalProps) {
  const [step, setStep] = useState(0);
  const insets = useSafeAreaInsets();
  const isLast = step === SLIDES.length - 1;
  const slide = SLIDES[step];

  const handleNext = useCallback(() => {
    if (isLast) {
      onDismiss();
    } else {
      setStep((s) => s + 1);
    }
  }, [isLast, onDismiss]);

  const handleSkip = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  const handleClose = useCallback(() => {
    setStep(0);
    onDismiss();
  }, [onDismiss]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={[styles.overlay, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + 24 }]}>
          {/* Skip */}
          {!isLast && (
            <Pressable
              onPress={handleSkip}
              style={({ pressed }) => [styles.skipBtn, { opacity: pressed ? 0.6 : 1 }]}
              hitSlop={12}
            >
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
          )}

          {/* Icon */}
          <View style={[styles.iconWrap, { backgroundColor: slide.iconBg }]}>
            <Feather name={slide.iconName} size={44} color={slide.iconColor} />
          </View>

          {/* Text */}
          <Text style={styles.title}>{slide.title}</Text>
          <Text style={styles.body}>{slide.body}</Text>

          {/* Detail row */}
          {slide.detail ? (
            <View style={styles.detailWrap}>{slide.detail}</View>
          ) : null}

          {/* Progress dots */}
          <View style={styles.dotsRow}>
            {SLIDES.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === step && styles.dotActive,
                ]}
              />
            ))}
          </View>

          {/* CTA */}
          <Pressable
            onPress={handleNext}
            style={({ pressed }) => [
              styles.nextBtn,
              isLast && styles.nextBtnLast,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.nextText}>
              {isLast ? "Let's Go" : "Next"}
            </Text>
            <Feather
              name={isLast ? "arrow-right" : "chevron-right"}
              size={18}
              color="#fff"
            />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const detail = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 20,
    justifyContent: "center",
    alignItems: "flex-end",
  },
  playRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  keyItem: {
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  keyLabel: {
    fontSize: 12,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
  },
  btnItem: {
    alignItems: "center",
    gap: 6,
  },
  btnCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  fabCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  btnLabel: {
    fontSize: 11,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
  },
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#1A1A2E",
    borderRadius: 24,
    paddingTop: 28,
    paddingHorizontal: 28,
    paddingBottom: 28,
    alignItems: "center",
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 16,
  },
  skipBtn: {
    alignSelf: "flex-end",
  },
  skipText: {
    fontSize: 14,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: "700" as const,
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    color: "#9CA3AF",
    textAlign: "center",
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  detailWrap: {
    width: "100%",
    backgroundColor: "#0F0F23",
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  dotsRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#2D2D44",
  },
  dotActive: {
    width: 20,
    backgroundColor: "#33C3F0",
  },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    backgroundColor: "#33C3F0",
    borderRadius: 14,
    paddingVertical: 16,
  },
  nextBtnLast: {
    backgroundColor: "#4CD964",
  },
  nextText: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },
});
