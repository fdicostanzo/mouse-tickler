// Preferences window (runs in a separate process, not in gnome-shell).

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function spinRow(settings, key, title, subtitle, lower, upper, step, digits) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        digits,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export default class MouseTicklerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'Shake to find',
            description: 'Shake the mouse and the cursor grows with how fast you shake.',
        });

        group.add(spinRow(settings, 'sensitivity', 'Sensitivity',
            'Higher triggers on smaller shakes', 1, 10, 1, 0));
        group.add(spinRow(settings, 'growth', 'Growth',
            'Size added per 1000 px/s of shake speed', 0.2, 5, 0.1, 1));
        group.add(spinRow(settings, 'max-scale', 'Maximum size',
            'Multiple of the normal cursor size', 1.5, 8, 0.5, 1));
        group.add(spinRow(settings, 'hold-ms', 'Hold time',
            'Milliseconds to stay large after shaking stops', 0, 2000, 50, 0));

        const fullscreen = new Adw.SwitchRow({
            title: 'Ignore fullscreen windows',
            subtitle: 'Do not trigger in games and videos',
        });
        settings.bind('ignore-fullscreen', fullscreen, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(fullscreen);

        page.add(group);
        window.add(page);
    }
}
