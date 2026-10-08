# 02 — Interfacing with GNOME Shell

Target: **GNOME Shell 50** (this box has 50.1, mutter ABI 18, gjs 1.88).
GNOME 50 removed X11 sessions entirely, so this is Wayland-only and
gnome-shell *is* the compositor. That has consequences — see doc 04.

## 1. Why it has to be a JS extension (and why that's fine)

GNOME Shell extensions are ES modules executed by gjs **inside the
gnome-shell process**. There is no supported native-code extension path:

- An external process (C/Rust) cannot, on Wayland, read the global pointer
  position or draw above all other surfaces. Only the compositor can.
- Loading a native library into the shell via GObject-Introspection is
  technically possible but (a) is rejected by extensions.gnome.org review
  ("don't ship binary executables or libraries"), and (b) a segfault in it
  kills the compositor and therefore the whole user session.

So "less resource hungry" is achieved by **doing less**, not by changing
language: no polling, no per-sample allocation, no CPU rasterization, and
letting mutter/Clutter (C, GPU) do the per-frame work. The JS we run is a
handful of arithmetic ops per motion event and per frame, and *zero* when
the pointer is still. See doc 03 §6 for the budget.

## 2. Extension anatomy (GNOME 45+ ESM)

```
mouse-tickler@dicostanzo.com/
  metadata.json        uuid, name, description, url, "shell-version": ["50"]
  extension.js         export default class extends Extension { enable(); disable() }
  prefs.js             export default class extends ExtensionPreferences (Adw/GTK4, separate process)
  schemas/org.gnome.shell.extensions.mouse-tickler.gschema.xml
```

Rules from the EGO review guidelines that shape the design:

- Construct nothing, connect nothing, add no main-loop source at module scope
  or in the constructor. Everything is created in `enable()` and **destroyed**
  in `disable()` (actors destroyed, signals disconnected, sources removed).
- No `Gtk/Gdk/Adw` in the shell process; no `Clutter/Meta/St/Shell` in prefs.
- No `version` key in metadata; list only real stable shell versions.
- Minimal logging. ESLint-clean, readable code.

## 3. APIs we use (verified against the installed typelibs / shell source)

Verified on this box by introspecting `Meta-18.typelib` and reading the
gnome-shell 50.1 JS from `libshell-18.so`'s gresource, and against mutter
`main` source.

