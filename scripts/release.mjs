// @ts-check

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const versionArg = args.find((arg) => !arg.startsWith('-'));

if (!versionArg) {
  console.error('Usage: npm run release[:check] -- <version>');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(versionArg)) {
  console.error(`Invalid version "${versionArg}". Use semver like 1.2.3.`);
  process.exit(1);
}

const version = versionArg;
const repoRoot = process.cwd();
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
const packageJsonPath = path.join(repoRoot, 'package.json');
const packageLockPath = path.join(repoRoot, 'package-lock.json');
const readmePath = path.join(repoRoot, 'README.md');

/**
 * @typedef {{ version: string }} VersionedJson
 * @typedef {VersionedJson & { packages?: { '': VersionedJson } }} PackageLockJson
 * @typedef {{
 *   unreleasedBody: string,
 *   previousVersion: string,
 *   hasNextVersionSection: boolean
 * }} ChangelogState
 * @typedef {{
 *   updated: string,
 *   previousVersion: string,
 *   today: string
 * }} ChangelogUpdate
 * @typedef {{ allowManagedFileChanges?: boolean }} EnsureReleaseOptions
 */

/** @param {string} filePath */
const readText = (filePath) => fs.readFileSync(filePath, 'utf8');
/** @param {string} filePath @param {string} text */
const writeText = (filePath, text) => fs.writeFileSync(filePath, text);
const managedReleaseFiles = ['CHANGELOG.md', 'README.md', 'package.json', 'package-lock.json'];

