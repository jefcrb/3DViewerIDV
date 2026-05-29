import { registry } from './registry.js';
import { selectTarget } from './editorMode.js';

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
            <div class="row-head"><strong>Live (Broadcast) Camera</strong>
                <button id="liveCamSelect">⊕ Gizmo</button>
                <button id="liveCamSnap">Snap to Editor</button>
            </div>
            <div class="row-body">
                <label>Position
                    <input type="number" step="0.1" value="${spec.position[0]}" id="liveCamX">
                    <input type="number" step="0.1" value="${spec.position[1]}" id="liveCamY">
                    <input type="number" step="0.1" value="${spec.position[2]}" id="liveCamZ">
                </label>
                <label>Rotation (deg)
                    <input type="number" step="1" value="${asDeg(spec.rotation[0])}" id="liveCamRX">
                    <input type="number" step="1" value="${asDeg(spec.rotation[1])}" id="liveCamRY">
                    <input type="number" step="1" value="${asDeg(spec.rotation[2])}" id="liveCamRZ">
                </label>
                <label class="slider-row">FOV
                    <input type="range" min="10" max="120" step="1" value="${spec.fov}" id="liveCamFov">
                    <span id="liveCamFovValue">${spec.fov}°</span>
                </label>
                <button id="liveCamLookOrigin">Look at origin</button>
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

    pane.querySelector('#liveCamLookOrigin').onclick = () => {
        const cam = registry.liveCameraRef;
        if (!cam) return;
        cam.lookAt(0, 0, 0);
        registry.updateLiveCamera({
            rotation: [cam.rotation.x, cam.rotation.y, cam.rotation.z]
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
