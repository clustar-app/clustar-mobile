import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// Cross-platform key/value storage.
//
// Native (iOS/Android): uses expo-secure-store, backed by Keychain / EncryptedSharedPreferences.
// Web: falls back to window.localStorage. NOT SECURE — anyone with XSS can read it.
//   That's an acceptable tradeoff for the dev/test web client. Real users are on native.

async function nativeGet(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}
async function nativeSet(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}
async function nativeDel(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

async function webGet(key: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}
async function webSet(key: string, value: string): Promise<void> {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
}
async function webDel(key: string): Promise<void> {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

export const storage = {
  getItem: Platform.OS === "web" ? webGet : nativeGet,
  setItem: Platform.OS === "web" ? webSet : nativeSet,
  removeItem: Platform.OS === "web" ? webDel : nativeDel,
};
