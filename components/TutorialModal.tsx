import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Modal,
  Platform,
  ScrollView,
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

// ── Stylesheets declared first so components and SLIDES below can safely use them ──

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
    paddingBottom: 28,
    alignItems: "center",
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 16,
    overflow: "hidden",
  },
  skipBtn: {
    alignSelf: "flex-end",
    paddingHorizontal: 28,
  },
  skipText: {
    fontSize: 14,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
  },
  pager: {
    width: "100%",
  },
  slide: {
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 28,
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
  footer: {
    width: "100%",
    paddingHorizontal: 28,
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

// ── Helper detail components ──

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

function PlayTransition() {
  return (
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
  );
}

function HistoryActions() {
  return (
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
  );
}

// ── Slides ──

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
    detail: <PlayTransition />,
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
    detail: <HistoryActions />,
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

// ── Main component ──

export default function TutorialModal({ visible, onDismiss }: TutorialModalProps) {
  const [step, setStep] = useState(0);
  const [slideWidth, setSlideWidth] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const isScrollingRef = useRef(false);
  const insets = useSafeAreaInsets();
  const isLast = step === SLIDES.length - 1;

  // Reset to first slide whenever the modal opens
  useEffect(() => {
    if (visible) {
      setStep(0);
      scrollViewRef.current?.scrollTo({ x: 0, animated: false });
    }
  }, [visible]);

  const scrollToStep = useCallback((target: number) => {
    if (slideWidth === 0) return;
    scrollViewRef.current?.scrollTo({ x: target * slideWidth, animated: true });
  }, [slideWidth]);

  const handleNext = useCallback(() => {
    if (isLast) {
      setStep(0);
      scrollViewRef.current?.scrollTo({ x: 0, animated: false });
      onDismiss();
    } else {
      const next = step + 1;
      setStep(next);
      scrollToStep(next);
    }
  }, [isLast, onDismiss, step, scrollToStep]);

  const handleSkip = useCallback(() => {
    setStep(0);
    scrollViewRef.current?.scrollTo({ x: 0, animated: false });
    onDismiss();
  }, [onDismiss]);

  const handleMomentumScrollEnd = useCallback((e: any) => {
    if (slideWidth === 0) return;
    const newStep = Math.round(e.nativeEvent.contentOffset.x / slideWidth);
    if (newStep >= 0 && newStep < SLIDES.length) {
      setStep(newStep);
    }
    isScrollingRef.current = false;
  }, [slideWidth]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleSkip}
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

          {/* Swipeable slides */}
          <ScrollView
            ref={scrollViewRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            bounces={false}
            decelerationRate="fast"
            scrollEventThrottle={16}
            onMomentumScrollBegin={() => { isScrollingRef.current = true; }}
            onMomentumScrollEnd={handleMomentumScrollEnd}
            onLayout={(e) => setSlideWidth(e.nativeEvent.layout.width)}
            style={styles.pager}
          >
            {SLIDES.map((slide, index) => (
              <View key={index} style={[styles.slide, { width: slideWidth }]}>
                <View style={[styles.iconWrap, { backgroundColor: slide.iconBg }]}>
                  <Feather name={slide.iconName} size={44} color={slide.iconColor} />
                </View>
                <Text style={styles.title}>{slide.title}</Text>
                <Text style={styles.body}>{slide.body}</Text>
                {slide.detail ? (
                  <View style={styles.detailWrap}>{slide.detail}</View>
                ) : null}
              </View>
            ))}
          </ScrollView>

          {/* Progress dots */}
          <View style={styles.dotsRow}>
            {SLIDES.map((_, i) => (
              <Pressable
                key={i}
                onPress={() => {
                  setStep(i);
                  scrollToStep(i);
                }}
                hitSlop={6}
              >
                <View style={[styles.dot, i === step && styles.dotActive]} />
              </Pressable>
            ))}
          </View>

          {/* CTA */}
          <View style={styles.footer}>
            <Pressable
              onPress={handleNext}
              style={({ pressed }) => [
                styles.nextBtn,
                isLast && styles.nextBtnLast,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.nextText}>{isLast ? "Let's Go" : "Next"}</Text>
              <Feather
                name={isLast ? "arrow-right" : "chevron-right"}
                size={18}
                color="#fff"
              />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
