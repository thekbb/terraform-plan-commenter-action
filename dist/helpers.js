export const THEMES = {
    default: { import: '🔵', create: '🟢', update: '🟡', destroy: '🔴' },
    colorblind: { import: '📥', create: '➕', update: '✏️', destroy: '➖' },
    minimal: {
        import: '[import]',
        create: '[create]',
        update: '[update]',
        destroy: '[destroy]',
    },
};
const COUNT_RULES = [
    {
        key: 'import',
        label: 'import',
        pattern: /(\d+) to import/,
        malformedPattern: /(?<!\d\s)to import/,
    },
    {
        key: 'create',
        label: 'create',
        pattern: /(\d+) to add/,
        malformedPattern: /(?<!\d\s)to add/,
    },
    {
        key: 'update',
        label: 'update',
        pattern: /(\d+) to change/,
        malformedPattern: /(?<!\d\s)to change/,
    },
    {
        key: 'destroy',
        label: 'destroy',
        pattern: /(\d+) to destroy/,
        malformedPattern: /(?<!\d\s)to destroy/,
    },
];
export const NO_CHANGES_SUMMARY = '✅ No changes';
export const PLAN_FAILED_SUMMARY = '❌ Plan failed';
export const UNSUMMARIZABLE_PLAN = 'Plan output could not be summarized';
export const extractPlanSummaryLine = (plan) => {
    const lines = plan.split('\n');
    for (const line of lines) {
        if (line.startsWith('No changes.')) {
            return line;
        }
    }
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (line?.startsWith('Plan: ')) {
            return line;
        }
    }
    return '';
};
export const parsePlanSummary = (plan, exitCode) => {
    if (exitCode === '1') {
        return { kind: 'failed' };
    }
    const summaryLine = extractPlanSummaryLine(plan);
    if (exitCode === '0' || summaryLine.startsWith('No changes.')) {
        return { kind: 'no_changes' };
    }
    const hasMalformedCount = COUNT_RULES.some(({ malformedPattern }) => malformedPattern.test(summaryLine));
    if (hasMalformedCount) {
        return { kind: 'unparsable' };
    }
    const counts = COUNT_RULES.flatMap(({ key, label, pattern }) => {
        const value = summaryLine.match(pattern)?.[1];
        return value === undefined ? [] : [{ key, label, value }];
    });
    if (counts.length === 0) {
        return { kind: 'empty' };
    }
    return { kind: 'counts', counts };
};
const isSummaryTheme = (theme) => Object.prototype.hasOwnProperty.call(THEMES, theme);
export const renderPlanSummary = (summary, theme = 'default') => {
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
    const emojis = THEMES[isSummaryTheme(theme) ? theme : 'default'];
    return summary.counts
        .map(({ key, label, value }) => `${emojis[key]} <strong>${label}</strong> <code>${value}</code>`)
        .join(' · ');
};
export const formatSummary = (plan, exitCode, theme = 'default') => renderPlanSummary(parsePlanSummary(plan, exitCode), theme);
export const stripRefreshNoise = (plan = '') => {
    const lines = plan.split('\n');
    const filtered = [];
    for (const line of lines) {
        if (/:\sRefreshing state\.\.\./.test(line))
            continue;
        if (/:\sReading\.\.\./.test(line))
            continue;
        if (/:\sRead complete after /.test(line))
            continue;
        filtered.push(line);
    }
    const collapsed = [];
    for (const line of filtered) {
        if (line === '' && collapsed.at(-1) === '')
            continue;
        collapsed.push(line);
    }
    const cleaned = collapsed.join('\n').trim();
    return cleaned || 'No actionable Terraform plan output to display.';
};
const normalizeWorkingDirForMarker = (workingDir = '.') => {
    const normalizedDir = workingDir
        .trim()
        .replace(/^\.\/+/, '')
        .replace(/\/+/g, '/')
        .replace(/\/+$/g, '');
    return normalizedDir === '' || normalizedDir === '.'
        ? 'root'
        : normalizedDir;
};
export const makeMarker = (workingDir = '.', workspace = 'default') => {
    const markerDir = normalizeWorkingDirForMarker(workingDir).replace(/\//g, '-');
    return `<!-- terraform-plan-comment:${markerDir}:${workspace} -->`;
};
