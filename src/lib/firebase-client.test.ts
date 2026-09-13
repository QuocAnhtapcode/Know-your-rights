import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebase = vi.hoisted(() => {
  const order: string[] = [];
  const auth = {
    currentUser: null as { uid: string } | null,
    authStateReady: vi.fn(async () => { order.push('authStateReady'); }),
  };
  return {
    order,
    auth,
    app: { name: 'test-app', options: { projectId: 'test-project' } },
    browserSessionPersistence: { type: 'SESSION' },
    initializeApp: vi.fn(),
    initializeAppCheck: vi.fn(),
    setPersistence: vi.fn(async () => { order.push('setPersistence'); }),
    signInAnonymously: vi.fn(async () => {
      order.push('signInAnonymously');
      auth.currentUser = { uid: 'synthetic-anonymous-user' };
    }),
    signOut: vi.fn(async () => undefined),
    deleteApp: vi.fn(async () => undefined),
    getFunctions: vi.fn(() => ({ synthetic: true })),
  };
});

vi.mock('firebase/app', () => ({
  initializeApp: firebase.initializeApp,
  deleteApp: firebase.deleteApp,
  getApps: vi.fn(() => []),
}));

vi.mock('firebase/app-check', () => ({
  initializeAppCheck: firebase.initializeAppCheck,
  ReCaptchaEnterpriseProvider: class ReCaptchaEnterpriseProvider {
    constructor(readonly siteKey: string) {}
  },
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => firebase.auth),
  setPersistence: firebase.setPersistence,
  browserSessionPersistence: firebase.browserSessionPersistence,
  signInAnonymously: firebase.signInAnonymously,
  signOut: firebase.signOut,
  connectAuthEmulator: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: firebase.getFunctions,
  httpsCallable: vi.fn(),
  connectFunctionsEmulator: vi.fn(),
}));

import { createFirebaseClient } from './firebase-client';

function configurePublicFirebaseEnvironment() {
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'public-test-api-key');
  vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'test-project.firebaseapp.com');
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test-project');
  vi.stubEnv('VITE_FIREBASE_APP_ID', '1:123:web:synthetic');
  vi.stubEnv('VITE_FIREBASE_FUNCTIONS_REGION', 'australia-southeast1');
  vi.stubEnv('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY', 'public-test-site-key');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  configurePublicFirebaseEnvironment();
  firebase.order.length = 0;
  firebase.auth.currentUser = null;
  firebase.auth.authStateReady.mockImplementation(async () => { firebase.order.push('authStateReady'); });
  firebase.setPersistence.mockImplementation(async () => { firebase.order.push('setPersistence'); });
  firebase.signInAnonymously.mockImplementation(async () => {
    firebase.order.push('signInAnonymously');
    firebase.auth.currentUser = { uid: 'synthetic-anonymous-user' };
  });
  firebase.initializeApp.mockImplementation((_config, name) => ({ ...firebase.app, name }));
});

describe('Firebase browser session initialization', () => {
  it('awaits browserSessionPersistence and auth restoration before anonymous sign-in', async () => {
    let releasePersistence!: () => void;
    firebase.setPersistence.mockImplementation(async () => {
      firebase.order.push('setPersistence:start');
      await new Promise<void>((resolve) => { releasePersistence = resolve; });
      firebase.order.push('setPersistence:end');
    });

    const pending = createFirebaseClient('firebase');
    await vi.waitFor(() => expect(firebase.order).toEqual(['setPersistence:start']));
    expect(firebase.auth.authStateReady).not.toHaveBeenCalled();
    expect(firebase.signInAnonymously).not.toHaveBeenCalled();

    releasePersistence();
    const session = await pending;

    expect(firebase.order).toEqual([
      'setPersistence:start',
      'setPersistence:end',
      'authStateReady',
      'signInAnonymously',
    ]);
    expect(firebase.setPersistence).toHaveBeenCalledWith(firebase.auth, firebase.browserSessionPersistence);
    await session.close();
  });

  it('reuses the restored SDK-managed identity instead of signing in again', async () => {
    firebase.auth.currentUser = { uid: 'restored-synthetic-user' };

    const session = await createFirebaseClient('firebase');

    expect(firebase.order).toEqual(['setPersistence', 'authStateReady']);
    expect(firebase.signInAnonymously).not.toHaveBeenCalled();
    expect(firebase.getFunctions).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'kyr-web-test-project' }),
      'australia-southeast1',
    );
    await session.close();
  });
});
