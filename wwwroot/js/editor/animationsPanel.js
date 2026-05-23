import {
    setSequenceTriggers,
    getTriggerMap,
    listKnownEvents,
    fire
} from '../animation/triggers.js';
import { listSheets, addSheet, removeSheet, saveAnimations } from '../animation/theatreSetup.js';

function sheetRow(name) {
    const row = document.createElement('div');
    row.className = 'editor-row';
    const triggers = getTriggerMap()[name] || [];
    const events = listKnownEvents();

    row.innerHTML = `
        <div class="row-head">
            <strong>${name}</strong>
            <button class="play-btn">▶ Play</button>
            <button class="remove-btn">×</button>
        </div>
        <div class="row-body">
            <label>Triggered by:</label>
            <div class="trigger-list">
                ${events.map(e => `
                    <label class="trigger-pill">
                        <input type="checkbox" value="${e}" ${triggers.includes(e) ? 'checked' : ''}>
                        ${e}
                    </label>
                `).join('')}
            </div>
            <div class="custom-trigger-row">
                <input type="text" placeholder="custom event name" class="custom-event-input">
                <button class="add-event-btn">+ Add Event</button>
            </div>
        </div>
    `;

    row.querySelector('.play-btn').onclick = () => {
        const events = (getTriggerMap()[name] || []);
        const evt = events[0] || 'manual_test';
        fire(evt, { sheet: name, manual: true });
    };

    row.querySelector('.remove-btn').onclick = () => {
        removeSheet(name);
        renderAnimationsPanel();
    };

    const collectChecked = () => {
        const checked = Array.from(row.querySelectorAll('.trigger-list input[type="checkbox"]:checked'))
            .map(cb => cb.value);
        setSequenceTriggers(name, checked);
    };

    row.querySelectorAll('.trigger-list input').forEach(cb => {
        cb.onchange = collectChecked;
    });

    row.querySelector('.add-event-btn').onclick = () => {
        const input = row.querySelector('.custom-event-input');
        const val = input.value.trim();
        if (!val) return;
        const current = getTriggerMap()[name] || [];
        if (!current.includes(val)) current.push(val);
        setSequenceTriggers(name, current);
        input.value = '';
        renderAnimationsPanel();
    };

    return row;
}

export function renderAnimationsPanel() {
    const pane = document.querySelector('.tab-pane[data-tab="animations"]');
    if (!pane) return;
    pane.innerHTML = '';

    const help = document.createElement('div');
    help.className = 'editor-note';
    help.innerHTML = `
        <p>Each sheet is a sequence with its own timeline. Use the Theatre.js Studio panel
        (bottom of screen in editor mode) to keyframe values. Map sheets to events here.</p>
        <p><strong>loop</strong> is special: bound sheets play with infinite repeat from scene load.</p>
    `;
    pane.appendChild(help);

    const list = document.createElement('div');
    list.className = 'editor-list';
    listSheets().forEach(name => list.appendChild(sheetRow(name)));
    pane.appendChild(list);

    const addBar = document.createElement('div');
    addBar.className = 'add-bar';
    addBar.innerHTML = `
        <input type="text" id="newSheetName" placeholder="new sheet name">
        <button id="addSheetBtn">+ Add Sheet</button>
        <button id="saveAnimBtn">Save Animations</button>
    `;
    pane.appendChild(addBar);
    addBar.querySelector('#addSheetBtn').onclick = () => {
        const name = addBar.querySelector('#newSheetName').value.trim();
        if (!name) return;
        addSheet(name);
        addBar.querySelector('#newSheetName').value = '';
        renderAnimationsPanel();
    };
    addBar.querySelector('#saveAnimBtn').onclick = () => saveAnimations();
}
