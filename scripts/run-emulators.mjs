import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const project = 'demo-know-your-rights';
const mode = process.argv[2];
if (!['test', 'start'].includes(mode)) throw new Error('Expected test or start.');
const env = { ...process.env };
for (const name of ['OPENAI_API_KEY', 'DEMO_ACCESS_CODE', 'FIREBASE_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_CONFIG']) delete env[name];
Object.assign(env, {
  KYR_EMULATOR_PROJECT_ID: project, GCLOUD_PROJECT: project, GOOGLE_CLOUD_PROJECT: project,
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FUNCTIONS_EMULATOR: 'true',
  CI: 'true',
});
const portable = join(root, '.tools', 'java21');
const javaFolder = existsSync(portable) ? readdirSync(portable).find((name) => existsSync(join(portable, name, 'bin', 'java.exe'))) : undefined;
if (env.KYR_JAVA_HOME || javaFolder) {
  env.JAVA_HOME = env.KYR_JAVA_HOME ?? join(portable, javaFolder);
  env.PATH = join(env.JAVA_HOME, 'bin') + delimiter + env.PATH;
}
const java = execFileSync('java', ['-version'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
void java; // The Firebase CLI performs the Java >=21 version check.

// Firebase's emulator may otherwise consult Secret Manager when a bound secret has
// no local override. Refuse all local secret override files, then prove this
// demo-only manifest binds no secret to any callable before the CLI starts.
const forbiddenSecretFiles = [
  join(root, 'functions', '.secret.local'),
  join(root, 'functions', '.env'),
  join(root, 'functions', '.env.local'),
  join(root, 'functions', `.env.${project}`),
];
if (forbiddenSecretFiles.some(existsSync)) {
  throw new Error('Remove local Functions secret/env override files before isolated emulator tests.');
}
const manifestDir = join(root, '.tmp', 'emulator-manifest');
const manifestPath = join(manifestDir, 'functions.json');
mkdirSync(manifestDir, { recursive: true });
rmSync(manifestPath, { force: true });
const functionsBin = join(root, 'functions', 'node_modules', 'firebase-functions', 'lib', 'bin', 'firebase-functions.js');
execFileSync(process.execPath, [functionsBin, '.'], {
  cwd: join(root, 'functions'), env: { ...env, FUNCTIONS_MANIFEST_OUTPUT_PATH: manifestPath }, stdio: 'pipe',
});
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
rmSync(manifestPath, { force: true });
const expected = ['clearConversation', 'getConversation', 'sendMessage', 'startConversation'];
if (JSON.stringify(Object.keys(manifest.endpoints ?? {}).sort()) !== JSON.stringify(expected)) {
  throw new Error('Emulator manifest must expose exactly the four public callable contracts.');
}
for (const endpoint of Object.values(manifest.endpoints)) {
  if ((endpoint.secretEnvironmentVariables ?? []).length !== 0) {
    throw new Error('Emulator callable unexpectedly binds a cloud secret.');
  }
}

const command = process.execPath;
const entry = join(root, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
if (!existsSync(entry)) throw new Error('Run npm ci to install the pinned official Firebase CLI.');
const prefix = [entry];
// firebase-tools 15.x launches the npm Windows shim with a reduced environment
// that omits PATHEXT. A temporary ignored node.exe copy lets that official shim
// resolve Node without changing the user's machine or patching installed code.
const nodeShim = join(root, 'functions', 'node_modules', '.bin', 'node.exe');
const createdNodeShim = process.platform === 'win32' && !existsSync(nodeShim);
if (createdNodeShim) copyFileSync(process.execPath, nodeShim);
const args = [...prefix, mode === 'test' ? 'emulators:exec' : 'emulators:start', '--project', project,
  '--only', 'auth,firestore,functions', '--config', 'firebase.json'];
if (mode === 'test') {
  const filter = process.argv.includes('--rules-only') ? ' tests/emulator/firestore-rules.emulator.test.ts' : '';
  args.push(`"${process.execPath}" node_modules/vitest/vitest.mjs run --config tests/vitest.emulator.config.ts${filter}`);
}
console.log(`Starting isolated emulators for ${project}; no cloud project or OpenAI calls.`);
const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
function cleanup() {
  if (createdNodeShim) rmSync(nodeShim, { force: true });
}
child.on('error', (error) => { cleanup(); console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { cleanup(); process.exitCode = code ?? 1; });
