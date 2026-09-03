import { sequencer, EASING_NAMES, ease, availableTargets, captureSnapshot, applySnapshot as applySnapshotToScene } from '../animation/sequencer.js';
import { clipManager } from '../animation/clips.js';
import { listKnownEvents, eventLabel, playSequence, stopSequence, playClip, stopClip } from '../animation/triggers.js';
import { registry, intToHex } from './registry.js';
import { selectTarget } from './editorMode.js';
import { getEditorCameraRef } from './cameraPanel.js';
import { showPath, hidePath } from './pathPreview.js';
import { t } from '../i18n.js';
import { bindingSelectHtml, effectiveColor } from './colorBinding.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

const PROP_COLORS = {
    position: '#4a9eff',
    rotation: '#4ade80',
    scale: '#a78bfa',
    fov: '#fbbf24',
    intensity: '#fb923c',
    color: '#f87171',
    target: '#22d3ee',
    extras: '#a3a3a3'
};

const expandedKeyframes = new Set();        // kf references (survives duplicate-t)
const expandedSequences = new Set();        // seq ids currently expanded
const expandedClips = new Set();            // clip names currently expanded

// Captured on first keyframe-expand in a sequence; restored on deselect so previews are reversible.
const previewAnchors = new Map();           // seqId -> snapshot

const activePreview = new Map();            // seqId -> { kf, key }

let scrubId = null;
let scrubBarEl = null;
let scrubSelectedT = null;   // t of the currently-selected keyframe (fallback lookup)
let scrubSelectedKf = null;  // reference to the actual selected kf (survives duplicate ts)
let scrubCurrentT = 0;       // playhead time
let scrubPlayRafId = null;   // RAF id while the playhead follows a running sequence
let scrubGizmoOn = false;    // whether we've attached the gizmo/preview to a kf

let scrubSelectedTrackEntry = null;  // { trackKey, t } | null
let scrubClipboard = null;           // { trackKey, value, easing } | null

const SCRUB_SNAP = 0.1;
// Prevents fresh/short sequences from collapsing to a hairline strip.
const MIN_DISPLAY_DURATION = 5;
function scrubDisplayDuration(seq) {
    const actual = sequencer.effectiveDuration(seq);
    return Math.max(actual, MIN_DISPLAY_DURATION);
}
function snapT(t, shift) {
    if (shift) return Math.max(0, t);
    return Math.max(0, Math.round(t / SCRUB_SNAP) * SCRUB_SNAP);
}

function openScrubBar(id) {
    if (scrubId === id) return;
    closeScrubBar();
    scrubId = id;
    scrubSelectedT = null;
    scrubSelectedKf = null;
    scrubCurrentT = 0;
    scrubGizmoOn = false;
    scrubBarEl = document.createElement('div');
    scrubBarEl.className = 'sequence-scrub-bar';
    document.body.appendChild(scrubBarEl);
    renderScrubBar();
    sequencer.addEventListener('seq:update', onScrubSeqUpdate);
    sequencer.addEventListener('seq:remove', onScrubSeqRemove);
    sequencer.addEventListener('seq:play', onScrubSeqPlay);
    sequencer.addEventListener('seq:stop', onScrubSeqStop);
    document.addEventListener('keydown', onScrubKeyDown);
}

function closeScrubBar() {
    if (!scrubBarEl) return;
    closeScrubContextMenu();
    closeScrubEasingPicker();
    stopPlayheadFollow();
    scrubDetachGizmo();
    scrubBarEl.remove();
    scrubBarEl = null;
    scrubId = null;
    scrubSelectedT = null;
    scrubSelectedKf = null;
    sequencer.removeEventListener('seq:update', onScrubSeqUpdate);
    sequencer.removeEventListener('seq:remove', onScrubSeqRemove);
    sequencer.removeEventListener('seq:play', onScrubSeqPlay);
    sequencer.removeEventListener('seq:stop', onScrubSeqStop);
    document.removeEventListener('keydown', onScrubKeyDown);
}

function onScrubSeqUpdate(e) {
    if (e.detail?.id === scrubId) renderScrubBar();
}
function onScrubSeqRemove(e) {
    if (e.detail?.id === scrubId) {
        closeScrubBar();
        renderAnimationsPanel();
    }
}
function onScrubSeqPlay(e) {
    if (e.detail?.id !== scrubId) return;
    // Detach gizmo so it doesn't chase the moving target; selection stays for resume-on-pause.
    scrubDetachGizmo();
    startPlayheadFollow();
    renderScrubBar();
}
function onScrubSeqStop(e) {
    if (e.detail?.id !== scrubId) return;
    stopPlayheadFollow();
    renderScrubBar();
    const seq = sequencer.getSequence(scrubId);
    const kf = seq && currentSelectedKf(seq);
    if (kf) scrubAttachGizmoTo(seq, kf);
}

function startPlayheadFollow() {
    stopPlayheadFollow();
    const tick = () => {
        if (!scrubId) return;
        const runner = sequencer.active.get(scrubId);
        if (!runner) { stopPlayheadFollow(); return; }
        const seq = sequencer.getSequence(scrubId);
        if (!seq) return;
        // Playback loops on the ACTUAL duration, not the padded display width.
        const duration = Math.max(sequencer.effectiveDuration(seq), 0.01);
        const elapsed = sequencer.now - runner.startTime;
        scrubCurrentT = duration > 0 ? Math.max(0, Math.min(elapsed % duration, duration)) : 0;
        updatePlayheadAndTime();
        scrubPlayRafId = requestAnimationFrame(tick);
    };
    scrubPlayRafId = requestAnimationFrame(tick);
}
function stopPlayheadFollow() {
    if (scrubPlayRafId != null) cancelAnimationFrame(scrubPlayRafId);
    scrubPlayRafId = null;
}

function scrubTogglePlay() {
    const seq = sequencer.getSequence(scrubId);
    if (!seq) return;
    if (sequencer.isPlaying(scrubId)) {
        stopSequence(scrubId);
        // stopSequence restores home pose; freeze at playhead instead so pause looks paused.
        sequencer.sampleAt(scrubId, scrubCurrentT);
    } else {
        // Keep selection so it resumes after pause; gizmo detach handled in seq:play listener.
        playSequence(scrubId, { iterationCount: seq.loop ? Infinity : 1 });
        // Resume from playhead position rather than jumping back to t=0.
        const runner = sequencer.active.get(scrubId);
        if (runner) runner.startTime = sequencer.now - scrubCurrentT;
    }
}

