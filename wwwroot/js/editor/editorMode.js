import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { registry } from './registry.js';
import { renderLightsPanel } from './lightsPanel.js';
import { renderSlotsPanel } from './slotsPanel.js';
import { renderCameraPanel } from './cameraPanel.js';
import { renderAnimationsPanel } from './animationsPanel.js';
import { saveAnimations } from '../animation/theatreSetup.js';
import { saveSettings } from '../storage/settingsStorage.js';
import { getTriggerMap } from '../animation/triggers.js';

let mode = 'live';
let editorCamera = null;
let liveCamera = null;
let cameraHelper = null;
let orbitControls = null;
let transformControls = null;
let selectedTargetId = null;
let proxyByKey = new Map();
let scene = null;

// Auto-save debounce timer
let autoSaveTimer = null;
const AUTO_SAVE_DELAY = 600;

export function getMode() {
    return mode;
}

export function getActiveCamera() {
    return mode === 'editor' ? editorCamera : liveCamera;
}

function updateProxyVisibility() {
    for (const [key, proxy] of proxyByKey) {
        proxy.visible = (mode === 'editor') && (selectedTargetId === key);
    }
}

export async function setMode(next) {
    if (mode === next) return;
    mode = next;
    const isEditor = mode === 'editor';
    if (orbitControls) orbitControls.enabled = isEditor;
    if (cameraHelper) cameraHelper.visible = isEditor;
    if (transformControls) {
        if (!isEditor) detachGizmo();
        transformControls.visible = isEditor;
        transformControls.enabled = isEditor;
    }
    updateProxyVisibility();
    const panel = document.getElementById('editorPanel');
    if (panel) panel.style.display = isEditor ? 'flex' : 'none';
    const toggleBtn = document.getElementById('modeToggleBtn');
    if (toggleBtn) toggleBtn.textContent = isEditor ? 'Switch to Live' : 'Switch to Editor';
}

function detachGizmo() {
    if (!transformControls) return;
    transformControls.detach();
    selectedTargetId = null;
    updateProxyVisibility();
}

export function selectTarget(key) {
    if (!transformControls) return;
    selectedTargetId = key;
    if (!key) {
        detachGizmo();
        return;
    }

    if (key === 'liveCamera') {
        transformControls.attach(liveCamera);
        transformControls.setMode('translate');
        updateProxyVisibility();
        return;
    }

    if (key.startsWith('light:')) {
        const id = key.slice('light:'.length);
        const light = registry.getLight(id)?.threeObject;
        if (light) {
            transformControls.attach(light);
            transformControls.setMode('translate');
        }
        updateProxyVisibility();
        return;
    }

    if (key.startsWith('slot:')) {
        const id = key.slice('slot:'.length);
        const proxy = ensureSlotProxy(id);
        if (proxy) {
            transformControls.attach(proxy);
            transformControls.setMode('translate');
        }
        updateProxyVisibility();
    }
}

function ensureSlotProxy(slotId) {
    const key = `slot:${slotId}`;
    let proxy = proxyByKey.get(key);
    const slot = registry.getSlot(slotId);
    if (!slot) return null;
    if (!proxy) {
        const geometry = new THREE.BoxGeometry(0.6, 1.8, 0.4);
        const material = new THREE.MeshBasicMaterial({
            color: 0xff9900,
            transparent: true,
            opacity: 0.35,
            wireframe: true
        });
        proxy = new THREE.Mesh(geometry, material);
        proxy.userData.slotId = slotId;
        proxy.visible = false;
        scene.add(proxy);
        proxyByKey.set(key, proxy);
    }
    proxy.position.set(...slot.position);
    proxy.rotation.set(...slot.rotation);
    proxy.scale.set(slot.scale[0], slot.scale[1], slot.scale[2]);
    return proxy;
}

function refreshSlotProxies() {
    for (const slot of registry.listSlots()) {
        const proxy = proxyByKey.get(`slot:${slot.id}`);
        if (proxy) {
            proxy.position.set(...slot.position);
            proxy.rotation.set(...slot.rotation);
            proxy.scale.set(slot.scale[0], slot.scale[1], slot.scale[2]);
        }
    }
}

function disposeSlotProxies(removedId) {
    if (removedId) {
        const key = `slot:${removedId}`;
        const proxy = proxyByKey.get(key);
        if (proxy) {
            scene.remove(proxy);
            proxy.geometry.dispose();
            proxy.material.dispose();
            proxyByKey.delete(key);
        }
        if (selectedTargetId === key) detachGizmo();
    }
}

