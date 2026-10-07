#!/bin/sh
# Installs the Studio Mac runner as a login agent: starts now, at every login, and restarts if it stops.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node)"
ENV_FILE="$HOME/.config/tiny-soho/runner.env"
[ -f "$ENV_FILE" ] || { echo "Create $ENV_FILE first (see runner.env.example)."; exit 1; }
command -v claude >/dev/null || { echo "Claude Code (claude) is not on PATH."; exit 1; }
chmod 600 "$ENV_FILE"
PLIST="$HOME/Library/LaunchAgents/com.tinysoho.runner.plist"
sed -e "s#__NODE__#$NODE#" -e "s#__RUNNER_DIR__#$DIR#" -e "s#__HOME__#$HOME#g" -e "s#__PATH__#$PATH#" "$DIR/com.tinysoho.runner.plist" > "$PLIST"
launchctl bootout "gui/$(id -u)/com.tinysoho.runner" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Runner installed. Logs: ~/Library/Logs/tiny-soho-runner.log"
