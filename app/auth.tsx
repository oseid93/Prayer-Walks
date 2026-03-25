import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  Platform,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth-context";
import { apiRequest } from "@/lib/query-client";

type Mode = "login" | "register" | "forgot" | "reset";

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const clearErrors = () => { setError(""); setSuccessMsg(""); };

  const handleLoginOrRegister = async () => {
    clearErrors();
    if (!username.trim() || !password.trim()) {
      setError("Please fill in all fields");
      return;
    }
    if (mode === "register" && !displayName.trim()) {
      setError("Please enter a display name");
      return;
    }
    if (mode === "register" && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address");
      return;
    }

    setLoading(true);
    try {
      if (mode === "login") {
        await login(username.trim(), password.trim());
      } else {
        await register(username.trim(), password.trim(), displayName.trim(), email.trim() || undefined);
      }
    } catch (err: any) {
      const raw: string = err?.message ?? "";
      if (mode === "login") {
        if (raw.includes("401") || raw.toLowerCase().includes("invalid credentials")) {
          setError("Incorrect password, or no account found with that username. Please try again or sign up below.");
        } else {
          setError("Sign in failed. Please check your details and try again.");
        }
      } else {
        if (raw.includes("409") || raw.toLowerCase().includes("already taken")) {
          setError("That username is already taken. Please choose a different one.");
        } else {
          setError("Could not create account. Please try again.");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    clearErrors();
    if (!resetEmail.trim()) {
      setError("Please enter your email address");
      return;
    }
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/forgot-password", { email: resetEmail.trim() });
      setSuccessMsg("If that email is registered, a 6-digit code has been sent. Check your inbox.");
      setMode("reset");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    clearErrors();
    if (!resetCode.trim() || !newPassword.trim()) {
      setError("Please enter the code and your new password");
      return;
    }
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/reset-password", {
        email: resetEmail.trim(),
        code: resetCode.trim(),
        newPassword: newPassword.trim(),
      });
      setSuccessMsg("Password updated! You can now sign in.");
      setMode("login");
      setResetCode("");
      setNewPassword("");
    } catch (err: any) {
      const raw: string = err?.message ?? "";
      if (raw.includes("Invalid") || raw.includes("expired")) {
        setError("That code is invalid or has expired. Please request a new one.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    clearErrors();
    setMode("login");
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#0F0F23" }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + webTopInset + 40, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconContainer}>
          <Feather name="map-pin" size={48} color="#33C3F0" />
        </View>

        <Text style={styles.title}>Prayer Walks</Text>
        <Text style={styles.subtitle}>
          {mode === "forgot" ? "Reset your password" :
           mode === "reset" ? "Enter your reset code" :
           "Track every street you walk"}
        </Text>

        {/* Back button for forgot/reset modes */}
        {(mode === "forgot" || mode === "reset") && (
          <Pressable onPress={goBack} style={styles.backBtn}>
            <Feather name="arrow-left" size={16} color="#9CA3AF" />
            <Text style={styles.backText}>Back to Sign In</Text>
          </Pressable>
        )}

        <View style={styles.form}>
          {/* ── Login / Register fields ── */}
          {(mode === "login" || mode === "register") && (
            <>
              {mode === "register" && (
                <>
                  <TextInput
                    style={styles.input}
                    placeholder="Name"
                    placeholderTextColor="#9CA3AF"
                    value={displayName}
                    onChangeText={setDisplayName}
                    autoCapitalize="words"
                    testID="displayName-input"
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Email (for account recovery)"
                    placeholderTextColor="#9CA3AF"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoCorrect={false}
                    testID="email-input"
                  />
                </>
              )}
              <TextInput
                style={styles.input}
                placeholder="Username"
                placeholderTextColor="#9CA3AF"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                testID="username-input"
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#9CA3AF"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                testID="password-input"
              />

              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {successMsg ? <Text style={styles.successText}>{successMsg}</Text> : null}

              <Pressable
                onPress={handleLoginOrRegister}
                disabled={loading}
                style={({ pressed }) => [
                  styles.button,
                  { opacity: pressed || loading ? 0.8 : 1 },
                ]}
                testID="submit-button"
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>
                    {mode === "login" ? "Sign In" : "Create Account"}
                  </Text>
                )}
              </Pressable>

              {mode === "login" && (
                <Pressable onPress={() => { clearErrors(); setMode("forgot"); }} style={styles.forgotBtn}>
                  <Text style={styles.forgotText}>Forgot your password?</Text>
                </Pressable>
              )}

              <Pressable
                onPress={() => {
                  clearErrors();
                  setMode(mode === "login" ? "register" : "login");
                }}
                style={styles.switchButton}
              >
                <Text style={styles.switchText}>
                  {mode === "login"
                    ? "Don't have an account? Sign up"
                    : "Already have an account? Sign in"}
                </Text>
              </Pressable>
            </>
          )}

          {/* ── Forgot password ── */}
          {mode === "forgot" && (
            <>
              <Text style={styles.helpText}>
                Enter the email address you registered with. We'll send you a 6-digit reset code.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Email address"
                placeholderTextColor="#9CA3AF"
                value={resetEmail}
                onChangeText={setResetEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                autoFocus
              />

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Pressable
                onPress={handleForgotPassword}
                disabled={loading}
                style={({ pressed }) => [
                  styles.button,
                  { opacity: pressed || loading ? 0.8 : 1 },
                ]}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Send Reset Code</Text>
                )}
              </Pressable>
            </>
          )}

          {/* ── Reset password ── */}
          {mode === "reset" && (
            <>
              {successMsg ? <Text style={styles.successText}>{successMsg}</Text> : null}
              <TextInput
                style={[styles.input, styles.codeInput]}
                placeholder="6-digit code"
                placeholderTextColor="#9CA3AF"
                value={resetCode}
                onChangeText={setResetCode}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />
              <TextInput
                style={styles.input}
                placeholder="New password"
                placeholderTextColor="#9CA3AF"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
              />

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Pressable
                onPress={handleResetPassword}
                disabled={loading}
                style={({ pressed }) => [
                  styles.button,
                  { opacity: pressed || loading ? 0.8 : 1 },
                ]}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Set New Password</Text>
                )}
              </Pressable>

              <Pressable
                onPress={() => { clearErrors(); setMode("forgot"); }}
                style={styles.forgotBtn}
              >
                <Text style={styles.forgotText}>Resend code</Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: "rgba(51, 195, 240, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: "700" as const,
    color: "#FFFFFF",
    textAlign: "center",
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 16,
    color: "#9CA3AF",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 32,
    fontFamily: "Inter_400Regular",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 16,
  },
  backText: {
    color: "#9CA3AF",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  form: {
    gap: 14,
  },
  helpText: {
    color: "#9CA3AF",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    marginBottom: 4,
  },
  input: {
    backgroundColor: "#1A1A2E",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#2D2D44",
    fontFamily: "Inter_400Regular",
  },
  codeInput: {
    fontSize: 24,
    letterSpacing: 8,
    textAlign: "center",
    fontFamily: "Inter_600SemiBold",
  },
  errorText: {
    color: "#FF3B30",
    fontSize: 14,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  successText: {
    color: "#4CD964",
    fontSize: 14,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  button: {
    backgroundColor: "#33C3F0",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600" as const,
    fontFamily: "Inter_600SemiBold",
  },
  forgotBtn: {
    alignItems: "center",
    paddingVertical: 4,
  },
  forgotText: {
    color: "#33C3F0",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  switchButton: {
    alignItems: "center",
    paddingVertical: 8,
  },
  switchText: {
    color: "#33C3F0",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
});
