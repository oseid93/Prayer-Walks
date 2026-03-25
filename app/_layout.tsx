import "@/lib/location-task";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { TrackingProvider } from "@/lib/tracking-context";
import { useRouter, useSegments } from "expo-router";
import OnboardingModal from "@/components/OnboardingModal";
import TutorialModal from "@/components/TutorialModal";
import AsyncStorage from "@react-native-async-storage/async-storage";

const TUTORIAL_SEEN_KEY = "@streetcover_tutorial_seen";

SplashScreen.preventAutoHideAsync();

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isNewUser } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [showTutorial, setShowTutorial] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  // Prevent double-showing for the same user session
  const handledUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    const inAuthGroup = segments[0] === "auth";
    if (!user && !inAuthGroup) {
      router.replace("/auth");
    } else if (user && inAuthGroup) {
      router.replace("/");
    }
  }, [user, isLoading, segments]);

  // Show tutorial/onboarding once per user session.
  // Depends on user.id AND isNewUser so it fires correctly after registration
  // (where both are set in the same React batch).
  useEffect(() => {
    if (!user || isLoading) return;

    // Only process once per login session for this user
    if (handledUserIdRef.current === user.id) return;

    let cancelled = false;

    (async () => {
      try {
        const seen = await AsyncStorage.getItem(TUTORIAL_SEEN_KEY);
        if (cancelled) return;

        handledUserIdRef.current = user.id;

        if (!seen || isNewUser) {
          // No tutorial seen on this device, OR brand-new registration → always show tutorial
          setTimeout(() => {
            if (!cancelled) setShowTutorial(true);
          }, 600);
        }
      } catch {}
    })();

    return () => { cancelled = true; };
  // user.id ensures stable identity; isNewUser catches the register-then-navigate case
  }, [user?.id, isLoading, isNewUser]);

  // Reset handled ref on logout so next login is checked fresh
  useEffect(() => {
    if (!user) handledUserIdRef.current = null;
  }, [user]);

  const handleTutorialDismiss = async () => {
    setShowTutorial(false);
    try {
      await AsyncStorage.setItem(TUTORIAL_SEEN_KEY, "1");
    } catch {}
    // After tutorial, show group join modal if this is a new registration
    if (isNewUser) {
      setTimeout(() => setShowOnboarding(true), 300);
    }
  };

  return (
    <>
      {children}
      <TutorialModal
        visible={showTutorial}
        onDismiss={handleTutorialDismiss}
      />
      <OnboardingModal
        visible={showOnboarding}
        onDismiss={() => setShowOnboarding(false)}
      />
    </>
  );
}

function RootLayoutNav() {
  return (
    <AuthGate>
      <Stack screenOptions={{ headerBackTitle: "Back" }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="auth"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen
          name="session/[id]"
          options={{ headerShown: false, presentation: "modal" }}
        />
        <Stack.Screen
          name="group-detail"
          options={{ headerShown: false }}
        />
      </Stack>
    </AuthGate>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView>
          <KeyboardProvider>
            <AuthProvider>
              <TrackingProvider>
                <RootLayoutNav />
              </TrackingProvider>
            </AuthProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
