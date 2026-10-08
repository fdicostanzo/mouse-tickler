#!/usr/bin/env bash
# Interleaved perf comparison: REPS rounds of {none, mouse-tickler, jiggle}.
# Each run is one headless shell (~85 s, watchdog-bounded). Sequential.
# Usage: tests/perf-compare.sh JIGGLE_ZIP [REPS]   -> build/perf/summary.txt
set -uo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
jiggle=$1; reps=${2:-3}
out=$root/build/perf; mkdir -p "$out"
zip=$root/build/mouse-tickler@dicostanzo.com.shell-extension.zip
for r in $(seq 1 "$reps"); do
  for cfg in none mouse-tickler jiggle; do
    case $cfg in none) z= ;; mouse-tickler) z=$zip ;; jiggle) z=$jiggle ;; esac
    MT_PERF_LABEL=$cfg "$root/tests/spikes/run-spike.sh" "$root/tests/shell/perf.js" "$out/$cfg-$r.log" $z >/dev/null 2>&1
    echo "done $cfg $r $(date +%T)"
  done
done
python3 -I - "$out" <<'PY'
import re, sys, glob, statistics as st, collections
d = collections.defaultdict(lambda: collections.defaultdict(list))
for f in glob.glob(sys.argv[1] + '/*-*.log'):
    cfg = re.sub(r'-\d+\.log$', '', f.split('/')[-1])
    for m in re.finditer(r'^PERF (\S+): cpu=([\d.]+) ms/s main-thread-switches=([\d.]+)', open(f).read(), re.M):
        d[cfg][m[1]].append((float(m[2]), float(m[3])))
lines = ['config         phase        cpu ms/s (median, runs)        wakeups/s (median)']
for cfg in ('none', 'mouse-tickler', 'jiggle'):
    for ph in ('idle', 'moving', 'shaking', 'idle-after'):
        v = d[cfg][ph]
        if v:
            lines.append(f"{cfg:14} {ph:11} {st.median(x for x, _ in v):6.1f}  {[x for x, _ in v]!s:28} {st.median(y for _, y in v):7.1f}")
open(sys.argv[1] + '/summary.txt', 'w').write('\n'.join(lines) + '\n')
print('\n'.join(lines))
PY
