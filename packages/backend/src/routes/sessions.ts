import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { upsertSession } from "../services/db.js";
import { metrics } from "../services/metrics.js";

export async function registerSessionRoutes(app: FastifyInstance) {
  app.post("/sessions", async (_request, reply) => {
    const sessionId = randomUUID();
    const now = Date.now();
    const expiresAt = now + config.sessionTtlSeconds * 1000;
    const token = await reply.jwtSign({ sessionId });
    upsertSession({ sessionId, createdAt: now, expiresAt });
    metrics.increment("sessions");
    return reply.send({ sessionId, token });
  });
}
