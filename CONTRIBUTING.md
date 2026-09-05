# Contributing

Thanks for your interest in contributing! If you have questions, aren't sure where to start, or are stuck,
reach out! I will help.

## Development Setup

Use Node.js 24 for local development.

```bash
# Clone the repo
git clone https://github.com/thekbb/terraform-plan-commenter-action.git
cd terraform-plan-commenter-action

# Install dependencies
npm install

# Run the same checks as the main CI job
npm run check

# Rebuild the checked-in runtime after changing TypeScript source
npm run build

# Run tests only
npm test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint

# Lint markdown
npm run lint:md

# Fix lint issues
npm run lint:fix
```

## Running Tests

```bash
npm run check              # Run lint, typecheck, build verification, docs lint, and coverage
npm run build              # Rebuild dist/ from TypeScript source
npm run build:check        # Verify dist/ matches TypeScript source
npm test                    # Run once
npm run test:watch          # Watch mode
```

The local suite tests the TypeScript plan runner with fake Terraform executables
to check exit handling, output capture, and temporary-file cleanup. Runner tests
are also TypeScript so they share the production contracts and type checking.

The repository also has GitHub-side end-to-end workflow tests in
`.github/workflows/e2e.yml`. Those jobs exercise the checked-in composite
action against real Terraform fixtures and verify the resulting PR-comment
behavior in GitHub Actions itself.

On same-repo pull requests, these tests leave one stable comment per scenario:

- smoke test
- large-plan truncation
- plan-failure

Each comment identifies itself as an automated end-to-end test artifact and is
expected to be updated by later runs of the same scenario.

## Making Changes

1. Fork the repository
1. Create a feature branch (`git checkout -b my-change`)
1. Make your changes
1. Run the local check suite (`npm run check`)
1. Commit with a descriptive message
1. Push and open a PR

## Releases

Use the workflow-driven release flow from a clean `main` checkout. Local release
verification requires Node.js 24, Git, GnuPG, and an authenticated GitHub CLI.

Before you start, make sure `main` already contains any changelog, code, or
documentation changes you want in the release.

To sanity-check the next release version locally:

```bash
npm run release:check -- 1.2.0
```

The normal release path is:

1. Run the `Prepare Release` workflow, which always prepares the release from `main`, with the target version.
2. Review and merge the generated `release-candidate/vX.Y.Z` pull request.
3. Verify and tag the exact resulting merge commit using the commands below.
   Later commits on `main` do not change the release candidate's identity.
4. Pushing the signed version tag automatically starts `Verify and Publish Release`
   (`.github/workflows/release.yml`). Its read-scoped verification job checks the
   release identity and runs the normal check suite. No draft needs to exist yet.
5. The write-scoped publication job re-verifies the release, creates a draft
   using the tagged changelog, publishes it, and confirms immutability.
6. After publication succeeds and the release is confirmed immutable, move the
   signed major tag to the same release commit using an explicit push lease.

Enable GitHub release immutability in repository settings before releasing.
Pushing a signed version tag is the publication authorization; there is no
separate manual dispatch or draft-creation step. Major tags do not trigger this
workflow. Both jobs use scoped `GITHUB_TOKEN` permissions. `RELEASE_PREP_PAT`
is used only to open release-candidate PRs that trigger normal CI.

`release:check` validates metadata without writing files. `release:prepare`
updates only `CHANGELOG.md`, `README.md`, `package.json`, and `package-lock.json`
in the current directory; rerunning it for an already prepared version preserves
the result. The workflow selects `main` and opens the release-candidate PR.
Neither command runs Git. The old `npm run release` command is removed, and
calling `scripts/release.mjs` without exactly one explicit mode fails.

### Release signature policy

`scripts/verify-release.ts` provides the shared checks used by both verification
and publication. It runs directly on Node.js 24 and is maintainer tooling, so it
does not add files to the action's generated `dist/` runtime.

- Tags must be annotated and have a valid OpenPGP signature from primary key
  `353AAFB21CE81D843634AD3EDE52EEA6AF0D8779` or one of its signing subkeys.
  Verification uses a temporary keyring and checks GnuPG's machine-readable
  fingerprint, independently of the operator's personal keyring.
- For the exact tagged SHA, GitHub must report `verification.verified: true`
  and `reason: valid`, with a signature and signed payload. The committer must
  be `web-flow`, with GitHub's `GitHub <noreply@github.com>` identity.
