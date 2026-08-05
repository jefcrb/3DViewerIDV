import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { registry } from './registry.js';
import { renderLightsPanel } from './lightsPanel.js';
import { renderSlotsPanel } from './slotsPanel.js';
import { renderCameraPanel } from './cameraPanel.js';
import { renderAnimationsPanel } from './animationsPanel.js';
import { renderWorldPanel } from './worldPanel.js';
import { saveSettings, exportSettings, importSettings } from '../storage/settingsStorage.js';
import { sequencer } from '../animation/sequencer.js';
import { clipManager } from '../animation/clips.js';
import { setFiringAllowed } from '../animation/triggers.js';
import { initLightHelpers, setHelpersVisible } from './lightHelpers.js';
import { t, toggleLanguage } from '../i18n.js';
import { PLUGIN_VERSION } from '../config.js';

let mode = 'live';
let editorCamera = null;
let liveCamera = null;
let cameraHelper = null;
let orbitControls = null;
let transformControls = null;
let selectedTargetId = null;
let proxyByKey = new Map();
let scene = null;

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
    setHelpersVisible(isEditor);
    if (transformControls) {
        if (!isEditor) detachGizmo();
        transformControls.visible = isEditor && !!selectedTargetId;
        transformControls.enabled = isEditor;
    }
    updateProxyVisibility();
    const panel = document.getElementById('editorPanel');
    if (panel) panel.style.display = isEditor ? 'flex' : 'none';
    const toggleBtn = document.getElementById('modeToggleBtn');
    if (toggleBtn) toggleBtn.textContent = isEditor ? t('topActions.switchToLive') : t('topActions.switchToEditor');

    // Editor mode pauses auto-trigger firing so authoring doesn't get overwritten.
    setFiringAllowed(!isEditor);
}

