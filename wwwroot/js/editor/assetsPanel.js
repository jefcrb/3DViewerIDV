import { registry } from './registry.js';
import { selectTarget } from './editorMode.js';
import { t } from '../i18n.js';
import { SCENE_ID } from '../config.js';
import { clipManager } from '../animation/clips.js';
import { listKnownEvents, playClip, stopClip } from '../animation/triggers.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

const expandedAssets = new Set();
const expandedAssetClips = new Set();

function triggerPills(kind, current, events) {
    return events.map(e => `
        <label class="trigger-pill">
            <input type="checkbox" data-kind="${kind}" value="${e}" ${current.includes(e) ? 'checked' : ''}>
            ${e}
        </label>
    `).join('');
}

function clipBlock(clip) {
    const cfg = clip.config;
    const playing = clipManager.isPlaying(clip.name);
    const isExpanded = expandedAssetClips.has(clip.name);
    const events = listKnownEvents();
    const pillsSummary = (list) => list.length === 0
        ? `<span class="muted">${t('animations.none')}</span>`
        : list.map(s => `<span class="trigger-mini">${s}</span>`).join('');
    return `
        <div class="asset-clip${isExpanded ? ' open' : ''}" data-clip="${clip.name}">
            <div class="asset-clip-head">
                <span class="asset-clip-caret">${isExpanded ? '▾' : '▸'}</span>
                <span class="asset-clip-name">${clip.localName || clip.name}</span>
                <span class="asset-clip-duration muted">${clip.duration.toFixed(2)}s</span>
                <button class="asset-clip-play" title="${playing ? t('clips.stopTitle') : t('clips.playTitle')}">${playing ? '■' : '▶'}</button>
            </div>
            ${isExpanded ? `
            <div class="asset-clip-body">
                <label class="loop-row">
                    <input type="checkbox" class="loop-toggle" ${cfg.loop ? 'checked' : ''}>
                    ${t('clips.loop')}
                </label>
                <label>${t('clips.speed')}
                    <input type="number" class="speed-input" step="0.1" min="0.05" value="${(cfg.speed ?? 1.0).toFixed(2)}">
                </label>
                <label>${cfg.loop ? t('clips.startTriggers') : t('clips.triggers')}</label>
                <div class="trigger-list" data-kind="triggers">
                    ${triggerPills('triggers', cfg.triggers || [], events)}
                </div>
                ${cfg.loop ? `
                <label>${t('clips.stopTriggers')}</label>
                <div class="trigger-list" data-kind="stopTriggers">
                    ${triggerPills('stopTriggers', cfg.stopTriggers || [], events)}
                </div>` : ''}
            </div>` : `
            <div class="asset-clip-summary">
                <span class="asset-clip-summary-label">${(cfg.loop ? t('animations.start') : t('animations.on'))}:</span>
                ${pillsSummary(cfg.triggers || [])}
                ${cfg.loop ? ` <span class="seq-loop-tag">${t('animations.loopTag')}</span>` : ''}
            </div>`}
        </div>
    `;
}

function wireClipBlock(root, clip) {
    root.querySelector('.asset-clip-play').onclick = (e) => {
        e.stopPropagation();
        if (clipManager.isPlaying(clip.name)) stopClip(clip.name);
        else playClip(clip.name);
    };
    root.querySelector('.asset-clip-head').onclick = (e) => {
        if (e.target.closest('button')) return;
        if (expandedAssetClips.has(clip.name)) expandedAssetClips.delete(clip.name);
        else expandedAssetClips.add(clip.name);
        renderAssetsPanel();
    };
    const loop = root.querySelector('.loop-toggle');
    if (loop) loop.onchange = (e) => {
        clipManager.updateConfig(clip.name, { loop: e.target.checked });
        renderAssetsPanel();
    };
    const speed = root.querySelector('.speed-input');
    if (speed) speed.oninput = (e) => {
        const raw = parseFloat(e.target.value);
        if (Number.isNaN(raw) || raw <= 0) return;
        clipManager.updateConfig(clip.name, { speed: raw });
    };
    root.querySelectorAll('.trigger-list input[type="checkbox"]').forEach(cb => {
        cb.onchange = () => {
            const kind = cb.dataset.kind;
            const checked = Array.from(
                root.querySelectorAll(`.trigger-list input[type="checkbox"][data-kind="${kind}"]:checked`)
            ).map(el => el.value);
            clipManager.updateConfig(clip.name, { [kind]: checked });
        };
    });
}

