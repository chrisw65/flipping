import type { FastifyInstance } from "fastify";
import { createWriteStream, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "../config.js";
import { getSession, insertDocument, listDocuments } from "../services/db.js";
import { metrics } from "../services/metrics.js";
import { startPreprocessing } from "../services/preprocessor.js";
import { getDocumentPageCount } from "../services/rasterizer.js";

export async function registerDocumentRoutes(app: FastifyInstance) {
  app.get("/documents", { preHandler: [app.authenticate] }, async (request, reply) => {
    const sessionId = request.user?.sessionId;
    if (!sessionId) {
      return reply.code(401).send({ error: "Missing session" });
    }
    const session = getSession(sessionId);
    if (!session || session.expiresAt < Date.now()) {
      return reply.code(401).send({ error: "Session expired" });
    }
    return listDocuments();
  });

  app.post("/documents/upload", { preHandler: [app.authenticate] }, async (request, reply) => {
    const sessionId = request.user?.sessionId;
    if (!sessionId) {
      return reply.code(401).send({ error: "Missing session" });
    }
    const session = getSession(sessionId);
    if (!session || session.expiresAt < Date.now()) {
      return reply.code(401).send({ error: "Session expired" });
    }
    const data = await request.file({ limits: { fileSize: config.maxUploadBytes } });
    if (!data) {
      return reply.code(400).send({ error: "Missing file" });
    }

    const filename = data.filename ?? "";
    const mime = data.mimetype ?? "";
    const isPdf =
      mime === "application/pdf" ||
      mime === "application/octet-stream" ||
      mime === "binary/octet-stream" ||
      filename.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return reply.code(415).send({ error: "Only PDF uploads are supported" });
    }

    const id = randomUUID();
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "-");
    const storedName = `${id}-${safeName}`;
    const destPath = path.join(config.documentStorageDir, storedName);
    await fs.mkdir(config.documentStorageDir, { recursive: true });

    const size = await new Promise<number>((resolve, reject) => {
      let bytes = 0;
      const stream = createWriteStream(destPath);
      data.file.pipe(stream);
      data.file.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
      });
      stream.on("finish", () => resolve(bytes));
      stream.on("error", reject);
      data.file.on("error", reject);
    });

    let pageCount: number | null = null;
    try {
      pageCount = await getDocumentPageCount(destPath);
    } catch (error) {
      request.log.warn({ error }, "Page count lookup failed");
    }
    const record = {
      id,
      path: destPath,
      filename: safeName,
      size,
      addedAt: Date.now(),
      pageCount
    };

    insertDocument(record);
    metrics.increment("uploads");

    // Start preprocessing in background (unless explicitly disabled)
    const skipPreprocess = request.query && (request.query as Record<string, string>).preprocess === "false";
    if (!skipPreprocess) {
      startPreprocessing({
        documentId: id,
        documentPath: destPath,
        outputDir: config.preprocessedDir,
      });
    }

    return reply.send({ ...record, preprocessingStarted: !skipPreprocess });
  });
}
