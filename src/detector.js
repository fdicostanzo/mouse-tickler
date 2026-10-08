// Shake detector and size model. Pure JS, no gi:// imports, so it can be
// unit-tested under plain gjs. Design: docs/design/03-architecture.md §4.
//
// Hot path rules: push() and advance() do O(1) work, allocate nothing and
// contain no input-dependent loops.

const RING = 8;              // reversal timestamps kept (>= max N_REV)
const TAU_V = 60;            // ms, speed smoothing
const V_CAP = 20000;         // px/s, a pointer warp must not dominate
const GAP_RESET = 200;       // ms without motion starts a fresh gesture
const WINDOW = 600;          // ms, reversals counted within this window
const V0 = 300;              // px/s, speed at which growth starts
const ATTACK = 40;           // ms, growth time constant
const RELEASE = 150;         // ms, shrink time constant
const MAX_FRAME_DT = 100;    // ms; a longer gap (first frame) counts as one frame
const FRAME_DT = 16;

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function num(v, fallback) {
    return Number.isFinite(v) ? v : fallback;
}

export class ShakeDetector {
    constructor(config = {}) {
        this._rev = new Float64Array(RING);
        this.configure(config);
        this.reset();
    }

    /**
     * @param {object} c
     * @param {number} [c.sensitivity] 1..10, higher triggers more easily
     * @param {number} [c.growth] scale added per 1000 px/s above V0
     * @param {number} [c.maxScale] upper bound of the scale
     * @param {number} [c.holdMs] hold time before shrinking
     */
    configure({sensitivity = 5, growth = 1.4, maxScale = 4, holdMs = 300} = {}) {
        const s = clamp(Math.round(num(sensitivity, 5)), 1, 10);
        this._nRev = s <= 3 ? 4 : s <= 7 ? 3 : 2;
        this._minLeg = 40 * 1.25 ** (5 - s);
        this._gain = clamp(num(growth, 1.4), 0, 10) / 1000;
        this._maxScale = clamp(num(maxScale, 4), 1, 16);
        this._hold = clamp(num(holdMs, 300), 0, 5000);
    }

    reset() {
        this._have = false;
        this._px = 0;
        this._py = 0;
        this._pt = 0;
        this._v = 0;
        this._lx = 0;
        this._ly = 0;
        this._legLen = 0;
        this._rev.fill(-Infinity);
        this._head = 0;
        this._scale = 1;
        this._frameT = -Infinity;
        this._holdUntil = -Infinity;
    }

    /**
     * Feed one pointer sample.
     *
     * @param {number} x logical px, may be negative
     * @param {number} y logical px, may be negative
     * @param {number} t monotonic time in ms
     */
    push(x, y, t) {
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t))
            return;

        if (!this._have || t < this._pt || t - this._pt > GAP_RESET) {
            this._startGesture(x, y, t);
            return;
        }

        const dx = x - this._px, dy = y - this._py;
        const dt = t - this._pt;
        const len = Math.hypot(dx, dy);
        this._px = x;
        this._py = y;

        if (dt > 0) {
            const v = Math.min(len / dt * 1000, V_CAP);
            this._v += (v - this._v) * (1 - Math.exp(-dt / TAU_V));
            this._pt = t;
        }

        if (len < 1) {
            // Sub-pixel jitter counts as "any direction" (as in KWin).
            this._lx += dx;
            this._ly += dy;
            this._legLen += len;
            return;
        }

        if (this._legLen > 0 && dx * this._lx + dy * this._ly < 0) {
            if (this._legLen >= this._minLeg) {
                this._rev[this._head] = t;
                this._head = (this._head + 1) % RING;
            }
            this._lx = dx;
            this._ly = dy;
            this._legLen = len;
        } else {
            this._lx += dx;
            this._ly += dy;
            this._legLen += len;
        }
    }

    _startGesture(x, y, t) {
        this._have = true;
        this._px = x;
        this._py = y;
        this._pt = t;
        this._v = 0;
        this._lx = 0;
        this._ly = 0;
        this._legLen = 0;
    }

    /** @returns {boolean} enough recent reversals to count as a shake */
    shaking(now) {
        let n = 0;
        for (let i = 0; i < RING; i++) {
            if (now - this._rev[i] <= WINDOW)
                n++;
        }
        return n >= this._nRev;
    }

    /** Smoothed speed in px/s, decayed for the time since the last sample. */
    speed(now) {
        if (!this._have)
            return 0;
        const idle = Math.max(0, now - this._pt);
        return this._v * Math.exp(-idle / TAU_V);
    }

    /** Scale the cursor should head towards; 1 when not shaking. */
    target(now) {
        if (!this.shaking(now))
            return 1;
        return clamp(1 + this._gain * (this.speed(now) - V0), 1, this._maxScale);
    }

    /**
     * Advance the displayed scale to frame time `now`.
     *
     * @param {number} now monotonic time in ms
     * @returns {number} displayed scale, exactly 1 when at rest
     */
    advance(now) {
        let dt = Math.max(0, now - this._frameT);
        if (dt > MAX_FRAME_DT)
            dt = FRAME_DT;
        this._frameT = now;
        const target = this.target(now);
        let s = this._scale;

        if (target >= s) {
            s += (target - s) * (1 - Math.exp(-dt / ATTACK));
            this._holdUntil = now + this._hold;
        } else if (now >= this._holdUntil) {
            s = Math.max(target, 1 + (s - 1) * Math.exp(-dt / RELEASE));
        }

        if (target <= 1 && s < 1.01)
            s = 1;
        this._scale = s;
        return s;
    }

    /** @returns {boolean} the displayed scale is back to rest */
    get atRest() {
        return this._scale === 1;
    }
}
