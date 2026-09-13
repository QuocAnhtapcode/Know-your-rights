import { createHash, timingSafeEqual } from 'node:crypto';

function hash(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Value is obtained only during a validated start invocation, never at import/build. */
export function verifyRuntimeAccessCode(candidate: string | undefined, readRuntimeSecret: () => string): boolean {
  if (!candidate) return false;
  const expected = readRuntimeSecret();
  if (!expected || expected.length < 12) return false;
  return timingSafeEqual(hash(candidate), hash(expected));
}
