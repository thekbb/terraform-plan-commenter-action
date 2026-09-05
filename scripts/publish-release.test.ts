import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishRelease, releaseNotes, type Publication } from './publish-release.js';

vi.mock('node:timers/promises', () => ({ setTimeout: () => Promise.resolve() }));

const input: Publication = {
  repository: 'thekbb/terraform-plan-commenter-action', tag: 'v2.0.1',
  sha: 'a'.repeat(40), tagObject: 'b'.repeat(40), notes: 'Fix Terraform failures.', token: 'test-token',
};
const ref = { ref: `refs/tags/${input.tag}`, object: { type: 'tag', sha: input.tagObject } };
const draft = {
  id: 42, tag_name: input.tag, target_commitish: input.sha, name: input.tag, body: input.notes,
  draft: true, prerelease: false, immutable: false, assets: [],
};
const published = { ...draft, draft: false, immutable: true };
const fetchMock = vi.fn<typeof fetch>();

const respond = (...bodies: unknown[]): void => {
  for (const body of bodies) fetchMock.mockResolvedValueOnce(Response.json(body));
};
const methods = (): string[] => fetchMock.mock.calls.map(([, options]) => options?.method ?? 'GET');

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error('Unexpected API call'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('reviewed release notes', () => {
  it('extracts only the tagged version, preserving Markdown', () => {
    const changelog = '# Changelog\n\n## [Unreleased]\n\nFuture work.\n\n' +
      '## [2.0.1] - 2026-09-05\n\n### Fixed\n\n- Keep `plan` failures.\n\n' +
      '## [2.0.0] - 2026-04-29\n\nOld notes.\n';
    expect(releaseNotes(changelog, input.tag)).toBe('### Fixed\n\n- Keep `plan` failures.');
  });

  it('excludes trailing changelog link definitions for a first release', () => {
    expect(releaseNotes('## [2.0.1] - 2026-09-05\n\nNotes.\n\n[Unreleased]: https://example.com\n', input.tag))
      .toBe('Notes.');
  });

  it.each([
    '', '## [2.0.1] - 2026-09-05\n\n',
    '## [2.0.1] - 2026-09-05\nFirst\n## [2.0.1] - 2026-09-05\nSecond\n',
  ])('rejects missing, empty, or duplicate version sections', (source) => {
    expect(() => releaseNotes(source, input.tag)).toThrow();
  });
});

describe('release publication', () => {
  it('creates a draft from reviewed notes, publishes, and confirms immutability', async () => {
    vi.stubEnv('GH_HOST', 'untrusted.example');
    respond(ref, [], ref, draft, ref, published, published, ref);
    await expect(publishRelease(input)).resolves.toBe('published');
    expect(methods()).toEqual(['GET', 'GET', 'GET', 'POST', 'GET', 'PATCH', 'GET', 'GET']);
    const creation = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(creation?.[1]?.body).toBe(JSON.stringify({
      tag_name: input.tag, target_commitish: input.sha, name: input.tag, body: input.notes,
      draft: true, prerelease: false,
    }));
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toContain(`https://api.github.com/repos/${input.repository}/`);
      expect(options?.redirect).toBe('error');
    }
  });

  it('resumes a matching draft without creating or rewriting one', async () => {
    respond(ref, [draft], ref, published, published, ref);
    await expect(publishRelease(input)).resolves.toBe('published');
    expect(methods().filter((method) => method !== 'GET')).toEqual(['PATCH']);
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(patch?.[1]?.body).toBe(JSON.stringify({ draft: false }));
  });

  it('accepts an already immutable release with no writes', async () => {
    respond(ref, [published], published, ref);
    await expect(publishRelease(input)).resolves.toBe('already-published');
    expect(methods().every((method) => method === 'GET')).toBe(true);
  });

  it('finds an existing draft on a later release-list page', async () => {
    const earlier = Array.from({ length: 100 }, () => ({ tag_name: 'v1.0.0' }));
    respond(ref, earlier, [draft], ref, published, published, ref);
    await expect(publishRelease(input)).resolves.toBe('published');
    expect(methods()).not.toContain('POST');
    expect(fetchMock.mock.calls[2]?.[0]).toContain('page=2');
  });

  it.each([
    { target_commitish: 'main' }, { body: 'Unreviewed notes' }, { name: 'Different title' },
    { assets: [{ name: 'unexpected.zip' }] }, { prerelease: true },
  ])('rejects conflicting drafts without changing them', async (override) => {
    respond(ref, [{ ...draft, ...override }]);
    await expect(publishRelease(input)).rejects.toThrow(/draft|Conflicting/u);
    expect(methods().every((method) => method === 'GET')).toBe(true);
  });

  it('rejects duplicate releases without choosing one to overwrite', async () => {
    respond(ref, [draft, { ...draft, id: 43 }]);
    await expect(publishRelease(input)).rejects.toThrow('Multiple releases');
    expect(methods().every((method) => method === 'GET')).toBe(true);
  });

  it.each([403, 404, 429, 503])('does not treat HTTP %i as a missing release', async (status) => {
    respond(ref);
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'API error' }, { status }));
    await expect(publishRelease(input)).rejects.toThrow(`HTTP ${String(status)}`);
    expect(methods()).not.toContain('POST');
  });

  it('rejects a tag that changed before publishing the draft', async () => {
    respond(ref, [draft], { ...ref, object: { type: 'tag', sha: 'c'.repeat(40) } });
    await expect(publishRelease(input)).rejects.toThrow('no longer matches');
    expect(methods()).not.toContain('PATCH');
  });

  it('can resume after a draft creation response was lost', async () => {
    respond(ref, [], ref);
    fetchMock.mockRejectedValueOnce(new Error('Connection lost after creation'));
    await expect(publishRelease(input)).rejects.toThrow('Connection lost');
    respond(ref, [draft], ref, published, published, ref);
    await expect(publishRelease(input)).resolves.toBe('published');
    expect(methods().filter((method) => method === 'POST')).toHaveLength(1);
  });

  it('waits briefly for immutable metadata after publication', async () => {
    respond(ref, [draft], ref, published, { ...published, immutable: false }, published, ref);
    await expect(publishRelease(input)).resolves.toBe('published');
  });

  it('fails if an existing published release stays mutable, without rewriting it', async () => {
    const mutable = { ...published, immutable: false };
    respond(ref, [mutable], mutable, mutable, mutable, mutable, mutable);
    await expect(publishRelease(input)).rejects.toThrow('not published and immutable');
    expect(methods().every((method) => method === 'GET')).toBe(true);
  });

  it('rejects malformed release metadata and invalid invocation', async () => {
    respond(ref, [{ tag_name: input.tag }]);
    await expect(publishRelease(input)).rejects.toThrow('Malformed');
    fetchMock.mockClear();
    await expect(publishRelease({ ...input, tag: 'v2' })).rejects.toThrow('Publication requires');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