| Need | API | Notes |
|---|---|---|
| Pointer-moved notification | `global.backend.get_cursor_tracker()` → signal **`position-invalidated`** | Emitted from `meta_backend_update_from_event()` for every `CLUTTER_MOTION` event of the pointer sprite. Event-driven: no events → no callbacks. Replaces `PointerWatcher` polling. |
| Pointer position | `tracker.get_pointer()` → `[Graphene.Point, mods]` (or `global.get_pointer()` → `[x, y, mods]`) | `mods` gives button state for the "don't trigger while dragging" rule (#26). |
| Current cursor image | `tracker.get_sprite()` → `Cogl.Texture` (nullable), `get_hot()` → `[x, y]`, `get_scale()` | Live sprite, follows theme/size/shape. Re-read on **`cursor-changed`**. |
| Real cursor hidden by someone else? | `tracker.get_pointer_visible()`, signal `visibility-changed` | Lets us not trigger in games/video (#44, #30). |
| Hide the real cursor while we draw ours | `tracker.inhibit_cursor_visibility()` / `uninhibit_cursor_visibility()` | **Ref-counted** (`cursor_visibility_inhibitors++`), the same mechanism the built-in Magnifier uses. Unlike Jiggle's `set_pointer_visible()` it can't fight other code — as long as we balance it (doc 04). |
| Draw the cursor image on the GPU | Our own `Clutter.Content` implementation (pattern of gnome-shell's private `MouseSpriteContent` in `ui/magnifier.js`): `vfunc_paint_content` adds a `Clutter.TextureNode(texture, …)` | Not exported by the shell, so we implement the ~30-line equivalent. Pure GPU texture blit; no Cairo. |
| Overlay layer | `Main.layoutManager.uiGroup` (above windows) or `global.stage` top | Actor is `reactive: false` so it never steals input. |
| Frame-synced animation | `Clutter.Timeline({actor, duration})` / actor transitions (`actor.ease`) | Driven by the stage frame clock — runs only while active and only at the display's refresh rate. |
| Cursor size / monitor scale | `Meta.prefs_get_cursor_size()`, `global.display.get_monitor_scale()` | HiDPI correctness; same approach as `MouseSpriteContent._textureScale`. |
| Monotonic time | `GLib.get_monotonic_time()` (µs) | Not `Date.now()`. |
| Settings | `this.getSettings()` (`Gio.Settings`), connect `changed::key` | |

### Prior art in-tree worth copying the *shape* of

- `ui/magnifier.js` — sprite content, hot-spot translation, the
  inhibit/uninhibit pairing and its booleans guarding double-inhibit.
- `ui/locatePointer.js` + `ui/ripples.js` — GNOME's built-in "locate pointer"
  (Ctrl key). A cheaper alternative effect that already exists.
- KWin's `shakecursor` plugin (Plasma 6) — production shake detector:
  path-length / bounding-box-diagonal ratio over a short window, with
  collinear samples merged. Our detector (doc 03) is an O(1) streaming
  variant of the same idea.

## 4. Things that don't exist / we must not rely on

- No native "shake to find" in GNOME (requested in
  gnome-shell#4027; not implemented as of 50).
- No public API to render the cursor at an arbitrary *native* size; the
  sprite is rasterized at the current cursor size × scale. Enlarging means
  upscaling the texture (see doc 03 §4 for mitigation).
- `PointerWatcher._removeWatch` and other `_private` members: avoid.

## 5. Tooling available on this box

- `gnome-extensions pack|install|enable|disable|info` — packaging and toggling.
- `glib-compile-schemas` — schema compile (pack does it too).
- `gnome-shell --headless --virtual-monitor WxH` — a compositor with no
  physical outputs; runs as a separate process, separate session.
- `gnome-shell-test-tool --headless --extension <zip> <script.js>` — runs an
  automation script (`ui/scripting.js` API, perf event collection) inside a
  headless shell with our extension installed. This is our test harness
  (doc 05).
- `--devkit` exists but the `mutter-devkit` viewer binary is **not
  installed**; installing it is the user's call.
- ESLint: not installed.

## 6. Spike results (M1, 2026-10-07, headless gnome-shell 50.1)

Scripts are in `tests/spikes/` and run through `tests/spikes/run-spike.sh`,
which isolates them with a private D-Bus session, throwaway XDG dirs, and a
watchdog bound. Each run took about 5 s of wall time and about 1.3 s of CPU.

| Spike | Result |
|---|---|
| S1 motion signal | **0** `position-invalidated` signals in 1 s of idle. **Exactly one signal per motion event**: 200/200 paced events, and 100/100 for a burst injected inside a single frame. There is no compression, so a 1000 Hz mouse means 1000 callbacks per second. **The 4 ms throttle in doc 03 §3 is therefore required, not optional.** |
| S2 sprite and inhibit | `get_sprite()` returns a 24×24 `Cogl.Texture`. `get_hot()` = `[3,1]` and `get_scale()` = 1 for Adwaita at size 24. `inhibit_cursor_visibility()` changes `get_pointer_visible()` from true to false, and uninhibit changes it back to true. `cursor-changed` fires on the first pointer appearance. |
| S3 upscaling | See `img/s3-filters.png` (left to right: NEAREST, LINEAR, TRILINEAR, each at 1× and 4×). NEAREST is blocky. LINEAR and TRILINEAR look the same when magnifying and are soft but clean. **Decision: LINEAR.** TRILINEAR would build mipmaps for no gain. The actor **must** use `request_mode: CONTENT_SIZE`, otherwise it has zero size and is invisible. The Adwaita Xcursor files on disk contain sizes 24–96. A future "crisp" option could load the 96 px image of the default arrow, but mutter does not expose the current shape name. This is deferred. |
| S4 virtual pointer | `seat.create_virtual_device(POINTER_DEVICE)` with `notify_absolute_motion`/`notify_relative_motion` moves the pointer, and `global.get_pointer()` and `tracker.get_pointer()` follow it. Integration tests can drive the extension this way. |
| APIs | `Clutter.TextureNode` and `Main.magnifier` exist, and `Clutter.ScalingFilter.TRILINEAR` = 2. |
