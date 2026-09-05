# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| 1.x     | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please
[email us](mailto:security@thekbb.net?subject=terraform-plan-commenter-action%20security%20concern)
instead of opening a public issue.

We'll respond within 48 hours and work with you to understand and address the issue.

## Security Considerations

This action:

- Requires `pull-requests: write` to post PR comments
- Works with `${{ github.token }}` by default, so consumer workflows do not
  need an extra GitHub token just to post comments
- Posts plan output to a PR comment, so treat that output as potentially
  visible to anyone who can read the pull request
- Treats `init-args` and `plan-args` as trusted configuration only.
  Do not populate them from untrusted input such as PR content, comments,
  or manually entered dispatch fields without validation.

For stricter environments, pin to a full SHA:

```yaml
uses: thekbb/terraform-plan-commenter-action@<full-commit-sha>
```

## Trust Model & Limits

This repo ships a composite action with a checked-in JavaScript runtime compiled
from TypeScript. The release story is based on signed release tags, immutable
GitHub releases, and consumer pinning to a full commit SHA.

Use this action only if you are comfortable posting Terraform plan output back
to GitHub as a PR comment.

Do not use this action if:

- your plan output may reveal operational detail you do not want in PR comments
- you need attestation for a generated release artifact
- you would need to rely on `pull_request_target` for untrusted fork PRs

For fork PRs, prefer `pull_request`, not `pull_request_target`. Do not switch
to `pull_request_target` just to get comment permissions for untrusted forks.
Keep `init-args` and `plan-args` limited to trusted, repo-controlled values.

`verify-release.sh` checks that the release tag is signed, that it resolves to
the expected commit on `main`, and that the published GitHub release is
immutable. It does not prove anything about GitHub settings outside the repo,
and it does not prove artifact provenance because this repository does not
publish a built artifact.

Both jobs in the tag-push release workflow additionally pin the tag signature to primary key
`353AAFB21CE81D843634AD3EDE52EEA6AF0D8779`, using an isolated keyring. They require
GitHub's GraphQL evidence for the exact tagged commit: a valid `GpgSignature`,
`state: VALID`, `wasSignedByGitHub: true`, signer `web-flow`, and approved key ID
`B5690EEEBB952194`. Missing evidence or GraphQL errors block the release. They
also confirm the commit is the merge result of the corresponding same-repository
release-candidate PR into `main`. This commit check trusts GitHub's API,
explicitly on `github.com`; it is not independent local signature verification.
GitHub signing-key changes require reviewed policy updates in both action
repositories, following the [key-rotation procedure](CONTRIBUTING.md#github-signing-key-rotation).

Publication depends directly on successful verification in the same workflow.
It uses a job-scoped `GITHUB_TOKEN` with `contents: write`; verification has
`contents: read`. Both have `pull-requests: read` for the release-candidate
check. Both jobs compare the event SHA, checked-out SHA, current signed tag,
workflow ref and SHA, ancestry, workflow tree on `main`, and package metadata.
The publication job alone creates or resumes a draft and publishes it.

The signed major tag is updated only after verified immutable publication, with
an explicit push lease protecting against concurrent changes. See the
[release procedure and signature policy](CONTRIBUTING.md#releases).
