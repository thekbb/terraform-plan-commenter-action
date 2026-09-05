import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./release.mjs', import.meta.url));
const managedFiles = ['CHANGELOG.md', 'README.md', 'package.json', 'package-lock.json'];

describe('release metadata commands', () => {
  let root: string;
  const readFiles = (): Record<string, string> => Object.fromEntries(
    managedFiles.map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')])
  );
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    // Preparation and checking must work without Git or npm available.
    env: { ...process.env, PATH: '' },
    timeout: 5000,
  });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'release metadata test '));
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"2.0.0"}\n');
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{"version":"2.0.0","packages":{"":{"version":"2.0.0"}}}\n');
    fs.writeFileSync(path.join(root, 'README.md'), 'uses: thekbb/terraform-plan-commenter-action@v2.0.0\n');
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `# Changelog

## [Unreleased]

Fix Terraform execution failures.

## [2.0.0] - 2026-08-19

Previous release.

[Unreleased]: https://github.com/thekbb/terraform-plan-commenter-action/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/thekbb/terraform-plan-commenter-action/compare/v1.0.0...v2.0.0
`);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('checks metadata without changing files or requiring Git', () => {
    const before = readFiles();
    const result = run('--check', '2.0.1');
    expect(result.status, result.stderr).toBe(0);
    expect(readFiles()).toEqual(before);
  });

  it('prepares only release metadata and can be rerun without changing the result', () => {
    const result = run('--prepare', '2.0.1');
    expect(result.status, result.stderr).toBe(0);
    const prepared = readFiles();
    expect(prepared['package.json']).toContain('"version": "2.0.1"');
    expect(prepared['package-lock.json']?.match(/"version": "2\.0\.1"/gu)).toHaveLength(2);
    expect(prepared['README.md']).toContain('@v2.0.1');
    expect(prepared['CHANGELOG.md']).toContain('## [2.0.1] - ');
    expect(fs.readdirSync(root).sort()).toEqual([...managedFiles].sort());
    const repeat = run('--prepare', '2.0.1');
    expect(repeat.status, repeat.stderr).toBe(0);
    expect(readFiles()).toEqual(prepared);
    expect(run('--check', '2.0.1').status).toBe(0);
  });

  it.each([
    ['2.0.1'], ['--check', '--prepare', '2.0.1'], ['--unknown', '2.0.1'],
    ['--prepare', '2.0.1', 'extra'], ['--prepare'], [],
  ].map((args) => ({ args })))('rejects unsupported invocation $args before changing files', ({ args }) => {
    const before = readFiles();
    const result = run(...args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage:');
    expect(readFiles()).toEqual(before);
  });

  it('does not modify files when release metadata is invalid', () => {
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"9.0.0"}\n');
    const before = readFiles();
    expect(run('--prepare', '2.0.1').status).not.toBe(0);
    expect(readFiles()).toEqual(before);
  });
});
