# mouse-tickler: design docs

A lean GNOME Shell 50 extension: shake the mouse and the real cursor grows,
in proportion to how fast you shake it. It is a clean-room replacement for
[Jiggle](https://github.com/mattpass/jiggle).

| Doc | Contents |
|---|---|
| [01-source-survey.md](01-source-survey.md) | What Jiggle does, why it is heavy, and its defects (upstream issues mapped to root causes) |
| [02-gnome-integration.md](02-gnome-integration.md) | Extension model, and the verified GNOME 50 / mutter-18 APIs we build on |
| [03-architecture.md](03-architecture.md) | Modules, event-driven data flow, shake detector, rendering, resource budget, settings |
| [04-risk-assessment.md](04-risk-assessment.md) | How experimenting stays away from the live desktop, the risk register, and recovery |
| [05-dev-and-test-plan.md](05-dev-and-test-plan.md) | Shared-box etiquette, spikes, test layers, performance method, milestones |

## Summary

- **Jiggle's cost comes from polling, not from JS.** It runs about 130 timer
  wake-ups per second forever, even when idle. It allocates on every sample,
  reloads its icon on every frame, and its other effects rasterize a full
  screen with Cairo at 30 fps.
- **Our design is event-driven.** We listen to mutter's
  `CursorTracker::position-invalidated`, so no code runs while the pointer is
  still. A frame-synced animation runs only while the effect is visible. The
  shake detector is O(1) and does not allocate. The cursor is drawn by blitting
  the **live** cursor sprite on the GPU, scaled around its hotspot.
- **Safety.** Development and testing happen in a headless gnome-shell under
  the `pcrec` user. That process is separate from frank's desktop session. The
  hidden-cursor failure is limited by a ref-counted inhibit, a
  release-on-every-path rule, and a 5 s safety cap.
