import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const RELEASE_KEY_FINGERPRINT = '353AAFB21CE81D843634AD3EDE52EEA6AF0D8779';

const requireTag = (tag: string): void => {
  if (!/^v\d+\.\d+\.\d+$/u.test(tag)) {
    throw new Error('Expected a version tag such as v2.0.0');
  }
};

const run = (command: string, args: string[], env = process.env): { stdout: string; stderr: string } => {
  const result = spawnSync(command, args, { encoding: 'utf8', env, timeout: 60_000 });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr.trim()}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
};

export const assertReleaseTagSignature = (status: string): void => {
  const lines = status.split(/\r?\n/u);
  if (lines.some((line) => /^\[GNUPG:\] (BADSIG|ERRSIG|EXPSIG|EXPKEYSIG|REVKEYSIG|NO_PUBKEY|FAILURE)\b/u.test(line))) {
    throw new Error('Release tag has an invalid, expired, or revoked signature');
  }
  const signatures = lines.filter((line) => line.startsWith('[GNUPG:] VALIDSIG '));
  if (signatures.length !== 1) {
    throw new Error('Expected exactly one valid OpenPGP tag signature');
  }
  const fields = signatures[0]?.slice('[GNUPG:] VALIDSIG '.length).trim().split(/\s+/u) ?? [];
  // GnuPG VALIDSIG ends with the primary fingerprint when a signing subkey is
  // used. Pin that identity, not a short key ID or a human-readable UID.
  const primaryFingerprint = fields[9] ?? fields[0];
  if ((fields.length !== 9 && fields.length !== 10) || primaryFingerprint !== RELEASE_KEY_FINGERPRINT) {
    throw new Error(`Release tag must be signed by ${RELEASE_KEY_FINGERPRINT}`);
  }
};

export const verifyReleaseTag = (tag: string): void => {
  requireTag(tag);
  const ref = `refs/tags/${tag}`;
  if (run('git', ['cat-file', '-t', ref]).stdout.trim() !== 'tag') {
    throw new Error(`Expected ${tag} to be an annotated tag`);
  }
  const tagObject = run('git', ['rev-parse', '--verify', ref]).stdout.trim();
  const keyring = fs.mkdtempSync(path.join(os.tmpdir(), 'release-tag-keyring-'));
  const env = { ...process.env, GNUPGHOME: keyring };
  try {
    run('gpg', ['--batch', '--no-options', '--homedir', keyring, '--import', 'keys/release-signing-key.asc'], env);
    const signature = run('git', [
      '-c', 'gpg.format=openpgp',
      '-c', 'gpg.program=gpg',
      '-c', 'gpg.openpgp.program=gpg',
      '-c', 'gpg.minTrustLevel=undefined',
      'verify-tag', '--raw', tagObject,
    ], env);
    assertReleaseTagSignature(signature.stderr);
  } finally {
    fs.rmSync(keyring, { recursive: true, force: true });
  }
};

const object = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

export const assertGitHubCommitSignature = (response: unknown, sha: string): void => {
  const commit = object(response);
  const metadata = object(commit.commit);
  const committer = object(metadata.committer);
  const verification = object(metadata.verification);
  if (commit.sha !== sha) {
    throw new Error('GitHub returned a different release commit SHA');
  }
  if (object(commit.committer).login !== 'web-flow' ||
      committer.name !== 'GitHub' || committer.email !== 'noreply@github.com') {
    throw new Error('Release commit must be created by GitHub web-flow');
  }
  if (verification.verified !== true || verification.reason !== 'valid' ||
      typeof verification.signature !== 'string' || !verification.signature.trim() ||
      typeof verification.payload !== 'string' || !verification.payload.trim()) {
    throw new Error('GitHub must report a valid signature for the exact release commit');
  }
};

export const assertReleaseCandidate = (pages: unknown, repository: string, sha: string, tag: string): void => {
  if (!Array.isArray(pages)) {
    throw new Error('Expected paginated release-candidate pull requests');
  }
  const pulls: unknown[] = pages.flatMap((page: unknown): unknown[] => {
    if (!Array.isArray(page)) {
      throw new Error('Expected a pull-request array in each API page');
    }
    return page as unknown[];
  });
  const matches = pulls.some((value) => {
    const pull = object(value);
    const base = object(pull.base);
    const head = object(pull.head);
    return pull.state === 'closed' && typeof pull.merged_at === 'string' && pull.merged_at !== '' &&
      pull.merge_commit_sha === sha && base.ref === 'main' &&
      object(base.repo).full_name === repository &&
      head.ref === `release-candidate/${tag}` && object(head.repo).full_name === repository;
  });
  if (!matches) {
    throw new Error(`${sha} is not the merge commit of ${repository}'s release-candidate/${tag} PR into main`);
  }
};

export const verifyReleaseCommit = (repository: string, sha: string, tag: string): void => {
  requireTag(tag);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) || !/^[0-9a-f]{40}$/u.test(sha)) {
    throw new Error('Expected owner/repo and an exact lowercase 40-character release commit SHA');
  }
  const endpoint = `/repos/${repository}/commits/${sha}`;
  const api = ['api', '--hostname', 'github.com', '-H', 'Accept: application/vnd.github+json'];
  const commit: unknown = JSON.parse(run('gh', [...api, endpoint]).stdout);
  assertGitHubCommitSignature(commit, sha);
  const pulls: unknown = JSON.parse(run('gh', [...api, '--paginate', '--slurp', `${endpoint}/pulls`]).stdout);
  assertReleaseCandidate(pulls, repository, sha, tag);
};

if (import.meta.main) {
  try {
    const [mode, first, sha, tag, ...extra] = process.argv.slice(2);
    if (mode === 'tag' && first && sha === undefined) {
      verifyReleaseTag(first);
      console.log(`Verified release tag ${first}`);
    } else if (mode === 'commit' && first && sha && tag && extra.length === 0) {
      verifyReleaseCommit(first, sha, tag);
      console.log(`Verified release-candidate merge commit ${sha}`);
    } else {
      throw new Error('Usage: node scripts/verify-release.ts tag <tag> | commit <owner/repo> <sha> <tag>');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