function assetRow(spec) {
    const row = document.createElement('div');
    const isExpanded = expandedAssets.has(spec.id);
    row.className = 'editor-row seq-row asset-row' + (isExpanded ? ' open' : '');
    row.dataset.id = spec.id;
    const entry = registry.getAsset(spec.id);
    const loading = entry?.loading;
    const clips = clipManager.listClips().filter(c => c.sourceId === `asset:${spec.id}`);

    row.innerHTML = `
        <div class="row-head">
            <button class="asset-caret" title="${isExpanded ? t('assets.collapse') : t('assets.expand')}">${isExpanded ? '▾' : '▸'}</button>
            <input class="name-input" type="text" value="${spec.name}" ${loading ? 'disabled' : ''}>
            <button class="select-btn" title="${t('assets.selectTitle')}">⊕</button>
            <button class="duplicate-btn" title="${t('assets.duplicateTitle')}">⧉</button>
            <button class="remove-btn" title="${t('assets.removeTitle')}">×</button>
        </div>
        ${isExpanded ? `
        <div class="row-body">
            ${loading ? `<div class="hint">${t('assets.loading')}</div>` : ''}
            <label>${t('assets.pos')}
                <input type="number" step="0.1" value="${spec.position[0]}" class="pos-x">
                <input type="number" step="0.1" value="${spec.position[1]}" class="pos-y">
                <input type="number" step="0.1" value="${spec.position[2]}" class="pos-z">
            </label>
            <label>${t('assets.rotationDeg')}
                <input type="number" step="1" value="${(spec.rotation[0] * RAD2DEG).toFixed(1)}" class="rot-x" data-deg>
                <input type="number" step="1" value="${(spec.rotation[1] * RAD2DEG).toFixed(1)}" class="rot-y" data-deg>
                <input type="number" step="1" value="${(spec.rotation[2] * RAD2DEG).toFixed(1)}" class="rot-z" data-deg>
            </label>
            <label>${t('assets.scale')}
                <input type="number" step="0.05" value="${spec.scale[0]}" class="scl-x">
                <input type="number" step="0.05" value="${spec.scale[1]}" class="scl-y">
                <input type="number" step="0.05" value="${spec.scale[2]}" class="scl-z">
            </label>
            <label class="slider-row">${t('assets.opacity')}
                <input type="range" min="0" max="1" step="0.01" value="${spec.opacity}" class="opacity-input">
                <span class="opacity-value">${(spec.opacity * 100).toFixed(0)}%</span>
            </label>
            <div class="asset-clips-section">
                <div class="asset-clips-heading">${t('assets.builtInAnimations')} (${clips.length})</div>
                ${loading ? `<div class="hint">${t('assets.loading')}</div>` : clips.map(clipBlock).join('')}
            </div>
        </div>` : `
        <div class="seq-summary">
            <div class="seq-trigger-line">
                <span class="seq-trigger-label muted">${clips.length} ${clips.length === 1 ? t('assets.clipOne') : t('assets.clipMany')}</span>
            </div>
        </div>`}
    `;

    row.querySelector('.asset-caret').onclick = (e) => {
        e.stopPropagation();
        if (isExpanded) expandedAssets.delete(spec.id);
        else expandedAssets.add(spec.id);
        renderAssetsPanel();
    };
    if (!isExpanded) {
        row.onclick = (e) => {
            if (e.target.closest('input, button')) return;
            expandedAssets.add(spec.id);
            renderAssetsPanel();
        };
    }

    row.querySelector('.select-btn').onclick = () => selectTarget(`asset:${spec.id}`);
    row.querySelector('.duplicate-btn').onclick = (e) => {
        e.stopPropagation();
        if (loading) return;
        const newId = registry.addAsset({
            filename: spec.filename,
            name: `${spec.name} (copy)`,
            position: [...spec.position],
            rotation: [...spec.rotation],
            scale: [...spec.scale],
            opacity: spec.opacity
        });
        if (newId) {
            expandedAssets.add(newId);
            const onLoaded = (ev) => {
                if (ev.detail?.id !== newId) return;
                registry.removeEventListener('assets:loaded', onLoaded);
                selectTarget(`asset:${newId}`);
            };
            registry.addEventListener('assets:loaded', onLoaded);
        }
    };
    row.querySelector('.remove-btn').onclick = async () => {
        // Only delete the server-side file when no other asset references it.
        const shared = registry.listAssets().some(a => a.id !== spec.id && a.filename === spec.filename);
        if (!shared) {
            try {
                await fetch(`/api/scenes/${SCENE_ID}/assets/${spec.filename}`, { method: 'DELETE' });
            } catch (err) {
                console.warn('Asset file delete failed:', err);
            }
        }
        expandedAssets.delete(spec.id);
        registry.removeAsset(spec.id);
    };

    if (!isExpanded) return row;

    const readPartial = () => ({
        name: row.querySelector('.name-input').value,
        position: [
            parseFloat(row.querySelector('.pos-x').value),
            parseFloat(row.querySelector('.pos-y').value),
            parseFloat(row.querySelector('.pos-z').value)
        ],
        rotation: [
            parseFloat(row.querySelector('.rot-x').value) * DEG2RAD,
            parseFloat(row.querySelector('.rot-y').value) * DEG2RAD,
            parseFloat(row.querySelector('.rot-z').value) * DEG2RAD
        ],
        scale: [
            parseFloat(row.querySelector('.scl-x').value),
            parseFloat(row.querySelector('.scl-y').value),
            parseFloat(row.querySelector('.scl-z').value)
        ],
        opacity: parseFloat(row.querySelector('.opacity-input').value)
    });

    row.querySelectorAll('.row-body > label input, .row-body > label input[type="range"], .name-input').forEach(el => {
        el.oninput = () => {
            const opv = row.querySelector('.opacity-value');
            if (opv) opv.textContent = `${(parseFloat(row.querySelector('.opacity-input').value) * 100).toFixed(0)}%`;
            registry.updateAsset(spec.id, readPartial());
        };
    });

    // Wire each clip's controls.
    clips.forEach(clip => {
        const el = row.querySelector(`.asset-clip[data-clip="${CSS.escape(clip.name)}"]`);
        if (el) wireClipBlock(el, clip);
    });

    return row;
}

