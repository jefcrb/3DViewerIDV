// Snapshot-based animation system.
// A sequence is a list of keyframes; its duration is the max keyframe time. Each keyframe captures a snapshot
// of the scene state (lights / slots / live camera). Playback interpolates between
// consecutive keyframes and writes the interpolated values directly to the Three.js
// objects, bypassing the registry so we don't fire change events or trigger auto-save.

import * as THREE from 'three';
import { registry, hexToInt, intToHex } from '../editor/registry.js';
import { state as characterState } from '../characters/loader.js';

function newId(prefix) {
    if (crypto && crypto.randomUUID) return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// ===== Easing =====

export const EASING_NAMES = ['linear', 'cubicIn', 'cubicOut', 'cubicInOut', 'sineIn', 'sineOut', 'sineInOut'];

function ease(name, t) {
    switch (name) {
        case 'cubicIn': return t * t * t;
        case 'cubicOut': return 1 - Math.pow(1 - t, 3);
        case 'cubicInOut': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        case 'sineIn': return 1 - Math.cos((t * Math.PI) / 2);
        case 'sineOut': return Math.sin((t * Math.PI) / 2);
        case 'sineInOut': return -(Math.cos(Math.PI * t) - 1) / 2;
        case 'linear':
        default: return t;
    }
}

// ===== Snapshot capture / interpolation =====

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpVec3(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function lerpHexColor(a, b, t) {
    const ca = hexToInt(a), cb = hexToInt(b);
    const r = lerp((ca >> 16) & 0xff, (cb >> 16) & 0xff, t);
    const g = lerp((ca >> 8) & 0xff, (cb >> 8) & 0xff, t);
    const bl = lerp(ca & 0xff, cb & 0xff, t);
    return intToHex((Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl));
}

function captureLight(spec) {
    return {
        intensity: spec.intensity,
        color: typeof spec.color === 'string' ? spec.color : intToHex(spec.color),
        position: [...spec.position],
        target: [...spec.target],
        extras: {
            angle: spec.extras?.angle,
            penumbra: spec.extras?.penumbra,
            distance: spec.extras?.distance
        }
    };
}

function captureSlot(spec) {
    return {
        position: [...spec.position],
        rotation: [...spec.rotation],
        scale: [...spec.scale]
    };
}

function captureLiveCamera() {
    if (!registry.liveCameraRef) return null;
    const cam = registry.liveCameraRef;
    return {
        position: [cam.position.x, cam.position.y, cam.position.z],
        rotation: [cam.rotation.x, cam.rotation.y, cam.rotation.z],
        fov: cam.fov
    };
}

// Capture current scene state, optionally restricted to a list of targets.
// Target IDs: "liveCamera", "light:<id>", "slot:<id>". If `targets` is null/undefined,
// captures everything.
export function captureSnapshot(targets) {
    const snapshot = { lights: {}, slots: {}, liveCamera: null };

    if (!targets) {
        for (const spec of registry.listLights()) snapshot.lights[spec.id] = captureLight(spec);
        for (const spec of registry.listSlots()) snapshot.slots[spec.id] = captureSlot(spec);
        snapshot.liveCamera = captureLiveCamera();
        return snapshot;
    }

    for (const target of targets) {
        if (target === 'liveCamera') {
            snapshot.liveCamera = captureLiveCamera();
        } else if (target.startsWith('light:')) {
            const id = target.slice('light:'.length);
            const entry = registry.getLight(id);
            if (entry) snapshot.lights[id] = captureLight(entry.spec);
        } else if (target.startsWith('slot:')) {
            const id = target.slice('slot:'.length);
            const spec = registry.getSlot(id);
            if (spec) snapshot.slots[id] = captureSlot(spec);
        }
    }
    return snapshot;
}

// List all targets currently available based on registry contents.
export function availableTargets() {
    const all = ['liveCamera'];
    for (const spec of registry.listLights()) all.push(`light:${spec.id}`);
    for (const spec of registry.listSlots()) all.push(`slot:${spec.id}`);
    return all;
}

// Infer target list from an existing snapshot (used for backward compat with sequences
// saved before targets were a thing).
function inferTargetsFromKeyframes(keyframes) {
    const set = new Set();
    for (const kf of keyframes) {
        if (kf.snapshot?.liveCamera) set.add('liveCamera');
        for (const id of Object.keys(kf.snapshot?.lights || {})) set.add(`light:${id}`);
        for (const id of Object.keys(kf.snapshot?.slots || {})) set.add(`slot:${id}`);
    }
    return [...set];
}

function interpolateSnapshot(a, b, t) {
    const out = { lights: {}, slots: {}, liveCamera: null };
    for (const id of Object.keys(a.lights)) {
        if (!b.lights[id]) continue;
        const la = a.lights[id], lb = b.lights[id];
        out.lights[id] = {
            intensity: lerp(la.intensity ?? 0, lb.intensity ?? 0, t),
            color: lerpHexColor(la.color, lb.color, t),
            position: lerpVec3(la.position, lb.position, t),
            target: lerpVec3(la.target, lb.target, t),
            extras: {
                angle: (la.extras?.angle != null && lb.extras?.angle != null)
                    ? lerp(la.extras.angle, lb.extras.angle, t) : la.extras?.angle,
                penumbra: (la.extras?.penumbra != null && lb.extras?.penumbra != null)
                    ? lerp(la.extras.penumbra, lb.extras.penumbra, t) : la.extras?.penumbra,
                distance: (la.extras?.distance != null && lb.extras?.distance != null)
                    ? lerp(la.extras.distance, lb.extras.distance, t) : la.extras?.distance
            }
        };
    }
    for (const id of Object.keys(a.slots)) {
        if (!b.slots[id]) continue;
        out.slots[id] = {
            position: lerpVec3(a.slots[id].position, b.slots[id].position, t),
            rotation: lerpVec3(a.slots[id].rotation, b.slots[id].rotation, t),
            scale: lerpVec3(a.slots[id].scale, b.slots[id].scale, t)
        };
    }
    if (a.liveCamera && b.liveCamera) {
        out.liveCamera = {
            position: lerpVec3(a.liveCamera.position, b.liveCamera.position, t),
            rotation: lerpVec3(
                a.liveCamera.rotation || [0, 0, 0],
                b.liveCamera.rotation || [0, 0, 0],
                t
            ),
            fov: lerp(a.liveCamera.fov, b.liveCamera.fov, t)
        };
    }
    return out;
}

// ===== Apply snapshot to scene (bypasses registry; no events) =====

function applyLightSnapshot(id, vals) {
    const entry = registry.getLight(id);
    if (!entry) return;
    const light = entry.threeObject;
    if (vals.intensity != null) light.intensity = vals.intensity;
    if (vals.color && light.color) light.color.setHex(hexToInt(vals.color));
    if (vals.position && !light.isAmbientLight) light.position.set(...vals.position);
    if (vals.target && light.target) light.target.position.set(...vals.target);
    if (vals.extras) {
        if (vals.extras.angle != null && light.isSpotLight) light.angle = vals.extras.angle;
        if (vals.extras.penumbra != null && light.isSpotLight) light.penumbra = vals.extras.penumbra;
        if (vals.extras.distance != null && (light.isSpotLight || light.isPointLight)) {
            light.distance = vals.extras.distance;
        }
    }
}

function applySlotSnapshot(id, vals) {
    const slot = registry.getSlot(id);
    if (!slot) return;
    // Find the loaded character model for this slot's role and move it directly.
    const role = slot.role;
    let charData = null;
    if (role === 'hunter') {
        charData = characterState.loadedCharacters.hunter;
    } else if (role.startsWith('survivor_')) {
        const idx = parseInt(role.split('_')[1]) - 1;
        if (idx >= 0 && idx < 4) charData = characterState.loadedCharacters.survivors[idx];
    }
    if (charData && charData.model) {
        const m = charData.model;
        if (vals.position) m.position.set(...vals.position);
        if (vals.rotation) m.rotation.set(...vals.rotation);
        // Scale animation is tricky because of per-character normalization; skip for now.
    }
}

function applyLiveCameraSnapshot(vals) {
    const cam = registry.liveCameraRef;
    if (!cam) return;
    if (vals.position) cam.position.set(...vals.position);
    if (vals.rotation) {
        cam.rotation.set(vals.rotation[0], vals.rotation[1], vals.rotation[2]);
    } else if (vals.target) {
        // Backward-compat for snapshots authored before rotation was stored.
        cam.lookAt(vals.target[0], vals.target[1], vals.target[2]);
    }
    if (vals.fov != null && Math.abs(cam.fov - vals.fov) > 0.001) {
        cam.fov = vals.fov;
        cam.updateProjectionMatrix();
    }
}

function applySnapshot(snapshot) {
    for (const id of Object.keys(snapshot.lights || {})) {
        applyLightSnapshot(id, snapshot.lights[id]);
    }
    for (const id of Object.keys(snapshot.slots || {})) {
        applySlotSnapshot(id, snapshot.slots[id]);
    }
    if (snapshot.liveCamera) applyLiveCameraSnapshot(snapshot.liveCamera);
}

// Restore scene from registry's base state (used when a sequence ends).
function restoreFromRegistry(animatedKeys) {
    for (const id of animatedKeys.lights) {
        const entry = registry.getLight(id);
        if (entry) registry._applyLightSpec(entry.threeObject, entry.spec);
    }
    // For slots, re-apply the slot transform to the loaded character model.
    for (const id of animatedKeys.slots) {
        const slot = registry.getSlot(id);
        if (!slot) continue;
        applySlotSnapshot(id, { position: slot.position, rotation: slot.rotation });
    }
    if (animatedKeys.liveCamera) {
        const cam = registry.liveCameraRef;
        const spec = registry.liveCamera;
        if (cam && spec) {
            cam.position.set(...spec.position);
            if (spec.rotation) cam.rotation.set(spec.rotation[0], spec.rotation[1], spec.rotation[2]);
            cam.fov = spec.fov;
            cam.updateProjectionMatrix();
        }
    }
}

function animatedKeysOf(sequence) {
    const keys = { lights: new Set(), slots: new Set(), liveCamera: false };
    for (const kf of sequence.keyframes) {
        for (const id of Object.keys(kf.snapshot.lights || {})) keys.lights.add(id);
        for (const id of Object.keys(kf.snapshot.slots || {})) keys.slots.add(id);
        if (kf.snapshot.liveCamera) keys.liveCamera = true;
    }
    return { lights: [...keys.lights], slots: [...keys.slots], liveCamera: keys.liveCamera };
}

// ===== Sequencer =====

class Sequencer extends EventTarget {
    constructor() {
        super();
        this.sequences = new Map(); // id -> spec
        this.active = new Map();    // id -> { sequence, startTime, iterationCount, iterationsDone }
        this.now = 0;               // seconds since start (set by update())
    }

    _emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
        this.dispatchEvent(new CustomEvent('change', { detail: { type, ...detail } }));
    }

    listSequences() {
        return Array.from(this.sequences.values());
    }

    getSequence(id) {
        return this.sequences.get(id);
    }

    addSequence(spec = {}) {
        const id = spec.id || newId('seq');
        const keyframes = Array.isArray(spec.keyframes)
            ? spec.keyframes.map(k => ({ t: k.t, snapshot: k.snapshot }))
            : [];
        const targets = Array.isArray(spec.targets)
            ? [...spec.targets]
            : inferTargetsFromKeyframes(keyframes);
        const normalized = {
            id,
            name: spec.name || `sequence_${this.sequences.size + 1}`,
            easing: EASING_NAMES.includes(spec.easing) ? spec.easing : 'cubicInOut',
            triggers: Array.isArray(spec.triggers) ? [...spec.triggers] : [],
            targets,
            keyframes
        };
        this.sequences.set(id, normalized);
        this._emit('seq:add', { id, spec: normalized });
        return id;
    }

    // Effective duration of a sequence = the highest keyframe time. With one keyframe
    // (or none), duration is 0 and playback is essentially static.
    effectiveDuration(seq) {
        if (!seq || seq.keyframes.length === 0) return 0;
        let max = 0;
        for (const kf of seq.keyframes) if (kf.t > max) max = kf.t;
        return max;
    }

    removeSequence(id) {
        if (!this.sequences.has(id)) return;
        this.stop(id);
        this.sequences.delete(id);
        this._emit('seq:remove', { id });
    }

    updateSequence(id, partial) {
        const cur = this.sequences.get(id);
        if (!cur) return;
        Object.assign(cur, partial);
        if (partial.keyframes) {
            cur.keyframes = partial.keyframes.map(k => ({ t: k.t, snapshot: k.snapshot }));
            cur.keyframes.sort((a, b) => a.t - b.t);
        }
        this._emit('seq:update', { id, spec: cur });
    }

    recordKeyframe(id, t) {
        const seq = this.sequences.get(id);
        if (!seq) return;
        const snapshot = captureSnapshot(seq.targets);
        const idx = seq.keyframes.findIndex(k => Math.abs(k.t - t) < 0.001);
        if (idx >= 0) {
            seq.keyframes[idx] = { t, snapshot };
        } else {
            seq.keyframes.push({ t, snapshot });
            seq.keyframes.sort((a, b) => a.t - b.t);
        }
        this._emit('seq:update', { id, spec: seq, recordedT: t });
    }

    // Add a target to a sequence. Backfills every existing keyframe with the current
    // registry state for that target so the new track has sensible starting values.
    addTarget(seqId, target) {
        const seq = this.sequences.get(seqId);
        if (!seq) return;
        if (seq.targets.includes(target)) return;
        seq.targets.push(target);
        const fill = captureSnapshot([target]);
        for (const kf of seq.keyframes) {
            // Clone so each keyframe has independent data — never share object references
            // between keyframes (or one inline edit would mutate all of them).
            if (target === 'liveCamera' && fill.liveCamera) {
                kf.snapshot.liveCamera = JSON.parse(JSON.stringify(fill.liveCamera));
            } else if (target.startsWith('light:')) {
                const id = target.slice('light:'.length);
                if (fill.lights[id]) {
                    kf.snapshot.lights = kf.snapshot.lights || {};
                    kf.snapshot.lights[id] = JSON.parse(JSON.stringify(fill.lights[id]));
                }
            } else if (target.startsWith('slot:')) {
                const id = target.slice('slot:'.length);
                if (fill.slots[id]) {
                    kf.snapshot.slots = kf.snapshot.slots || {};
                    kf.snapshot.slots[id] = JSON.parse(JSON.stringify(fill.slots[id]));
                }
            }
        }
        this._emit('seq:update', { id: seqId, spec: seq });
    }

    removeTarget(seqId, target) {
        const seq = this.sequences.get(seqId);
        if (!seq) return;
        const before = seq.targets.length;
        seq.targets = seq.targets.filter(t => t !== target);
        if (seq.targets.length === before) return;
        for (const kf of seq.keyframes) {
            if (target === 'liveCamera') {
                kf.snapshot.liveCamera = null;
            } else if (target.startsWith('light:')) {
                const id = target.slice('light:'.length);
                if (kf.snapshot.lights) delete kf.snapshot.lights[id];
            } else if (target.startsWith('slot:')) {
                const id = target.slice('slot:'.length);
                if (kf.snapshot.slots) delete kf.snapshot.slots[id];
            }
        }
        this._emit('seq:update', { id: seqId, spec: seq });
    }

    // ↺ button — jump the target's registry state to the value stored in the earliest
    // keyframe of this sequence. If the sequence is currently playing, stop it first so
    // the next frame's update() doesn't immediately overwrite the value we just wrote.
    // To "update home", re-record keyframe[0] (or whichever is earliest).
    resetTarget(seqId, target) {
        const seq = this.sequences.get(seqId);
        if (!seq || seq.keyframes.length === 0) return false;

        // Keyframes are kept sorted by time, so [0] is the earliest.
        const earliest = seq.keyframes[0];
        if (!earliest?.snapshot) return false;

        if (this.active.has(seqId)) {
            this.active.delete(seqId);
            this._emit('seq:stop', { id: seqId });
        }

        if (target === 'liveCamera') {
            const v = earliest.snapshot.liveCamera;
            if (!v) return false;
            registry.updateLiveCamera({
                position: [...v.position],
                rotation: [...v.rotation],
                fov: v.fov
            });
            return true;
        }
        if (target.startsWith('light:')) {
            const id = target.slice('light:'.length);
            const v = earliest.snapshot.lights?.[id];
            if (!v) return false;
            registry.updateLight(id, {
                intensity: v.intensity,
                color: v.color,
                position: [...v.position],
                target: [...v.target],
                extras: { ...(v.extras || {}) }
            });
            return true;
        }
        if (target.startsWith('slot:')) {
            const id = target.slice('slot:'.length);
            const v = earliest.snapshot.slots?.[id];
            if (!v) return false;
            registry.updateSlot(id, {
                position: [...v.position],
                rotation: [...v.rotation],
                scale: [...v.scale]
            });
            return true;
        }
        return false;
    }

    // Copy a keyframe's snapshot into a new keyframe at the end of the sequence
    // (t = max(existing times) + 1). Returns the new t so the caller can pulse / focus it.
    duplicateKeyframe(seqId, t) {
        const seq = this.sequences.get(seqId);
        if (!seq) return null;
        const source = seq.keyframes.find(k => Math.abs(k.t - t) < 0.001);
        if (!source) return null;
        const lastT = seq.keyframes.length > 0
            ? Math.max(...seq.keyframes.map(k => k.t))
            : 0;
        const newT = lastT + 1;
        // Deep clone so the new keyframe is fully independent of the source.
        const cloned = JSON.parse(JSON.stringify(source.snapshot));
        seq.keyframes.push({ t: newT, snapshot: cloned });
        seq.keyframes.sort((a, b) => a.t - b.t);
        this._emit('seq:update', { id: seqId, spec: seq, recordedT: newT });
        return newT;
    }

    removeKeyframe(id, t) {
        const seq = this.sequences.get(id);
        if (!seq) return;
        const before = seq.keyframes.length;
        seq.keyframes = seq.keyframes.filter(k => Math.abs(k.t - t) > 0.001);
        if (seq.keyframes.length !== before) this._emit('seq:update', { id, spec: seq });
    }

    // Mutate the snapshot of a keyframe in place via a callback. The callback receives
    // the snapshot object and may mutate it directly; the sequencer fires seq:update.
    updateKeyframe(seqId, t, mutator) {
        const seq = this.sequences.get(seqId);
        if (!seq) return;
        const kf = seq.keyframes.find(k => Math.abs(k.t - t) < 0.001);
        if (!kf) return;
        mutator(kf.snapshot);
        this._emit('seq:update', { id: seqId, spec: seq });
    }

    setKeyframeTime(id, oldT, newT) {
        const seq = this.sequences.get(id);
        if (!seq) return;
        const kf = seq.keyframes.find(k => Math.abs(k.t - oldT) < 0.001);
        if (!kf) return;
        kf.t = Math.max(0, newT);
        seq.keyframes.sort((a, b) => a.t - b.t);
        this._emit('seq:update', { id, spec: seq });
    }

    play(id, opts = {}) {
        const seq = this.sequences.get(id);
        if (!seq) return;
        if (seq.keyframes.length < 1) {
            console.warn(`Sequence "${seq.name}" has no keyframes`);
            return;
        }
        this.active.set(id, {
            sequence: seq,
            startTime: this.now,
            iterationCount: opts.iterationCount ?? 1,
            iterationsDone: 0
        });
        this._emit('seq:play', { id });
    }

    stop(id) {
        const runner = this.active.get(id);
        if (!runner) return;
        this.active.delete(id);
        restoreFromRegistry(animatedKeysOf(runner.sequence));
        this._emit('seq:stop', { id });
    }

    stopAll() {
        for (const id of Array.from(this.active.keys())) this.stop(id);
    }

    isPlaying(id) {
        return this.active.has(id);
    }

    // Called once per frame. `seconds` is wall-clock time in seconds.
    update(seconds) {
        this.now = seconds;
        for (const [id, runner] of Array.from(this.active.entries())) {
            const seq = runner.sequence;
            const duration = this.effectiveDuration(seq);
            const elapsed = seconds - runner.startTime;

            // Sequences with zero/no-length play their single keyframe once and then end
            // (unless looping, in which case they stay parked on that frame).
            if (duration <= 0) {
                this._tickSequence(seq, 0);
                if (runner.iterationCount !== Infinity) {
                    this.active.delete(id);
                    restoreFromRegistry(animatedKeysOf(seq));
                    this._emit('seq:stop', { id });
                }
                continue;
            }

            const iterations = Math.floor(elapsed / duration);
            const localTime = elapsed % duration;

            if (runner.iterationCount !== Infinity && iterations >= runner.iterationCount) {
                this.active.delete(id);
                restoreFromRegistry(animatedKeysOf(seq));
                this._emit('seq:stop', { id });
                continue;
            }

            this._tickSequence(seq, localTime);
        }
    }

    _tickSequence(seq, t) {
        const kfs = seq.keyframes;
        if (kfs.length === 0) return;
        if (kfs.length === 1) {
            applySnapshot(kfs[0].snapshot);
            return;
        }

        let a = kfs[0], b = kfs[kfs.length - 1];
        for (let i = 0; i < kfs.length - 1; i++) {
            if (kfs[i].t <= t && t <= kfs[i + 1].t) {
                a = kfs[i];
                b = kfs[i + 1];
                break;
            }
        }
        if (t <= a.t) { applySnapshot(a.snapshot); return; }
        if (t >= b.t) { applySnapshot(b.snapshot); return; }

        const localU = (t - a.t) / (b.t - a.t);
        const eased = ease(seq.easing, localU);
        applySnapshot(interpolateSnapshot(a.snapshot, b.snapshot, eased));
    }

    serialize() {
        return Array.from(this.sequences.values()).map(s => ({
            id: s.id,
            name: s.name,
            easing: s.easing,
            triggers: [...s.triggers],
            targets: [...s.targets],
            keyframes: s.keyframes.map(k => ({ t: k.t, snapshot: k.snapshot }))
        }));
    }

    hydrate(data) {
        this.stopAll();
        this.sequences.clear();
        if (!Array.isArray(data)) return;
        for (const spec of data) this.addSequence(spec);
    }
}

export const sequencer = new Sequencer();
