import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth-context";

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const handleSubmit = async () => {
    setError("");
    if (!username.trim() || !password.trim()) {
      setError("Please fill in all fields");
      return;
    }
    if (!isLogin && !displayName.trim()) {
      setError("Please enter a display name");
      return;
    }

    setLoading(true);
    try {
      if (isLogin) {
        await login(username.trim(), password.trim());
      } else {
        await register(username.trim(), password.trim(), displayName.trim());
      }
    } catch (err: any) {
      const raw: string = err?.message ?? "";
      if (isLogin) {
        if (raw.includes("401") || raw.toLowerCase().includes("invalid credentials")) {
          setError("Incorrect password, or no account found with that username. Please try again or sign up below.");
        } else {
          setError("Sign in failed. Please check your details and try again.");
        }
      } else {
        if (raw.includes("409") || raw.toLowerCase().includes("already exists") || raw.toLowerCase().includes("already taken")) {
          setError("That username is already taken. Please choose a different one.");
        } else {
          setError("Could not create account. Please try again.");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + webTopInset + 40 },
      ]}
    >
      <View style={styles.iconContainer}>
        <Feather name="map-pin" size={48} color="#33C3F0" />
      </View>

      <Text style={styles.title}>StreetCover</Text>
      <Text style={styles.subtitle}>Track every street you walk</Text>

      <View style={styles.form}>
        {!isLogin && (
          <TextInput
            style={styles.input}
            placeholder="Display Name"
            placeholderTextColor="#9CA3AF"
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
            testID="displayName-input"
          />
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

        <Pressable
          onPress={handleSubmit}
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
              {isLogin ? "Sign In" : "Create Account"}
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => {
            setIsLogin(!isLogin);
            setError("");
          }}
          style={styles.switchButton}
        >
          <Text style={styles.switchText}>
            {isLogin
              ? "Don't have an account? Sign up"
              : "Already have an account? Sign in"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F0F23",
    paddingHorizontal: 24,
    justifyContent: "flex-start",
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
    marginBottom: 40,
    fontFamily: "Inter_400Regular",
  },
  form: {
    gap: 14,
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
  errorText: {
    color: "#FF3B30",
    fontSize: 14,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  button: {
    backgroundColor: "#33C3F0",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600" as const,
    fontFamily: "Inter_600SemiBold",
  },
  switchButton: {
    paddingVertical: 12,
    alignItems: "center",
  },
  switchText: {
    color: "#33C3F0",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
});
