// Helper functions for formatting Terraform plan output (CommonJS for github-script)

/** Available emoji themes */
const THEMES = {
  default: { import: '🔵', create: '🟢', update: '🟡', destroy: '🔴' },
  colorblind: { import: '📥', create: '➕', update: '✏️', destroy: '➖' },
  minimal: { import: '[import]', create: '[create]', update: '[update]', destroy: '[destroy]' }
};
const UNSUMMARIZABLE_PLAN = 'Plan output could not be summarized';

/**
 * Format summary with emoji badges
 * @param {string} plan - The terraform plan output
 * @param {string} exitCode - Exit code from terraform plan ('0', '1', or '2')
 * @param {string} theme - Theme name ('default', 'colorblind', 'minimal')
 * @returns {string} Formatted summary string
 */
const formatSummary = (plan, exitCode, theme = 'default') => {
  // Check for errors
  if (exitCode === '1') {
    return '❌ Plan failed';
  }

  // Check for no changes
  if (exitCode === '0' || plan.includes('No changes.')) {
    return '✅ No changes';
  }

  const emojis = THEMES[theme] || THEMES.default;

  const addMatch = plan.match(/(\d+) to add/);
  const changeMatch = plan.match(/(\d+) to change/);
  const destroyMatch = plan.match(/(\d+) to destroy/);
  const importMatch = plan.match(/(\d+) to import/);
  const hasMalformedCount = [
    /(?<!\d\s)to add/,
    /(?<!\d\s)to change/,
    /(?<!\d\s)to destroy/,
    /(?<!\d\s)to import/,
  ].some((pattern) => pattern.test(plan));

  if (hasMalformedCount) {
    return UNSUMMARIZABLE_PLAN;
  }

  if (!addMatch && !changeMatch && !destroyMatch && !importMatch) {
    return '';
  }

  const parts = [];
  if (importMatch) parts.push(`${emojis.import} <strong>import</strong> <code>${importMatch[1]}</code>`);
  if (addMatch) parts.push(`${emojis.create} <strong>create</strong> <code>${addMatch[1]}</code>`);
  if (changeMatch) parts.push(`${emojis.update} <strong>update</strong> <code>${changeMatch[1]}</code>`);
  if (destroyMatch) parts.push(`${emojis.destroy} <strong>destroy</strong> <code>${destroyMatch[1]}</code>`);

  return parts.join(' · ');
};

/**
 * Remove Terraform refresh/read noise from plan output before posting to PRs.
 * @param {string} plan - The raw terraform plan output
 * @returns {string} Cleaned plan output
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
 * Generate unique comment marker for identifying bot comments
 * @param {string} workingDir - Working directory path
 * @param {string} workspace - Terraform workspace name
 * @returns {string} Unique HTML comment marker
 */
const makeMarker = (workingDir = '.', workspace = 'default') => {
  // Normalize path for consistency
  const normalizedDir = workingDir === '.' ? 'root' : workingDir.replace(/\//g, '-');
  return `<!-- terraform-plan-comment:${normalizedDir}:${workspace} -->`;
};

module.exports = {
  formatSummary,
  makeMarker,
  stripRefreshNoise,
  THEMES,
  UNSUMMARIZABLE_PLAN,
};
