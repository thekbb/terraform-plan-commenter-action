import { describe, it, expect } from 'vitest';
import {
  formatSummary,
  makeMarker,
  NO_CHANGES_SUMMARY,
  parsePlanSummary,
  PLAN_FAILED_SUMMARY,
  renderPlanSummary,
  stripRefreshNoise,
  UNSUMMARIZABLE_PLAN,
  THEMES,
} from './helpers.cjs';

describe('formatSummary', () => {
  it('returns no changes for exit code 0', () => {
    const result = formatSummary('Some plan output', '0');
    expect(result).toBe('✅ No changes');
  });

  it('returns no changes for exit code 0 when the plan output is empty', () => {
    const result = formatSummary('', '0');
    expect(result).toBe('✅ No changes');
  });

  it('returns no changes when plan contains "No changes."', () => {
    const plan = 'No changes. Your infrastructure matches the configuration.';
    const result = formatSummary(plan, '2');
    expect(result).toBe('✅ No changes');
  });

  it('returns plan failed for exit code 1', () => {
    const result = formatSummary('Error: something went wrong', '1');
    expect(result).toBe('❌ Plan failed');
  });

  it('returns plan failed for exit code 1 when the plan output is empty', () => {
    const result = formatSummary('', '1');
    expect(result).toBe('❌ Plan failed');
  });

  it('returns plan failed when exit code 1 includes a no-changes message', () => {
    const plan = 'No changes. Your infrastructure matches the configuration.';
    const result = formatSummary(plan, '1');
    expect(result).toBe('❌ Plan failed');
  });

  it('parses add/change/destroy counts', () => {
    const plan = 'Plan: 3 to add, 1 to change, 2 to destroy.';
    const result = formatSummary(plan, '2');
    expect(result).toBe(
      '🟢 <strong>create</strong> <code>3</code> · ' +
      '🟡 <strong>update</strong> <code>1</code> · ' +
      '🔴 <strong>destroy</strong> <code>2</code>'
    );
  });

  it('parses import-only counts', () => {
    const plan = 'Plan: 2 to import.';
    const result = formatSummary(plan, '2');
    expect(result).toBe('🔵 <strong>import</strong> <code>2</code>');
  });

  it('parses create-only counts', () => {
    const plan = 'Plan: 3 to add.';
    const result = formatSummary(plan, '2');
    expect(result).toBe('🟢 <strong>create</strong> <code>3</code>');
  });

  it('parses update-only counts', () => {
    const plan = 'Plan: 4 to change.';
    const result = formatSummary(plan, '2');
    expect(result).toBe('🟡 <strong>update</strong> <code>4</code>');
  });

  it('parses destroy-only counts', () => {
    const plan = 'Plan: 5 to destroy.';
    const result = formatSummary(plan, '2');
    expect(result).toBe('🔴 <strong>destroy</strong> <code>5</code>');
  });

  it('parses imports', () => {
    const plan = 'Plan: 2 to import, 1 to add, 0 to change, 0 to destroy.';
    const result = formatSummary(plan, '2');
    expect(result).toContain('🔵 <strong>import</strong> <code>2</code>');
    expect(result).toContain('🟢 <strong>create</strong> <code>1</code>');
  });

  it('shows imports first in order', () => {
    const plan = 'Plan: 1 to add, 3 to import, 0 to change, 0 to destroy.';
    const result = formatSummary(plan, '2');
    expect(result.indexOf('import')).toBeLessThan(result.indexOf('create'));
  });

  it('includes zero counts for context', () => {
    const plan = 'Plan: 0 to add, 0 to change, 5 to destroy.';
    const result = formatSummary(plan, '2');
    expect(result).toContain('🟢 <strong>create</strong> <code>0</code>');
    expect(result).toContain('🟡 <strong>update</strong> <code>0</code>');
    expect(result).toContain('🔴 <strong>destroy</strong> <code>5</code>');
  });

  it('returns empty string when no counts found', () => {
    const plan = 'Some random output without plan counts';
    const result = formatSummary(plan, '2');
    expect(result).toBe('');
  });

  it('returns a neutral summary when the add count is malformed', () => {
    const plan = 'Plan: to add, 0 to change, 0 to destroy.';
    const result = formatSummary(plan, '2');
    expect(result).toBe(UNSUMMARIZABLE_PLAN);
  });

  it('returns a neutral summary when the change count is malformed', () => {
    const plan = 'Plan: 0 to add, x to change, 0 to destroy.';
    const result = formatSummary(plan, '2');
    expect(result).toBe(UNSUMMARIZABLE_PLAN);
  });

  it('returns a neutral summary for mixed valid and invalid fragments', () => {
    const plan = 'Plan: 2 to add, x to change, to destroy.';
    const result = formatSummary(plan, '2');
    expect(result).toBe(UNSUMMARIZABLE_PLAN);
  });

  it('handles large numbers', () => {
    const plan = 'Plan: 100 to add, 50 to change, 25 to destroy.';
    const result = formatSummary(plan, '2');
    expect(result).toContain('<code>100</code>');
    expect(result).toContain('<code>50</code>');
    expect(result).toContain('<code>25</code>');
  });

  it('uses colorblind theme', () => {
    const plan = 'Plan: 1 to add, 1 to change, 1 to destroy.';
    const result = formatSummary(plan, '2', 'colorblind');
    expect(result).toContain('➕ <strong>create</strong>');
    expect(result).toContain('✏️ <strong>update</strong>');
    expect(result).toContain('➖ <strong>destroy</strong>');
  });

  it('uses minimal theme', () => {
    const plan = 'Plan: 1 to add, 1 to change, 1 to destroy.';
    const result = formatSummary(plan, '2', 'minimal');
    expect(result).toContain('[create] <strong>create</strong>');
    expect(result).toContain('[update] <strong>update</strong>');
    expect(result).toContain('[destroy] <strong>destroy</strong>');
  });

  it('falls back to default for unknown theme', () => {
    const plan = 'Plan: 1 to add, 0 to change, 0 to destroy.';
    const result = formatSummary(plan, '2', 'nonexistent');
    expect(result).toContain('🟢 <strong>create</strong>');
  });
});