function scrubAttachGizmoTo(seq, kf) {
    selectKeyframePreview(seq, kf);
    scrubGizmoOn = true;
    expandedSequences.add(seq.id);
    renderAnimationsPanel();
    setTimeout(() => {
        const seqRow = document.querySelector(`.editor-row[data-id="${seq.id}"]`);
        if (!seqRow) return;
        const kfRow = Array.from(seqRow.querySelectorAll('.kf-row'))
            .find(r => Math.abs(parseFloat(r.dataset.t) - kf.t) < 0.001);
        if (kfRow) kfRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 0);
}
function scrubDetachGizmo() {
    if (!scrubGizmoOn) return;
    const seq = sequencer.getSequence(scrubId);
    const kf = scrubSelectedKf || (seq && scrubSelectedT != null ? findKfByT(seq, scrubSelectedT) : null);
    if (seq && kf) deselectKeyframePreview(seq, kf);
    scrubGizmoOn = false;
}

function scrubDeleteSelected() {
    const kfToRemove = scrubSelectedKf;
    if (!kfToRemove) return;
    scrubDetachGizmo();
    scrubSelectedT = null;
    scrubSelectedKf = null;
    sequencer.removeKeyframeRef(scrubId, kfToRemove);
}
function scrubNudgeSelected(delta) {
    const kf = scrubSelectedKf;
    if (!kf) return;
    const newT = Math.max(0, kf.t + delta);
    scrubSelectedT = newT;
    sequencer.setKeyframeTimeRef(scrubId, kf, newT);
}
function scrubSetPlayhead(t) {
    scrubCurrentT = Math.max(0, t);
    sequencer.sampleAt(scrubId, scrubCurrentT);
    updatePlayheadAndTime();
}
function scrubSnapshotFromEditorCamera() {
    const seq = sequencer.getSequence(scrubId);
    if (!seq || seq.targets[0] !== 'liveCamera') return;
    const cam = getEditorCameraRef();
    if (!cam) return;
    const t = scrubCurrentT;
    sequencer.setTrackEntry(scrubId, 'liveCamera.position', t, [cam.position.x, cam.position.y, cam.position.z]);
    sequencer.setTrackEntry(scrubId, 'liveCamera.rotation', t, [cam.rotation.x, cam.rotation.y, cam.rotation.z]);
    sequencer.setTrackEntry(scrubId, 'liveCamera.fov', t, cam.fov);
    sequencer.sampleAt(scrubId, t);
}

function scrubAddAtPlayhead() {
    const seq = sequencer.getSequence(scrubId);
    if (!seq) return;
    const t = scrubCurrentT;
    sequencer.recordKeyframe(scrubId, t);
    scrubSelectedT = t;
    // Re-render happens via seq:update; attach gizmo after render so it targets the fresh kf.
    queueMicrotask(() => {
        const fresh = sequencer.getSequence(scrubId);
        const kf = fresh && findKfByT(fresh, t);
        if (kf) scrubAttachGizmoTo(fresh, kf);
    });
}

let scrubContextMenuEl = null;
let scrubEasingPickerEl = null;

function closeScrubEasingPicker() {
    if (scrubEasingPickerEl) { scrubEasingPickerEl.remove(); scrubEasingPickerEl = null; }
    document.removeEventListener('pointerdown', onScrubEasingPickerDismiss, true);
    document.removeEventListener('keydown', onScrubEasingPickerKey, true);
}
function onScrubEasingPickerDismiss(ev) {
    if (scrubEasingPickerEl && !scrubEasingPickerEl.contains(ev.target)) closeScrubEasingPicker();
}
function onScrubEasingPickerKey(ev) {
    if (ev.key === 'Escape') closeScrubEasingPicker();
}

function openScrubEasingPicker(anchorEl, color, currentEasing, onPick) {
    closeScrubEasingPicker();
    const menu = document.createElement('div');
    menu.className = 'scrub-easing-picker';
    menu.innerHTML = EASING_NAMES.map(name => `
        <div class="scrub-easing-item${name === currentEasing ? ' selected' : ''}" data-name="${name}">
            <svg width="60" height="20" viewBox="0 0 60 20">
                <line x1="0" y1="20" x2="60" y2="20" stroke="#3c3c3c" stroke-width="0.5"/>
                <path d="${easingPath(name, 60, 20)}" stroke="${color}" stroke-width="1.3" fill="none"/>
            </svg>
            <span>${name}</span>
        </div>
    `).join('');
    document.body.appendChild(menu);
    const anchorRect = anchorEl.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let px = anchorRect.left;
    let py = anchorRect.bottom + 4;
    if (py + menuRect.height > window.innerHeight - 4) py = anchorRect.top - menuRect.height - 4;
    if (px + menuRect.width > window.innerWidth - 4) px = window.innerWidth - menuRect.width - 4;
    menu.style.left = `${Math.max(4, px)}px`;
    menu.style.top = `${Math.max(4, py)}px`;
    menu.querySelectorAll('.scrub-easing-item').forEach(el => {
        el.onclick = () => {
            onPick(el.dataset.name);
            closeScrubEasingPicker();
        };
    });
    scrubEasingPickerEl = menu;
    setTimeout(() => {
        document.addEventListener('pointerdown', onScrubEasingPickerDismiss, true);
        document.addEventListener('keydown', onScrubEasingPickerKey, true);
    }, 0);
}

function closeScrubContextMenu() {
    if (scrubContextMenuEl) { scrubContextMenuEl.remove(); scrubContextMenuEl = null; }
    document.removeEventListener('pointerdown', onScrubContextDismiss, true);
    document.removeEventListener('keydown', onScrubContextKey, true);
}
function onScrubContextDismiss(ev) {
    if (scrubContextMenuEl && !scrubContextMenuEl.contains(ev.target)) closeScrubContextMenu();
}
function onScrubContextKey(ev) {
    if (ev.key === 'Escape') closeScrubContextMenu();
}

function openScrubContextMenu(x, y, ctx) {
    closeScrubContextMenu();
    const { trackKey, clickedT, dotT } = ctx;
    const targetT = dotT != null ? dotT : clickedT;
    const canPaste = !!(scrubClipboard && scrubClipboard.trackKey === trackKey);

    const items = [];
    if (dotT != null) {
        const seq = sequencer.getSequence(scrubId);
        const entry = seq?.tracks?.[trackKey]?.find(e => Math.abs(e.t - dotT) < 0.001);
        const isLocked = !!entry?.locked;
        items.push({ label: t('animations.ctxCopy'), action: () => {
            scrubSelectedTrackEntry = { trackKey, t: dotT };
            copyScrubTrackEntry();
        }});
        items.push({ label: isLocked ? t('animations.ctxUnlock') : t('animations.ctxLock'), action: () => {
            sequencer.setTrackEntryLocked(scrubId, trackKey, dotT, !isLocked);
        }});
        items.push({ label: t('animations.ctxDelete'), action: () => {
            sequencer.removeTrackEntry(scrubId, trackKey, dotT);
            if (scrubSelectedTrackEntry?.trackKey === trackKey && Math.abs(scrubSelectedTrackEntry.t - dotT) < 0.001) {
                scrubSelectedTrackEntry = null;
            }
        }});
        if (canPaste) items.push({ label: t('animations.ctxPasteHere'), action: () => {
            sequencer.setTrackEntry(scrubId, scrubClipboard.trackKey, dotT,
                scrubClipboard.value, scrubClipboard.easing);
            scrubSelectedTrackEntry = { trackKey, t: dotT };
        }});
    } else {
        items.push({ label: t('animations.ctxAddHere'), action: () => {
            sequencer.recordTrackEntry(scrubId, trackKey, targetT);
            scrubSelectedTrackEntry = { trackKey, t: targetT };
        }});
        if (canPaste) items.push({ label: t('animations.ctxPasteHere'), action: () => {
            sequencer.setTrackEntry(scrubId, scrubClipboard.trackKey, targetT,
                scrubClipboard.value, scrubClipboard.easing);
            scrubSelectedTrackEntry = { trackKey, t: targetT };
        }});
    }

    const menu = document.createElement('div');
    menu.className = 'scrub-ctx-menu';
    menu.innerHTML = `
        <div class="scrub-ctx-header">${trackKey} @ ${targetT.toFixed(2)}s</div>
        ${items.map((it, i) => `<div class="scrub-ctx-item" data-i="${i}">${it.label}</div>`).join('')}
    `;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let px = x, py = y;
    if (px + rect.width > vw) px = vw - rect.width - 4;
    if (py + rect.height > vh) py = vh - rect.height - 4;
    menu.style.left = `${px}px`;
    menu.style.top = `${py}px`;
    menu.querySelectorAll('.scrub-ctx-item').forEach(el => {
        el.onclick = () => {
            const i = parseInt(el.dataset.i, 10);
            items[i]?.action();
            closeScrubContextMenu();
        };
    });
    scrubContextMenuEl = menu;
    // Defer to avoid the opening pointerdown immediately dismissing the menu.
    setTimeout(() => {
        document.addEventListener('pointerdown', onScrubContextDismiss, true);
        document.addEventListener('keydown', onScrubContextKey, true);
    }, 0);
}

function copyScrubTrackEntry() {
    const seq = sequencer.getSequence(scrubId);
    if (!seq || !scrubSelectedTrackEntry) return;
    const { trackKey, t } = scrubSelectedTrackEntry;
    const entries = seq.tracks?.[trackKey];
    if (!entries) return;
    const entry = entries.find(e => Math.abs(e.t - t) < 0.001);
    if (!entry) return;
    scrubClipboard = {
        trackKey,
        value: JSON.parse(JSON.stringify(entry.value)),
        easing: entry.easing || 'cubicInOut'
    };
}

function pasteScrubTrackEntry() {
    if (!scrubClipboard) return;
    const seq = sequencer.getSequence(scrubId);
    if (!seq) return;
    sequencer.setTrackEntry(scrubId, scrubClipboard.trackKey, scrubCurrentT,
        scrubClipboard.value, scrubClipboard.easing);
    scrubSelectedTrackEntry = { trackKey: scrubClipboard.trackKey, t: scrubCurrentT };
}

function deleteScrubTrackEntry() {
    if (!scrubSelectedTrackEntry) return;
    const { trackKey, t } = scrubSelectedTrackEntry;
    sequencer.removeTrackEntry(scrubId, trackKey, t);
    scrubSelectedTrackEntry = null;
}

function onScrubKeyDown(e) {
    if (!scrubBarEl) return;
    const inInput = !!e.target?.matches?.('input, textarea, select');
    if (inInput) return;

    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && (e.key === 'c' || e.key === 'C') && scrubSelectedTrackEntry) {
        e.preventDefault();
        copyScrubTrackEntry();
        return;
    }
    if (ctrl && (e.key === 'v' || e.key === 'V') && scrubClipboard) {
        e.preventDefault();
        pasteScrubTrackEntry();
        return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && scrubSelectedTrackEntry) {
        e.preventDefault();
        deleteScrubTrackEntry();
        return;
    }

    if (e.key === ' ') {
        e.preventDefault();
        scrubTogglePlay();
        return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && scrubSelectedT != null) {
        e.preventDefault();
        scrubDeleteSelected();
        return;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && scrubSelectedT != null) {
        e.preventDefault();
        const step = e.shiftKey ? 0.5 : 0.05;
        scrubNudgeSelected(e.key === 'ArrowLeft' ? -step : step);
        return;
    }
    if (e.key === 'Home') {
        e.preventDefault();
        scrubSetPlayhead(0);
        return;
    }
    if (e.key === 'End') {
        e.preventDefault();
        const seq = sequencer.getSequence(scrubId);
        if (seq) scrubSetPlayhead(sequencer.effectiveDuration(seq));
        return;
    }
}

function findKfByT(seq, t) {
    if (seq == null || t == null) return null;
    return seq.keyframes.find(k => Math.abs(k.t - t) < 0.001) || null;
}

function showScrubDragHint() {
    if (!scrubBarEl || scrubBarEl.querySelector('.scrub-drag-hint')) return;
    const el = document.createElement('div');
    el.className = 'scrub-drag-hint';
    el.textContent = t('animations.scrubDragHint');
    scrubBarEl.appendChild(el);
}
function hideScrubDragHint() {
    scrubBarEl?.querySelector('.scrub-drag-hint')?.remove();
}

// Full re-render on every keystroke would yank focus away from the value inputs.
function captureScrubFocus() {
    const active = document.activeElement;
    if (!scrubBarEl?.contains(active) || active.tagName !== 'INPUT') return null;
    const dataAttrs = [];
    for (const attr of ['data-i', 'data-extra', 'data-scalar', 'data-t', 'data-path']) {
        if (active.hasAttribute(attr)) dataAttrs.push(`[${attr}="${active.getAttribute(attr)}"]`);
    }
    const cls = (active.className || '').split(/\s+/).filter(Boolean)[0];
    const parentSel = active.closest('.scrub-inline-selected') ? '.scrub-inline-selected ' : '';
    return {
        selector: `${parentSel}input${cls ? '.' + cls : ''}${dataAttrs.join('')}`,
        start: active.selectionStart,
        end: active.selectionEnd
    };
}
function restoreScrubFocus(info) {
    if (!info || !scrubBarEl) return;
    const el = scrubBarEl.querySelector(info.selector);
    if (!el) return;
    el.focus();
    if (info.start != null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(info.start, info.end); } catch (e) { /* not a text input */ }
    }
}

function renderScrubBar() {
    if (!scrubBarEl || !scrubId) return;
    const seq = sequencer.getSequence(scrubId);
    if (!seq) { closeScrubBar(); return; }
    const focusInfo = captureScrubFocus();
    const duration = scrubDisplayDuration(seq);
    // currentSelectedKf reconciles our ref against the (possibly re-sorted) array.
    const selectedKf = currentSelectedKf(seq);
    if (selectedKf) {
        scrubSelectedKf = selectedKf;
        scrubSelectedT = selectedKf.t;
    } else {
        scrubSelectedKf = null;
        scrubSelectedT = null;
    }

    const playing = sequencer.isPlaying(scrubId);

    const isCameraSeq = seq.targets[0] === 'liveCamera';
    const snapshotBtn = isCameraSeq
        ? `<button class="scrub-snapshot" title="${t('animations.scrubSnapshotTitle')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
            </svg>
          </button>`
        : '';
    scrubBarEl.innerHTML = `
        <div class="scrub-head">
            <strong>${seq.name}</strong>
            <button class="scrub-play" title="${playing ? t('animations.stopTitle') : t('animations.playTitle')}">${playing ? '■' : '▶'}</button>
            <button class="scrub-add" title="${t('animations.scrubAddTitle')}">+</button>
            ${snapshotBtn}
            <span class="scrub-time"><span class="scrub-time-cur">${scrubCurrentT.toFixed(2)}</span> / ${duration.toFixed(2)}s</span>
            <button class="scrub-close" title="${t('animations.scrubClose')}">×</button>
        </div>
        ${renderTrackRows(seq, duration, selectedKf)}
        <div class="scrub-axis"><span>0</span><span>${duration.toFixed(2)}s</span></div>
        ${renderTrackEditPanel(seq)}
    `;

    wireScrubStrip(seq, duration);
    wireTrackRows(seq);
    if (selectedKf) wireScrubEditPanel(seq, selectedKf);
    wireTrackEditPanel(seq);
    restoreScrubFocus(focusInfo);
    scrubBarEl.querySelector('.scrub-play').onclick = () => scrubTogglePlay();
    scrubBarEl.querySelector('.scrub-add').onclick = () => scrubAddAtPlayhead();
    const snapBtn = scrubBarEl.querySelector('.scrub-snapshot');
    if (snapBtn) snapBtn.onclick = () => scrubSnapshotFromEditorCamera();
    scrubBarEl.querySelector('.scrub-close').onclick = () => {
        closeScrubBar();
        renderAnimationsPanel();
    };
}

