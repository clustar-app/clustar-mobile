import { Alert } from "react-native";

// Reverted per user preference from the slide-down toast experiment back to
// native Alert popups. Kept the same `useToast` hook signature so no caller
// code had to change — the entire subsystem is now a thin wrapper over
// RN's built-in Alert.
//
// If you want to bring toasts back later, replace this file with the
// react-native-root-siblings implementation that used to live here.

export function useToast() {
  return {
    error: (msg: string) => Alert.alert("Error", msg),
    success: (msg: string) => Alert.alert("Success", msg),
    info: (msg: string) => Alert.alert("Heads up", msg),
  };
}

// No-op passthrough. Kept so app/_layout.tsx doesn't need to change if the
// import is still there. Delete the import + wrapper freely.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
