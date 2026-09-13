export const EMULATOR_PROJECT_ID = 'demo-know-your-rights';
export const EMULATOR_REGION = 'australia-southeast1';
export const EMULATOR_HOST = '127.0.0.1';
export const EMULATOR_PORTS = { auth: 9099, functions: 5001, firestore: 8080 } as const;

/** Fail before creating an SDK client; these tests must never fall back to cloud. */
export function assertEmulatorEnvironment(): void {
  if (process.env.KYR_EMULATOR_PROJECT_ID !== EMULATOR_PROJECT_ID) {
    throw new Error('Emulator tests require KYR_EMULATOR_PROJECT_ID=demo-know-your-rights.');
  }

  const requiredHosts = [
    ['FIRESTORE_EMULATOR_HOST', EMULATOR_PORTS.firestore],
    ['FIREBASE_AUTH_EMULATOR_HOST', EMULATOR_PORTS.auth],
  ] as const;
  for (const [name, port] of requiredHosts) {
    const value = process.env[name];
    if (value !== `${EMULATOR_HOST}:${port}` && value !== `localhost:${port}`) {
      throw new Error(`${name} must target the configured loopback emulator port ${port}.`);
    }
  }

  for (const name of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT'] as const) {
    const project = process.env[name];
    if (project && project !== EMULATOR_PROJECT_ID) {
      throw new Error(`${name} targets a different project. Refusing emulator tests.`);
    }
  }
}
