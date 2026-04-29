#!/usr/bin/env bash

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/thekbb/terraform-plan-commenter-action.git}"
TAG_REGEX='^v[0-9]+\.[0-9]+\.[0-9]+$'
SHA_REGEX='^[0-9a-fA-F]{40}$'

usage() {
  cat <<'EOF'
Usage:
  ./verify-release.sh --tag v2.0.0
  ./verify-release.sh --sha 0123456789abcdef0123456789abcdef01234567

Exactly one of --tag or --sha is required.
The script runs every verification check it can and exits nonzero if any check fails.

Options:
  --tag       Semver release tag with a leading "v"
  --sha       Full 40-character commit SHA
  --no-color  Disable ANSI color output
  --help      Show this help text

Environment:
  REPO_URL           Git remote to verify against
  GITHUB_REPOSITORY  Optional owner/repo override for release API checks
  GITHUB_API_URL     Optional GitHub API base URL override
  GITHUB_TOKEN       Optional token for private repos or higher API rate limits
EOF
}

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

compact_message() {
  local text="$1"
  text="${text//$'\n'/ }"
  printf '%s' "$text" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

extract_signature_summary() {
  local output="$1"
  local summary=''

  summary="$(printf '%s\n' "$output" | grep -m1 'Good signature from' || true)"
  if [[ -n "$summary" ]]; then
    printf '%s' "$summary"
    return
  fi

  printf '%s' "$(compact_message "$output")"
}

format_status() {
  local status="$1"
  local text=''
  local color=''
  local reset=''

  case "$status" in
    PASS)
      text='OK'
      color=$'\033[32m'
      ;;
    FAIL)
      text='FAIL'
      color=$'\033[31m'
      ;;
    SKIP)
      text='SKIP'
      color=$'\033[33m'
      ;;
    *)
      fail "unknown status: $status"
      ;;
  esac

  if ((use_color)); then
    reset=$'\033[0m'
    printf '%s%s%s' "$color" "$text" "$reset"
  else
    printf '%s' "$text"
  fi
}

emit_result() {
  local status="$1"
  local label="$2"
  local detail="${3:-}"
  local display_status=''

  case "$status" in
    PASS) ;;
    FAIL) overall_failed=1 ;;
    SKIP) ;;
    *) fail "unknown status: $status" ;;
  esac

  display_status="$(format_status "$status")"

  if [[ -n "$detail" ]]; then
    printf '[%s] %s: %s\n' "$display_status" "$label" "$detail"
  else
    printf '[%s] %s\n' "$display_status" "$label"
  fi
}

parse_github_repo() {
  local remote_url="$1"
  local host=''
  local path=''

  case "$remote_url" in
    https://*/*|http://*/*)
      remote_url="${remote_url#http://}"
      remote_url="${remote_url#https://}"
      host="${remote_url%%/*}"
      path="${remote_url#*/}"
      ;;
    ssh://git@*/*)
      remote_url="${remote_url#ssh://git@}"
      host="${remote_url%%/*}"
      path="${remote_url#*/}"
      ;;
    git@*:*/*)
      remote_url="${remote_url#git@}"
      host="${remote_url%%:*}"
      path="${remote_url#*:}"
      ;;
    *)
      return 1
      ;;
  esac

  host="${host##*@}"
  path="${path%.git}"
  [[ "$path" == */* ]] || return 1

  github_host="$host"
  github_owner="${path%%/*}"
  github_repo="${path#*/}"
  github_repo="${github_repo%%/*}"

  [[ -n "$github_host" && -n "$github_owner" && -n "$github_repo" ]] || return 1
}

resolve_github_repo() {
  local remote_url="$REPO_URL"

  if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
    github_owner="${GITHUB_REPOSITORY%%/*}"
    github_repo="${GITHUB_REPOSITORY#*/}"
    github_host='github.com'
    [[ -n "$github_owner" && -n "$github_repo" && "$github_repo" != "$GITHUB_REPOSITORY" ]] || return 1
    return 0
  fi

  if [[ -e "$REPO_URL" ]] && git -C "$REPO_URL" rev-parse --git-dir >/dev/null 2>&1; then
    remote_url="$(git -C "$REPO_URL" remote get-url origin 2>/dev/null || true)"
  fi

  parse_github_repo "$remote_url"
}

