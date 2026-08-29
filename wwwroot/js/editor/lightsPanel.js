import { registry, intToHex } from './registry.js';
import { selectTarget } from './editorMode.js';
import { t } from '../i18n.js';
import { bindingSelectHtml, effectiveColor } from './colorBinding.js';

const LIGHT_TYPES = ['Directional', 'Point', 'Spot', 'Hemisphere', 'Ambient'];

// Value attribute stays English so saved data keeps working regardless of UI language.
function lightTypeLabel(type) { return t(`lights.types.${type}`); }

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

    const colorBound = spec.colorBinding && spec.colorBinding !== 'static';
    const groundBound = spec.groundColorBinding && spec.groundColorBinding !== 'static';
    const colorDisplay = colorString(effectiveColor(spec.color, spec.colorBinding));
    const groundDisplay = colorString(effectiveColor(spec.groundColor, spec.groundColorBinding));

    row.innerHTML = `
        <div class="row-head">
            <input class="name-input" type="text" value="${spec.name}">
            <select class="type-select">
                ${LIGHT_TYPES.map(name => `<option value="${name}" ${name === spec.type ? 'selected' : ''}>${lightTypeLabel(name)}</option>`).join('')}
            </select>
            <button class="select-btn">⊕</button>
            <button class="remove-btn">×</button>
        </div>
        <div class="row-body">
            <label>${t('lights.color')}
                <input type="color" class="color-input" value="${colorDisplay}" ${colorBound ? 'disabled' : ''}>
                <span data-binding-slot="color">${bindingSelectHtml(spec.colorBinding)}</span>
            </label>
            ${showGround ? `<label>${t('lights.ground')}
                <input type="color" class="ground-input" value="${groundDisplay}" ${groundBound ? 'disabled' : ''}>
                <span data-binding-slot="ground">${bindingSelectHtml(spec.groundColorBinding)}</span>
            </label>` : ''}
            <label>${t('lights.intensity')} <input type="number" min="0" step="1" value="${spec.intensity}" class="intensity-input"></label>
            ${showPosition ? `
            <label>${t('lights.pos')}
                <input type="number" step="0.1" value="${spec.position[0]}" class="pos-x">
                <input type="number" step="0.1" value="${spec.position[1]}" class="pos-y">
                <input type="number" step="0.1" value="${spec.position[2]}" class="pos-z">
            </label>` : ''}
            ${showTarget ? `
            <label>${t('lights.target')}
                <input type="number" step="0.1" value="${spec.target[0]}" class="tgt-x">
                <input type="number" step="0.1" value="${spec.target[1]}" class="tgt-y">
                <input type="number" step="0.1" value="${spec.target[2]}" class="tgt-z">
            </label>` : ''}
            ${showSpotExtras ? `
            <label class="slider-row">${t('lights.angle')} <input type="range" min="0" max="${Math.PI / 2}" step="0.01" value="${spec.extras?.angle ?? Math.PI / 6}" class="angle-input"></label>
            <label class="slider-row">${t('lights.penumbra')} <input type="range" min="0" max="1" step="0.01" value="${spec.extras?.penumbra ?? 0.1}" class="penumbra-input"></label>` : ''}
            ${showPointExtras ? `
            <label class="slider-row">${t('lights.distance')} <input type="number" step="0.5" value="${spec.extras?.distance ?? 0}" class="distance-input"></label>` : ''}
            <label><input type="checkbox" class="shadow-input" ${spec.castShadow ? 'checked' : ''}> ${t('lights.castShadows')}</label>
        </div>
    `;

    row.querySelector('.select-btn').onclick = () => selectTarget(`light:${spec.id}`);
    row.querySelector('.remove-btn').onclick = () => registry.removeLight(spec.id);

    const readPartial = () => {
        const colorEl = row.querySelector('.color-input');
        const colorBindEl = row.querySelector('[data-binding-slot="color"] .color-binding-select');
        const partial = {
            name: row.querySelector('.name-input').value,
            color: colorEl.disabled ? spec.color : colorEl.value,
            colorBinding: colorBindEl ? colorBindEl.value : 'static',
            intensity: parseFloat(row.querySelector('.intensity-input').value),
            castShadow: row.querySelector('.shadow-input').checked
        };
        if (showGround) {
            const groundEl = row.querySelector('.ground-input');
            const groundBindEl = row.querySelector('[data-binding-slot="ground"] .color-binding-select');
            partial.groundColor = groundEl.disabled ? spec.groundColor : groundEl.value;
            partial.groundColorBinding = groundBindEl ? groundBindEl.value : 'static';
        }
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
        } else if (el.classList.contains('color-binding-select')) {
            el.onchange = () => {
                registry.updateLight(spec.id, readPartial(), { trackSpotTarget: true });
                renderLightsPanel();
            };
        } else if (type === 'range' || type === 'number' || type === 'color' || type === 'text' || type === 'checkbox') {
            el.oninput = () => {
                registry.updateLight(spec.id, readPartial(), { trackSpotTarget: true });
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
        <select id="newLightType">${LIGHT_TYPES.map(name => `<option value="${name}">${lightTypeLabel(name)}</option>`).join('')}</select>
        <button id="addLightBtn">${t('lights.addLight')}</button>
    `;
    pane.appendChild(addBar);
    addBar.querySelector('#addLightBtn').onclick = () => {
        const type = addBar.querySelector('#newLightType').value;
        const id = registry.addLight({ type, name: `${type} Light`, intensity: 1.0, position: [0, 5, 0], target: [0, 0, 0] });
        if (id) selectTarget(`light:${id}`);
    };
}