function propOfTrackKey(trackKey) {
    const dot = trackKey.lastIndexOf('.');
    return dot >= 0 ? trackKey.slice(dot + 1) : trackKey;
}

const AXIS_LABELS = ['x', 'y', 'z', 'w'];

function renderTrackValueEditor(trackKey, value, locked = false, binding = 'static') {
    if (value == null) return '';
    const prop = propOfTrackKey(trackKey);
    const dis = locked ? 'disabled' : '';
    if (Array.isArray(value)) {
        const isDeg = prop === 'rotation';
        const step = prop === 'scale' ? '0.05' : (isDeg ? '0.5' : '0.1');
        return value.map((v, i) => {
            // Keep one decimal so typed fractional values (e.g. "45.5") survive the deg↔rad round-trip.
            const shown = isDeg ? (v * RAD2DEG).toFixed(1) : v.toFixed(2);
            const degAttr = isDeg ? 'data-deg' : '';
            const axis = AXIS_LABELS[i] || String(i);
            return `<label class="scrub-track-val-labeled"><span class="scrub-track-val-axis">${axis}</span><input type="number" class="scrub-track-val-input" data-i="${i}" ${degAttr} step="${step}" value="${shown}" ${dis}></label>`;
        }).join('');
    }
    if (typeof value === 'number') {
        return `<input type="number" class="scrub-track-val-input" data-scalar step="0.05" value="${value.toFixed(2)}" ${dis}>`;
    }
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
        const bound = binding && binding !== 'static';
        const shown = effectiveColor(value, binding);
        const colorDis = (locked || bound) ? 'disabled' : '';
        return `<input type="color" class="scrub-track-val-input" data-scalar value="${shown}" ${colorDis}>${bindingSelectHtml(binding, { disabled: locked })}`;
    }
    if (typeof value === 'object') {
        return Object.entries(value)
            .filter(([, v]) => typeof v === 'number')
            .map(([k, v]) => `<label class="scrub-track-val-extra"><span>${k}</span><input type="number" class="scrub-track-val-input" data-extra="${k}" step="0.05" value="${v.toFixed(2)}" ${dis}></label>`)
            .join('');
    }
    return `<span class="scrub-track-value muted">${String(value)}</span>`;
}

function formatTrackValue(trackKey, value) {
    if (value == null) return '';
    const prop = propOfTrackKey(trackKey);
    if (Array.isArray(value)) {
        if (prop === 'rotation') return value.map(v => `${(v * RAD2DEG).toFixed(0)}°`).join(', ');
        return value.map(v => v.toFixed(2)).join(', ');
    }
    if (typeof value === 'number') return value.toFixed(2);
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
        return Object.entries(value)
            .filter(([, v]) => v != null)
            .map(([k, v]) => `${k}:${typeof v === 'number' ? v.toFixed(2) : v}`)
            .join(' · ');
    }
    return String(value);
}

function selectedTrackEntryObj(seq) {
    if (!scrubSelectedTrackEntry) return null;
    const entries = seq.tracks?.[scrubSelectedTrackEntry.trackKey];
    if (!entries) return null;
    const idx = entries.findIndex(e => Math.abs(e.t - scrubSelectedTrackEntry.t) < 0.001);
    if (idx < 0) return null;
    return { entries, idx, entry: entries[idx], trackKey: scrubSelectedTrackEntry.trackKey };
}

// Placeholder when nothing is selected keeps the bar's overall height stable.
function renderTrackEditPanel(seq) {
    const sel = selectedTrackEntryObj(seq);
    if (!sel) {
        return `
            <div class="scrub-track-panel scrub-track-panel-empty">
                <div class="scrub-track-panel-empty-hint">${t('animations.scrubEmptyHint')}</div>
            </div>
        `;
    }
    const { entries, idx, entry, trackKey } = sel;
    const prev = idx > 0 ? entries[idx - 1] : null;
    const next = idx < entries.length - 1 ? entries[idx + 1] : null;
    const prop = propOfTrackKey(trackKey);
    const color = PROP_COLORS[prop] || '#a3a3a3';

    const clockIcon = `<span class="scrub-t-icon" aria-hidden="true">⏱</span>`;

    const neighborInline = (k) => k ? `
        <div class="scrub-inline scrub-inline-neighbor" data-t="${k.t}" title="${t('animations.scrubJumpTitle')}">
            <span class="scrub-diamond" style="background:${color}"></span>
            <div class="scrub-inline-name-text">${prop}</div>
            <div class="scrub-inline-t muted">${clockIcon} ${k.t.toFixed(2)}s</div>
            <div class="scrub-track-value muted">${formatTrackValue(trackKey, k.value)}</div>
        </div>` : `
        <div class="scrub-inline scrub-inline-empty">
            <span class="scrub-diamond scrub-diamond-empty"></span>
            <div class="scrub-inline-name-text muted">—</div>
        </div>`;

    const easingBetween = (earlier, later) => {
        if (!earlier || !later) return `<div class="scrub-inline-easing scrub-inline-easing-empty"></div>`;
        const dt = (later.t - earlier.t).toFixed(2);
        const name = earlier.easing || 'cubicInOut';
        return `
        <div class="scrub-inline-easing">
            <button type="button" class="scrub-easing-graph scrub-easing-graph-wide" data-t="${earlier.t}" title="${name} · ${t('animations.easingPickerTitle')}">
                <svg class="scrub-easing-svg" width="110" height="28" viewBox="0 0 110 28">
                    <line x1="0" y1="28" x2="110" y2="28" stroke="#3c3c3c" stroke-width="0.6"/>
                    <line x1="0" y1="0"  x2="0"  y2="28" stroke="#3c3c3c" stroke-width="0.6"/>
                    <path d="${easingPath(name, 110, 28)}" stroke="${color}" stroke-width="1.4" fill="none"/>
                </svg>
            </button>
            <div class="scrub-inline-dt muted">${dt}s</div>
        </div>`;
    };

    const lockedTag = entry.locked ? ` <span class="scrub-locked-tag" title="${t('animations.lockedTitle')}">🔒</span>` : '';
    const dis = entry.locked ? 'disabled' : '';
    const selInline = `
        <div class="scrub-inline scrub-inline-selected${entry.locked ? ' locked' : ''}">
            <span class="scrub-diamond scrub-diamond-selected" style="background:${color}"></span>
            <div class="scrub-inline-name-text">${prop}${lockedTag}</div>
            <div class="scrub-inline-t">
                ${clockIcon}
                <input type="number" class="scrub-track-edit-t" step="0.05" min="0" value="${entry.t.toFixed(2)}" ${dis}>s
            </div>
            <div class="scrub-track-value-edit">${renderTrackValueEditor(trackKey, entry.value, entry.locked, entry.binding)}</div>
        </div>`;

    return `
        <div class="scrub-track-panel scrub-track-panel-filled">
            <div class="scrub-track-panel-title" title="${trackKey}">
                <span class="scrub-diamond" style="background:${color};display:inline-block;width:8px;height:8px;transform:rotate(45deg);"></span>
                ${trackKey}
            </div>
            <div class="scrub-kf-inline-row">
                ${neighborInline(prev)}
                ${easingBetween(prev, entry)}
                ${selInline}
                ${easingBetween(entry, next)}
                ${neighborInline(next)}
            </div>
            <div class="scrub-kf-nav-bottom">
                <button class="scrub-track-nav-prev" ${prev ? '' : 'disabled'} title="${t('animations.scrubGoPrevTitle')}">◀</button>
                <button class="scrub-track-nav-next" ${next ? '' : 'disabled'} title="${t('animations.scrubGoNextTitle')}">▶</button>
            </div>
        </div>
    `;
}

function selectTrackEntry(seq, trackKey, t) {
    selectTrackEntryWithGizmo(seq, trackKey, t);
}

// Selects a channel entry and attaches TransformControls to the sequence's target so
// dragging the gizmo writes back into this specific entry (see the registry.change listener).
function selectTrackEntryWithGizmo(seq, trackKey, t) {
    scrubSelectedTrackEntry = { trackKey, t };
    scrubSelectedKf = null;
    scrubSelectedT = null;
    scrubDetachGizmo();
    scrubCurrentT = t;
    sequencer.sampleAt(scrubId, t);
    renderScrubBar();
    const target = seq.targets[0];
    if (target) selectTarget(target);
}

