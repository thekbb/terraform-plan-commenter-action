import { describe, expect, it } from 'vitest';

describe('compiled action runtime', () => {
  it('loads the generated comment entry point', async () => {
    const runtime = await import('../dist/format-comment.js');

    expect(runtime.default).toBeTypeOf('function');
  });
});
