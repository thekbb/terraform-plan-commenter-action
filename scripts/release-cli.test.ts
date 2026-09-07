import { describe, expect, it, vi } from 'vitest';
import { findCandidate, parseReleaseArgs, runRelease, type ReleaseRuntime } from './release-cli.ts';
import { RELEASE_KEY_FINGERPRINT } from './verify-release.ts';

const repository = 'thekbb/terraform-plan-commenter-action';
const version = '2.1.0';
const tag = `v${version}`;
const sha = 'a'.repeat(40);
const main = 'b'.repeat(40);
const oldMajor = 'c'.repeat(40);
const tagObject = 'd'.repeat(40);
const majorObject = 'e'.repeat(40);
const oldCommit = 'f'.repeat(40);
const origin = `https://github.com/${repository}.git`;
const pr = (merged = true) => ({
  html_url: `https://github.com/${repository}/pull/123`, state: merged ? 'closed' : 'open',
  merged_at: merged ? '2026-09-06T12:00:00Z' : null, merge_commit_sha: sha,
  head: { ref: `release-candidate/${tag}`, repo: { full_name: repository } },
  base: { ref: 'main', repo: { full_name: repository } },
});

interface Scenario {
  prepare?: boolean;
  dirty?: boolean;
  wrongOrigin?: boolean;
  unmerged?: boolean;
  badVersion?: boolean;
  remoteTag?: string;
  localTag?: string;
  wrongTagCommit?: boolean;
  failedWorkflow?: boolean;
  mutableRelease?: boolean;
  badProvenance?: boolean;
  versionRace?: boolean;
  majorRace?: boolean;
  alreadyReleased?: boolean;
  noMajor?: boolean;
  noRun?: boolean;
}

const fixture = (scenario: Scenario = {}) => {
  let pull = scenario.prepare ? undefined : pr(!scenario.unmerged);
  let remoteTag = scenario.remoteTag ?? '';
  let localTag = scenario.localTag ?? '';
  let remoteMajor = scenario.noMajor ? '' : oldMajor;
  let localMajor = oldMajor;
  const run = vi.fn<ReleaseRuntime['run']>((command, args) => {
    let output = '';
    if (command === 'gh') {
      if (args[0] === 'api') {
        const endpoint = args.at(-1) ?? '';
        if (endpoint.includes('/pulls?')) output = JSON.stringify([pull ? [pull] : []]);
        else if (endpoint.includes('/runs?')) {
          const preparing = endpoint.includes('prepare-release.yml');
          output = JSON.stringify({ workflow_runs: scenario.noRun ? [] : [{ id: preparing ? 1 : 2,
            display_title: preparing ? `Prepare ${tag} request-123` : `Release ${tag}`,
            event: preparing ? 'workflow_dispatch' : 'push', head_sha: sha, head_branch: 'main' }] });
        } else throw new Error(`Unexpected API: ${endpoint}`);
      } else if (args[0] === 'workflow') pull = pr(false);
      else if (args[0] === 'run') {
        if (scenario.failedWorkflow) throw new Error('workflow failed');
      } else if (args[0] === 'release') {
        output = JSON.stringify({ tagName: tag, isDraft: false, isImmutable: !scenario.mutableRelease,
          url: `https://github.com/${repository}/releases/tag/${tag}` });
      } else if (args[0] !== 'auth') throw new Error('Unexpected gh command');
    } else if (command === 'gpg') output = `fpr:::::::::${RELEASE_KEY_FINGERPRINT}:`;
    else if (command === 'git') {
      const gitArgs = args[0] === '-c' ? args.slice(6) : args;
      const [operation, ...rest] = gitArgs;
      if (operation === 'remote') output = scenario.wrongOrigin ? 'https://github.com/someone/fork.git' : origin;
      else if (operation === 'branch') output = 'main';
      else if (operation === 'status') output = scenario.dirty ? '?? local-file' : '';
      else if (operation === 'rev-parse') {
        const ref = rest[0];
        if (ref === '--show-prefix') output = '';
        else if (ref === 'HEAD' || ref === 'origin/main') output = main;
        else if (ref === 'FETCH_HEAD') output = oldMajor;
        else if (ref === 'FETCH_HEAD^{commit}') output = scenario.alreadyReleased ? sha : oldCommit;
        else if (ref === `refs/tags/${tag}^{commit}`) output = scenario.wrongTagCommit ? oldCommit : sha;
        else if (ref === `refs/tags/${tag}`) output = localTag;
        else if (ref === 'refs/tags/v2') output = localMajor;
        else throw new Error(`Unexpected ref: ${ref ?? ''}`);
      } else if (operation === 'ls-remote') {
        const ref = rest.at(-1);
        const oid = ref === `refs/tags/${tag}` ? remoteTag : ref === 'refs/tags/v2' ? remoteMajor : '';
        output = oid ? `${oid}\t${ref ?? ''}` : '';
      } else if (operation === 'tag') {
        if (rest[0] === '--list') output = localTag;
        else if (rest.includes('-f')) localMajor = majorObject;
        else localTag = tagObject;
      } else if (operation === 'fetch') {
        if (rest.at(-1) === `refs/tags/${tag}:refs/tags/${tag}`) localTag = remoteTag;
      } else if (operation === 'show') {
        const file = rest[0] ?? '';
        const v = scenario.badVersion ? '9.9.9' : version;
        if (file.endsWith(':package.json')) output = JSON.stringify({ version: v });
        else if (file.endsWith(':package-lock.json')) output = JSON.stringify({ version: v, packages: { '': { version: v } } });
        else output = `# Changelog\n\n## [${version}] - 2026-09-06\n\nRelease notes.\n`;
      } else if (operation === 'push') {
        if (rest.at(-1) === `refs/tags/${tag}`) remoteTag = localTag;
        else remoteMajor = localMajor;
      } else if (operation === 'cat-file') output = 'tag';
      else if (operation === 'verify-tag') return { stdout: '', stderr: `[GNUPG:] VALIDSIG ${RELEASE_KEY_FINGERPRINT} 2026-09-06 1788652800 0 4 0 1 10 00 ${RELEASE_KEY_FINGERPRINT}\n` };
      else if (operation !== 'merge' && operation !== 'merge-base' && operation !== 'diff') {
        throw new Error(`Unexpected git command: ${operation ?? ''}`);
      }
    } else if (command === 'bash') {
      if (scenario.badProvenance) throw new Error('provenance verification failed');
      if (scenario.versionRace) remoteTag = '8'.repeat(40);
      if (scenario.majorRace) remoteMajor = '9'.repeat(40);
    } else if (command !== process.execPath) throw new Error(`Unexpected command: ${command}`);
    return { stdout: output, stderr: '' };
  });
  const log = vi.fn<ReleaseRuntime['log']>();
  const verifyCommit = vi.fn<ReleaseRuntime['verifyCommit']>();
  const verifyTag = vi.fn<ReleaseRuntime['verifyTag']>();
  const runtime: ReleaseRuntime = { run, log, verifyCommit, verifyTag,
    pause: () => Promise.resolve(), confirm: () => Promise.resolve(false), requestId: () => 'request-123' };
  const mutations = () => run.mock.calls.filter(([command, args]) => command === 'git' &&
    (args[0] === 'push' || (args[0] === '-c' && args.includes('tag'))));
  return { runtime, run, log, verifyCommit, verifyTag, mutations, mergeCandidate: () => { pull = pr(); } };
};

