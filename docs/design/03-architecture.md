# 03 — Architecture

## 1. Goals and non-goals

Goals, in priority order:

1. **It must never break the session.** Doc 04 covers this.
2. **It costs nothing when idle.** No timers and no wake-ups while the pointer
   is still.
3. **It responds quickly.** Visible growth starts within about one frame of a
   shake being detected. Size follows shake speed continuously.
4. **It shows the user's real cursor.** Theme, size and shape (I-beam, hand,
   and so on) are kept. The hotspot stays exactly where clicks land.
5. **The code is small.** Target: fewer than 400 lines of JS including prefs.

Non-goals: Spotlight, Fireworks and Trail effects. Support for GNOME versions
before 50 or for X11. Translations in v1.

## 2. Module layout

```
extension.js     lifecycle: enable/disable, signal wiring, IDLE/ACTIVE state machine
detector.js      pure math: shake detector + speed estimator (no gi:// imports)
                 -> unit-testable with plain `gjs -m`, no shell needed
sprite.js        CursorContent (Clutter.Content) + overlay actor helpers
prefs.js         Adw preferences page (separate process)
schemas/org.gnome.shell.extensions.mouse-tickler.gschema.xml
```

## 3. Data flow

```
              (only while pointer moves)
mutter ──position-invalidated──▶ onMotion()
                                   │ throttle: skip if < 4 ms since last sample
                                   │ [x,y,mods] = get_pointer()
                                   ▼
                              detector.push(x, y, t)   O(1), no allocation
                                   │
                    state IDLE && detector.scaleTarget() > 1.15
                    && pointerVisible && no button held
                                   ▼
                              activate()
                                ├─ actor.show(), set sprite texture + hotspot
                                ├─ tracker.inhibit_cursor_visibility()   (ref-counted)
                                └─ start frame-clock timeline
                                         │ each display frame:
                                         │   pos = get_pointer(); place actor
                                         │   s = smooth(s, detector.scaleTarget(now))
                                         │   actor.scale = s
                                         │   if s ≈ 1 and target == 1: deactivate()
                                         ▼
                              deactivate()
                                ├─ stop timeline
                                ├─ tracker.uninhibit_cursor_visibility()
                                └─ actor.hide()
```

There are two states. In **IDLE** the only thing connected is the motion
signal handler, and it runs only while the pointer moves. In **ACTIVE** a
frame-synced timeline also runs. The extension owns no `GLib.timeout` or idle
source at all, except the safety cap described in §7.

## 4. Shake detector (detector.js)

This is a streaming version of KWin's shake detector. The goal is constant
work per sample, a fixed amount of memory, and no allocation.

**Inputs:** `(x, y, tµs)` in logical stage coordinates. Negative coordinates
are valid.

**Speed estimate:**

```
d    = (x - px, y - py);  dt = t - pt
v    = |d| / dt                        // px/s
a    = 1 - exp(-dt / TAU_V)            // TAU_V ≈ 60 ms
vEma = vEma + a * (v - vEma)
```

**Shake gate** (based on direction reversals):

- Add up displacement into the current "leg" for as long as the direction stays
  consistent. Steps shorter than 1 px count as any direction, as in KWin.
- A **reversal** is a new step whose dot product with the current leg direction
  is negative, meaning it turns by more than 90°. When a reversal happens and
  the finished leg is at least `MIN_LEG` px long, record `t` in an 8-slot
  `Float64Array` ring buffer.
- The gate is **open** when at least `N_REV` reversals fall inside the last
  `WINDOW` ms.
- Defaults: `N_REV = 3`, `MIN_LEG = 40 px`, `WINDOW = 600 ms`. The single
  user-facing *sensitivity* setting (1–10) maps to these three values.

**Size target.** It is linear in speed, as requested:

```
target = gateOpen ? clamp(1 + GAIN * (vEma - V0), 1, MAX_SCALE) : 1
```

Defaults: `V0 = 300 px/s`, `GAIN = 1.4 per 1000 px/s`, `MAX_SCALE = 4`. With
these values a vigorous shake (about 2,500 px/s) reaches roughly 4×.

**Displayed size** is updated each frame while ACTIVE:

- When `target > s`, move toward it quickly: `s += (target - s) * (1 - exp(-dt/40ms))`.
- When `target < s`, keep the current size for `HOLD` ms (default 300) after
  the gate last saw a reversal. This fixes #73. Then decay with `tau = 150 ms`.
- Size is a continuous function of the input. Nothing restarts an animation,
  so the grow, shrink, grow loop of Jiggle #74 cannot happen.

The detector is pure JS with no `gi://` imports. Its unit tests run under
plain `gjs` without a shell: synthetic sine-wave shakes, straight flicks that
must *not* trigger, slow tremor that must *not* trigger, and negative
coordinates.

