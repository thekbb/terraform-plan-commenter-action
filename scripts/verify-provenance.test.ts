import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeFiles, verifyRuntimeProvenance } from './verify-provenance.js';

const { spawn } = vi.hoisted(() => ({
  spawn: vi.fn<(
    command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding
  ) => Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr' | 'error'>>(),
}));
vi.mock('node:child_process', () => ({ spawnSync: spawn }));
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(() => Promise.resolve()) }));

const repository = 'thekbb/terraform-plan-commenter-action';
const tag = 'v2.0.1';
const sha = 'a'.repeat(40);
const filenames = ['format-comment.js', 'helpers.js', 'run-terraform-plan.js'];
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime provenance '));
  fs.mkdirSync(path.join(root, 'dist'));
  for (const name of filenames) fs.writeFileSync(path.join(root, 'dist', name), 'export {};\n');
  spawn.mockReset();
  spawn.mockReturnValue({ status: 0, stdout: '', stderr: '' });
  vi.mocked(delay).mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('generated runtime provenance', () => {
  it('verifies every runtime file against the exact hosted release identity', async () => {
    vi.stubEnv('GH_HOST', 'untrusted.example');
    await verifyRuntimeProvenance({ repository, tag, sha, root });
    expect(spawn).toHaveBeenCalledTimes(filenames.length);
    for (const [index, name] of filenames.entries()) {
      expect(spawn.mock.calls[index]?.slice(0, 2)).toEqual(['gh', [
        'attestation', 'verify', path.join(root, 'dist', name),
        '--hostname', 'github.com', '--repo', repository,
        '--signer-digest', sha, '--source-ref', `refs/tags/${tag}`, '--source-digest', sha,
        '--cert-identity', `https://github.com/${repository}/.github/workflows/release.yml@refs/tags/${tag}`,
        '--cert-oidc-issuer', 'https://token.actions.githubusercontent.com',
        '--deny-self-hosted-runners', '--predicate-type', 'https://slsa.dev/provenance/v1',
      ]]);
      expect(spawn.mock.calls[index]?.[2].env?.GH_HOST).toBe('github.com');
    }
  });

  it('retries briefly for indexing propagation and then verifies the remaining files', async () => {
    spawn.mockReturnValueOnce({ status: 1, stdout: '', stderr: 'Not indexed' });
    await verifyRuntimeProvenance({ repository, tag, sha, root });
    expect(spawn).toHaveBeenCalledTimes(4);
    expect(delay).toHaveBeenCalledExactlyOnceWith(2000);
  });

  it('fails the whole verification if any runtime file lacks acceptable provenance', async () => {
    spawn.mockReturnValue({ status: 1, stdout: '', stderr: 'Authorization: Bearer secret-token' });
    spawn.mockReturnValueOnce({ status: 0, stdout: '', stderr: '' });
    await expect(verifyRuntimeProvenance({ repository, tag, sha, root })).rejects.toThrow(
      'Provenance verification failed for dist/helpers.js after 5 attempts'
    );
    expect(spawn).toHaveBeenCalledTimes(6);
    expect(delay).toHaveBeenCalledTimes(4);
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('secret-token'));
  });

  it('reports CLI launch failures without logging raw error details', async () => {
    spawn.mockReturnValue({ status: null, stdout: '', stderr: '', error: new Error('secret-token') });
    await expect(verifyRuntimeProvenance({ repository, tag, sha, root })).rejects.toThrow('Could not run gh attestation verify');
    expect(spawn).toHaveBeenCalledOnce();
    expect(delay).not.toHaveBeenCalled();
  });

  it('rejects empty runtime directories and symlinked files', () => {
    for (const name of filenames) fs.unlinkSync(path.join(root, 'dist', name));
    expect(() => runtimeFiles(root)).toThrow('nonempty');
    fs.symlinkSync('../outside.js', path.join(root, 'dist', 'runtime.js'));
    expect(() => runtimeFiles(root)).toThrow('regular JavaScript');
  });

  it('rejects non-version refs and ambiguous commit identities before calling GitHub', async () => {
    await expect(verifyRuntimeProvenance({ repository, tag: 'v2', sha, root })).rejects.toThrow('version tag');
    await expect(verifyRuntimeProvenance({ repository, tag, sha: 'main', root })).rejects.toThrow('commit SHA');
    expect(spawn).not.toHaveBeenCalled();
  });
});
