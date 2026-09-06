export type SummaryCountKey = 'import' | 'create' | 'update' | 'destroy';
export type SummaryTheme = 'default' | 'colorblind' | 'minimal';

export interface SummaryCount {
  readonly key: SummaryCountKey;
  readonly label: SummaryCountKey;
  readonly value: string;
}

interface CountRule {
  readonly key: SummaryCountKey;
  readonly label: SummaryCountKey;
  readonly pattern: RegExp;
  readonly malformedPattern: RegExp;
}

export type ParsedSummary =
  | { readonly kind: 'failed' }
  | { readonly kind: 'no_changes' }
  | { readonly kind: 'unparsable' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'counts'; readonly counts: readonly SummaryCount[] };

export const THEMES: Readonly<
  Record<SummaryTheme, Readonly<Record<SummaryCountKey, string>>>
> = {
  default: { import: '🔵', create: '🟢', update: '🟡', destroy: '🔴' },
  colorblind: { import: '📥', create: '➕', update: '✏️', destroy: '➖' },
  minimal: {
    import: '[import]',
    create: '[create]',
    update: '[update]',
    destroy: '[destroy]',
  },
};

const COUNT_RULES: readonly CountRule[] = [
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

export const extractPlanSummaryLine = (plan: string): string => {
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

export const parsePlanSummary = (
  plan: string,
  exitCode: string
): ParsedSummary => {
  if (exitCode === '1') {
    return { kind: 'failed' };
  }

  const summaryLine = extractPlanSummaryLine(plan);

  if (exitCode === '0' || summaryLine.startsWith('No changes.')) {
    return { kind: 'no_changes' };
  }

  const hasMalformedCount = COUNT_RULES.some(({ malformedPattern }) =>
    malformedPattern.test(summaryLine)
  );

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

const isSummaryTheme = (theme: string): theme is SummaryTheme =>
  Object.prototype.hasOwnProperty.call(THEMES, theme);

export const renderPlanSummary = (
  summary: ParsedSummary,
  theme = 'default'
): string => {
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
    .map(({ key, label, value }) =>
      `${emojis[key]} <strong>${label}</strong> <code>${value}</code>`
    )
    .join(' · ');
};

export const formatSummary = (
  plan: string,
  exitCode: string,
  theme = 'default'
): string => renderPlanSummary(parsePlanSummary(plan, exitCode), theme);

export const stripRefreshNoise = (plan = ''): string => {
  const lines = plan.split('\n');
  const filtered: string[] = [];

  for (const line of lines) {
    if (/:\sRefreshing state\.\.\./.test(line)) continue;
    if (/:\sReading\.\.\./.test(line)) continue;
    if (/:\sRead complete after /.test(line)) continue;
    filtered.push(line);
  }

  const collapsed: string[] = [];
  for (const line of filtered) {
    if (line === '' && collapsed.at(-1) === '') continue;
    collapsed.push(line);
  }

  const cleaned = collapsed.join('\n').trim();
  return cleaned || 'No actionable Terraform plan output to display.';
};

export { makeMarker } from './comment-identity.js';
