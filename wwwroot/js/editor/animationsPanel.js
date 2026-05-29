import { sequencer, EASING_NAMES, availableTargets } from '../animation/sequencer.js';
import { listKnownEvents, playSequence, stopSequence } from '../animation/triggers.js';
import { registry, intToHex } from './registry.js';
import { selectTarget } from './editorMode.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

const expandedKeyframes = new Set();        // `${seqId}@${t}`

function kfKey(seqId, t) { return `${seqId}@${t.toFixed(3)}`; }

// Pulse helper — applies the .just-recorded class to a keyframe row after the render
// settles. Defers via setTimeout 0 so any cascading renders complete first.
function pulseKeyframeRow(seqId, t) {
    setTimeout(() => {
        const seqRow = document.querySelector(`.editor-row[data-id="${seqId}"]`);
        if (!seqRow) return;
        const kfRow = Array.from(seqRow.querySelectorAll('.kf-row'))
            .find(r => Math.abs(parseFloat(r.dataset.t) - t) < 0.001);
        if (!kfRow) return;
        kfRow.classList.add('just-recorded');
        setTimeout(() => kfRow.classList.remove('just-recorded'), 900);
    }, 0);
}

function colorToHex(c) {
    if (typeof c === 'string') return c.startsWith('#') ? c : intToHex(parseInt(c));
    if (typeof c === 'number') return intToHex(c);
    return '#ffffff';
}

// Monochrome icons (single-color glyphs, no emoji color)
const ICON_CAMERA = '▣';
const ICON_LIGHT  = '✦';
const ICON_SLOT   = '◆';

function targetLabel(target) {
    if (target === 'liveCamera') return `${ICON_CAMERA} Live Camera`;
    if (target.startsWith('light:')) {
        const id = target.slice('light:'.length);
        const name = registry.getLight(id)?.spec?.name || id;
        return `${ICON_LIGHT} ${name}`;
    }
    if (target.startsWith('slot:')) {
        const id = target.slice('slot:'.length);
        const label = registry.getSlot(id)?.label || id;
        return `${ICON_SLOT} ${label}`;
    }
    return target;
}

function summarize(seq, kf) {
    if (!seq.targets.length) return 'no targets';
    const parts = [];
    if (kf.snapshot.liveCamera && seq.targets.includes('liveCamera')) {
        const p = kf.snapshot.liveCamera.position;
        parts.push(`cam(${p[0].toFixed(1)},${p[1].toFixed(1)},${p[2].toFixed(1)})`);
    }
    for (const target of seq.targets) {
        if (target.startsWith('light:')) {
            const id = target.slice('light:'.length);
            const v = kf.snapshot.lights?.[id];
            if (v) parts.push(`${id} ${v.intensity.toFixed(2)}`);
        } else if (target.startsWith('slot:')) {
            const id = target.slice('slot:'.length);
            const v = kf.snapshot.slots?.[id];
            if (v) {
                const p = v.position;
                parts.push(`${id}(${p[0].toFixed(1)},${p[1].toFixed(1)},${p[2].toFixed(1)})`);
            }
        }
    }
    return parts.join(' · ');
}

// ===== Detail sections (only rendered if target is in seq.targets) =====

function liveCameraSection(kf) {
    const c = kf.snapshot.liveCamera;
    if (!c) return '';
    return `
        <div class="kf-section">
            <div class="kf-section-title">Live Camera</div>
            <label>Position
                <input type="number" step="0.1" value="${c.position[0]}" data-path="liveCamera.position.0">
                <input type="number" step="0.1" value="${c.position[1]}" data-path="liveCamera.position.1">
                <input type="number" step="0.1" value="${c.position[2]}" data-path="liveCamera.position.2">
            </label>
            <label>Rotation°
                <input type="number" step="1" value="${(c.rotation[0] * RAD2DEG).toFixed(1)}" data-path="liveCamera.rotation.0" data-deg>
                <input type="number" step="1" value="${(c.rotation[1] * RAD2DEG).toFixed(1)}" data-path="liveCamera.rotation.1" data-deg>
                <input type="number" step="1" value="${(c.rotation[2] * RAD2DEG).toFixed(1)}" data-path="liveCamera.rotation.2" data-deg>
            </label>
            <label>FOV
                <input type="number" step="1" min="10" max="120" value="${c.fov}" data-path="liveCamera.fov">
            </label>
        </div>
    `;
}

