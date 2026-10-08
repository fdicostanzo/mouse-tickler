// Open the extension's prefs window in a headless shell and report errors.
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
export const METRICS = {};
export async function run() {
    await Scripting.sleep(1500);
    const uuid = 'mouse-tickler@dicostanzo.com';
    print(`SPIKE state=${Main.extensionManager.lookup(uuid)?.state}`);
    Main.extensionManager.openExtensionPrefs(uuid, '', {});
    await Scripting.sleep(6000);
    const wins = global.display.list_all_windows().map(w => `${w.get_wm_class()}|${w.get_title()}`);
    print(`SPIKE windows: ${JSON.stringify(wins)}`);
}
