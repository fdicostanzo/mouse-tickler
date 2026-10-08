// Unit tests for src/detector.js. Run: gjs -m tests/detector_test.js
import System from 'system';

import {ShakeDetector} from '../src/detector.js';

let failures = 0, passes = 0;

function check(name, cond, detail = '') {
    if (cond) {
        passes++;
    } else {
        failures++;
        print(`FAIL ${name} ${detail}`);
    }
}

// Feed a path function f(tMs) -> [x, y] at `hz` for `ms`, starting at t0.
// Returns the max target and max displayed scale seen, plus the end time.
function drive(d, f, {hz = 125, ms = 1000, t0 = 1000} = {}) {
    const step = 1000 / hz;
    let maxTarget = 1, maxScale = 1;
    let t = t0;
    for (; t <= t0 + ms; t += step) {
        const [x, y] = f(t - t0);
        d.push(x, y, t);
        maxTarget = Math.max(maxTarget, d.target(t));
        maxScale = Math.max(maxScale, d.advance(t));
    }
    return {maxTarget, maxScale, end: t};
}

const sine = (amp, hz, cx = 640, cy = 360) =>
    t => [cx + amp * Math.sin(2 * Math.PI * hz * t / 1000), cy];

// --- shakes trigger, and size grows with speed -----------------------------
{
    const r = drive(new ShakeDetector(), sine(150, 4));
    check('vigorous shake triggers', r.maxTarget > 2, `maxTarget=${r.maxTarget}`);
    check('vigorous shake shows', r.maxScale > 2, `maxScale=${r.maxScale}`);
    check('scale bounded by maxScale', r.maxScale <= 4);
}
{
    const amps = [60, 100, 150];
    const targets = amps.map(a => drive(new ShakeDetector({maxScale: 8}), sine(a, 3)).maxTarget);
    check('size increases with speed', targets[0] < targets[1] && targets[1] < targets[2],
        JSON.stringify(targets));
}
{
    const r = drive(new ShakeDetector(), t => {
        const [x, y] = sine(120, 4)(t);
        return [y, x]; // vertical shake
    });
    check('vertical shake triggers', r.maxTarget > 1.5, `maxTarget=${r.maxTarget}`);
}
{
    const r = drive(new ShakeDetector(), sine(150, 4, -2000, -500));
    check('negative coordinates trigger', r.maxTarget > 2, `maxTarget=${r.maxTarget}`);
}
{
    const r = drive(new ShakeDetector(), sine(150, 4), {hz: 1000});
    check('1000 Hz mouse triggers', r.maxTarget > 2, `maxTarget=${r.maxTarget}`);
}

// --- things that must not trigger ------------------------------------------
{
    const r = drive(new ShakeDetector(), t => [100 + 5 * t, 300], {ms: 300});
    check('straight fast flick does not trigger', r.maxTarget === 1, `maxTarget=${r.maxTarget}`);
}
{
    const r = drive(new ShakeDetector(), sine(8, 8), {ms: 2000});
    check('tremor does not trigger', r.maxTarget === 1, `maxTarget=${r.maxTarget}`);
}
{
    const r = drive(new ShakeDetector(), sine(200, 0.5), {ms: 4000});
    check('slow back-and-forth does not trigger', r.maxTarget === 1, `maxTarget=${r.maxTarget}`);
}
{
    const r = drive(new ShakeDetector(), t => {
        const a = 2 * Math.PI * 0.5 * t / 1000;
        return [640 + 100 * Math.cos(a), 360 + 100 * Math.sin(a)];
    }, {ms: 4000});
    check('slow circles do not trigger', r.maxTarget === 1, `maxTarget=${r.maxTarget}`);
}
{
    // Two flicks right then left with a pause: one reversal only.
    const d = new ShakeDetector();
    let r = drive(d, t => [100 + 4 * t, 300], {ms: 250});
    r = drive(d, t => [1100 - 4 * t, 300], {ms: 250, t0: r.end + 50});
    check('single reversal does not trigger', r.maxTarget === 1, `maxTarget=${r.maxTarget}`);
}

{
    // Fast enough reversals to open the gate, but too slow to grow past
    // the activation threshold (1.15, see extension.js).
    const d = new ShakeDetector();
    const r = drive(d, sine(25, 2.5), {ms: 3000});
    check('gentle wiggle stays under activation', r.maxTarget < 1.15, `maxTarget=${r.maxTarget}`);
}

