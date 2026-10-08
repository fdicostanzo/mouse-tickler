# mouse-tickler: a lean "shake to find cursor" GNOME Shell extension

A clean-room rewrite of github.com/mattpass/jiggle for GNOME Shell 50
(Wayland only). Start with the design in `docs/design/` (README.md is the
index).

## Scope

- Work only inside this repository. The one exception is the session
  scratchpad, used for temporary files, which are never committed.
- Never write to `/home/frank` or any other user's home directory, and never
  touch frank's D-Bus session or gsettings. The live desktop belongs to frank.
  Installing a build there is always done by the user (see
  docs/design/04-risk-assessment.md).
- Do not change system or home-directory config, and do not install packages,
  without asking the user.

## Shared box: pcrecdev1's work comes first

Before running anything heavy (a headless or nested gnome-shell, a perf run,
a soak test), message the `pcrecdev1` session and wait for it to name a
window. Light work (editing, docs, `gjs` unit tests, packing) does not need
to ask.

## Situation index: when you are about to X, read or do Y first

| about to… | do / read |
|---|---|
| kill any process | `scripts/safekill PID` (it kills the process group and the tree). NEVER use `pkill -f` or `pgrep -f`. |
| bound a command's run time | `gnutimeout`. The bare `timeout` here is uutils, about 105 ms per call. |
| run a gnome-shell (headless or nested), a soak test, or anything that could hang or allocate without limit | ask pcrecdev1 for a window, then run `scripts/watchdog -s WALL -m RSS_KB -c CPU -S label -- cmd`, detached (`nohup setsid … > log 2>&1 & disown`), and poll the log |
| poll a background run | check its log tail or the file mtimes. Never grep the process list. |
| touch the hot path (motion handler, frame callback, detector) | docs/design/03-architecture.md §6 budget: no allocation, no loops that depend on input, no GSettings reads |
| inhibit or hide the cursor | docs/design/04-risk-assessment.md R1: exactly one guarded inhibit, released in `finally` and in `disable()` |
| add a feature or setting | check it against the non-goals in doc 03 §1 and the 400-line target |
| `cd` somewhere | use absolute paths or `git -C`. A `cd` persists between commands. |

## Conventions

- ES modules, GNOME 45+ extension API, and EGO review guidelines (doc 02 §2).
- Commit when the user asks. Branch off `main` for feature work.
