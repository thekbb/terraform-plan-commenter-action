const { formatSummary, stripRefreshNoise, makeMarker } = require('./helpers.cjs');

module.exports = async ({ github, context, core }) => {
  const plan = process.env.PLAN || '';
  const exitCode = process.env.PLAN_EXIT_CODE || '0';
  const workingDir = process.env.WORKING_DIR || '.';
  const workspace = process.env.TF_WORKSPACE || 'default';
  const theme = process.env.SUMMARY_THEME || 'default';

  try {
    const summary = formatSummary(plan, exitCode, theme);
    const displayPlan = stripRefreshNoise(plan);

    if (exitCode === '2') {
      core.info('I love it when a plan comes together.');
    }

    const marker = makeMarker(workingDir, workspace);
    const dirNote = workingDir !== '.' ? `\n📁 \`${workingDir}\`\n` : '';

    const output = [
      marker,
      '### Terraform Plan',
      dirNote,
      `<details><summary>${summary || 'Show Plan'}</summary>`,
      '',
      '```terraform',
      displayPlan,
      '```',
      '',
      '</details>',
      '',
      `*Pusher: @${context.actor}, Action: \`${context.eventName}\`*`
    ].join('\n');

    const GITHUB_COMMENT_LIMIT = 65000;
    const postComment = async (body) => {
      const listCommentsParams = {
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
      };
      const comments = typeof github.paginate === 'function'
        ? await github.paginate(github.rest.issues.listComments, listCommentsParams)
        : (await github.rest.issues.listComments(listCommentsParams)).data;

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

    if (output.length > GITHUB_COMMENT_LIMIT) {
      const githubServerUrl = process.env.GITHUB_SERVER_URL;
      const runUrl = githubServerUrl
        ? `${githubServerUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`
        : null;
      const truncated = [
        marker,
        '### Terraform Plan',
        dirNote,
        `⚠️ Plan output is too large for GitHub comment (${output.length.toLocaleString()} chars).`,
        '',
        runUrl ? `View the full plan in the [workflow run](${runUrl}).` : '',
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
