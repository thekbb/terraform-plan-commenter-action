import { describe, it, expect } from 'vitest';
import { formatSummary, splitPlan, MARKER } from './helpers.cjs';

describe('formatSummary', () => {
  it('returns no changes for exit code 0', () => {
    const result = formatSummary('Some plan output', '0');
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

  it('parses add/change/destroy counts', () => {
    const plan = 'Plan: 3 to add, 1 to change, 2 to destroy.';
    const result = formatSummary(plan, '2');
    expect(result).toBe(
      '🟢 <strong>create</strong> <code>3</code> · ' +
      '🟡 <strong>update</strong> <code>1</code> · ' +
      '🔴 <strong>destroy</strong> <code>2</code>'
    );
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

  it('handles large numbers', () => {
    const plan = 'Plan: 100 to add, 50 to change, 25 to destroy.';
    const result = formatSummary(plan, '2');
    expect(result).toContain('<code>100</code>');
    expect(result).toContain('<code>50</code>');
    expect(result).toContain('<code>25</code>');
  });
});

describe('splitPlan', () => {
  it('splits plan at provider message', () => {
    const plan = `aws_s3_bucket.site: Refreshing state...
aws_lambda_function.api: Refreshing state...

Terraform used the selected providers to generate the following execution plan.

Plan: 1 to add, 0 to change, 0 to destroy.`;

    const { refresh, changes } = splitPlan(plan);

    expect(refresh).toContain('Refreshing state');
    expect(refresh).not.toContain('Terraform used');
    expect(changes).toContain('Terraform used the selected providers');
    expect(changes).toContain('Plan: 1 to add');
  });

  it('returns full plan as changes when no refresh section', () => {
    const plan = `Terraform used the selected providers to generate the following execution plan.

Plan: 0 to add, 0 to change, 0 to destroy.`;

    const { refresh, changes } = splitPlan(plan);

    expect(refresh).toBe('');
    expect(changes).toBe(plan);
  });

  it('handles empty plan', () => {
    const { refresh, changes } = splitPlan('');
    expect(refresh).toBe('');
    expect(changes).toBe('');
  });
});

describe('MARKER', () => {
  it('is an HTML comment', () => {
    expect(MARKER).toMatch(/^<!--.*-->$/);
  });
});
