#!/usr/bin/env node
// Runs a package's own eslint on staged files, from inside that package.
//
//   node scripts/eslint-in-package.mjs <package dir> <file> [file…]
//
// Each package installs its own eslint (no npm workspace), and eslint's flat
// config is found from the working directory, so lint-staged has to lint from
// the package folder. It used to do that through `bash -c "cd … && npx eslint …"`,
// but on Windows a GUI client such as GitHub Desktop resolves `bash` to WSL's,
// which fails when no Linux distro is installed. Node is always there.

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const [dir, ...files] = process.argv.slice(2);
if (!dir || files.length === 0) {
  console.error('Usage: node scripts/eslint-in-package.mjs <package dir> <file> [file…]');
  process.exit(2);
}

const cwd = path.resolve(dir);
const relative = files.map((file) => path.relative(cwd, path.resolve(file)));
const result = spawnSync('npx', ['eslint', ...relative], { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
