export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  rateLimitMax: Number.parseInt(process.env.RATE_LIMIT_MAX ?? "120", 10),
  rateLimitWindow: process.env.RATE_LIMIT_WINDOW ?? "1 minute",
  rasterCacheDir: process.env.RASTER_CACHE_DIR ?? "./.cache/raster",
  rasterCacheMaxAgeSeconds: Number.parseInt(process.env.RASTER_CACHE_MAX_AGE ?? "86400", 10),
  cacheKeySecret: process.env.CACHE_KEY_SECRET ?? "dev-cache-secret",
  maxConcurrentRasterize: Number.parseInt(process.env.MAX_CONCURRENT_RASTERIZE ?? "2", 10),
  documentStorageDir: process.env.DOCUMENT_STORAGE_DIR ?? "./.data/documents",
  dbPath: process.env.DB_PATH ?? "./.data/flipbook.db",
  maxUploadBytes: Number.parseInt(process.env.MAX_UPLOAD_BYTES ?? "52428800", 10),
  cacheUrlTtlSeconds: Number.parseInt(process.env.CACHE_URL_TTL_SECONDS ?? "900", 10),
  rasterizeTimeoutMs: Number.parseInt(process.env.RASTERIZE_TIMEOUT_MS ?? "30000", 10),
  sessionTtlSeconds: Number.parseInt(process.env.SESSION_TTL_SECONDS ?? "7200", 10)
};
