// Visual aids that follow each registered light; toggled with editor mode.

import * as THREE from 'three';
import { registry } from './registry.js';

const helpersById = new Map();
let scene = null;
let visible = false;

function createHelper(light) {
    if (!light) return null;
    if (light.isDirectionalLight) return new THREE.DirectionalLightHelper(light, 0.5);
    if (light.isPointLight)       return new THREE.PointLightHelper(light, 0.2);
    if (light.isSpotLight)        return new THREE.SpotLightHelper(light);
    if (light.isHemisphereLight)  return new THREE.HemisphereLightHelper(light, 0.3);
    // AmbientLight has no position or direction.
    return null;
}

function disposeHelper(helper) {
    helper.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach(m => m && m.dispose());
        }
    });
    if (typeof helper.dispose === 'function') helper.dispose();
}

function addHelperFor(id, threeObject) {
    if (helpersById.has(id)) return;
    const helper = createHelper(threeObject);
    if (!helper) return;
    helper.visible = visible;
    scene.add(helper);
    helpersById.set(id, helper);
}

function removeHelperFor(id) {
    const helper = helpersById.get(id);
    if (!helper) return;
    scene.remove(helper);
    disposeHelper(helper);
    helpersById.delete(id);
}

function refreshHelperFor(id) {
    const helper = helpersById.get(id);
    if (helper && typeof helper.update === 'function') helper.update();
}

export function initLightHelpers(sceneRef) {
    scene = sceneRef;

    // Seed helpers for already-hydrated lights (hydrate runs before editor init).
    for (const [id, entry] of registry.lights) {
        addHelperFor(id, entry.threeObject);
    }

    registry.addEventListener('lights:add', (e) => {
        addHelperFor(e.detail.id, e.detail.threeObject);
    });
    registry.addEventListener('lights:remove', (e) => {
        removeHelperFor(e.detail.id);
    });
    registry.addEventListener('lights:update', (e) => {
        refreshHelperFor(e.detail.id);
    });
}

export function setHelpersVisible(v) {
    visible = v;
    for (const helper of helpersById.values()) {
        helper.visible = v;
    }
}
