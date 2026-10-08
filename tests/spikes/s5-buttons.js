import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
export const METRICS = {};
export async function run() {
    await Scripting.sleep(800);
    const seat = Clutter.get_default_backend().get_default_seat();
    const dev = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const t = () => GLib.get_monotonic_time();
    const evs = [];
    const sid = global.stage.connect('captured-event', (a, ev) => {
        const ty = ev.type();
        if (ty === Clutter.EventType.BUTTON_PRESS || ty === Clutter.EventType.BUTTON_RELEASE || ty === Clutter.EventType.MOTION)
            evs.push(`${ty}:${ev.get_state()}`);
        return Clutter.EVENT_PROPAGATE;
    });
    const q = () => JSON.stringify(global.get_pointer()[2]);
    dev.notify_absolute_motion(t(), 300, 300);
    await Scripting.sleep(50);
    print(`SPIKE before: query_state=${q()}`);
    dev.notify_button(t(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    await Scripting.sleep(50);
    print(`SPIKE pressed: query_state=${q()}`);
    dev.notify_absolute_motion(t(), 320, 300);
    await Scripting.sleep(50);
    dev.notify_button(t(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    await Scripting.sleep(50);
    print(`SPIKE released: query_state=${q()}`);
    print(`SPIKE captured events: ${evs.join(' ')} (MOTION=${Clutter.EventType.MOTION} PRESS=${Clutter.EventType.BUTTON_PRESS})`);
    global.stage.disconnect(sid);
}
