import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  RELEASE_KEY_FINGERPRINT,
  assertReleaseTagSignature,
  verifyReleaseCommit,
  verifyReleaseTag,
} from './verify-release.ts';
import { releaseNotes } from './publish-release.ts';

const REPOSITORY = 'thekbb/terraform-plan-commenter-action';
const REPO_FLAG = ['--repo', `github.com/${REPOSITORY}`];
const USAGE = 'Usage: npm run release -- VERSION [--continue]';

interface CommandOptions {
  readonly interactive?: boolean;
  readonly timeout?: number;
}

export interface ReleaseRuntime {
  run(command: string, args: string[], options?: CommandOptions): { stdout: string; stderr: string };
  log(message: string): void;
  pause(): Promise<void>;
  confirm(): Promise<boolean>;
  requestId(): string;
  verifyCommit(repository: string, sha: string, tag: string): void;
  verifyTag(tag: string): void;
}

export interface ReleaseArgs {
  readonly version: string;
  readonly resume: boolean;
}

export const parseReleaseArgs = (args: string[]): ReleaseArgs => {
  const [version, mode] = args;
  if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version) ||
      args.length > 2 || (mode !== undefined && mode !== '--continue')) {
    throw new Error(USAGE);
  }
  return { version, resume: mode === '--continue' };
};

const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('GitHub or release metadata returned an unexpected response.');
  }
  return value as Record<string, unknown>;
};

const json = (text: string): unknown => JSON.parse(text);

interface Candidate {
  readonly url: string;
  readonly merged: boolean;
  readonly open: boolean;
  readonly sha: string | null;
}

export const findCandidate = (response: unknown, tag: string): Candidate | undefined => {
  if (!Array.isArray(response) || !response.every(Array.isArray)) {
    throw new Error('Expected paginated release-candidate PRs.');
  }
  const pulls: unknown[] = response.flat();
  const matches = pulls.map(object).filter((pull) => {
    const head = object(pull.head);
    const base = object(pull.base);
    return head.ref === `release-candidate/${tag}` && base.ref === 'main' &&
      object(head.repo).full_name === REPOSITORY && object(base.repo).full_name === REPOSITORY;
  });
  if (matches.length > 1) throw new Error('Multiple release-candidate PRs match; resolve the ambiguity before releasing.');
  const pull = matches[0];
  if (!pull) return undefined;
  if (typeof pull.html_url !== 'string' || (pull.state !== 'open' && pull.state !== 'closed') ||
      (pull.merged_at !== null && typeof pull.merged_at !== 'string') ||
      (pull.merge_commit_sha !== null && typeof pull.merge_commit_sha !== 'string')) {
    throw new Error('Release-candidate PR has incomplete metadata.');
  }
  return { url: pull.html_url, open: pull.state === 'open', merged: pull.state === 'closed' && !!pull.merged_at,
    sha: pull.merge_commit_sha };
};

