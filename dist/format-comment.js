import fs from 'node:fs';
import { formatSummary, stripRefreshNoise, } from './helpers.js';
import { authenticatedAuthor, commentIdentity, identityMarker, selectOwnedComment } from './comment-identity.js';
import { formatDirectory, formatPlanBlock } from './comment-rendering.js';
import { parsePlanExitCode, parseSummaryTheme } from './config.js';
const GITHUB_COMMENT_LIMIT = 65000;
const environmentValue = (name, fallback) => {
    const value = process.env[name];
    return value === undefined || value === '' ? fallback : value;
};
export default async function formatComment({ github, context, core, }) {
    const workingDir = environmentValue('WORKING_DIR', '.');
    const workspace = environmentValue('TF_WORKSPACE', 'default');
    const commentNote = process.env.COMMENT_NOTE ?? '';
    try {
        const exitCode = parsePlanExitCode(process.env.PLAN_EXIT_CODE);
        const theme = parseSummaryTheme(process.env.SUMMARY_THEME);
        const plan = process.env.PLAN_FILE
            ? fs.readFileSync(process.env.PLAN_FILE, 'utf8')
            : (process.env.PLAN ?? '');
        const summary = formatSummary(plan, exitCode, theme);
        const displayPlan = stripRefreshNoise(plan);
        if (exitCode === '2') {
            core.info('I love it when a plan comes together.');
        }
        const identity = commentIdentity(workingDir, workspace);
        const marker = identityMarker(identity);
        const dirNote = workingDir !== '.' ? `\n📁 ${formatDirectory(workingDir)}\n` : '';
        const noteBlock = commentNote ? `\n${commentNote.trim()}\n` : '';
        const output = [
            marker,
            '### Terraform Plan',
            dirNote,
            noteBlock,
            `<details><summary>${summary ? summary : 'Show Plan'}</summary>`,
            '',
            formatPlanBlock(displayPlan),
            '',
            '</details>',
            '',
            `*Pusher: @${context.actor}, Action: \`${context.eventName}\`*`,
        ].join('\n');
        const postComment = async (body) => {
            const author = await authenticatedAuthor((query) => github.graphql(query));
            const listCommentsParams = {
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
            };
            const comments = typeof github.paginate === 'function'
                ? await github.paginate(github.rest.issues.listComments, listCommentsParams)
                : (await github.rest.issues.listComments(listCommentsParams)).data;
            const selected = selectOwnedComment(comments, author.id, identity);
            if (selected.matches > 1) {
                core.warning(`Found ${String(selected.matches)} owned comments for this plan; updating one deterministically and leaving the others untouched.`);
            }
            if (selected.comment) {
                const { data: comment } = await github.rest.issues.updateComment({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    comment_id: selected.comment.id,
                    body,
                });
                core.info(`${selected.migrated ? 'Migrated' : 'Updated'} comment ${String(comment.id)} owned by ${author.login}: ${comment.html_url}`);
            }
            else {
                const { data: comment } = await github.rest.issues.createComment({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    issue_number: context.issue.number,
                    body,
                });
                core.info(`Created comment ${String(comment.id)} owned by ${author.login}: ${comment.html_url}`);
            }
        };
        if (output.length > GITHUB_COMMENT_LIMIT) {
            core.warning(`Rendered plan comment is ${String(output.length)} characters, exceeding the action's ` +
                `${String(GITHUB_COMMENT_LIMIT)}-character limit; omitting full plan output from the comment.`);
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        core.setFailed(`Failed to post PR comment: ${message}`);
    }
}
