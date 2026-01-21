const BLOCK_SIZE = 8;
const MID_COEFFS = [
  [3, 2],
  [2, 3],
  [4, 1],
  [1, 4]
];

function toBytes(payload) {
  const text = `${payload.sessionId}:${payload.pageNumber}:${payload.issuedAt}`;
  return new TextEncoder().encode(text);
}

function dct1d(input) {
  const result = new Array(input.length).fill(0);
  const n = input.length;
  const factor = Math.PI / (2 * n);
  for (let k = 0; k < n; k += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      sum += input[i] * Math.cos((2 * i + 1) * k * factor);
    }
    const scale = k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n);
    result[k] = sum * scale;
  }
  return result;
}

function idct1d(input) {
  const result = new Array(input.length).fill(0);
  const n = input.length;
  const factor = Math.PI / (2 * n);
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    for (let k = 0; k < n; k += 1) {
      const scale = k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n);
      sum += scale * input[k] * Math.cos((2 * i + 1) * k * factor);
    }
    result[i] = sum;
  }
  return result;
}

function dct2d(block) {
  const temp = block.map((row) => dct1d(row));
  const result = [];
  for (let x = 0; x < BLOCK_SIZE; x += 1) {
    const column = temp.map((row) => row[x]);
    const colDct = dct1d(column);
    for (let y = 0; y < BLOCK_SIZE; y += 1) {
      if (!result[y]) result[y] = new Array(BLOCK_SIZE).fill(0);
      result[y][x] = colDct[y];
    }
  }
  return result;
}

function idct2d(block) {
  const temp = [];
  for (let x = 0; x < BLOCK_SIZE; x += 1) {
    const column = block.map((row) => row[x]);
    const colIdct = idct1d(column);
    for (let y = 0; y < BLOCK_SIZE; y += 1) {
      if (!temp[y]) temp[y] = new Array(BLOCK_SIZE).fill(0);
      temp[y][x] = colIdct[y];
    }
  }
  return temp.map((row) => idct1d(row));
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function embedWatermark(pixels, payload, width, height) {
  if (width === 0 || height === 0) return pixels;
  const bytes = toBytes(payload);
  const bits = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i -= 1) {
      bits.push((byte >> i) & 1);
    }
  }

  let bitIndex = 0;
  const stride = width * 4;
  for (let by = 0; by + BLOCK_SIZE <= height; by += BLOCK_SIZE) {
    for (let bx = 0; bx + BLOCK_SIZE <= width; bx += BLOCK_SIZE) {
      if (bitIndex >= bits.length) return pixels;
      const block = [];
      for (let y = 0; y < BLOCK_SIZE; y += 1) {
        const row = [];
        for (let x = 0; x < BLOCK_SIZE; x += 1) {
          const idx = (by + y) * stride + (bx + x) * 4;
          row.push(pixels[idx]);
        }
        block.push(row);
      }

      const coeffs = dct2d(block);
      const bit = bits[bitIndex];
      const [a, b] = MID_COEFFS[bitIndex % MID_COEFFS.length];
      const delta = 4;
      if (bit === 1 && coeffs[a][b] < coeffs[b][a]) {
        coeffs[a][b] += delta;
      } else if (bit === 0 && coeffs[a][b] > coeffs[b][a]) {
        coeffs[a][b] -= delta;
      }

      const restored = idct2d(coeffs);
      for (let y = 0; y < BLOCK_SIZE; y += 1) {
        for (let x = 0; x < BLOCK_SIZE; x += 1) {
          const idx = (by + y) * stride + (bx + x) * 4;
          pixels[idx] = clampByte(restored[y][x]);
        }
      }

      bitIndex += 1;
    }
  }

  return pixels;
}

export function extractWatermark(pixels, width, height) {
  if (width === 0 || height === 0) return null;
  const stride = width * 4;
  const bits = [];
  for (let by = 0; by + BLOCK_SIZE <= height; by += BLOCK_SIZE) {
    for (let bx = 0; bx + BLOCK_SIZE <= width; bx += BLOCK_SIZE) {
      const block = [];
      for (let y = 0; y < BLOCK_SIZE; y += 1) {
        const row = [];
        for (let x = 0; x < BLOCK_SIZE; x += 1) {
          const idx = (by + y) * stride + (bx + x) * 4;
          row.push(pixels[idx]);
        }
        block.push(row);
      }

      const coeffs = dct2d(block);
      const [a, b] = MID_COEFFS[bits.length % MID_COEFFS.length];
      bits.push(coeffs[a][b] > coeffs[b][a] ? 1 : 0);
    }
  }

  const bytes = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) {
      value = (value << 1) | bits[i + j];
    }
    bytes.push(value);
  }

  const text = new TextDecoder().decode(new Uint8Array(bytes));
  const [sessionId, page, issued] = text.split(":");
  if (!sessionId || !page || !issued) return null;
  const pageNumber = Number.parseInt(page, 10);
  const issuedAt = Number.parseInt(issued, 10);
  if (!Number.isFinite(pageNumber) || !Number.isFinite(issuedAt)) return null;
  return { sessionId, pageNumber, issuedAt };
}
