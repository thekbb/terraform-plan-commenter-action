// @ts-check

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const committedDist = path.join(repoRoot, 'dist');
const tsconfigPath = path.join(repoRoot, 'tsconfig.build.json');
const tscPath = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const checkOnly = process.argv.slice(2).includes('--check');

/** @param {string} outputDirectory */
const compile = (outputDirectory) => {
  execFileSync(
    process.execPath,
    [tscPath, '--project', tsconfigPath, '--outDir', outputDirectory],
    { cwd: repoRoot, stdio: 'inherit' }
  );
};

/**
 * @param {string} directory
 * @returns {string[]}
 */
const listFiles = (directory) => {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .sort();
};

/**
 * @param {string} expectedDirectory
 * @param {string} actualDirectory
 */
const assertDirectoriesMatch = (expectedDirectory, actualDirectory) => {
  const expectedFiles = listFiles(expectedDirectory);
  const actualFiles = listFiles(actualDirectory);

  if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) {
    throw new Error(
      `Generated files are stale.\nExpected: ${expectedFiles.join(', ') || '<none>'}` +
      `\nActual: ${actualFiles.join(', ') || '<none>'}`
    );
  }

  for (const relativePath of expectedFiles) {
    const expected = fs.readFileSync(path.join(expectedDirectory, relativePath));
    const actual = fs.readFileSync(path.join(actualDirectory, relativePath));

    if (!expected.equals(actual)) {
      throw new Error(`Generated file is stale: dist/${relativePath}`);
    }
  }
};

if (checkOnly) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'terraform-plan-comment-build-'));
  const temporaryDist = path.join(temporaryRoot, 'dist');

  try {
    compile(temporaryDist);
    assertDirectoriesMatch(temporaryDist, committedDist);
    console.log('Generated dist files are current.');
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
} else {
  fs.rmSync(committedDist, { force: true, recursive: true });
  compile(committedDist);
  console.log('Built TypeScript runtime in dist/.');
}
