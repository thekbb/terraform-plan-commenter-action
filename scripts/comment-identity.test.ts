import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticatedAuthor, commentIdentity, makeMarker, selectOwnedComment, type IssueComment } from '../src/comment-identity.js';
import formatComment, { type FormatCommentOptions } from '../src/format-comment.js';

afterEach(() => { vi.unstubAllEnvs(); });

const owned = (id: number, body: string): IssueComment => ({ id, user: { id: 42 }, body });

describe('comment identity and migration', () => {
  it('separates formerly colliding directories, workspaces, and literal root paths', () => {
    expect(makeMarker('infra/prod')).not.toBe(makeMarker('infra-prod'));
    expect(makeMarker('.')).not.toBe(makeMarker('root'));
    expect(makeMarker('.')).not.toBe(makeMarker('/'));
    expect(makeMarker('a:b', 'c')).not.toBe(makeMarker('a', 'b:c'));
    expect(makeMarker('infra')).not.toBe(makeMarker(' infra '));
  });

  it('keeps untrusted directory and workspace text out of the HTML marker', () => {
    expect(makeMarker('infra-->\n<script>', 'default-->')).toMatch(/^<!-- terraform-plan-comment:v2:[a-f0-9]{64} -->$/u);
  });

  it('matches only the authenticated author and the leading identity marker', () => {
    const marker = makeMarker('.');
    const comments: IssueComment[] = [
      { id: 1, user: { id: 9 }, body: marker },
      { id: 2, user: null, body: marker },
      { id: 3, user: { id: 42 }, body: null },
      owned(4, `quoted plan\n${marker}`), owned(5, `${marker}\nPlan`),
    ];
    expect(selectOwnedComment(comments, 42, commentIdentity('.')).comment?.id).toBe(5);
  });

  it('uses directory metadata to disambiguate legacy markers', () => {
    const prefix = '<!-- terraform-plan-comment:infra-prod:default -->\n### Terraform Plan\n\n📁 ';
    const comments = [owned(1, `${prefix}\`infra-prod\`\n\nPlan`), owned(2, `${prefix}\`./infra/prod/\`\n\nPlan`)];
    const selected = selectOwnedComment(comments, 42, commentIdentity('infra/prod'));
    expect(selected.comment?.id).toBe(2);
    expect(selected.migrated).toBe(true);
  });

  it('does not adopt ambiguous legacy bodies or markers embedded in plan text', () => {
    const marker = '<!-- terraform-plan-comment:infra-prod:default -->';
    const comments = [owned(1, `${marker}\nold body`), owned(2, `plan\n${marker}\n### Terraform Plan\n\n📁 \`infra/prod\`\n`)];
    expect(selectOwnedComment(comments, 42, commentIdentity('infra/prod')).comment).toBeUndefined();
  });

  it('distinguishes the repository root from a legacy comment for a directory named root', () => {
    const prefix = '<!-- terraform-plan-comment:root:default -->\n### Terraform Plan\n';
    const comments = [owned(1, `${prefix}\n📁 \`root\`\n\nPlan`), owned(2, `${prefix}\n\n<details>Plan`)];
    expect(selectOwnedComment(comments, 42, commentIdentity('.')).comment?.id).toBe(2);
    expect(selectOwnedComment(comments, 42, commentIdentity('root')).comment?.id).toBe(1);
  });

  it('prefers the oldest current marker over legacy matches regardless of API order', () => {
    const comments = [
      owned(20, makeMarker('.')), owned(1, '<!-- terraform-plan-comment:root:default -->\n### Terraform Plan\n\n\nPlan'),
      owned(10, makeMarker('.')),
    ];
    const selected = selectOwnedComment(comments, 42, commentIdentity('.'));
    expect(selected.comment?.id).toBe(10);
    expect(selected.matches).toBe(3);
    expect(selected.migrated).toBe(false);
    expect(comments.map((comment) => comment.id)).toEqual([20, 1, 10]);
  });
});

describe('authenticated comment ownership', () => {
  it('requires usable authenticated identity evidence', async () => {
    await expect(authenticatedAuthor(() => Promise.resolve({ viewer: null }))).rejects.toThrow('authenticated comment author');
  });

  it.each(['github-actions[bot]', 'release-app[bot]', 'pat-owner'])(
    'updates only comments owned by the token principal %s on subsequent runs', async (login) => {
      vi.stubEnv('WORKING_DIR', '.');
      vi.stubEnv('TF_WORKSPACE', 'default');
      vi.stubEnv('PLAN_FILE', '');
      vi.stubEnv('PLAN', 'Plan: 1 to add, 0 to change, 0 to destroy.');
      vi.stubEnv('PLAN_EXIT_CODE', '2');
      const comments: IssueComment[] = [{ id: 1, user: { id: 99 }, body: makeMarker('.') }];
      type Issues = FormatCommentOptions['github']['rest']['issues'];
      const listComments = vi.fn<Issues['listComments']>(() => Promise.resolve({ data: comments }));
      const createComment = vi.fn<Issues['createComment']>(({ body }) => {
        comments.push(owned(2, body));
        return Promise.resolve({});
      });
      const updateComment = vi.fn<Issues['updateComment']>(() => Promise.resolve({}));
      const graphql = vi.fn<FormatCommentOptions['github']['graphql']>(() => Promise.resolve({ viewer: { databaseId: 42, login } }));
      const warning = vi.fn<FormatCommentOptions['core']['warning']>();
      const setFailed = vi.fn<FormatCommentOptions['core']['setFailed']>();
      const options: FormatCommentOptions = {
        github: { graphql, rest: { issues: { listComments, createComment, updateComment } } },
        context: { actor: 'someone-else', eventName: 'pull_request', issue: { number: 5 }, repo: { owner: 'owner', repo: 'repo' }, runId: 123 },
        core: { info: vi.fn(), warning, setFailed },
      };
      await formatComment(options);
      await formatComment(options);
      expect(createComment).toHaveBeenCalledOnce();
      expect(updateComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 2 }));
      expect(setFailed).not.toHaveBeenCalled();

      comments.push(owned(3, makeMarker('.')));
      await formatComment(options);
      expect(warning).toHaveBeenCalledOnce();
      expect(updateComment).toHaveBeenLastCalledWith(expect.objectContaining({ comment_id: 2 }));

      graphql.mockRejectedValueOnce(new Error('Identity lookup failed'));
      await formatComment(options);
      expect(setFailed).toHaveBeenCalledWith(expect.stringContaining('Identity lookup failed'));
      expect(createComment).toHaveBeenCalledOnce();
      expect(updateComment).toHaveBeenCalledTimes(2);
    }
  );
});
