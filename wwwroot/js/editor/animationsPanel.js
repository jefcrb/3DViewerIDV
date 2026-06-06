import { sequencer, EASING_NAMES, availableTargets, captureSnapshot } from '../animation/sequencer.js';
import { listKnownEvents, playSequence, stopSequence } from '../animation/triggers.js';
import { registry, intToHex } from './registry.js';
import { selectTarget } from './editorMode.js';
import { showPath, hidePath } from './pathPreview.js';
import { t } from '../i18n.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

const expandedKeyframes = new Set();        // `${seqId}@${t}`
const expandedSequences = new Set();        // seq ids currently expanded

// Captured on first keyframe-expand in a sequence; restored on deselect so previews are reversible.
const previewAnchors = new Map();           // seqId -> snapshot

const activePreview = new Map();            // seqId -> { kf, key }

// Set while the panel writes to the registry, to skip the sync listener and avoid feedback loops.
let suppressSync = false;

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
                    // Merge to keep untracked extras (decay, groundColor, …) intact.
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

// While a keyframe is being previewed, scene edits get written back into its snapshot.
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

// Playback or removal invalidates preview state; drop it so we don't restore a stale snapshot.
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

sequencer.addEventListener('seq:update', (e) => {
    const seqId = e.detail.id;
    const active = activePreview.get(seqId);
    if (!active) return;
    const seq = sequencer.getSequence(seqId);
    if (!seq) return;
    // Look up by time — active.kf may be a stale reference after updateSequence/duplicateKeyframe.
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
    // Preview is exclusive per sequence.
    for (const other of seq.keyframes) {
        const k = kfKey(seq.id, other.t);
        if (k !== key) expandedKeyframes.delete(k);
    }
    // Anchor is captured once and preserved across keyframe switches in the same sequence.
    if (!previewAnchors.has(seq.id)) {
        previewAnchors.set(seq.id, captureSnapshot(seq.targets));
    }
    expandedKeyframes.add(key);
    applySnapshotToRegistry(kf.snapshot, seq.targets[0]);
    activePreview.set(seq.id, { kf, key });
    showPath(seq, kf, findPrevKf(seq, kf));
    // selectTarget last so TransformControls' attach event sees the object already posed.
    selectTarget(seq.targets[0]);
}

function deselectKeyframePreview(seq, key) {
    expandedKeyframes.delete(key);
    // Clear active BEFORE the restore writes so registry events don't write back into the kf.
    activePreview.delete(seq.id);
    hidePath(seq.id);
    const anchor = previewAnchors.get(seq.id);
    if (anchor) applySnapshotToRegistry(anchor, seq.targets[0]);
    previewAnchors.delete(seq.id);
}

// Defers via setTimeout 0 so cascading renders complete before adding the pulse class.
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
    const start = t('animations.startPrefix');

    if (target === 'liveCamera') {
        const c = cur.liveCamera;
        if (!c) return '';
        const p = prev?.liveCamera;
        if (!p) return `${start} · pos ${fmtVec(c.position)} · fov ${Math.round(c.fov)}`;
        if (arraysDiffer(c.position, p.position)) parts.push(`pos ${fmtVec(c.position)}`);
        if (arraysDiffer(c.rotation, p.rotation)) parts.push(`rot ${fmtVecDeg(c.rotation)}`);
        if (Math.abs(c.fov - p.fov) > 0.5) parts.push(`fov ${Math.round(c.fov)}`);
    } else if (target.startsWith('light:')) {
        const id = target.slice('light:'.length);
        const c = cur.lights?.[id];
        if (!c) return '';
        const p = prev?.lights?.[id];
        if (!p) return `${start} · int ${c.intensity.toFixed(2)} · col ${c.color}`;
        if (Math.abs((c.intensity ?? 0) - (p.intensity ?? 0)) > DIFF_EPS) parts.push(`int ${c.intensity.toFixed(2)}`);
        if (c.color !== p.color) parts.push(`col ${c.color}`);
        if (arraysDiffer(c.position, p.position)) parts.push(`pos ${fmtVec(c.position)}`);
        if (arraysDiffer(c.target, p.target)) parts.push(`tgt ${fmtVec(c.target)}`);
    } else if (target.startsWith('slot:')) {
        const id = target.slice('slot:'.length);
        const c = cur.slots?.[id];
        if (!c) return '';
        const p = prev?.slots?.[id];
        if (!p) return `${start} · pos ${fmtVec(c.position)}`;
        if (arraysDiffer(c.position, p.position)) parts.push(`pos ${fmtVec(c.position)}`);
        if (arraysDiffer(c.rotation, p.rotation)) parts.push(`rot ${fmtVecDeg(c.rotation)}`);
        if (arraysDiffer(c.scale, p.scale, 0.005)) parts.push(`scl ${fmtVec(c.scale, 2)}`);
    }

    return parts.length ? parts.join(' · ') : t('animations.noChange');
}

