import { sequencer, EASING_NAMES, availableTargets, captureSnapshot } from '../animation/sequencer.js';
import { listKnownEvents, playSequence, stopSequence } from '../animation/triggers.js';
import { registry, intToHex } from './registry.js';
import { selectTarget } from './editorMode.js';
import { showPath, hidePath } from './pathPreview.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

const expandedKeyframes = new Set();        // `${seqId}@${t}`
const expandedSequences = new Set();        // seq ids currently expanded

// Per-sequence "preview anchor": the scene state captured the first time the user
// expands a keyframe in that sequence. Restored when the user deselects the
// previewed keyframe. Anchors survive switching previews between keyframes in the
// same sequence, so the user always returns to the original state on close —
// "even after clicking multiple keyframes in a row".
const previewAnchors = new Map();           // seqId -> snapshot

// Which keyframe is currently driving the live preview in each sequence. Used by
// the registry-change listener so it knows where to write back edits.
const activePreview = new Map();            // seqId -> { kf, key }

// When the panel itself pushes a snapshot to the registry (on select/deselect, or
// when a kf-detail input is edited), the resulting registry events would otherwise
// loop back through the sync listener and re-capture the same values into the kf.
// Set this true around any registry write the panel initiates so the listener skips.
let suppressSync = false;

// Apply a single snapshot's values for ONE target back into the registry. This
// drives all the consequences (scene update, editor panel sync) the user expects
// when previewing/restoring a keyframe.
function applySnapshotToRegistry(snapshot, target) {
    if (!snapshot || !target) return;
    suppressSync = true;
    try {
        if (target === 'liveCamera' && snapshot.liveCamera) {
            const c = snapshot.liveCamera;
            registry.updateLiveCamera({
                position: [...c.position],
                rotation: [...c.rotation],
                fov: c.fov
            });
        } else if (target.startsWith('light:')) {
            const id = target.slice('light:'.length);
            const v = snapshot.lights?.[id];
            const cur = registry.getLight(id)?.spec;
            if (v && cur) {
                registry.updateLight(id, {
                    intensity: v.intensity,
                    color: v.color,
                    position: [...v.position],
                    target: [...v.target],
                    // Merge with existing extras so fields the snapshot doesn't track
                    // (e.g. decay, groundColor) aren't wiped.
                    extras: { ...(cur.extras || {}), ...(v.extras || {}) }
                });
            }
        } else if (target.startsWith('slot:')) {
            const id = target.slice('slot:'.length);
            const v = snapshot.slots?.[id];
            if (v) {
                registry.updateSlot(id, {
                    position: [...v.position],
                    rotation: [...v.rotation],
                    scale: [...v.scale]
                });
            }
        }
    } finally {
        suppressSync = false;
    }
}

// While a keyframe is the active preview, any registry change to its target —
// from gizmo drags, lightsPanel sliders, worldPanel inputs, etc. — is captured
// back into the keyframe's snapshot. End result: editing in preview mode edits
// the keyframe.
registry.addEventListener('change', (e) => {
    if (suppressSync) return;
    const detail = e.detail;
    if (!detail) return;
    const type = detail.type;
    if (type !== 'lights:update' && type !== 'slots:update' && type !== 'liveCamera:update') return;

    for (const [seqId, active] of activePreview) {
        const seq = sequencer.getSequence(seqId);
        if (!seq) continue;
        const target = seq.targets[0];
        if (!target) continue;

        const matches =
            (type === 'liveCamera:update' && target === 'liveCamera') ||
            (type === 'lights:update' && target === `light:${detail.id}`) ||
            (type === 'slots:update' && target === `slot:${detail.id}`);
        if (!matches) continue;

        const fresh = captureSnapshot([target]);
        sequencer.updateKeyframe(seq.id, active.kf.t, (snap) => {
            if (target === 'liveCamera') {
                snap.liveCamera = fresh.liveCamera;
            } else if (target.startsWith('light:')) {
                const id = target.slice('light:'.length);
                snap.lights = snap.lights || {};
                snap.lights[id] = fresh.lights[id];
            } else if (target.startsWith('slot:')) {
                const id = target.slice('slot:'.length);
                snap.slots = snap.slots || {};
                snap.slots[id] = fresh.slots[id];
            }
        });
    }
});

