import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split(/\r?\n/u).filter(Boolean);
const binaryExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.zip']);
const checks = [
  ['OpenAI API key shape', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ['service-account private_key field', /"private_key"\s*:\s*"(?!replace|example)/u],
  ['browser-exposed OpenAI key', /^\s*VITE_OPENAI_API_KEY\s*=\s*(?!replace|example)[^\s#]{10,}/mu],
  ['hard-coded demo access code', /^\s*DEMO_ACCESS_CODE\s*=\s*(?!replace|example|your_)[^\s#]{8,}/mu],
];
const findings = [];
for (const file of files) {
  if (binaryExtensions.has(extname(file).toLowerCase())) continue;
  let content;
  try { content = await readFile(file, 'utf8'); } catch { continue; }
  for (const [kind, pattern] of checks) {
    if (pattern.test(content)) findings.push({ file, kind });
  }
}
if (findings.length > 0) {
  for (const finding of findings) console.error(`SECRET-SCAN FAIL: ${finding.file} (${finding.kind})`);
  process.exitCode = 1;
} else {
  console.log(`PASS: scanned ${files.length} non-ignored repository files; no configured secret pattern was found.`);
}
