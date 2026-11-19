import { config } from "./config";
import { createEmberServer } from "./app";

const server = createEmberServer();

server.listen(config.port, () => {
  console.log(`Ember server listening on :${config.port} (REST + WS at /ws)`);
});

// Express 5 handles rejected promises in route handlers. This catches
// anything else async (timers, sockets) so it is logged, not fatal.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
