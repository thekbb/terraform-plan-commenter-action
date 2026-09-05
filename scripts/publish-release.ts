import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

export const releaseNotes = (changelog: string, tag: string): string => {
  if (!/^v\d+\.\d+\.\d+$/u.test(tag)) {
    throw new Error('Expected a version tag such as v2.0.0');
  }
  const headers = [...changelog.matchAll(/^## \[([^\]]+)\] - \d{4}-\d{2}-\d{2}[ \t]*\r?$/gm)]
    .filter((match) => match[1] === tag.slice(1));
  const header = headers[0];
  if (headers.length !== 1 || !header) {
    throw new Error(`Expected exactly one dated CHANGELOG.md section for ${tag}`);
  }
  const remainder = changelog.slice(header.index + header[0].length);
  const notes = remainder.split(/^## |^\[[^\]]+\]:\s+https?:\/\//m, 1)[0]?.trim();
  if (!notes) {
    throw new Error(`Release notes for ${tag} are empty`);
  }
  return notes;
};

export interface Publication {
  repository: string;
  tag: string;
  sha: string;
  tagObject: string;
  notes: string;
  token: string;
}

interface Release {
  id: number;
  tag_name: string;
  target_commitish: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  immutable: boolean;
  assets: unknown[];
}

const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Malformed GitHub API response');
  }
  return value as Record<string, unknown>;
};

const parseRelease = (value: unknown): Release => {
  const release = object(value);
  if (typeof release.id !== 'number' || !Number.isSafeInteger(release.id) || release.id <= 0 ||
      typeof release.tag_name !== 'string' || typeof release.target_commitish !== 'string' ||
      (typeof release.name !== 'string' && release.name !== null) ||
      (typeof release.body !== 'string' && release.body !== null) ||
      typeof release.draft !== 'boolean' || typeof release.prerelease !== 'boolean' ||
      typeof release.immutable !== 'boolean' || !Array.isArray(release.assets)) {
    throw new Error('Malformed GitHub release metadata');
  }
  return release as unknown as Release;
};

export const publishRelease = async (input: Publication): Promise<'published' | 'already-published'> => {
  const { repository, tag, sha, tagObject, notes, token } = input;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) || !/^v\d+\.\d+\.\d+$/u.test(tag) ||
      !/^[0-9a-f]{40}$/u.test(sha) || !/^[0-9a-f]{40}$/u.test(tagObject) || !token || !notes.trim()) {
    throw new Error('Publication requires owner/repo, a version tag, exact commit and tag-object SHAs, notes, and a token');
  }
  const base = `/repos/${repository}`;
  const request = async (endpoint: string, method = 'GET', body?: Record<string, unknown>): Promise<unknown> => {
    const response = await fetch(`https://api.github.com${base}${endpoint}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`GitHub ${method} ${endpoint} failed with HTTP ${String(response.status)}; rerun after resolving the error`);
    }
    return response.json();
  };
  const checkTag = async (): Promise<void> => {
    const ref = object(await request(`/git/ref/tags/${tag}`));
    const target = object(ref.object);
    if (ref.ref !== `refs/tags/${tag}` || target.type !== 'tag' || target.sha !== tagObject) {
      throw new Error('Remote tag no longer matches the verified signed tag object');
    }
  };
  const checkIdentity = (release: Release): void => {
    if (release.tag_name !== tag || release.prerelease) {
      throw new Error('Conflicting release tag or prerelease state');
    }
  };

  await checkTag();
  // Listing with the write-scoped token includes drafts. Do not interpret a
  // failed lookup (permissions, rate limit, or outage) as an absent release.
  const matches: Release[] = [];
  for (let page = 1; ; page += 1) {
    const releases: unknown = await request(`/releases?per_page=100&page=${String(page)}`);
    if (!Array.isArray(releases)) {
      throw new Error('Expected a GitHub release list');
    }
    for (const value of releases as unknown[]) {
      if (object(value).tag_name === tag) {
        matches.push(parseRelease(value));
      }
    }
    if (releases.length < 100) break;
  }
  if (matches.length > 1) {
    throw new Error(`Multiple releases exist for ${tag}; reconcile them before retrying`);
  }
  let release = matches[0];
  if (!release) {
    await checkTag();
    release = parseRelease(await request('/releases', 'POST', {
      tag_name: tag, target_commitish: sha, name: tag, body: notes, draft: true, prerelease: false,
    }));
  }
  checkIdentity(release);
  const wasPublished = !release.draft;
  if (release.draft) {
    if (release.immutable || release.target_commitish !== sha || release.name !== tag ||
        release.body !== notes || release.assets.length !== 0) {
      throw new Error('Existing draft differs from the verified commit, changelog, title, or expected empty asset list');
    }
    await checkTag();
    await request(`/releases/${String(release.id)}`, 'PATCH', { draft: false });
  }

  // A retry after a successful publish performs only reads. Also allow a short
  // interval for GitHub to report the immutable state after publication.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = parseRelease(await request(`/releases/${String(release.id)}`));
    checkIdentity(current);
    if (current.id !== release.id) throw new Error('GitHub returned a different release ID');
    if (!current.draft && current.immutable) {
      await checkTag();
      return wasPublished ? 'already-published' : 'published';
    }
    if (attempt < 4) await delay(2000);
  }
  throw new Error(`Release ${tag} is not published and immutable; keep the major tag unchanged`);
};

if (import.meta.main) {
  try {
    const env = { ...process.env };
    const tag = env.TAG ?? '';
    const result = await publishRelease({
      repository: env.GITHUB_REPOSITORY ?? '',
      tag,
      sha: env.GITHUB_SHA ?? '',
      tagObject: env.RELEASE_TAG_OBJECT ?? '',
      notes: releaseNotes(fs.readFileSync('CHANGELOG.md', 'utf8'), tag),
      token: env.GH_TOKEN ?? '',
    });
    console.log(`${tag}: ${result}; immutable release confirmed`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
