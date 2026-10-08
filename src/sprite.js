// The enlarged cursor: one non-reactive actor that blits the live cursor
// sprite texture on the GPU. Design: docs/design/03-architecture.md §5.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';

// Modelled on gnome-shell's MouseSpriteContent (js/ui/magnifier.js,
// GPL-2.0-or-later), which is not exported.
const CursorContent = GObject.registerClass({
    Implements: [Clutter.Content],
}, class CursorContent extends GObject.Object {
    _init() {
        super._init();
        this._texture = null;
        this._width = 0;
        this._height = 0;
    }

    setTexture(texture, width, height) {
        if (texture === this._texture && width === this._width && height === this._height)
            return;
        this._texture = texture;
        this._width = width;
        this._height = height;
        this.invalidate();
        this.invalidate_size();
    }

    vfunc_get_preferred_size() {
        if (!this._texture)
            return [false, 0, 0];
        return [true, this._width, this._height];
    }

    vfunc_paint_content(actor, node, _paintContext) {
        if (!this._texture)
            return;
        const textureNode = new Clutter.TextureNode(this._texture, null,
            Clutter.ScalingFilter.LINEAR, Clutter.ScalingFilter.LINEAR);
        node.add_child(textureNode);
        textureNode.add_rectangle(actor.get_content_box());
    }
});

export class CursorOverlay {
    constructor(tracker) {
        this._tracker = tracker;
        this._content = new CursorContent();
        this._hotX = 0;
        this._hotY = 0;
        this.actor = new Clutter.Actor({
            name: 'mouse-tickler-cursor',
            content: this._content,
            request_mode: Clutter.RequestMode.CONTENT_SIZE,
            reactive: false,
            visible: false,
        });
    }

    /**
     * Copy the current cursor image and hotspot from mutter.
     *
     * @returns {boolean} false when there is no sprite to show
     */
    refresh() {
        const texture = this._tracker.get_sprite();
        if (!texture)
            return false;
        // Displayed size = texture pixels × sprite scale; the hotspot is in
        // texture pixels (mutter meta-cursor-renderer.c).
        const scale = this._tracker.get_scale() || 1;
        const w = texture.get_width() * scale;
        const h = texture.get_height() * scale;
        const [hotX, hotY] = this._tracker.get_hot();
        this._hotX = hotX * scale;
        this._hotY = hotY * scale;
        this._content.setTexture(texture, w, h);
        // Scale around the hotspot so the tip stays where clicks land.
        this.actor.pivot_point = new Graphene.Point({
            x: w > 0 ? this._hotX / w : 0,
            y: h > 0 ? this._hotY / h : 0,
        });
        return true;
    }

    /** Put the hotspot at (x, y) and draw at `scale`. */
    place(x, y, scale) {
        this.actor.set_position(Math.round(x - this._hotX), Math.round(y - this._hotY));
        this.actor.set_scale(scale, scale);
    }

    destroy() {
        this.actor.destroy();
        this.actor = null;
        this._content = null;
        this._tracker = null;
    }
}
