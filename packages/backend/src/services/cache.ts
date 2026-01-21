import { promises as fs } from "node:fs";
import path from "node:path";

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export function cachePath(baseDir: string, key: string) {
  return path.join(baseDir, `${key}.png`);
}

export async function readCache(pathname: string) {
  try {
    return await fs.readFile(pathname);
  } catch {
    return null;
  }
}

export async function writeCache(pathname: string, data: Buffer) {
  await fs.writeFile(pathname, data);
}

export async function pruneCache(dir: string, maxAgeMs: number) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const now = Date.now();
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const fullPath = path.join(dir, entry.name);
          const stat = await fs.stat(fullPath);
          if (now - stat.mtimeMs > maxAgeMs) {
            await fs.unlink(fullPath);
          }
        })
    );
  } catch {
    // ignore cache pruning errors in dev
  }
}
