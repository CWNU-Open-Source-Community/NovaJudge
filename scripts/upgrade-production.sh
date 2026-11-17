#!/usr/bin/env bash
set -Eeuo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if [[ ! -f .env ]]; then
  echo "Missing $project_root/.env. Copy .env.example and fill every required secret first." >&2
  exit 1
fi

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (!((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 24)) {
    console.error(`Use Node.js 20.19+, 22.12+ or 24+ (Node.js 22 recommended); found ${process.versions.node}.`);
    process.exit(1);
  }
'

# Compose now requires an explicit password. Older NovaJudge deployments kept
# it only inside DATABASE_URL, so derive the same configured value in memory.
# Nothing is printed or written back to disk.
resolved_postgres_password="$(
  node --env-file="$project_root/.env" -e '
    const direct = process.env.POSTGRES_PASSWORD?.trim();
    if (direct) {
      process.stdout.write(direct);
      process.exit(0);
    }
    try {
      const password = decodeURIComponent(
        new URL(process.env.DATABASE_URL || "").password,
      );
      if (password) process.stdout.write(password);
    } catch {}
  '
)"

if [[ -z "$resolved_postgres_password" ]]; then
  echo "Set POSTGRES_PASSWORD (and matching DATABASE_URL) in .env before upgrading." >&2
  exit 1
fi
export POSTGRES_PASSWORD="$resolved_postgres_password"
unset resolved_postgres_password

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker with the Compose v2 plugin is required." >&2
  exit 1
fi

# Start Docker on systemd hosts when needed, while remaining usable as root,
# on hosts without sudo, and with an already-running Docker Desktop daemon.
if ! docker info >/dev/null 2>&1; then
  if command -v systemctl >/dev/null 2>&1 && \
    systemctl show docker.service >/dev/null 2>&1; then
    docker_services=(docker)
    if systemctl show containerd.service >/dev/null 2>&1; then
      docker_services=(containerd docker)
    fi
    if [[ "${EUID}" -eq 0 ]]; then
      systemctl enable --now "${docker_services[@]}"
    elif command -v sudo >/dev/null 2>&1; then
      sudo systemctl enable --now "${docker_services[@]}"
    fi
  fi
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is unavailable or the current user cannot access it." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 (the 'docker compose' command) is required." >&2
  exit 1
fi

if docker compose up --help | grep -q -- "--wait"; then
  # Wait for infrastructure before explicitly deploying database migrations.
  docker compose up -d --build --wait --wait-timeout 180
else
  # Older Compose v2 releases do not expose --wait. Keep them usable, but do
  # not race PostgreSQL/Redis startup with the database deployment step.
  docker compose up -d --build
  services_ready=false
  for _ in $(seq 1 60); do
    if docker compose exec -T postgres sh -c \
      'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 && \
      docker compose exec -T redis redis-cli ping >/dev/null 2>&1; then
      services_ready=true
      break
    fi
    sleep 2
  done
  if [[ "$services_ready" != true ]]; then
    echo "PostgreSQL or Redis did not become ready within 120 seconds." >&2
    docker compose ps >&2
    exit 1
  fi
fi
npm ci --include=dev --no-audit --no-fund
npm run db:deploy
npm run build

docker compose ps
echo "Upgrade build completed. Restart the existing NovaJudge Web and Worker services now."
