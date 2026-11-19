import express from "express";
import cors from "cors";
import { createServer, Server } from "http";
import { config } from "./config";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { chatsRouter } from "./routes/chats";
import { breakoutsRouter } from "./routes/breakouts";
import { mediaRouter } from "./routes/media";
import { attachWebSocketServer } from "./ws/index";

/** Builds the HTTP + WebSocket server without starting it. */
export function createEmberServer(): Server {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptimeSeconds: process.uptime() });
  });

  app.use("/auth", authRouter);
  app.use("/users", usersRouter);
  app.use("/chats", chatsRouter);
  app.use("/breakouts", breakoutsRouter);
  app.use("/media", mediaRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Malformed JSON body" });
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  const server = createServer(app);
  attachWebSocketServer(server);
  return server;
}