collect_release_metadata() {
  local lookup_tag="$1"
  local api_base=''
  local api_url=''
  local release_file="$tmp_dir/release.json"
  local http_status=''
  local compact_json=''
  local -a curl_args=()

  release_lookup_state='FAIL'
  release_lookup_detail=''
  immutable_state='SKIP'
  immutable_detail='release metadata unavailable'

  if ! resolve_github_repo; then
    release_lookup_detail='unable to derive GitHub owner/repo; set GITHUB_REPOSITORY=owner/repo'
    immutable_detail='GitHub repository could not be determined'
    return
  fi

  if [[ -n "${GITHUB_API_URL:-}" ]]; then
    api_base="${GITHUB_API_URL%/}"
  elif [[ "$github_host" == 'github.com' ]]; then
    api_base='https://api.github.com'
  else
    api_base="https://${github_host}/api/v3"
  fi

  api_url="${api_base}/repos/${github_owner}/${github_repo}/releases/tags/${lookup_tag}"
  curl_args=(
    -sS
    -o
    "$release_file"
    -w
    '%{http_code}'
    -H
    'Accept: application/vnd.github+json'
    -H
    'X-GitHub-Api-Version: 2026-03-10'
  )

  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl_args+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  fi

  if ! http_status="$(curl "${curl_args[@]}" "$api_url")"; then
    release_lookup_detail="failed to query GitHub release metadata at ${api_url}"
    immutable_detail='GitHub release metadata request failed'
    return
  fi

  case "$http_status" in
    200)
      release_lookup_state='PASS'
      release_lookup_detail="published release ${lookup_tag} exists on GitHub"
      compact_json="$(tr -d '[:space:]' < "$release_file")"
      if [[ "$compact_json" == *'"immutable":true'* || "$compact_json" == *'"isImmutable":true'* ]]; then
        immutable_state='PASS'
        immutable_detail="release ${lookup_tag} is marked immutable by GitHub"
      else
        immutable_state='FAIL'
        immutable_detail="release ${lookup_tag} is not marked immutable by GitHub"
      fi
      ;;
    404)
      release_lookup_detail="published GitHub release not found for ${lookup_tag}"
      immutable_detail='published release not found'
      ;;
    *)
      release_lookup_detail="GitHub release metadata request failed with HTTP ${http_status} at ${api_url}"
      immutable_detail='GitHub release metadata request failed'
      ;;
  esac
}

use_color=1
overall_failed=0
resolved_tag=''
resolved_sha=''
github_host=''
github_owner=''
github_repo=''
release_lookup_state='SKIP'
release_lookup_detail=''
immutable_state='SKIP'
immutable_detail=''

if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

