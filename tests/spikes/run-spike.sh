#!/usr/bin/env bash
# Run one automation script in an isolated headless gnome-shell.
# Usage: tests/spikes/run-spike.sh SCRIPT.js LOGFILE [EXTENSION_ZIP]
# Isolation: private D-Bus session (dbus-run-session), throwaway XDG dirs,
# keyfile GSettings backend, its own Wayland display name. Bounded by
# scripts/watchdog (wall 300 s, RSS 1.5 GiB). Never touches any user session.
set -euo pipefail
script=$(realpath "$1"); log=$(realpath -m "$2"); ext=${3:-}
root=$(cd "$(dirname "$0")/../.." && pwd)
scratch=${SCRATCH:-/tmp/claude-mt}
home=$(mktemp -d -p "$scratch" mt-shell.XXXXXX)
mkdir -p "$home"/{cache,config,data,runtime}
chmod 700 "$home/runtime"
export XDG_CACHE_HOME=$home/cache XDG_CONFIG_HOME=$home/config XDG_DATA_HOME=$home/data
export XDG_RUNTIME_DIR=$home/runtime
export GSETTINGS_BACKEND=keyfile
export MUTTER_WM_CLASS_FILTER=Gnome-shell-perf-helper
if [[ -n $ext ]]; then
  uuid=$(env -u DBUS_SESSION_BUS_ADDRESS gnome-extensions install --force --print-uuid "$ext")
  mkdir -p "$home/config/glib-2.0/settings"
  printf '[org/gnome/shell]\nenabled-extensions=["%s"]\n' "$uuid" > "$home/config/glib-2.0/settings/keyfile"
fi
rc=0
"$root/scripts/watchdog" -l "spike:$(basename "$script" .js)" -s 300 -m 1536m -L "$scratch/watchdog.log" -- \
  dbus-run-session -- gnome-shell --headless --virtual-monitor 1280x720 \
    --wayland-display mt-spike-$$ --automation-script "$script" > "$log" 2>&1 || rc=$?

echo "exit=$rc home=$home" >> "$log"
exit $rc
