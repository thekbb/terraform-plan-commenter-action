import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const version = args.find((arg) => !arg.startsWith('-'));

if (!version) {
  console.error('Usage: npm run release[:check] -- <version>');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid version "${version}". Use semver like 1.2.3.`);
  process.exit(1);
}

const repoRoot = process.cwd();
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
const packageJsonPath = path.join(repoRoot, 'package.json');
const packageLockPath = path.join(repoRoot, 'package-lock.json');

const readText = (filePath) => fs.readFileSync(filePath, 'utf8');
const writeText = (filePath, text) => fs.writeFileSync(filePath, text);

const git = (...gitArgs) => execFileSync('git', gitArgs, {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const updateJsonVersion = (filePath, nextVersion) => {
  const json = JSON.parse(readText(filePath));
  json.version = nextVersion;
  if (json.packages?.['']) {
    json.packages[''].version = nextVersion;
  }
  writeText(filePath, `${JSON.stringify(json, null, 2)}\n`);
};

const updateChangelog = (source, nextVersion) => {
  const unreleasedHeader = '## [Unreleased]';
  const unreleasedIndex = source.indexOf(unreleasedHeader);
  if (unreleasedIndex === -1) {
    throw new Error('CHANGELOG.md is missing the Unreleased section.');
  }

  const nextSectionIndex = source.indexOf('\n## [', unreleasedIndex + unreleasedHeader.length);
  if (nextSectionIndex === -1) {
    throw new Error('CHANGELOG.md is missing the first released version section.');
  }

  const unreleasedBody = source
    .slice(unreleasedIndex + unreleasedHeader.length, nextSectionIndex)
    .trim();

  if (!unreleasedBody) {
    throw new Error('CHANGELOG.md Unreleased section is empty.');
  }

  const releasedVersions = [...source.matchAll(/^## \[(?!Unreleased\])([^\]]+)\] - /gm)];
  if (releasedVersions.length === 0) {
    throw new Error('CHANGELOG.md does not contain any released version section.');
  }

  const previousVersion = releasedVersions[0][1];
  if (previousVersion === nextVersion) {
    throw new Error(`CHANGELOG.md already contains version ${nextVersion}.`);
  }

  if (source.includes(`## [${nextVersion}] - `)) {
    throw new Error(`CHANGELOG.md already contains version ${nextVersion}.`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const releaseSection = `## [${nextVersion}] - ${today}\n\n${unreleasedBody}\n`;
  let updated = [
    source.slice(0, unreleasedIndex),
    `${unreleasedHeader}\n\n`,
    releaseSection,
    source.slice(nextSectionIndex + 1),
  ].join('');

  const unreleasedLinkPattern = /^\[Unreleased\]: .+$/m;
  if (!unreleasedLinkPattern.test(updated)) {
    throw new Error('CHANGELOG.md is missing the Unreleased compare link.');
  }
  updated = updated.replace(
    unreleasedLinkPattern,
    `[Unreleased]: https://github.com/thekbb/terraform-plan-commenter-action/compare/v${nextVersion}...HEAD`
  );

  const previousLinkPattern = new RegExp(`^\\[${escapeRegex(previousVersion)}\\]: .+$`, 'm');
  if (!previousLinkPattern.test(updated)) {
    throw new Error(`CHANGELOG.md is missing the compare link for ${previousVersion}.`);
  }
  updated = updated.replace(
    previousLinkPattern,
    `[${nextVersion}]: https://github.com/thekbb/terraform-plan-commenter-action/compare/v${previousVersion}...v${nextVersion}\n$&`
  );

  return { updated, previousVersion, today };
};

const ensureReleaseState = (nextVersion) => {
  const currentBranch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (currentBranch !== 'main') {
    throw new Error(`Releases must run from main. Current branch: ${currentBranch}`);
  }

  const status = git('status', '--porcelain');
  if (status) {
    throw new Error('Working tree must be clean before running release.');
  }

  const existingTags = new Set(git('tag', '--list').split('\n').filter(Boolean));
  if (existingTags.has(`v${nextVersion}`)) {
    throw new Error(`Tag v${nextVersion} already exists.`);
  }
};

const packageJson = JSON.parse(readText(packageJsonPath));
const currentVersion = packageJson.version;
const changelog = readText(changelogPath);
const { updated: nextChangelog, previousVersion, today } = updateChangelog(changelog, version);

if (currentVersion !== previousVersion) {
  throw new Error(
    `package.json version (${currentVersion}) does not match the latest released changelog version (${previousVersion}).`
  );
}

const majorTag = `v${version.split('.')[0]}`;

if (checkOnly) {
  console.log(`Release check passed for ${version}`);
  console.log(`Latest released version: ${previousVersion}`);
  console.log(`Release date: ${today}`);
  console.log(`Major tag to move: ${majorTag}`);
  console.log('Files to update: CHANGELOG.md, package.json, package-lock.json');
  process.exit(0);
}

ensureReleaseState(version);

writeText(changelogPath, nextChangelog);
updateJsonVersion(packageJsonPath, version);
updateJsonVersion(packageLockPath, version);

git('add', 'CHANGELOG.md', 'package.json', 'package-lock.json');
git('commit', '-m', `Release v${version}`);
git('tag', '-a', `v${version}`, '-m', `Release v${version}`);
git('tag', '-fa', majorTag, '-m', `Release v${version}`);
git('push', 'origin', 'main');
git('push', 'origin', `refs/tags/v${version}`);
git('push', 'origin', `refs/tags/${majorTag}`, '--force');

console.log(`Released v${version} and moved ${majorTag}.`);
