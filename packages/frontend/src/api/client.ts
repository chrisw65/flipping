const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export type SessionResponse = {
  sessionId: string;
  token: string;
};

export type UploadResponse = {
  id: string;
  path: string;
  filename: string;
  size: number;
  addedAt: number;
  pageCount?: number;
  preprocessingStarted?: boolean;
};

export type RasterizeResponse = {
  url: string;
  width: number;
  height: number;
};

export type Resolution = "thumbnail" | "standard" | "high";

export type PageMetadata = {
  page: number;
  width: number;
  height: number;
  aspect: number;
};

export type DocumentStatus = {
  id: string;
  filename: string;
  pageCount: number | null;
  preprocessed: boolean;
  preprocessingProgress: number;
  preprocessingError: string | null;
  metadata: {
    pageCount: number;
    pages: PageMetadata[];
    resolutions: Resolution[];
  } | null;
};

export async function createSession(): Promise<SessionResponse> {
  const url = `${baseUrl}/sessions`;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST" });
  } catch (error) {
    throw new Error(`Session request failed: ${(error as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`Session request failed (${res.status})`);
  }
  return res.json();
}

export async function uploadDocument(token: string, file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${baseUrl}/documents/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form
  });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`);
  }
  return res.json();
}

export async function rasterizePage(
  token: string,
  body: {
    sessionId: string;
    documentId: string;
    pageNumber: number;
    scale: number;
    targetWidth?: number;
    targetHeight?: number;
  }
): Promise<RasterizeResponse> {
  const res = await fetch(`${baseUrl}/rasterize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`Rasterize failed (${res.status})`);
  }
  return res.json();
}

export async function fetchImageBlob(token: string, url: string): Promise<Blob> {
  const res = await fetch(`${baseUrl}${url}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) {
    throw new Error(`Image fetch failed (${res.status})`);
  }
  return res.blob();
}

/**
 * Get document status including preprocessing progress
 */
export async function getDocumentStatus(token: string, documentId: string): Promise<DocumentStatus> {
  const res = await fetch(`${baseUrl}/documents/${documentId}/status`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) {
    throw new Error(`Status fetch failed (${res.status})`);
  }
  return res.json();
}

/**
 * Fetch a preprocessed page as a blob
 * Returns null if not preprocessed yet
 */
export async function fetchPreprocessedPage(
  token: string,
  documentId: string,
  pageNumber: number,
  resolution: Resolution = "standard"
): Promise<Blob | null> {
  const res = await fetch(
    `${baseUrl}/documents/${documentId}/pages/${pageNumber}/${resolution}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
  if (res.status === 409) {
    // Document not preprocessed yet
    return null;
  }
  if (!res.ok) {
    throw new Error(`Preprocessed page fetch failed (${res.status})`);
  }
  return res.blob();
}
