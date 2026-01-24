import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { getDocument, getSession } from "../services/db.js";
import {
  getPreprocessedMetadata,
  readPreprocessedPage,
  startPreprocessing,
  type Resolution,
  RESOLUTIONS,
} from "../services/preprocessor.js";

export async function registerPreprocessedRoutes(app: FastifyInstance) {
  /**
   * Get document status including preprocessing progress
   */
  app.get<{ Params: { documentId: string } }>(
    "/documents/:documentId/status",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const sessionId = request.user?.sessionId;
      if (!sessionId) {
        return reply.code(401).send({ error: "Missing session" });
      }
      const session = getSession(sessionId);
      if (!session || session.expiresAt < Date.now()) {
        return reply.code(401).send({ error: "Session expired" });
      }

      const { documentId } = request.params;
      const document = getDocument(documentId);
      if (!document) {
        return reply.code(404).send({ error: "Document not found" });
      }

      // Get preprocessing metadata if available
      const metadata = await getPreprocessedMetadata(config.preprocessedDir, documentId);

      return {
        id: document.id,
        filename: document.filename,
        pageCount: document.pageCount,
        preprocessed: document.preprocessed ?? false,
        preprocessingProgress: document.preprocessingProgress ?? 0,
        preprocessingError: document.preprocessingError,
        metadata,
      };
    }
  );

  /**
   * Start preprocessing for a document
   */
  app.post<{ Params: { documentId: string } }>(
    "/documents/:documentId/preprocess",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const sessionId = request.user?.sessionId;
      if (!sessionId) {
        return reply.code(401).send({ error: "Missing session" });
      }
      const session = getSession(sessionId);
      if (!session || session.expiresAt < Date.now()) {
        return reply.code(401).send({ error: "Session expired" });
      }

      const { documentId } = request.params;
      const document = getDocument(documentId);
      if (!document) {
        return reply.code(404).send({ error: "Document not found" });
      }

      if (document.preprocessed) {
        return { status: "already_preprocessed" };
      }

      // Start preprocessing in background
      startPreprocessing({
        documentId,
        documentPath: document.path,
        outputDir: config.preprocessedDir,
      });

      return { status: "started" };
    }
  );

  /**
   * Get a preprocessed page image
   */
  app.get<{
    Params: { documentId: string; page: string; resolution: string };
  }>(
    "/documents/:documentId/pages/:page/:resolution",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const sessionId = request.user?.sessionId;
      if (!sessionId) {
        return reply.code(401).send({ error: "Missing session" });
      }
      const session = getSession(sessionId);
      if (!session || session.expiresAt < Date.now()) {
        return reply.code(401).send({ error: "Session expired" });
      }

      const { documentId, page, resolution } = request.params;
      const pageNum = parseInt(page, 10);

      if (!Number.isFinite(pageNum) || pageNum < 1) {
        return reply.code(400).send({ error: "Invalid page number" });
      }

      if (!(resolution in RESOLUTIONS)) {
        return reply.code(400).send({
          error: `Invalid resolution. Valid options: ${Object.keys(RESOLUTIONS).join(", ")}`,
        });
      }

      const document = getDocument(documentId);
      if (!document) {
        return reply.code(404).send({ error: "Document not found" });
      }

      if (!document.preprocessed) {
        return reply.code(409).send({
          error: "Document not preprocessed",
          preprocessingProgress: document.preprocessingProgress,
        });
      }

      const buffer = await readPreprocessedPage(
        config.preprocessedDir,
        documentId,
        pageNum,
        resolution as Resolution
      );

      if (!buffer) {
        return reply.code(404).send({ error: "Page not found" });
      }

      reply.header("Content-Type", "image/webp");
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      return reply.send(buffer);
    }
  );

  /**
   * Get preprocessing metadata
   */
  app.get<{ Params: { documentId: string } }>(
    "/documents/:documentId/metadata",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const sessionId = request.user?.sessionId;
      if (!sessionId) {
        return reply.code(401).send({ error: "Missing session" });
      }
      const session = getSession(sessionId);
      if (!session || session.expiresAt < Date.now()) {
        return reply.code(401).send({ error: "Session expired" });
      }

      const { documentId } = request.params;
      const document = getDocument(documentId);
      if (!document) {
        return reply.code(404).send({ error: "Document not found" });
      }

      const metadata = await getPreprocessedMetadata(config.preprocessedDir, documentId);
      if (!metadata) {
        return reply.code(404).send({ error: "Metadata not found - document may not be preprocessed" });
      }

      return metadata;
    }
  );
}
