import { io } from "socket.io-client";

const socketUrl = import.meta.env.VITE_SOCKET_URL ?? `http://${window.location.hostname}:3001`;

export const socket = io(socketUrl, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  timeout: 10000
});
