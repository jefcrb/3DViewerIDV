import { registry } from './registry.js';
import { selectTarget } from './editorMode.js';

let editorCameraRef = null;

export function setEditorCameraRef(cam) {
    editorCameraRef = cam;
}

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
                <label>Target
                    <input type="number" step="0.1" value="${spec.target[0]}" id="liveCamTX">
                    <input type="number" step="0.1" value="${spec.target[1]}" id="liveCamTY">
                    <input type="number" step="0.1" value="${spec.target[2]}" id="liveCamTZ">
                </label>
                <label class="slider-row">FOV
                    <input type="range" min="10" max="120" step="1" value="${spec.fov}" id="liveCamFov">
                    <span id="liveCamFovValue">${spec.fov}°</span>
                </label>
            </div>
        </div>
    `;

    pane.querySelector('#liveCamSelect').onclick = () => selectTarget('liveCamera');
    pane.querySelector('#liveCamSnap').onclick = () => {
        if (!editorCameraRef) return;
        const pos = editorCameraRef.position;
        registry.updateLiveCamera({
            position: [pos.x, pos.y, pos.z],
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
            target: [
                parseFloat(pane.querySelector('#liveCamTX').value),
                parseFloat(pane.querySelector('#liveCamTY').value),
                parseFloat(pane.querySelector('#liveCamTZ').value)
            ],
            fov: parseFloat(pane.querySelector('#liveCamFov').value)
        });
        pane.querySelector('#liveCamFovValue').textContent = `${pane.querySelector('#liveCamFov').value}°`;
    };

    pane.querySelectorAll('input').forEach(el => {
        el.oninput = collectAndApply;
    });
}