## 5. Rendering (sprite.js)

- `CursorContent` is a GObject that implements `Clutter.Content`.
  `vfunc_paint_content` adds a single `Clutter.TextureNode` for the current
  sprite texture. `vfunc_get_preferred_size` returns the texture size divided
  by the sprite scale, the same approach as gnome-shell's `MouseSpriteContent`.
  No Cairo is used and nothing is rasterized on the CPU.
- The overlay is one `Clutter.Actor` with `reactive: false`. It is created
  lazily on the first activation, added to `Main.layoutManager.uiGroup`, and
  hidden when not in use. It is destroyed in `disable()`.
- **Hotspot fix (#57).** Set `pivot_point = (hotX / w, hotY / h)` and place the
  actor at `(x - hotX, y - hotY)`. Scaling by `s` then keeps the tip at the
  real pointer position.
- **Shape changes.** While ACTIVE, connect `cursor-changed` and refresh the
  texture and hotspot. Disconnect it on deactivate, so in IDLE the signal costs
  nothing.
- **Upscaling quality.** Use `Clutter.ScalingFilter.LINEAR` (spike S3) for
  magnification. A 24 px cursor at 4× looks soft but is easy to read
  (`img/s3-filters.png`). The actor needs `request_mode: CONTENT_SIZE`.
  Adwaita ships Xcursor images up to 96 px, but mutter does not expose the
  current shape name, so a crisp high-resolution path is deferred.
- **HiDPI.** Divide the texture's pixel size by the sprite scale
  (`tracker.get_scale()` or the shell's heuristic) to get the logical size.

## 6. Resource budget (acceptance criteria)

| Situation | Budget |
|---|---|
| Pointer still | **0** JS callbacks per second. 0 GLib sources owned. No allocations. |
| Pointer moving, no shake | 1 callback per motion event, with detector work throttled to ≤ 250 per second. Each update is O(1). The only allocation is the `get_pointer()` return value. |
| Shake active (≈ 0.3–2 s) | Additionally 1 callback per display frame. One texture blit of ≤ 128×128 logical px. Damage limited to the old and new actor rectangles. |
| Memory | One hidden actor, one content object, and an 8-slot ring buffer. Target: < 1 MB RSS added to gnome-shell. |

Trade-off while ACTIVE: the real cursor is inhibited and our cursor is drawn
by the compositor, so the hardware cursor plane and fullscreen direct
scanout are bypassed. This lasts only as long as the effect is shown, and
the built-in Magnifier makes the same trade-off.

Doc 05 says how each row of this table is measured.

## 7. Suppression rules

- Never activate while the real cursor is hidden by someone else
  (`!tracker.get_pointer_visible()`). This covers games and video players
  (#44).
- Never activate while a mouse button is held: `mods & BUTTON1..5_MASK` (#26).
- Optional setting, on by default: never activate while the focused window is
  fullscreen (#30).
- **Safety cap.** Force deactivation after ACTIVE has lasted
  `MAX_ACTIVE = 5 s`, followed by a short cooldown. This is the only
  `GLib.timeout` the extension owns, and it exists only while ACTIVE. It means
  a logic error can never leave the cursor hidden for more than a few seconds.
  See doc 04, R1.

## 8. Settings (GSettings, 5 keys)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `sensitivity` | i 1–10 | 5 | How easily a shake triggers. Maps to N_REV, MIN_LEG and WINDOW. |
| `max-scale` | d 1.5–8 | 4.0 | Upper bound on the scale. |
| `growth` | d 0.2–5 | 1.4 | GAIN: scale added per 1000 px/s. |
| `hold-ms` | i 0–2000 | 300 | How long to hold the size after shaking stops. |
| `ignore-fullscreen` | b | true | Suppress activation over fullscreen windows. |

Values are read once on enable and again on `changed::`. The hot path never
reads GSettings. Prefs is one `Adw.PreferencesPage` with one group and five
rows.

## 9. Packaging

- UUID: `mouse-tickler@dicostanzo.com` (chosen by the user, 2026-10-07).
  Schema ID `org.gnome.shell.extensions.mouse-tickler`, path
  `/org/gnome/shell/extensions/mouse-tickler/`.
- `metadata.json`: `"shell-version": ["50"]`. Add 51 only after testing it. No
  `version` key.
- Build with `gnome-extensions pack`, which compiles schemas. A tiny Makefile
  provides `pack`, `lint` and `test-unit`.
- License: GPL-3.0 (the repo LICENSE). This is compatible with EGO's
  GPL-2.0-or-later requirement. No code is copied from Jiggle (GPL-2.0-only).
  The `CursorContent` pattern follows gnome-shell's GPL-2.0-or-later
  magnifier and will be attributed in a code comment.
