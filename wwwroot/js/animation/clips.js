// Wraps THREE.AnimationMixer for baked .glb clips so they can be triggered like
// snapshot sequences. Each clip is read-only (keyframes live in the .glb); only
// triggers, loop, and playback speed are user-configurable and persisted.

import * as THREE from 'three';

class ClipManager extends EventTarget {
    constructor() {
        super();
        this.mixer = null;
        this.root = null;
        this.clips = new Map();   // name -> { name, duration, config }
        this.actions = new Map(); // name -> THREE.AnimationAction
        // Pre-play snapshots keyed by clip name, so stop restores exactly what play saw.
        this.preplaySnapshots = new Map();
    }

    _emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
        this.dispatchEvent(new CustomEvent('change', { detail: { type, ...detail } }));
    }

    // Called once after the .glb loads. Safe to call with an empty animations array.
    init(root, animations) {
        this.dispose();
        if (!root || !Array.isArray(animations) || animations.length === 0) return;
        this.root = root;
        this.mixer = new THREE.AnimationMixer(root);
        // Force pre-play snapshot restore, in case a clip completes and the internal
        // mixer state would otherwise leave targets in the final pose.
        this.mixer.addEventListener('finished', (e) => {
            const name = this._findClipNameForAction(e.action);
            if (!name) return;
            this._restoreSnapshot(name);
            this._detachAction(name);
            this._emit('clip:stop', { name, reason: 'finished' });
        });

        // Track unique clip names — collisions get index suffixes so map lookup stays clean.
        const seen = new Map();
        for (let i = 0; i < animations.length; i++) {
            const raw = animations[i];
            const baseName = raw.name || `clip_${i + 1}`;
            const count = seen.get(baseName) || 0;
            const name = count === 0 ? baseName : `${baseName} (${count + 1})`;
            seen.set(baseName, count + 1);
            this.clips.set(name, {
                name,
                clip: raw,
                duration: raw.duration,
                config: {
                    triggers: [],
                    stopTriggers: [],
                    loop: false,
                    speed: 1.0
                }
            });
        }
    }

    dispose() {
        if (this.mixer) {
            for (const name of Array.from(this.actions.keys())) this._detachAction(name);
            this.mixer.uncacheRoot(this.root);
        }
        this.mixer = null;
        this.root = null;
        this.clips.clear();
        this.actions.clear();
        this.preplaySnapshots.clear();
    }

    listClips() {
        return Array.from(this.clips.values()).map(c => ({
            name: c.name,
            duration: c.duration,
            config: { ...c.config }
        }));
    }

    hasClips() {
        return this.clips.size > 0;
    }

    getClip(name) {
        const entry = this.clips.get(name);
        if (!entry) return null;
        return { name: entry.name, duration: entry.duration, config: { ...entry.config } };
    }

    updateConfig(name, partial) {
        const entry = this.clips.get(name);
        if (!entry) return;
        Object.assign(entry.config, partial);
        // If this clip is playing, apply speed changes live.
        const action = this.actions.get(name);
        if (action && partial.speed != null) {
            action.timeScale = partial.speed;
        }
        this._emit('clip:update', { name, config: { ...entry.config } });
    }

    play(name) {
        const entry = this.clips.get(name);
        if (!entry || !this.mixer) return;
        // Restart if already active — matches how the sequencer's play works.
        if (this.actions.has(name)) {
            const existing = this.actions.get(name);
            existing.reset();
            existing.play();
            this._emit('clip:play', { name });
            return;
        }
        this._snapshotTargets(name, entry.clip);
        const action = this.mixer.clipAction(entry.clip);
        action.reset();
        action.timeScale = entry.config.speed ?? 1.0;
        action.setLoop(entry.config.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        action.clampWhenFinished = false;
        action.play();
        this.actions.set(name, action);
        this._emit('clip:play', { name });
    }

    stop(name) {
        const action = this.actions.get(name);
        if (!action) return;
        this._detachAction(name);
        this._restoreSnapshot(name);
        this._emit('clip:stop', { name, reason: 'manual' });
    }

    stopAll() {
        for (const name of Array.from(this.actions.keys())) this.stop(name);
    }

    isPlaying(name) {
        return this.actions.has(name);
    }

    update(delta) {
        if (this.mixer) this.mixer.update(delta);
    }

    // Only writes configs — hydrate on load applies stored configs onto the freshly-indexed clips.
    serialize() {
        const out = {};
        for (const entry of this.clips.values()) {
            out[entry.name] = {
                triggers: [...entry.config.triggers],
                stopTriggers: [...entry.config.stopTriggers],
                loop: !!entry.config.loop,
                speed: entry.config.speed ?? 1.0
            };
        }
        return out;
    }

    // Accepts the shape emitted by serialize(); ignores keys that don't match a real clip
    // (e.g. after a .glb was swapped for one without that clip).
    hydrate(data) {
        if (!data || typeof data !== 'object') return;
        for (const [name, cfg] of Object.entries(data)) {
            const entry = this.clips.get(name);
            if (!entry) continue;
            entry.config = {
                triggers: Array.isArray(cfg.triggers) ? [...cfg.triggers] : [],
                stopTriggers: Array.isArray(cfg.stopTriggers) ? [...cfg.stopTriggers] : [],
                loop: !!cfg.loop,
                speed: typeof cfg.speed === 'number' && cfg.speed > 0 ? cfg.speed : 1.0
            };
        }
    }

    // === internals ===

    _findClipNameForAction(action) {
        for (const [name, a] of this.actions) {
            if (a === action) return name;
        }
        return null;
    }

    _detachAction(name) {
        const action = this.actions.get(name);
        if (!action) return;
        action.stop();
        this.mixer.uncacheAction(action.getClip(), this.root);
        this.actions.delete(name);
    }

    // Walks the clip's tracks to collect every unique animated Object3D under the mixer's
    // root, then snapshots position/quaternion/scale. Non-transform tracks (morph targets,
    // material colors, etc.) fall outside this — for a broadcast tool that's an acceptable
    // limitation; those clips just won't restore perfectly.
    _snapshotTargets(name, clip) {
        if (!this.root) return;
        const targets = new Map();
        for (const track of clip.tracks) {
            // Track names look like "ObjectName.property" or "ObjectName.property[.subprop]".
            const dot = track.name.indexOf('.');
            if (dot < 0) continue;
            const objName = track.name.slice(0, dot);
            if (targets.has(objName)) continue;
            const obj = this.root.getObjectByName(objName);
            if (!obj) continue;
            targets.set(objName, {
                obj,
                position: obj.position.clone(),
                quaternion: obj.quaternion.clone(),
                scale: obj.scale.clone()
            });
        }
        this.preplaySnapshots.set(name, targets);
    }

    _restoreSnapshot(name) {
        const targets = this.preplaySnapshots.get(name);
        if (!targets) return;
        for (const snap of targets.values()) {
            snap.obj.position.copy(snap.position);
            snap.obj.quaternion.copy(snap.quaternion);
            snap.obj.scale.copy(snap.scale);
        }
        this.preplaySnapshots.delete(name);
    }
}

export const clipManager = new ClipManager();