function detachGizmo() {
    if (!transformControls) return;
    transformControls.detach();
    transformControls.visible = false;
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
        transformControls.visible = true;
        updateProxyVisibility();
        return;
    }

    if (key.startsWith('light:')) {
        const id = key.slice('light:'.length);
        const light = registry.getLight(id)?.threeObject;
        if (light) {
            transformControls.attach(light);
            transformControls.setMode('translate');
            transformControls.visible = true;
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
            transformControls.visible = true;
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
                position: [liveCamera.position.x, liveCamera.position.y, liveCamera.position.z],
                rotation: [liveCamera.rotation.x, liveCamera.rotation.y, liveCamera.rotation.z]
            });
            cameraHelper && cameraHelper.update();
            return;
        }
        if (selectedTargetId.startsWith('light:')) {
            const id = selectedTargetId.slice('light:'.length);
            const entry = registry.getLight(id);
            if (entry) {
                const pos = entry.threeObject.position;
                registry.updateLight(id, { position: [pos.x, pos.y, pos.z] }, { trackSpotTarget: true });
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
        const RAD2DEG = 180 / Math.PI;
        setIfNotFocused(pane.querySelector('#liveCamX'), spec.position[0]);
        setIfNotFocused(pane.querySelector('#liveCamY'), spec.position[1]);
        setIfNotFocused(pane.querySelector('#liveCamZ'), spec.position[2]);
        setIfNotFocused(pane.querySelector('#liveCamRX'), (spec.rotation[0] * RAD2DEG).toFixed(2));
        setIfNotFocused(pane.querySelector('#liveCamRY'), (spec.rotation[1] * RAD2DEG).toFixed(2));
        setIfNotFocused(pane.querySelector('#liveCamRZ'), (spec.rotation[2] * RAD2DEG).toFixed(2));
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
        <h3>${t('header.title')}<span class="editor-header-version">v${PLUGIN_VERSION}</span></h3>
        <div class="editor-actions">
            <button id="gizmoTranslate" class="gizmo-btn" title="${t('header.translateTitle')}">✥</button>
            <button id="gizmoRotate" class="gizmo-btn" title="${t('header.rotateTitle')}">↻</button>
            <button id="gizmoScale" class="gizmo-btn" title="${t('header.scaleTitle')}">⤢</button>
            <button id="gizmoDetach" class="gizmo-btn" title="${t('header.deselectTitle')}">×</button>
            <button id="saveAllBtn" title="${t('header.saveTitle')}">${t('header.save')}</button>
        </div>
    `;
    panel.appendChild(header);

    header.querySelector('#gizmoTranslate').onclick = () => transformControls.setMode('translate');
    header.querySelector('#gizmoRotate').onclick = () => transformControls.setMode('rotate');
    header.querySelector('#gizmoScale').onclick = () => transformControls.setMode('scale');
    header.querySelector('#gizmoDetach').onclick = () => detachGizmo();
    header.querySelector('#saveAllBtn').onclick = () => saveEditorState();
}

function wireTopActions() {
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const fileInput = document.getElementById('importFile');
    const langBtn = document.getElementById('langToggleBtn');
    if (!exportBtn || !importBtn || !fileInput) return;

    exportBtn.textContent = t('topActions.export');
    exportBtn.title = t('topActions.exportTitle');
    importBtn.textContent = t('topActions.import');
    importBtn.title = t('topActions.importTitle');
    if (langBtn) {
        langBtn.textContent = t('topActions.langToggle');
        langBtn.onclick = () => toggleLanguage();
    }

    exportBtn.onclick = () => exportSettings();
    importBtn.onclick = () => fileInput.click();
    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const ok = confirm(`Replace current settings with "${file.name}"? This overwrites viewer_settings.json and reloads the page.`);
        if (!ok) {
            fileInput.value = '';
            return;
        }
        try {
            clearTimeout(autoSaveTimer);
            await importSettings(file);
            location.reload();
        } catch (err) {
            alert('Import failed: ' + err.message);
            fileInput.value = '';
        }
    };
}

function buildTabs(panel) {
    const tabs = document.createElement('div');
    tabs.className = 'editor-tabs';
    tabs.innerHTML = `
        <button class="tab-btn active" data-tab="lights">${t('tabs.lights')}</button>
        <button class="tab-btn" data-tab="slots">${t('tabs.characters')}</button>
        <button class="tab-btn" data-tab="cameras">${t('tabs.cameras')}</button>
        <button class="tab-btn" data-tab="world">${t('tabs.world')}</button>
        <button class="tab-btn" data-tab="animations">${t('tabs.animations')}</button>
    `;
    panel.appendChild(tabs);

    const tabContent = document.createElement('div');
    tabContent.className = 'editor-tab-content';
    tabContent.innerHTML = `
        <div class="tab-pane active" data-tab="lights"></div>
        <div class="tab-pane" data-tab="slots"></div>
        <div class="tab-pane" data-tab="cameras"></div>
        <div class="tab-pane" data-tab="world"></div>
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
    const editor = {
        ...registry.serialize(),
        sequences: sequencer.serialize(),
        clips: clipManager.serialize()
    };
    await saveSettings({ editor });
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

    initLightHelpers(scene);

    const toggleBtn = document.getElementById('modeToggleBtn');
    if (toggleBtn) {
        toggleBtn.onclick = () => setMode(mode === 'editor' ? 'live' : 'editor');
    }

    const panel = document.getElementById('editorPanel');
    panel.innerHTML = '';
    buildHeader(panel);
    buildTabs(panel);
    wireTopActions();

    renderLightsPanel();
    renderSlotsPanel();
    renderCameraPanel();
    renderWorldPanel();
    renderAnimationsPanel();

    // Re-render only on add/remove — update events would steal focus from inputs being typed into.
    registry.addEventListener('lights:add', () => renderLightsPanel());
    registry.addEventListener('lights:remove', () => renderLightsPanel());
    registry.addEventListener('slots:add', () => renderSlotsPanel());
    registry.addEventListener('slots:remove', () => renderSlotsPanel());

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

    // Skip re-render when focus is inside the animations pane to avoid yanking it from inputs.
    const rerenderIfSafe = () => {
        const pane = document.querySelector('.tab-pane[data-tab="animations"]');
        if (!pane || !pane.contains(document.activeElement)) {
            renderAnimationsPanel();
        }
    };
    sequencer.addEventListener('seq:add', () => { renderAnimationsPanel(); scheduleAutoSave(); });
    sequencer.addEventListener('seq:remove', () => { renderAnimationsPanel(); scheduleAutoSave(); });
    sequencer.addEventListener('seq:update', () => { rerenderIfSafe(); scheduleAutoSave(); });
    sequencer.addEventListener('seq:play', () => rerenderIfSafe());
    sequencer.addEventListener('seq:stop', () => rerenderIfSafe());

    clipManager.addEventListener('clip:update', () => { rerenderIfSafe(); scheduleAutoSave(); });
    clipManager.addEventListener('clip:play', () => rerenderIfSafe());
    clipManager.addEventListener('clip:stop', () => rerenderIfSafe());

    window.addEventListener('keydown', (e) => {
        if (mode !== 'editor') return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        if (e.key === 'w') transformControls.setMode('translate');
        if (e.key === 'e') transformControls.setMode('rotate');
        if (e.key === 'r') transformControls.setMode('scale');
        if (e.key === 'Escape') detachGizmo();
    });

    await setMode('editor');
}