// Playback bypasses preview state; if a sequence starts playing or gets removed,
// drop its anchor + active preview so we don't restore a stale snapshot later,
// and tear down any path visualization it had.
sequencer.addEventListener('seq:play', (e) => {
    previewAnchors.delete(e.detail.id);
    activePreview.delete(e.detail.id);
    hidePath(e.detail.id);
});
sequencer.addEventListener('seq:remove', (e) => {
    previewAnchors.delete(e.detail.id);
    activePreview.delete(e.detail.id);
    hidePath(e.detail.id);
});

// Keep the path in sync as the user edits the previewed keyframe (gizmo drag or
// kf-detail input both flow through here via seq:update).
sequencer.addEventListener('seq:update', (e) => {
    const seqId = e.detail.id;
    const active = activePreview.get(seqId);
    if (!active) return;
    const seq = sequencer.getSequence(seqId);
    if (!seq) return;
    // The keyframe array stays sorted, so the previous keyframe is the one at
    // the prior index. Look up by time (active.kf may be a stale reference if
    // it's been replaced via updateSequence/duplicateKeyframe).
    const idx = seq.keyframes.findIndex(k => Math.abs(k.t - active.kf.t) < 0.001);
    if (idx < 0) return;
    const currentKf = seq.keyframes[idx];
    const prevKf = idx > 0 ? seq.keyframes[idx - 1] : null;
    showPath(seq, currentKf, prevKf);
});

function findPrevKf(seq, kf) {
    const idx = seq.keyframes.findIndex(k => Math.abs(k.t - kf.t) < 0.001);
    return idx > 0 ? seq.keyframes[idx - 1] : null;
}

function kfKey(seqId, t) { return `${seqId}@${t.toFixed(3)}`; }

function selectKeyframePreview(seq, kf, key) {
    // Close any other expanded keyframe in this same sequence (preview is exclusive
    // per sequence; the anchor we captured on the first open stays put).
    for (const other of seq.keyframes) {
        const k = kfKey(seq.id, other.t);
        if (k !== key) expandedKeyframes.delete(k);
    }
    // Capture the anchor only on the first open per sequence. Subsequent switches
    // between keyframes keep this same anchor so deselecting always returns here.
    if (!previewAnchors.has(seq.id)) {
        previewAnchors.set(seq.id, captureSnapshot(seq.targets));
    }
    expandedKeyframes.add(key);
    // Push the snapshot through the registry so the editor panels reflect the
    // previewed state and any subsequent panel/gizmo edits naturally write back
    // into the keyframe via the registry-change listener.
    applySnapshotToRegistry(kf.snapshot, seq.targets[0]);
    activePreview.set(seq.id, { kf, key });
    // Visualize the path from the previous keyframe to this one.
    showPath(seq, kf, findPrevKf(seq, kf));
    // Attach the gizmo to the target so the user can manipulate the previewed
    // object immediately. Done last so the TransformControls "change" event the
    // attach fires sees the object already at the snapshot pose.
    selectTarget(seq.targets[0]);
}

function deselectKeyframePreview(seq, key) {
    expandedKeyframes.delete(key);
    // Stop accepting edits into this keyframe BEFORE we restore — otherwise the
    // restore's registry events would loop into it (the suppress flag belt-and-
    // suspenders this too, but clearing here keeps intent obvious).
    activePreview.delete(seq.id);
    hidePath(seq.id);
    const anchor = previewAnchors.get(seq.id);
    if (anchor) applySnapshotToRegistry(anchor, seq.targets[0]);
    previewAnchors.delete(seq.id);
}

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