function wireGizmoTransforms() {
    transformControls.addEventListener('change', () => {
        if (!selectedTargetId) return;
        if (selectedTargetId === 'liveCamera') {
            registry.updateLiveCamera({
                position: [liveCamera.position.x, liveCamera.position.y, liveCamera.position.z]
            });
            cameraHelper && cameraHelper.update();
            return;
        }
        if (selectedTargetId.startsWith('light:')) {
            const id = selectedTargetId.slice('light:'.length);
            const entry = registry.getLight(id);
            if (entry) {
                const pos = entry.threeObject.position;
                registry.updateLight(id, { position: [pos.x, pos.y, pos.z] });
            }
            return;
        }
        if (selectedTargetId.startsWith('slot:')) {
            const id = selectedTargetId.slice('slot:'.length);
            const proxy = proxyByKey.get(selectedTargetId);
            if (proxy) {
                registry.updateSlot(id, {
                    position: [proxy.position.x, proxy.position.y, proxy.position.z],
                    rotation: [proxy.rotation.x, proxy.rotation.y, proxy.rotation.z],
                    scale: [proxy.scale.x, proxy.scale.y, proxy.scale.z]
                });
            }
        }
    });
}

// Update field values in-place — skips fields the user is currently editing.
function setIfNotFocused(el, value) {
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.type === 'checkbox') {
        el.checked = !!value;
    } else if (el.type === 'color') {
        el.value = typeof value === 'string' ? value : '#ffffff';
    } else {
        el.value = value;
    }
}

function syncPanelInputs(detail) {
    if (!detail) return;
    if (detail.type === 'lights:update') {
        const spec = detail.spec;
        const row = document.querySelector(`.tab-pane[data-tab="lights"] .editor-row[data-id="${spec.id}"]`);
        if (!row) return;
        setIfNotFocused(row.querySelector('.intensity-input'), spec.intensity);
        const ival = row.querySelector('.intensity-value');
        if (ival) ival.textContent = (spec.intensity ?? 0).toFixed(2);
        setIfNotFocused(row.querySelector('.color-input'), spec.color);
        setIfNotFocused(row.querySelector('.pos-x'), spec.position[0]);
        setIfNotFocused(row.querySelector('.pos-y'), spec.position[1]);
        setIfNotFocused(row.querySelector('.pos-z'), spec.position[2]);
        setIfNotFocused(row.querySelector('.tgt-x'), spec.target[0]);
        setIfNotFocused(row.querySelector('.tgt-y'), spec.target[1]);
        setIfNotFocused(row.querySelector('.tgt-z'), spec.target[2]);
        setIfNotFocused(row.querySelector('.shadow-input'), spec.castShadow);
        return;
    }
    if (detail.type === 'slots:update') {
        const spec = detail.spec;
        const row = document.querySelector(`.tab-pane[data-tab="slots"] .editor-row[data-id="${spec.id}"]`);
        if (!row) return;
        setIfNotFocused(row.querySelector('.pos-x'), spec.position[0]);
        setIfNotFocused(row.querySelector('.pos-y'), spec.position[1]);
        setIfNotFocused(row.querySelector('.pos-z'), spec.position[2]);
        setIfNotFocused(row.querySelector('.rot-x'), spec.rotation[0]);
        setIfNotFocused(row.querySelector('.rot-y'), spec.rotation[1]);
        setIfNotFocused(row.querySelector('.rot-z'), spec.rotation[2]);
        setIfNotFocused(row.querySelector('.scl-x'), spec.scale[0]);
        setIfNotFocused(row.querySelector('.scl-y'), spec.scale[1]);
        setIfNotFocused(row.querySelector('.scl-z'), spec.scale[2]);
        return;
    }
    if (detail.type === 'liveCamera:update') {
        const spec = detail.spec;
        const pane = document.querySelector('.tab-pane[data-tab="cameras"]');
        if (!pane) return;
        setIfNotFocused(pane.querySelector('#liveCamX'), spec.position[0]);
        setIfNotFocused(pane.querySelector('#liveCamY'), spec.position[1]);
        setIfNotFocused(pane.querySelector('#liveCamZ'), spec.position[2]);
        setIfNotFocused(pane.querySelector('#liveCamTX'), spec.target[0]);
        setIfNotFocused(pane.querySelector('#liveCamTY'), spec.target[1]);
        setIfNotFocused(pane.querySelector('#liveCamTZ'), spec.target[2]);
        setIfNotFocused(pane.querySelector('#liveCamFov'), spec.fov);
        const fovLabel = pane.querySelector('#liveCamFovValue');
        if (fovLabel) fovLabel.textContent = `${spec.fov}°`;
    }
}

function scheduleAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
        saveEditorState({ silent: true });
    }, AUTO_SAVE_DELAY);
}

