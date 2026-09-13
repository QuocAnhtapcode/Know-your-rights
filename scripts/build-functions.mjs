import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFunctionDependency = createRequire(resolve(root, 'functions/package.json'));
const { build } = requireFunctionDependency('esbuild');
await mkdir(resolve(root, 'functions/lib'), { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ['functions/src/index.ts'],
  outfile: 'functions/lib/index.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  packages: 'external',
  sourcemap: true,
  metafile: true,
  tsconfig: 'functions/tsconfig.json',
  logLevel: 'info',
});
// Local shared sources are bundled; only npm dependencies and Node builtins remain external.
await writeFile(resolve(root, 'functions/lib/build-meta.json'), JSON.stringify(result.metafile, null, 2));
