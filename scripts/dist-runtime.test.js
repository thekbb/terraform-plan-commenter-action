import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

describe('compiled action runtime', () => {
  it('loads the generated comment entry point', async () => {
    const runtime = await import('../dist/format-comment.js');

    expect(runtime.default).toBeTypeOf('function');
  });

  it('loads the end-to-end comment assertion script', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/e2e/assert-pr-comments.mjs')],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          GH_TOKEN: '',
          GITHUB_TOKEN: '',
        },
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'GITHUB_TOKEN or GH_TOKEN is required.'
    );
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
  });
});
