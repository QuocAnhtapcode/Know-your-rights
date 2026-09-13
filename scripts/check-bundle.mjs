import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire, isBuiltin } from 'node:module';

const meta = JSON.parse(await readFile(new URL('../functions/lib/build-meta.json', import.meta.url), 'utf8'));
assert(Object.keys(meta.inputs).some((name) => name.endsWith('shared/contracts.ts')), 'Shared contracts must be inside the Functions bundle');
const pkg = JSON.parse(await readFile(new URL('../functions/package.json', import.meta.url), 'utf8'));
for (const output of Object.values(meta.outputs)) {
  for (const entry of output.imports) {
    assert(entry.external, `Unexpected output import: ${entry.path}`);
    assert(!entry.path.startsWith('.') && !entry.path.startsWith('/') && !/^[A-Za-z]:/.test(entry.path), 'Deployed bundle must not import local files');
    const name = entry.path.startsWith('@') ? entry.path.split('/').slice(0, 2).join('/') : entry.path.split('/')[0];
    assert(isBuiltin(entry.path) || Object.hasOwn(pkg.dependencies, name), `Undeclared runtime dependency ${entry.path}`);
  }
}
// Import with no cloud/emulator context and no secret payloads. This must not call any provider.
delete process.env.OPENAI_API_KEY;
delete process.env.DEMO_ACCESS_CODE;
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.FIRESTORE_EMULATOR_HOST;
const require = createRequire(import.meta.url);
const exported = require('../functions/lib/index.cjs');
assert.deepEqual(Object.keys(exported).sort(), ['clearConversation', 'getConversation', 'sendMessage', 'startConversation']);
console.log('PASS: shared contracts bundled, runtime imports declared, four callables load without secrets.');