// Brief "what changed since the previous keyframe" line shown under each collapsed
// keyframe head. For the first keyframe (no prevKf) the line shows the starting
// values instead. Sequences are single-target since the recent rework, so this only
// inspects seq.targets[0].
const DIFF_EPS = 0.001;
function arraysDiffer(a, b, eps = DIFF_EPS) {
    if (!a || !b) return a !== b;
    if (a.length !== b.length) return true;
    return a.some((v, i) => Math.abs(v - b[i]) > eps);
}
function fmtVec(v, digits = 1) {
    return `(${v.map(x => x.toFixed(digits)).join(',')})`;
}
function fmtVecDeg(v) {
    return `(${v.map(x => (x * RAD2DEG).toFixed(0)).join(',')})°`;
}

function diffSummary(seq, kf, prevKf) {
    const target = seq.targets[0];
    if (!target) return '';
    const cur = kf.snapshot;
    const prev = prevKf?.snapshot;
    const parts = [];

    if (target === 'liveCamera') {
        const c = cur.liveCamera;
        if (!c) return '';
        const p = prev?.liveCamera;
        if (!p) return `start · pos ${fmtVec(c.position)} · fov ${Math.round(c.fov)}`;
        if (arraysDiffer(c.position, p.position)) parts.push(`pos ${fmtVec(c.position)}`);
        if (arraysDiffer(c.rotation, p.rotation)) parts.push(`rot ${fmtVecDeg(c.rotation)}`);
        if (Math.abs(c.fov - p.fov) > 0.5) parts.push(`fov ${Math.round(c.fov)}`);
    } else if (target.startsWith('light:')) {
        const id = target.slice('light:'.length);
        const c = cur.lights?.[id];
        if (!c) return '';
        const p = prev?.lights?.[id];
        if (!p) return `start · int ${c.intensity.toFixed(2)} · col ${c.color}`;
        if (Math.abs((c.intensity ?? 0) - (p.intensity ?? 0)) > DIFF_EPS) parts.push(`int ${c.intensity.toFixed(2)}`);
        if (c.color !== p.color) parts.push(`col ${c.color}`);
        if (arraysDiffer(c.position, p.position)) parts.push(`pos ${fmtVec(c.position)}`);
        if (arraysDiffer(c.target, p.target)) parts.push(`tgt ${fmtVec(c.target)}`);
    } else if (target.startsWith('slot:')) {
        const id = target.slice('slot:'.length);
        const c = cur.slots?.[id];
        if (!c) return '';
        const p = prev?.slots?.[id];
        if (!p) return `start · pos ${fmtVec(c.position)}`;
        if (arraysDiffer(c.position, p.position)) parts.push(`pos ${fmtVec(c.position)}`);
        if (arraysDiffer(c.rotation, p.rotation)) parts.push(`rot ${fmtVecDeg(c.rotation)}`);
        if (arraysDiffer(c.scale, p.scale, 0.005)) parts.push(`scl ${fmtVec(c.scale, 2)}`);
    }

    return parts.length ? parts.join(' · ') : 'no change';
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
                <input type="number" step="1" min="0" value="${l.intensity}" data-path="lights.${lightId}.intensity">
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
            // If this keyframe is currently the live preview, push the updated
            // snapshot through the registry so the scene and the other editor
            // panels reflect the change in real time.
            const active = activePreview.get(seq.id);
            if (active && active.kf === kf) {
                applySnapshotToRegistry(kf.snapshot, seq.targets[0]);
            }
        };
    });
}

