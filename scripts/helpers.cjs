const THEMES = {
  default: { import: '🔵', create: '🟢', update: '🟡', destroy: '🔴' },
  colorblind: { import: '📥', create: '➕', update: '✏️', destroy: '➖' },
  minimal: { import: '[import]', create: '[create]', update: '[update]', destroy: '[destroy]' }
};
const COUNT_RULES = [
  { key: 'import', label: 'import', pattern: /(\d+) to import/, malformedPattern: /(?<!\d\s)to import/ },
  { key: 'create', label: 'create', pattern: /(\d+) to add/, malformedPattern: /(?<!\d\s)to add/ },
  { key: 'update', label: 'update', pattern: /(\d+) to change/, malformedPattern: /(?<!\d\s)to change/ },
  { key: 'destroy', label: 'destroy', pattern: /(\d+) to destroy/, malformedPattern: /(?<!\d\s)to destroy/ },
];
const NO_CHANGES_SUMMARY = '✅ No changes';
const PLAN_FAILED_SUMMARY = '❌ Plan failed';
const UNSUMMARIZABLE_PLAN = 'Plan output could not be summarized';

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

  const emojis = THEMES[theme] || THEMES.default;
  return summary.counts
    .map(({ key, label, value }) => `${emojis[key]} <strong>${label}</strong> <code>${value}</code>`)
    .join(' · ');
};

const formatSummary = (plan, exitCode, theme = 'default') => {
  return renderPlanSummary(parsePlanSummary(plan, exitCode), theme);
};

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