function wireTrackEditPanel(seq) {
    const sel = selectedTrackEntryObj(seq);
    if (!sel) return;
    const { entry, entries, idx, trackKey } = sel;
    const prev = idx > 0 ? entries[idx - 1] : null;
    const next = idx < entries.length - 1 ? entries[idx + 1] : null;

    const tInput = scrubBarEl.querySelector('.scrub-track-edit-t');
    if (tInput) {
        tInput.onchange = () => {
            const newT = Math.max(0, parseFloat(tInput.value) || 0);
            scrubSelectedTrackEntry = { trackKey, t: newT };
            sequencer.setTrackEntryTime(scrubId, trackKey, entry.t, newT);
        };
    }
    const pickerColor = PROP_COLORS[propOfTrackKey(trackKey)] || '#a3a3a3';
    scrubBarEl.querySelectorAll('.scrub-easing-graph-wide').forEach(btn => {
        btn.onclick = () => {
            const easingT = parseFloat(btn.dataset.t);
            const cur = seq.tracks[trackKey]?.find(e => Math.abs(e.t - easingT) < 0.001);
            openScrubEasingPicker(btn, pickerColor, cur?.easing || 'cubicInOut', (name) => {
                sequencer.setTrackEntryEasing(scrubId, trackKey, easingT, name);
            });
        };
    });
    scrubBarEl.querySelectorAll('.scrub-inline-neighbor').forEach(el => {
        el.style.cursor = 'pointer';
        el.onclick = () => {
            const nT = parseFloat(el.dataset.t);
            const target = entries.find(e => Math.abs(e.t - nT) < 0.001);
            if (target) selectTrackEntry(seq, trackKey, target.t);
        };
    });
    const prevBtn = scrubBarEl.querySelector('.scrub-track-nav-prev');
    const nextBtn = scrubBarEl.querySelector('.scrub-track-nav-next');
    if (prevBtn) prevBtn.onclick = () => { if (prev) selectTrackEntry(seq, trackKey, prev.t); };
    if (nextBtn) nextBtn.onclick = () => { if (next) selectTrackEntry(seq, trackKey, next.t); };

    scrubBarEl.querySelectorAll('.scrub-inline-selected .scrub-track-val-input').forEach(inp => {
        inp.oninput = () => {
            const seqNow = sequencer.getSequence(scrubId);
            const cur = seqNow?.tracks?.[trackKey]?.find(e => Math.abs(e.t - entry.t) < 0.001);
            if (!cur) return;
            let nextValue;
            if (inp.dataset.i != null) {
                nextValue = Array.isArray(cur.value) ? cur.value.slice() : [0, 0, 0];
                let raw = parseFloat(inp.value);
                if (Number.isNaN(raw)) return;
                if (inp.hasAttribute('data-deg')) raw = raw * DEG2RAD;
                nextValue[parseInt(inp.dataset.i, 10)] = raw;
            } else if (inp.dataset.extra != null) {
                nextValue = { ...(cur.value || {}) };
                const raw = parseFloat(inp.value);
                if (Number.isNaN(raw)) return;
                nextValue[inp.dataset.extra] = raw;
            } else if (inp.dataset.scalar != null) {
                if (inp.type === 'color') nextValue = inp.value;
                else {
                    const raw = parseFloat(inp.value);
                    if (Number.isNaN(raw)) return;
                    nextValue = raw;
                }
            } else return;
            sequencer.setTrackEntryValue(scrubId, trackKey, entry.t, nextValue);
            sequencer.sampleAt(scrubId, entry.t);
        };
    });
    scrubBarEl.querySelectorAll('.scrub-inline-selected .color-binding-select').forEach(sel => {
        sel.onchange = () => {
            sequencer.setTrackEntryBinding(scrubId, trackKey, entry.t, sel.value);
            sequencer.sampleAt(scrubId, entry.t);
        };
    });
}

function renderTrackRows(seq, duration, selectedKf) {
    if (!seq.tracks) return '';
    // Include empty tracks so channel rows persist after a channel is fully cleared.
    const entries = Object.entries(seq.tracks);
    if (entries.length === 0) return '';
    const playheadLeft = duration > 0 ? Math.max(0, Math.min(1, scrubCurrentT / duration)) * 100 : 0;
    const rows = entries.map(([trackKey, kfs]) => {
        const prop = propOfTrackKey(trackKey);
        const color = PROP_COLORS[prop] || '#a3a3a3';
        const dots = kfs.map(e => {
            const left = duration > 0 ? Math.max(0, Math.min(1, e.t / duration)) * 100 : 0;
            const isTrackSel = scrubSelectedTrackEntry
                && scrubSelectedTrackEntry.trackKey === trackKey
                && Math.abs(scrubSelectedTrackEntry.t - e.t) < 0.001;
            const isLocked = !!e.locked;
            const cls = `scrub-track-dot${isTrackSel ? ' track-selected' : ''}${isLocked ? ' locked' : ''}`;
            const titleSuffix = isLocked ? ' · locked' : '';
            return `<div class="${cls}" data-track="${trackKey}" data-t="${e.t}" style="left:${left}%;background:${color}" title="${trackKey} @ ${e.t.toFixed(2)}s${titleSuffix}"></div>`;
        }).join('');
        let highlight = '';
        if (scrubSelectedTrackEntry && scrubSelectedTrackEntry.trackKey === trackKey) {
            const idx = kfs.findIndex(e => Math.abs(e.t - scrubSelectedTrackEntry.t) < 0.001);
            if (idx >= 0) {
                const lo = idx > 0 ? kfs[idx - 1].t : 0;
                const hi = idx < kfs.length - 1 ? kfs[idx + 1].t : duration;
                const leftPct = duration > 0 ? Math.max(0, Math.min(1, lo / duration)) * 100 : 0;
                const widthPct = duration > 0 ? Math.max(0, Math.min(1, (hi - lo) / duration)) * 100 : 0;
                highlight = `<div class="scrub-track-segment-highlight" style="left:${leftPct}%;width:${widthPct}%;background:${color}"></div>`;
            }
        }
        return `
            <div class="scrub-track-row" data-track="${trackKey}">
                <div class="scrub-track-label" title="${trackKey}">
                    <span class="scrub-track-label-dot" style="background:${color}"></span>
                    ${prop}
                </div>
                <div class="scrub-track-strip">
                    ${highlight}
                    <div class="scrub-track-playhead" style="left:${playheadLeft}%"></div>
                    ${dots}
                </div>
            </div>`;
    }).join('');
    return `<div class="scrub-tracks">${rows}</div>`;
}

function wireTrackRows(seq) {
    if (!scrubBarEl) return;
    const duration = scrubDisplayDuration(seq);

    scrubBarEl.querySelectorAll('.scrub-track-row').forEach(row => {
        const trackKey = row.dataset.track;
        const rowStrip = row.querySelector('.scrub-track-strip');
        if (!rowStrip) return;

        rowStrip.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;
            if (ev.target.classList.contains('scrub-track-dot')) return;
            ev.preventDefault();
            const rect = rowStrip.getBoundingClientRect();
            const rawT = (e) => {
                const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
                return (x / rect.width) * duration;
            };
            scrubCurrentT = rawT(ev);
            sequencer.sampleAt(scrubId, scrubCurrentT);
            updatePlayheadAndTime();
            const onMove = (e) => {
                scrubCurrentT = rawT(e);
                sequencer.sampleAt(scrubId, scrubCurrentT);
                updatePlayheadAndTime();
            };
            const onUp = () => {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        });

        rowStrip.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            const rect = rowStrip.getBoundingClientRect();
            const x = Math.max(0, Math.min(ev.clientX - rect.left, rect.width));
            const clickedT = snapT((x / rect.width) * duration, ev.shiftKey);
            const dotEl = ev.target.closest?.('.scrub-track-dot');
            const dotT = dotEl ? parseFloat(dotEl.dataset.t) : null;
            openScrubContextMenu(ev.clientX, ev.clientY, {
                trackKey,
                clickedT,
                dotT
            });
        });

        rowStrip.querySelectorAll('.scrub-track-dot').forEach(dot => {
            dot.addEventListener('pointerdown', (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                const originalT = parseFloat(dot.dataset.t);
                const entries = seq.tracks[trackKey] || [];
                const idx = entries.findIndex(e => Math.abs(e.t - originalT) < 0.001);
                const clickedEntry = idx >= 0 ? entries[idx] : null;
                // Locked: click still selects (for copy/unlock/delete via ctx menu), no drag.
                if (clickedEntry?.locked) {
                    scrubSelectedTrackEntry = { trackKey, t: originalT };
                    scrubSelectedKf = null;
                    scrubSelectedT = null;
                    scrubDetachGizmo();
                    scrubCurrentT = originalT;
                    sequencer.sampleAt(scrubId, originalT);
                    renderScrubBar();
                    return;
                }
                let currentT = originalT;
                let moved = false;
                dot.classList.add('dragging');

                const prevEntry = idx > 0 ? entries[idx - 1] : null;
                const nextEntry = idx >= 0 && idx < entries.length - 1 ? entries[idx + 1] : null;

                const rect = rowStrip.getBoundingClientRect();

                const rawT = (e) => {
                    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
                    return (x / rect.width) * duration;
                };
                const clampNeighbors = (t) => {
                    if (prevEntry) t = Math.max(t, prevEntry.t + SCRUB_SNAP);
                    if (nextEntry) t = Math.min(t, nextEntry.t - SCRUB_SNAP);
                    return t;
                };

                const onMove = (e) => {
                    if (!moved) showScrubDragHint();
                    moved = true;
                    let t = rawT(e);
                    if (!e.shiftKey) {
                        t = snapT(t, false);
                        t = clampNeighbors(t);
                    }
                    currentT = Math.max(0, t);
                    dot.style.left = `${(currentT / duration) * 100}%`;
                    scrubCurrentT = currentT;
                    sequencer.sampleAt(scrubId, currentT);
                    updatePlayheadAndTime();
                };
                const onUp = () => {
                    document.removeEventListener('pointermove', onMove);
                    document.removeEventListener('pointerup', onUp);
                    document.removeEventListener('pointercancel', onUp);
                    hideScrubDragHint();
                    dot.classList.remove('dragging');
                    if (moved && Math.abs(currentT - originalT) > 0.001) {
                        sequencer.setTrackEntryTime(scrubId, trackKey, originalT, currentT);
                        selectTrackEntryWithGizmo(seq, trackKey, currentT);
                    } else {
                        scrubCurrentT = originalT;
                        sequencer.sampleAt(scrubId, originalT);
                        selectTrackEntryWithGizmo(seq, trackKey, originalT);
                    }
                };
                document.addEventListener('pointermove', onMove);
                document.addEventListener('pointerup', onUp);
                document.addEventListener('pointercancel', onUp);
            });
        });
    });
}

function scrubNeighborsOf(seq, kf) {
    // Prefer reference match to disambiguate duplicate-t keyframes.
    let idx = seq.keyframes.indexOf(kf);
    if (idx < 0) idx = seq.keyframes.findIndex(k => Math.abs(k.t - kf.t) < 0.001);
    const prev = idx > 0 ? seq.keyframes[idx - 1] : null;
    const next = idx >= 0 && idx < seq.keyframes.length - 1 ? seq.keyframes[idx + 1] : null;
    return { prev, next };
}

function currentSelectedKf(seq) {
    if (!seq) return null;
    if (scrubSelectedKf && seq.keyframes.indexOf(scrubSelectedKf) >= 0) return scrubSelectedKf;
    return scrubSelectedT != null ? findKfByT(seq, scrubSelectedT) : null;
}

function kfBefore(seq, k) {
    if (!k) return null;
    const idx = seq.keyframes.findIndex(x => Math.abs(x.t - k.t) < 0.001);
    return idx > 0 ? seq.keyframes[idx - 1] : null;
}