- That SHA must also be the recorded merge commit of a merged PR from this
  repository's `release-candidate/vX.Y.Z` branch into its `main` branch.
  Merge or squash-merge the PR through GitHub; local merges and rebase merges
  that do not satisfy this policy are rejected.

The commit policy trusts GitHub's API verification result; it does not perform
an independent local verification of GitHub's commit signature. All release
API requests explicitly target `github.com`, regardless of `GH_HOST`. See
[GitHub's signature verification documentation](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)
and the [commit API verification fields](https://docs.github.com/en/rest/commits/commits#get-a-commit).

### Create the version tag

Run this Bash block from the reviewed repository checkout, replacing the tag
and PR number placeholders. It selects the merged PR's commit, not `HEAD`.

```bash
set -euo pipefail
RELEASE_REPO=thekbb/terraform-plan-commenter-action
RELEASE_TAG=vX.Y.Z
RELEASE_PR=123
RELEASE_KEY=353AAFB21CE81D843634AD3EDE52EEA6AF0D8779

git fetch origin main --tags
RELEASE_SHA=$(gh api --hostname github.com "repos/$RELEASE_REPO/pulls/$RELEASE_PR" --jq '.merge_commit_sha')
node scripts/verify-release.ts commit "$RELEASE_REPO" "$RELEASE_SHA" "$RELEASE_TAG"
git merge-base --is-ancestor "$RELEASE_SHA" origin/main
git tag -s -u "$RELEASE_KEY" "$RELEASE_TAG" "$RELEASE_SHA" -m "Release $RELEASE_TAG"
node scripts/verify-release.ts tag "$RELEASE_TAG"
git push origin "refs/tags/$RELEASE_TAG"
```

Watch the automatically triggered workflow. Do not move the major tag while
verification or publication is pending.

### Move the major tag after publication

In the same Bash session, after the publication workflow succeeds:

```bash
node scripts/verify-release.ts tag "$RELEASE_TAG"
test "$(git rev-parse "$RELEASE_TAG^{commit}")" = "$RELEASE_SHA"
test "$(gh release view "$RELEASE_TAG" --repo "github.com/$RELEASE_REPO" \
  --json isDraft,isImmutable --jq '(.isDraft == false) and (.isImmutable == true)')" = true

RELEASE_MAJOR_TAG="${RELEASE_TAG%%.*}"
RELEASE_OLD_MAJOR_OID=$(git ls-remote --refs origin "refs/tags/$RELEASE_MAJOR_TAG" | cut -f1)
git tag -f -s -u "$RELEASE_KEY" "$RELEASE_MAJOR_TAG" "$RELEASE_SHA" -m "Release $RELEASE_TAG"
git push --force-with-lease="refs/tags/$RELEASE_MAJOR_TAG:$RELEASE_OLD_MAJOR_OID" \
  origin "refs/tags/$RELEASE_MAJOR_TAG"
```

The lease compares the remote tag object, not its peeled commit. An empty
expected value permits creating the first major tag only if it is still absent.
If the lease fails, inspect the remote change before deciding whether to retry;
do not blindly refresh the expected value and overwrite a newer release.

If verification or publication fails, leave the major tag at its previous
release. An existing version tag is never force-moved. If it points at the
wrong commit or requires code changes, prepare a new release version. An API
outage or temporarily unavailable merge metadata can be retried against the
same SHA using GitHub Actions' rerun controls on the original tag-push run.
If publication succeeded but the major-tag push failed, recover only
that final step after rechecking publication and the remote tag.

The publication job resumes an existing draft only when its tag, exact target
SHA, title, changelog notes, prerelease flag, and empty asset list match the
reviewed release. Conflicting drafts fail without being overwritten. A release
that is already published and immutable succeeds on rerun without writes.
API failures are never treated as proof that a release is absent.

Each job fetches the current tag and `main` and checks them against the original
event SHA. The tagged workflow files must still match `main`. A moved tag or
changed workflow tree blocks a rerun; prepare a new release version when code
changes are needed. Concurrent attempts for the same tag are serialized.

## Generated Runtime

This repository publishes a [composite action](https://docs.github.com/en/actions/creating-actions/creating-a-composite-action),
with its Node.js runtime compiled from `src/` into `dist/`. Commit both the
TypeScript source and generated runtime. CI rejects stale generated files with
`npm run build:check`.

The PR comment runtime is the first incremental move to TypeScript. The action
remains composite, and other runtime boundaries can migrate independently.

## Code Style

- ESLint enforces style rules
- Prefix unused function arguments with `_` (e.g., `_core`)
- Use single quotes for strings
- Always use semicolons
