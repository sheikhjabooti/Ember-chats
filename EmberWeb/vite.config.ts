import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the web app talks to EmberServer through Vite's proxy,
// so the browser only ever sees one origin (no CORS, and the WebSocket
// works the same way it will in production behind a reverse proxy).
const serverUrl = process.env.EMBER_SERVER_URL ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: serverUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/ws": {
        target: serverUrl.replace(/^http/, "ws"),
        ws: true,
      },
    },
  },
});
