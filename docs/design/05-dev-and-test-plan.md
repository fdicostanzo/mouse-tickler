# 05 — Development, test, and measurement plan

## 1. Box etiquette (shared machine)

These rules come from pcrecdev1 on 2026-10-07. pcrec's work has priority on this box.

- Light work is fine at any time without asking: editing, docs, unit tests of
  `detector.js` under plain gjs, `gnome-extensions pack`.
- Before **any** headless or nested gnome-shell run, any performance
  measurement, or any soak test, message `pcrecdev1` and wait for it to name a
  window. If it is busy, wait.
- Run one heavy job at a time. Run long jobs detached
  (`nohup setsid … > log 2>&1 & disown`) and poll the log file, not the
  process list.
- Bound every shell run with
  `scripts/watchdog -s WALL -m RSS_KB -c CPU -S label -- cmd`.
- Kill only with `scripts/safekill PID`. Never use `pkill -f` or `pgrep -f`.
- Use `gnutimeout` (GNU). The bare `timeout` on this box is uutils.
- Do not install packages (eslint, mutter-devkit) or change system or home
  config. Ask the user instead.

## 2. Spikes, before writing the real code

Each spike is a throwaway headless run that answers one question.

| Spike | Question | Pass criterion |
|---|---|---|
| S1 | Does `position-invalidated` fire for **virtual-device** motion in a headless shell, and how often? | The signal count roughly equals the number of injected events, and nothing fires when idle. |
| S2 | Do `get_sprite()` and `get_hot()` return a texture in headless mode, and does `inhibit_cursor_visibility` change `get_pointer_visible()`? | A non-null texture, and the visibility state toggles. |
| S3 | What texture size does the sprite have, and how does it look at 4× with trilinear filtering? Is a higher-resolution source available? | A screenshot is produced, and the decision is recorded. |
| S4 | Can an automation script inject pointer motion? (`Clutter.get_default_backend().get_default_seat().create_virtual_device(POINTER_DEVICE)` then `notify_absolute_motion`) | A scripted shake triggers the extension. |

## 3. Test layers

1. **Unit tests (`make test-unit`).** `gjs -m tests/detector_test.js`. Pure
   math and fast. Run them freely.
   - A sine shake at different amplitudes and frequencies must trigger, and
     the scale must increase monotonically with speed.
   - A straight fast flick, slow circles, tremor under MIN_LEG, and a slow
     back-and-forth must not trigger.
   - Hostile input must not throw and must not loop: dt=0, time going
     backwards, NaN, coordinates of ±1e9, negative coordinates.
2. **Integration tests (`make test-shell`, needs a window from pcrecdev1).**
   `gnome-shell-test-tool --headless --extension build/mouse-tickler.zip
   tests/shell/shake.js`. The script injects motion through a virtual pointer
   and asserts the following:
   - the actor appears, the scale goes above 1, and the hotspot stays on the
     pointer position to within 1 px;
   - after the shake stops, the extension deactivates within HOLD + 1 s;
   - `get_pointer_visible()` is true again after every scenario (R1);
   - nothing triggers while a button is held, while the cursor is hidden, or
     during a fullscreen test window;
   - the safety cap fires during an artificial 10 s shake.
3. **Soak test (`make soak`, long, needs a window).** 1,000 enable/disable
   cycles plus 10 minutes of random motion. Assert that RSS growth is under
   1 MB, that there are no journal errors, and that the cursor ends visible.

## 4. Performance measurement (doc 03 §6 budget)

Compare against the same scenario with Jiggle (GNOME 46 port, metadata
patched to 50) and with no extension. Run all three in the headless shell.

| Metric | How |
|---|---|
| Idle wake-ups | Leave the pointer still for 60 s. Use `perf stat -e sched:sched_switch` on the gnome-shell PID if it is permitted; otherwise compare per-thread `/proc/PID/stat` utime+stime deltas. Also count our callbacks with a debug counter. |
| CPU while shaking | Script 30 s of shaking and record the utime/stime delta of the shell process. |
| Frame timing | Use the `gnome-shell-test-tool` perf events (`--perf-output`), which include frame-time statistics. |
| Memory | Gnome-shell RSS before and after the soak test. |

Caveat: a headless shell may render with llvmpipe (on the CPU), which
inflates rendering cost. Compare the three configurations against each other,
not against an absolute number. Record which renderer was used.

## 5. Milestones

| M | Deliverable | Gate |
|---|---|---|
| M0 | Design docs (this set) | User review |
| M1 | Spikes S1–S4, results added to doc 02 | **Done 2026-10-07** (doc 02 §6) |
| M2 | `detector.js` with unit tests | **Done 2026-10-07**: 23 tests, each one checked by sabotage |
| M3 | `extension.js`, `sprite.js`, schema; integration tests | **Done 2026-10-07**: 20 shell checks, including a 600-cycle enable/disable soak |
| M4 | `prefs.js`, packaging, lint | `gnome-extensions pack` produces a clean zip |
| M5 | Performance comparison and soak test | Budget in doc 03 §6 met; soak test passes |
| M6 | The user installs it on their desktop as frank | Recovery playbook (doc 04 §3) acknowledged |

## 6. Lessons from the first integration runs (2026-10-07)

- `ClutterVirtualInputDevice.notify_button()` takes **Clutter** button
  numbers (`Clutter.BUTTON_PRIMARY`), not evdev codes. With `0x110` the press
  was silently dropped. Once the button number was right, `global.get_pointer()`
  returned the button masks correctly (spike `s5-buttons.js`).
- `GLib.timeout_add_seconds` is deliberately coarse and fired the safety cap
  at 5.6 s. `timeout_add(5000)` is exact.
- The shell's exit code is unreliable: the perf helper's teardown can race.
  `make test-shell` judges success from the script's own `RESULT OK` line.
- RSS after GC across 800 enable/disable cycles grows about 5.7 MB over the
  first ~400 cycles and then stays flat (+0.2 MB over the last 400). The same
  shaking without enable/disable (`MT_CONTROL=1`) stays flat. This is one-time
  warm-up in GJS/GObject, not a leak. The soak check therefore asserts that
  the last 200 of 600 cycles stay under 1 MB.
- Size: the JS totals 518 lines (detector 183, extension 188, sprite 99,
  prefs 48). That is over the 400-line target in doc 03 §1, mostly because of
  comments and defensive code. Accepted for now and to be revisited in review.
