// Format and post/update Terraform plan as PR comment
const { formatSummary, splitPlan, makeMarker } = require('./helpers.cjs');

module.exports = async ({ github, context, core }) => {
  const plan = process.env.PLAN || '';
  const exitCode = process.env.PLAN_EXIT_CODE || '0';
  const workingDir = process.env.WORKING_DIR || '.';
  const workspace = process.env.TF_WORKSPACE || 'default';
  const theme = process.env.SUMMARY_THEME || 'default';

  try {
    const summary = formatSummary(plan, exitCode, theme);
    const { refresh, changes } = splitPlan(plan);

    if (exitCode === '2') {
      core.info('I love it when a plan comes together.');
    }

    // Generate unique marker for this workspace/directory
    const marker = makeMarker(workingDir, workspace);

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
      marker,
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

    // GitHub's comment limit is 65,536 characters
    // We use 65,000 as a safety buffer to account for markdown rendering
    const GITHUB_COMMENT_LIMIT = 65000;

    // Handle truncation for large plans
    const postComment = async (body) => {
      const { data: comments } = await github.rest.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
      });

      const botComment = comments.find(comment =>
        comment.user.type === 'Bot' && comment.body.includes(marker)
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

    // If output is too large, try dropping state refresh first (it's less critical than the plan)
    if (output.length > GITHUB_COMMENT_LIMIT) {
      if (refresh) {
        // Try without refresh section
        const outputWithoutRefresh = [
          marker,
          '### Terraform Plan',
          dirNote,
          `<details><summary>${summary || 'Show Plan'}</summary>`,
          '',
          '```terraform',
          changes,
          '```',
          '',
          '</details>',
          '',
          '_State refresh output omitted due to size._',
          '',
          `*Pusher: @${context.actor}, Action: \`${context.eventName}\`*`
        ].join('\n');

        if (outputWithoutRefresh.length <= GITHUB_COMMENT_LIMIT) {
          await postComment(outputWithoutRefresh);
          return;
        }
      }

      // Still too large even without refresh - show truncated message
      const runUrl = `${process.env.GITHUB_SERVER_URL}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
      const truncated = [
        marker,
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

  } catch (error) {
    core.setFailed(`Failed to post PR comment: ${error.message}`);
  }
};