export async function runRelease(args: ReleaseArgs, runtime: ReleaseRuntime): Promise<void> {
  const { version } = args;
  const tag = `v${version}`;
  const major = `v${version.split('.')[0] ?? ''}`;
  const branch = `release-candidate/${tag}`;
  const read = (command: string, commandArgs: string[]): string => runtime.run(command, commandArgs).stdout.trim();
  const git = (...commandArgs: string[]): string => read('git', commandArgs);
  const api = (endpoint: string, extra: string[] = []): unknown => json(read('gh', [
    'api', '--hostname', 'github.com', ...extra, endpoint,
  ]));
  const remoteRef = (ref: string): string => {
    const result = git('ls-remote', '--refs', 'origin', ref);
    if (result === '') return '';
    const [oid, name, ...extra] = result.split(/\s+/u);
    if (!oid || !/^[0-9a-f]{40}$/u.test(oid) || name !== ref || extra.length !== 0) {
      throw new Error('Unexpected remote reference response.');
    }
    return oid;
  };
  const candidate = (): Candidate | undefined => findCandidate(api(
    `repos/${REPOSITORY}/pulls?state=all&head=thekbb:${branch}&base=main&per_page=100`,
    ['--paginate', '--slurp']
  ), tag);
  const waitForRun = async (workflow: string, title: string, event: string, sha?: string): Promise<string> => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = object(api(`repos/${REPOSITORY}/actions/workflows/${workflow}/runs?event=${event}&per_page=100`));
      if (!Array.isArray(response.workflow_runs)) throw new Error('GitHub omitted workflow runs.');
      const runs: unknown[] = response.workflow_runs;
      const run = runs.map(object).find((item) => item.display_title === title &&
        item.event === event && (sha === undefined ? item.head_branch === 'main' : item.head_sha === sha));
      if (run) {
        if (typeof run.id !== 'number' || !Number.isSafeInteger(run.id) || run.id <= 0) {
          throw new Error('GitHub returned an invalid workflow run ID.');
        }
        return String(run.id);
      }
      await runtime.pause();
    }
    throw new Error(`Could not find ${title}. Check GitHub Actions before retrying; no tag will be moved to recover.`);
  };
  const watch = (run: string): void => {
    runtime.run('gh', ['run', 'watch', run, ...REPO_FLAG, '--exit-status'], { interactive: true, timeout: 1_800_000 });
  };
  const verifyTagObject = (ref: string): void => {
    if (git('cat-file', '-t', ref) !== 'tag') throw new Error('Expected a signed annotated major tag.');
    const result = runtime.run('git', ['-c', 'gpg.format=openpgp', '-c', 'gpg.program=gpg',
      '-c', 'gpg.openpgp.program=gpg', 'verify-tag', '--raw', ref]);
    assertReleaseTagSignature(result.stderr);
  };

  read('gh', ['auth', 'status', '--hostname', 'github.com']);
  const allowedOrigins = [`https://github.com/${REPOSITORY}`, `https://github.com/${REPOSITORY}.git`,
    `git@github.com:${REPOSITORY}.git`, `git@github.com:${REPOSITORY}`, `ssh://git@github.com/${REPOSITORY}.git`];
  if (!allowedOrigins.includes(git('remote', 'get-url', '--all', 'origin')) ||
      !allowedOrigins.includes(git('remote', 'get-url', '--push', '--all', 'origin'))) {
    throw new Error(`Both origin URLs must point to github.com/${REPOSITORY}.`);
  }
  if (git('rev-parse', '--show-prefix') !== '' || git('branch', '--show-current') !== 'main') {
    throw new Error('Run the release command from the repository root on main.');
  }
  if (git('status', '--porcelain') !== '') throw new Error('Working tree must be clean before releasing.');
  git('fetch', '--no-tags', 'origin', 'main:refs/remotes/origin/main');
  if (args.resume) git('merge', '--ff-only', 'origin/main');
  else if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
    throw new Error('Update local main to origin/main before preparing a release.');
  }
  const keys = read('gpg', ['--batch', '--with-colons', '--list-secret-keys', RELEASE_KEY_FINGERPRINT]);
  if (!keys.split('\n').some((line) => line.startsWith('fpr:') && line.split(':')[9] === RELEASE_KEY_FINGERPRINT)) {
    throw new Error('The documented release signing key is not available locally.');
  }

  let pull = candidate();
  if (!args.resume) {
    if (pull?.merged) throw new Error(`Candidate is already merged. Run npm run release -- ${version} --continue.`);
    if (pull && !pull.open) throw new Error('The release-candidate PR was closed without merging.');
    if (!pull) {
      if (remoteRef(`refs/tags/${tag}`) || git('tag', '--list', tag)) throw new Error('Version tag already exists. Use --continue or choose a new version.');
      if (remoteRef(`refs/heads/${branch}`)) throw new Error('Candidate branch exists without a matching PR; inspect it before retrying.');
      runtime.run(process.execPath, ['scripts/release.mjs', '--check', version], { interactive: true });
      const requestId = runtime.requestId();
      runtime.log(`Preparing ${tag} on GitHub.`);
      read('gh', ['workflow', 'run', 'prepare-release.yml', ...REPO_FLAG, '--ref', 'main',
        '-f', `version=${version}`, '-f', `request-id=${requestId}`]);
      watch(await waitForRun('prepare-release.yml', `Prepare ${tag} ${requestId}`, 'workflow_dispatch'));
      pull = candidate();
      if (!pull?.open) throw new Error('Preparation finished without an open release-candidate PR. Inspect the workflow run.');
    }
    runtime.log(`Review and merge the release-candidate PR:\n${pull.url}\nResume later with: npm run release -- ${version} --continue`);
    if (!await runtime.confirm()) return;
    // Recheck the working tree and remote state after the review pause.
    await runRelease({ version, resume: true }, runtime);
    return;
  }

  if (!pull?.merged || !pull.sha || !/^[0-9a-f]{40}$/u.test(pull.sha)) {
    throw new Error('The exact release-candidate PR must be merged before continuing.');
  }
  const sha = pull.sha;
  git('merge-base', '--is-ancestor', sha, 'origin/main');
  git('diff', '--exit-code', sha, 'origin/main', '--', '.github/workflows');
  runtime.verifyCommit(REPOSITORY, sha, tag);
  const pkg = object(json(git('show', `${sha}:package.json`)));
  const lock = object(json(git('show', `${sha}:package-lock.json`)));
  if (pkg.version !== version || lock.version !== version || object(object(lock.packages)['']).version !== version) {
    throw new Error('Candidate package and lockfile versions must match the requested release.');
  }
  releaseNotes(git('show', `${sha}:CHANGELOG.md`), tag);

  // Snapshot before publication so another release cannot silently lose its major tag.
  const majorRef = `refs/tags/${major}`;
  const previousMajor = remoteRef(majorRef);
  let previousMajorCommit = '';
  if (previousMajor) {
    git('fetch', '--no-tags', 'origin', majorRef);
    if (git('rev-parse', 'FETCH_HEAD') !== previousMajor) throw new Error('Major tag changed while fetching it. Retry after inspecting the remote.');
    previousMajorCommit = git('rev-parse', 'FETCH_HEAD^{commit}');
    git('merge-base', '--is-ancestor', previousMajorCommit, sha);
  }

  const ref = `refs/tags/${tag}`;
  const remoteTag = remoteRef(ref);
  const localTag = git('tag', '--list', tag, '--format=%(objectname)');
  if (remoteTag) {
    if (localTag && localTag !== remoteTag) throw new Error('Local and remote version tags conflict; neither was overwritten.');
    git('fetch', '--no-tags', 'origin', `${ref}:${ref}`);
  } else if (!localTag) {
    runtime.run('git', ['-c', 'gpg.format=openpgp', '-c', 'gpg.program=gpg', '-c', 'gpg.openpgp.program=gpg',
      'tag', '-s', '-u', RELEASE_KEY_FINGERPRINT, '-m', `Release ${tag}`, tag, sha], { interactive: true });
  }
  if (git('rev-parse', `${ref}^{commit}`) !== sha) throw new Error('Version tag does not point to the release-candidate merge commit.');
  runtime.verifyTag(tag);
  const tagObject = git('rev-parse', ref);
  if (!remoteTag) git('push', 'origin', ref);
  if (remoteRef(ref) !== tagObject) throw new Error('Remote version tag does not match the verified local tag.');

  runtime.log(`Waiting for verification and publication of ${tag}.`);
  watch(await waitForRun('release.yml', `Release ${tag}`, 'push', sha));
  runtime.run('bash', ['./verify-release.sh', '--tag', tag], { interactive: true, timeout: 600_000 });
  const release = object(json(read('gh', ['release', 'view', tag, ...REPO_FLAG, '--json', 'tagName,isDraft,isImmutable,url'])));
  if (release.tagName !== tag || release.isDraft !== false || release.isImmutable !== true || typeof release.url !== 'string') {
    throw new Error('Publication is not confirmed immutable; the major tag was not moved.');
  }
  if (remoteRef(ref) !== tagObject) throw new Error('Version tag changed during publication; the major tag was not moved.');
  if (remoteRef(majorRef) !== previousMajor) throw new Error('Another release changed the major tag. Inspect it before retrying.');

  if (previousMajorCommit === sha) {
    verifyTagObject(previousMajor);
    runtime.log(`${major} already points to this release.`);
  } else {
    runtime.run('git', ['-c', 'gpg.format=openpgp', '-c', 'gpg.program=gpg', '-c', 'gpg.openpgp.program=gpg',
      'tag', '-f', '-s', '-u', RELEASE_KEY_FINGERPRINT, '-m', `Release ${tag}`, major, sha], { interactive: true });
    verifyTagObject(majorRef);
    git('push', `--force-with-lease=${majorRef}:${previousMajor}`, 'origin', majorRef);
    if (remoteRef(majorRef) !== git('rev-parse', majorRef)) throw new Error('Remote major tag does not match the signed local tag.');
  }
  runtime.log(`Released ${tag}: ${release.url}\nCommit: ${sha}\nMajor tag: ${major}`);
}

