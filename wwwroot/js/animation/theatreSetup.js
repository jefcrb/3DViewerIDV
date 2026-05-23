// Theatre.js bootstrap + bindings between registry objects and Three.js scene objects.
// Imports are deferred so the rest of the app boots if esm.sh is slow/unavailable.

import { DEV } from '../config.js';
import { registry } from '../editor/registry.js';
import { saveSettings, getLastLoaded } from '../storage/settingsStorage.js';
import {
    registerSequencePlayer,
    unregisterSequencePlayer,
    setTriggerMap,
    getTriggerMap
} from './triggers.js';

const PROJECT_ID = '3DViewer';
const DEFAULT_SHEETS = ['ambient', 'reactions'];

let coreApi = null;
let studioApi = null;
let project = null;
const sheets = new Map(); // name -> { sheet, objects: Map<key, {obj, unsubscribe}> }
let initialized = false;

async function loadTheatre() {
    try {
        coreApi = await import('@theatre/core');
        if (DEV) {
            const studioMod = await import('@theatre/studio');
            studioApi = studioMod.default || studioMod;
        }
        return true;
    } catch (err) {
        console.warn('Theatre.js failed to load — animations disabled', err);
        return false;
    }
}

function lightSchema(spec, types) {
    const base = {
        color: types.rgba({ r: 1, g: 1, b: 1, a: 1 }),
        intensity: types.number(spec.intensity ?? 1, { range: [0, 20] })
    };
    if (spec.type !== 'Ambient') {
        base.position = types.compound({
            x: types.number(spec.position[0] ?? 0, { range: [-50, 50] }),
            y: types.number(spec.position[1] ?? 5, { range: [-50, 50] }),
            z: types.number(spec.position[2] ?? 0, { range: [-50, 50] })
        });
    }
    if (spec.type === 'Directional' || spec.type === 'Spot') {
        base.target = types.compound({
            x: types.number(spec.target[0] ?? 0, { range: [-50, 50] }),
            y: types.number(spec.target[1] ?? 0, { range: [-50, 50] }),
            z: types.number(spec.target[2] ?? 0, { range: [-50, 50] })
        });
    }
    if (spec.type === 'Spot') {
        base.angle = types.number(spec.extras?.angle ?? Math.PI / 6, { range: [0, Math.PI / 2] });
        base.penumbra = types.number(spec.extras?.penumbra ?? 0.1, { range: [0, 1] });
    }
    return base;
}

function applyLightValues(threeLight, values) {
    if (values.color) {
        threeLight.color.setRGB(values.color.r, values.color.g, values.color.b);
    }
    if (values.intensity != null) {
        threeLight.intensity = values.intensity;
    }
    if (values.position && !threeLight.isAmbientLight) {
        threeLight.position.set(values.position.x, values.position.y, values.position.z);
    }
    if (values.target && threeLight.target) {
        threeLight.target.position.set(values.target.x, values.target.y, values.target.z);
    }
    if (values.angle != null && threeLight.isSpotLight) {
        threeLight.angle = values.angle;
    }
    if (values.penumbra != null && threeLight.isSpotLight) {
        threeLight.penumbra = values.penumbra;
    }
}

function slotSchema(spec, types) {
    return {
        position: types.compound({
            x: types.number(spec.position[0] ?? 0, { range: [-50, 50] }),
            y: types.number(spec.position[1] ?? 0, { range: [-50, 50] }),
            z: types.number(spec.position[2] ?? 0, { range: [-50, 50] })
        }),
        rotation: types.compound({
            x: types.number(spec.rotation[0] ?? 0, { range: [-Math.PI * 2, Math.PI * 2] }),
            y: types.number(spec.rotation[1] ?? 0, { range: [-Math.PI * 2, Math.PI * 2] }),
            z: types.number(spec.rotation[2] ?? 0, { range: [-Math.PI * 2, Math.PI * 2] })
        }),
        scale: types.number(1, { range: [0.1, 5] })
    };
}

function applySlotValues(spec, values) {
    // Update registry, which propagates to character render via state.characterPositions.
    registry.updateSlot(spec.id, {
        position: [values.position.x, values.position.y, values.position.z],
        rotation: [values.rotation.x, values.rotation.y, values.rotation.z],
        scale: [values.scale, values.scale, values.scale]
    });
}