describe('release command', () => {
  it('accepts a version and an explicit resume mode', () => {
    expect(parseReleaseArgs([version])).toEqual({ version, resume: false });
    expect(parseReleaseArgs([version, '--continue'])).toEqual({ version, resume: true });
  });

  it.each([
    { args: [] },
    { args: ['v2.1.0'] },
    { args: ['2.01.0'] },
    { args: [version, '--force'] },
    { args: [version, '--continue', '--continue'] },
  ])(
    'rejects invalid or ambiguous arguments ($args)', ({ args }) => {
      expect(() => parseReleaseArgs(args)).toThrow('Usage:');
    }
  );

  it('dispatches a correlated preparation run and stops for PR review without signing', async () => {
    const f = fixture({ prepare: true });
    await runRelease({ version, resume: false }, f.runtime);
    expect(f.run).toHaveBeenCalledWith('gh', expect.arrayContaining(['workflow', 'run', '--ref', 'main', 'request-id=request-123']));
    expect(f.run).toHaveBeenCalledWith('gh', expect.arrayContaining(['run', 'watch', '1', '--exit-status']), expect.any(Object));
    expect(f.log).toHaveBeenCalledWith(expect.stringContaining('Resume later with: npm run release -- 2.1.0 --continue'));
    expect(f.mutations()).toEqual([]);
  });

  it('reuses an open candidate instead of dispatching another preparation', async () => {
    const f = fixture({ unmerged: true });
    await runRelease({ version, resume: false }, f.runtime);
    expect(f.run.mock.calls.some(([command, args]) => command === 'gh' && args[0] === 'workflow')).toBe(false);
    expect(f.mutations()).toEqual([]);
  });

  it('signs the candidate merge SHA and moves the major tag only after verification', async () => {
    const f = fixture();
    await runRelease({ version, resume: true }, f.runtime);
    expect(f.verifyCommit).toHaveBeenCalledWith(repository, sha, tag);
    expect(f.verifyTag).toHaveBeenCalledWith(tag);
    expect(f.run).toHaveBeenCalledWith('git', expect.arrayContaining(['tag', '-s', RELEASE_KEY_FINGERPRINT, tag, sha]), expect.any(Object));
    const calls = f.run.mock.calls;
    const consumerCheck = calls.findIndex(([command]) => command === 'bash');
    const majorPush = calls.findIndex(([command, args]) => command === 'git' && args.includes(`--force-with-lease=refs/tags/v2:${oldMajor}`));
    expect(consumerCheck).toBeGreaterThan(-1);
    expect(majorPush).toBeGreaterThan(consumerCheck);
    expect(f.log).toHaveBeenCalledWith(expect.stringContaining(`Commit: ${sha}`));
  });

  it('rechecks the candidate after the interactive review pause', async () => {
    const f = fixture({ unmerged: true });
    f.runtime.confirm = () => { f.mergeCandidate(); return Promise.resolve(true); };
    await runRelease({ version, resume: false }, f.runtime);
    expect(f.verifyCommit).toHaveBeenCalledWith(repository, sha, tag);
    expect(f.run).toHaveBeenCalledWith('git', ['merge', '--ff-only', 'origin/main']);
    expect(f.log).toHaveBeenCalledWith(expect.stringContaining('Released v2.1.0:'));
  });

  it('uses an explicit empty lease when creating the first major tag', async () => {
    const f = fixture({ noMajor: true });
    await runRelease({ version, resume: true }, f.runtime);
    expect(f.run).toHaveBeenCalledWith('git', ['push', '--force-with-lease=refs/tags/v2:', 'origin', 'refs/tags/v2']);
  });

  it('resumes a published release without rewriting existing matching tags', async () => {
    const f = fixture({ alreadyReleased: true, remoteTag: tagObject, localTag: tagObject });
    await runRelease({ version, resume: true }, f.runtime);
    expect(f.mutations()).toEqual([]);
    expect(f.log).toHaveBeenCalledWith('v2 already points to this release.');
  });

  it.each([
    { scenario: { dirty: true }, message: 'Working tree must be clean' },
    { scenario: { wrongOrigin: true }, message: 'Both origin URLs' },
    { scenario: { unmerged: true }, message: 'must be merged' },
    { scenario: { badVersion: true }, message: 'versions must match' },
    { scenario: { remoteTag: tagObject, localTag: majorObject }, message: 'tags conflict' },
    { scenario: { localTag: tagObject, wrongTagCommit: true }, message: 'does not point' },
  ])('stops before tag writes for $message', async ({ scenario, message }) => {
    const f = fixture(scenario);
    await expect(runRelease({ version, resume: true }, f.runtime)).rejects.toThrow(message);
    expect(f.mutations()).toEqual([]);
  });

  it('requires existing commit-signature verification before signing', async () => {
    const f = fixture();
    f.verifyCommit.mockImplementation(() => { throw new Error('unapproved signer'); });
    await expect(runRelease({ version, resume: true }, f.runtime)).rejects.toThrow('unapproved signer');
    expect(f.mutations()).toEqual([]);
  });

  it('does not push a version tag if signature verification fails', async () => {
    const f = fixture({ localTag: tagObject });
    f.verifyTag.mockImplementation(() => { throw new Error('wrong tag signature'); });
    await expect(runRelease({ version, resume: true }, f.runtime)).rejects.toThrow('wrong tag signature');
    expect(f.mutations()).toEqual([]);
  });

  it.each([
    { scenario: { failedWorkflow: true }, message: 'workflow failed' },
    { scenario: { mutableRelease: true }, message: 'not confirmed immutable' },
    { scenario: { badProvenance: true }, message: 'provenance verification failed' },
    { scenario: { versionRace: true }, message: 'Version tag changed during publication' },
    { scenario: { majorRace: true }, message: 'Another release changed' },
    { scenario: { noRun: true }, message: 'Could not find Release' },
  ])('does not move the major tag when $message', async ({ scenario, message }) => {
    const f = fixture(scenario);
    await expect(runRelease({ version, resume: true }, f.runtime)).rejects.toThrow(message);
    expect(f.mutations().some(([, args]) => args.includes('v2') || args.includes('refs/tags/v2'))).toBe(false);
  });
});

describe('release candidate lookup', () => {
  it('requires one exact same-repository PR into main', () => {
    expect(findCandidate([[pr()]], tag)?.sha).toBe(sha);
    expect(findCandidate([[]], tag)).toBeUndefined();
    expect(findCandidate([[{ ...pr(), head: { ref: `release-candidate/${tag}`, repo: { full_name: 'someone/fork' } } }]], tag)).toBeUndefined();
    expect(() => findCandidate([[pr(), pr()]], tag)).toThrow('Multiple release-candidate');
    expect(() => findCandidate({}, tag)).toThrow('Expected paginated');
  });
});
