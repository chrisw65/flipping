import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { config } from "./config.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerPageRoutes } from "./routes/page.js";
import { registerPreprocessedRoutes } from "./routes/preprocessed.js";
import { registerRasterizeRoutes } from "./routes/rasterize.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { initDb, purgeExpiredSessions } from "./services/db.js";
import { registerMetricsRoutes } from "./routes/metrics.js";

const app = Fastify({
  logger: true
});

await app.register(cors, { origin: true });
await app.register(rateLimit, {
  max: config.rateLimitMax,
  timeWindow: config.rateLimitWindow
});
await app.register(jwt, { secret: config.jwtSecret });
await app.register(multipart, { limits: { fileSize: config.maxUploadBytes } });
app.addHook("onRequest", async (request, _reply) => {
  const incoming = request.headers["x-request-id"];
  request.id = typeof incoming === "string" ? incoming : request.id;
});

app.decorate("authenticate", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: "Unauthorized" });
  }
});

app.get("/health", async () => ({ status: "ok" }));
initDb(config.dbPath);
setInterval(() => {
  purgeExpiredSessions(Date.now());
}, 15 * 60 * 1000);
await registerSessionRoutes(app);
await registerDocumentRoutes(app);
await registerRasterizeRoutes(app);
await registerPageRoutes(app);
await registerPreprocessedRoutes(app);
await registerMetricsRoutes(app);

app.listen({ port: config.port, host: config.host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