requested_tag=''
requested_sha=''

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      [[ $# -ge 2 ]] || fail '--tag requires a value'
      requested_tag="$2"
      shift 2
      ;;
    --sha)
      [[ $# -ge 2 ]] || fail '--sha requires a value'
      requested_sha="$2"
      shift 2
      ;;
    --no-color)
      use_color=0
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

if [[ -n "$requested_tag" && -n "$requested_sha" ]]; then
  fail 'use exactly one of --tag or --sha'
fi

if [[ -z "$requested_tag" && -z "$requested_sha" ]]; then
  fail 'exactly one of --tag or --sha is required'
fi

if [[ -n "$requested_tag" && ! "$requested_tag" =~ $TAG_REGEX ]]; then
  fail "invalid tag: ${requested_tag}"
fi

if [[ -n "$requested_sha" && ! "$requested_sha" =~ $SHA_REGEX ]]; then
  fail "invalid SHA: ${requested_sha}"
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/verify-release.XXXXXX")"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

repo_dir="$tmp_dir/repo"

if git clone --quiet --no-checkout "$REPO_URL" "$repo_dir" >/dev/null 2>&1; then
  emit_result PASS 'Fetch remote refs' "$REPO_URL"
else
  emit_result FAIL 'Fetch remote refs' "unable to clone ${REPO_URL}"
  printf '\nOverall: FAIL\n'
  exit 1
fi

git -C "$repo_dir" fetch --quiet origin main --tags --force

if [[ -n "$requested_tag" ]]; then
  if git -C "$repo_dir" rev-parse "refs/tags/${requested_tag}" >/dev/null 2>&1; then
    resolved_tag="$requested_tag"
    resolved_sha="$(git -C "$repo_dir" rev-parse "${requested_tag}^{commit}")"
    emit_result PASS 'Release tag exists' "$requested_tag"
    emit_result PASS 'Tag resolves to commit' "${requested_tag} -> ${resolved_sha}"
  else
    emit_result FAIL 'Release tag exists' "$requested_tag"
    printf '\nOverall: FAIL (%s)\n' "$requested_tag"
    exit 1
  fi
else
  resolved_sha="$requested_sha"
  emit_result PASS 'Release commit provided' "$resolved_sha"
  tag_from_sha="$(git -C "$repo_dir" tag --points-at "$resolved_sha" | grep -E "$TAG_REGEX" | head -n1 || true)"
  if [[ -n "$tag_from_sha" ]]; then
    resolved_tag="$tag_from_sha"
    emit_result PASS 'Release tag found for commit' "${resolved_sha} -> ${resolved_tag}"
  else
    emit_result SKIP 'Release tag found for commit' 'no semver tag points to the provided commit'
  fi
fi

gnupg_home="$tmp_dir/gnupg"
release_key_file="$tmp_dir/release-signing-key.asc"
mkdir -p "$gnupg_home"
chmod 700 "$gnupg_home"

if git -C "$repo_dir" show "${resolved_sha}:keys/release-signing-key.asc" >"$release_key_file" 2>/dev/null; then
  :
else
  emit_result FAIL 'Load release signing key' 'unable to read keys/release-signing-key.asc from the release commit'
fi

if gpg --homedir "$gnupg_home" --import "$release_key_file" >/dev/null 2>&1; then
  emit_result PASS 'Import release signing key' 'keys/release-signing-key.asc'
else
  emit_result FAIL 'Import release signing key' 'unable to import keys/release-signing-key.asc'
fi

if [[ -n "$resolved_tag" ]]; then
  if [[ "$(git -C "$repo_dir" cat-file -t "$resolved_tag" 2>/dev/null || true)" == 'tag' ]]; then
    emit_result PASS 'Release tag is annotated' "$resolved_tag"
  else
    emit_result FAIL 'Release tag is annotated' "$resolved_tag"
  fi

  if signature_output="$(git -C "$repo_dir" -c gpg.program=gpg -c gpg.minTrustLevel=undefined tag -v "$resolved_tag" 2>&1)"; then
    emit_result PASS 'Tag signature is valid' "$(extract_signature_summary "$signature_output")"
  else
    emit_result FAIL 'Tag signature is valid' "$(compact_message "$signature_output")"
  fi
else
  emit_result SKIP 'Release tag is annotated' 'no release tag available to verify'
  emit_result SKIP 'Tag signature is valid' 'no release tag available to verify'
fi

if git -C "$repo_dir" merge-base --is-ancestor "$resolved_sha" origin/main; then
  emit_result PASS 'Commit is reachable from origin/main' "$resolved_sha"
else
  emit_result FAIL 'Commit is reachable from origin/main' "$resolved_sha"
fi

if [[ -n "$resolved_tag" ]]; then
  collect_release_metadata "$resolved_tag"
  emit_result "$release_lookup_state" 'Published GitHub release exists' "$release_lookup_detail"
  emit_result "$immutable_state" 'GitHub release is immutable' "$immutable_detail"
else
  emit_result SKIP 'Published GitHub release exists' 'no release tag available to query'
  emit_result SKIP 'GitHub release is immutable' 'no release tag available to query'
fi

if ((overall_failed)); then
  if [[ -n "$resolved_tag" && -n "$resolved_sha" ]]; then
    printf '\nOverall: FAIL (%s -> %s)\n' "$resolved_tag" "$resolved_sha"
  else
    printf '\nOverall: FAIL\n'
  fi
  exit 1
fi

if [[ -n "$resolved_tag" && -n "$resolved_sha" ]]; then
  printf '\nOverall: OK (%s -> %s)\n' "$resolved_tag" "$resolved_sha"
else
  printf '\nOverall: OK\n'
fi
