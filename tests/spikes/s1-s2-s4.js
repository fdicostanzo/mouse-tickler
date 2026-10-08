// Spikes S1 (motion signal), S2 (sprite + inhibit), S4 (virtual pointer).
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const METRICS = {};

function out(k, v) {
    print(`SPIKE ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
}

export async function run() {
    await Scripting.sleep(1000);
    const tracker = global.backend.get_cursor_tracker();
    let count = 0;
    const id = tracker.connect('position-invalidated', () => count++);
    let changed = 0;
    const id2 = tracker.connect('cursor-changed', () => changed++);

    // S1a: idle -> no signals
    await Scripting.sleep(1000);
    out('S1 idle signals in 1s', count);

    // S4: virtual pointer
    const seat = Clutter.get_default_backend().get_default_seat();
    const dev = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    count = 0;
    const N = 200;
    const t0 = GLib.get_monotonic_time();
    const seen = [];
    for (let i = 0; i < N; i++) {
        const x = 640 + 200 * Math.sin(i / 5), y = 360;
        dev.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        if (i % 50 === 0) {
            await Scripting.sleep(8);
            seen.push(global.get_pointer().slice(0, 2));
        } else {
            await Scripting.sleep(8);
        }
    }
    const dtMs = (GLib.get_monotonic_time() - t0) / 1000;
    out('S1 injected', {events: N, signals: count, ms: Math.round(dtMs)});
    out('S4 pointer samples', seen);
    const [pt, mods] = tracker.get_pointer();
    out('S4 tracker.get_pointer', {x: pt.x, y: pt.y, mods});

    // Burst: many events within one frame (compression?)
    count = 0;
    for (let i = 0; i < 100; i++)
        dev.notify_relative_motion(GLib.get_monotonic_time(), i % 2 ? 3 : -3, 0);
    await Scripting.sleep(100);
    out('S1 burst 100 relative events in 0ms -> signals', count);

    // S2: sprite
    const tex = tracker.get_sprite();
    out('S2 sprite', tex ? {w: tex.get_width(), h: tex.get_height()} : null);
    out('S2 hot', tracker.get_hot());
    out('S2 scale', tracker.get_scale());
    out('S2 cursor size pref', Meta.prefs_get_cursor_size());
    out('S2 cursor-changed count', changed);
    out('S2 visible before', tracker.get_pointer_visible());
    tracker.inhibit_cursor_visibility();
    out('S2 visible after inhibit', tracker.get_pointer_visible());
    tracker.uninhibit_cursor_visibility();
    out('S2 visible after uninhibit', tracker.get_pointer_visible());

    // API presence
    out('API TextureNode', typeof Clutter.TextureNode);
    out('API TRILINEAR', Clutter.ScalingFilter.TRILINEAR);
    out('API Main.magnifier', typeof Main.magnifier);
    out('API monitor scale', global.display.get_monitor_scale(0));
    out('API renderer', Clutter.get_default_backend().get_cogl_context ? 'has cogl ctx' : '?');

    tracker.disconnect(id);
    tracker.disconnect(id2);
    dev.run_dispose?.call ? null : null;
}
