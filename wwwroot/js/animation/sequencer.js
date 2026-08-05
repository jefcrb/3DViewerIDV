// Per-property track-based keyframe animation. Playback writes directly to Three.js objects,
// bypassing the registry so it doesn't fire change events or trigger auto-save.
//
// Data model:
//   seq.tracks: { [trackKey]: [{ t, value, easing }] }
//   trackKey format: "<target>.<property>" — e.g. "slot:hunter.position", "liveCamera.fov"
//
// A derived `seq.keyframes` array is maintained for the UI's "unified keyframe at time T" view.
// It's rebuilt from tracks on every mutation, preserving object identity where possible so
// scrub-bar / sidebar selection references survive across mutations.

import * as THREE from 'three';
import { registry, hexToInt, intToHex } from '../editor/registry.js';
import { state as characterState } from '../characters/loader.js';

function newId(prefix) {
    if (crypto && crypto.randomUUID) return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export const EASING_NAMES = ['linear', 'cubicIn', 'cubicOut', 'cubicInOut', 'sineIn', 'sineOut', 'sineInOut'];

export function ease(name, t) {
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

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpVec3(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// Slerp Euler XYZ triples via quaternions — component-wise lerp of Euler angles causes
// flips at ±π wraparound (e.g. z: 3.13 → -3.04 sends the object through 0).
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _eTmp = new THREE.Euler();
function slerpEulerXYZ(a, b, t) {
    _qA.setFromEuler(_eTmp.set(a[0], a[1], a[2], 'XYZ'));
    _qB.setFromEuler(_eTmp.set(b[0], b[1], b[2], 'XYZ'));
    _qA.slerp(_qB, t);
    _eTmp.setFromQuaternion(_qA, 'XYZ');
    return [_eTmp.x, _eTmp.y, _eTmp.z];
}
function lerpHexColor(a, b, t) {
    const ca = hexToInt(a), cb = hexToInt(b);
    const r = lerp((ca >> 16) & 0xff, (cb >> 16) & 0xff, t);
    const g = lerp((ca >> 8) & 0xff, (cb >> 8) & 0xff, t);
    const bl = lerp(ca & 0xff, cb & 0xff, t);
    return intToHex((Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl));
}
function lerpExtras(a, b, t) {
    const out = { ...a };
    for (const k of Object.keys(a || {})) {
        if (a[k] != null && b?.[k] != null && typeof a[k] === 'number' && typeof b[k] === 'number') {
            out[k] = lerp(a[k], b[k], t);
        }
    }
    return out;
}

// Round to millisecond precision so Map/set keys are stable across float dust.
const TIME_EPS = 0.001;
function roundT(t) { return Math.round(t * 1000) / 1000; }
function sameT(a, b) { return Math.abs(a - b) < TIME_EPS; }

// Property kind table — decides interpolation + storage shape.
const PROP_KINDS = {
    position: 'vec3',
    scale: 'vec3',
    target: 'vec3',
    rotation: 'vec3-slerp',
    fov: 'number',
    intensity: 'number',
    color: 'color',
    extras: 'extras'
};

function propKindOf(trackKey) {
    const dot = trackKey.lastIndexOf('.');
    if (dot < 0) return 'number';
    const prop = trackKey.slice(dot + 1);
    return PROP_KINDS[prop] || 'number';
}

function splitTrackKey(trackKey) {
    const dot = trackKey.lastIndexOf('.');
    if (dot < 0) return { target: trackKey, prop: '' };
    return { target: trackKey.slice(0, dot), prop: trackKey.slice(dot + 1) };
}

function interpolateTrackValue(kind, a, b, t) {
    switch (kind) {
        case 'vec3': return lerpVec3(a, b, t);
        case 'vec3-slerp': return slerpEulerXYZ(a, b, t);
        case 'number': return lerp(a, b, t);
        case 'color': return lerpHexColor(a, b, t);
        case 'extras': return lerpExtras(a, b, t);
        default: return t < 0.5 ? a : b;
    }
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

// Target IDs: "liveCamera", "light:<id>", "slot:<id>". Null/undefined captures all.
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

export function availableTargets() {
    const all = ['liveCamera'];
    for (const spec of registry.listLights()) all.push(`light:${spec.id}`);
    for (const spec of registry.listSlots()) all.push(`slot:${spec.id}`);
    return all;
}

// -------- Snapshot ↔ Track helpers --------

const SLOT_PROPS = ['position', 'rotation', 'scale'];
const CAMERA_PROPS = ['position', 'rotation', 'fov'];
const LIGHT_PROPS = ['position', 'target', 'intensity', 'color', 'extras'];

function propsFor(target) {
    if (target === 'liveCamera') return CAMERA_PROPS;
    if (target.startsWith('slot:')) return SLOT_PROPS;
    if (target.startsWith('light:')) return LIGHT_PROPS;
    return [];
}

function readSnapshotProp(snap, target, prop) {
    if (!snap) return undefined;
    if (target === 'liveCamera') return snap.liveCamera?.[prop];
    if (target.startsWith('slot:')) return snap.slots?.[target.slice(5)]?.[prop];
    if (target.startsWith('light:')) return snap.lights?.[target.slice(6)]?.[prop];
    return undefined;
}

function writeSnapshotProp(snap, target, prop, value) {
    if (target === 'liveCamera') {
        snap.liveCamera = snap.liveCamera || {};
        snap.liveCamera[prop] = value;
    } else if (target.startsWith('slot:')) {
        const id = target.slice(5);
        snap.slots = snap.slots || {};
        snap.slots[id] = snap.slots[id] || {};
        snap.slots[id][prop] = value;
    } else if (target.startsWith('light:')) {
        const id = target.slice(6);
        snap.lights = snap.lights || {};
        snap.lights[id] = snap.lights[id] || {};
        snap.lights[id][prop] = value;
    }
}

function deepClone(v) {
    if (v == null || typeof v !== 'object') return v;
    return JSON.parse(JSON.stringify(v));
}

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
    }
}

function applyLiveCameraSnapshot(vals) {
    const cam = registry.liveCameraRef;
    if (!cam) return;
    if (vals.position) cam.position.set(...vals.position);
    if (vals.rotation) {
        cam.rotation.set(vals.rotation[0], vals.rotation[1], vals.rotation[2]);
    } else if (vals.target) {
        cam.lookAt(vals.target[0], vals.target[1], vals.target[2]);
    }
    if (vals.fov != null && Math.abs(cam.fov - vals.fov) > 0.001) {
        cam.fov = vals.fov;
        cam.updateProjectionMatrix();
    }
}

export function applySnapshot(snapshot) {
    for (const id of Object.keys(snapshot.lights || {})) {
        applyLightSnapshot(id, snapshot.lights[id]);
    }
    for (const id of Object.keys(snapshot.slots || {})) {
        applySlotSnapshot(id, snapshot.slots[id]);
    }
    if (snapshot.liveCamera) applyLiveCameraSnapshot(snapshot.liveCamera);
}

function applyTrackValue(trackKey, value) {
    const { target, prop } = splitTrackKey(trackKey);
    if (target === 'liveCamera') {
        applyLiveCameraSnapshot({ [prop]: value });
    } else if (target.startsWith('slot:')) {
        applySlotSnapshot(target.slice(5), { [prop]: value });
    } else if (target.startsWith('light:')) {
        applyLightSnapshot(target.slice(6), { [prop]: value });
    }
}

function restoreFromRegistry(animatedKeys) {
    for (const id of animatedKeys.lights) {
        const entry = registry.getLight(id);
        if (entry) registry._applyLightSpec(entry.threeObject, entry.spec);
    }
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

function animatedKeysOfTracks(seq) {
    const keys = { lights: new Set(), slots: new Set(), liveCamera: false };
    for (const trackKey of Object.keys(seq.tracks || {})) {
        const { target } = splitTrackKey(trackKey);
        if (target === 'liveCamera') keys.liveCamera = true;
        else if (target.startsWith('slot:')) keys.slots.add(target.slice(5));
        else if (target.startsWith('light:')) keys.lights.add(target.slice(6));
    }
    return { lights: [...keys.lights], slots: [...keys.slots], liveCamera: keys.liveCamera };
}

function inferTargetsFromTracks(tracks) {
    const set = new Set();
    for (const key of Object.keys(tracks || {})) set.add(splitTrackKey(key).target);
    return [...set];
}

// -------- Legacy migration --------

// Convert legacy `keyframes: [{t, snapshot, easing}]` to `tracks: { key: [entries] }`.
function legacyKeyframesToTracks(keyframes, targets) {
    const tracks = {};
    const addEntry = (key, t, value, easing) => {
        if (value === undefined) return;
        if (!tracks[key]) tracks[key] = [];
        tracks[key].push({ t: roundT(t), value: deepClone(value), easing: easing || 'cubicInOut' });
    };
    // Fall back to inferring targets from snapshot contents when the sequence's targets[] is empty.
    const inferredTargets = new Set(targets || []);
    for (const kf of keyframes) {
        const snap = kf.snapshot || {};
        if (snap.liveCamera) inferredTargets.add('liveCamera');
        for (const id of Object.keys(snap.lights || {})) inferredTargets.add(`light:${id}`);
        for (const id of Object.keys(snap.slots || {})) inferredTargets.add(`slot:${id}`);
    }
    for (const kf of keyframes) {
        const snap = kf.snapshot || {};
        for (const target of inferredTargets) {
            for (const prop of propsFor(target)) {
                const v = readSnapshotProp(snap, target, prop);
                if (v !== undefined) addEntry(`${target}.${prop}`, kf.t, v, kf.easing);
            }
        }
    }
    for (const key of Object.keys(tracks)) tracks[key].sort((a, b) => a.t - b.t);
    return tracks;
}

// -------- Sequencer --------

class Sequencer extends EventTarget {
    constructor() {
        super();
        this.sequences = new Map();
        this.active = new Map();
        this.now = 0;
    }

    _emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
        this.dispatchEvent(new CustomEvent('change', { detail: { type, ...detail } }));
    }

    listSequences() { return Array.from(this.sequences.values()); }
    getSequence(id) { return this.sequences.get(id); }

    addSequence(spec = {}) {
        const id = spec.id || newId('seq');
        const seqLevelEasing = EASING_NAMES.includes(spec.easing) ? spec.easing : 'cubicInOut';

        // Normalize input: prefer new `tracks`; fall back to converting legacy `keyframes`.
        let tracks;
        if (spec.tracks && typeof spec.tracks === 'object') {
            tracks = {};
            for (const [key, entries] of Object.entries(spec.tracks)) {
                if (!Array.isArray(entries)) continue;
                tracks[key] = entries
                    .filter(e => e && typeof e.t === 'number' && e.value !== undefined)
                    .map(e => ({
                        t: roundT(e.t),
                        value: deepClone(e.value),
                        easing: EASING_NAMES.includes(e.easing) ? e.easing : seqLevelEasing
                    }))
                    .sort((a, b) => a.t - b.t);
            }
        } else if (Array.isArray(spec.keyframes)) {
            const legacyKfs = spec.keyframes.map(k => ({
                t: k.t,
                snapshot: k.snapshot,
                easing: EASING_NAMES.includes(k.easing) ? k.easing : seqLevelEasing
            }));
            const targetsForLegacy = Array.isArray(spec.targets) ? spec.targets : (spec.target ? [spec.target] : []);
            tracks = legacyKeyframesToTracks(legacyKfs, targetsForLegacy);
        } else {
            tracks = {};
        }

        // Legacy `targets[]`/`target` collapsed to a single primary target for the UI.
        let target = spec.target;
        if (!target && Array.isArray(spec.targets) && spec.targets.length > 0) {
            target = spec.targets[0];
        }
        if (!target) {
            target = inferTargetsFromTracks(tracks)[0] || null;
        }
        const targets = target ? [target] : [];

        // Legacy `loop` via magic trigger entry.
        let triggers = Array.isArray(spec.triggers) ? [...spec.triggers] : [];
        let loop = !!spec.loop;
        if (triggers.includes('loop')) {
            loop = true;
            triggers = triggers.filter(t => t !== 'loop');
        }
        const stopTriggers = Array.isArray(spec.stopTriggers) ? [...spec.stopTriggers] : [];

        const normalized = {
            id,
            name: spec.name || `sequence_${this.sequences.size + 1}`,
            loop,
            triggers,
            stopTriggers,
            targets,
            tracks,
            keyframes: [] // populated by _rebuildKeyframes
        };
        this._rebuildKeyframes(normalized);
        this.sequences.set(id, normalized);
        this._emit('seq:add', { id, spec: normalized });
        return id;
    }

    // --- Derived-view maintenance ---

    _uniqueTimes(seq) {
        const set = new Set();
        for (const entries of Object.values(seq.tracks || {})) {
            for (const e of entries) set.add(roundT(e.t));
        }
        return [...set].sort((a, b) => a - b);
    }

    // Samples EVERY track at t (interpolating between adjacent entries when needed) so the
    // synthesized snapshot is always complete — consumers like the sidebar's kf-detail and
    // applySnapshotToRegistry crash on missing fields.
    _synthesizeSnapshotAt(seq, t) {
        const snap = { lights: {}, slots: {}, liveCamera: null };
        for (const [trackKey, entries] of Object.entries(seq.tracks || {})) {
            if (entries.length === 0) continue;
            const value = this._sampleTrackAt(trackKey, entries, t);
            if (value === undefined) continue;
            const { target, prop } = splitTrackKey(trackKey);
            writeSnapshotProp(snap, target, prop, deepClone(value));
        }
        return snap;
    }

    _sampleTrackAt(trackKey, entries, t) {
        if (entries.length === 0) return undefined;
        if (entries.length === 1) return entries[0].value;
        let a = entries[0], b = entries[entries.length - 1];
        for (let i = 0; i < entries.length - 1; i++) {
            if (entries[i].t <= t && t <= entries[i + 1].t) {
                a = entries[i]; b = entries[i + 1]; break;
            }
        }
        if (t <= a.t) return a.value;
        if (t >= b.t) return b.value;
        const u = (t - a.t) / (b.t - a.t);
        const eased = ease(a.easing || 'cubicInOut', u);
        return interpolateTrackValue(propKindOf(trackKey), a.value, b.value, eased);
    }

    // Represents the group as a single easing for the unified UI. Tracks with different
    // easings at the same t are allowed at the data level; the UI shows a majority-ish pick.
    _pickEasingAt(seq, t) {
        for (const entries of Object.values(seq.tracks || {})) {
            const entry = entries.find(e => sameT(e.t, t));
            if (entry) return entry.easing || 'cubicInOut';
        }
        return 'cubicInOut';
    }

    // Rebuild seq.keyframes from tracks, preserving object identity for unchanged times
    // so external code holding kf refs (scrub bar selection, sidebar expansion) survives.
    _rebuildKeyframes(seq) {
        const existing = Array.isArray(seq.keyframes) ? seq.keyframes : [];
        const byT = new Map();
        for (const kf of existing) byT.set(roundT(kf.t), kf);

        const times = this._uniqueTimes(seq);
        const next = times.map(t => {
            const snap = this._synthesizeSnapshotAt(seq, t);
            const easing = this._pickEasingAt(seq, t);
            let kf = byT.get(t);
            if (kf) {
                kf.t = t;
                kf.snapshot = snap;
                kf.easing = easing;
                byT.delete(t);
            } else {
                kf = { t, snapshot: snap, easing };
            }
            return kf;
        });
        seq.keyframes = next;
    }

    effectiveDuration(seq) {
        if (!seq) return 0;
        let max = 0;
        for (const entries of Object.values(seq.tracks || {})) {
            for (const e of entries) if (e.t > max) max = e.t;
        }
        return max;
    }

    duplicateSequence(id) {
        const seq = this.sequences.get(id);
        if (!seq) return null;
        const clone = {
            name: `${seq.name}_copy`,
            loop: !!seq.loop,
            triggers: [...seq.triggers],
            stopTriggers: [...(seq.stopTriggers || [])],
            targets: [...seq.targets],
            tracks: deepClone(seq.tracks)
        };
        return this.addSequence(clone);
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
        this._rebuildKeyframes(cur);
        this._emit('seq:update', { id, spec: cur });
    }

    // -- Track mutations at a "unified time T" level --

    // Ensure a track exists for every (target, prop) of the current targets before writing.
    _ensureTracksForTargets(seq) {
        for (const target of seq.targets) {
            for (const prop of propsFor(target)) {
                const key = `${target}.${prop}`;
                if (!seq.tracks[key]) seq.tracks[key] = [];
            }
        }
    }

    _upsertTrackEntry(entries, t, value, easing) {
        const rt = roundT(t);
        const idx = entries.findIndex(e => sameT(e.t, rt));
        if (idx >= 0) {
            entries[idx] = { t: rt, value: deepClone(value), easing: entries[idx].easing || easing };
        } else {
            entries.push({ t: rt, value: deepClone(value), easing });
            entries.sort((a, b) => a.t - b.t);
        }
    }

    recordKeyframe(id, t) {
        const seq = this.sequences.get(id);
        if (!seq) return;
        this._ensureTracksForTargets(seq);
        const snapshot = captureSnapshot(seq.targets);
        for (const [trackKey, entries] of Object.entries(seq.tracks)) {
            const { target, prop } = splitTrackKey(trackKey);
            const v = readSnapshotProp(snapshot, target, prop);
            if (v === undefined) continue;
            this._upsertTrackEntry(entries, t, v, 'cubicInOut');
        }
        this._rebuildKeyframes(seq);
        this._emit('seq:update', { id, spec: seq, recordedT: roundT(t) });
    }

    // Propagate a single easing choice across every track entry at time t.
    setKeyframeEasing(seqId, t, easing) {
        const seq = this.sequences.get(seqId);
        if (!seq || !EASING_NAMES.includes(easing)) return;
        let changed = false;
        for (const entries of Object.values(seq.tracks)) {
            for (const e of entries) if (sameT(e.t, t)) { e.easing = easing; changed = true; }
        }
        if (changed) {
            this._rebuildKeyframes(seq);
            this._emit('seq:update', { id: seqId, spec: seq });
        }
    }

    resetTarget(seqId, target) {
        const seq = this.sequences.get(seqId);
        if (!seq) return false;
        // Read earliest values of this target's tracks and apply via registry.
        const props = propsFor(target);
        const values = {};
        for (const prop of props) {
            const entries = seq.tracks[`${target}.${prop}`];
            if (!entries || entries.length === 0) continue;
            values[prop] = deepClone(entries[0].value);
        }
        if (Object.keys(values).length === 0) return false;

        if (this.active.has(seqId)) {
            this.active.delete(seqId);
            this._emit('seq:stop', { id: seqId });
        }

        if (target === 'liveCamera') {
            registry.updateLiveCamera({
                position: values.position || [0, 0, 0],
                rotation: values.rotation || [0, 0, 0],
                fov: values.fov ?? 50
            });
            return true;
        }
        if (target.startsWith('light:')) {
            const id = target.slice('light:'.length);
            registry.updateLight(id, {
                intensity: values.intensity,
                color: values.color,
                position: values.position ? [...values.position] : undefined,
                target: values.target ? [...values.target] : undefined,
                extras: values.extras ? { ...values.extras } : undefined
            });
            return true;
        }
        if (target.startsWith('slot:')) {
            const id = target.slice('slot:'.length);
            registry.updateSlot(id, {
                position: values.position ? [...values.position] : [0, 0, 0],
                rotation: values.rotation ? [...values.rotation] : [0, 0, 0],
                scale: values.scale ? [...values.scale] : [1, 1, 1]
            });
            return true;
        }
        return false;
    }

    // Duplicate a unified kf at time t into a new unified kf at (max t) + 1.
    duplicateKeyframe(seqId, t) {
        const seq = this.sequences.get(seqId);
        if (!seq) return null;
        const rt = roundT(t);
        let hasAny = false;
        for (const entries of Object.values(seq.tracks)) {
            if (entries.some(e => sameT(e.t, rt))) { hasAny = true; break; }
        }
        if (!hasAny) return null;
        const newT = roundT(this.effectiveDuration(seq) + 1);
        for (const entries of Object.values(seq.tracks)) {
            const src = entries.find(e => sameT(e.t, rt));
            if (!src) continue;
            entries.push({ t: newT, value: deepClone(src.value), easing: src.easing || 'cubicInOut' });
            entries.sort((a, b) => a.t - b.t);
        }
        this._rebuildKeyframes(seq);
        this._emit('seq:update', { id: seqId, spec: seq, recordedT: newT });
        return newT;
    }

    // Which tracks have an entry at time t (used by the UI to show per-track pips + delete).
    tracksAtTime(seq, t) {
        if (!seq?.tracks) return [];
        const rt = roundT(t);
        const out = [];
        for (const [trackKey, entries] of Object.entries(seq.tracks)) {
            if (entries.some(e => sameT(e.t, rt))) out.push(trackKey);
        }
        return out;
    }

    // Remove a single property's keyframe at time t. Leaves other properties intact.
    removeTrackEntry(seqId, trackKey, t) {
        const seq = this.sequences.get(seqId);
        if (!seq || !seq.tracks[trackKey]) return;
        const before = seq.tracks[trackKey].length;
        seq.tracks[trackKey] = seq.tracks[trackKey].filter(e => !sameT(e.t, t));
        if (seq.tracks[trackKey].length === before) return;
        this._rebuildKeyframes(seq);
        this._emit('seq:update', { id: seqId, spec: seq });
    }

    // Remove every track entry at time t (the unified-kf notion of "delete").
    removeKeyframe(id, t) {
        const seq = this.sequences.get(id);
        if (!seq) return;
        let changed = false;
        for (const key of Object.keys(seq.tracks)) {
            const before = seq.tracks[key].length;
            seq.tracks[key] = seq.tracks[key].filter(e => !sameT(e.t, t));
            if (seq.tracks[key].length !== before) changed = true;
        }
        if (changed) {
            this._rebuildKeyframes(seq);
            this._emit('seq:update', { id, spec: seq });
        }
    }

    // updateKeyframe (compat): apply mutator to a synthesized snapshot, then push changed
    // property values back into their tracks. Only writes to tracks that already have an
    // entry at t — creating tracks would defeat sparsity.
    updateKeyframe(seqId, t, mutator) {
        const seq = this.sequences.get(seqId);
        if (!seq) return;
        const rt = roundT(t);
        const snap = this._synthesizeSnapshotAt(seq, rt);
        mutator(snap);
        this._writeSnapshotToExistingTracks(seq, rt, snap);
        this._rebuildKeyframes(seq);
        this._emit('seq:update', { id: seqId, spec: seq });
    }

    _writeSnapshotToExistingTracks(seq, t, snap) {
        for (const [trackKey, entries] of Object.entries(seq.tracks)) {
            const entry = entries.find(e => sameT(e.t, t));
            if (!entry) continue;
            const { target, prop } = splitTrackKey(trackKey);
            const v = readSnapshotProp(snap, target, prop);
            if (v !== undefined) entry.value = deepClone(v);
        }
    }

    setKeyframeTime(id, oldT, newT) {
        const seq = this.sequences.get(id);
        if (!seq) return;
        const rt = roundT(oldT), rn = roundT(Math.max(0, newT));
        let changed = false;
        for (const entries of Object.values(seq.tracks)) {
            for (const e of entries) if (sameT(e.t, rt)) { e.t = rn; changed = true; }
            entries.sort((a, b) => a.t - b.t);
        }
        if (changed) {
            this._rebuildKeyframes(seq);
            this._emit('seq:update', { id, spec: seq });
        }
    }

    // -- Ref-based variants -- (refs are unified-kf objects from seq.keyframes)

    updateKeyframeRef(id, kfRef, mutator) {
        const seq = this.sequences.get(id);
        if (!seq || seq.keyframes.indexOf(kfRef) < 0) return;
        const t = kfRef.t;
        mutator(kfRef.snapshot);
        this._writeSnapshotToExistingTracks(seq, t, kfRef.snapshot);
        this._rebuildKeyframes(seq);
        this._emit('seq:update', { id, spec: seq });
    }

    removeKeyframeRef(id, kfRef) {
        const seq = this.sequences.get(id);
        if (!seq || seq.keyframes.indexOf(kfRef) < 0) return;
        this.removeKeyframe(id, kfRef.t);
    }

    setKeyframeTimeRef(id, kfRef, newT) {
        const seq = this.sequences.get(id);
        if (!seq || seq.keyframes.indexOf(kfRef) < 0) return;
        const oldT = kfRef.t;
        const rn = roundT(Math.max(0, newT));
        for (const entries of Object.values(seq.tracks)) {
            for (const e of entries) if (sameT(e.t, oldT)) e.t = rn;
            entries.sort((a, b) => a.t - b.t);
        }
        kfRef.t = rn; // preserve ref identity for the rebuild's byT lookup
        this._rebuildKeyframes(seq);
        this._emit('seq:update', { id, spec: seq });
    }

    setKeyframeEasingRef(id, kfRef, easing) {
        const seq = this.sequences.get(id);
        if (!seq || seq.keyframes.indexOf(kfRef) < 0) return;
        this.setKeyframeEasing(id, kfRef.t, easing);
    }

    // -- Playback --

    play(id, opts = {}) {
        const seq = this.sequences.get(id);
        if (!seq) return;
        if ((seq.keyframes?.length ?? 0) < 1) {
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
        restoreFromRegistry(animatedKeysOfTracks(runner.sequence));
        this._emit('seq:stop', { id });
    }

    stopAll() {
        for (const id of Array.from(this.active.keys())) this.stop(id);
    }

    isPlaying(id) {
        return this.active.has(id);
    }

    update(seconds) {
        this.now = seconds;
        for (const [id, runner] of Array.from(this.active.entries())) {
            const seq = runner.sequence;
            const duration = this.effectiveDuration(seq);
            const elapsed = seconds - runner.startTime;

            if (duration <= 0) {
                this._tickSequence(seq, 0);
                if (runner.iterationCount !== Infinity) {
                    this.active.delete(id);
                    this._emit('seq:stop', { id });
                }
                continue;
            }

            const iterations = Math.floor(elapsed / duration);
            const localTime = elapsed % duration;

            if (runner.iterationCount !== Infinity && iterations >= runner.iterationCount) {
                this.active.delete(id);
                this._tickSequence(seq, duration);
                this._emit('seq:stop', { id });
                continue;
            }

            this._tickSequence(seq, localTime);
        }
    }

    sampleAt(id, t) {
        const seq = this.sequences.get(id);
        if (!seq || (seq.keyframes?.length ?? 0) === 0) return;
        if (this.active.has(id)) {
            this.active.delete(id);
            this._emit('seq:stop', { id });
        }
        const duration = this.effectiveDuration(seq);
        const clamped = duration > 0 ? Math.max(0, Math.min(t, duration)) : 0;
        this._tickSequence(seq, clamped);
        this._emit('seq:scrub', { id, t: clamped, duration });
    }

    _tickSequence(seq, t) {
        for (const [trackKey, entries] of Object.entries(seq.tracks || {})) {
            if (entries.length === 0) continue;
            const kind = propKindOf(trackKey);
            if (entries.length === 1) {
                applyTrackValue(trackKey, entries[0].value);
                continue;
            }
            let a = entries[0], b = entries[entries.length - 1];
            for (let i = 0; i < entries.length - 1; i++) {
                if (entries[i].t <= t && t <= entries[i + 1].t) {
                    a = entries[i];
                    b = entries[i + 1];
                    break;
                }
            }
            if (t <= a.t) { applyTrackValue(trackKey, a.value); continue; }
            if (t >= b.t) { applyTrackValue(trackKey, b.value); continue; }
            const u = (t - a.t) / (b.t - a.t);
            const eased = ease(a.easing || 'cubicInOut', u);
            applyTrackValue(trackKey, interpolateTrackValue(kind, a.value, b.value, eased));
        }
    }

    // -- Serialize / hydrate --

    serialize() {
        return Array.from(this.sequences.values()).map(s => ({
            id: s.id,
            name: s.name,
            loop: !!s.loop,
            triggers: [...s.triggers],
            stopTriggers: [...(s.stopTriggers || [])],
            targets: [...s.targets],
            tracks: Object.fromEntries(
                Object.entries(s.tracks).map(([k, entries]) => [
                    k,
                    entries.map(e => ({ t: e.t, value: deepClone(e.value), easing: e.easing || 'cubicInOut' }))
                ])
            ),
            // Legacy keyframes emitted alongside tracks so older readers of this file still
            // recover approximate animation data. hydrate() prefers `tracks` when both are present.
            keyframes: (s.keyframes || []).map(k => ({
                t: k.t,
                snapshot: deepClone(k.snapshot),
                easing: k.easing || 'cubicInOut'
            }))
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