function keyframeRow(seq, kf, prevKf) {
    const key = kfKey(seq.id, kf.t);
    const isOpen = expandedKeyframes.has(key);

    const row = document.createElement('div');
    row.className = 'kf-row' + (isOpen ? ' open' : '');
    row.dataset.t = kf.t;

    row.innerHTML = `
        <div class="kf-head">
            <input type="number" step="0.05" min="0" value="${kf.t.toFixed(2)}" class="kf-time" title="Keyframe time">
            <span class="kf-head-spacer"></span>
            <button class="kf-duplicate" title="Duplicate this keyframe at the end of the sequence (+1s)">⧉</button>
            <button class="kf-delete" title="Delete this keyframe">×</button>
        </div>
        ${isOpen
            ? `<div class="kf-detail"></div>`
            : `<div class="kf-diff">${diffSummary(seq, kf, prevKf)}</div>`}
    `;

    // Collapsed: the whole row is the click target — clicking anywhere expands
    // and previews. Expanded: only the head bar collapses, so clicks on labels /
    // section titles inside the detail body don't accidentally close the row.
    if (isOpen) {
        row.querySelector('.kf-head').onclick = (e) => {
            if (e.target.closest('input, button')) return;
            deselectKeyframePreview(seq, key);
            renderAnimationsPanel();
        };
    } else {
        row.onclick = (e) => {
            if (e.target.closest('input, button')) return;
            selectKeyframePreview(seq, kf, key);
            renderAnimationsPanel();
        };
    }

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
        // If this keyframe was being previewed, restoring the anchor first leaves
        // the scene in a sensible state after the delete; otherwise we'd be stuck
        // showing a now-removed keyframe.
        if (expandedKeyframes.has(key)) deselectKeyframePreview(seq, key);
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
        // Easing select controls the curve this keyframe uses to transition to the
        // NEXT keyframe ("ease out of here"). The last keyframe's value is unused
        // but kept around so the dropdown isn't a flicker-state when keyframes are
        // appended later.
        const currentEasing = kf.easing || 'cubicInOut';
        const easingRow = `
            <label class="kf-easing-row" title="Curve used from this keyframe to the next">Easing (to next)
                <select class="kf-easing-select">
                    ${EASING_NAMES.map(e => `<option value="${e}" ${e === currentEasing ? 'selected' : ''}>${e}</option>`).join('')}
                </select>
            </label>
        `;
        if (sections.length === 0) {
            detail.innerHTML = easingRow + `<div class="editor-note" style="margin:0;">
                This sequence has no targets. Add a target above to choose what to animate.
            </div>`;
        } else {
            detail.innerHTML = easingRow + sections.filter(Boolean).join('');
            bindDetailInputs(detail, seq, kf);
        }
        const easingSelect = detail.querySelector('.kf-easing-select');
        if (easingSelect) {
            easingSelect.onchange = () => {
                sequencer.setKeyframeEasing(seq.id, kf.t, easingSelect.value);
            };
        }
    }

    return row;
}

function targetSection(seq) {
    const target = seq.targets[0];
    const hasKeyframes = seq.keyframes.length > 0;
    const resetTitle = hasKeyframes
        ? 'Jump back to the value in this sequence’s first keyframe'
        : 'No keyframes yet — record one to define a home pose';

    // Target is locked once the sequence is created — to change it, delete this
    // sequence and add a new one (saves a lot of "what does it mean to swap" UX).
    if (!target) {
        return `
            <label>Animating:</label>
            <div class="target-list">
                <span class="muted">No target — recreate the sequence to pick one.</span>
            </div>
        `;
    }

    return `
        <label>Animating:</label>
        <div class="target-list">
            <span class="target-chip" data-target="${target}" title="Click to attach gizmo">
                <span class="target-chip-label">${targetLabel(target)}</span>
                <button class="target-reset" data-target="${target}" title="${resetTitle}" ${hasKeyframes ? '' : 'disabled'}>↺</button>
            </span>
        </div>
    `;
}

