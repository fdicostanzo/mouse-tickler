# 01 — Survey of the source project (Jiggle)

Surveyed 2026-10-07.

- Fork we were pointed at: <https://github.com/mattpass/jiggle> (HEAD `452d661`,
  "Port extension to GNOME 46", 2026-04-11). Issues are disabled on that fork.
- Upstream: <https://github.com/jeffchannell/jiggle>. The issue tracker lives
  here (about 40 issues, many open, last real activity in 2022–23).
- License: GPL-2.0. We are **not** copying code from it. This project is a
  clean-room rewrite: the design below comes from GNOME Shell's own APIs, not
  from Jiggle's source.

## 1. What it does

Jiggle keeps a short history of pointer positions. When that history looks
like a shake, it starts one of four effects. Scaling is the default.

| Effect | Mechanism |
|---|---|
| Cursor scaling (default) | An `St.Icon` that loads a **bundled PNG** (`icons/jiggle-cursor.png`). It is added to `Main.uiGroup`, resized on every tick, and the real pointer is hidden with `Meta.CursorTracker.set_pointer_visible(false)`. |
| Spotlight | A **full-screen** `St.DrawingArea`. Cairo paints a dark layer with a hole cut out, repainted at about 30 fps. |
| Fireworks | A **full-screen** `St.DrawingArea`. Cairo draws 50 trails × 10 sparks, each as a separate rectangle fill. |
| Trail | Creates a new `St.Icon` every 2 render ticks and fades each one out with `ease()`. |

The code is about 940 lines of JS. On top of that there are about 1,300 lines
of GTK3/GTK4 `.ui` XML for prefs, a home-made unit-test framework
(`gjsunit.js`), Dockerfiles for CentOS/Fedora/Debian, and some leftover golden-ratio
math (`math.gr`, `math.gr_next`) that nothing calls. Most of the code
belongs to the four-effect framework and the prefs UI. The core feature is
small.

## 2. Control flow (extension.js)

```
enable():
  PointerWatcher.addWatch(10ms, (x,y) => { history.push(x,y); effect.run(x,y) })
  GLib.timeout_add(10ms)  -> history.check() -> effect.start()/stop(); effect.run(lastX,lastY)
  GLib.timeout_add(34ms)  -> effect.render()
```

Shake detection (`history.js`):

- Each sample is pushed as a new object `{x, y, t: Date.now()}` into a JS array.
- Every 10 ms the whole array is scanned. Entries older than 500 ms are removed
  one at a time with `splice` inside a reverse loop (O(n²) worst case).
- For every consecutive triple it computes the turning angle with the law of
  cosines (3× `sqrt`, 1× `acos`) and adds the angles up. It also tracks the
  largest segment length.
- A shake is reported when the summed turning angle is over 500° **and** some
  segment is longer than `shake-threshold` px (default 180).

## 3. Why it is resource-hungry

The cost does not come from JavaScript itself. It comes from the shape of the
code: it polls constantly and allocates on every tick.

1. **Polling that never stops.** The 10 ms and 34 ms `GLib.timeout_add`
   sources run for as long as the extension is enabled, including while the
   user is idle. That is about 130 wake-ups per second of JS in the
   compositor process, forever. Each wake-up runs `history.check()`, which
   calls `Date.now()`. GNOME's own `PointerWatcher` at least stops after 1 s
   of idle. Jiggle's private timers do not.
2. **Polling instead of events.** While the pointer moves, `PointerWatcher`
   calls `global.get_pointer()` every 10 ms. Mutter already sends a signal on
   every pointer motion (`Meta.CursorTracker::position-invalidated`, see
   doc 02), so the polling is not needed.
3. **Allocation churn.** Every sample creates a new JS object. Every check runs
   `splice`. The garbage collector runs inside gnome-shell, and on Wayland
   gnome-shell is the compositor, so GC pauses show up as dropped frames and
   pointer stutter.
4. **The icon is reloaded every frame.** During the animation the scaling effect calls
   `St.Icon.set_icon_size(n)` with a new size on almost every tick. For a
   file-backed `GIcon`, every new size makes St's texture cache load and
   rasterize the PNG at that size again. It also calls
   `setPointerVisible()` on every tick.
5. **Full-screen Cairo.** Spotlight and Fireworks rasterize a canvas the size of
   the whole stage on the CPU, then upload it to the GPU, about 30 times a
   second. On a 4K monitor that is roughly 33 MB per frame. This is the most
   expensive part of Jiggle.
6. **Leaks.** Effect actors are removed with `remove_child()` but are never
   `destroy()`ed. The Trail effect creates an actor every 68 ms for as long as
   it is selected, whether or not the user is shaking.

## 4. Functional defects (source code plus upstream issues)

| # | Defect | Root cause |
|---|---|---|
| 74 | Cursor grows, shrinks and grows again while you keep shaking | Binary start/stop state machine. Every stop rebuilds a fresh frame list. |
| 73 | Shrinks immediately, with no hold | No hold phase. |
| 57 | The tip of the enlarged cursor is not where clicks land | It centres the icon and then adds a guessed hotspot offset (6, 8). It does not scale around the real hotspot. |
| 71, 31 | Ignores the user's cursor theme, size and shape (I-beam, hand) | It uses a bundled PNG instead of the live sprite. |
| 67 | Two cursors are visible | `set_pointer_visible` is a global toggle that other code and clients also set. Mutter has a ref-counted inhibit API for this. |
| 55 | The cursor disappears in fullscreen video players | Old X11-era overlay and visibility-toggle approach. The visibility state gets stuck. |
| 14 | Restarting the shell crashed the WM | Resources were not deallocated (historical). |
| 44, 30 | Triggers in games and fullscreen apps, and while the cursor is hidden | No check for cursor visibility or fullscreen. |
| 26 | Triggers while painting or dragging | No check for button state. |
| — | Cursor at negative coordinates is ignored | `history.push` drops `x < 0 \|\| y < 0`, which breaks monitors placed left of or above the primary. |
| — | Uses `Date.now()`, a wall clock | Not monotonic, so it misbehaves if the clock jumps (NTP adjustments, resume from suspend). |
| — | Says "linear to speed", but it is not | The size animates to a fixed 3× on a preset easing curve. Speed only matters through the trigger threshold. |
| 66, 77 | Breaks on every GNOME release | `shell-version` is pinned. Private APIs are used (`_removeWatch`). |

## 5. What we keep

- The idea: shake the pointer and an enlarged copy of the real cursor appears.
- A sensitivity setting.
- Nothing else. Spotlight, Fireworks and Trail are out of scope. If they ever
  come back, they must be built as GPU actors and effects, not full-screen
  Cairo canvases.
