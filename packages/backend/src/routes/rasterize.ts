import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { embedWatermark } from "@flipbook/watermark";
import { z } from "zod";
import { config } from "../config.js";
import { cachePath, ensureDir, pruneCache, readCache, writeCache } from "../services/cache.js";
import { getDocument, getSession, insertEvent } from "../services/db.js";
import { createLimiter } from "../services/limits.js";
import { rasterizePage } from "../services/rasterizer.js";
import { signKey } from "../services/signing.js";
import { metrics } from "../services/metrics.js";

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  documentId: z.string().min(1),
  pageNumber: z.number().int().positive(),
  scale: z.number().min(0.1).max(4),
  tileSize: z.number().int().positive().optional(),
  tileX: z.number().int().nonnegative().optional(),
  tileY: z.number().int().nonnegative().optional(),
  targetWidth: z.number().int().positive().optional(),
  targetHeight: z.number().int().positive().optional()
});

export async function registerRasterizeRoutes(app: FastifyInstance) {
  const limiter = createLimiter(config.maxConcurrentRasterize);

  app.post("/rasterize", { preHandler: [app.authenticate] }, async (request, reply) => {
    metrics.increment("rasterizeRequests");
    const parseResult = bodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: "Invalid request", details: parseResult.error.flatten() });
    }

    const {
      sessionId,
      documentId,
      pageNumber,
      scale,
      tileSize,
      tileX = 0,
      tileY = 0,
      targetWidth,
      targetHeight
    } = parseResult.data;

    if (request.user?.sessionId && request.user.sessionId !== sessionId) {
      return reply.code(403).send({ error: "Session mismatch" });
    }
    const session = getSession(sessionId);
    if (!session || session.expiresAt < Date.now()) {
      return reply.code(401).send({ error: "Session expired" });
    }

    const key = `${sessionId}-${documentId}-${pageNumber}-${scale}-${tileSize ?? "full"}-${tileX}-${tileY}-${targetWidth ?? "auto"}-${targetHeight ?? "auto"}`;
    const outputPath = cachePath(config.rasterCacheDir, key);

    await ensureDir(config.rasterCacheDir);
    await pruneCache(config.rasterCacheDir, config.rasterCacheMaxAgeSeconds * 1000);
    const cached = await readCache(outputPath);
    if (cached) {
      const metadata = await sharp(cached).metadata();
      const expiresAt = Math.floor(Date.now() / 1000) + config.cacheUrlTtlSeconds;
      const signature = signKey(config.cacheKeySecret, key, expiresAt);
      return reply.send({
        url: `/page/${sessionId}/${pageNumber}?key=${key}&exp=${expiresAt}&sig=${signature}`,
        width: metadata.width ?? 0,
        height: metadata.height ?? 0
      });
    }

    const document = getDocument(documentId);
    if (!document) {
      return reply.code(404).send({ error: "Document not registered" });
    }

    const start = Date.now();
    try {
      const release = await limiter.acquire();
      const timeout = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          clearTimeout(timer);
          reject(new Error("Rasterization timeout"));
        }, config.rasterizeTimeoutMs);
      });
      const result = await Promise.race([
        rasterizePage({
        documentPath: document.path,
          pageNumber,
          scale
        }),
        timeout
      ]).finally(() => release());

      let image = sharp(result.buffer);

      if (typeof targetWidth === "number" || typeof targetHeight === "number") {
        image = image.resize(targetWidth, targetHeight, { fit: "inside" });
      }

      if (typeof tileSize === "number") {
        image = image.extract({
          left: tileX * tileSize,
          top: tileY * tileSize,
          width: tileSize,
          height: tileSize
        });
      }

      image = image.ensureAlpha();
      const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
      const watermarked = embedWatermark(data, {
        sessionId,
        pageNumber,
        issuedAt: Date.now()
      }, info.width, info.height);

      const outputBuffer = await sharp(watermarked, {
        raw: {
          width: info.width,
          height: info.height,
          channels: info.channels
        }
      })
        .png()
        .toBuffer();

      await writeCache(outputPath, outputBuffer);
      const expiresAt = Math.floor(Date.now() / 1000) + config.cacheUrlTtlSeconds;
      const signature = signKey(config.cacheKeySecret, key, expiresAt);
      request.log.info(
        { sessionId, documentId, pageNumber, width: info.width, height: info.height },
        "Rasterized page"
      );
      metrics.recordRasterizeDuration(Date.now() - start);
      insertEvent({
        sessionId,
        documentId,
        pageNumber,
        eventType: "rasterize",
        createdAt: Date.now()
      });
      return reply.send({
        url: `/page/${sessionId}/${pageNumber}?key=${key}&exp=${expiresAt}&sig=${signature}`,
        width: info.width,
        height: info.height
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ error: message }, "Rasterization failed");
      metrics.increment("rasterizeErrors");
      metrics.recordError(message);
      insertEvent({
        sessionId,
        documentId,
        pageNumber,
        eventType: "rasterize_error",
        createdAt: Date.now()
      });
      return reply.code(501).send({ error: "Rasterization failed" });
    }
  });
}
