#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/var/www/email-hosting.kmerhosting.com}"
SOURCE_DIR="${SOURCE_DIR:-$APP_ROOT/source}"
RELEASES_DIR="${RELEASES_DIR:-$APP_ROOT/releases}"
CURRENT_LINK="${CURRENT_LINK:-$APP_ROOT/current}"
FRONTEND_ENV_FILE="${FRONTEND_ENV_FILE:-/etc/kmerhosting-email-hosting/frontend.env}"

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo -- "$0" "$@"
fi

[[ -d "$SOURCE_DIR" ]] || { echo "Source directory not found: $SOURCE_DIR" >&2; exit 1; }
[[ -f "$FRONTEND_ENV_FILE" ]] || { echo "Frontend environment file not found: $FRONTEND_ENV_FILE" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$FRONTEND_ENV_FILE"
set +a

for required_var in \
  VITE_SUPABASE_URL \
  VITE_SUPABASE_PUBLISHABLE_KEY \
  VITE_SITE_URL \
  VITE_DOMAIN_STORE_URL \
  VITE_SUPPORT_EMAIL; do
  [[ -n "${!required_var:-}" ]] || { echo "Missing required variable: $required_var" >&2; exit 1; }
done

cd "$SOURCE_DIR"
npm ci
npm run lint
npm run build

mkdir -p "$RELEASES_DIR"
release_id="$(date +%Y%m%d-%H%M%S)"
release_dir="$RELEASES_DIR/$release_id"
while [[ -e "$release_dir" ]]; do
  sleep 1
  release_id="$(date +%Y%m%d-%H%M%S)"
  release_dir="$RELEASES_DIR/$release_id"
done

mkdir "$release_dir"
cp -a dist/. "$release_dir/"
chown -R www-data:www-data "$release_dir"
find "$release_dir" -type d -exec chmod 755 {} +
find "$release_dir" -type f -exec chmod 644 {} +

previous_target=""
if [[ -L "$CURRENT_LINK" ]]; then
  previous_target="$(readlink -f "$CURRENT_LINK")"
fi
temporary_link="$APP_ROOT/.current.$release_id"
ln -s "$release_dir" "$temporary_link"
mv -Tf "$temporary_link" "$CURRENT_LINK"

if ! nginx -t; then
  if [[ -n "$previous_target" ]]; then
    rollback_link="$APP_ROOT/.rollback.$release_id"
    ln -s "$previous_target" "$rollback_link"
    mv -Tf "$rollback_link" "$CURRENT_LINK"
  fi
  echo "Nginx validation failed; current release was restored." >&2
  exit 1
fi
systemctl reload nginx

mapfile -t old_releases < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
for old_release in "${old_releases[@]:2}"; do
  rm -rf -- "$RELEASES_DIR/$old_release"
done

echo "Deployed release: $release_id"
echo "Current target: $(readlink -f "$CURRENT_LINK")"