function buildHeader(panel) {
    const header = document.createElement('div');
    header.className = 'editor-header';
    header.innerHTML = `
        <h3>3D EDITOR</h3>
        <div class="editor-actions">
            <button id="gizmoTranslate" title="Translate (W)">Move</button>
            <button id="gizmoRotate" title="Rotate (E)">Rot</button>
            <button id="gizmoScale" title="Scale (R)">Scale</button>
            <button id="gizmoDetach" title="Deselect (Esc)">×</button>
            <button id="saveAllBtn" title="Save all (auto-saves on change)">Save</button>
        </div>
    `;
    panel.appendChild(header);

    header.querySelector('#gizmoTranslate').onclick = () => transformControls.setMode('translate');
    header.querySelector('#gizmoRotate').onclick = () => transformControls.setMode('rotate');
    header.querySelector('#gizmoScale').onclick = () => transformControls.setMode('scale');
    header.querySelector('#gizmoDetach').onclick = () => detachGizmo();
    header.querySelector('#saveAllBtn').onclick = () => saveEditorState();
}

function buildTabs(panel) {
    const tabs = document.createElement('div');
    tabs.className = 'editor-tabs';
    tabs.innerHTML = `
        <button class="tab-btn active" data-tab="lights">Lights</button>
        <button class="tab-btn" data-tab="slots">Slots</button>
        <button class="tab-btn" data-tab="cameras">Cameras</button>
        <button class="tab-btn" data-tab="animations">Animations</button>
    `;
    panel.appendChild(tabs);

    const tabContent = document.createElement('div');
    tabContent.className = 'editor-tab-content';
    tabContent.innerHTML = `
        <div class="tab-pane active" data-tab="lights"></div>
        <div class="tab-pane" data-tab="slots"></div>
        <div class="tab-pane" data-tab="cameras"></div>
        <div class="tab-pane" data-tab="animations"></div>
    `;
    panel.appendChild(tabContent);

    tabs.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            tabs.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            tabContent.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            tabContent.querySelector(`.tab-pane[data-tab="${btn.dataset.tab}"]`).classList.add('active');
        };
    });
}

async function saveEditorState(opts = {}) {
    const editor = { ...registry.serialize(), triggers: getTriggerMap() };
    await saveSettings({ editor });
    await saveAnimations();
    if (!opts.silent) console.log('Editor state saved');
}

export async function initEditor({ scene: sceneRef, editorCamera: ec, liveCamera: lc, orbitControls: oc, cameraHelper: ch, canvas }) {
    scene = sceneRef;
    editorCamera = ec;
    liveCamera = lc;
    orbitControls = oc;
    cameraHelper = ch;

    transformControls = new TransformControls(editorCamera, canvas);
    transformControls.addEventListener('dragging-changed', (e) => {
        orbitControls.enabled = !e.value;
    });
    scene.add(transformControls);
    wireGizmoTransforms();

    const toggleBtn = document.getElementById('modeToggleBtn');
    if (toggleBtn) {
        toggleBtn.onclick = () => setMode(mode === 'editor' ? 'live' : 'editor');
    }

    const panel = document.getElementById('editorPanel');
    panel.innerHTML = '';
    buildHeader(panel);
    buildTabs(panel);

    renderLightsPanel();
    renderSlotsPanel();
    renderCameraPanel();
    renderAnimationsPanel();

    // Re-render panels ONLY when the row structure changes (add/remove).
    // Update events would rebuild the DOM and steal focus from inputs the user is typing into.
    registry.addEventListener('lights:add', () => renderLightsPanel());
    registry.addEventListener('lights:remove', () => renderLightsPanel());
    registry.addEventListener('slots:add', () => renderSlotsPanel());
    registry.addEventListener('slots:remove', () => renderSlotsPanel());

    // For every change (including updates) refresh proxies, schedule save,
    // and sync displayed values for any input that isn't currently focused.
    registry.addEventListener('change', (e) => {
        refreshSlotProxies();
        scheduleAutoSave();
        const type = e.detail?.type;
        if (type === 'lights:update' || type === 'slots:update' || type === 'liveCamera:update') {
            syncPanelInputs(e.detail);
        }
    });
    registry.addEventListener('slots:remove', (e) => disposeSlotProxies(e.detail.id));
    registry.addEventListener('lights:remove', (e) => {
        if (selectedTargetId === `light:${e.detail.id}`) detachGizmo();
    });

    window.addEventListener('keydown', (e) => {
        if (mode !== 'editor') return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        if (e.key === 'w') transformControls.setMode('translate');
        if (e.key === 'e') transformControls.setMode('rotate');
        if (e.key === 'r') transformControls.setMode('scale');
        if (e.key === 'Escape') detachGizmo();
    });

    await setMode('live');
}
