import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

class ProvenanceError extends Error {}

export interface Provenance {
  repository: string;
  tag: string;
  sha: string;
  root: string;
}

export const runtimeFiles = (root: string): string[] => {
  const directory = path.resolve(root, 'dist');
  if (!fs.lstatSync(directory).isDirectory()) {
    throw new ProvenanceError('Expected dist to be a real directory, not a symlink');
  }
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  if (entries.length === 0 || entries.some((entry) => !entry.isFile() || !/^[A-Za-z0-9_-]+\.js$/u.test(entry.name))) {
    throw new ProvenanceError('Expected a nonempty dist directory containing only regular JavaScript runtime files');
  }
  return entries.map((entry) => path.join(directory, entry.name)).sort();
};

export const verifyRuntimeProvenance = async (input: Provenance): Promise<void> => {
  const { repository, tag, sha, root } = input;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) ||
      !/^v\d+\.\d+\.\d+$/u.test(tag) || !/^[0-9a-f]{40}$/u.test(sha)) {
    throw new ProvenanceError('Provenance verification requires owner/repo, a version tag, and an exact lowercase commit SHA');
  }
  const files = runtimeFiles(root);
  for (const file of files) {
    const args = [
      'attestation', 'verify', file,
      '--hostname', 'github.com',
      '--repo', repository,
      '--signer-digest', sha,
      '--source-ref', `refs/tags/${tag}`,
      '--source-digest', sha,
      // The exact certificate identity pins both workflow and tag. gh rejects
      // combining it with --signer-workflow (or other identity selectors).
      '--cert-identity', `https://github.com/${repository}/.github/workflows/release.yml@refs/tags/${tag}`,
      '--cert-oidc-issuer', 'https://token.actions.githubusercontent.com',
      '--deny-self-hosted-runners',
      '--predicate-type', 'https://slsa.dev/provenance/v1',
    ];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      // gh verifies the file digest and certificate policy, not just predicate
      // claims. Never log its raw output: CLI errors may contain credentials.
      const result = spawnSync('gh', args, {
        encoding: 'utf8', timeout: 15_000,
        env: { ...process.env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1' },
      });
      if (result.error) {
        throw new ProvenanceError('Could not run gh attestation verify within 15 seconds; check GitHub CLI installation and connectivity');
      }
      if (result.status === 0) break;
      if (result.stderr.includes('unknown flag:') || result.stderr.includes('unknown shorthand flag:') ||
          (result.stderr.includes('if any flags in the group [') &&
           result.stderr.includes('are set none of the others can be'))) {
        throw new ProvenanceError(
          'GitHub CLI rejected the provenance verification arguments; check for conflicting flags or update gh to support the required options'
        );
      }
      if (attempt === 5) {
        throw new ProvenanceError(
          `Provenance verification failed for dist/${path.basename(file)} after 5 attempts (gh exit ${String(result.status)}); ` +
          'check CLI support, authentication, attestation availability, and release identity before retrying'
        );
      }
      console.warn(`Provenance for dist/${path.basename(file)} not verified; retrying (${String(attempt)}/5)`);
      await delay(2000);
    }
  }
  console.log(`Verified provenance for ${String(files.length)} runtime files at ${tag} (${sha})`);
};

if (import.meta.main) {
  try {
    const [repository, tag, sha, root = '.', ...extra] = process.argv.slice(2);
    if (!repository || !tag || !sha || extra.length !== 0) {
      throw new ProvenanceError('Usage: node scripts/verify-provenance.ts <owner/repo> <tag> <sha> [checkout-directory]');
    }
    await verifyRuntimeProvenance({ repository, tag, sha, root });
  } catch (error) {
    console.error(error instanceof ProvenanceError ? error.message :
      'Cannot inspect runtime files for provenance verification; check the checkout and file permissions');
    process.exitCode = 1;
  }
}