function liveCameraSchema(spec, types) {
    return {
        position: types.compound({
            x: types.number(spec.position[0] ?? 0, { range: [-50, 50] }),
            y: types.number(spec.position[1] ?? 5, { range: [-50, 50] }),
            z: types.number(spec.position[2] ?? 8, { range: [-50, 50] })
        }),
        target: types.compound({
            x: types.number(spec.target[0] ?? 0, { range: [-50, 50] }),
            y: types.number(spec.target[1] ?? 1, { range: [-50, 50] }),
            z: types.number(spec.target[2] ?? 0, { range: [-50, 50] })
        }),
        fov: types.number(spec.fov ?? 50, { range: [10, 120] })
    };
}

function registerObjectOnAllSheets(key, schema, applyFn) {
    const entries = [];
    for (const [, sheetEntry] of sheets) {
        const obj = sheetEntry.sheet.object(key, schema, { reconfigure: true });
        const unsubscribe = obj.onValuesChange(applyFn);
        sheetEntry.objects.set(key, { obj, unsubscribe });
        entries.push({ sheetEntry, obj, unsubscribe });
    }
    return entries;
}

function unregisterObjectOnAllSheets(key) {
    for (const [, sheetEntry] of sheets) {
        const entry = sheetEntry.objects.get(key);
        if (entry) {
            if (entry.unsubscribe) entry.unsubscribe();
            // Theatre.js v0.7 doesn't expose a removeObject API; the orphan
            // remains in memory but is pruned from save files via registry.pruneOrphans.
        }
        sheetEntry.objects.delete(key);
    }
}

function registerLight(spec) {
    if (!coreApi) return;
    const { types } = coreApi;
    const light = registry.getLight(spec.id)?.threeObject;
    if (!light) return;
    const key = `light:${spec.id}`;
    registerObjectOnAllSheets(key, lightSchema(spec, types), (values) => applyLightValues(light, values));
}

function registerSlot(spec) {
    if (!coreApi) return;
    const { types } = coreApi;
    const key = `slot:${spec.id}`;
    registerObjectOnAllSheets(key, slotSchema(spec, types), (values) => applySlotValues(spec, values));
}

function registerLiveCamera(liveCamera) {
    if (!coreApi) return;
    const { types } = coreApi;
    const key = 'liveCamera';
    const spec = registry.liveCamera;
    registerObjectOnAllSheets(key, liveCameraSchema(spec, types), (values) => {
        liveCamera.position.set(values.position.x, values.position.y, values.position.z);
        liveCamera.lookAt(values.target.x, values.target.y, values.target.z);
        if (liveCamera.fov !== values.fov) {
            liveCamera.fov = values.fov;
            liveCamera.updateProjectionMatrix();
        }
        registry.liveCamera.position = [values.position.x, values.position.y, values.position.z];
        registry.liveCamera.target = [values.target.x, values.target.y, values.target.z];
        registry.liveCamera.fov = values.fov;
    });
}

function buildSequencePlayer(sheetEntry) {
    return {
        play(opts = {}) {
            try {
                return sheetEntry.sheet.sequence.play({ iterationCount: opts.iterationCount ?? 1 });
            } catch (err) {
                console.warn('Sequence play failed', err);
            }
        },
        stop() {
            try { sheetEntry.sheet.sequence.pause(); } catch (e) { /* noop */ }
        }
    };
}

export async function initTheatre(liveCamera) {
    if (initialized) return;
    const ok = await loadTheatre();
    if (!ok) return;

    const saved = getLastLoaded() || {};
    const pruned = registry.pruneOrphans(saved.animations || null);

    try {
        if (studioApi) {
            studioApi.initialize();
        }
        project = coreApi.getProject(PROJECT_ID, pruned ? { state: pruned } : undefined);
        await project.ready;
    } catch (err) {
        console.warn('Theatre project init failed', err);
        return;
    }

    for (const name of DEFAULT_SHEETS) {
        const sheet = project.sheet(name);
        sheets.set(name, { sheet, objects: new Map() });
    }

    // Hydrate any extra sheets referenced by the trigger map
    if (saved.editor?.triggers) {
        for (const sheetName of Object.keys(saved.editor.triggers)) {
            if (!sheets.has(sheetName)) {
                sheets.set(sheetName, { sheet: project.sheet(sheetName), objects: new Map() });
            }
        }
    }

    registerLiveCamera(liveCamera);
    for (const spec of registry.listLights()) registerLight(spec);
    for (const spec of registry.listSlots()) registerSlot(spec);

    // Subscribe to registry changes
    registry.addEventListener('lights:add', (e) => registerLight(e.detail.spec));
    registry.addEventListener('lights:remove', (e) => unregisterObjectOnAllSheets(`light:${e.detail.id}`));
    registry.addEventListener('slots:add', (e) => registerSlot(e.detail.spec));
    registry.addEventListener('slots:remove', (e) => unregisterObjectOnAllSheets(`slot:${e.detail.id}`));

    // Register sequence players for the trigger system
    for (const [name, sheetEntry] of sheets) {
        registerSequencePlayer(name, buildSequencePlayer(sheetEntry));
    }

    // Apply saved trigger map
    setTriggerMap(saved.editor?.triggers || {});

    initialized = true;
    console.log('Theatre.js initialized with', sheets.size, 'sheets');
}