async function uploadAssetFile(file) {
    const res = await fetch(`/api/scenes/${SCENE_ID}/assets`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream',
            'X-Asset-Name': encodeURIComponent(file.name)
        },
        body: file
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
}

export function renderAssetsPanel() {
    const pane = document.querySelector('.tab-pane[data-tab="assets"]');
    if (!pane) return;
    pane.innerHTML = '';

    const list = document.createElement('div');
    list.className = 'editor-list';
    registry.listAssets().forEach(spec => list.appendChild(assetRow(spec)));
    pane.appendChild(list);

    const addBar = document.createElement('div');
    addBar.className = 'add-bar';
    addBar.innerHTML = `
        <button id="addAssetBtn">${t('assets.upload')}</button>
        <input type="file" id="assetFileInput" accept=".glb,.gltf" hidden>
    `;
    pane.appendChild(addBar);

    const fileInput = addBar.querySelector('#assetFileInput');
    addBar.querySelector('#addAssetBtn').onclick = () => fileInput.click();
    fileInput.onchange = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const { id, filename, originalName } = await uploadAssetFile(file);
            const name = decodeURIComponent(originalName || file.name).replace(/\.(glb|gltf)$/i, '');
            const assetId = registry.addAsset({
                id, filename, name,
                position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], opacity: 1
            });
            if (assetId) {
                expandedAssets.add(assetId);
                const onLoaded = (e) => {
                    if (e.detail?.id !== assetId) return;
                    registry.removeEventListener('assets:loaded', onLoaded);
                    selectTarget(`asset:${assetId}`);
                };
                registry.addEventListener('assets:loaded', onLoaded);
            }
        } catch (err) {
            console.error('Asset upload failed:', err);
            alert(t('assets.uploadFailed'));
        }
    };
}

// Full re-render only when clip set changes (asset load/unload). Play/stop just refreshes
// the affected button so we don't steal focus from an input the user is typing into.
clipManager.addEventListener('source:add', () => renderAssetsPanel());
clipManager.addEventListener('source:remove', () => renderAssetsPanel());
function refreshClipPlayButton(name) {
    const el = document.querySelector(`.asset-clip[data-clip="${CSS.escape(name)}"] .asset-clip-play`);
    if (!el) return;
    const playing = clipManager.isPlaying(name);
    el.textContent = playing ? '■' : '▶';
    el.title = playing ? t('clips.stopTitle') : t('clips.playTitle');
}
clipManager.addEventListener('clip:play', (e) => refreshClipPlayButton(e.detail.name));
clipManager.addEventListener('clip:stop', (e) => refreshClipPlayButton(e.detail.name));
