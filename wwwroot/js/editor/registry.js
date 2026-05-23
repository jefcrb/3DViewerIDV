import * as THREE from 'three';

// Single source of truth for editable scene objects: lights, character slots, live camera.
// UI panels mutate via add/remove/update; Theatre.js bindings subscribe to change events.

const DEFAULT_SLOT_IDS = ['hunter', 'survivor_1', 'survivor_2', 'survivor_3', 'survivor_4'];
const DEFAULT_SLOT_ROLES = {
    hunter: 'hunter',
    survivor_1: 'survivor_1',
    survivor_2: 'survivor_2',
    survivor_3: 'survivor_3',
    survivor_4: 'survivor_4'
};
export const VALID_SLOT_ROLES = ['hunter', 'survivor_1', 'survivor_2', 'survivor_3', 'survivor_4'];

const SHADOW_DEFAULTS = {
    mapSize: 1024,
    near: 0.5,
    far: 50,
    bias: -0.0001,
    normalBias: 0.02,
    radius: 4,
    cameraBounds: 15
};

function newId(prefix) {
    if (crypto && crypto.randomUUID) return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function hexToInt(hex) {
    if (typeof hex === 'number') return hex;
    if (typeof hex !== 'string') return 0xffffff;
    return parseInt(hex.replace('#', '0x'));
}

function intToHex(n) {
    return '#' + n.toString(16).padStart(6, '0');
}

function vecToArr(v) {
    if (Array.isArray(v)) return [v[0] || 0, v[1] || 0, v[2] || 0];
    if (v && typeof v === 'object') return [v.x || 0, v.y || 0, v.z || 0];
    return [0, 0, 0];
}

function configureShadow(light, extras = {}) {
    const mapSize = extras.shadowMapSize ?? SHADOW_DEFAULTS.mapSize;
    light.shadow.mapSize.width = mapSize;
    light.shadow.mapSize.height = mapSize;
    light.shadow.camera.near = SHADOW_DEFAULTS.near;
    light.shadow.camera.far = SHADOW_DEFAULTS.far;
    light.shadow.bias = SHADOW_DEFAULTS.bias;
    light.shadow.normalBias = SHADOW_DEFAULTS.normalBias;
    light.shadow.radius = SHADOW_DEFAULTS.radius;
    if (light.isDirectionalLight) {
        const b = extras.shadowBounds ?? SHADOW_DEFAULTS.cameraBounds;
        light.shadow.camera.left = -b;
        light.shadow.camera.right = b;
        light.shadow.camera.top = b;
        light.shadow.camera.bottom = -b;
    }
}

class Registry extends EventTarget {
    constructor() {
        super();
        this.scene = null;
        this.liveCameraRef = null;
        this.lights = new Map();
        this.slots = new Map();
        this.liveCamera = {
            position: [8, 6, 8],
            target: [0, 1, 0],
            fov: 50
        };
    }

    init(scene, liveCamera) {
        this.scene = scene;
        this.liveCameraRef = liveCamera;
        this.liveCamera.position = vecToArr(liveCamera.position);
        this.liveCamera.fov = liveCamera.fov;
    }

    emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
        this.dispatchEvent(new CustomEvent('change', { detail: { type, ...detail } }));
    }

    // ===== Lights =====

    addLight(spec) {
        const id = spec.id || newId('light');
        const normalized = this._normalizeLightSpec({ ...spec, id });
        const threeObject = this._createThreeLight(normalized);
        this.lights.set(id, { spec: normalized, threeObject });
        this.scene.add(threeObject);
        if (threeObject.target && threeObject.target.parent !== this.scene) {
            this.scene.add(threeObject.target);
        }
        this.emit('lights:add', { id, spec: normalized, threeObject });
        return id;
    }

    removeLight(id) {
        const entry = this.lights.get(id);
        if (!entry) return;
        this.scene.remove(entry.threeObject);
        if (entry.threeObject.target && entry.threeObject.target.parent === this.scene) {
            this.scene.remove(entry.threeObject.target);
        }
        if (entry.threeObject.dispose) entry.threeObject.dispose();
        this.lights.delete(id);
        this.emit('lights:remove', { id });
    }

    updateLight(id, partial) {
        const entry = this.lights.get(id);
        if (!entry) return;
        const newSpec = { ...entry.spec, ...partial };
        if (partial.type && partial.type !== entry.spec.type) {
            this.removeLight(id);
            return this.addLight(newSpec);
        }
        entry.spec = newSpec;
        this._applyLightSpec(entry.threeObject, newSpec);
        this.emit('lights:update', { id, spec: newSpec, threeObject: entry.threeObject });
    }

    getLight(id) {
        return this.lights.get(id);
    }

    listLights() {
        return Array.from(this.lights.values()).map(e => e.spec);
    }

    _normalizeLightSpec(spec) {
        return {
            id: spec.id,
            name: spec.name || spec.id,
            type: spec.type || 'Directional',
            color: spec.color ?? '#ffffff',
            groundColor: spec.groundColor ?? '#444444',
            intensity: spec.intensity ?? 1.0,
            position: vecToArr(spec.position ?? [0, 5, 0]),
            target: vecToArr(spec.target ?? [0, 0, 0]),
            castShadow: spec.castShadow ?? false,
            extras: { ...(spec.extras || {}) }
        };
    }

    _createThreeLight(spec) {
        const colorInt = hexToInt(spec.color);
        let light;
        switch (spec.type) {
            case 'Ambient':
                light = new THREE.AmbientLight(colorInt, spec.intensity);
                break;
            case 'Hemisphere':
                light = new THREE.HemisphereLight(colorInt, hexToInt(spec.groundColor), spec.intensity);
                light.position.set(...spec.position);
                break;
            case 'Point':
                light = new THREE.PointLight(
                    colorInt,
                    spec.intensity,
                    spec.extras.distance ?? 0,
                    spec.extras.decay ?? 2
                );
                light.position.set(...spec.position);
                break;
            case 'Spot':
                light = new THREE.SpotLight(
                    colorInt,
                    spec.intensity,
                    spec.extras.distance ?? 0,
                    spec.extras.angle ?? Math.PI / 6,
                    spec.extras.penumbra ?? 0.1,
                    spec.extras.decay ?? 2
                );
                light.position.set(...spec.position);
                light.target.position.set(...spec.target);
                break;
            case 'Directional':
            default:
                light = new THREE.DirectionalLight(colorInt, spec.intensity);
                light.position.set(...spec.position);
                light.target.position.set(...spec.target);
                break;
        }
        if (spec.castShadow && (light.isDirectionalLight || light.isPointLight || light.isSpotLight)) {
            light.castShadow = true;
            configureShadow(light, spec.extras);
        }
        light.userData.registryId = spec.id;
        return light;
    }

    _applyLightSpec(light, spec) {
        const colorInt = hexToInt(spec.color);
        if (light.color) light.color.setHex(colorInt);
        if (light.isHemisphereLight && spec.groundColor) {
            light.groundColor.setHex(hexToInt(spec.groundColor));
        }
        light.intensity = spec.intensity;
        if (light.position && !light.isAmbientLight) {
            light.position.set(...spec.position);
        }
        if (light.target && (light.isDirectionalLight || light.isSpotLight)) {
            light.target.position.set(...spec.target);
        }
        if (light.isPointLight || light.isSpotLight) {
            if (spec.extras.distance != null) light.distance = spec.extras.distance;
            if (spec.extras.decay != null) light.decay = spec.extras.decay;
        }
        if (light.isSpotLight) {
            if (spec.extras.angle != null) light.angle = spec.extras.angle;
            if (spec.extras.penumbra != null) light.penumbra = spec.extras.penumbra;
        }
        if (spec.castShadow !== light.castShadow) {
            light.castShadow = !!spec.castShadow;
            if (light.castShadow) configureShadow(light, spec.extras);
        }
    }

    // ===== Slots =====

    addSlot(spec) {
        const role = spec.role || spec.id;
        if (!VALID_SLOT_ROLES.includes(role)) {
            console.warn(`Rejected slot with invalid role: ${role}`);
            return null;
        }
        if (this.slots.has(role)) {
            console.warn(`Slot with role "${role}" already exists`);
            return null;
        }
        const id = role; // identity is the role itself
        const normalized = this._normalizeSlotSpec({ ...spec, id, role });
        this.slots.set(id, normalized);
        this.emit('slots:add', { id, spec: normalized });
        return id;
    }

    availableRoles() {
        return VALID_SLOT_ROLES.filter(r => !this.slots.has(r));
    }

    removeSlot(id) {
        if (!this.slots.has(id)) return;
        this.slots.delete(id);
        this.emit('slots:remove', { id });
    }

    updateSlot(id, partial) {
        const cur = this.slots.get(id);
        if (!cur) return;
        const newSpec = this._normalizeSlotSpec({ ...cur, ...partial });
        this.slots.set(id, newSpec);
        this.emit('slots:update', { id, spec: newSpec });
    }

    getSlot(id) {
        return this.slots.get(id);
    }

    listSlots() {
        return Array.from(this.slots.values());
    }

    _normalizeSlotSpec(spec) {
        const role = spec.role || DEFAULT_SLOT_ROLES[spec.id] || spec.id;
        return {
            id: spec.id,
            role,
            label: spec.label || role,
            position: vecToArr(spec.position ?? [0, 0, 0]),
            rotation: vecToArr(spec.rotation ?? [0, 0, 0]),
            scale: vecToArr(spec.scale ?? [1, 1, 1])
        };
    }

    seedDefaultSlots(dummyTransforms) {
        DEFAULT_SLOT_IDS.forEach((id) => {
            if (this.slots.has(id)) return;
            let t;
            if (id === 'hunter' && dummyTransforms && dummyTransforms.hunter) {
                t = dummyTransforms.hunter;
            } else if (id.startsWith('survivor_') && dummyTransforms) {
                const idx = parseInt(id.split('_')[1]) - 1;
                t = dummyTransforms.survivors[idx];
            }
            const spec = {
                id,
                role: DEFAULT_SLOT_ROLES[id],
                label: id,
                position: t ? vecToArr(t.position) : [0, 0, 0],
                rotation: t ? [t.rotation.x, t.rotation.y, t.rotation.z] : [0, 0, 0],
                scale: t ? vecToArr(t.scale) : [1, 1, 1]
            };
            this.addSlot(spec);
        });
    }

    // Returns transforms keyed by role for use by characters/api.js
    resolveCharacterPositions() {
        const result = { hunter: null, survivors: [null, null, null, null] };
        for (const slot of this.slots.values()) {
            const transform = {
                position: new THREE.Vector3(...slot.position),
                rotation: new THREE.Euler(...slot.rotation),
                scale: new THREE.Vector3(...slot.scale)
            };
            if (slot.role === 'hunter') {
                result.hunter = transform;
            } else if (slot.role && slot.role.startsWith('survivor_')) {
                const idx = parseInt(slot.role.split('_')[1]) - 1;
                if (idx >= 0 && idx < 4) result.survivors[idx] = transform;
            }
        }
        return result;
    }

    // ===== Live Camera =====

    updateLiveCamera(partial) {
        Object.assign(this.liveCamera, partial);
        if (this.liveCameraRef) {
            if (partial.position) this.liveCameraRef.position.set(...vecToArr(partial.position));
            if (partial.fov != null) {
                this.liveCameraRef.fov = partial.fov;
                this.liveCameraRef.updateProjectionMatrix();
            }
            if (partial.target) {
                this.liveCameraRef.lookAt(...vecToArr(partial.target));
            }
        }
        this.emit('liveCamera:update', { spec: this.liveCamera });
    }

    // ===== Serialize / Hydrate =====

    serialize() {
        return {
            lights: this.listLights(),
            slots: this.listSlots(),
            liveCamera: { ...this.liveCamera }
        };
    }

    hydrate(data) {
        if (!data) return;
        // Clear existing first
        for (const id of Array.from(this.lights.keys())) this.removeLight(id);
        for (const id of Array.from(this.slots.keys())) this.removeSlot(id);

        if (Array.isArray(data.lights)) {
            data.lights.forEach(spec => this.addLight(spec));
        }
        if (Array.isArray(data.slots)) {
            data.slots.forEach(spec => this.addSlot(spec));
        }
        if (data.liveCamera) {
            this.updateLiveCamera(data.liveCamera);
        }
    }

    // Remove Theatre.js object tracks whose keys reference IDs no longer in this registry.
    // Theatre object keys are "light:<id>", "slot:<id>", or "liveCamera".
    pruneOrphans(theatreSaveFile) {
        if (!theatreSaveFile || typeof theatreSaveFile !== 'object') return theatreSaveFile;
        const validKeys = new Set(['liveCamera']);
        for (const id of this.lights.keys()) validKeys.add(`light:${id}`);
        for (const id of this.slots.keys()) validKeys.add(`slot:${id}`);

        const walk = (node) => {
            if (!node || typeof node !== 'object') return;
            if (node.sheetsById) {
                for (const sheetId of Object.keys(node.sheetsById)) {
                    const sheet = node.sheetsById[sheetId];
                    if (sheet && sheet.staticOverrides && sheet.staticOverrides.byObject) {
                        for (const key of Object.keys(sheet.staticOverrides.byObject)) {
                            if (!validKeys.has(key)) delete sheet.staticOverrides.byObject[key];
                        }
                    }
                    if (sheet && sheet.sequence && sheet.sequence.tracksByObject) {
                        for (const key of Object.keys(sheet.sequence.tracksByObject)) {
                            if (!validKeys.has(key)) delete sheet.sequence.tracksByObject[key];
                        }
                    }
                }
            }
        };
        walk(theatreSaveFile);
        return theatreSaveFile;
    }
}

export const registry = new Registry();
export { DEFAULT_SLOT_IDS, hexToInt, intToHex, vecToArr };
