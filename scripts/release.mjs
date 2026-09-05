// @ts-check

import fs from 'node:fs';
import path from 'node:path';

/** @type {string[]} */
const args = process.argv.slice(2);
const [mode, versionArg] = args;
const checkOnly = mode === '--check';

if (args.length !== 2 || (mode !== '--check' && mode !== '--prepare') || !versionArg) {
  console.error('Usage: node scripts/release.mjs <--check|--prepare> <version>');
  console.error('Use npm run release:check or npm run release:prepare. This tool never commits, tags, or pushes.');
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
 */

/** @param {string} filePath */
const readText = (filePath) => fs.readFileSync(filePath, 'utf8');
/** @param {string} filePath @param {string} text */
const writeText = (filePath, text) => fs.writeFileSync(filePath, text);
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

  const previousVersion = releasedVersions[0]?.[1];
  if (!previousVersion) {
    throw new Error('Could not read the latest released changelog version.');
  }
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

if (checkOnly) {
  console.log(`Release check passed for ${version}`);
  console.log(`Latest released version: ${changelogState.previousVersion}`);
  console.log(`Release date: ${today}`);
  if (isPreparedRelease) {
    console.log('Release files are already prepared.');
  }
  console.log('Files to update: CHANGELOG.md, README.md, package.json, package-lock.json');
  process.exit(0);
}

writeText(changelogPath, nextChangelog);
writeText(readmePath, nextReadme);
updateJsonVersion(packageJsonPath, version);
updateJsonVersion(packageLockPath, version);

console.log(`Prepared release files for v${version} in the working tree. Review them in the release-candidate PR.`);
