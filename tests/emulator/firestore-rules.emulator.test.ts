import { readFile } from 'node:fs/promises';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertEmulatorEnvironment, EMULATOR_HOST, EMULATOR_PORTS, EMULATOR_PROJECT_ID } from './environment';

const fixturePaths = [
  'conversations/00000000-0000-4000-8000-000000000001',
  'demoGrants/synthetic-owner',
  'usageBuckets/synthetic-owner',
  'runtime/demo',
] as const;

describe('M1 Firestore server-only Rules — local synthetic fixtures', () => {
  let testEnvironment: RulesTestEnvironment | undefined;

  beforeAll(async () => {
    assertEmulatorEnvironment();
    testEnvironment = await initializeTestEnvironment({
      projectId: EMULATOR_PROJECT_ID,
      firestore: {
        host: EMULATOR_HOST,
        port: EMULATOR_PORTS.firestore,
        rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8'),
      },
    });
    await testEnvironment.clearFirestore();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      for (const path of fixturePaths) {
        await setDoc(doc(database, path), { ownerUid: 'synthetic-owner', synthetic: true });
      }
    });
  });

  afterAll(async () => {
    if (testEnvironment) {
      await testEnvironment.clearFirestore();
      await testEnvironment.cleanup();
    }
  });

  for (const identity of ['unauthenticated', 'owner', 'other-user'] as const) {
    it(`denies all direct reads and writes for ${identity}`, async () => {
      if (!testEnvironment) throw new Error('Rules test environment did not initialize.');
      const context = identity === 'unauthenticated'
        ? testEnvironment.unauthenticatedContext()
        : testEnvironment.authenticatedContext(identity === 'owner' ? 'synthetic-owner' : 'synthetic-other');
      const database = context.firestore();

      for (const path of fixturePaths) {
        const reference = doc(database, path);
        await assertFails(getDoc(reference));
        await assertFails(setDoc(reference, { synthetic: true }));
        await assertFails(updateDoc(reference, { synthetic: false }));
        await assertFails(deleteDoc(reference));
        await assertFails(setDoc(doc(database, `${path}-new`), { synthetic: true }));
      }
      await assertFails(getDocs(collection(database, 'conversations')));
    });
  }
});
