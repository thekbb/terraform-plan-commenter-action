// Helper functions for formatting Terraform plan output (CommonJS for github-script)

/**
 * Format summary with emoji badges
 * @param {string} plan - The terraform plan output
 * @param {string} exitCode - Exit code from terraform plan ('0', '1', or '2')
 * @returns {string} Formatted summary string
 */
const formatSummary = (plan, exitCode) => {
  // Check for no changes
  if (exitCode === '0' || plan.includes('No changes.')) {
    return '✅ No changes';
  }

  // Check for errors
  if (exitCode === '1') {
    return '❌ Plan failed';
  }

  const addMatch = plan.match(/(\d+) to add/);
  const changeMatch = plan.match(/(\d+) to change/);
  const destroyMatch = plan.match(/(\d+) to destroy/);
  const importMatch = plan.match(/(\d+) to import/);

  if (!addMatch && !changeMatch && !destroyMatch && !importMatch) {
    return '';
  }

  const parts = [];
  if (importMatch) parts.push(`🔵 <strong>import</strong> <code>${importMatch[1]}</code>`);
  if (addMatch) parts.push(`🟢 <strong>create</strong> <code>${addMatch[1]}</code>`);
  if (changeMatch) parts.push(`🟡 <strong>update</strong> <code>${changeMatch[1]}</code>`);
  if (destroyMatch) parts.push(`🔴 <strong>destroy</strong> <code>${destroyMatch[1]}</code>`);

  return parts.join(' · ') + ' — <em>I love it when a plan comes together.</em> 🚬';
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

/** Comment marker for identifying bot comments */
const MARKER = '<!-- terraform-plan-comment -->';

module.exports = { formatSummary, splitPlan, MARKER };
