import { promises as fs } from "node:fs";
import path from "node:path";
import { getDocumentPageCount, rasterizePage } from "./rasterizer.js";
import { updateDocumentPreprocessing } from "./db.js";
import { config } from "../config.js";

export type Resolution = "thumbnail" | "standard" | "high";

export const RESOLUTIONS: Record<Resolution, number> = {
  thumbnail: 200,
  standard: 1024,
  high: 2048,
};

export type PreprocessingOptions = {
  documentId: string;
  documentPath: string;
  outputDir: string;
  onProgress?: (progress: number) => void;
};

export type PageMetadata = {
  page: number;
  width: number;
  height: number;
  aspect: number;
};

export type PreprocessingResult = {
  pageCount: number;
  pages: PageMetadata[];
  resolutions: Resolution[];
};

/**
 * Get the output path for a preprocessed page
 */
export function getPreprocessedPagePath(
  outputDir: string,
  documentId: string,
  page: number,
  resolution: Resolution
): string {
  return path.join(outputDir, documentId, resolution, `${page}.webp`);
}

/**
 * Check if a document has been preprocessed
 */
export async function isPreprocessed(
  outputDir: string,
  documentId: string
): Promise<boolean> {
  const metadataPath = path.join(outputDir, documentId, "metadata.json");
  try {
    await fs.access(metadataPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get metadata for a preprocessed document
 */
export async function getPreprocessedMetadata(
  outputDir: string,
  documentId: string
): Promise<PreprocessingResult | null> {
  const metadataPath = path.join(outputDir, documentId, "metadata.json");
  try {
    const data = await fs.readFile(metadataPath, "utf-8");
    return JSON.parse(data) as PreprocessingResult;
  } catch {
    return null;
  }
}

/**
 * Preprocess a document - render all pages at multiple resolutions
 */
export async function preprocessDocument(
  options: PreprocessingOptions
): Promise<PreprocessingResult> {
  const { documentId, documentPath, outputDir, onProgress } = options;
  const docDir = path.join(outputDir, documentId);

  // Create output directories
  await fs.mkdir(docDir, { recursive: true });
  for (const resolution of Object.keys(RESOLUTIONS) as Resolution[]) {
    await fs.mkdir(path.join(docDir, resolution), { recursive: true });
  }

  // Get page count
  const pageCount = await getDocumentPageCount(documentPath);
  console.log(`[Preprocessor] Document ${documentId} has ${pageCount} pages`);
  updateDocumentPreprocessing(documentId, { pageCount });

  const pages: PageMetadata[] = [];
  const resolutions = Object.keys(RESOLUTIONS) as Resolution[];
  const totalSteps = pageCount * resolutions.length;
  let completedSteps = 0;

  // Import sharp for image conversion
  const sharp = (await import("sharp")).default;

  // Process each page
  for (let page = 1; page <= pageCount; page++) {
    // Render once at scale 1 to get natural dimensions
    const baseResult = await rasterizePage({
      documentPath,
      pageNumber: page,
      scale: 1,
    });
    const naturalWidth = baseResult.width;
    const naturalHeight = baseResult.height;

    // Render at each resolution
    for (const resolution of resolutions) {
      const targetWidth = RESOLUTIONS[resolution];
      const scale = targetWidth / naturalWidth;

      // Render at the calculated scale (or use base if scale ~= 1)
      let buffer: Buffer;
      if (Math.abs(scale - 1) < 0.01) {
        // Use base result if scale is close to 1
        buffer = baseResult.buffer;
      } else {
        const result = await rasterizePage({
          documentPath,
          pageNumber: page,
          scale: Math.max(0.1, Math.min(4, scale)),
        });
        buffer = result.buffer;
      }

      // Convert to WebP and save
      const outputPath = getPreprocessedPagePath(outputDir, documentId, page, resolution);
      await sharp(buffer)
        .webp({ quality: 85 })
        .toFile(outputPath);

      completedSteps++;
      const progress = Math.round((completedSteps / totalSteps) * 100);
      console.log(`[Preprocessor] ${documentId}: page ${page}/${pageCount} ${resolution} (${progress}%)`);
      onProgress?.(progress);
      updateDocumentPreprocessing(documentId, { preprocessingProgress: progress });
    }

    pages.push({
      page,
      width: naturalWidth,
      height: naturalHeight,
      aspect: naturalWidth / naturalHeight,
    });
  }

  // Save metadata
  const result: PreprocessingResult = {
    pageCount,
    pages,
    resolutions,
  };

  const metadataPath = path.join(docDir, "metadata.json");
  await fs.writeFile(metadataPath, JSON.stringify(result, null, 2));

  // Mark as preprocessed
  updateDocumentPreprocessing(documentId, {
    preprocessed: true,
    preprocessingProgress: 100,
  });

  return result;
}

/**
 * Start preprocessing in background (non-blocking)
 */
export function startPreprocessing(options: PreprocessingOptions): void {
  console.log(`[Preprocessor] Starting preprocessing for document ${options.documentId}`);
  preprocessDocument(options)
    .then((result) => {
      console.log(`[Preprocessor] Completed preprocessing for document ${options.documentId}: ${result.pageCount} pages`);
    })
    .catch((error) => {
      console.error(`[Preprocessor] Failed for ${options.documentId}:`, error);
      updateDocumentPreprocessing(options.documentId, {
        preprocessed: false,
        preprocessingProgress: 0,
        preprocessingError: error instanceof Error ? error.message : String(error),
      });
    });
}

/**
 * Read a preprocessed page image
 */
export async function readPreprocessedPage(
  outputDir: string,
  documentId: string,
  page: number,
  resolution: Resolution
): Promise<Buffer | null> {
  const filePath = getPreprocessedPagePath(outputDir, documentId, page, resolution);
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}