/** @param {...string} gitArgs */
const git = (...gitArgs) => execFileSync('git', gitArgs, {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();

/** @param {string} value */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} filePath
 * @param {string} nextVersion
 */
const updateJsonVersion = (filePath, nextVersion) => {
  /** @type {PackageLockJson} */
  const json = JSON.parse(readText(filePath));
  json.version = nextVersion;
  if (json.packages?.['']) {
    json.packages[''].version = nextVersion;
  }
  writeText(filePath, `${JSON.stringify(json, null, 2)}\n`);
};

/**
 * @param {string} source
 * @param {string} nextVersion
 * @returns {string}
 */
const updateReadmeReleaseExamples = (source, nextVersion) => {
  let updated = source;
  const actionVersionPattern = /thekbb\/terraform-plan-commenter-action@v\d+\.\d+\.\d+/g;
  const semanticVersionNotePattern = /semantic versions \(`v\d+\.\d+\.\d+`\)/;

  updated = updated.replace(
    actionVersionPattern,
    `thekbb/terraform-plan-commenter-action@v${nextVersion}`
  );
  updated = updated.replace(
    semanticVersionNotePattern,
    `semantic versions (\`v${nextVersion}\`)`
  );

  return updated;
};

/**
 * @param {string} source
 * @param {string} nextVersion
 * @returns {ChangelogState}
 */
const inspectChangelog = (source, nextVersion) => {
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

  const releasedVersions = [...source.matchAll(/^## \[(?!Unreleased\])([^\]]+)\] - /gm)];
  if (releasedVersions.length === 0) {
    throw new Error('CHANGELOG.md does not contain any released version section.');
  }

  const previousVersion = releasedVersions[0][1];
  const hasNextVersionSection = source.includes(`## [${nextVersion}] - `);

  return {
    unreleasedBody,
    previousVersion,
    hasNextVersionSection,
  };
};

/**
 * @param {string} source
 * @param {string} nextVersion
 * @returns {ChangelogUpdate}
 */
const updateChangelog = (source, nextVersion) => {
  const { unreleasedBody, previousVersion, hasNextVersionSection } = inspectChangelog(source, nextVersion);
  const unreleasedHeader = '## [Unreleased]';
  const unreleasedIndex = source.indexOf(unreleasedHeader);
  const nextSectionIndex = source.indexOf('\n## [', unreleasedIndex + unreleasedHeader.length);

  if (!unreleasedBody) {
    throw new Error('CHANGELOG.md Unreleased section is empty.');
  }

  if (previousVersion === nextVersion || hasNextVersionSection) {
    throw new Error(`CHANGELOG.md already contains version ${nextVersion}.`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const releaseSection = `## [${nextVersion}] - ${today}\n\n${unreleasedBody}\n\n`;
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

/**
 * @param {string} nextVersion
 * @param {EnsureReleaseOptions} [options]
 */
const ensureReleaseState = (nextVersion, { allowManagedFileChanges = false } = {}) => {
  const currentBranch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (currentBranch !== 'main') {
    throw new Error(`Releases must run from main. Current branch: ${currentBranch}`);
  }

  const status = git('status', '--porcelain');
  if (status) {
    if (!allowManagedFileChanges) {
      throw new Error('Working tree must be clean before running release.');
    }

    const changedFiles = status
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).trim());

    const hasUnexpectedChanges = changedFiles.some((file) => !managedReleaseFiles.includes(file));
    if (hasUnexpectedChanges) {
      throw new Error(
        'Only release-managed files may be modified when resuming a partial release.'
      );
    }
  }
};

/** @param {string} tagName */
const tagExists = (tagName) => git('tag', '--list', tagName) === tagName;

/** @param {string} tagName */
const derefTag = (tagName) => git('rev-parse', `${tagName}^{}`);

/**
 * @param {string} tagName
 * @param {string} message
 * @param {{ force?: boolean }} [options]
 */
const ensureTagOnHead = (tagName, message, { force = false } = {}) => {
  const head = git('rev-parse', 'HEAD');

  if (tagExists(tagName)) {
    if (derefTag(tagName) === head && !force) {
      return;
    }

    git('tag', '-fa', tagName, '-m', message);
    return;
  }

  git('tag', '-a', tagName, '-m', message);
};

/** @type {VersionedJson} */
const packageJson = JSON.parse(readText(packageJsonPath));
/** @type {PackageLockJson} */
const packageLock = JSON.parse(readText(packageLockPath));
const currentVersion = packageJson.version;
const currentLockVersion = packageLock.version;
const changelog = readText(changelogPath);
const readme = readText(readmePath);
const changelogState = inspectChangelog(changelog, version);

let nextChangelog = changelog;
let nextReadme = updateReadmeReleaseExamples(readme, version);
let today = new Date().toISOString().slice(0, 10);
let isPreparedRelease = false;

if (changelogState.unreleasedBody) {
  const releaseUpdate = updateChangelog(changelog, version);
  nextChangelog = releaseUpdate.updated;
  today = releaseUpdate.today;

  if (currentVersion !== changelogState.previousVersion) {
    throw new Error(
      `package.json version (${currentVersion}) does not match the latest released changelog version (${changelogState.previousVersion}).`
    );
  }
  if (currentLockVersion !== changelogState.previousVersion) {
    throw new Error(
      `package-lock.json version (${currentLockVersion}) does not match the latest released changelog version (${changelogState.previousVersion}).`
    );
  }
} else {
  isPreparedRelease = changelogState.hasNextVersionSection;

  if (!isPreparedRelease) {
    throw new Error('CHANGELOG.md Unreleased section is empty.');
  }

  if (currentVersion !== version) {
    throw new Error(
      `package.json version (${currentVersion}) does not match the prepared release version (${version}).`
    );
  }
  if (currentLockVersion !== version) {
    throw new Error(
      `package-lock.json version (${currentLockVersion}) does not match the prepared release version (${version}).`
    );
  }
}

const majorTag = `v${version.split('.')[0]}`;

if (checkOnly) {
  console.log(`Release check passed for ${version}`);
  console.log(`Latest released version: ${changelogState.previousVersion}`);
  console.log(`Release date: ${today}`);
  console.log(`Major tag to move: ${majorTag}`);
  if (isPreparedRelease) {
    console.log('Release files are already prepared; rerunning release will resume from the git/tag steps.');
  }
  console.log('Files to update: CHANGELOG.md, README.md, package.json, package-lock.json');
  process.exit(0);
}

ensureReleaseState(version, { allowManagedFileChanges: isPreparedRelease });

writeText(changelogPath, nextChangelog);
writeText(readmePath, nextReadme);
updateJsonVersion(packageJsonPath, version);
updateJsonVersion(packageLockPath, version);

git('add', 'CHANGELOG.md', 'README.md', 'package.json', 'package-lock.json');
try {
  git('diff', '--cached', '--quiet');
} catch {
  git('commit', '-m', `Release v${version}`);
}

ensureTagOnHead(`v${version}`, `Release v${version}`);
ensureTagOnHead(majorTag, `Release v${version}`, { force: true });
git('push', 'origin', 'main');
git('push', 'origin', `refs/tags/v${version}`);
git('push', 'origin', `refs/tags/${majorTag}`, '--force');

console.log(`Released v${version} and moved ${majorTag}.`);