function lightSection(kf, lightId) {
    const l = kf.snapshot.lights?.[lightId];
    if (!l) return '';
    const spec = registry.getLight(lightId)?.spec;
    const label = spec?.name || lightId;
    const isAmbient = spec?.type === 'Ambient';
    const isSpot = spec?.type === 'Spot';
    const showPos = !isAmbient;
    return `
        <div class="kf-section">
            <div class="kf-section-title">${ICON_LIGHT} ${label} <span class="muted">(${lightId})</span></div>
            <label>Intensity
                <input type="number" step="0.05" min="0" value="${l.intensity}" data-path="lights.${lightId}.intensity">
            </label>
            <label>Color
                <input type="color" value="${colorToHex(l.color)}" data-path="lights.${lightId}.color">
            </label>
            ${showPos ? `
            <label>Position
                <input type="number" step="0.1" value="${l.position[0]}" data-path="lights.${lightId}.position.0">
                <input type="number" step="0.1" value="${l.position[1]}" data-path="lights.${lightId}.position.1">
                <input type="number" step="0.1" value="${l.position[2]}" data-path="lights.${lightId}.position.2">
            </label>
            <label>Target
                <input type="number" step="0.1" value="${l.target[0]}" data-path="lights.${lightId}.target.0">
                <input type="number" step="0.1" value="${l.target[1]}" data-path="lights.${lightId}.target.1">
                <input type="number" step="0.1" value="${l.target[2]}" data-path="lights.${lightId}.target.2">
            </label>` : ''}
            ${isSpot ? `
            <label>Angle°
                <input type="number" step="1" min="0" max="90" value="${((l.extras?.angle ?? 0) * RAD2DEG).toFixed(1)}" data-path="lights.${lightId}.extras.angle" data-deg>
            </label>
            <label>Penumbra
                <input type="number" step="0.05" min="0" max="1" value="${l.extras?.penumbra ?? 0}" data-path="lights.${lightId}.extras.penumbra">
            </label>` : ''}
        </div>
    `;
}

function slotSection(kf, slotId) {
    const s = kf.snapshot.slots?.[slotId];
    if (!s) return '';
    const spec = registry.getSlot(slotId);
    const label = spec?.label || slotId;
    return `
        <div class="kf-section">
            <div class="kf-section-title">${ICON_SLOT} ${label} <span class="muted">(${slotId})</span></div>
            <label>Position
                <input type="number" step="0.1" value="${s.position[0]}" data-path="slots.${slotId}.position.0">
                <input type="number" step="0.1" value="${s.position[1]}" data-path="slots.${slotId}.position.1">
                <input type="number" step="0.1" value="${s.position[2]}" data-path="slots.${slotId}.position.2">
            </label>
            <label>Rotation°
                <input type="number" step="1" value="${(s.rotation[0] * RAD2DEG).toFixed(1)}" data-path="slots.${slotId}.rotation.0" data-deg>
                <input type="number" step="1" value="${(s.rotation[1] * RAD2DEG).toFixed(1)}" data-path="slots.${slotId}.rotation.1" data-deg>
                <input type="number" step="1" value="${(s.rotation[2] * RAD2DEG).toFixed(1)}" data-path="slots.${slotId}.rotation.2" data-deg>
            </label>
            <label>Scale
                <input type="number" step="0.05" value="${s.scale[0]}" data-path="slots.${slotId}.scale.0">
                <input type="number" step="0.05" value="${s.scale[1]}" data-path="slots.${slotId}.scale.1">
                <input type="number" step="0.05" value="${s.scale[2]}" data-path="slots.${slotId}.scale.2">
            </label>
        </div>
    `;
}

function resolvePath(snapshot, path) {
    const parts = path.split('.');
    let node = snapshot;
    for (let i = 0; i < parts.length - 1; i++) {
        const next = node[parts[i]];
        if (next === undefined || next === null) return null;
        node = next;
    }
    const key = parts[parts.length - 1];
    const idx = Number(key);
    return { parent: node, key: Number.isNaN(idx) ? key : idx };
}

function bindDetailInputs(container, seq, kf) {
    container.querySelectorAll('input[data-path]').forEach(el => {
        el.oninput = () => {
            const path = el.dataset.path;
            const isDeg = el.hasAttribute('data-deg');
            sequencer.updateKeyframe(seq.id, kf.t, (snap) => {
                const target = resolvePath(snap, path);
                if (!target) return;
                if (el.type === 'color') {
                    target.parent[target.key] = el.value;
                } else if (el.type === 'number') {
                    const raw = parseFloat(el.value);
                    if (Number.isNaN(raw)) return;
                    target.parent[target.key] = isDeg ? raw * DEG2RAD : raw;
                } else {
                    target.parent[target.key] = el.value;
                }
            });
        };
    });
}