function diffBlock(seq, forKf) {
    const prev = kfBefore(seq, forKf);
    if (!prev) return '';
    const inner = renderKfDiff(seq, prev, forKf);
    if (!inner) return '';
    return `
        <div class="scrub-diff-wrap">
            <span class="scrub-diff-arrow">→</span>
            <div class="scrub-diff-box">${inner}</div>
        </div>`;
}

function kfDisplayName(seq, kf) {
    // indexOf so duplicate-t keyframes get distinct numbers.
    let idx = seq.keyframes.indexOf(kf);
    if (idx < 0) idx = seq.keyframes.findIndex(k => Math.abs(k.t - kf.t) < 0.001);
    return `${t('animations.scrubKfName')} ${idx + 1}`;
}

function easingPath(name, w = 60, h = 24) {
    const N = 24;
    const pts = [];
    for (let i = 0; i <= N; i++) {
        const t = i / N;
        const v = Math.max(0, Math.min(1, ease(name, t)));
        pts.push(`${(t * w).toFixed(1)},${(h - v * h).toFixed(1)}`);
    }
    return 'M' + pts.join(' L');
}

function renderScrubEditPanel(seq, kf) {
    if (!kf) {
        return `<div class="scrub-edit-hint">${t('animations.scrubHint')}</div>`;
    }
    const { prev: prevKf, next: nextKf } = scrubNeighborsOf(seq, kf);

    const easingOpts = (current) => EASING_NAMES.map(e =>
        `<option value="${e}" ${current === e ? 'selected' : ''}>${e}</option>`
    ).join('');

    const neighborInline = (k) => k ? `
        <div class="scrub-inline scrub-inline-neighbor" data-idx="${seq.keyframes.indexOf(k)}" title="${t('animations.scrubJumpTitle')}">
            <span class="scrub-diamond"></span>
            <div class="scrub-inline-name-text">${kfDisplayName(seq, k)}</div>
            <div class="scrub-inline-t muted">t=${k.t.toFixed(2)}s</div>
            ${diffBlock(seq, k)}
        </div>` : `
        <div class="scrub-inline scrub-inline-empty">
            <span class="scrub-diamond scrub-diamond-empty"></span>
            <div class="scrub-inline-name-text muted">—</div>
        </div>`;

    // Easing lives on the earlier kf; graph shows the curve from earlier→later.
    const easingBetween = (earlierKf, laterKf) => {
        if (!earlierKf || !laterKf) return `<div class="scrub-inline-easing scrub-inline-easing-empty"></div>`;
        const dt = (laterKf.t - earlierKf.t).toFixed(2);
        const name = earlierKf.easing || 'cubicInOut';
        return `
        <div class="scrub-inline-easing" title="${name} · ${t('animations.easingTooltip')}">
            <div class="scrub-easing-graph">
                <svg class="scrub-easing-svg" width="60" height="24" viewBox="0 0 60 24">
                    <line x1="0" y1="24" x2="60" y2="24" stroke="#3c3c3c" stroke-width="0.6"/>
                    <line x1="0" y1="0"  x2="0"  y2="24" stroke="#3c3c3c" stroke-width="0.6"/>
                    <path d="${easingPath(name, 60, 24)}" stroke="#7bb1ff" stroke-width="1.4" fill="none"/>
                </svg>
                <select class="scrub-between-easing" data-idx="${seq.keyframes.indexOf(earlierKf)}">${easingOpts(name)}</select>
            </div>
            <div class="scrub-inline-dt muted">${dt}s</div>
        </div>`;
    };

    const selInline = `
        <div class="scrub-inline scrub-inline-selected">
            <span class="scrub-diamond scrub-diamond-selected"></span>
            <div class="scrub-inline-name-text">${kfDisplayName(seq, kf)}</div>
            <div class="scrub-inline-t">
                <input type="number" class="scrub-edit-t" step="0.05" min="0" value="${kf.t.toFixed(2)}">s
            </div>
            ${diffBlock(seq, kf)}
        </div>`;

    return `
        <div class="scrub-kf-inline-row">
            ${neighborInline(prevKf)}
            ${easingBetween(prevKf, kf)}
            ${selInline}
            ${easingBetween(kf, nextKf)}
            ${neighborInline(nextKf)}
        </div>
        <div class="scrub-kf-nav-bottom">
            <button class="scrub-nav-prev" ${prevKf ? '' : 'disabled'} title="${t('animations.scrubGoPrevTitle')}">◀</button>
            <button class="scrub-nav-next" ${nextKf ? '' : 'disabled'} title="${t('animations.scrubGoNextTitle')}">▶</button>
        </div>
    `;
}

function renderKfDiff(seq, fromKf, toKf) {
    if (!fromKf) return '';
    const target = seq.targets[0];
    if (!target) return '';
    const items = [];
    const from = fromKf.snapshot || {};
    const to = toKf.snapshot || {};

    if (target === 'liveCamera' && from.liveCamera && to.liveCamera) {
        addChangedVec3(items, 'pos', from.liveCamera.position, to.liveCamera.position);
        addChangedVec3(items, 'rot', from.liveCamera.rotation, to.liveCamera.rotation, RAD2DEG, '°');
        if (Math.abs((from.liveCamera.fov || 0) - (to.liveCamera.fov || 0)) > 0.01) {
            items.push({ label: 'fov', values: (to.liveCamera.fov || 0).toFixed(2) });
        }
    } else if (target.startsWith('slot:')) {
        const id = target.slice('slot:'.length);
        const f = from.slots?.[id], b = to.slots?.[id];
        if (f && b) {
            addChangedVec3(items, 'pos', f.position, b.position);
            addChangedVec3(items, 'rot', f.rotation, b.rotation, RAD2DEG, '°');
            addChangedVec3(items, 'scl', f.scale, b.scale);
        }
    } else if (target.startsWith('light:')) {
        const id = target.slice('light:'.length);
        const f = from.lights?.[id], b = to.lights?.[id];
        if (f && b) {
            addChangedVec3(items, 'pos', f.position, b.position);
            addChangedVec3(items, 'tgt', f.target, b.target);
            if (Math.abs((f.intensity || 0) - (b.intensity || 0)) > 0.001) {
                items.push({ label: 'int', values: (b.intensity || 0).toFixed(2) });
            }
            if (f.color !== b.color) items.push({ label: 'col', values: b.color });
        }
    } else if (target.startsWith('asset:')) {
        const id = target.slice('asset:'.length);
        const f = from.assets?.[id], b = to.assets?.[id];
        if (f && b) {
            addChangedVec3(items, 'pos', f.position, b.position);
            addChangedVec3(items, 'rot', f.rotation, b.rotation, RAD2DEG, '°');
            addChangedVec3(items, 'scl', f.scale, b.scale);
            if (Math.abs((f.opacity ?? 1) - (b.opacity ?? 1)) > 0.001) {
                items.push({ label: 'op', values: ((b.opacity ?? 1) * 100).toFixed(0) + '%' });
            }
        }
    }
    if (!items.length) return '';
    return items.map(it => `
        <div class="scrub-diff-col">
            <div class="scrub-diff-label">${it.label}</div>
            <div class="scrub-diff-values">${it.values}</div>
        </div>`).join('');
}

function addChangedVec3(items, label, a, b, scale = 1, unit = '') {
    if (!Array.isArray(a) || !Array.isArray(b)) return;
    const d0 = b[0] - a[0], d1 = b[1] - a[1], d2 = b[2] - a[2];
    if (Math.abs(d0) < 0.001 && Math.abs(d1) < 0.001 && Math.abs(d2) < 0.001) return;
    const fmt = (v) => `${(v * scale).toFixed(2)}${unit}`;
    items.push({ label, values: `${fmt(b[0])}, ${fmt(b[1])}, ${fmt(b[2])}` });
}

function scrubSelectAndPreview(seq, kf) {
    scrubDetachGizmo();
    scrubSelectedKf = kf;
    scrubSelectedT = kf.t;
    scrubSelectedTrackEntry = null;
    scrubCurrentT = kf.t;
    sequencer.sampleAt(scrubId, kf.t);
    renderScrubBar();
    scrubAttachGizmoTo(seq, kf);
}

function wireScrubEditPanel(seq, kf) {
    const tInput = scrubBarEl.querySelector('.scrub-edit-t');
    if (tInput) {
        tInput.onchange = () => {
            const newT = Math.max(0, parseFloat(tInput.value) || 0);
            scrubSelectedT = newT;
            sequencer.setKeyframeTimeRef(scrubId, kf, newT);
        };
    }
    scrubBarEl.querySelectorAll('.scrub-between-easing').forEach(sel => {
        sel.onchange = () => {
            const easingIdx = parseInt(sel.dataset.idx, 10);
            const easingKf = seq.keyframes[easingIdx];
            if (easingKf) sequencer.setKeyframeEasingRef(scrubId, easingKf, sel.value);
        };
    });
    const del = scrubBarEl.querySelector('.scrub-edit-delete');
    if (del) del.onclick = () => scrubDeleteSelected();

    const { prev: prevKf, next: nextKf } = scrubNeighborsOf(seq, kf);
    const nextBtn = scrubBarEl.querySelector('.scrub-nav-next');
    const prevBtn = scrubBarEl.querySelector('.scrub-nav-prev');
    if (nextBtn) nextBtn.onclick = () => { if (nextKf) scrubSelectAndPreview(seq, nextKf); };
    if (prevBtn) prevBtn.onclick = () => { if (prevKf) scrubSelectAndPreview(seq, prevKf); };

    scrubBarEl.querySelectorAll('.scrub-inline-neighbor').forEach(el => {
        el.style.cursor = 'pointer';
        el.onclick = () => {
            const nIdx = parseInt(el.dataset.idx, 10);
            const target = seq.keyframes[nIdx];
            if (target) scrubSelectAndPreview(seq, target);
        };
    });
}

function wireScrubStrip(seq, duration) {
    // Scrubbing lives on the channel strips now (see wireTrackRows).
}

function updatePlayheadAndTime() {
    if (!scrubBarEl) return;
    const seq = sequencer.getSequence(scrubId);
    if (!seq) return;
    const duration = scrubDisplayDuration(seq);
    const leftPct = `${Math.max(0, Math.min(scrubCurrentT / duration, 1)) * 100}%`;
    const ph = scrubBarEl.querySelector('.scrub-playhead');
    const label = scrubBarEl.querySelector('.scrub-time-cur');
    if (ph) ph.style.left = leftPct;
    if (label) label.textContent = scrubCurrentT.toFixed(2);
    scrubBarEl.querySelectorAll('.scrub-track-playhead').forEach(el => { el.style.left = leftPct; });
}

// Set while the panel writes to the registry, to skip the sync listener and avoid feedback loops.
let suppressSync = false;

