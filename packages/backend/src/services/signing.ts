import { createHmac } from "node:crypto";

export function signKey(secret: string, key: string, expiresAt: number) {
  return createHmac("sha256", secret).update(`${key}.${expiresAt}`).digest("hex");
}

export function verifyKey(secret: string, key: string, expiresAt: number, signature: string) {
  const expected = signKey(secret, key, expiresAt);
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