describe('THEMES', () => {
  it('has default theme with colored emojis', () => {
    expect(THEMES.default).toEqual({
      import: '🔵',
      create: '🟢',
      update: '🟡',
      destroy: '🔴'
    });
  });

  it('has colorblind theme with shape-based emojis', () => {
    expect(THEMES.colorblind).toEqual({
      import: '📥',
      create: '➕',
      update: '✏️',
      destroy: '➖'
    });
  });

  it('has minimal theme with text labels', () => {
    expect(THEMES.minimal).toEqual({
      import: '[import]',
      create: '[create]',
      update: '[update]',
      destroy: '[destroy]'
    });
  });
});

describe('parsePlanSummary', () => {
  it('returns structured counts in display order', () => {
    const plan = 'Plan: 2 to import, 1 to add, 3 to change, 4 to destroy.';

    expect(parsePlanSummary(plan, '2')).toEqual({
      kind: 'counts',
      counts: [
        { key: 'import', label: 'import', value: '2' },
        { key: 'create', label: 'create', value: '1' },
        { key: 'update', label: 'update', value: '3' },
        { key: 'destroy', label: 'destroy', value: '4' },
      ],
    });
  });

  it('returns an unparsable state for malformed count fragments', () => {
    const plan = 'Plan: 2 to add, x to change, to destroy.';

    expect(parsePlanSummary(plan, '2')).toEqual({ kind: 'unparsable' });
  });

  it('returns an empty state when no summary information can be parsed', () => {
    expect(parsePlanSummary('Terraform planning output without counts', '2')).toEqual({
      kind: 'empty',
    });
  });
});