// Apply a preview/keyframe snapshot to the three.js scene ONLY — never to registry specs.
// This keeps preview state fully separated from the "static" state that gets saved to disk.
// Panel inputs on lights/slots/etc show static spec values, unaffected by preview.
function applySnapshotToRegistry(snapshot, target) {
    if (!snapshot || !target) return;
    // Filter the snapshot to just the target so we don't touch other objects.
    const filtered = { lights: {}, slots: {}, assets: {}, liveCamera: null };
    if (target === 'liveCamera') filtered.liveCamera = snapshot.liveCamera || null;
    else if (target.startsWith('light:')) {
        const id = target.slice('light:'.length);
        if (snapshot.lights?.[id]) filtered.lights[id] = snapshot.lights[id];
    } else if (target.startsWith('slot:')) {
        const id = target.slice('slot:'.length);
        if (snapshot.slots?.[id]) filtered.slots[id] = snapshot.slots[id];
    } else if (target.startsWith('asset:')) {
        const id = target.slice('asset:'.length);
        if (snapshot.assets?.[id]) filtered.assets[id] = snapshot.assets[id];
    }
    applySnapshotToScene(filtered);
}

// While a keyframe is being previewed, scene edits get written back into its snapshot.
registry.addEventListener('change', (e) => {
    if (suppressSync) return;
    const detail = e.detail;
    if (!detail) return;
    const type = detail.type;
    if (type !== 'lights:update' && type !== 'slots:update' && type !== 'liveCamera:update' && type !== 'assets:update') return;

    for (const [seqId, active] of activePreview) {
        const seq = sequencer.getSequence(seqId);
        if (!seq) continue;
        const target = seq.targets[0];
        if (!target) continue;

        const matches =
            (type === 'liveCamera:update' && target === 'liveCamera') ||
            (type === 'lights:update' && target === `light:${detail.id}`) ||
            (type === 'slots:update' && target === `slot:${detail.id}`) ||
            (type === 'assets:update' && target === `asset:${detail.id}`);
        if (!matches) continue;

        const fresh = captureSnapshot([target]);
        sequencer.updateKeyframeRef(seq.id, active.kf, (snap) => {
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
            } else if (target.startsWith('asset:')) {
                const id = target.slice('asset:'.length);
                snap.assets = snap.assets || {};
                snap.assets[id] = fresh.assets[id];
            }
        });
    }

    // Per-channel write-back: when a scrub-bar channel entry is selected, gizmo edits
    // write into just that specific track's entry (not the whole snapshot).
    if (scrubSelectedTrackEntry && scrubId) {
        const seq = sequencer.getSequence(scrubId);
        if (!seq) return;
        const { trackKey, t } = scrubSelectedTrackEntry;
        const entry = seq.tracks?.[trackKey]?.find(en => Math.abs(en.t - t) < 0.001);
        if (!entry || entry.locked) return;
        const dot = trackKey.lastIndexOf('.');
        const target = trackKey.slice(0, dot);
        const prop = trackKey.slice(dot + 1);
        const matches =
            (type === 'liveCamera:update' && target === 'liveCamera') ||
            (type === 'lights:update' && target === `light:${detail.id}`) ||
            (type === 'slots:update' && target === `slot:${detail.id}`) ||
            (type === 'assets:update' && target === `asset:${detail.id}`);
        if (!matches) return;
        const fresh = captureSnapshot([target]);
        let value;
        if (target === 'liveCamera') value = fresh.liveCamera?.[prop];
        else if (target.startsWith('slot:')) value = fresh.slots?.[target.slice(5)]?.[prop];
        else if (target.startsWith('light:')) value = fresh.lights?.[target.slice(6)]?.[prop];
        else if (target.startsWith('asset:')) value = fresh.assets?.[target.slice(6)]?.[prop];
        if (value !== undefined) sequencer.setTrackEntryValue(scrubId, trackKey, t, value);
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

// New asset .glb's may add clips after the panel was first rendered; re-render on source changes.
clipManager.addEventListener('source:add', () => renderAnimationsPanel());
clipManager.addEventListener('source:remove', () => renderAnimationsPanel());

function findPrevKf(seq, kf) {
    const idx = seq.keyframes.findIndex(k => Math.abs(k.t - kf.t) < 0.001);
    return idx > 0 ? seq.keyframes[idx - 1] : null;
}

function selectKeyframePreview(seq, kf) {
    // Preview is exclusive per sequence — drop any other kf refs of THIS sequence.
    for (const other of seq.keyframes) {
        if (other !== kf) expandedKeyframes.delete(other);
    }
    // Anchor is captured once and preserved across keyframe switches in the same sequence.
    if (!previewAnchors.has(seq.id)) {
        previewAnchors.set(seq.id, captureSnapshot(seq.targets));
    }
    expandedKeyframes.add(kf);
    applySnapshotToRegistry(kf.snapshot, seq.targets[0]);
    activePreview.set(seq.id, { kf });
    showPath(seq, kf, findPrevKf(seq, kf));
    // selectTarget last so TransformControls' attach event sees the object already posed.
    selectTarget(seq.targets[0]);
}

function deselectKeyframePreview(seq, kf) {
    expandedKeyframes.delete(kf);
    // Clear active BEFORE the restore writes so registry events don't write back into the kf.
    activePreview.delete(seq.id);
    hidePath(seq.id);
    const anchor = previewAnchors.get(seq.id);
    if (anchor) applySnapshotToRegistry(anchor, seq.targets[0]);
    previewAnchors.delete(seq.id);
}

// Kept as no-ops for backwards-compat; the registry's static-committed mirrors now
// guarantee that serialize() returns only user-committed values, so no wrapper needed.
export let previewSerializeInProgress = false;
export function isPreviewSerializeInProgress() { return previewSerializeInProgress; }

// Thin passthrough — registry.serialize() reads from the static mirrors, which are
// only ever updated by explicit user commits. Animation/preview writes to three.js only.
export function serializeCleanRegistry() {
    return registry.serialize();
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
const ICON_ASSET  = '❖';

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
    if (target.startsWith('asset:')) {
        const id = target.slice('asset:'.length);
        const name = registry.getAsset(id)?.spec?.name || id;
        return `${ICON_ASSET} ${name}`;
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
    if (!Array.isArray(v)) return '(—)';
    return `(${v.map(x => x.toFixed(digits)).join(',')})`;
}
function fmtVecDeg(v) {
    if (!Array.isArray(v)) return '(—)°';
    return `(${v.map(x => (x * RAD2DEG).toFixed(0)).join(',')})°`;
}

function diffSummary(seq, kf, prevKf) {
    const target = seq.targets[0];
    if (!target) return '';
    const cur = kf.snapshot;
    const prev = prevKf?.snapshot;
    const parts = [];
    const start = t('animations.startPrefix');

    // Only include fields whose track has entries — snapshot values for empty tracks are
    // undefined, and reading .toFixed() / etc on them would throw.
    if (target === 'liveCamera') {
        const c = cur.liveCamera;
        if (!c) return '';
        const p = prev?.liveCamera;
        if (!p) {
            if (Array.isArray(c.position)) parts.push(`pos ${fmtVec(c.position)}`);
            if (typeof c.fov === 'number') parts.push(`fov ${Math.round(c.fov)}`);
            return parts.length ? `${start} · ${parts.join(' · ')}` : t('animations.noChange');
        }
        if (arraysDiffer(c.position, p.position)) parts.push(`pos ${fmtVec(c.position)}`);
        if (arraysDiffer(c.rotation, p.rotation)) parts.push(`rot ${fmtVecDeg(c.rotation)}`);
        if (typeof c.fov === 'number' && typeof p.fov === 'number' && Math.abs(c.fov - p.fov) > 0.5) {
            parts.push(`fov ${Math.round(c.fov)}`);
        }
    } else if (target.startsWith('light:')) {
        const id = target.slice('light:'.length);
        const c = cur.lights?.[id];
        if (!c) return '';
        const p = prev?.lights?.[id];
        if (!p) {
            if (typeof c.intensity === 'number') parts.push(`int ${c.intensity.toFixed(2)}`);
            if (c.color) parts.push(`col ${c.color}`);
            return parts.length ? `${start} · ${parts.join(' · ')}` : t('animations.noChange');
        }
        if (typeof c.intensity === 'number' && typeof p.intensity === 'number'
            && Math.abs(c.intensity - p.intensity) > DIFF_EPS) parts.push(`int ${c.intensity.toFixed(2)}`);
        if (c.color && p.color && c.color !== p.color) parts.push(`col ${c.color}`);
        if (arraysDiffer(c.position, p.position)) parts.push(`pos ${fmtVec(c.position)}`);
        if (arraysDiffer(c.target, p.target)) parts.push(`tgt ${fmtVec(c.target)}`);
    } else if (target.startsWith('slot:')) {
        const id = target.slice('slot:'.length);
        const c = cur.slots?.[id];
        if (!c) return '';
        const p = prev?.slots?.[id];
        if (!p) {
            if (Array.isArray(c.position)) parts.push(`pos ${fmtVec(c.position)}`);
            return parts.length ? `${start} · ${parts.join(' · ')}` : t('animations.noChange');
        }
        if (arraysDiffer(c.position, p.position)) parts.push(`pos ${fmtVec(c.position)}`);
        if (arraysDiffer(c.rotation, p.rotation)) parts.push(`rot ${fmtVecDeg(c.rotation)}`);
        if (arraysDiffer(c.scale, p.scale, 0.005)) parts.push(`scl ${fmtVec(c.scale, 2)}`);
    } else if (target.startsWith('asset:')) {
        const id = target.slice('asset:'.length);
        const c = cur.assets?.[id];
        if (!c) return '';
        const p = prev?.assets?.[id];
        if (!p) {
            if (Array.isArray(c.position)) parts.push(`pos ${fmtVec(c.position)}`);
            if (typeof c.opacity === 'number') parts.push(`op ${(c.opacity * 100).toFixed(0)}%`);
            return parts.length ? `${start} · ${parts.join(' · ')}` : t('animations.noChange');
        }
        if (arraysDiffer(c.position, p.position)) parts.push(`pos ${fmtVec(c.position)}`);
        if (arraysDiffer(c.rotation, p.rotation)) parts.push(`rot ${fmtVecDeg(c.rotation)}`);
        if (arraysDiffer(c.scale, p.scale, 0.005)) parts.push(`scl ${fmtVec(c.scale, 2)}`);
        if (typeof c.opacity === 'number' && typeof p.opacity === 'number'
            && Math.abs(c.opacity - p.opacity) > DIFF_EPS) parts.push(`op ${(c.opacity * 100).toFixed(0)}%`);
    }

    return parts.length ? parts.join(' · ') : t('animations.noChange');
}

function propRow(trackKey, inner) {
    return `
        <div class="kf-prop-row" data-track-key="${trackKey}">
            ${inner}
            <button class="kf-prop-delete" title="${t('animations.deletePropTitle')}">×</button>
        </div>
    `;
}

// Skip rows whose track has no entries — reading spec values from an empty snapshot would throw.
function propRowIf(seq, trackKey, inner) {
    return (seq.tracks?.[trackKey]?.length > 0) ? propRow(trackKey, inner) : '';
}

function liveCameraSection(kf, seq) {
    const c = kf.snapshot.liveCamera;
    if (!c) return '';
    return `
        <div class="kf-section">
            <div class="kf-section-title">${t('cameras.live')}</div>
            ${c.position ? propRowIf(seq, 'liveCamera.position', `
                <label>${t('cameras.position')}
                    <input type="number" step="0.1" value="${c.position[0]}" data-path="liveCamera.position.0">
                    <input type="number" step="0.1" value="${c.position[1]}" data-path="liveCamera.position.1">
                    <input type="number" step="0.1" value="${c.position[2]}" data-path="liveCamera.position.2">
                </label>
            `) : ''}
            ${c.rotation ? propRowIf(seq, 'liveCamera.rotation', `
                <label>${t('cameras.rotationDeg')}
                    <input type="number" step="1" value="${(c.rotation[0] * RAD2DEG).toFixed(1)}" data-path="liveCamera.rotation.0" data-deg>
                    <input type="number" step="1" value="${(c.rotation[1] * RAD2DEG).toFixed(1)}" data-path="liveCamera.rotation.1" data-deg>
                    <input type="number" step="1" value="${(c.rotation[2] * RAD2DEG).toFixed(1)}" data-path="liveCamera.rotation.2" data-deg>
                </label>
            `) : ''}
            ${typeof c.fov === 'number' ? propRowIf(seq, 'liveCamera.fov', `
                <label>${t('cameras.fov')}
                    <input type="number" step="1" min="10" max="120" value="${c.fov}" data-path="liveCamera.fov">
                </label>
            `) : ''}
        </div>
    `;
}

function lightSection(kf, lightId, seq) {
    const l = kf.snapshot.lights?.[lightId];
    if (!l) return '';
    const spec = registry.getLight(lightId)?.spec;
    const label = spec?.name || lightId;
    const isAmbient = spec?.type === 'Ambient';
    const isSpot = spec?.type === 'Spot';
    const showPos = !isAmbient;
    const tk = (prop) => `light:${lightId}.${prop}`;
    const colorEntry = seq?.tracks?.[tk('color')]?.find(e => Math.abs(e.t - kf.t) < 0.001);
    const colorBinding = colorEntry?.binding || 'static';
    const colorBound = colorBinding !== 'static';
    const colorShown = effectiveColor(colorToHex(l.color), colorBinding);
    return `
        <div class="kf-section">
            <div class="kf-section-title">${ICON_LIGHT} ${label} <span class="muted">(${lightId})</span></div>
            ${typeof l.intensity === 'number' ? propRowIf(seq, tk('intensity'), `
                <label>${t('lights.intensity')}
                    <input type="number" step="1" min="0" value="${l.intensity}" data-path="lights.${lightId}.intensity">
                </label>
            `) : ''}
            ${l.color ? propRowIf(seq, tk('color'), `
                <label>${t('lights.color')}
                    <input type="color" value="${colorShown}" data-path="lights.${lightId}.color" ${colorBound ? 'disabled' : ''}>
                    ${bindingSelectHtml(colorBinding)}
                </label>
            `) : ''}
            ${showPos && l.position ? propRowIf(seq, tk('position'), `
                <label>${t('cameras.position')}
                    <input type="number" step="0.1" value="${l.position[0]}" data-path="lights.${lightId}.position.0">
                    <input type="number" step="0.1" value="${l.position[1]}" data-path="lights.${lightId}.position.1">
                    <input type="number" step="0.1" value="${l.position[2]}" data-path="lights.${lightId}.position.2">
                </label>
            `) : ''}
            ${showPos && l.target ? propRowIf(seq, tk('target'), `
                <label>${t('lights.target')}
                    <input type="number" step="0.1" value="${l.target[0]}" data-path="lights.${lightId}.target.0">
                    <input type="number" step="0.1" value="${l.target[1]}" data-path="lights.${lightId}.target.1">
                    <input type="number" step="0.1" value="${l.target[2]}" data-path="lights.${lightId}.target.2">
                </label>
            `) : ''}
            ${isSpot && l.extras ? propRowIf(seq, tk('extras'), `
                <label>${t('lights.angle')}°
                    <input type="number" step="1" min="0" max="90" value="${((l.extras?.angle ?? 0) * RAD2DEG).toFixed(1)}" data-path="lights.${lightId}.extras.angle" data-deg>
                </label>
            `) : ''}
            ${isSpot ? propRowIf(seq, tk('penumbra'), `
                <label>${t('lights.penumbra')}
                    <input type="number" step="0.05" min="0" max="1" value="${l.penumbra ?? 0}" data-path="lights.${lightId}.penumbra">
                </label>
            `) : ''}
            ${isSpot ? propRowIf(seq, tk('coneOpacity'), `
                <label>${t('lights.coneOpacity')}
                    <input type="number" step="0.05" min="0" max="1" value="${l.coneOpacity ?? 0.2}" data-path="lights.${lightId}.coneOpacity">
                </label>
            `) : ''}
        </div>
    `;
}

function slotSection(kf, slotId, seq) {
    const s = kf.snapshot.slots?.[slotId];
    if (!s) return '';
    const spec = registry.getSlot(slotId);
    const label = spec?.label || slotId;
    const tk = (prop) => `slot:${slotId}.${prop}`;
    return `
        <div class="kf-section">
            <div class="kf-section-title">${ICON_SLOT} ${label} <span class="muted">(${slotId})</span></div>
            ${s.position ? propRowIf(seq, tk('position'), `
                <label>${t('characters.position')}
                    <input type="number" step="0.1" value="${s.position[0]}" data-path="slots.${slotId}.position.0">
                    <input type="number" step="0.1" value="${s.position[1]}" data-path="slots.${slotId}.position.1">
                    <input type="number" step="0.1" value="${s.position[2]}" data-path="slots.${slotId}.position.2">
                </label>
            `) : ''}
            ${s.rotation ? propRowIf(seq, tk('rotation'), `
                <label>${t('characters.rotation')}°
                    <input type="number" step="1" value="${(s.rotation[0] * RAD2DEG).toFixed(1)}" data-path="slots.${slotId}.rotation.0" data-deg>
                    <input type="number" step="1" value="${(s.rotation[1] * RAD2DEG).toFixed(1)}" data-path="slots.${slotId}.rotation.1" data-deg>
                    <input type="number" step="1" value="${(s.rotation[2] * RAD2DEG).toFixed(1)}" data-path="slots.${slotId}.rotation.2" data-deg>
                </label>
            `) : ''}
            ${s.scale ? propRowIf(seq, tk('scale'), `
                <label>${t('characters.scale')}
                    <input type="number" step="0.05" min="0.01" value="${s.scale[0]}" data-path="slots.${slotId}.scale.uniform">
                </label>
            `) : ''}
        </div>
    `;
}

function assetSection(kf, assetId, seq) {
    const a = kf.snapshot.assets?.[assetId];
    if (!a) return '';
    const spec = registry.getAsset(assetId)?.spec;
    const name = spec?.name || assetId;
    const tk = (prop) => `asset:${assetId}.${prop}`;
    return `
        <div class="kf-section">
            <div class="kf-section-title">${ICON_ASSET} ${name} <span class="muted">(${assetId})</span></div>
            ${a.position ? propRowIf(seq, tk('position'), `
                <label>${t('assets.pos')}
                    <input type="number" step="0.1" value="${a.position[0]}" data-path="assets.${assetId}.position.0">
                    <input type="number" step="0.1" value="${a.position[1]}" data-path="assets.${assetId}.position.1">
                    <input type="number" step="0.1" value="${a.position[2]}" data-path="assets.${assetId}.position.2">
                </label>
            `) : ''}
            ${a.rotation ? propRowIf(seq, tk('rotation'), `
                <label>${t('assets.rotationDeg')}
                    <input type="number" step="1" value="${(a.rotation[0] * RAD2DEG).toFixed(1)}" data-path="assets.${assetId}.rotation.0" data-deg>
                    <input type="number" step="1" value="${(a.rotation[1] * RAD2DEG).toFixed(1)}" data-path="assets.${assetId}.rotation.1" data-deg>
                    <input type="number" step="1" value="${(a.rotation[2] * RAD2DEG).toFixed(1)}" data-path="assets.${assetId}.rotation.2" data-deg>
                </label>
            `) : ''}
            ${a.scale ? propRowIf(seq, tk('scale'), `
                <label>${t('assets.scale')}
                    <input type="number" step="0.05" value="${a.scale[0]}" data-path="assets.${assetId}.scale.0">
                    <input type="number" step="0.05" value="${a.scale[1]}" data-path="assets.${assetId}.scale.1">
                    <input type="number" step="0.05" value="${a.scale[2]}" data-path="assets.${assetId}.scale.2">
                </label>
            `) : ''}
            ${typeof a.opacity === 'number' ? propRowIf(seq, tk('opacity'), `
                <label>${t('assets.opacity')}
                    <input type="number" step="0.05" min="0" max="1" value="${a.opacity ?? 1}" data-path="assets.${assetId}.opacity">
                </label>
            `) : ''}
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
                // Uniform slot scale: one input drives all three components.
                if (path.endsWith('.scale.uniform')) {
                    const parent = resolvePath(snap, path.slice(0, -'.uniform'.length));
                    if (!parent) return;
                    const u = parseFloat(el.value);
                    if (Number.isNaN(u)) return;
                    parent.parent[parent.key] = [u, u, u];
                    return;
                }
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
    // Per-property delete: removes just this track's entry at this kf's t.
    container.querySelectorAll('.kf-prop-delete').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const row = btn.closest('.kf-prop-row');
            const trackKey = row?.dataset.trackKey;
            if (!trackKey) return;
            sequencer.removeTrackEntry(seq.id, trackKey, kf.t);
            renderAnimationsPanel();
        };
    });
    // Color-binding dropdowns live inside the propRow for a color-valued track.
    container.querySelectorAll('.color-binding-select').forEach(sel => {
        sel.onchange = () => {
            const row = sel.closest('.kf-prop-row');
            const trackKey = row?.dataset.trackKey;
            if (!trackKey) return;
            sequencer.setTrackEntryBinding(seq.id, trackKey, kf.t, sel.value);
            renderAnimationsPanel();
        };
    });
}

function keyframeRow(seq, kf, prevKf) {
    const isOpen = expandedKeyframes.has(kf);

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
            deselectKeyframePreview(seq, kf);
            renderAnimationsPanel();
        };
    } else {
        row.onclick = (e) => {
            if (e.target.closest('input, button')) return;
            selectKeyframePreview(seq, kf);
            renderAnimationsPanel();
        };
    }

    row.querySelector('.kf-time').onchange = (e) => {
        const newT = parseFloat(e.target.value);
        if (Number.isNaN(newT)) return;
        // Ref-based so duplicate-t kfs don't get swapped.
        sequencer.setKeyframeTimeRef(seq.id, kf, newT);
        renderAnimationsPanel();
    };

    row.querySelector('.kf-duplicate').onclick = () => {
        const newT = sequencer.duplicateKeyframe(seq.id, kf.t);
        renderAnimationsPanel();
        if (newT != null) pulseKeyframeRow(seq.id, newT);
    };

    row.querySelector('.kf-delete').onclick = () => {
        // Restore the anchor before deleting so the scene doesn't get stuck on a removed kf.
        if (expandedKeyframes.has(kf)) deselectKeyframePreview(seq, kf);
        sequencer.removeKeyframeRef(seq.id, kf);
        renderAnimationsPanel();
    };

    if (isOpen) {
        const detail = row.querySelector('.kf-detail');
        const sections = [];
        if (seq.targets.includes('liveCamera')) sections.push(liveCameraSection(kf, seq));
        for (const target of seq.targets) {
            if (target.startsWith('light:')) sections.push(lightSection(kf, target.slice('light:'.length), seq));
            if (target.startsWith('slot:')) sections.push(slotSection(kf, target.slice('slot:'.length), seq));
            if (target.startsWith('asset:')) sections.push(assetSection(kf, target.slice('asset:'.length), seq));
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

function compatibleTargets(target) {
    if (!target) return [];
    if (target === 'liveCamera') return ['liveCamera'];
    const prefix = target.slice(0, target.indexOf(':') + 1);
    return availableTargets().filter(t => t.startsWith(prefix));
}

function targetSection(seq) {
    const target = seq.targets[0];
    const hasKeyframes = seq.keyframes.length > 0;
    const resetTitle = hasKeyframes
        ? t('animations.resetTitle')
        : t('animations.noKeyframesYet');

    if (!target) {
        return `
            <label>${t('animations.animating')}</label>
            <div class="target-list">
                <span class="muted">${t('animations.noTarget')}</span>
            </div>
        `;
    }

    const siblings = compatibleTargets(target);
    const canRetarget = siblings.length > 1;
    const labelHtml = canRetarget
        ? `<select class="target-retarget" title="${t('animations.retargetTitle')}">
              ${siblings.map(s => `<option value="${s}" ${s === target ? 'selected' : ''}>${targetLabel(s)}</option>`).join('')}
           </select>`
        : `<span class="target-chip-label">${targetLabel(target)}</span>`;

    return `
        <label>${t('animations.animating')}</label>
        <div class="target-list">
            <span class="target-chip" data-target="${target}" title="${t('animations.attachGizmo')}">
                ${labelHtml}
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
        : list.map(s => `<span class="trigger-mini">${eventLabel(s)}</span>`).join('');

    const triggerPills = (kind, current) => events.map(e => `
        <label class="trigger-pill">
            <input type="checkbox" data-kind="${kind}" value="${e}" ${current.includes(e) ? 'checked' : ''}>
            ${eventLabel(e)}
        </label>
    `).join('');

    row.innerHTML = `
        <div class="row-head">
            <input class="name-input" type="text" value="${spec.name}">
            <span class="seq-duration muted">${duration.toFixed(2)}s</span>
            <button class="play-btn" title="${playing ? t('animations.stopTitle') : t('animations.playTitle')}">${playing ? '■' : '▶'}</button>
            <button class="scrub-btn ${scrubId === spec.id ? 'active' : ''}" title="${t('animations.scrubTitle')}" ${spec.keyframes.length === 0 ? 'disabled' : ''}>↔</button>
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
            if (scrubId === spec.id) closeScrubBar();
            renderAnimationsPanel();
        };
    } else {
        row.onclick = (e) => {
            if (e.target.closest('input, button')) return;
            expandedSequences.add(spec.id);
            openScrubBar(spec.id);
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
    row.querySelector('.scrub-btn').onclick = () => {
        if (scrubId === spec.id) closeScrubBar();
        else openScrubBar(spec.id);
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
            if (e.target.closest('.target-reset, .target-retarget')) return;
            selectTarget(chip.dataset.target);
        };
    });
    row.querySelectorAll('.target-retarget').forEach(sel => {
        sel.onchange = (e) => {
            e.stopPropagation();
            const newTarget = sel.value;
            if (!newTarget || newTarget === spec.targets[0]) return;
            if (sequencer.retargetSequence(spec.id, newTarget)) {
                selectTarget(newTarget);
                renderAnimationsPanel();
            }
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

const ICON_CLIP = '🎞';

function clipTriggerPills(kind, current, events) {
    return events.map(e => `
        <label class="trigger-pill">
            <input type="checkbox" data-kind="${kind}" value="${e}" ${current.includes(e) ? 'checked' : ''}>
            ${eventLabel(e)}
        </label>
    `).join('');
}

function clipRow(clip) {
    const row = document.createElement('div');
    const isExpanded = expandedClips.has(clip.name);
    row.className = 'editor-row seq-row' + (isExpanded ? ' open' : '');
    row.dataset.clip = clip.name;

    const events = listKnownEvents();
    const cfg = clip.config;
    const playing = clipManager.isPlaying(clip.name);

    const pillsHtml = (list) => list.length === 0
        ? `<span class="muted">${t('animations.none')}</span>`
        : list.map(s => `<span class="trigger-mini">${eventLabel(s)}</span>`).join('');

    // Head layout mirrors seq-row so the two sections read consistently.
    row.innerHTML = `
        <div class="row-head">
            <span class="name-input" style="flex:1;padding:3px 6px;font-size:11px;color:#fff;">
                ${ICON_CLIP} ${clip.localName || clip.name}
            </span>
            <span class="seq-duration muted">${clip.duration.toFixed(2)}s</span>
            <button class="play-btn" title="${playing ? t('clips.stopTitle') : t('clips.playTitle')}">${playing ? '■' : '▶'}</button>
        </div>
        ${isExpanded ? `
        <div class="row-body">
            <label class="loop-row">
                <input type="checkbox" class="loop-toggle" ${cfg.loop ? 'checked' : ''}>
                ${t('clips.loop')}
            </label>

            <label>${t('clips.speed')}
                <input type="number" class="speed-input" step="0.1" min="0.05" value="${(cfg.speed ?? 1.0).toFixed(2)}">
            </label>

            <label>${cfg.loop ? t('clips.startTriggers') : t('clips.triggers')}</label>
            <div class="trigger-list" data-kind="triggers">
                ${clipTriggerPills('triggers', cfg.triggers || [], events)}
            </div>

            ${cfg.loop ? `
            <label>${t('clips.stopTriggers')}</label>
            <div class="trigger-list" data-kind="stopTriggers">
                ${clipTriggerPills('stopTriggers', cfg.stopTriggers || [], events)}
            </div>` : ''}
        </div>`
        : `
        <div class="seq-summary">
            <div class="seq-trigger-line">
                <span class="seq-trigger-label">${(cfg.loop ? t('animations.start') : t('animations.on'))}:</span>
                ${pillsHtml(cfg.triggers || [])}
                ${cfg.loop ? ` <span class="seq-loop-tag">${t('animations.loopTag')}</span>` : ''}
            </div>
            ${cfg.loop && (cfg.stopTriggers || []).length > 0 ? `
            <div class="seq-trigger-line">
                <span class="seq-trigger-label">${t('animations.stop')}:</span>
                ${pillsHtml(cfg.stopTriggers)}
            </div>` : ''}
        </div>`}
    `;

    if (isExpanded) {
        row.querySelector('.row-head').onclick = (e) => {
            if (e.target.closest('input, button')) return;
            expandedClips.delete(clip.name);
            renderAnimationsPanel();
        };
    } else {
        row.onclick = (e) => {
            if (e.target.closest('input, button')) return;
            expandedClips.add(clip.name);
            renderAnimationsPanel();
        };
    }

    row.querySelector('.play-btn').onclick = () => {
        if (clipManager.isPlaying(clip.name)) {
            stopClip(clip.name);
        } else {
            playClip(clip.name);
        }
        renderAnimationsPanel();
    };

    if (!isExpanded) return row;

    // Toggling loop rehsapes the UI (shows/hides stop-triggers list).
    row.querySelector('.loop-toggle').onchange = (e) => {
        clipManager.updateConfig(clip.name, { loop: e.target.checked });
        renderAnimationsPanel();
    };

    row.querySelector('.speed-input').oninput = (e) => {
        const raw = parseFloat(e.target.value);
        if (Number.isNaN(raw) || raw <= 0) return;
        clipManager.updateConfig(clip.name, { speed: raw });
    };

    row.querySelectorAll('.trigger-list input[type="checkbox"]').forEach(cb => {
        cb.onchange = () => {
            const kind = cb.dataset.kind;
            const checked = Array.from(
                row.querySelectorAll(`.trigger-list input[type="checkbox"][data-kind="${kind}"]:checked`)
            ).map(el => el.value);
            clipManager.updateConfig(clip.name, { [kind]: checked });
        };
    });

    return row;
}

function renderClipsSection(pane) {
    // Scene-only; asset clips live under their asset in the Assets tab.
    const clips = clipManager.listClips().filter(c => c.sourceId === 'scene');

    const heading = document.createElement('div');
    heading.className = 'editor-section-heading';
    heading.textContent = t('clips.sectionTitle');
    heading.style.cssText = 'margin-top:12px;margin-bottom:6px;color:#b3b3b3;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;';
    pane.appendChild(heading);

    if (clips.length === 0) {
        const note = document.createElement('div');
        note.className = 'editor-note';
        note.style.cssText = 'font-size:11px;color:#8a8a8a;';
        note.textContent = t('clips.none');
        pane.appendChild(note);
        return;
    }

    const list = document.createElement('div');
    list.className = 'editor-list';
    clips.forEach(clip => list.appendChild(clipRow(clip)));
    pane.appendChild(list);
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
        clipManager.stopAll();
        renderAnimationsPanel();
    };

    renderClipsSection(pane);
}
