import { HttpsError } from 'firebase-functions/v2/https';

export interface RuntimeEnvironment {
  FUNCTIONS_EMULATOR?: string;
  GCLOUD_PROJECT?: string;
  GOOGLE_CLOUD_PROJECT?: string;
  FIRESTORE_EMULATOR_HOST?: string;
  KYR_BACKEND_MODE?: string;
  FIREBASE_AUTH_EMULATOR_HOST?: string;
  FIREBASE_CONFIG?: string;
}

export const CLOUD_PROJECT_ID = 'know-your-rights-cd8b5';
export const CLOUD_ORIGINS = [
  'https://know-your-rights-cd8b5.web.app',
  'https://know-your-rights-cd8b5.firebaseapp.com',
];

export type BackendRuntime = 'emulator' | 'cloud-mock' | 'cloud-live';

export function isAuthorizedCloudRuntime(environment: RuntimeEnvironment): boolean {
  const mode = environment.KYR_BACKEND_MODE;
  return (mode === 'cloud-mock' || mode === 'cloud-live') && isAuthorizedCloudProject(environment);
}

function isAuthorizedCloudProject(environment: RuntimeEnvironment): boolean {
  const projectId = environment.GCLOUD_PROJECT ?? environment.GOOGLE_CLOUD_PROJECT;
  if (environment.GCLOUD_PROJECT && environment.GOOGLE_CLOUD_PROJECT
    && environment.GCLOUD_PROJECT !== environment.GOOGLE_CLOUD_PROJECT) return false;
  if (environment.FIREBASE_CONFIG) {
    try {
      const config: unknown = JSON.parse(environment.FIREBASE_CONFIG);
      if (!config || typeof config !== 'object' || !('projectId' in config)
        || config.projectId !== CLOUD_PROJECT_ID) return false;
    } catch {
      return false;
    }
  }
  return projectId === CLOUD_PROJECT_ID
    && environment.FUNCTIONS_EMULATOR !== 'true' && !environment.FIRESTORE_EMULATOR_HOST
    && !environment.FIREBASE_AUTH_EMULATOR_HOST;
}

export function isAuthorizedCloudMock(environment: RuntimeEnvironment): boolean {
  return environment.KYR_BACKEND_MODE === 'cloud-mock' && isAuthorizedCloudProject(environment);
}

export function requireMockRuntime(environment: RuntimeEnvironment): BackendRuntime {
  if (isTrustedEmulator(environment)) return 'emulator';
  if (isAuthorizedCloudRuntime(environment)) return environment.KYR_BACKEND_MODE as 'cloud-mock' | 'cloud-live';
  throw new HttpsError('failed-precondition', 'Backend is not enabled for this runtime.');
}

/** Never permit a mock backend against a real Firebase project. */
export function isTrustedEmulator(environment: RuntimeEnvironment): boolean {
  const projectId = environment.GCLOUD_PROJECT ?? environment.GOOGLE_CLOUD_PROJECT;
  return environment.FUNCTIONS_EMULATOR === 'true'
    && /^demo-[a-z0-9-]+$/.test(projectId ?? '')
    && /^(localhost|127\.0\.0\.1):\d+$/.test(environment.FIRESTORE_EMULATOR_HOST ?? '');
}

export function requireM1Emulator(environment: RuntimeEnvironment): void {
  if (!isTrustedEmulator(environment)) {
    throw new HttpsError('failed-precondition', 'M1 scaffold only: cloud chat is not enabled.');
  }
}

export function requireOwnerIdentity(auth: { uid: string } | undefined): string {
  if (!auth?.uid || auth.uid.length > 128 || auth.uid.includes('/')) {
    throw new HttpsError('unauthenticated', 'An authenticated session is required.');
  }
  return auth.uid;
}