function liveCameraSection(kf) {
    const c = kf.snapshot.liveCamera;
    if (!c) return '';
    return `
        <div class="kf-section">
            <div class="kf-section-title">${t('cameras.live')}</div>
            <label>${t('cameras.position')}
                <input type="number" step="0.1" value="${c.position[0]}" data-path="liveCamera.position.0">
                <input type="number" step="0.1" value="${c.position[1]}" data-path="liveCamera.position.1">
                <input type="number" step="0.1" value="${c.position[2]}" data-path="liveCamera.position.2">
            </label>
            <label>${t('cameras.rotationDeg')}
                <input type="number" step="1" value="${(c.rotation[0] * RAD2DEG).toFixed(1)}" data-path="liveCamera.rotation.0" data-deg>
                <input type="number" step="1" value="${(c.rotation[1] * RAD2DEG).toFixed(1)}" data-path="liveCamera.rotation.1" data-deg>
                <input type="number" step="1" value="${(c.rotation[2] * RAD2DEG).toFixed(1)}" data-path="liveCamera.rotation.2" data-deg>
            </label>
            <label>${t('cameras.fov')}
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
            <label>${t('lights.intensity')}
                <input type="number" step="1" min="0" value="${l.intensity}" data-path="lights.${lightId}.intensity">
            </label>
            <label>${t('lights.color')}
                <input type="color" value="${colorToHex(l.color)}" data-path="lights.${lightId}.color">
            </label>
            ${showPos ? `
            <label>${t('cameras.position')}
                <input type="number" step="0.1" value="${l.position[0]}" data-path="lights.${lightId}.position.0">
                <input type="number" step="0.1" value="${l.position[1]}" data-path="lights.${lightId}.position.1">
                <input type="number" step="0.1" value="${l.position[2]}" data-path="lights.${lightId}.position.2">
            </label>
            <label>${t('lights.target')}
                <input type="number" step="0.1" value="${l.target[0]}" data-path="lights.${lightId}.target.0">
                <input type="number" step="0.1" value="${l.target[1]}" data-path="lights.${lightId}.target.1">
                <input type="number" step="0.1" value="${l.target[2]}" data-path="lights.${lightId}.target.2">
            </label>` : ''}
            ${isSpot ? `
            <label>${t('lights.angle')}°
                <input type="number" step="1" min="0" max="90" value="${((l.extras?.angle ?? 0) * RAD2DEG).toFixed(1)}" data-path="lights.${lightId}.extras.angle" data-deg>
            </label>
            <label>${t('lights.penumbra')}
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
            <label>${t('characters.position')}
                <input type="number" step="0.1" value="${s.position[0]}" data-path="slots.${slotId}.position.0">
                <input type="number" step="0.1" value="${s.position[1]}" data-path="slots.${slotId}.position.1">
                <input type="number" step="0.1" value="${s.position[2]}" data-path="slots.${slotId}.position.2">
            </label>
            <label>${t('characters.rotation')}°
                <input type="number" step="1" value="${(s.rotation[0] * RAD2DEG).toFixed(1)}" data-path="slots.${slotId}.rotation.0" data-deg>
                <input type="number" step="1" value="${(s.rotation[1] * RAD2DEG).toFixed(1)}" data-path="slots.${slotId}.rotation.1" data-deg>
                <input type="number" step="1" value="${(s.rotation[2] * RAD2DEG).toFixed(1)}" data-path="slots.${slotId}.rotation.2" data-deg>
            </label>
            <label>${t('characters.scale')}
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
            // If this keyframe is the live preview, push the change through the registry too.
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
            <input type="number" step="0.05" min="0" value="${kf.t.toFixed(2)}" class="kf-time" title="${t('animations.keyframeTime')}">
            <span class="kf-head-spacer"></span>
            <button class="kf-duplicate" title="${t('animations.duplicateKf')}">⧉</button>
            <button class="kf-delete" title="${t('animations.deleteKf')}">×</button>
        </div>
        ${isOpen
            ? `<div class="kf-detail"></div>`
            : `<div class="kf-diff">${diffSummary(seq, kf, prevKf)}</div>`}
    `;

    // Click on body when expanded must not collapse — only the head bar toggles.
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
        // Restore the anchor before deleting so the scene doesn't get stuck on a removed kf.
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
        // Easing controls how this keyframe transitions to the NEXT one (ease out).
        const currentEasing = kf.easing || 'cubicInOut';
        const easingRow = `
            <label class="kf-easing-row" title="${t('animations.easingTooltip')}">${t('animations.easingToNext')}
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
        ? t('animations.resetTitle')
        : t('animations.noKeyframesYet');

    // Target is locked at sequence creation; to retarget, delete and recreate.
    if (!target) {
        return `
            <label>${t('animations.animating')}</label>
            <div class="target-list">
                <span class="muted">${t('animations.noTarget')}</span>
            </div>
        `;
    }

    return `
        <label>${t('animations.animating')}</label>
        <div class="target-list">
            <span class="target-chip" data-target="${target}" title="${t('animations.attachGizmo')}">
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
        ? `<span class="muted">${t('animations.none')}</span>`
        : list.map(s => `<span class="trigger-mini">${s}</span>`).join('');

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
            <button class="play-btn" title="${playing ? t('animations.stopTitle') : t('animations.playTitle')}">${playing ? '■' : '▶'}</button>
            <button class="duplicate-btn" title="${t('animations.duplicateSeq')}">⧉</button>
            <button class="remove-btn" title="${t('animations.deleteSeq')}">×</button>
        </div>
        ${isExpanded ? `
        <div class="row-body">
            ${targetSection(spec)}

            <label class="loop-row">
                <input type="checkbox" class="loop-toggle" ${isLoop ? 'checked' : ''}>
                ${t('animations.loop')}
            </label>

            <label>${isLoop ? t('animations.startTriggers') : t('animations.triggers')}</label>
            <div class="trigger-list" data-kind="triggers">
                ${triggerPills('triggers', triggers)}
            </div>

            ${isLoop ? `
            <label>${t('animations.stopTriggers')}</label>
            <div class="trigger-list" data-kind="stopTriggers">
                ${triggerPills('stopTriggers', stopTriggers)}
            </div>` : ''}

            <label>${t('animations.keyframes')} (${spec.keyframes.length}):</label>
            <div class="keyframe-list"></div>
            <div class="kf-record-row">
                <input type="number" step="0.05" min="0" value="${defaultNewT}" class="kf-new-time" placeholder="time">
                <button class="kf-record-btn" title="${t('animations.recordAtTimeTitle')}">${t('animations.recordAtTime')}</button>
            </div>
        </div>`
        : `
        <div class="seq-summary">
            <div class="seq-target-line">
                ${targetSummary}${isLoop ? ` <span class="seq-loop-tag">${t('animations.loopTag')}</span>` : ''}
            </div>
            <div class="seq-trigger-line">
                <span class="seq-trigger-label">${(isLoop ? t('animations.start') : t('animations.on'))}:</span>
                ${pillsHtml(triggers)}
            </div>
            ${isLoop ? `
            <div class="seq-trigger-line">
                <span class="seq-trigger-label">${t('animations.stop')}:</span>
                ${pillsHtml(stopTriggers)}
            </div>` : ''}
        </div>`}
    `;

    // Click on body when expanded must not collapse — only the head bar toggles.
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

    row.querySelector('.name-input').oninput = (e) => {
        sequencer.updateSequence(spec.id, { name: e.target.value });
    };

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

    // Re-renders because the loop flag shows/hides the stop-triggers UI.
    row.querySelector('.loop-toggle').onchange = (e) => {
        sequencer.updateSequence(spec.id, { loop: e.target.checked });
        renderAnimationsPanel();
    };

    row.querySelectorAll('.trigger-list input[type="checkbox"]').forEach(cb => {
        cb.onchange = () => {
            const kind = cb.dataset.kind;
            const checked = Array.from(
                row.querySelectorAll(`.trigger-list input[type="checkbox"][data-kind="${kind}"]:checked`)
            ).map(el => el.value);
            sequencer.updateSequence(spec.id, { [kind]: checked });
        };
    });

    const kfList = row.querySelector('.keyframe-list');
    spec.keyframes.forEach((kf, i) => {
        const prevKf = i > 0 ? spec.keyframes[i - 1] : null;
        kfList.appendChild(keyframeRow(spec, kf, prevKf));
    });

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
    help.innerHTML = `<p>${t('animations.experimental')}</p>`;
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
            ${allTargets.map(target => `<option value="${target}">${targetLabel(target)}</option>`).join('')}
        </select>
        <button id="addSeqBtn" ${allTargets.length === 0 ? 'disabled' : ''}>${t('animations.newSequence')}</button>
        <button id="stopAllBtn">${t('animations.stopAll')}</button>
    `;
    pane.appendChild(addBar);
    addBar.querySelector('#addSeqBtn').onclick = () => {
        const target = addBar.querySelector('#newSeqTarget').value;
        if (!target) return;
        const id = sequencer.addSequence({ target });
        // Seed an initial keyframe so the sequence has somewhere to interpolate from.
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
