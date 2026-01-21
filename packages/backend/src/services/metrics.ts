type MetricsSnapshot = {
  sessions: number;
  uploads: number;
  rasterizeRequests: number;
  pageServes: number;
  rasterizeErrors: number;
  rasterizeDurationMs: number[];
  lastError?: string;
};

const state: MetricsSnapshot = {
  sessions: 0,
  uploads: 0,
  rasterizeRequests: 0,
  pageServes: 0,
  rasterizeErrors: 0,
  rasterizeDurationMs: []
};

export const metrics = {
  increment(key: keyof MetricsSnapshot) {
    if (typeof state[key] === "number") {
      state[key] = (state[key] as number) + 1;
    }
  },
  recordRasterizeDuration(durationMs: number) {
    state.rasterizeDurationMs.push(durationMs);
    if (state.rasterizeDurationMs.length > 50) {
      state.rasterizeDurationMs.shift();
    }
  },
  recordError(message: string) {
    state.lastError = message;
  },
  snapshot() {
    return { ...state };
  }
};
