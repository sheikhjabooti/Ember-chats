import express from "express";
import cors from "cors";
import { createServer } from "http";
import { config } from "./config";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { chatsRouter } from "./routes/chats";
import { breakoutsRouter } from "./routes/breakouts";
import { mediaRouter } from "./routes/media";
import { attachWebSocketServer } from "./ws/index";

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptimeSeconds: process.uptime() });
});

app.use("/auth", authRouter);
app.use("/users", usersRouter);
app.use("/chats", chatsRouter);
app.use("/breakouts", breakoutsRouter);
app.use("/media", mediaRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const server = createServer(app);
attachWebSocketServer(server);

server.listen(config.port, () => {
  console.log(`Ember server listening on :${config.port} (REST + WS at /ws)`);
});
