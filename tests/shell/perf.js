// CPU / wake-up comparison (doc 05 §4). Runs inside a headless shell with
// zero or one extension enabled; prints per-phase gnome-shell CPU time and
// main-thread context switches. Phases: idle, plain motion, shaking.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const METRICS = {};
const PHASE_MS = 20000;
const now = () => GLib.get_monotonic_time();
let dev;

function read(path) {
    return new TextDecoder().decode(GLib.file_get_contents(path)[1]);
}

function sample() {
    const stat = read('/proc/self/stat');
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ticks = Number(f[11]) + Number(f[12]); // utime + stime, all threads
    const st = read('/proc/self/task/' + read('/proc/self/stat').split(' ')[0] + '/status');
    const ctx = Number(/voluntary_ctxt_switches:\s+(\d+)/.exec(st)[1]) +
        Number(/nonvoluntary_ctxt_switches:\s+(\d+)/.exec(st)[1]);
    return {ticks, ctx, t: now()};
}

async function phase(name, body) {
    const a = sample();
    await body();
    const b = sample();
    const s = (b.t - a.t) / 1e6;
    print(`PERF ${name}: cpu=${((b.ticks - a.ticks) * 10 / s).toFixed(1)} ms/s ` +
        `main-thread-switches=${((b.ctx - a.ctx) / s).toFixed(1)} /s over ${s.toFixed(1)} s`);
}

async function motion(ms, path) {
    const t0 = now();
    for (let el = 0; el < ms; el = (now() - t0) / 1000) {
        const [x, y] = path(el);
        dev.notify_absolute_motion(now(), x, y);
        await Scripting.sleep(8);
    }
}

export async function run() {
    await Scripting.sleep(3000); // let startup settle
    dev = Clutter.get_default_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    print(`PERF config: ${GLib.getenv('MT_PERF_LABEL') ?? '?'}`);
    for (const uuid of Main.extensionManager.getUuids()) {
        const e = Main.extensionManager.lookup(uuid);
        if (e.path.startsWith(GLib.get_user_data_dir()))
            print(`PERF extension ${uuid} state=${e.state} error=${e.error}`);
    }

    await phase('idle', () => Scripting.sleep(PHASE_MS));
    await phase('moving', () => motion(PHASE_MS, el => {
        const a = 2 * Math.PI * 0.3 * el / 1000;
        return [640 + 250 * Math.cos(a), 360 + 200 * Math.sin(a)];
    }));
    await phase('shaking', async () => {
        // 1 s shake, 1 s still, repeated.
        const t0 = now();
        while (now() - t0 < PHASE_MS * 1000) {
            await motion(1000, el => [640 + 150 * Math.sin(2 * Math.PI * 4 * el / 1000), 360]);
            await Scripting.sleep(1000);
        }
    });
    await phase('idle-after', () => Scripting.sleep(PHASE_MS));
    print('RESULT OK');
}
