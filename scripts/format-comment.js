// Format and post/update Terraform plan as PR comment
const { formatSummary, splitPlan, MARKER } = require('./helpers.cjs');

module.exports = async ({ github, context, core: _core }) => {
  const plan = process.env.PLAN || '';
  const exitCode = process.env.PLAN_EXIT_CODE || '0';
  const workingDir = process.env.WORKING_DIR || '.';

  const summary = formatSummary(plan, exitCode);
  const { refresh, changes } = splitPlan(plan);

  // Build plan content with collapsible refresh section
  const planContent = refresh
    ? [
        '<details><summary>State refresh</summary>',
        '',
        '```',
        refresh,
        '```',
        '</details>',
        '',
        '```terraform',
        changes,
        '```'
      ]
    : ['```terraform', plan, '```'];

  // Add working directory if not root
  const dirNote = workingDir !== '.' ? `\n📁 \`${workingDir}\`\n` : '';

  const output = [
    MARKER,
    '### Terraform Plan',
    dirNote,
    `<details><summary>${summary || 'Show Plan'}</summary>`,
    '',
    ...planContent,
    '',
    '</details>',
    '',
    `*Pusher: @${context.actor}, Action: \`${context.eventName}\`*`
  ].join('\n');

  // Handle truncation for large plans
  const postComment = async (body) => {
    const { data: comments } = await github.rest.issues.listComments({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
    });

    const botComment = comments.find(comment =>
      comment.user.type === 'Bot' && comment.body.includes(MARKER)
    );

    if (botComment) {
      await github.rest.issues.updateComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: botComment.id,
        body: body
      });
    } else {
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body: body
      });
    }
  };

  if (output.length > 65000) {
    const runUrl = `${process.env.GITHUB_SERVER_URL}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
    const truncated = [
      MARKER,
      '### Terraform Plan',
      dirNote,
      `⚠️ Plan output is too large for GitHub comment (${output.length.toLocaleString()} chars).`,
      '',
      `View the full plan in the [workflow run](${runUrl}).`,
      '',
      summary || '',
      '',
      `*Pusher: @${context.actor}*`
    ].join('\n');

    await postComment(truncated);
    return;
  }

  await postComment(output);
};