export function listSheets() {
    return Array.from(sheets.keys());
}

export function addSheet(name) {
    if (!project || sheets.has(name)) return;
    const sheet = project.sheet(name);
    const sheetEntry = { sheet, objects: new Map() };
    sheets.set(name, sheetEntry);

    // Register existing objects on the new sheet
    registerLiveCameraOnSheet(sheetEntry);
    for (const spec of registry.listLights()) registerLightOnSheet(sheetEntry, spec);
    for (const spec of registry.listSlots()) registerSlotOnSheet(sheetEntry, spec);
    registerSequencePlayer(name, buildSequencePlayer(sheetEntry));
}

export function removeSheet(name) {
    if (!sheets.has(name) || DEFAULT_SHEETS.includes(name)) return;
    const sheetEntry = sheets.get(name);
    for (const [, entry] of sheetEntry.objects) {
        if (entry.unsubscribe) entry.unsubscribe();
    }
    sheets.delete(name);
    unregisterSequencePlayer(name);
}

function registerLightOnSheet(sheetEntry, spec) {
    if (!coreApi) return;
    const { types } = coreApi;
    const light = registry.getLight(spec.id)?.threeObject;
    if (!light) return;
    const key = `light:${spec.id}`;
    const obj = sheetEntry.sheet.object(key, lightSchema(spec, types), { reconfigure: true });
    const unsubscribe = obj.onValuesChange((values) => applyLightValues(light, values));
    sheetEntry.objects.set(key, { obj, unsubscribe });
}

function registerSlotOnSheet(sheetEntry, spec) {
    if (!coreApi) return;
    const { types } = coreApi;
    const key = `slot:${spec.id}`;
    const obj = sheetEntry.sheet.object(key, slotSchema(spec, types), { reconfigure: true });
    const unsubscribe = obj.onValuesChange((values) => applySlotValues(spec, values));
    sheetEntry.objects.set(key, { obj, unsubscribe });
}

function registerLiveCameraOnSheet(sheetEntry) {
    // Empty by design — the global registerLiveCamera handles all sheets at init.
    // When new sheets are created later we re-register here.
    if (!coreApi) return;
    const { types } = coreApi;
    const spec = registry.liveCamera;
    const liveCamera = registry.liveCameraRef;
    const key = 'liveCamera';
    const obj = sheetEntry.sheet.object(key, liveCameraSchema(spec, types), { reconfigure: true });
    const unsubscribe = obj.onValuesChange((values) => {
        liveCamera.position.set(values.position.x, values.position.y, values.position.z);
        liveCamera.lookAt(values.target.x, values.target.y, values.target.z);
        if (liveCamera.fov !== values.fov) {
            liveCamera.fov = values.fov;
            liveCamera.updateProjectionMatrix();
        }
    });
    sheetEntry.objects.set(key, { obj, unsubscribe });
}

export async function saveAnimations() {
    if (!studioApi || !project) {
        console.warn('Cannot save animations — Studio not initialized');
        return false;
    }
    try {
        const animations = studioApi.createContentOfSaveFile(PROJECT_ID);
        await saveSettings({
            animations,
            editor: {
                ...(getLastLoaded()?.editor || {}),
                ...registry.serialize(),
                triggers: getTriggerMap()
            }
        });
        return true;
    } catch (err) {
        console.error('Failed to save animations', err);
        return false;
    }
}

export function getStudio() {
    return studioApi;
}

export function getProject() {
    return project;
}
