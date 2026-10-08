# mouse-tickler dev journal

Append-only. Newest entry at the bottom. Read this first when resuming.

---

## 2026-10-07 — Session 1: design → working extension (M0–M5)

### Goal (from the user)

Build a tighter, low-resource replacement for the Jiggle GNOME extension
(github.com/mattpass/jiggle, upstream jeffchannell/jiggle): shake the mouse
and the cursor grows, linearly with shake speed. Hard requirement: experimenting
must never crash the user's desktop. Ship it as a GNOME Shell extension.

### What was done

1. **Survey of Jiggle** (docs/design/01-source-survey.md).
   - The cost is not JS. Jiggle has two `GLib.timeout`s (10 ms and 34 ms)
     that run forever, plus polling, allocation on every sample, an icon
     reload on every frame, and full-screen Cairo for its other effects.
   - Its open issues are mapped to root causes: #74 grow/shrink loop, #73 no
     hold, #57 tip not at the hotspot, #71/#31 not the real cursor, and
     others.
   - The size is not actually linear in speed; it animates to a fixed 3×.
2. **GNOME integration research** (02-gnome-integration.md).
   - GNOME 50 is Wayland-only, and extensions must be JS (GJS ESM).
   - The APIs were verified against this box's mutter-18 typelibs and the
     gnome-shell 50.1 gresource: `CursorTracker::position-invalidated`,
     `get_sprite`/`get_hot`/`get_scale`, `inhibit_cursor_visibility`
     (ref-counted), and a `Clutter.Content` built on `TextureNode` (the
     magnifier's pattern).
3. **Architecture and risk docs** (03, 04) and a **dev/test plan** (05).
4. **M1 spikes** in an isolated headless gnome-shell (tests/spikes/):
   - one signal per motion event and none at idle, so a 4 ms throttle is
     needed;
   - the sprite is 24×24 with hotspot (3,1);
   - LINEAR filtering was chosen;
   - the actor needs `request_mode: CONTENT_SIZE`;
   - a virtual pointer can drive the tests;
   - `notify_button` takes **Clutter** button numbers (`BUTTON_PRIMARY`),
     not evdev codes. With 0x110 the press was silently dropped, which looked
     like "mods doesn't report buttons". It does report them.
5. **M2** `src/detector.js`: an O(1) streaming shake detector with no
   allocation. It uses direction reversals with a minimum leg length inside a
   600 ms window, plus a speed EWMA. The target scale is linear in speed, with
   attack, hold, and release. `tests/detector_test.js` has 23 tests, and each
   one was checked by sabotaging the code to make sure it fails.
6. **M3** `src/extension.js`, `src/sprite.js`, schema, `src/prefs.js` (Adw).
   - IDLE/ACTIVE state machine.
   - While ACTIVE, a frame-clock `Clutter.Timeline` runs.
   - One guarded inhibit, released in `finally` and in `disable()`.
   - A 5 s safety cap using `GLib.timeout_add`; `timeout_add_seconds` was too
     coarse and fired at 5.6 s.
   - Suppression: a held button, a hidden cursor, the magnifier, and fullscreen.
   - `tests/shell/shake.js` has 20 checks and is all green, including a
     600-cycle enable/disable soak.
7. **M4/M5** README, prefs window verified (it opens, no errors from our
   code), and a performance comparison (`tests/perf-compare.sh`, results in
   `docs/results/perf-2026-10-07.txt` and doc 05 §7).
   - Idle and plain motion are indistinguishable from no extension.
   - Jiggle wakes about 133 times per second at idle, forever.
   - mouse-tickler costs about 1 % of a core while the enlarged cursor shows
     (headless shell renders on the CPU with llvmpipe).
   - **Jiggle throws on GNOME 50** at the first shake
     (`CursorTracker.get_for_display is not a function`).
8. Merged to `main` with a fast-forward and pushed (`2e31788`).
   github.com/fdicostanzo/mouse-tickler. The remote branches `design-docs`
   and `extension` still exist; they are fully merged, and deleting them was
   offered but not yet confirmed.

### Decisions made

- UUID `mouse-tickler@dicostanzo.com`. Schema
  `org.gnome.shell.extensions.mouse-tickler`. `shell-version: ["50"]` only.
- Clean-room rewrite: no Jiggle code was copied (Jiggle is GPL-2.0-only). The
  repo is GPL-3.0. `CursorContent` follows gnome-shell's magnifier
  (GPL-2.0-or-later) and is attributed in a code comment.
- Non-goals: Spotlight, Fireworks and Trail effects, X11, and GNOME before 50.
- The test verdict comes from the script's `RESULT OK` line. The shell's exit
  code is unreliable because of a perf-helper teardown race.
- RSS grows about 5.7 MB over the first ~400 enable/disable cycles and then
  stays flat. A control run is flat throughout, so this is warm-up, not a
  leak. The soak test asserts that the last 200 of 600 cycles grow by less
  than 1 MB.

### Status at end of session

- **Works in a headless shell. Not yet run on a real desktop.**
- The user (account `frank`) will clone the repo into their own account and
  install it. Installing or updating an extension needs a full GNOME
  **logout and login** on Wayland. Enabling and disabling afterwards is
  instant. The user found this requirement odd and is deferring testing
  until a natural logout.
- Untested so far:
  - the `ignore-fullscreen` setting (no fullscreen test window yet);
  - HiDPI or fractional scaling;
  - cursor shape changes while ACTIVE;
  - the look and feel on real hardware.
- Not done: ESLint (not installed). The JS is 518 lines, over the 400-line
  target in doc 03 §1, mostly comments and defensive code. Revisit in
  cleanup.
- Ideas the user may raise after testing: tuning the default growth and
  maximum size, false triggers, and blurriness. A crisp version could load
  Adwaita's 96 px Xcursor images, but mutter does not expose the current
  shape name.

### The user's plan (next sessions)

1. The user tests for a while. Then we make revisions from their feedback.
2. **Clean up the docs** for publication:
   - Remove local and box references: `frank`/`pcrec` accounts, pcrecdev1,
     `/tmp/claude-mt` defaults in `tests/spikes/run-spike.sh`, the shared-box
     sections of CLAUDE.md and doc 05 §1, and doc 04 §0–1's box-specific
     isolation story. Rewrite these generically as "test in a headless shell,
     not your live session".
   - Decide whether `scripts/safekill` and `scripts/watchdog` stay; they are
     pcrec tooling, and `run-spike.sh` depends on watchdog.
   - Explain the packaging plan: `make pack` builds the EGO upload zip, plus
     what is and isn't included in it.
3. **Submit to extensions.gnome.org.**
   - Upload the `make pack` zip.
   - Run ESLint first.
   - Follow the review guidelines (doc 02 §2). The reviewer must find the
     code explainable and not bloated; the guidelines reject "evidently
     AI-generated" bloat. So trim before submitting.
   - Screenshot or GIF for the listing.
4. **Periodic wake-ups to monitor GitHub feedback** (issues and PRs on
   fdicostanzo/mouse-tickler, and the EGO review). The user will schedule
   these.

### Box notes (for resuming on this machine)

- Shared box. pcrecdev1 (pcrec manager) has priority. It gave a **standing
  OK** for runs of at most 2 cores, one at a time, bounded by watchdog at
  ≤300 s / ≤1.5 GiB. Ask it before anything bigger.
- Use `gnutimeout`, not the bare `timeout` (that one is uutils). Use
  `scripts/safekill PID`, never `pkill -f`.
- Headless runner: `tests/spikes/run-spike.sh SCRIPT LOG [ZIP]`. It uses a
  private D-Bus session and throwaway XDG dirs, and never touches frank's
  session. `make test-unit` takes seconds. `make test-shell` takes about 40 s.
  `tests/perf-compare.sh JIGGLE_ZIP 3` takes about 13 min.
- The scratch dirs `/tmp/claude-mt` and `/tmp/mt-src` (Jiggle and mutter
  clones, and the jiggle.zip patched to shell-version 50) are temporary and
  may be gone. Re-clone if needed.
