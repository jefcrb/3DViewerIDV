// Wraps THREE.AnimationMixer for baked .glb clips (scene + per-asset) so they can be
// triggered like snapshot sequences. Each clip is read-only (keyframes live in the .glb);
// only triggers, loop, and playback speed are user-configurable and persisted.

import * as THREE from 'three';

class ClipManager extends EventTarget {
    constructor() {
        super();
        this.sources = new Map();  // sourceId -> { mixer, root, sourceName }
        this.clips = new Map();    // name -> { name, sourceId, clip, duration, config }
        this.actions = new Map();  // name -> THREE.AnimationAction
        this.preplaySnapshots = new Map();
        // Retained so clips that arrive after hydrate (e.g. asset .glb finishes loading)
        // still pick up their saved trigger/loop/speed config.
        this._pendingConfigs = {};
    }

    _emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
        this.dispatchEvent(new CustomEvent('change', { detail: { type, ...detail } }));
    }

    // Back-compat entry point for the scene .glb. Only resets the scene source so
    // asset sources registered concurrently (async loads racing scene load) survive.
    init(root, animations) {
        this.removeSource('scene');
        this.addSource('scene', root, animations, 'scene');
    }

    // sourceId: 'scene' or `asset:<id>`. sourceName: display prefix used to keep clip
    // names unique when multiple sources ship a clip called "Take 001".
    addSource(sourceId, root, animations, sourceName = null) {
        if (!root || !Array.isArray(animations) || animations.length === 0) return;
        if (this.sources.has(sourceId)) this.removeSource(sourceId);

        const mixer = new THREE.AnimationMixer(root);
        mixer.addEventListener('finished', (e) => {
            const name = this._findClipNameForAction(e.action);
            if (!name) return;
            this._restoreSnapshot(name);
            this._detachAction(name);
            this._emit('clip:stop', { name, reason: 'finished' });
        });
        this.sources.set(sourceId, { mixer, root, sourceName: sourceName || sourceId });

        const prefix = sourceId === 'scene' ? '' : `${sourceName || sourceId}: `;
        for (let i = 0; i < animations.length; i++) {
            const raw = animations[i];
            const localName = raw.name || `clip_${i + 1}`;
            const baseName = `${prefix}${localName}`;
            let name = baseName;
            let n = 1;
            while (this.clips.has(name)) { n++; name = `${baseName} (${n})`; }
            const pending = this._pendingConfigs[name];
            this.clips.set(name, {
                name,
                localName,
                sourceId,
                clip: raw,
                duration: raw.duration,
                config: pending ? {
                    triggers: Array.isArray(pending.triggers) ? [...pending.triggers] : [],
                    stopTriggers: Array.isArray(pending.stopTriggers) ? [...pending.stopTriggers] : [],
                    loop: !!pending.loop,
                    speed: typeof pending.speed === 'number' && pending.speed > 0 ? pending.speed : 1.0
                } : { triggers: [], stopTriggers: [], loop: false, speed: 1.0 }
            });
        }
        this._emit('source:add', { sourceId });
    }

    removeSource(sourceId) {
        const src = this.sources.get(sourceId);
        if (!src) return;
        // Stop and drop clips from this source.
        for (const [name, entry] of Array.from(this.clips)) {
            if (entry.sourceId !== sourceId) continue;
            this._detachAction(name);
            this.preplaySnapshots.delete(name);
            this.clips.delete(name);
        }
        try { src.mixer.uncacheRoot(src.root); } catch {}
        this.sources.delete(sourceId);
        this._emit('source:remove', { sourceId });
    }

    dispose() {
        for (const id of Array.from(this.sources.keys())) this.removeSource(id);
        this.clips.clear();
        this.actions.clear();
        this.preplaySnapshots.clear();
    }

    listClips() {
        return Array.from(this.clips.values()).map(c => ({
            name: c.name,
            localName: c.localName || c.name,
            duration: c.duration,
            sourceId: c.sourceId,
            sourceName: this.sources.get(c.sourceId)?.sourceName || c.sourceId,
            config: { ...c.config }
        }));
    }

    listSources() {
        return Array.from(this.sources.entries()).map(([id, s]) => ({
            sourceId: id,
            sourceName: s.sourceName
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
        const action = this.actions.get(name);
        if (action && partial.speed != null) action.timeScale = partial.speed;
        this._emit('clip:update', { name, config: { ...entry.config } });
    }

    play(name) {
        const entry = this.clips.get(name);
        if (!entry) return;
        const src = this.sources.get(entry.sourceId);
        if (!src) return;
        if (this.actions.has(name)) {
            const existing = this.actions.get(name);
            existing.reset();
            existing.play();
            this._emit('clip:play', { name });
            return;
        }
        this._snapshotTargets(name, entry.clip, src.root);
        const action = src.mixer.clipAction(entry.clip);
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
        for (const src of this.sources.values()) src.mixer.update(delta);
    }

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

    hydrate(data) {
        if (!data || typeof data !== 'object') return;
        this._pendingConfigs = { ...data };
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

    _findClipNameForAction(action) {
        for (const [name, a] of this.actions) if (a === action) return name;
        return null;
    }

    _detachAction(name) {
        const action = this.actions.get(name);
        if (!action) return;
        const entry = this.clips.get(name);
        const src = entry && this.sources.get(entry.sourceId);
        action.stop();
        if (src) src.mixer.uncacheAction(action.getClip(), src.root);
        this.actions.delete(name);
    }

    // Walk the clip's tracks to collect every unique animated Object3D under the source's
    // root, then snapshot position/quaternion/scale. Non-transform tracks fall outside.
    _snapshotTargets(name, clip, root) {
        const targets = new Map();
        for (const track of clip.tracks) {
            const dot = track.name.indexOf('.');
            if (dot < 0) continue;
            const objName = track.name.slice(0, dot);
            if (targets.has(objName)) continue;
            const obj = root.getObjectByName(objName);
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