// --- hold, decay, rest -----------------------------------------------------
{
    const d = new ShakeDetector({holdMs: 300});
    const r = drive(d, sine(150, 4));
    const peak = d.advance(r.end);
    // Pointer stops: no more samples.
    const held = d.advance(r.end + 200);
    check('holds size after shake stops', held >= peak * 0.95, `peak=${peak} held=${held}`);
    let t = r.end + 200, s = held;
    for (; t < r.end + 3000 && s > 1; t += 16)
        s = d.advance(t);
    check('returns exactly to rest', s === 1 && d.atRest, `s=${s}`);
    check('returns to rest within hold + 1.5 s', t - r.end <= 1800, `took=${t - r.end}ms`);
}
{
    // Continuous shaking must not oscillate (Jiggle #74): after the
    // initial growth, the displayed size should never fall far.
    const d = new ShakeDetector();
    let min = Infinity, grown = false;
    const f = sine(150, 4);
    for (let t = 1000; t < 4000; t += 8) {
        const [x, y] = f(t);
        d.push(x, y, t);
        const s = d.advance(t);
        if (s > 2)
            grown = true;
        if (grown)
            min = Math.min(min, s);
    }
    check('no grow/shrink oscillation while shaking', grown && min > 2, `min=${min}`);
}

// --- hostile input -----------------------------------------------------------
{
    const d = new ShakeDetector();
    let ok = true;
    const bad = [
        [NaN, 0, 1], [0, NaN, 2], [0, 0, NaN], [Infinity, 0, 3], [0, 0, Infinity],
        [1e9, -1e9, 4], [-1e9, 1e9, 5], [0, 0, 5], [0, 0, 5], [10, 10, 5],
        [5, 5, 1], [0, 0, -1e12], [0, 0, 1e15],
    ];
    try {
        for (const [x, y, t] of bad) {
            d.push(x, y, t);
            const s = d.advance(Number.isFinite(t) ? t : 0);
            if (!Number.isFinite(s) || s < 1 || s > 4)
                ok = false;
        }
    } catch (e) {
        ok = false;
        print(e);
    }
    check('hostile input: no throw, finite bounded scale', ok);
}
{
    // Pointer warps back and forth across the screen: huge speed, but must
    // stay bounded and must not exceed maxScale.
    const d = new ShakeDetector();
    const r = drive(d, t => [Math.floor(t / 50) % 2 ? 0 : 1e6, 0]);
    check('warps stay within maxScale', r.maxScale <= 4 && r.maxTarget <= 4);
}
{
    const d = new ShakeDetector({sensitivity: 'x', growth: NaN, maxScale: -3, holdMs: 1e12});
    const r = drive(d, sine(150, 4));
    check('bad config is clamped', r.maxScale === 1, `maxScale=${r.maxScale}`);
    const d2 = new ShakeDetector({growth: NaN, maxScale: NaN, holdMs: NaN});
    const r2 = drive(d2, sine(150, 4));
    check('NaN config falls back to defaults', r2.maxScale > 2 && r2.maxScale <= 4,
        `maxScale=${r2.maxScale}`);
}

// --- sensitivity ordering ----------------------------------------------------
{
    const lo = drive(new ShakeDetector({sensitivity: 1}), sine(45, 4)).maxTarget;
    const hi = drive(new ShakeDetector({sensitivity: 10}), sine(45, 4)).maxTarget;
    check('higher sensitivity triggers on a smaller shake', lo === 1 && hi > 1, `lo=${lo} hi=${hi}`);
}

// --- cost ---------------------------------------------------------------
{
    const d = new ShakeDetector();
    const f = sine(150, 4);
    const N = 1e6;
    const start = Date.now();
    for (let i = 0; i < N; i++) {
        const t = 1000 + i;
        const [x, y] = f(t);
        d.push(x, y, t);
        d.advance(t);
    }
    const nsPer = (Date.now() - start) * 1e6 / N;
    print(`info: push+advance ≈ ${nsPer.toFixed(0)} ns per sample (includes test path math)`);
    check('per-sample cost < 5 µs', nsPer < 5000, `${nsPer} ns`);
}

print(`${passes} passed, ${failures} failed`);
if (failures)
    System.exit(1);
