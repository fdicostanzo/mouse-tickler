// Integration test: runs inside a headless gnome-shell with the extension
// enabled (make test-shell). Drives a virtual pointer and checks behaviour.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const METRICS = {};
const UUID = 'mouse-tickler@dicostanzo.com';
const BTN_LEFT = 0x110;

let failures = 0;
function check(name, cond, detail = '') {
    print(`${cond ? 'PASS' : 'FAIL'} ${name} ${detail}`);
    if (!cond)
        failures++;
}

const now = () => GLib.get_monotonic_time();
let dev, tracker;

function ext() {
    return Main.extensionManager.lookup(UUID)?.stateObj;
}

async function moveTo(x, y) {
    dev.notify_absolute_motion(now(), x, y);
    await Scripting.sleep(8);
}

// Shake horizontally around (cx, cy); calls probe(elapsedMs) after each step.
async function shake(ms, {amp = 150, hz = 4, cx = 640, cy = 360, probe} = {}) {
    const t0 = now();
    for (let el = 0; el < ms; el = (now() - t0) / 1000) {
        await moveTo(cx + amp * Math.sin(2 * Math.PI * hz * el / 1000), cy);
        probe?.(el);
    }
}

function hotspotOnScreen(e) {
    const o = e._overlay;
    const p = o.actor.apply_transform_to_point(new Graphene.Point3D({x: o._hotX, y: o._hotY, z: 0}));
    return [p.x, p.y];
}

async function settle(ms = 2000) {
    await Scripting.sleep(ms);
}

export async function run() {
    await Scripting.sleep(1000);
    tracker = global.backend.get_cursor_tracker();
    dev = Clutter.get_default_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    await moveTo(640, 360);

    let e = ext();
    check('extension loaded and enabled', !!e && Main.extensionManager.lookup(UUID).state === 1,
        `state=${Main.extensionManager.lookup(UUID)?.state} error=${Main.extensionManager.lookup(UUID)?.error}`);
    if (!e)
        throw new Error('extension not running');

    // Idle: nothing happens.
    await Scripting.sleep(500);
    check('idle: not active', !e._active);

    // Shake: overlay grows, real cursor hidden, hotspot stays on pointer.
    let maxScale = 1, maxHotErr = 0, sawHidden = false;
    await shake(900, {probe: () => {
        if (e._active) {
            maxScale = Math.max(maxScale, e._overlay.actor.scale_x);
            sawHidden ||= !tracker.get_pointer_visible();
        }
    }});
    check('shake activates', e._active);
    check('shake grows cursor > 2x', maxScale > 2, `max=${maxScale.toFixed(2)}`);
    check('real cursor hidden while active', sawHidden);
    if (e._active) {
        await Scripting.sleep(20); // let a frame place the actor
        const [px, py] = global.get_pointer();
        const [hx, hy] = hotspotOnScreen(e);
        maxHotErr = Math.hypot(hx - px, hy - py);
        check('hotspot stays on pointer (<= 1.5 px)', maxHotErr <= 1.5,
            `err=${maxHotErr.toFixed(2)} scale=${e._overlay.actor.scale_x.toFixed(2)}`);
    }

    // Stop: returns to rest within hold (300 ms) + 1.5 s.
    const tStop = now();
    while (e._active && now() - tStop < 3000000)
        await Scripting.sleep(20);
    const restMs = (now() - tStop) / 1000;
    check('returns to rest after shaking stops', !e._active && restMs < 1800, `${restMs.toFixed(0)} ms`);
    check('R1: cursor visible after rest', tracker.get_pointer_visible());
    check('overlay hidden after rest', !e._overlay.actor.visible);

    // Straight flick and slow motion: no activation.
    let activated = false;
    for (let i = 0; i < 40; i++) {
        await moveTo(100 + i * 25, 300);
        activated ||= e._active;
    }
    check('straight flick does not activate', !activated);
    await settle(500);

    // Mouse button held: no activation (painting/dragging).
    dev.notify_button(now(), BTN_LEFT, Clutter.ButtonState.PRESSED);
    activated = false;
    await shake(900, {probe: () => { activated ||= e._active; }});
    dev.notify_button(now(), BTN_LEFT, Clutter.ButtonState.RELEASED);
    check('button held: no activation', !activated);
    await settle(500);

    // Safety cap: continuous shaking for 6.5 s ends the effect at ~5 s.
    let capAt = -1, wasActive = false;
    await shake(6500, {probe: el => {
        wasActive ||= e._active;
        if (wasActive && !e._active && capAt < 0)
            capAt = el;
    }});
    check('safety cap ends a 6.5 s shake', wasActive && capAt > 4500 && capAt < 6000, `capAt=${capAt.toFixed(0)} ms`);
    check('R1: cursor visible after cap', tracker.get_pointer_visible());
    await settle();

    // Disable while active: cursor restored, actor destroyed.
    await shake(900);
    check('active before disable', e._active);
    const uiCount = () => Main.layoutManager.uiGroup.get_children()
        .filter(a => a.name === 'mouse-tickler-cursor').length;
    await Main.extensionManager._callExtensionDisable(UUID);
    check('R1: cursor visible after disable-while-active', tracker.get_pointer_visible());
    check('overlay destroyed on disable', uiCount() === 0, `count=${uiCount()}`);

    // Enable/disable cycles with shakes in between: no leaks, cursor visible.
    const rss0 = rssKb();
    for (let i = 0; i < 200; i++) {
        await Main.extensionManager._callExtensionEnable(UUID);
        if (i % 20 === 0) {
            e = ext();
            await shake(700, {amp: 120});
        }
        await Main.extensionManager._callExtensionDisable(UUID);
    }
    check('R1: cursor visible after 200 cycles', tracker.get_pointer_visible());
    check('no overlay actors left after cycles', uiCount() === 0, `count=${uiCount()}`);
    print(`info: RSS ${rss0} -> ${rssKb()} kB over 200 cycles`);
    await Main.extensionManager._callExtensionEnable(UUID);

    print(`RESULT ${failures === 0 ? 'OK' : `${failures} FAILED`}`);
    if (failures)
        throw new Error(`${failures} checks failed`);
}

function rssKb() {
    const [, bytes] = GLib.file_get_contents('/proc/self/status');
    const m = /VmRSS:\s+(\d+)/.exec(new TextDecoder().decode(bytes));
    return m ? Number(m[1]) : -1;
}
