import fs from 'node:fs';
import {
  formatSummary,
  makeMarker,
  stripRefreshNoise,
} from './helpers.js';

interface IssueComment {
  readonly id: number;
  readonly user: { readonly type: string };
  readonly body: string;
}

interface RepoRef {
  readonly owner: string;
  readonly repo: string;
}

interface ActionContext {
  readonly actor: string;
  readonly eventName: string;
  readonly issue: { readonly number: number };
  readonly repo: RepoRef;
  readonly runId: number;
}

interface ActionCore {
  info(message: string): void;
  setFailed(message: string): void;
}

interface ListCommentsParams {
  readonly owner: string;
  readonly repo: string;
  readonly issue_number: number;
}

interface GithubClient {
  readonly rest: {
    readonly issues: {
      readonly listComments: (
        params: ListCommentsParams
      ) => Promise<{ readonly data: IssueComment[] }>;
      readonly createComment: (
        params: ListCommentsParams & { readonly body: string }
      ) => Promise<unknown>;
      readonly updateComment: (params: {
        readonly owner: string;
        readonly repo: string;
        readonly comment_id: number;
        readonly body: string;
      }) => Promise<unknown>;
    };
  };
  readonly paginate?: (
    fn: (
      params: ListCommentsParams
    ) => Promise<{ readonly data: IssueComment[] }>,
    params: ListCommentsParams
  ) => Promise<IssueComment[]>;
}

export interface FormatCommentOptions {
  readonly github: GithubClient;
  readonly context: ActionContext;
  readonly core: ActionCore;
}

const GITHUB_COMMENT_LIMIT = 65000;

const environmentValue = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
};

export default async function formatComment({
  github,
  context,
  core,
}: FormatCommentOptions): Promise<void> {
  const exitCode = environmentValue('PLAN_EXIT_CODE', '0');
  const workingDir = environmentValue('WORKING_DIR', '.');
  const workspace = environmentValue('TF_WORKSPACE', 'default');
  const theme = environmentValue('SUMMARY_THEME', 'default');
  const commentNote = process.env.COMMENT_NOTE ?? '';

  try {
    const plan = process.env.PLAN_FILE
      ? fs.readFileSync(process.env.PLAN_FILE, 'utf8')
      : (process.env.PLAN ?? '');
    const summary = formatSummary(plan, exitCode, theme);
    const displayPlan = stripRefreshNoise(plan);

    if (exitCode === '2') {
      core.info('I love it when a plan comes together.');
    }

    const marker = makeMarker(workingDir, workspace);
    const dirNote = workingDir !== '.' ? `\n📁 \`${workingDir}\`\n` : '';
    const noteBlock = commentNote ? `\n${commentNote.trim()}\n` : '';

    const output = [
      marker,
      '### Terraform Plan',
      dirNote,
      noteBlock,
      `<details><summary>${summary ? summary : 'Show Plan'}</summary>`,
      '',
      '```terraform',
      displayPlan,
      '```',
      '',
      '</details>',
      '',
      `*Pusher: @${context.actor}, Action: \`${context.eventName}\`*`,
    ].join('\n');

    const postComment = async (body: string): Promise<void> => {
      const listCommentsParams: ListCommentsParams = {
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
      };
      const comments = typeof github.paginate === 'function'
        ? await github.paginate(
          github.rest.issues.listComments,
          listCommentsParams
        )
        : (await github.rest.issues.listComments(listCommentsParams)).data;

      const botComment = comments.find((comment) =>
        comment.user.type === 'Bot' && comment.body.includes(marker)
      );

      if (botComment) {
        await github.rest.issues.updateComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          comment_id: botComment.id,
          body,
        });
      } else {
        await github.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: context.issue.number,
          body,
        });
      }
    };

    if (output.length > GITHUB_COMMENT_LIMIT) {
      const githubServerUrl = process.env.GITHUB_SERVER_URL;
      const runUrl = githubServerUrl
        ? `${githubServerUrl}/${context.repo.owner}/${context.repo.repo}` +
          `/actions/runs/${String(context.runId)}`
        : null;
      const truncated = [
        marker,
        '### Terraform Plan',
        dirNote,
        noteBlock,
        '⚠️ Plan output is too large for GitHub comment ' +
        `(${output.length.toLocaleString()} chars).`,
        '',
        runUrl ? `View the full plan in the [workflow run](${runUrl}).` : '',
        '',
        summary,
        '',
        `*Pusher: @${context.actor}*`,
      ].join('\n');

      await postComment(truncated);
      return;
    }

    await postComment(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Failed to post PR comment: ${message}`);
  }
}
