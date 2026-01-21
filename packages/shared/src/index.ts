export type SessionToken = {
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
};

export type RasterizeRequest = {
  sessionId: string;
  documentId: string;
  pageNumber: number;
  scale: number;
  tileSize?: number;
  tileX?: number;
  tileY?: number;
  targetWidth?: number;
  targetHeight?: number;
};

export type RasterizeResponse = {
  url: string;
  width: number;
  height: number;
};
