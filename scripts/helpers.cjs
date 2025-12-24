// Helper functions for formatting Terraform plan output (CommonJS for github-script)

/** Available emoji themes */
const THEMES = {
  default: { import: '🔵', create: '🟢', update: '🟡', destroy: '🔴' },
  colorblind: { import: '📥', create: '➕', update: '✏️', destroy: '➖' },
  minimal: { import: '[import]', create: '[create]', update: '[update]', destroy: '[destroy]' }
};

/**
 * Format summary with emoji badges
 * @param {string} plan - The terraform plan output
 * @param {string} exitCode - Exit code from terraform plan ('0', '1', or '2')
 * @param {string} theme - Theme name ('default', 'colorblind', 'minimal')
 * @returns {string} Formatted summary string
 */
const formatSummary = (plan, exitCode, theme = 'default') => {
  // Check for no changes
  if (exitCode === '0' || plan.includes('No changes.')) {
    return '✅ No changes';
  }

  // Check for errors
  if (exitCode === '1') {
    return '❌ Plan failed';
  }

  const emojis = THEMES[theme] || THEMES.default;

  const addMatch = plan.match(/(\d+) to add/);
  const changeMatch = plan.match(/(\d+) to change/);
  const destroyMatch = plan.match(/(\d+) to destroy/);
  const importMatch = plan.match(/(\d+) to import/);

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
 * Split plan into refresh and changes sections
 * @param {string} plan - The terraform plan output
 * @returns {{ refresh: string, changes: string }} Object with refresh and changes sections
 */
const splitPlan = (plan) => {
  const splitPoint = 'Terraform used the selected providers';
  const idx = plan.indexOf(splitPoint);
  if (idx === -1) return { refresh: '', changes: plan };
  return {
    refresh: plan.slice(0, idx).trim(),
    changes: plan.slice(idx).trim()
  };
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

module.exports = { formatSummary, splitPlan, makeMarker, THEMES };
