import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DEV, SCENE_ID } from '../config.js';
import { getTeamColor, onTeamColorsChange } from '../state/teamColors.js';

// Single source of truth for editable scene objects. Mutations emit change events.

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

export const SHADOW_MAP_TYPES = {
    Basic: 0,
    PCF: 1,
    PCFSoft: 2,
    VSM: 3
};

export const SKYBOX_MAPPINGS = {
    Equirectangular: THREE.EquirectangularReflectionMapping,
    UV: THREE.UVMapping
};

export const TONE_MAPPING_TYPES = {
    None: THREE.NoToneMapping,
    Linear: THREE.LinearToneMapping,
    Reinhard: THREE.ReinhardToneMapping,
    Cineon: THREE.CineonToneMapping,
    ACESFilmic: THREE.ACESFilmicToneMapping,
    AgX: THREE.AgXToneMapping ?? 6,
    Neutral: THREE.NeutralToneMapping ?? 7
};

const WORLD_DEFAULTS = {
    backgroundColor: '#1a1a2e',
    backgroundColorBinding: 'static',
    // Optional user-uploaded panorama as a data URL. When set, replaces backgroundColor
    // as the scene background.
    skyboxImage: null,
    // Blend factor: 0 = image invisible (color only), 1 = image fully opaque covers color.
    skyboxImageOpacity: 1.0,
    // 'Equirectangular' wraps a 2:1 panorama around the scene; 'UV' flat-maps the image.
    skyboxMapping: 'Equirectangular',
    // When true, both color and image are ignored; scene.background = null so the
    // canvas renders transparent (for OBS browser sources).
    transparentBackground: false,
    shadowsEnabled: true,
    shadowMapType: 'PCFSoft',
    shadowMapSize: SHADOW_DEFAULTS.mapSize,
    shadowBias: SHADOW_DEFAULTS.bias,
    shadowNormalBias: SHADOW_DEFAULTS.normalBias,
    shadowRadius: SHADOW_DEFAULTS.radius,
    // Directional-light shadow frustum: bigger bounds cover more area but lose sharpness.
    directionalShadowBounds: SHADOW_DEFAULTS.cameraBounds,
    directionalShadowFar: SHADOW_DEFAULTS.far,
    toneMapping: 'ACESFilmic',
    toneMappingExposure: 1.0
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

function resolveColor(hex, binding) {
    if (binding && binding !== 'static') {
        const bound = getTeamColor(binding);
        if (bound) return bound;
    }
    return hex;
}

function intToHex(n) {
    return '#' + n.toString(16).padStart(6, '0');
}

function vecToArr(v) {
    if (Array.isArray(v)) return [v[0] || 0, v[1] || 0, v[2] || 0];
    if (v && typeof v === 'object') return [v.x || 0, v.y || 0, v.z || 0];
    return [0, 0, 0];
}

function configureShadow(light, extras = {}, world = WORLD_DEFAULTS) {
    const mapSize = extras.shadowMapSize ?? world.shadowMapSize ?? SHADOW_DEFAULTS.mapSize;
    light.shadow.mapSize.width = mapSize;
    light.shadow.mapSize.height = mapSize;
    light.shadow.camera.near = SHADOW_DEFAULTS.near;
    light.shadow.camera.far = extras.shadowFar
        ?? world.directionalShadowFar
        ?? SHADOW_DEFAULTS.far;
    light.shadow.bias = world.shadowBias ?? SHADOW_DEFAULTS.bias;
    light.shadow.normalBias = world.shadowNormalBias ?? SHADOW_DEFAULTS.normalBias;
    light.shadow.radius = world.shadowRadius ?? SHADOW_DEFAULTS.radius;
    if (light.shadow.map) {
        light.shadow.map.dispose();
        light.shadow.map = null;
    }
    if (light.isDirectionalLight) {
        const b = extras.shadowBounds
            ?? world.directionalShadowBounds
            ?? SHADOW_DEFAULTS.cameraBounds;
        light.shadow.camera.left = -b;
        light.shadow.camera.right = b;
        light.shadow.camera.top = b;
        light.shadow.camera.bottom = -b;
    }
    // Must update AFTER bounds/far are set, or the new frustum won't take effect.
    if (light.shadow.camera.updateProjectionMatrix) {
        light.shadow.camera.updateProjectionMatrix();
    }
}

class Registry extends EventTarget {
    constructor() {
        super();
        this.scene = null;
        this.liveCameraRef = null;
        this.rendererRef = null;
        this.lights = new Map();
        this.slots = new Map();
        this.assets = new Map();
        this.liveCamera = {
            position: [8, 6, 8],
            rotation: [0, 0, 0],
            fov: 50
        };
        this.world = { ...WORLD_DEFAULTS };
        onTeamColorsChange(() => this.reapplyBoundColors());
    }

    reapplyBoundColors() {
        for (const [id, entry] of this.lights) {
            const usesBinding = (entry.spec.colorBinding && entry.spec.colorBinding !== 'static')
                || (entry.spec.groundColorBinding && entry.spec.groundColorBinding !== 'static');
            if (!usesBinding) continue;
            this._applyLightSpec(entry.threeObject, entry.spec);
            this.emit('lights:update', { id, spec: entry.spec, threeObject: entry.threeObject });
        }
        if (this.world.backgroundColorBinding && this.world.backgroundColorBinding !== 'static') {
            this._applyWorldSpec();
            this.emit('world:update', { spec: { ...this.world } });
        }
    }

    init(scene, liveCamera, renderer = null) {
        this.scene = scene;
        this.liveCameraRef = liveCamera;
        this.rendererRef = renderer;
        this.liveCamera.position = vecToArr(liveCamera.position);
        this.liveCamera.rotation = [liveCamera.rotation.x, liveCamera.rotation.y, liveCamera.rotation.z];
        this.liveCamera.fov = liveCamera.fov;
        if (scene?.background?.getHexString) {
            this.world.backgroundColor = '#' + scene.background.getHexString();
        }
        if (renderer?.shadowMap) {
            this.world.shadowsEnabled = !!renderer.shadowMap.enabled;
            const t = renderer.shadowMap.type;
            for (const [name, val] of Object.entries(SHADOW_MAP_TYPES)) {
                if (val === t) { this.world.shadowMapType = name; break; }
            }
        }
        if (renderer) {
            const tm = renderer.toneMapping;
            for (const [name, val] of Object.entries(TONE_MAPPING_TYPES)) {
                if (val === tm) { this.world.toneMapping = name; break; }
            }
            if (typeof renderer.toneMappingExposure === 'number') {
                this.world.toneMappingExposure = renderer.toneMappingExposure;
            }
        }
    }

    emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
        this.dispatchEvent(new CustomEvent('change', { detail: { type, ...detail } }));
    }

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

    updateLight(id, partial, opts = {}) {
        const entry = this.lights.get(id);
        if (!entry) return;
        // Spot tracking: when only position moves, slide the target with it so the cone
        // keeps its aim. Y is held so vertical moves don't shift the floor-spot.
        if (opts.trackSpotTarget && entry.spec.type === 'Spot' && partial.position) {
            const newPos = vecToArr(partial.position);
            const oldPos = entry.spec.position;
            const oldTgt = entry.spec.target;
            const targetSupplied = Array.isArray(partial.target) || (partial.target && typeof partial.target === 'object');
            const targetUnchanged = !targetSupplied || (() => {
                const t = vecToArr(partial.target);
                return Math.abs(t[0] - oldTgt[0]) < 1e-6
                    && Math.abs(t[1] - oldTgt[1]) < 1e-6
                    && Math.abs(t[2] - oldTgt[2]) < 1e-6;
            })();
            if (targetUnchanged) {
                const dx = newPos[0] - oldPos[0];
                const dz = newPos[2] - oldPos[2];
                partial = {
                    ...partial,
                    target: [oldTgt[0] + dx, oldTgt[1], oldTgt[2] + dz]
                };
            }
        }
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
            colorBinding: spec.colorBinding ?? 'static',
            groundColor: spec.groundColor ?? '#444444',
            groundColorBinding: spec.groundColorBinding ?? 'static',
            intensity: spec.intensity ?? 1.0,
            position: vecToArr(spec.position ?? [0, 5, 0]),
            target: vecToArr(spec.target ?? [0, 0, 0]),
            castShadow: spec.castShadow ?? false,
            extras: { ...(spec.extras || {}) }
        };
    }

    _createThreeLight(spec) {
        const colorInt = hexToInt(resolveColor(spec.color, spec.colorBinding));
        let light;
        switch (spec.type) {
            case 'Ambient':
                light = new THREE.AmbientLight(colorInt, spec.intensity);
                break;
            case 'Hemisphere':
                light = new THREE.HemisphereLight(colorInt, hexToInt(resolveColor(spec.groundColor, spec.groundColorBinding)), spec.intensity);
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
            configureShadow(light, spec.extras, this.world);
        }
        light.userData.registryId = spec.id;
        return light;
    }

    _applyLightSpec(light, spec) {
        const colorInt = hexToInt(resolveColor(spec.color, spec.colorBinding));
        if (light.color) light.color.setHex(colorInt);
        if (light.isHemisphereLight && spec.groundColor) {
            light.groundColor.setHex(hexToInt(resolveColor(spec.groundColor, spec.groundColorBinding)));
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
            if (light.castShadow) configureShadow(light, spec.extras, this.world);
        }
    }

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
        // Slots scale uniformly; max keeps legacy non-uniform saves from shrinking.
        const s = vecToArr(spec.scale ?? [1, 1, 1]);
        const u = Math.max(s[0], s[1], s[2]) || 1;
        return {
            id: spec.id,
            role,
            label: spec.label || role,
            position: vecToArr(spec.position ?? [0, 0, 0]),
            rotation: vecToArr(spec.rotation ?? [0, 0, 0]),
            scale: [u, u, u],
            pickDelay: Math.max(0, Number(spec.pickDelay) || 0)
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

    updateLiveCamera(partial) {
        // Legacy saves stored target instead of rotation; convert via lookAt.
        if (partial.target && !partial.rotation && this.liveCameraRef) {
            const t = vecToArr(partial.target);
            const tmpPos = partial.position
                ? vecToArr(partial.position)
                : [...this.liveCamera.position];
            const cam = this.liveCameraRef;
            const savedPos = cam.position.clone();
            const savedRot = cam.rotation.clone();
            cam.position.set(...tmpPos);
            cam.lookAt(t[0], t[1], t[2]);
            partial.rotation = [cam.rotation.x, cam.rotation.y, cam.rotation.z];
            cam.position.copy(savedPos);
            cam.rotation.copy(savedRot);
            delete partial.target;
        }

        Object.assign(this.liveCamera, partial);

        if (this.liveCameraRef) {
            if (partial.position) this.liveCameraRef.position.set(...vecToArr(partial.position));
            if (partial.rotation) {
                this.liveCameraRef.rotation.set(
                    partial.rotation[0],
                    partial.rotation[1],
                    partial.rotation[2]
                );
            }
            if (partial.fov != null) {
                this.liveCameraRef.fov = partial.fov;
                this.liveCameraRef.updateProjectionMatrix();
            }
        }
        this.emit('liveCamera:update', { spec: this.liveCamera });
    }

    updateWorld(partial) {
        Object.assign(this.world, partial);
        this._applyWorldSpec();
        this.emit('world:update', { spec: { ...this.world } });
    }

    _applyWorldSpec() {
        // Editor gets a checkerboard so transparency is legible; OBS/browser stays truly transparent.
        if (typeof document !== 'undefined') {
            const on = !!this.world.transparentBackground;
            document.documentElement.classList.toggle('transparent-bg', on && !DEV);
            document.documentElement.classList.toggle('transparent-bg-editor', on && DEV);
        }
        if (this.scene) {
            if (this.world.transparentBackground) {
                this._disposeSkyboxTexture();
                this.scene.background = null;
            } else if (this.world.skyboxImage) {
                this._applySkyboxImage(this.world.skyboxImage);
            } else {
                this._disposeSkyboxTexture();
                const effective = resolveColor(this.world.backgroundColor, this.world.backgroundColorBinding);
                if (effective) {
                    const colorInt = hexToInt(effective);
                    if (this.scene.background?.isColor) {
                        this.scene.background.setHex(colorInt);
                    } else {
                        this.scene.background = new THREE.Color(colorInt);
                    }
                }
            }
        }
        if (this.rendererRef?.shadowMap) {
            this.rendererRef.shadowMap.enabled = !!this.world.shadowsEnabled;
            const typeVal = SHADOW_MAP_TYPES[this.world.shadowMapType];
            if (typeVal != null && this.rendererRef.shadowMap.type !== typeVal) {
                this.rendererRef.shadowMap.type = typeVal;
                this.rendererRef.shadowMap.needsUpdate = true;
                // Material recompile needed: shadow map sampler is baked into the shader.
                this.scene?.traverse(obj => {
                    if (obj.material) {
                        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                        mats.forEach(m => { m.needsUpdate = true; });
                    }
                });
            }
        }
        if (this.rendererRef) {
            const tmVal = TONE_MAPPING_TYPES[this.world.toneMapping];
            if (tmVal != null && this.rendererRef.toneMapping !== tmVal) {
                this.rendererRef.toneMapping = tmVal;
                // Material recompile needed: tone mapping is baked into the shader via #define.
                this.scene?.traverse(obj => {
                    if (obj.material) {
                        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                        mats.forEach(m => { m.needsUpdate = true; });
                    }
                });
            }
            if (typeof this.world.toneMappingExposure === 'number') {
                this.rendererRef.toneMappingExposure = this.world.toneMappingExposure;
            }
        }
        for (const entry of this.lights.values()) {
            if (entry.threeObject.castShadow) {
                configureShadow(entry.threeObject, entry.spec.extras, this.world);
            }
        }
    }

    // Composites the skybox as color-fill + image drawn at world.skyboxImageOpacity into a
    // canvas texture, so the color shows through wherever the image is transparent OR when
    // the opacity slider is < 1. Static images and GIFs use the same pipeline; GIFs additionally
    // spin a rAF loop to snapshot the animated <img> each frame.
    _applySkyboxImage(dataUrl) {
        const mapping = SKYBOX_MAPPINGS[this.world.skyboxMapping] ?? THREE.EquirectangularReflectionMapping;
        if (this._skyboxImgSource === dataUrl && this._skyboxImg && this._skyboxCanvas) {
            this._composeSkybox();
            this._rebindSkyboxTexture(mapping);
            return;
        }

        this._disposeSkyboxTexture();
        const isGif = dataUrl.startsWith('data:image/gif');
        const img = document.createElement('img');
        img.onload = () => {
            // Race: user cleared/replaced the image while this was loading.
            if (this.world.skyboxImage !== dataUrl) return;
            this._skyboxImg = img;
            this._skyboxImgSource = dataUrl;
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            this._skyboxCanvas = canvas;
            this._skyboxCanvasCtx = canvas.getContext('2d');
            this._composeSkybox();
            this._rebindSkyboxTexture(mapping);
            if (isGif) {
                this._skyboxGif = { rafId: 0 };
                this._gifTick();
            }
        };
        img.onerror = () => console.error('Failed to load skybox image');
        img.src = dataUrl;
    }

    // Dispose the old texture and bind a fresh CanvasTexture over the same canvas.
    // Reassigning scene.background is the reliable path — CanvasTexture.needsUpdate alone
    // has been observed not to re-upload for scene.background in the current three.js build.
    _rebindSkyboxTexture(mapping) {
        if (!this._skyboxCanvas) return;
        if (this._skyboxTexture) this._skyboxTexture.dispose();
        const tex = new THREE.CanvasTexture(this._skyboxCanvas);
        tex.mapping = mapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        if (this.rendererRef?.capabilities?.getMaxAnisotropy) {
            tex.anisotropy = this.rendererRef.capabilities.getMaxAnisotropy();
        }
        this._skyboxTexture = tex;
        if (this.scene) this.scene.background = tex;
    }

    _composeSkybox() {
        if (!this._skyboxCanvas || !this._skyboxImg) return;
        const ctx = this._skyboxCanvasCtx;
        const canvas = this._skyboxCanvas;
        const opacity = Math.max(0, Math.min(1, this.world.skyboxImageOpacity ?? 1));
        const bg = resolveColor(this.world.backgroundColor, this.world.backgroundColorBinding) || '#000000';
        ctx.globalAlpha = 1;
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (opacity > 0) {
            ctx.globalAlpha = opacity;
            ctx.drawImage(this._skyboxImg, 0, 0);
            ctx.globalAlpha = 1;
        }
    }

    _gifTick() {
        const g = this._skyboxGif;
        if (!g) return;
        g.rafId = requestAnimationFrame(() => this._gifTick());
        this._composeSkybox();
        if (this._skyboxTexture) this._skyboxTexture.needsUpdate = true;
    }

    _disposeSkyboxTexture() {
        if (this._skyboxGif) {
            cancelAnimationFrame(this._skyboxGif.rafId);
            this._skyboxGif = null;
        }
        if (this._skyboxTexture) {
            this._skyboxTexture.dispose();
            this._skyboxTexture = null;
        }
        this._skyboxImg = null;
        this._skyboxImgSource = null;
        this._skyboxCanvas = null;
        this._skyboxCanvasCtx = null;
    }

    // ---------- Assets (user-uploaded GLB/GLTF props) ----------

    _normalizeAssetSpec(spec) {
        return {
            id: spec.id,
            name: spec.name || spec.filename || spec.id,
            filename: spec.filename,
            position: vecToArr(spec.position ?? [0, 0, 0]),
            rotation: vecToArr(spec.rotation ?? [0, 0, 0]),
            scale: vecToArr(spec.scale ?? [1, 1, 1]),
            opacity: typeof spec.opacity === 'number' ? Math.max(0, Math.min(1, spec.opacity)) : 1
        };
    }

    addAsset(spec) {
        const id = spec.id || newId('asset');
        const normalized = this._normalizeAssetSpec({ ...spec, id });
        const entry = { spec: normalized, root: null, animations: [], loading: true };
        this.assets.set(id, entry);
        this.emit('assets:add', { id, spec: normalized });
        this._loadAssetGltf(entry);
        return id;
    }

    _loadAssetGltf(entry) {
        const url = `./scenes/${SCENE_ID}/assets/${entry.spec.filename}`;
        new GLTFLoader().load(url, (gltf) => {
            if (!this.assets.has(entry.spec.id)) return; // removed while loading
            const root = gltf.scene;
            root.userData.assetId = entry.spec.id;
            root.traverse(o => {
                if (o.isMesh) {
                    o.castShadow = true;
                    o.receiveShadow = true;
                    if (o.material) {
                        // Clone so opacity edits don't mutate cached materials from shared gltfs.
                        o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
                    }
                }
            });
            entry.root = root;
            entry.animations = Array.isArray(gltf.animations) ? gltf.animations : [];
            entry.loading = false;
            this._applyAssetSpec(entry, entry.spec);
            this.scene.add(root);
            this.emit('assets:loaded', { id: entry.spec.id, spec: entry.spec, root, animations: entry.animations });
        }, undefined, (err) => {
            console.error(`Failed to load asset ${entry.spec.filename}:`, err);
            entry.loading = false;
        });
    }

    _applyAssetSpec(entry, spec) {
        const root = entry.root;
        if (!root) return;
        root.position.set(...spec.position);
        root.rotation.set(...spec.rotation);
        root.scale.set(...spec.scale);
        this._applyAssetOpacity(root, spec.opacity);
    }

    _applyAssetOpacity(root, opacity) {
        const o = Math.max(0, Math.min(1, opacity));
        root.traverse(node => {
            if (!node.material) return;
            const mats = Array.isArray(node.material) ? node.material : [node.material];
            mats.forEach(m => {
                m.transparent = o < 1;
                m.opacity = o;
                m.depthWrite = o >= 1;
                m.needsUpdate = true;
            });
        });
    }

    removeAsset(id) {
        const entry = this.assets.get(id);
        if (!entry) return;
        if (entry.root) {
            this.scene.remove(entry.root);
            entry.root.traverse(node => {
                if (node.geometry) node.geometry.dispose();
                if (node.material) {
                    const mats = Array.isArray(node.material) ? node.material : [node.material];
                    mats.forEach(m => m.dispose && m.dispose());
                }
            });
        }
        this.assets.delete(id);
        this.emit('assets:remove', { id, filename: entry.spec.filename });
    }

    updateAsset(id, partial) {
        const entry = this.assets.get(id);
        if (!entry) return;
        entry.spec = this._normalizeAssetSpec({ ...entry.spec, ...partial });
        this._applyAssetSpec(entry, entry.spec);
        this.emit('assets:update', { id, spec: entry.spec, root: entry.root });
    }

    getAsset(id) {
        return this.assets.get(id);
    }

    listAssets() {
        return Array.from(this.assets.values()).map(e => e.spec);
    }

    serialize() {
        return {
            lights: this.listLights(),
            slots: this.listSlots(),
            assets: this.listAssets(),
            liveCamera: { ...this.liveCamera },
            world: { ...this.world }
        };
    }

    hydrate(data) {
        if (!data) return;
        for (const id of Array.from(this.lights.keys())) this.removeLight(id);
        for (const id of Array.from(this.slots.keys())) this.removeSlot(id);
        for (const id of Array.from(this.assets.keys())) this.removeAsset(id);

        // World first so shadow settings are live when lights are created.
        if (data.world) {
            this.world = { ...WORLD_DEFAULTS, ...data.world };
            this._applyWorldSpec();
        }
        if (Array.isArray(data.lights)) {
            data.lights.forEach(spec => this.addLight(spec));
        }
        if (Array.isArray(data.slots)) {
            data.slots.forEach(spec => this.addSlot(spec));
        }
        if (Array.isArray(data.assets)) {
            data.assets.forEach(spec => this.addAsset(spec));
        }
        if (data.liveCamera) {
            this.updateLiveCamera(data.liveCamera);
        }
    }

}

export const registry = new Registry();
export { DEFAULT_SLOT_IDS, hexToInt, intToHex, vecToArr };
