import * as THREE from "three";

export type CachedTexture = {
  key: string;
  texture: THREE.Texture;
  width: number;
  height: number;
  lastUsed: number;
  requestedWidth?: number;
  requestedHeight?: number;
};

export class TextureCache {
  private limit: number;
  private items = new Map<string, CachedTexture>();

  constructor(limit = 8) {
    this.limit = limit;
  }

  get(key: string) {
    const cached = this.items.get(key);
    if (cached) {
      cached.lastUsed = Date.now();
    }
    return cached;
  }

  set(key: string, value: CachedTexture) {
    this.items.set(key, value);
    this.evict();
  }

  delete(key: string) {
    const item = this.items.get(key);
    if (!item) return;
    item.texture.dispose();
    this.items.delete(key);
  }

  keys() {
    return Array.from(this.items.keys());
  }

  size() {
    return this.items.size;
  }

  clear() {
    for (const item of this.items.values()) {
      item.texture.dispose();
    }
    this.items.clear();
  }

  private evict() {
    if (this.items.size <= this.limit) return;
    const entries = Array.from(this.items.values()).sort((a, b) => a.lastUsed - b.lastUsed);
    const toRemove = entries.slice(0, Math.max(0, this.items.size - this.limit));
    for (const item of toRemove) {
      item.texture.dispose();
      this.items.delete(item.key);
    }
  }
}
