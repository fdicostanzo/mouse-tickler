// Spike S3: how does the live sprite look upscaled with each filter?
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const METRICS = {};
const OUT = GLib.getenv('SPIKE_OUT');

const Content = GObject.registerClass({Implements: [Clutter.Content]},
class Content extends GObject.Object {
    _init(tex) { super._init(); this._t = tex; }
    vfunc_get_preferred_size() { return [true, this._t.get_width(), this._t.get_height()]; }
    vfunc_paint_content(actor, node) {
        const [minF, magF] = actor.get_content_scaling_filters();
        const n = new Clutter.TextureNode(this._t, null, minF, magF);
        node.add_child(n);
        n.add_rectangle(actor.get_content_box());
    }
});

export async function run() {
    await Scripting.sleep(800);
    const tracker = global.backend.get_cursor_tracker();
    const seat = Clutter.get_default_backend().get_default_seat();
    const dev = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    dev.notify_absolute_motion(GLib.get_monotonic_time(), 1200, 700);
    await Scripting.sleep(200);
    const tex = tracker.get_sprite();
    const [hx, hy] = tracker.get_hot();
    const bg = new Clutter.Actor({x: 0, y: 0, width: 700, height: 200,
        background_color: new (imports.gi.Cogl.Color)({red: 230, green: 230, blue: 230, alpha: 255})});
    Main.layoutManager.uiGroup.add_child(bg);
    const filters = [['NEAREST', Clutter.ScalingFilter.NEAREST], ['LINEAR', Clutter.ScalingFilter.LINEAR], ['TRILINEAR', Clutter.ScalingFilter.TRILINEAR]];
    filters.forEach(([name, f], i) => {
        for (const [j, s] of [[0, 1], [1, 4]].entries()) {
            const a = new Clutter.Actor({content: new Content(tex), reactive: false, request_mode: Clutter.RequestMode.CONTENT_SIZE,
                x: 20 + i * 230 + s[0] * 40, y: 20,
                pivot_point: new (imports.gi.Graphene.Point)({x: hx / tex.get_width(), y: hy / tex.get_height()})});
            a.set_content_scaling_filters(f, f);
            a.set_scale(s[1], s[1]);
            Main.layoutManager.uiGroup.add_child(a);
        }
    });
    await Scripting.sleep(300);
    const shot = new Shell.Screenshot();
    const file = Gio.File.new_for_path(OUT);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    await new Promise((res, rej) => shot.screenshot_area(0, 0, 700, 200, stream, (o, r) => {
        try { o.screenshot_area_finish(r); res(); } catch (e) { rej(e); }
    }));
    stream.close(null);
    print(`SPIKE S3 wrote ${OUT} sprite=${tex.get_width()}x${tex.get_height()} hot=${hx},${hy}`);
}
