export type RasterizeOptions = {
  documentPath: string;
  pageNumber: number;
  scale: number;
};

export type RasterizeResult = {
  buffer: Buffer;
  width: number;
  height: number;
  format: "png" | "jpeg";
};

import { createRequire } from "node:module";
import path from "node:path";

type MuPdfModule = {
  FS: { writeFile: (name: string, data: Uint8Array) => void };
  openDocument: (name: string) => number;
  drawPageAsPNG: (doc: number, pageNumber: number, dpi: number) => string;
};

let mupdfPromise: Promise<MuPdfModule> | null = null;

async function getMuPdf(): Promise<MuPdfModule> {
  if (mupdfPromise) return mupdfPromise;
  mupdfPromise = (async () => {
    const require = createRequire(import.meta.url);
    const libmupdf = require("mupdf-js/dist/libmupdf");
    const wasmPath = require.resolve("mupdf-js/dist/libmupdf.wasm");
    const wasmBinary = await import("node:fs/promises").then((fs) => fs.readFile(wasmPath));
    const module = await libmupdf({ wasmBinary });
    return module;
  })();
  return mupdfPromise;
}

async function tryOfficialMuPdf(data: Buffer, pageNumber: number, scale: number) {
  try {
    const mupdf = (await import("mupdf")) as unknown as {
      Document: {
        openDocument: (input: Buffer | Uint8Array, mime?: string) => any;
      };
      Matrix: { scale: (x: number, y: number) => any };
      ColorSpace: { DeviceRGB: any };
    };
    const doc = mupdf.Document.openDocument(data, "application/pdf");
    const page = doc.loadPage(Math.max(0, pageNumber - 1));
    const matrix = mupdf.Matrix.scale(scale, scale);
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB);
    const png = pixmap.asPNG();
    return Buffer.from(png);
  } catch {
    return null;
  }
}

async function tryOfficialMuPdfPageCount(data: Buffer): Promise<number | null> {
  try {
    const mupdf = (await import("mupdf")) as unknown as {
      Document: {
        openDocument: (input: Buffer | Uint8Array, mime?: string) => any;
      };
    };
    const doc = mupdf.Document.openDocument(data, "application/pdf");
    if (typeof doc.countPages === "function") {
      return doc.countPages();
    }
    if (typeof doc.pageCount === "number") {
      return doc.pageCount;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getDocumentPageCount(documentPath: string): Promise<number> {
  const data = await import("node:fs/promises").then((fs) => fs.readFile(documentPath));
  const officialCount = await tryOfficialMuPdfPageCount(data);
  if (officialCount && Number.isFinite(officialCount)) {
    return officialCount;
  }
  const mupdf = await getMuPdf();
  const name = `tmp_${path.basename(documentPath)}_${Date.now()}.pdf`;
  mupdf.FS.writeFile(name, new Uint8Array(data));
  const doc = mupdf.openDocument(name);
  const moduleAny = mupdf as unknown as {
    countPages?: (doc: number) => number;
    countPagesInDocument?: (doc: number) => number;
    getPageCount?: (doc: number) => number;
  };
  if (typeof moduleAny.countPages === "function") return moduleAny.countPages(doc);
  if (typeof moduleAny.countPagesInDocument === "function") {
    return moduleAny.countPagesInDocument(doc);
  }
  if (typeof moduleAny.getPageCount === "function") return moduleAny.getPageCount(doc);
  throw new Error("Unable to determine page count");
}

export async function rasterizePage(options: RasterizeOptions): Promise<RasterizeResult> {
  const data = await import("node:fs/promises").then((fs) => fs.readFile(options.documentPath));
  const sharp = (await import("sharp")).default;
  let buffer = await tryOfficialMuPdf(data, options.pageNumber, options.scale);
  if (!buffer) {
    const mupdf = await getMuPdf();
    const name = `tmp_${path.basename(options.documentPath)}_${Date.now()}.pdf`;
    mupdf.FS.writeFile(name, new Uint8Array(data));
    const doc = mupdf.openDocument(name);
    const dpi = Math.max(72, Math.round(72 * options.scale));
    const dataUri = mupdf.drawPageAsPNG(doc, options.pageNumber, dpi);
    const base64 = dataUri.split(",")[1] ?? "";
    buffer = Buffer.from(base64, "base64");
  }
  const metadata = await sharp(buffer).metadata();

  return {
    buffer,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    format: "png"
  };
}
