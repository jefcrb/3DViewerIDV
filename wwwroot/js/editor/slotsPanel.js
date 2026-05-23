import { registry } from './registry.js';
import { selectTarget } from './editorMode.js';
import { applyRegistrySlotsToCharacterPositions } from '../scene/loader.js';

function slotRow(spec) {
    const row = document.createElement('div');
    row.className = 'editor-row';
    row.dataset.id = spec.id;

    row.innerHTML = `
        <div class="row-head">
            <strong>${spec.role}</strong>
            <button class="select-btn">⊕</button>
            <button class="remove-btn">×</button>
        </div>
        <div class="row-body">
            <label>Position
                <input type="number" step="0.1" value="${spec.position[0]}" class="pos-x">
                <input type="number" step="0.1" value="${spec.position[1]}" class="pos-y">
                <input type="number" step="0.1" value="${spec.position[2]}" class="pos-z">
            </label>
            <label>Rotation
                <input type="number" step="0.01" value="${spec.rotation[0]}" class="rot-x">
                <input type="number" step="0.01" value="${spec.rotation[1]}" class="rot-y">
                <input type="number" step="0.01" value="${spec.rotation[2]}" class="rot-z">
            </label>
            <label>Scale
                <input type="number" step="0.05" value="${spec.scale[0]}" class="scl-x">
                <input type="number" step="0.05" value="${spec.scale[1]}" class="scl-y">
                <input type="number" step="0.05" value="${spec.scale[2]}" class="scl-z">
            </label>
        </div>
    `;

    row.querySelector('.select-btn').onclick = () => selectTarget(`slot:${spec.id}`);
    row.querySelector('.remove-btn').onclick = () => registry.removeSlot(spec.id);

    const onChange = () => {
        registry.updateSlot(spec.id, {
            position: [
                parseFloat(row.querySelector('.pos-x').value),
                parseFloat(row.querySelector('.pos-y').value),
                parseFloat(row.querySelector('.pos-z').value)
            ],
            rotation: [
                parseFloat(row.querySelector('.rot-x').value),
                parseFloat(row.querySelector('.rot-y').value),
                parseFloat(row.querySelector('.rot-z').value)
            ],
            scale: [
                parseFloat(row.querySelector('.scl-x').value),
                parseFloat(row.querySelector('.scl-y').value),
                parseFloat(row.querySelector('.scl-z').value)
            ]
        });
        applyRegistrySlotsToCharacterPositions(registry);
    };

    row.querySelectorAll('input').forEach(el => {
        el.oninput = onChange;
    });

    return row;
}

export function renderSlotsPanel() {
    const pane = document.querySelector('.tab-pane[data-tab="slots"]');
    if (!pane) return;
    pane.innerHTML = '';

    const list = document.createElement('div');
    list.className = 'editor-list';
    registry.listSlots().forEach(spec => list.appendChild(slotRow(spec)));
    pane.appendChild(list);

    const available = registry.availableRoles();
    const addBar = document.createElement('div');
    addBar.className = 'add-bar';
    if (available.length === 0) {
        addBar.innerHTML = `<span style="color:#b3b3b3; flex:1; font-size:11px;">All slots are in use.</span>`;
    } else {
        addBar.innerHTML = `
            <select id="newSlotRole">${available.map(r => `<option value="${r}">${r}</option>`).join('')}</select>
            <button id="addSlotBtn">+ Add Slot</button>
        `;
        addBar.querySelector('#addSlotBtn').onclick = () => {
            const role = addBar.querySelector('#newSlotRole').value;
            registry.addSlot({ role, label: role, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
            applyRegistrySlotsToCharacterPositions(registry);
        };
    }
    pane.appendChild(addBar);
}