function sequenceRow(spec) {
    const row = document.createElement('div');
    const isExpanded = expandedSequences.has(spec.id);
    row.className = 'editor-row seq-row' + (isExpanded ? ' open' : '');
    row.dataset.id = spec.id;

    const events = listKnownEvents();
    const triggers = spec.triggers || [];
    const stopTriggers = spec.stopTriggers || [];
    const isLoop = !!spec.loop;
    const playing = sequencer.isPlaying(spec.id);

    const duration = sequencer.effectiveDuration(spec);
    const lastT = spec.keyframes.length > 0 ? Math.max(...spec.keyframes.map(k => k.t)) : -1;
    const defaultNewT = (lastT + 1).toFixed(2);
    const targetSummary = spec.targets[0] ? targetLabel(spec.targets[0]) : 'no target';

    const pillsHtml = (list) => list.length === 0
        ? '<span class="muted">none</span>'
        : list.map(t => `<span class="trigger-mini">${t}</span>`).join('');

    // Pill grid HTML — separate `kind` so the wire-up below can route each
    // checkbox to spec.triggers vs spec.stopTriggers via data-kind.
    const triggerPills = (kind, current) => events.map(e => `
        <label class="trigger-pill">
            <input type="checkbox" data-kind="${kind}" value="${e}" ${current.includes(e) ? 'checked' : ''}>
            ${e}
        </label>
    `).join('');

    row.innerHTML = `
        <div class="row-head">
            <input class="name-input" type="text" value="${spec.name}">
            <span class="seq-duration muted">${duration.toFixed(2)}s</span>
            <button class="play-btn" title="${playing ? 'Stop' : 'Play'}">${playing ? '■' : '▶'}</button>
            <button class="duplicate-btn" title="Duplicate this sequence">⧉</button>
            <button class="remove-btn" title="Delete this sequence">×</button>
        </div>
        ${isExpanded ? `
        <div class="row-body">
            ${targetSection(spec)}

            <label class="loop-row">
                <input type="checkbox" class="loop-toggle" ${isLoop ? 'checked' : ''}>
                Loop
            </label>

            <label>${isLoop ? 'Start triggers:' : 'Triggers:'}</label>
            <div class="trigger-list" data-kind="triggers">
                ${triggerPills('triggers', triggers)}
            </div>

            ${isLoop ? `
            <label>Stop triggers:</label>
            <div class="trigger-list" data-kind="stopTriggers">
                ${triggerPills('stopTriggers', stopTriggers)}
            </div>` : ''}

            <label>Keyframes (${spec.keyframes.length}):</label>
            <div class="keyframe-list"></div>
            <div class="kf-record-row">
                <input type="number" step="0.05" min="0" value="${defaultNewT}" class="kf-new-time" placeholder="time">
                <button class="kf-record-btn" title="Snapshot the current scene at this time">● Record at time</button>
            </div>
        </div>`
        : `
        <div class="seq-summary">
            <div class="seq-target-line">
                ${targetSummary}${isLoop ? ' <span class="seq-loop-tag">loop</span>' : ''}
            </div>
            <div class="seq-trigger-line">
                <span class="seq-trigger-label">${isLoop ? 'start' : 'on'}:</span>
                ${pillsHtml(triggers)}
            </div>
            ${isLoop ? `
            <div class="seq-trigger-line">
                <span class="seq-trigger-label">stop:</span>
                ${pillsHtml(stopTriggers)}
            </div>` : ''}
        </div>`}
    `;

    // Collapsed: the whole row acts as a click target — clicking anywhere expands.
    // Expanded: only clicks on the head bar collapse, so clicks inside the body
    // (keyframe rows, trigger pills, labels…) don't bubble up and accidentally
    // close the sequence.
    if (isExpanded) {
        row.querySelector('.row-head').onclick = (e) => {
            if (e.target.closest('input, button')) return;
            expandedSequences.delete(spec.id);
            renderAnimationsPanel();
        };
    } else {
        row.onclick = (e) => {
            if (e.target.closest('input, button')) return;
            expandedSequences.add(spec.id);
            renderAnimationsPanel();
        };
    }

    // Name lives in the row-head — always present.
    row.querySelector('.name-input').oninput = (e) => {
        sequencer.updateSequence(spec.id, { name: e.target.value });
    };

    // Play / Duplicate / Remove also live in the row-head.
    row.querySelector('.play-btn').onclick = () => {
        if (sequencer.isPlaying(spec.id)) {
            stopSequence(spec.id);
        } else {
            playSequence(spec.id, { iterationCount: spec.loop ? Infinity : 1 });
        }
        renderAnimationsPanel();
    };
    row.querySelector('.duplicate-btn').onclick = () => {
        const newId = sequencer.duplicateSequence(spec.id);
        if (newId) expandedSequences.add(newId);
        renderAnimationsPanel();
    };
    row.querySelector('.remove-btn').onclick = () => {
        expandedSequences.delete(spec.id);
        sequencer.removeSequence(spec.id);
        renderAnimationsPanel();
    };

    if (!isExpanded) return row;

    // Target chip: body attaches the gizmo; reset jumps back to the first keyframe.
    row.querySelectorAll('.target-chip').forEach(chip => {
        chip.onclick = (e) => {
            if (e.target.closest('.target-reset')) return;
            selectTarget(chip.dataset.target);
        };
    });
    row.querySelectorAll('.target-reset').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            sequencer.resetTarget(spec.id, btn.dataset.target);
            renderAnimationsPanel();
        };
    });

    // Loop toggle — re-renders because flipping it shows/hides the stop-triggers UI.
    row.querySelector('.loop-toggle').onchange = (e) => {
        sequencer.updateSequence(spec.id, { loop: e.target.checked });
        renderAnimationsPanel();
    };

    // Start + stop trigger checkboxes are routed by data-kind. Each list owns
    // exactly the seq field of the same name (triggers / stopTriggers).
    row.querySelectorAll('.trigger-list input[type="checkbox"]').forEach(cb => {
        cb.onchange = () => {
            const kind = cb.dataset.kind;
            const checked = Array.from(
                row.querySelectorAll(`.trigger-list input[type="checkbox"][data-kind="${kind}"]:checked`)
            ).map(el => el.value);
            sequencer.updateSequence(spec.id, { [kind]: checked });
        };
    });

    // Keyframes — pass the prior keyframe so each row can render a diff line.
    const kfList = row.querySelector('.keyframe-list');
    spec.keyframes.forEach((kf, i) => {
        const prevKf = i > 0 ? spec.keyframes[i - 1] : null;
        kfList.appendChild(keyframeRow(spec, kf, prevKf));
    });

    // Record new keyframe
    row.querySelector('.kf-record-btn').onclick = () => {
        const t = parseFloat(row.querySelector('.kf-new-time').value);
        if (Number.isNaN(t)) return;
        sequencer.recordKeyframe(spec.id, t);
        renderAnimationsPanel();
        pulseKeyframeRow(spec.id, t);
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
        <p><strong>Experimental:</strong> this feature is still in development and
        may misbehave or change between updates.</p>
    `;
    pane.appendChild(help);

    const list = document.createElement('div');
    list.className = 'editor-list';
    sequencer.listSequences().forEach(spec => list.appendChild(sequenceRow(spec)));
    pane.appendChild(list);

    const allTargets = availableTargets();
    const addBar = document.createElement('div');
    addBar.className = 'add-bar';
    addBar.innerHTML = `
        <select id="newSeqTarget" ${allTargets.length === 0 ? 'disabled' : ''}>
            ${allTargets.map(t => `<option value="${t}">${targetLabel(t)}</option>`).join('')}
        </select>
        <button id="addSeqBtn" ${allTargets.length === 0 ? 'disabled' : ''}>+ New Sequence</button>
        <button id="stopAllBtn">■ Stop All</button>
    `;
    pane.appendChild(addBar);
    addBar.querySelector('#addSeqBtn').onclick = () => {
        const target = addBar.querySelector('#newSeqTarget').value;
        if (!target) return;
        const id = sequencer.addSequence({ target });
        // Seed a keyframe at t=0 from the target's current state so the sequence
        // has somewhere to interpolate from, and attach the gizmo to the chosen
        // target so the user can immediately adjust toward the next keyframe.
        sequencer.recordKeyframe(id, 0);
        selectTarget(target);
        expandedSequences.add(id);
        renderAnimationsPanel();
    };
    addBar.querySelector('#stopAllBtn').onclick = () => {
        sequencer.stopAll();
        renderAnimationsPanel();
    };
}
