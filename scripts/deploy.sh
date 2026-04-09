#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

if [[ -f .deploy.env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.deploy.env
  set +a
fi

required_vars=(DEPLOY_HOST DEPLOY_PORT DEPLOY_USER DEPLOY_PASS DEPLOY_PATH)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required deploy variable: $var_name" >&2
    exit 1
  fi
done

case "$DEPLOY_PATH" in
  ""|"."|"./"|"/"|"~"|"/home"|"/root")
    echo "Refusing to deploy to unsafe DEPLOY_PATH: $DEPLOY_PATH" >&2
    exit 1
    ;;
esac

if ! command -v lftp >/dev/null 2>&1; then
  echo "Missing required command: lftp" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Missing required command: npm" >&2
  exit 1
fi

if ! command -v ssh-keyscan >/dev/null 2>&1; then
  echo "Missing required command: ssh-keyscan" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Missing required command: curl" >&2
  exit 1
fi

tmp_lftp_script=""

cleanup() {
  if [[ -n "$tmp_lftp_script" && -f "$tmp_lftp_script" ]]; then
    rm -f "$tmp_lftp_script"
  fi
}

trap cleanup EXIT

run_lftp_script() {
  tmp_lftp_script="$(mktemp)"
  cat >"$tmp_lftp_script"
  lftp -f "$tmp_lftp_script"
  rm -f "$tmp_lftp_script"
  tmp_lftp_script=""
}

verify_host_key() {
  local expected_entry="${DEPLOY_HOSTKEY_ENTRY:-}"

  if [[ -z "$expected_entry" ]]; then
    echo "Missing required deploy variable: DEPLOY_HOSTKEY_ENTRY" >&2
    exit 1
  fi

  local scanned_keys
  scanned_keys="$(ssh-keyscan -p "$DEPLOY_PORT" "$DEPLOY_HOST" 2>/dev/null || true)"

  if [[ -z "$scanned_keys" ]]; then
    echo "Failed to fetch SSH host keys from $DEPLOY_HOST:$DEPLOY_PORT" >&2
    exit 1
  fi

  if ! printf '%s\n' "$scanned_keys" | grep -Fqx "$expected_entry"; then
    echo "SSH host key verification failed for $DEPLOY_HOST:$DEPLOY_PORT" >&2
    exit 1
  fi
}

run_smoke_checks() {
  local public_url="${DEPLOY_PUBLIC_URL:-}"

  if [[ -z "$public_url" ]]; then
    echo "Missing required deploy variable: DEPLOY_PUBLIC_URL" >&2
    exit 1
  fi

  public_url="${public_url%/}"

  curl --fail --silent --show-error --location \
    --write-out '\nHTTP %{http_code} %{url_effective}\n' \
    "$public_url/" >/dev/null

  curl --fail --silent --show-error --location \
    --write-out '\nHTTP %{http_code} %{url_effective}\n' \
    "$public_url/login" >/dev/null

  curl --fail --silent --show-error --location \
    --write-out '\nHTTP %{http_code} %{url_effective}\n' \
    "$public_url/vfrplan-data/airspaces.se.json" >/dev/null

  curl --fail --silent --show-error --location \
    --write-out '\nHTTP %{http_code} %{url_effective}\n' \
    "$public_url/robots.txt" >/dev/null
}

verify_deploy_git_state() {
  if ! command -v git >/dev/null 2>&1; then
    echo "Missing required command: git" >&2
    exit 1
  fi

  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Refusing to deploy with uncommitted changes. Commit and push first." >&2
    exit 1
  fi

  local upstream_ref=""
  if ! upstream_ref="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
    echo "Refusing to deploy without an upstream branch configured." >&2
    exit 1
  fi

  local head_sha upstream_sha
  head_sha="$(git rev-parse HEAD)"
  upstream_sha="$(git rev-parse "$upstream_ref")"

  if [[ "$head_sha" != "$upstream_sha" ]]; then
    echo "Refusing to deploy because HEAD ($head_sha) does not match $upstream_ref ($upstream_sha)." >&2
    echo "Push the current commit before deploying." >&2
    exit 1
  fi
}

verify_host_key
verify_deploy_git_state

resolve_remote_path() {
  run_lftp_script <<EOF
set cmd:fail-exit yes
set sftp:auto-confirm yes
open -u "$DEPLOY_USER","$DEPLOY_PASS" "sftp://$DEPLOY_HOST:$DEPLOY_PORT"
cd "$DEPLOY_PATH"
pwd
bye
EOF
}

remote_path_output="$(resolve_remote_path)"
remote_path="$(printf '%s\n' "$remote_path_output" | tail -n 1)"

if [[ "$remote_path" == sftp://* ]]; then
  remote_path="/${remote_path#*://*/}"
fi

if [[ -z "$remote_path" ]]; then
  echo "Failed to resolve remote deploy path." >&2
  exit 1
fi

if [[ -n "${DEPLOY_EXPECTED_PATH_FRAGMENT:-}" && "$remote_path" != *"$DEPLOY_EXPECTED_PATH_FRAGMENT"* ]]; then
  echo "Resolved remote path '$remote_path' does not match expected fragment '$DEPLOY_EXPECTED_PATH_FRAGMENT'." >&2
  exit 1
fi

if [[ "${1:-}" == "--check" ]]; then
  echo "Deploy target OK: $remote_path"
  exit 0
fi

npm run build

# Normalize dist permissions before SFTP upload so Apache can read all published files.
find "$ROOT_DIR/dist" -type d -exec chmod 755 {} +
find "$ROOT_DIR/dist" -type f -exec chmod 644 {} +

run_lftp_script <<EOF
set cmd:fail-exit yes
set sftp:auto-confirm yes
set net:max-retries 2
set net:timeout 20
set xfer:clobber yes
open -u "$DEPLOY_USER","$DEPLOY_PASS" "sftp://$DEPLOY_HOST:$DEPLOY_PORT"
cd "$DEPLOY_PATH"
lcd "$ROOT_DIR/dist"
mirror -R --delete --verbose --scan-all-first . .
bye
EOF

run_smoke_checks
