# Mouse Tickler

A GNOME Shell extension for finding the pointer: shake the mouse and the cursor grows.
The faster you shake, the bigger it gets. When you stop, it shrinks back.

It is a lightweight rewrite of [Jiggle](https://github.com/mattpass/jiggle) for
GNOME Shell 50:

- **Nothing runs while the mouse is still.** It reacts to mutter's pointer-motion
  signal instead of polling with timers.
- **It shows your real cursor.** That includes your theme, size, and the current
  shape (arrow, text beam, hand). The cursor is scaled around its tip, so clicks
  still land where the tip points.
- **It stays out of the way.** It doesn't trigger while a mouse button is held
  (dragging or painting), while an app has hidden the cursor (games, video),
  over fullscreen windows (optional), or while the Magnifier is on.
- **It can't leave you without a cursor.** If anything goes wrong, the real
  cursor comes back within 5 seconds, and disabling the extension always
  restores it.

## Install (from source)

```sh
make pack
gnome-extensions install --force build/mouse-tickler@dicostanzo.com.shell-extension.zip
# Log out and back in (Wayland), then:
gnome-extensions enable mouse-tickler@dicostanzo.com
gnome-extensions prefs mouse-tickler@dicostanzo.com   # optional settings
```

## If something goes wrong

1. Disable it: `gnome-extensions disable mouse-tickler@dicostanzo.com`, or
   turn it off in the Extensions app.
2. If the shell won't start, open a text console (Ctrl+Alt+F3) or ssh in as the
   same user, then run
   `gsettings set org.gnome.shell disable-user-extensions true` and log in
   again.
3. Logs: `journalctl --user -b -o cat /usr/bin/gnome-shell | grep -i tickler`

## Development

- `make test-unit`: unit tests for the shake detector. Plain gjs, takes seconds.
- `make test-shell`: integration tests in an isolated **headless** gnome-shell,
  driven by a virtual mouse. They never touch your desktop session.
- Design, risk assessment and test plan: [docs/design/](docs/design/README.md).

License: GPL-3.0.
