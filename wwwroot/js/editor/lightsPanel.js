import { registry, intToHex } from './registry.js';
import { selectTarget } from './editorMode.js';

const LIGHT_TYPES = ['Directional', 'Point', 'Spot', 'Hemisphere', 'Ambient'];

function colorString(c) {
    if (typeof c === 'string') return c.startsWith('#') ? c : intToHex(parseInt(c));
    if (typeof c === 'number') return intToHex(c);
    return '#ffffff';
}

function lightRow(spec) {
    const row = document.createElement('div');
    row.className = 'editor-row';
    row.dataset.id = spec.id;

    const showPosition = spec.type !== 'Ambient';
    const showTarget = spec.type === 'Directional' || spec.type === 'Spot';
    const showGround = spec.type === 'Hemisphere';
    const showSpotExtras = spec.type === 'Spot';
    const showPointExtras = spec.type === 'Point' || spec.type === 'Spot';

    row.innerHTML = `
        <div class="row-head">
            <input class="name-input" type="text" value="${spec.name}">
            <select class="type-select">
                ${LIGHT_TYPES.map(t => `<option value="${t}" ${t === spec.type ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
            <button class="select-btn">⊕</button>
            <button class="remove-btn">×</button>
        </div>
        <div class="row-body">
            <label>Color <input type="color" class="color-input" value="${colorString(spec.color)}"></label>
            ${showGround ? `<label>Ground <input type="color" class="ground-input" value="${colorString(spec.groundColor)}"></label>` : ''}
            <label class="slider-row">Intensity <input type="range" min="0" max="10" step="0.01" value="${spec.intensity}" class="intensity-input"><span class="intensity-value">${spec.intensity.toFixed(2)}</span></label>
            ${showPosition ? `
            <label>Pos
                <input type="number" step="0.1" value="${spec.position[0]}" class="pos-x">
                <input type="number" step="0.1" value="${spec.position[1]}" class="pos-y">
                <input type="number" step="0.1" value="${spec.position[2]}" class="pos-z">
            </label>` : ''}
            ${showTarget ? `
            <label>Target
                <input type="number" step="0.1" value="${spec.target[0]}" class="tgt-x">
                <input type="number" step="0.1" value="${spec.target[1]}" class="tgt-y">
                <input type="number" step="0.1" value="${spec.target[2]}" class="tgt-z">
            </label>` : ''}
            ${showSpotExtras ? `
            <label class="slider-row">Angle <input type="range" min="0" max="${Math.PI / 2}" step="0.01" value="${spec.extras?.angle ?? Math.PI / 6}" class="angle-input"></label>
            <label class="slider-row">Penumbra <input type="range" min="0" max="1" step="0.01" value="${spec.extras?.penumbra ?? 0.1}" class="penumbra-input"></label>` : ''}
            ${showPointExtras ? `
            <label class="slider-row">Distance <input type="number" step="0.5" value="${spec.extras?.distance ?? 0}" class="distance-input"></label>` : ''}
            <label><input type="checkbox" class="shadow-input" ${spec.castShadow ? 'checked' : ''}> Cast shadows</label>
        </div>
    `;

    row.querySelector('.select-btn').onclick = () => selectTarget(`light:${spec.id}`);
    row.querySelector('.remove-btn').onclick = () => registry.removeLight(spec.id);

    const readPartial = () => {
        const partial = {
            name: row.querySelector('.name-input').value,
            color: row.querySelector('.color-input').value,
            intensity: parseFloat(row.querySelector('.intensity-input').value),
            castShadow: row.querySelector('.shadow-input').checked
        };
        if (showGround) partial.groundColor = row.querySelector('.ground-input').value;
        if (showPosition) {
            partial.position = [
                parseFloat(row.querySelector('.pos-x').value),
                parseFloat(row.querySelector('.pos-y').value),
                parseFloat(row.querySelector('.pos-z').value)
            ];
        }
        if (showTarget) {
            partial.target = [
                parseFloat(row.querySelector('.tgt-x').value),
                parseFloat(row.querySelector('.tgt-y').value),
                parseFloat(row.querySelector('.tgt-z').value)
            ];
        }
        const extras = { ...(spec.extras || {}) };
        if (showSpotExtras) {
            extras.angle = parseFloat(row.querySelector('.angle-input').value);
            extras.penumbra = parseFloat(row.querySelector('.penumbra-input').value);
        }
        if (showPointExtras) {
            extras.distance = parseFloat(row.querySelector('.distance-input').value);
        }
        partial.extras = extras;
        return partial;
    };

    row.querySelectorAll('input, select').forEach(el => {
        const type = el.type;
        if (el.classList.contains('type-select')) {
            el.onchange = () => registry.updateLight(spec.id, { type: el.value });
        } else if (type === 'range' || type === 'number' || type === 'color' || type === 'text' || type === 'checkbox') {
            el.oninput = () => {
                if (el.classList.contains('intensity-input')) {
                    row.querySelector('.intensity-value').textContent = parseFloat(el.value).toFixed(2);
                }
                registry.updateLight(spec.id, readPartial());
            };
        }
    });

    return row;
}

export function renderLightsPanel() {
    const pane = document.querySelector('.tab-pane[data-tab="lights"]');
    if (!pane) return;
    pane.innerHTML = '';

    const list = document.createElement('div');
    list.className = 'editor-list';
    registry.listLights().forEach(spec => list.appendChild(lightRow(spec)));
    pane.appendChild(list);

    const addBar = document.createElement('div');
    addBar.className = 'add-bar';
    addBar.innerHTML = `
        <select id="newLightType">${LIGHT_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}</select>
        <button id="addLightBtn">+ Add Light</button>
    `;
    pane.appendChild(addBar);
    addBar.querySelector('#addLightBtn').onclick = () => {
        const type = addBar.querySelector('#newLightType').value;
        registry.addLight({ type, name: `${type} Light`, intensity: 1.0, position: [0, 5, 0], target: [0, 0, 0] });
    };
}