describe('renderPlanSummary', () => {
  it('renders failure and no-change states directly', () => {
    expect(renderPlanSummary({ kind: 'failed' })).toBe(PLAN_FAILED_SUMMARY);
    expect(renderPlanSummary({ kind: 'no_changes' })).toBe(NO_CHANGES_SUMMARY);
  });

  it('renders an empty state as an empty string', () => {
    expect(renderPlanSummary({ kind: 'empty' })).toBe('');
  });

  it('renders themed counts from parsed summary data', () => {
    const summary = {
      kind: 'counts',
      counts: [
        { key: 'create', label: 'create', value: '1' },
        { key: 'destroy', label: 'destroy', value: '2' },
      ],
    };

    expect(renderPlanSummary(summary, 'minimal')).toBe(
      '[create] <strong>create</strong> <code>1</code> · ' +
      '[destroy] <strong>destroy</strong> <code>2</code>'
    );
  });
});

describe('stripRefreshNoise', () => {
  it('removes refresh and data source read noise', () => {
    const plan = [
      'aws_s3_bucket.site: Refreshing state... [id=site]',
      'data.aws_iam_policy_document.example: Reading...',
      'data.aws_iam_policy_document.example: Read complete after 0s [id=123]',
      '',
      'Terraform used the selected providers to generate the following execution plan.',
      '',
      'Plan: 1 to add, 0 to change, 0 to destroy.',
    ].join('\n');

    const result = stripRefreshNoise(plan);

    expect(result).not.toContain('Refreshing state');
    expect(result).not.toContain('Reading...');
    expect(result).not.toContain('Read complete after');
    expect(result).toContain('Terraform used the selected providers');
    expect(result).toContain('Plan: 1 to add');
  });

  it('collapses extra blank lines after filtering', () => {
    const plan = [
      'aws_s3_bucket.site: Refreshing state... [id=site]',
      '',
      '',
      'No changes. Your infrastructure matches the configuration.',
      '',
      '',
      'Terraform has compared your real infrastructure against your configuration.',
    ].join('\n');

    const result = stripRefreshNoise(plan);

    expect(result).toBe(
      'No changes. Your infrastructure matches the configuration.\n\n' +
      'Terraform has compared your real infrastructure against your configuration.'
    );
  });

  it('returns a neutral placeholder when every line is filtered as noise', () => {
    const plan = [
      'aws_s3_bucket.site: Refreshing state... [id=site]',
      'data.aws_iam_policy_document.example: Reading...',
      'data.aws_iam_policy_document.example: Read complete after 0s [id=123]',
    ].join('\n');

    const result = stripRefreshNoise(plan);

    expect(result).toBe(
      'No actionable Terraform plan output to display.'
    );
  });
});

describe('makeMarker', () => {
  it('generates unique markers for different directories', () => {
    const marker1 = makeMarker('.', 'default');
    const marker2 = makeMarker('infrastructure', 'default');
    expect(marker1).not.toBe(marker2);
    expect(marker1).toBe('<!-- terraform-plan-comment:root:default -->');
    expect(marker2).toBe('<!-- terraform-plan-comment:infrastructure:default -->');
  });

  it('generates unique markers for different workspaces', () => {
    const marker1 = makeMarker('.', 'default');
    const marker2 = makeMarker('.', 'staging');
    expect(marker1).not.toBe(marker2);
    expect(marker1).toBe('<!-- terraform-plan-comment:root:default -->');
    expect(marker2).toBe('<!-- terraform-plan-comment:root:staging -->');
  });

  it('normalizes directory paths', () => {
    const marker = makeMarker('infra/terraform/prod', 'default');
    expect(marker).toBe('<!-- terraform-plan-comment:infra-terraform-prod:default -->');
  });

  it('returns valid HTML comment', () => {
    const marker = makeMarker('.', 'default');
    expect(marker).toMatch(/^<!--.*-->$/);
  });
});
