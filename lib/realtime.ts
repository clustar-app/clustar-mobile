import { io, Socket } from "socket.io-client";
import Constants from "expo-constants";

const BASE_URL =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  "http://localhost:3000";

// One socket per app instance. Not exported directly — screens should use
// useThreadSocket() below so lifecycle is managed for them.
let socket: Socket | null = null;
let currentToken: string | null = null;

export function connectSocket(token: string): Socket {
  if (socket && currentToken === token) return socket;
  // Token changed (or first connect) — tear down any prior socket first.
  socket?.disconnect();
  currentToken = token;
  socket = io(BASE_URL, {
    auth: { token },
    // React Native uses the WebSocket transport natively; skipping polling
    // avoids a needless HTTP long-poll on every connect.
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 5_000,
  });
  socket.on("connect_error", err => {
    // Auth failures show up as connect_error, not disconnect. Silent by
    // default; screens can subscribe if they want to surface it.
    console.warn("[socket] connect_error:", err.message);
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  currentToken = null;
}

export function getSocket(): Socket | null {
  return socket;
}
