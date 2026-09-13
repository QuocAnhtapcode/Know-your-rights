import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const appSourceUrl = new URL('../../src/App.tsx', import.meta.url);
const firebaseClientSourceUrl = new URL('../../src/lib/firebase-client.ts', import.meta.url);

describe('browser storage and SDK boundaries', () => {
  it('limits application-owned session keys to an opaque pointer and suppression flag', async () => {
    const source = await readFile(appSourceUrl, 'utf8');
    const keys = [...source.matchAll(/const\s+\w+\s*=\s*'(kyr:[^']+)'/g)].map((match) => match[1]).sort();

    expect(keys).toEqual(['kyr:conversation', 'kyr:suppressed']);
    expect(source).not.toContain('localStorage');
    expect(source).not.toMatch(/sessionStorage\.(?:setItem|getItem)\([^)]*(?:messages|transcript|userFacts|evidenceLedger)/);
  });

  it('uses Auth and callable Functions without a browser Firestore, Storage or token cache implementation', async () => {
    const source = await readFile(firebaseClientSourceUrl, 'utf8');

    expect(source).toContain('browserSessionPersistence');
    expect(source).not.toMatch(/firebase\/(?:firestore|storage)/);
    expect(source).not.toMatch(/(?:localStorage|sessionStorage|indexedDB|onSnapshot|enableIndexedDbPersistence|enableMultiTabIndexedDbPersistence)/);
    expect(source).not.toMatch(/(?:idToken|refreshToken)\s*=/);
  });
});
