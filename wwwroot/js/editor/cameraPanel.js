import { registry } from './registry.js';
import { selectTarget } from './editorMode.js';
import { t } from '../i18n.js';

let editorCameraRef = null;

export function setEditorCameraRef(cam) {
    editorCameraRef = cam;
}

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

function asDeg(rad) { return (rad * RAD2DEG).toFixed(2); }
function fromDeg(deg) { return parseFloat(deg) * DEG2RAD; }

export function renderCameraPanel() {
    const pane = document.querySelector('.tab-pane[data-tab="cameras"]');
    if (!pane) return;
    const spec = registry.liveCamera;
    pane.innerHTML = `
        <div class="editor-row">
            <div class="row-head">
                <strong>${t('cameras.live')}</strong>
                <button id="liveCamSelect" class="select-btn" title="${t('cameras.attachGizmo')}">⊕</button>
            </div>
            <div class="row-body">
                <label>${t('cameras.position')}
                    <input type="number" step="0.1" value="${spec.position[0]}" id="liveCamX">
                    <input type="number" step="0.1" value="${spec.position[1]}" id="liveCamY">
                    <input type="number" step="0.1" value="${spec.position[2]}" id="liveCamZ">
                </label>
                <label>${t('cameras.rotationDeg')}
                    <input type="number" step="1" value="${asDeg(spec.rotation[0])}" id="liveCamRX">
                    <input type="number" step="1" value="${asDeg(spec.rotation[1])}" id="liveCamRY">
                    <input type="number" step="1" value="${asDeg(spec.rotation[2])}" id="liveCamRZ">
                </label>
                <label class="slider-row">${t('cameras.fov')}
                    <input type="range" min="10" max="120" step="1" value="${spec.fov}" id="liveCamFov">
                    <span id="liveCamFovValue">${spec.fov}°</span>
                </label>
                <div class="button-row">
                    <button id="liveCamSnap">${t('cameras.snap')}</button>
                </div>
            </div>
        </div>
    `;

    pane.querySelector('#liveCamSelect').onclick = () => selectTarget('liveCamera');

    pane.querySelector('#liveCamSnap').onclick = () => {
        if (!editorCameraRef) return;
        const pos = editorCameraRef.position;
        const rot = editorCameraRef.rotation;
        registry.updateLiveCamera({
            position: [pos.x, pos.y, pos.z],
            rotation: [rot.x, rot.y, rot.z],
            fov: editorCameraRef.fov
        });
    };

    const collectAndApply = () => {
        registry.updateLiveCamera({
            position: [
                parseFloat(pane.querySelector('#liveCamX').value),
                parseFloat(pane.querySelector('#liveCamY').value),
                parseFloat(pane.querySelector('#liveCamZ').value)
            ],
            rotation: [
                fromDeg(pane.querySelector('#liveCamRX').value),
                fromDeg(pane.querySelector('#liveCamRY').value),
                fromDeg(pane.querySelector('#liveCamRZ').value)
            ],
            fov: parseFloat(pane.querySelector('#liveCamFov').value)
        });
        pane.querySelector('#liveCamFovValue').textContent = `${pane.querySelector('#liveCamFov').value}°`;
    };

    pane.querySelectorAll('input').forEach(el => {
        el.oninput = collectAndApply;
    });
}
