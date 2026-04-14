import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import formatComment from './format-comment.cjs';

const ORIGINAL_ENV = { ...process.env };

const baseContext = {
  actor: 'octocat',
  eventName: 'pull_request',
  issue: { number: 42 },
  repo: { owner: 'thekbb', repo: 'terraform-plan-commenter-action' },
  runId: 987654321,
};

const makeGithub = (overrides = {}) => {
  const listComments = vi.fn().mockResolvedValue({ data: [] });
  const createComment = vi.fn().mockResolvedValue({});
  const updateComment = vi.fn().mockResolvedValue({});

  return {
    rest: {
      issues: {
        listComments,
        createComment,
        updateComment,
      },
    },
    ...overrides,
  };
};

const makeCore = () => ({
  info: vi.fn(),
  setFailed: vi.fn(),
});

describe('format-comment action behavior', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      GITHUB_SERVER_URL: 'https://github.com',
      PLAN: 'Plan: 1 to add, 0 to change, 0 to destroy.',
      PLAN_EXIT_CODE: '2',
      WORKING_DIR: '.',
      TF_WORKSPACE: 'default',
      SUMMARY_THEME: 'default',
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('creates a PR comment when no matching bot comment exists', async () => {
    const github = makeGithub();
    const core = makeCore();

    await formatComment({ github, context: baseContext, core });

    expect(github.rest.issues.listComments).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'terraform-plan-commenter-action',
      issue_number: 42,
    });
    expect(github.rest.issues.createComment).toHaveBeenCalledTimes(1);
    expect(github.rest.issues.updateComment).not.toHaveBeenCalled();

    const [{ body }] = github.rest.issues.createComment.mock.calls[0];
    expect(body).toContain('<!-- terraform-plan-comment:root:default -->');
    expect(body).toContain('### Terraform Plan');
    expect(body).toContain('🟢 <strong>create</strong> <code>1</code>');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('removes refresh noise from the posted plan output', async () => {
    process.env.PLAN = [
      'aws_s3_bucket.site: Refreshing state... [id=site]',
      'data.aws_iam_policy_document.example: Reading...',
      'data.aws_iam_policy_document.example: Read complete after 0s [id=123]',
      '',
      'Terraform used the selected providers to generate the following execution plan.',
      '',
      'Plan: 1 to add, 0 to change, 0 to destroy.',
    ].join('\n');
    const github = makeGithub();
    const core = makeCore();

    await formatComment({ github, context: baseContext, core });

    const [{ body }] = github.rest.issues.createComment.mock.calls[0];
    expect(body).not.toContain('Refreshing state');
    expect(body).not.toContain('Reading...');
    expect(body).not.toContain('Read complete after');
    expect(body).toContain('Terraform used the selected providers');
    expect(body).toContain('Plan: 1 to add, 0 to change, 0 to destroy.');
  });

  it('updates the existing matching bot comment', async () => {
    const github = makeGithub();
    github.rest.issues.listComments.mockResolvedValue({
      data: [
        {
          id: 7,
          user: { type: 'Bot' },
          body: '<!-- terraform-plan-comment:root:default -->\nold body',
        },
      ],
    });
    const core = makeCore();

    await formatComment({ github, context: baseContext, core });

    expect(github.rest.issues.updateComment).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'terraform-plan-commenter-action',
      comment_id: 7,
      body: expect.stringContaining('### Terraform Plan'),
    });
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('uses GitHub pagination when available to find an existing comment', async () => {
    const github = makeGithub({
      paginate: vi.fn().mockResolvedValue([
        {
          id: 55,
          user: { type: 'Bot' },
          body: '<!-- terraform-plan-comment:root:default -->\npaginated body',
        },
      ]),
    });
    const core = makeCore();

    await formatComment({ github, context: baseContext, core });

    expect(github.paginate).toHaveBeenCalledWith(
      github.rest.issues.listComments,
      {
        owner: 'thekbb',
        repo: 'terraform-plan-commenter-action',
        issue_number: 42,
      }
    );
    expect(github.rest.issues.updateComment).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'terraform-plan-commenter-action',
      comment_id: 55,
      body: expect.stringContaining('### Terraform Plan'),
    });
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('creates a separate comment for a non-root working directory', async () => {
    process.env.WORKING_DIR = 'infrastructure/prod';
    const github = makeGithub();
    github.rest.issues.listComments.mockResolvedValue({
      data: [
        {
          id: 9,
          user: { type: 'Bot' },
          body: '<!-- terraform-plan-comment:root:default -->\nroot comment',
        },
      ],
    });
    const core = makeCore();

    await formatComment({ github, context: baseContext, core });

    expect(github.rest.issues.updateComment).not.toHaveBeenCalled();
    expect(github.rest.issues.createComment).toHaveBeenCalledTimes(1);

    const [{ body }] = github.rest.issues.createComment.mock.calls[0];
    expect(body).toContain('<!-- terraform-plan-comment:infrastructure-prod:default -->');
    expect(body).toContain('📁 `infrastructure/prod`');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('posts a workflow-run link when the plan is too large for a GitHub comment', async () => {
    process.env.PLAN = `Plan: 1 to add, 0 to change, 0 to destroy.${'x'.repeat(70000)}`;
    const github = makeGithub();
    const core = makeCore();

    await formatComment({ github, context: baseContext, core });

    const [{ body }] = github.rest.issues.createComment.mock.calls[0];
    expect(body).toContain('Plan output is too large for GitHub comment');
    expect(body).toContain(
      'https://github.com/thekbb/terraform-plan-commenter-action/actions/runs/987654321'
    );
    expect(body).not.toContain('```terraform');
    expect(body).not.toContain('State refresh');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('reports API failures through core.setFailed', async () => {
    const github = makeGithub();
    github.rest.issues.listComments.mockRejectedValue(new Error('permission denied'));
    const core = makeCore();

    await formatComment({ github, context: baseContext, core });

    expect(core.setFailed).toHaveBeenCalledWith(
      'Failed to post PR comment: permission denied'
    );
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
    expect(github.rest.issues.updateComment).not.toHaveBeenCalled();
  });
});
