import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RELEASE_KEY_FINGERPRINT,
  GITHUB_SIGNING_KEY_ID,
  assertGitHubCommitSignature,
  assertReleaseCandidate,
  assertReleaseTagSignature,
  verifyReleaseCommit,
  verifyReleaseTag,
} from './verify-release.js';

const { spawn } = vi.hoisted(() => ({
  spawn: vi.fn<(
    command: string,
    args: string[],
    options: SpawnSyncOptionsWithStringEncoding
  ) => Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr' | 'error'>>(),
}));
vi.mock('node:child_process', () => ({ spawnSync: spawn }));

const sha = 'a'.repeat(40);
const repository = 'thekbb/terraform-plan-commenter-action';
const tag = 'v2.0.1';
const signatureStatus = (signer = RELEASE_KEY_FINGERPRINT, primary = RELEASE_KEY_FINGERPRINT): string =>
  `[GNUPG:] VALIDSIG ${signer} 2026-09-05 1788600000 0 4 0 1 10 00 ${primary}\n`;
const commit = {
  oid: sha,
  signature: {
    __typename: 'GpgSignature', isValid: true, state: 'VALID', wasSignedByGitHub: true,
    signer: { login: 'web-flow' }, keyId: GITHUB_SIGNING_KEY_ID,
  },
};
const signatureResponse = (value: unknown = commit): unknown => ({ data: { repository: { object: value } } });
const pull = {
  state: 'closed',
  merged_at: '2026-09-05T12:00:00Z',
  merge_commit_sha: sha,
  base: { ref: 'main', repo: { full_name: repository } },
  head: { ref: `release-candidate/${tag}`, repo: { full_name: repository } },
};

