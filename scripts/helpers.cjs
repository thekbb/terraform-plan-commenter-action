// @ts-check

/**
 * @typedef {'import' | 'create' | 'update' | 'destroy'} SummaryCountKey
 * @typedef {'default' | 'colorblind' | 'minimal'} SummaryTheme
 * @typedef {{ key: SummaryCountKey, label: SummaryCountKey, value: string }} SummaryCount
 * @typedef {{ key: SummaryCountKey, label: SummaryCountKey, pattern: RegExp, malformedPattern: RegExp }} CountRule
 * @typedef {{ kind: 'failed' } | { kind: 'no_changes' } | { kind: 'unparsable' } | { kind: 'empty' } | { kind: 'counts', counts: SummaryCount[] }} ParsedSummary
 */

/** @type {Record<SummaryTheme, Record<SummaryCountKey, string>>} */
const THEMES = {
  default: { import: '🔵', create: '🟢', update: '🟡', destroy: '🔴' },
  colorblind: { import: '📥', create: '➕', update: '✏️', destroy: '➖' },
  minimal: { import: '[import]', create: '[create]', update: '[update]', destroy: '[destroy]' }
};
/** @type {CountRule[]} */
const COUNT_RULES = [
  { key: 'import', label: 'import', pattern: /(\d+) to import/, malformedPattern: /(?<!\d\s)to import/ },
  { key: 'create', label: 'create', pattern: /(\d+) to add/, malformedPattern: /(?<!\d\s)to add/ },
  { key: 'update', label: 'update', pattern: /(\d+) to change/, malformedPattern: /(?<!\d\s)to change/ },
  { key: 'destroy', label: 'destroy', pattern: /(\d+) to destroy/, malformedPattern: /(?<!\d\s)to destroy/ },
];
const NO_CHANGES_SUMMARY = '✅ No changes';
const PLAN_FAILED_SUMMARY = '❌ Plan failed';
const UNSUMMARIZABLE_PLAN = 'Plan output could not be summarized';

/**
 * @param {string} plan
 * @param {string} exitCode
 * @returns {ParsedSummary}
 */
const parsePlanSummary = (plan, exitCode) => {
  if (exitCode === '1') {
    return { kind: 'failed' };
  }

  if (exitCode === '0' || plan.includes('No changes.')) {
    return { kind: 'no_changes' };
  }

  const hasMalformedCount = COUNT_RULES.some(({ malformedPattern }) => malformedPattern.test(plan));

  if (hasMalformedCount) {
    return { kind: 'unparsable' };
  }

  const counts = COUNT_RULES.flatMap(({ key, label, pattern }) => {
    const match = plan.match(pattern);
    return match ? [{ key, label, value: match[1] }] : [];
  });

  if (counts.length === 0) {
    return { kind: 'empty' };
  }

  return { kind: 'counts', counts };
};

/**
 * @param {ParsedSummary} summary
 * @param {SummaryTheme | string} [theme]
 * @returns {string}
 */
const renderPlanSummary = (summary, theme = 'default') => {
  if (summary.kind === 'failed') {
    return PLAN_FAILED_SUMMARY;
  }

  if (summary.kind === 'no_changes') {
    return NO_CHANGES_SUMMARY;
  }

  if (summary.kind === 'unparsable') {
    return UNSUMMARIZABLE_PLAN;
  }

  if (summary.kind === 'empty') {
    return '';
  }

  const themeKey = /** @type {SummaryTheme} */ (
    Object.prototype.hasOwnProperty.call(THEMES, theme) ? theme : 'default'
  );
  const emojis = THEMES[themeKey];
  const counts = /** @type {SummaryCount[]} */ (summary.counts);
  return counts
    .map(({ key, label, value }) => `${emojis[key]} <strong>${label}</strong> <code>${value}</code>`)
    .join(' · ');
};

/**
 * @param {string} plan
 * @param {string} exitCode
 * @param {SummaryTheme | string} [theme]
 * @returns {string}
 */
const formatSummary = (plan, exitCode, theme = 'default') => {
  return renderPlanSummary(parsePlanSummary(plan, exitCode), theme);
};

/**
 * @param {string} [plan]
 * @returns {string}
 */
const stripRefreshNoise = (plan = '') => {
  const lines = plan.split('\n');
  const filtered = [];

  for (const line of lines) {
    if (/:\sRefreshing state\.\.\./.test(line)) continue;
    if (/:\sReading\.\.\./.test(line)) continue;
    if (/:\sRead complete after /.test(line)) continue;
    filtered.push(line);
  }

  const collapsed = [];
  for (const line of filtered) {
    if (line === '' && collapsed.at(-1) === '') continue;
    collapsed.push(line);
  }

  const cleaned = collapsed.join('\n').trim();
  return cleaned || 'No actionable Terraform plan output to display.';
};

/**
 * @param {string} [workingDir]
 * @param {string} [workspace]
 * @returns {string}
 */
const makeMarker = (workingDir = '.', workspace = 'default') => {
  const normalizedDir = workingDir === '.' ? 'root' : workingDir.replace(/\//g, '-');
  return `<!-- terraform-plan-comment:${normalizedDir}:${workspace} -->`;
};

module.exports = {
  formatSummary,
  makeMarker,
  NO_CHANGES_SUMMARY,
  parsePlanSummary,
  PLAN_FAILED_SUMMARY,
  renderPlanSummary,
  stripRefreshNoise,
  THEMES,
  UNSUMMARIZABLE_PLAN,
};
