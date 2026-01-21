import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { cachePath, pruneCache, readCache } from "../services/cache.js";
import { getSession, insertEvent } from "../services/db.js";
import { verifyKey } from "../services/signing.js";
import { metrics } from "../services/metrics.js";

export async function registerPageRoutes(app: FastifyInstance) {
  app.get("/page/:sessionId/:pageNumber", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { key, sig, exp } = request.query as { key?: string; sig?: string; exp?: string };
    const { sessionId } = request.params as { sessionId: string; pageNumber: string };
    if (!key) {
      return reply.code(400).send({ error: "Missing cache key" });
    }
    if (!sig) {
      return reply.code(400).send({ error: "Missing signature" });
    }
    if (!exp) {
      return reply.code(400).send({ error: "Missing expiration" });
    }
    const expiresAt = Number.parseInt(exp, 10);
    if (!Number.isFinite(expiresAt)) {
      return reply.code(400).send({ error: "Invalid expiration" });
    }
    if (expiresAt < Math.floor(Date.now() / 1000)) {
      return reply.code(403).send({ error: "URL expired" });
    }

    if (request.user?.sessionId && request.user.sessionId !== sessionId) {
      return reply.code(403).send({ error: "Session mismatch" });
    }
    const session = getSession(sessionId);
    if (!session || session.expiresAt < Date.now()) {
      return reply.code(401).send({ error: "Session expired" });
    }

    if (!key.startsWith(`${sessionId}-`)) {
      return reply.code(403).send({ error: "Invalid cache key" });
    }
    if (!verifyKey(config.cacheKeySecret, key, expiresAt, sig)) {
      return reply.code(403).send({ error: "Invalid signature" });
    }

    const filePath = cachePath(config.rasterCacheDir, key);
    await pruneCache(config.rasterCacheDir, config.rasterCacheMaxAgeSeconds * 1000);
    const cached = await readCache(filePath);
    if (!cached) {
      return reply.code(404).send({ error: "Not found" });
    }
    const stats = await import("node:fs/promises").then((fs) => fs.stat(filePath));
    if (Date.now() - stats.mtimeMs > config.rasterCacheMaxAgeSeconds * 1000) {
      return reply.code(404).send({ error: "Cache expired" });
    }

    request.log.info({ sessionId, key }, "Served page image");
    metrics.increment("pageServes");
    insertEvent({
      sessionId,
      documentId: null,
      pageNumber: null,
      eventType: "page_serve",
      createdAt: Date.now()
    });
    reply.header("Content-Type", "image/png");
    return reply.send(cached);
  });
}
