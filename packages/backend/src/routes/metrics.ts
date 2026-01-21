import type { FastifyInstance } from "fastify";
import { metrics } from "../services/metrics.js";

export async function registerMetricsRoutes(app: FastifyInstance) {
  app.get("/metrics", async () => metrics.snapshot());
}
