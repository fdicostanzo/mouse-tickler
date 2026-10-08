// mouse-tickler: shake the pointer and the cursor grows with shake speed.
// Design: docs/design/03-architecture.md. Risks: docs/design/04-risk-assessment.md.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ShakeDetector} from './detector.js';
import {CursorOverlay} from './sprite.js';

const THROTTLE_US = 4000;        // max ~250 detector updates/s (spike S1)
const ACTIVATE_AT = 1.15;        // target scale that shows the overlay
const MAX_ACTIVE_S = 5;          // safety cap (risk R1)
const COOLDOWN_US = 1000000;     // after the cap or an error
const BUTTONS = Clutter.ModifierType.BUTTON1_MASK |
    Clutter.ModifierType.BUTTON2_MASK | Clutter.ModifierType.BUTTON3_MASK |
    Clutter.ModifierType.BUTTON4_MASK | Clutter.ModifierType.BUTTON5_MASK;

export default class MouseTicklerExtension extends Extension {
    enable() {
        this._tracker = global.backend.get_cursor_tracker();
        this._detector = new ShakeDetector();
        this._overlay = null;
        this._timeline = null;
        this._capId = 0;
        this._cursorChangedId = 0;
        this._inhibited = false;
        this._active = false;
        this._lastSample = 0;
        this._cooldownUntil = 0;
        this._loggedError = false;

        this._settings = this.getSettings();
        this._settings.connectObject('changed', () => this._loadSettings(), this);
        this._loadSettings();

        this._tracker.connectObject('position-invalidated',
            () => this._onMotion(), this);
    }

    disable() {
        // Releases the cursor inhibit on every path (risk R1).
        this._deactivate();
        this._tracker.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._overlay?.destroy();
        this._overlay = null;
        this._settings = null;
        this._detector = null;
        this._tracker = null;
    }

    _loadSettings() {
        const s = this._settings;
        this._detector.configure({
            sensitivity: s.get_int('sensitivity'),
            growth: s.get_double('growth'),
            maxScale: s.get_double('max-scale'),
            holdMs: s.get_int('hold-ms'),
        });
        this._ignoreFullscreen = s.get_boolean('ignore-fullscreen');
    }

    // Hot path: runs once per pointer motion event. No allocation beyond
    // get_pointer()'s return value, no loops.
    _onMotion() {
        const now = GLib.get_monotonic_time();
        if (now - this._lastSample < THROTTLE_US)
            return;
        this._lastSample = now;

        try {
            const [x, y, mods] = global.get_pointer();
            if (mods & BUTTONS) {
                // Dragging or painting is not shaking (Jiggle #26).
                this._detector.reset();
                return;
            }
            const t = now / 1000;
            this._detector.push(x, y, t);
            if (!this._active && now >= this._cooldownUntil &&
                this._detector.target(t) > ACTIVATE_AT && this._allowed())
                this._activate();
        } catch (e) {
            this._fail(e);
        }
    }

    _allowed() {
        if (!this._tracker.get_pointer_visible())
            return false; // a game or video hid the cursor (Jiggle #44)
        if (Main.magnifier?.isActive?.())
            return false; // the magnifier already draws the cursor (R9)
        const win = global.display.focus_window;
        if (this._ignoreFullscreen && win?.is_fullscreen())
            return false; // Jiggle #30
        return true;
    }

    _activate() {
        if (!this._overlay) {
            this._overlay = new CursorOverlay(this._tracker);
            Main.layoutManager.uiGroup.add_child(this._overlay.actor);
        }
        if (!this._overlay.refresh())
            return;

        this._active = true;
        const actor = this._overlay.actor;
        Main.layoutManager.uiGroup.set_child_above_sibling(actor, null);
        const [x, y] = global.get_pointer();
        this._overlay.place(x, y, 1);
        actor.show();

        if (!this._inhibited) {
            this._tracker.inhibit_cursor_visibility();
            this._inhibited = true;
        }

        this._cursorChangedId = this._tracker.connect('cursor-changed',
            () => this._overlay.refresh());

        this._timeline = new Clutter.Timeline({actor, duration: 1000, repeat_count: -1});
        this._timeline.connect('new-frame', () => this._onFrame());
        this._timeline.start();

        this._capId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, MAX_ACTIVE_S, () => {
            this._capId = 0;
            this._rest(COOLDOWN_US);
            return GLib.SOURCE_REMOVE;
        });
    }

    // Runs once per displayed frame, only while active.
    _onFrame() {
        try {
            const scale = this._detector.advance(GLib.get_monotonic_time() / 1000);
            const [x, y] = global.get_pointer();
            this._overlay.place(x, y, scale);
            if (this._detector.atRest)
                this._deactivate();
        } catch (e) {
            this._fail(e);
        }
    }

    // Stop showing now and ignore shakes for `cooldownUs`.
    _rest(cooldownUs) {
        this._cooldownUntil = GLib.get_monotonic_time() + cooldownUs;
        this._detector.reset();
        this._deactivate();
    }

    // Idempotent; safe to call from any state.
    _deactivate() {
        try {
            this._active = false;
            if (this._capId) {
                GLib.source_remove(this._capId);
                this._capId = 0;
            }
            if (this._timeline) {
                this._timeline.stop();
                this._timeline = null;
            }
            if (this._cursorChangedId) {
                this._tracker.disconnect(this._cursorChangedId);
                this._cursorChangedId = 0;
            }
            this._overlay?.actor.hide();
        } finally {
            if (this._inhibited) {
                this._inhibited = false;
                this._tracker.uninhibit_cursor_visibility();
            }
        }
    }

    _fail(e) {
        if (!this._loggedError) {
            this._loggedError = true;
            logError(e, 'mouse-tickler');
        }
        this._rest(COOLDOWN_US * 5);
    }
}
