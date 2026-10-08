# 04 — Risk assessment

The requirement: *experimenting must not crash the desktop.*

## 0. The facts that set the risk level

- GNOME 50 runs only on Wayland, and **gnome-shell is the compositor.** If it
  crashes, the session ends and every open app is lost. There is no
  "Alt+F2 r" restart as there was on X11.
- An extension runs **inside** that process. A JS exception is caught and
  logged. A native crash, or a JS infinite loop, takes the whole session down.
  A frozen loop stops all rendering.
- The graphical desktop on this box belongs to user **`frank`** (uid 1000,
  session on seat0/tty2). Development runs as user **`pcrec`** (uid 1001),
  with no graphical session. **Nothing this project does as `pcrec` can load
  code into frank's shell.** Extensions are installed per user under
  `~/.local/share/gnome-shell/extensions`, and frank's shell reads only
  frank's home directory. That separation is the main safety barrier, and we
  keep it in place on purpose.

## 1. Development isolation (how we experiment safely)

| Stage | Where it runs | Risk to frank's desktop |
|---|---|---|
| Unit tests of `detector.js` | plain `gjs -m` as pcrec | none |
| Integration and performance tests | `gnome-shell-test-tool --headless --extension …` as pcrec. This is a separate compositor process with its own D-Bus session and a virtual monitor. | none to the session. It does compete for CPU and GPU (see §3). |
| Visual check | headless shell plus screenshots (`Shell.Screenshot`), or `--devkit` if the user installs `mutter-devkit` | none |
| Dogfooding | frank installs it with `gnome-extensions install` **as frank, manually** | real risk. Only after the soak gate in doc 05. |

We never `cp` into `/home/frank`, never run `gsettings` against frank's bus,
and never use `sudo`. Promoting a build to frank's desktop is always done by
the user.

## 2. Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Cursor left hidden.** A bug skips the call to `uninhibit_cursor_visibility()`. | Med | High: the user can't see the pointer | (a) A single boolean guards exactly one inhibit and one uninhibit. (b) Deactivate runs inside `try/finally` from every exit path, including `disable()`. (c) The 5 s `MAX_ACTIVE` safety cap. (d) Disabling the extension always releases the inhibit. (e) The test harness checks `get_pointer_visible()` after every scenario. |
| R2 | **Shell freezes** because of an unbounded loop in a hot path | Low | Critical: the desktop freezes | The hot paths contain no loops except a fixed 8-slot ring scan. No recursion. No `while` that depends on input. The detector is unit-tested with hostile input (NaN, huge jumps, dt=0, time going backwards). |
| R3 | **Native crash** from API misuse, such as touching a destroyed actor, a null sprite texture, or a bad `Clutter.Content` vfunc | Low | Critical: the session dies | Only call public, introspected APIs that the in-tree magnifier already uses in the same way. Null-check `get_sprite()` (it is nullable). Never keep a texture after `cursor-changed`. Destroy the actor in `disable()` and set it to null. Check for null before every use. Do not use `run_dispose`. Exercise enable/disable cycles 1,000 times in the headless soak test. |
| R4 | **Exceptions in signal handlers** spam the journal or leave state half-updated | Med | Low–Med | Wrap each handler in `try { … } catch (e) { logError(e); forceIdle(); }`. Rate-limit logging to one message per error type. |
| R5 | **Signal or source leaks** across enable/disable. The lock screen disables and re-enables extensions every time. | Med | Med: slow degradation | Use `connectObject(…, this)` / `disconnectObject(this)` for every signal, and keep one place that removes the safety-cap source. Soak test: run 1,000 enable/disable cycles and assert no growth in the shell's signal handlers or RSS. |
| R6 | **GC and allocation pauses** cause pointer stutter (this was Jiggle's problem) | Low | Med | No allocation per sample, by design. Measure RSS and GC counts in the performance test. |
| R7 | **False triggers** while drawing, gaming, scrolling maps, or in video | Med | Low–Med: annoying | Suppression rules (doc 03 §7). Unit tests require that straight flicks and tremor do not trigger. |
| R8 | **GNOME API drift** in 51 and later: `position-invalidated`, `get_sprite` or `TextureNode` change | Med | Med: the extension stops working, but does not crash | Pin `shell-version` to versions we have tested. Feature-check in `enable()`: if the API is missing, log once and stay inert. GNOME then marks the extension as having an error instead of crashing. |
| R9 | **Interaction with the built-in Magnifier and screen sharing.** Both also inhibit the cursor or draw a sprite. | Low | Low | The inhibit is ref-counted, so it composes. Do not activate while the Magnifier is active (check `Main.magnifier.isActive()`). Test both together. |
| R10 | **Upscaled sprite looks blurry** | High | Low: cosmetic | Use trilinear filtering. Spike S3 looks for a higher-resolution source. |
| R11 | **Contention on the shared box.** A headless shell run competes with pcrecdev1's suites. | High, if we don't coordinate | Med: corrupts their timings and ours | doc 05 §1: ask pcrecdev1 for a window before every run, wrap runs in `scripts/watchdog`, run one at a time, and run detached with logs. |

## 3. Recovery playbook (for when the extension is dogfooded on frank's desktop)

Write these down before the first install:

1. **The extension is misbehaving, but the shell is alive:**
   `gnome-extensions disable mouse-tickler@dicostanzo.com` as frank, or toggle it off in
   the Extensions app.
2. **The cursor is stuck hidden:** disable the extension. The ref-counted
   inhibit is released in `disable()`. As a last resort, log out and back in.
3. **The shell crashes on login:** from a TTY (Ctrl+Alt+F3) or over ssh as
   frank, run `gsettings set org.gnome.shell disable-user-extensions true`, or
   remove `~/.local/share/gnome-shell/extensions/mouse-tickler@dicostanzo.com`, then log in
   again.
4. **Collect evidence:** `journalctl --user -b -o cat /usr/bin/gnome-shell`
   for frank.

## 4. Residual risk

After isolation and the soak gate, the remaining risk is roughly the same as
for any small, well-behaved extension. The worst plausible failure is "the
enlarged cursor misbehaves or doesn't show". The safety cap and the
release-in-`disable()` rule deal with the main failure that would affect the
user, a hidden cursor. A crash would need a mutter bug triggered by
the same API calls the built-in Magnifier makes every day.
