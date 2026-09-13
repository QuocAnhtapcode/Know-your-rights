import { describe, expect, it } from 'vitest';
import {
  isAuthorizedCloudMock, isTrustedEmulator, requireM1Emulator, requireMockRuntime, requireOwnerIdentity,
} from '../src/security/runtime';

describe('M1 runtime boundary', () => {
  const local = {
    FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: 'demo-know-your-rights', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  };
  it('only accepts an emulator process, demo project and loopback Firestore together', () => {
    expect(isTrustedEmulator(local)).toBe(true);
    for (const environment of [
      {}, { ...local, FUNCTIONS_EMULATOR: 'false' },
      { ...local, GCLOUD_PROJECT: 'know-your-rights-cd8b5' },
      { ...local, FIRESTORE_EMULATOR_HOST: 'remote.example:8080' },
      { ...local, FIRESTORE_EMULATOR_HOST: undefined },
    ]) {
      expect(isTrustedEmulator(environment)).toBe(false);
      expect(() => requireM1Emulator(environment)).toThrow(/cloud chat is not enabled/);
    }
  });
  it('requires a valid authenticated UID; client input cannot replace it', () => {
    expect(requireOwnerIdentity({ uid: 'synthetic-owner' })).toBe('synthetic-owner');
    expect(() => requireOwnerIdentity(undefined)).toThrow(/authenticated/);
    expect(() => requireOwnerIdentity({ uid: 'path/injection' })).toThrow(/authenticated/);
  });
  it('cloud mock requires the exact authorized project and explicit mode without emulator configuration', () => {
    const cloud = { GCLOUD_PROJECT: 'know-your-rights-cd8b5', KYR_BACKEND_MODE: 'cloud-mock' };
    expect(isAuthorizedCloudMock(cloud)).toBe(true);
    expect(requireMockRuntime(cloud)).toBe('cloud-mock');
    expect(requireMockRuntime(local)).toBe('emulator');
    for (const environment of [
      { ...cloud, GCLOUD_PROJECT: 'other-project' },
      { ...cloud, KYR_BACKEND_MODE: 'live' },
      { ...cloud, KYR_BACKEND_MODE: undefined },
      { ...cloud, FUNCTIONS_EMULATOR: 'true' },
      { ...cloud, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
      { ...cloud, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
      { ...cloud, GOOGLE_CLOUD_PROJECT: 'other-project' },
      { ...cloud, FIREBASE_CONFIG: JSON.stringify({ projectId: 'other-project' }) },
      { ...cloud, FIREBASE_CONFIG: 'not-valid-json' },
    ]) {
      expect(isAuthorizedCloudMock(environment)).toBe(false);
      expect(() => requireMockRuntime(environment)).toThrow(/not enabled/);
    }
    expect(isAuthorizedCloudMock({ ...cloud, FIREBASE_CONFIG: JSON.stringify({ projectId: cloud.GCLOUD_PROJECT }) })).toBe(true);
  });
});
