#!/usr/bin/env node

/* global fetch */

import { makeMarker } from '../../dist/helpers.js';
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const repository = process.env.GITHUB_REPOSITORY || '';
const pullRequestNumber = Number.parseInt(process.env.PR_NUMBER || '', 10);
const fixtureDir = process.env.FIXTURE_DIR || '.';
const expectationsJson = process.env.EXPECTATIONS_JSON || '';

if (!token) {
  throw new Error('GITHUB_TOKEN or GH_TOKEN is required.');
}

if (!repository.includes('/')) {
  throw new Error(`Expected GITHUB_REPOSITORY to be owner/repo, got: ${repository || '<unset>'}`);
}

if (!Number.isInteger(pullRequestNumber) || pullRequestNumber <= 0) {
  throw new Error(`Expected PR_NUMBER to be a positive integer, got: ${process.env.PR_NUMBER || '<unset>'}`);
}

if (!expectationsJson) {
  throw new Error('EXPECTATIONS_JSON is required.');
}

const expectations = JSON.parse(expectationsJson);

if (!Array.isArray(expectations) || expectations.length === 0) {
  throw new Error('EXPECTATIONS_JSON must be a non-empty JSON array.');
}

const [owner, repo] = repository.split('/');

/**
 * @param {Headers} headers
 * @returns {string | null}
 */
function nextLink(headers) {
  const link = headers.get('link');
  if (!link) {
    return null;
  }

  for (const entry of link.split(',')) {
    const match = entry.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match && match[2] === 'next') {
      return match[1];
    }
  }

  return null;
}

async function listIssueComments() {
  const comments = [];
  let url = `https://api.github.com/repos/${owner}/${repo}/issues/${pullRequestNumber}/comments?per_page=100`;

  while (url) {
    const response = await fetch(url, {
      headers: {
        'accept': 'application/vnd.github+json',
        'authorization': `Bearer ${token}`,
        'user-agent': 'terraform-plan-commenter-action-e2e',
        'x-github-api-version': '2022-11-28',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API request failed with HTTP ${response.status}: ${body}`);
    }

    const page = await response.json();
    comments.push(...page);
    url = nextLink(response.headers);
  }

  return comments;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string[]}
 */
function normalizeStringArray(value, field) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${field} must be an array of strings.`);
  }

  return value;
}

const comments = await listIssueComments();

for (const expectation of expectations) {
  if (!expectation || typeof expectation !== 'object') {
    throw new Error('Each expectation must be an object.');
  }

  const workspace = typeof expectation.workspace === 'string' ? expectation.workspace : 'default';
  const marker = typeof expectation.marker === 'string' ? expectation.marker : makeMarker(fixtureDir, workspace);
  const label = typeof expectation.label === 'string' ? expectation.label : marker;
  const expectedCount = Number.isInteger(expectation.count) ? expectation.count : 1;
  const includes = normalizeStringArray(expectation.includes, 'includes');
  const excludes = normalizeStringArray(expectation.excludes, 'excludes');

  const matches = comments.filter((comment) =>
    comment.user?.login === 'github-actions[bot]' && typeof comment.body === 'string' &&
    (comment.body === marker || comment.body.startsWith(`${marker}\n`))
  );

  if (matches.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} bot comment(s) for ${label}, found ${matches.length}.`);
  }

  const body = matches[0]?.body || '';

  for (const snippet of includes) {
    if (!body.includes(snippet)) {
      throw new Error(`Expected comment for ${label} to include: ${snippet}`);
    }
  }

  for (const snippet of excludes) {
    if (body.includes(snippet)) {
      throw new Error(`Did not expect comment for ${label} to include: ${snippet}`);
    }
  }
}
