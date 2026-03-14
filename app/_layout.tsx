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
import React, { useEffect, useState } from "react";
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

  useEffect(() => {
    if (isLoading) return;
    const inAuthGroup = segments[0] === "auth";
    if (!user && !inAuthGroup) {
      router.replace("/auth");
    } else if (user && inAuthGroup) {
      router.replace("/");
    }
  }, [user, isLoading, segments]);

  // Check if tutorial has been seen once user is logged in
  useEffect(() => {
    if (!user || isLoading) return;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(TUTORIAL_SEEN_KEY);
        if (!seen) {
          const timer = setTimeout(() => setShowTutorial(true), 600);
          return () => clearTimeout(timer);
        } else if (isNewUser) {
          // Tutorial already seen but new user — show group join modal
          const timer = setTimeout(() => setShowOnboarding(true), 600);
          return () => clearTimeout(timer);
        }
      } catch {}
    })();
  }, [user, isLoading]);

  const handleTutorialDismiss = async () => {
    setShowTutorial(false);
    try {
      await AsyncStorage.setItem(TUTORIAL_SEEN_KEY, "1");
    } catch {}
    // After tutorial, show group join modal if this is a new user
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