beforeEach(() => {
  spawn.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('release tag signature policy', () => {
  it('accepts the documented primary key or one of its verified signing subkeys', () => {
    expect(() => { assertReleaseTagSignature(signatureStatus()); }).not.toThrow();
    expect(() => { assertReleaseTagSignature(signatureStatus('B'.repeat(40))); }).not.toThrow();
  });

  it('rejects a cryptographically valid signature from another primary key', () => {
    expect(() => { assertReleaseTagSignature(signatureStatus('B'.repeat(40), 'B'.repeat(40))); })
      .toThrow(RELEASE_KEY_FINGERPRINT);
  });

  it.each(['BADSIG', 'ERRSIG', 'EXPSIG', 'EXPKEYSIG', 'REVKEYSIG', 'NO_PUBKEY', 'FAILURE'])(
    'rejects %s even if VALIDSIG is also present', (status) => {
      expect(() => { assertReleaseTagSignature(`${signatureStatus()}[GNUPG:] ${status} key\n`); }).toThrow();
    }
  );

  it.each(['', 'gpg: Good signature from the maintainer', '[GNUPG:] VALIDSIG short', signatureStatus().repeat(2)])(
    'rejects missing, malformed, or ambiguous machine status', (status) => {
      expect(() => { assertReleaseTagSignature(status); }).toThrow();
    }
  );

  it('uses an isolated keyring and verifies the resolved annotated tag object', () => {
    vi.stubEnv('GNUPGHOME', '/untrusted/keyring');
    spawn.mockImplementation((command, args) => ({
      status: 0,
      stdout: command === 'git' && args[0] === 'cat-file' ? 'tag\n' : `${sha}\n`,
      stderr: args.includes('verify-tag') ? signatureStatus() : '',
    }));

    verifyReleaseTag(tag);

    expect(spawn.mock.calls[0]?.[1]).toEqual(['cat-file', '-t', `refs/tags/${tag}`]);
    const importCall = spawn.mock.calls.find(([command]) => command === 'gpg');
    const keyring = importCall?.[2].env?.GNUPGHOME;
    expect(keyring).toBeTypeOf('string');
    expect(keyring).not.toBe('/untrusted/keyring');
    expect(fs.existsSync(String(keyring))).toBe(false);
    const verifyCall = spawn.mock.calls.find(([, args]) => args.includes('verify-tag'));
    expect(verifyCall?.[1]).toContain('gpg.format=openpgp');
    expect(verifyCall?.[1].slice(-3)).toEqual(['verify-tag', '--raw', sha]);
    expect(verifyCall?.[2].env?.GNUPGHOME).toBe(keyring);
  });

  it('rejects a lightweight tag before importing keys', () => {
    spawn.mockReturnValue({ status: 0, stdout: 'commit\n', stderr: '' });
    expect(() => { verifyReleaseTag(tag); }).toThrow('annotated tag');
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('rejects verification command failure and removes its keyring', () => {
    spawn.mockImplementation((command, args) => ({
      status: args.includes('verify-tag') ? 1 : 0,
      stdout: command === 'git' && args[0] === 'cat-file' ? 'tag\n' : `${sha}\n`,
      stderr: args.includes('verify-tag') ? signatureStatus() : '',
    }));
    expect(() => { verifyReleaseTag(tag); }).toThrow('git failed');
    const keyring = spawn.mock.calls.find(([command]) => command === 'gpg')?.[2].env?.GNUPGHOME;
    expect(fs.existsSync(String(keyring))).toBe(false);
  });
});

describe('GitHub release commit policy', () => {
  it('accepts GitHub verification of the exact web-flow commit', () => {
    expect(() => { assertGitHubCommitSignature(signatureResponse(), sha); }).not.toThrow();
  });

  it('rejects a different SHA even when its signature is valid', () => {
    expect(() => { assertGitHubCommitSignature(signatureResponse({ ...commit, oid: 'b'.repeat(40) }), sha); })
      .toThrow('different');
  });

  it.each([
    { signer: null }, { signer: { login: 'someone-else' } }, { wasSignedByGitHub: false },
  ])('rejects signatures without GitHub web-flow signing origin', (override) => {
    const response = signatureResponse({ ...commit, signature: { ...commit.signature, ...override } });
    expect(() => { assertGitHubCommitSignature(response, sha); }).toThrow('web-flow');
  });

  it.each([
    { isValid: false }, { state: 'INVALID' }, { __typename: 'SshSignature' },
  ])('rejects invalid or missing signature evidence', (override) => {
    const response = signatureResponse({ ...commit, signature: { ...commit.signature, ...override } });
    expect(() => { assertGitHubCommitSignature(response, sha); }).toThrow('valid GPG signature');
  });

  it('rejects an otherwise valid GitHub signature from an unapproved key', () => {
    const response = signatureResponse({ ...commit, signature: { ...commit.signature, keyId: '0123456789ABCDEF' } });
    expect(() => { assertGitHubCommitSignature(response, sha); }).toThrow('approved GitHub signing key');
  });

  it.each([
    null, {}, { data: { repository: null } }, signatureResponse(null),
    signatureResponse({ ...commit, signature: null }),
    { data: { repository: { object: commit } }, errors: [{ message: 'Partial response' }] },
  ])('rejects missing signature evidence or GraphQL errors', (response) => {
    expect(() => { assertGitHubCommitSignature(response, sha); }).toThrow();
  });

  it('finds the release-candidate merge on a later API page', () => {
    expect(() => { assertReleaseCandidate([[], [pull]], repository, sha, tag); }).not.toThrow();
  });

  it.each([
    { ...pull, merged_at: null },
    { ...pull, merge_commit_sha: 'b'.repeat(40) },
    { ...pull, base: { ...pull.base, ref: 'develop' } },
    { ...pull, base: { ...pull.base, repo: { full_name: 'other/repo' } } },
    { ...pull, head: { ...pull.head, ref: 'release-candidate/v9.0.0' } },
    { ...pull, head: { ...pull.head, repo: { full_name: 'fork/repo' } } },
  ])('rejects a PR that is not the exact merged release candidate', (response) => {
    expect(() => { assertReleaseCandidate([[response]], repository, sha, tag); }).toThrow('not the merge commit');
  });

  it.each([{ pages: [] }, { pages: null }, { pages: {} }, { pages: [null] }])(
    'rejects missing or malformed PR evidence', ({ pages }) => {
      expect(() => { assertReleaseCandidate(pages, repository, sha, tag); }).toThrow();
    }
  );

  it('pins API calls to github.com and uses only the supplied SHA', () => {
    vi.stubEnv('GH_HOST', 'untrusted.example');
    spawn.mockImplementation((_command, args) => ({
      status: 0,
      stdout: JSON.stringify(args.includes('--paginate') ? [[pull]] : signatureResponse()),
      stderr: '',
    }));

    verifyReleaseCommit(repository, sha, tag);

    expect(spawn).toHaveBeenCalledTimes(2);
    for (const [command, args] of spawn.mock.calls) {
      expect(command).toBe('gh');
      expect(args.slice(0, 3)).toEqual(['api', '--hostname', 'github.com']);
    }
    const signatureArgs = spawn.mock.calls[0]?.[1];
    expect(signatureArgs).toContain('graphql');
    expect(signatureArgs).toContain('owner=thekbb');
    expect(signatureArgs).toContain('name=terraform-plan-commenter-action');
    expect(signatureArgs).toContain(`oid=${sha}`);
    expect(signatureArgs?.find((arg) => arg.startsWith('query='))).toContain('object(oid: $oid)');
    expect(spawn.mock.calls[1]?.[1].at(-1)).toBe(`/repos/${repository}/commits/${sha}/pulls`);
    expect(spawn.mock.calls[1]?.[1]).toContain('--slurp');
  });

  it('stops before PR lookup when the signature policy fails', () => {
    spawn.mockReturnValue({ status: 0, stdout: JSON.stringify(signatureResponse({ ...commit, signature: null })), stderr: '' });
    expect(() => { verifyReleaseCommit(repository, sha, tag); }).toThrow('valid GPG signature');
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('fails closed when the API is unavailable', () => {
    spawn.mockReturnValue({ status: 1, stdout: '', stderr: 'API unavailable' });
    expect(() => { verifyReleaseCommit(repository, sha, tag); }).toThrow('API unavailable');
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('rejects ambiguous refs and malformed arguments before launching commands', () => {
    expect(() => { verifyReleaseCommit(repository, 'main', tag); }).toThrow('exact');
    expect(() => { verifyReleaseCommit('github.example/owner/repo', sha, tag); }).toThrow('owner/repo');
    expect(() => { verifyReleaseTag('--help'); }).toThrow('version tag');
    expect(spawn).not.toHaveBeenCalled();
  });
});