function keyframeRow(seq, kf) {
    const key = kfKey(seq.id, kf.t);
    const isOpen = expandedKeyframes.has(key);

    const row = document.createElement('div');
    row.className = 'kf-row' + (isOpen ? ' open' : '');
    row.dataset.t = kf.t;

    row.innerHTML = `
        <div class="kf-head">
            <button class="kf-toggle">${isOpen ? '▼' : '▶'}</button>
            <input type="number" step="0.05" min="0" value="${kf.t.toFixed(2)}" class="kf-time" title="Keyframe time">
            <span class="kf-summary">${summarize(seq, kf)}</span>
            <button class="kf-duplicate" title="Duplicate this keyframe at the end of the sequence (+1s)">⧉</button>
            <button class="kf-delete" title="Delete this keyframe">×</button>
        </div>
        ${isOpen ? `<div class="kf-detail"></div>` : ''}
    `;

    row.querySelector('.kf-toggle').onclick = () => {
        if (isOpen) expandedKeyframes.delete(key);
        else expandedKeyframes.add(key);
        renderAnimationsPanel();
    };

    row.querySelector('.kf-time').onchange = (e) => {
        const newT = parseFloat(e.target.value);
        if (Number.isNaN(newT)) return;
        const oldKey = kfKey(seq.id, kf.t);
        const wasOpen = expandedKeyframes.has(oldKey);
        if (wasOpen) {
            expandedKeyframes.delete(oldKey);
            expandedKeyframes.add(kfKey(seq.id, newT));
        }
        sequencer.setKeyframeTime(seq.id, kf.t, newT);
        renderAnimationsPanel();
    };

    row.querySelector('.kf-duplicate').onclick = () => {
        const newT = sequencer.duplicateKeyframe(seq.id, kf.t);
        renderAnimationsPanel();
        if (newT != null) pulseKeyframeRow(seq.id, newT);
    };

    row.querySelector('.kf-delete').onclick = () => {
        expandedKeyframes.delete(key);
        sequencer.removeKeyframe(seq.id, kf.t);
        renderAnimationsPanel();
    };

    if (isOpen) {
        const detail = row.querySelector('.kf-detail');
        const sections = [];
        if (seq.targets.includes('liveCamera')) sections.push(liveCameraSection(kf));
        for (const target of seq.targets) {
            if (target.startsWith('light:')) sections.push(lightSection(kf, target.slice('light:'.length)));
            if (target.startsWith('slot:')) sections.push(slotSection(kf, target.slice('slot:'.length)));
        }
        if (sections.length === 0) {
            detail.innerHTML = `<div class="editor-note" style="margin:0;">
                This sequence has no targets. Add a target above to choose what to animate.
            </div>`;
        } else {
            detail.innerHTML = sections.filter(Boolean).join('');
            bindDetailInputs(detail, seq, kf);
        }
    }

    return row;
}

function targetsSection(seq) {
    const used = new Set(seq.targets);
    const all = availableTargets();
    const unused = all.filter(t => !used.has(t));
    const hasKeyframes = seq.keyframes.length > 0;
    const resetTitle = hasKeyframes
        ? 'Jump back to the value in this sequence’s first keyframe'
        : 'No keyframes yet — record one to define a home pose';

    return `
        <label>Animating:</label>
        <div class="target-list">
            ${seq.targets.map(t => `
                <span class="target-chip" data-target="${t}" title="Click to attach gizmo">
                    <span class="target-chip-label">${targetLabel(t)}</span>
                    <button class="target-reset" data-target="${t}" title="${resetTitle}" ${hasKeyframes ? '' : 'disabled'}>↺</button>
                    <button class="target-remove" data-target="${t}" title="Remove target">×</button>
                </span>
            `).join('') || `<span class="muted">No targets yet — add one below.</span>`}
        </div>
        <div class="target-add-row">
            <select class="target-add-select" ${unused.length === 0 ? 'disabled' : ''}>
                ${unused.map(t => `<option value="${t}">${targetLabel(t)}</option>`).join('')}
            </select>
            <button class="target-add-btn" ${unused.length === 0 ? 'disabled' : ''}>+ Add Target</button>
        </div>
    `;
}

