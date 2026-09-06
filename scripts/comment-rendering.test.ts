import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDirectory, formatPlanBlock } from '../src/comment-rendering.js';
import { makeMarker } from '../src/comment-identity.js';
import formatComment, { type FormatCommentOptions } from '../src/format-comment.js';

afterEach(() => { vi.unstubAllEnvs(); });

describe('literal plan and directory rendering', () => {
  it('keeps the usual Terraform fence for ordinary plan text', () => {
    const plan = 'Plan: 1 to add, 0 to change, 0 to destroy.';
    expect(formatPlanBlock(plan)).toBe(`\`\`\`terraform\n${plan}\n\`\`\``);
  });

  it('uses a fence longer than all backtick runs, preserving the plan as data', () => {
    const plan = '```\n</details>\n# Forged heading\n@someone\n````\n<script>alert(1)</script>';
    expect(formatPlanBlock(plan)).toBe(`\`\`\`\`\`terraform\n${plan}\n\`\`\`\`\``);
  });

  it('renders directory backticks, HTML, mentions, and control characters as inline text', () => {
    const directory = '`infra`\n</details>\r\n# heading\t@someone';
    expect(formatDirectory(directory)).toBe('`` `infra`\\n</details>\\r\\n# heading\\t@someone ``');
    expect(formatDirectory('infra\\nprod')).toBe('`infra\\\\nprod`');
    expect(formatDirectory('<b>@someone</b>')).toBe('`<b>@someone</b>`');
    expect(formatDirectory('infra/``prod``')).toBe('``` infra/``prod`` ```');
  });

  it('preserves ordinary paths and meaningful directory whitespace', () => {
    expect(formatDirectory('infra/prod')).toBe('`infra/prod`');
    expect(formatDirectory(' infra ')).toBe('`  infra  `');
    expect(formatDirectory('   ')).toBe('`   `');
  });
});

describe('posted comment rendering', () => {
  it.each([false, true])('uses safe directory rendering and trusted notes (truncated: %s)', async (truncated) => {
    const directory = '`infra`\n</details>\n# Forged heading';
    const plan = truncated ? 'x'.repeat(70000) : '```\n</details>\n@someone\nPlan: 1 to add, 0 to change, 0 to destroy.';
    vi.stubEnv('WORKING_DIR', directory);
    vi.stubEnv('TF_WORKSPACE', 'default');
    vi.stubEnv('PLAN_FILE', '');
    vi.stubEnv('PLAN', plan);
    vi.stubEnv('PLAN_EXIT_CODE', '2');
    vi.stubEnv('SUMMARY_THEME', 'default');
    vi.stubEnv('COMMENT_NOTE', '**Trusted note**\n[Runbook](https://example.com/runbook)');
    type Issues = FormatCommentOptions['github']['rest']['issues'];
    const createComment = vi.fn<Issues['createComment']>(() => Promise.resolve({
      data: { id: 2, html_url: 'https://github.com/owner/repo/pull/5#issuecomment-2' },
    }));
    const setFailed = vi.fn<FormatCommentOptions['core']['setFailed']>();
    await formatComment({
      github: {
        graphql: () => Promise.resolve({ viewer: { databaseId: 42, login: 'github-actions[bot]' } }),
        rest: { issues: {
          listComments: () => Promise.resolve({ data: [] }),
          createComment,
          updateComment: vi.fn<Issues['updateComment']>(({ comment_id }) => Promise.resolve({
            data: { id: comment_id, html_url: `https://github.com/owner/repo/pull/5#issuecomment-${String(comment_id)}` },
          })),
        } },
      },
      context: { actor: 'actor', eventName: 'pull_request', issue: { number: 5 }, repo: { owner: 'owner', repo: 'repo' }, runId: 123 },
      core: { info: vi.fn(), warning: vi.fn(), setFailed },
    });
    expect(setFailed).not.toHaveBeenCalled();
    expect(createComment).toHaveBeenCalledOnce();
    const body = createComment.mock.calls[0]?.[0].body;
    expect(body).toContain(`${makeMarker(directory)}\n### Terraform Plan`);
    expect(body).toContain('📁 `` `infra`\\n</details>\\n# Forged heading ``');
    expect(body).toContain('**Trusted note**\n[Runbook](https://example.com/runbook)');
    if (truncated) {
      expect(body).toContain('Plan output is too large');
      expect(body).not.toContain(plan);
    } else {
      expect(body).toContain(`\`\`\`\`terraform\n${plan}\n\`\`\`\``);
    }
  });
});