const runtime: ReleaseRuntime = {
  run(command, args, options = {}) {
    const result = spawnSync(command, args, {
      encoding: 'utf8', timeout: options.timeout ?? 60_000,
      stdio: options.interactive ? 'inherit' : 'pipe',
      env: { ...process.env, GH_HOST: 'github.com', GH_REPO: REPOSITORY,
        REPO_URL: `https://github.com/${REPOSITORY}.git`, GITHUB_REPOSITORY: REPOSITORY,
        GITHUB_API_URL: 'https://api.github.com' },
    });
    if (result.error || result.status !== 0) {
      throw new Error(`${command} ${args[0] ?? ''} failed${result.status === null ? '' : ` (exit ${String(result.status)})`}. Check the command or workflow output before retrying.`);
    }
    return { stdout: options.interactive ? '' : result.stdout, stderr: options.interactive ? '' : result.stderr };
  },
  log: (message) => { console.log(message); },
  pause: async () => { await delay(2000); },
  async confirm() {
    if (!process.stdin.isTTY) return false;
    const input = createInterface({ input: process.stdin, output: process.stdout });
    try { await input.question('Press Enter after merging the PR, or Ctrl-C to resume later. '); }
    finally { input.close(); }
    return true;
  },
  requestId: randomUUID,
  verifyCommit: verifyReleaseCommit,
  verifyTag: verifyReleaseTag,
};

if (import.meta.main) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--help') console.log(USAGE);
    else await runRelease(parseReleaseArgs(process.argv.slice(2)), runtime);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Release failed.');
    process.exitCode = 1;
  }
}