function sequenceRow(spec) {
    const row = document.createElement('div');
    row.className = 'editor-row';
    row.dataset.id = spec.id;

    const events = listKnownEvents();
    const triggers = spec.triggers || [];
    const playing = sequencer.isPlaying(spec.id);

    const duration = sequencer.effectiveDuration(spec);
    const lastT = spec.keyframes.length > 0 ? Math.max(...spec.keyframes.map(k => k.t)) : -1;
    const defaultNewT = (lastT + 1).toFixed(2);

    row.innerHTML = `
        <div class="row-head">
            <input class="name-input" type="text" value="${spec.name}">
            <span class="seq-duration muted">${duration.toFixed(2)}s</span>
            <button class="play-btn">${playing ? '■ Stop' : '▶ Play'}</button>
            <button class="remove-btn">×</button>
        </div>
        <div class="row-body">
            <label>Easing
                <select class="easing-select">
                    ${EASING_NAMES.map(e => `<option value="${e}" ${e === spec.easing ? 'selected' : ''}>${e}</option>`).join('')}
                </select>
            </label>

            ${targetsSection(spec)}

            <label>Triggers:</label>
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
                <button class="add-event-btn">+ Add</button>
            </div>

            <label>Keyframes (${spec.keyframes.length}):</label>
            <div class="keyframe-list"></div>
            <div class="kf-record-row">
                <input type="number" step="0.05" min="0" value="${defaultNewT}" class="kf-new-time" placeholder="time">
                <button class="kf-record-btn" title="Snapshot the current scene at this time">● Record at time</button>
            </div>
        </div>
    `;

    // Name / Easing (duration is derived from keyframes — no input here)
    row.querySelector('.name-input').oninput = (e) => {
        sequencer.updateSequence(spec.id, { name: e.target.value });
    };
    row.querySelector('.easing-select').onchange = (e) => {
        sequencer.updateSequence(spec.id, { easing: e.target.value });
    };

    // Targets — chip body attaches the gizmo to that target.
    row.querySelectorAll('.target-chip').forEach(chip => {
        chip.onclick = (e) => {
            // Inner buttons handle their own clicks
            if (e.target.closest('.target-remove') || e.target.closest('.target-reset')) return;
            selectTarget(chip.dataset.target);
        };
    });
    row.querySelectorAll('.target-remove').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            sequencer.removeTarget(spec.id, btn.dataset.target);
            renderAnimationsPanel();
        };
    });
    row.querySelectorAll('.target-reset').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            sequencer.resetTarget(spec.id, btn.dataset.target);
            renderAnimationsPanel();
        };
    });
    const targetAddBtn = row.querySelector('.target-add-btn');
    if (targetAddBtn && !targetAddBtn.disabled) {
        targetAddBtn.onclick = () => {
            const sel = row.querySelector('.target-add-select');
            if (!sel || !sel.value) return;
            sequencer.addTarget(spec.id, sel.value);
            renderAnimationsPanel();
        };
    }

    // Triggers
    row.querySelectorAll('.trigger-list input[type="checkbox"]').forEach(cb => {
        cb.onchange = () => {
            const checked = Array.from(row.querySelectorAll('.trigger-list input:checked')).map(el => el.value);
            sequencer.updateSequence(spec.id, { triggers: checked });
        };
    });
    row.querySelector('.add-event-btn').onclick = () => {
        const input = row.querySelector('.custom-event-input');
        const val = input.value.trim();
        if (!val) return;
        const current = spec.triggers || [];
        if (!current.includes(val)) {
            sequencer.updateSequence(spec.id, { triggers: [...current, val] });
        }
        input.value = '';
        renderAnimationsPanel();
    };

    // Keyframes
    const kfList = row.querySelector('.keyframe-list');
    spec.keyframes.forEach((kf) => kfList.appendChild(keyframeRow(spec, kf)));

    // Record new keyframe
    row.querySelector('.kf-record-btn').onclick = () => {
        const t = parseFloat(row.querySelector('.kf-new-time').value);
        if (Number.isNaN(t)) return;
        sequencer.recordKeyframe(spec.id, t);
        renderAnimationsPanel();
        pulseKeyframeRow(spec.id, t);
    };

    // Play / Stop / Remove
    row.querySelector('.play-btn').onclick = () => {
        if (sequencer.isPlaying(spec.id)) {
            stopSequence(spec.id);
        } else {
            const looped = (spec.triggers || []).includes('loop');
            playSequence(spec.id, { iterationCount: looped ? Infinity : 1 });
        }
        renderAnimationsPanel();
    };
    row.querySelector('.remove-btn').onclick = () => {
        sequencer.removeSequence(spec.id);
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
        <p><strong>Workflow:</strong> create a sequence → pick the things to animate
        ("targets") → adjust the scene → click <strong>● Record at time</strong>.
        Repeat at different times. The expanded keyframe view only shows the targets
        you chose, and every value is editable.</p>
        <p>The <strong>loop</strong> trigger plays the sequence with infinite repeat.</p>
    `;
    pane.appendChild(help);

    const list = document.createElement('div');
    list.className = 'editor-list';
    sequencer.listSequences().forEach(spec => list.appendChild(sequenceRow(spec)));
    pane.appendChild(list);

    const addBar = document.createElement('div');
    addBar.className = 'add-bar';
    addBar.innerHTML = `
        <button id="addSeqBtn">+ New Sequence</button>
        <button id="stopAllBtn">■ Stop All</button>
    `;
    pane.appendChild(addBar);
    addBar.querySelector('#addSeqBtn').onclick = () => {
        // New sequences start with no targets — the user picks what to animate.
        sequencer.addSequence({ targets: [] });
        renderAnimationsPanel();
    };
    addBar.querySelector('#stopAllBtn').onclick = () => {
        sequencer.stopAll();
        renderAnimationsPanel();
    };
}
