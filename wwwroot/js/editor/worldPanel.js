import { registry } from './registry.js';
import { SHADOW_MAP_TYPES, TONE_MAPPING_TYPES, SKYBOX_MAPPINGS } from './registry.js';
import { t } from '../i18n.js';
import { bindingSelectHtml, effectiveColor } from './colorBinding.js';
import { onTeamColorsChange } from '../state/teamColors.js';
import { FILTER_TYPES } from '../scene/postFx.js';

let teamColorsSubscribed = false;

const SHADOW_MAP_SIZES = [256, 512, 1024, 2048, 4096];

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
    });
}

function filtersMarkup(list) {
    if (!list.length) {
        return `<div class="hint" data-filter-empty>${t('world.addFilter').replace(/^\+ /, '')}…</div>`;
    }
    return list.map((f, i) => {
        const meta = FILTER_TYPES[f.type];
        if (!meta) return '';
        const params = { ...(meta.defaults || {}), ...f };
        return `
        <div class="filter-row" data-index="${i}">
            <div class="filter-row-head">
                <label class="filter-enable"><input type="checkbox" data-role="enabled" ${f.enabled !== false ? 'checked' : ''}></label>
                <span class="filter-row-name">${t(`world.filterType.${f.type}`)}</span>
                <button type="button" data-role="up" title="${t('world.filterMoveUp')}" ${i === 0 ? 'disabled' : ''}>▲</button>
                <button type="button" data-role="down" title="${t('world.filterMoveDown')}" ${i === list.length - 1 ? 'disabled' : ''}>▼</button>
                <button type="button" data-role="remove" title="${t('world.filterRemove')}">×</button>
            </div>
            <div class="filter-row-body">
                ${meta.params.map(p => `
                    <label class="slider-row">${t(`world.filterParam.${p.key}`)}
                        <input type="range" data-param="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${params[p.key]}">
                        <span data-param-value="${p.key}">${Number(params[p.key]).toFixed(p.precision)}</span>
                    </label>
                `).join('')}
            </div>
        </div>`;
    }).join('');
}

function wireFilters(pane) {
    const list = () => [...(registry.world.postFx || [])];
    const commit = (arr) => registry.updateWorld({ postFx: arr });

    pane.querySelector('#worldFilterAddBtn').onclick = () => {
        const type = pane.querySelector('#worldFilterTypeSelect').value;
        const meta = FILTER_TYPES[type];
        if (!meta) return;
        const next = list();
        next.push({ type, enabled: true, ...(meta.defaults || {}) });
        commit(next);
        renderWorldPanel();
    };

    pane.querySelectorAll('.filter-row').forEach(row => {
        const idx = parseInt(row.dataset.index);
        row.querySelector('[data-role="enabled"]').onchange = (e) => {
            const arr = list();
            arr[idx] = { ...arr[idx], enabled: e.target.checked };
            commit(arr);
        };
        row.querySelector('[data-role="remove"]').onclick = () => {
            const arr = list();
            arr.splice(idx, 1);
            commit(arr);
            renderWorldPanel();
        };
        const upBtn = row.querySelector('[data-role="up"]');
        if (upBtn && !upBtn.disabled) upBtn.onclick = () => {
            const arr = list();
            [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
            commit(arr);
            renderWorldPanel();
        };
        const downBtn = row.querySelector('[data-role="down"]');
        if (downBtn && !downBtn.disabled) downBtn.onclick = () => {
            const arr = list();
            [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
            commit(arr);
            renderWorldPanel();
        };
        row.querySelectorAll('input[type="range"][data-param]').forEach(input => {
            const key = input.dataset.param;
            const meta = FILTER_TYPES[list()[idx].type];
            const paramMeta = meta.params.find(p => p.key === key);
            const valSpan = row.querySelector(`[data-param-value="${key}"]`);
            input.oninput = () => {
                const v = parseFloat(input.value);
                valSpan.textContent = v.toFixed(paramMeta.precision);
                const arr = list();
                arr[idx] = { ...arr[idx], [key]: v };
                commit(arr);
            };
        });
    });
}


export function renderWorldPanel() {
    const pane = document.querySelector('.tab-pane[data-tab="world"]');
    if (!pane) return;
    const w = registry.world;

    if (!teamColorsSubscribed) {
        teamColorsSubscribed = true;
        onTeamColorsChange(() => {
            const bgEl = document.querySelector('#worldBgColor');
            if (bgEl && bgEl !== document.activeElement) {
                bgEl.value = effectiveColor(registry.world.backgroundColor, registry.world.backgroundColorBinding);
            }
        });
    }
    const hasImage = !!w.skyboxImage;
    const transparent = !!w.transparentBackground;
    const disAttr = transparent ? 'disabled' : '';
    pane.innerHTML = `
        <div class="editor-row">
            <div class="row-head"><strong>${t('world.skybox')}</strong></div>
            <div class="row-body">
                <div class="skybox-color-row">
                    <label>${t('world.skyboxColor')}
                        <input type="color" id="worldBgColor" value="${effectiveColor(w.backgroundColor, w.backgroundColorBinding)}" ${(transparent || (w.backgroundColorBinding && w.backgroundColorBinding !== 'static')) ? 'disabled' : ''}>
                        <span id="worldBgColorBindingSlot">${bindingSelectHtml(w.backgroundColorBinding)}</span>
                    </label>
                    <label><input type="checkbox" id="worldTransparentBg" ${transparent ? 'checked' : ''}> ${t('world.transparent')}</label>
                </div>
                <div class="skybox-image">
                    <div class="skybox-image-actions">
                        <button type="button" class="btn" id="worldSkyboxUpload" ${disAttr}>${hasImage ? t('world.replaceImage') : t('world.uploadImage')}</button>
                        <button type="button" class="btn" id="worldSkyboxClear" ${(hasImage && !transparent) ? '' : 'disabled'}>${t('world.clearImage')}</button>
                        <input type="file" id="worldSkyboxFile" accept="image/*" hidden>
                    </div>
                    ${hasImage ? `<img class="skybox-preview" src="${w.skyboxImage}" alt="skybox preview">` : ''}
                    ${hasImage ? `
                        <label class="slider-row">${t('world.skyboxImageOpacity')}
                            <input type="range" id="worldSkyboxImageOpacity" min="0" max="1" step="0.01" value="${w.skyboxImageOpacity ?? 1}" ${disAttr}>
                            <span id="worldSkyboxImageOpacityValue">${((w.skyboxImageOpacity ?? 1) * 100).toFixed(0)}%</span>
                        </label>
                        <label>${t('world.skyboxMapping')}
                            <select id="worldSkyboxMapping" ${disAttr}>
                                ${Object.keys(SKYBOX_MAPPINGS).map(name =>
                                    `<option value="${name}" ${name === w.skyboxMapping ? 'selected' : ''}>${name}</option>`
                                ).join('')}
                            </select>
                        </label>
                    ` : ''}
                    <div class="hint">${transparent ? t('world.transparentHint') : t('world.imageOverridesColor')}</div>
                </div>
            </div>
        </div>
        <div class="editor-row">
            <div class="row-head"><strong>${t('world.shadows')}</strong></div>
            <div class="row-body">
                <label><input type="checkbox" id="worldShadowsEnabled" ${w.shadowsEnabled ? 'checked' : ''}> ${t('world.enabled')}</label>
                <label>${t('world.filter')}
                    <select id="worldShadowType">
                        ${Object.keys(SHADOW_MAP_TYPES).map(name =>
                            `<option value="${name}" ${name === w.shadowMapType ? 'selected' : ''}>${name}</option>`
                        ).join('')}
                    </select>
                </label>
                <label>${t('world.mapSize')}
                    <select id="worldShadowMapSize">
                        ${SHADOW_MAP_SIZES.map(s =>
                            `<option value="${s}" ${s === w.shadowMapSize ? 'selected' : ''}>${s}×${s}</option>`
                        ).join('')}
                    </select>
                </label>
                <label class="slider-row">${t('world.bias')}
                    <input type="range" id="worldShadowBias" min="-0.01" max="0.01" step="0.0001" value="${w.shadowBias}">
                    <span id="worldShadowBiasValue">${w.shadowBias.toFixed(4)}</span>
                </label>
                <label class="slider-row">${t('world.normalBias')}
                    <input type="range" id="worldShadowNormalBias" min="0" max="0.5" step="0.001" value="${w.shadowNormalBias}">
                    <span id="worldShadowNormalBiasValue">${w.shadowNormalBias.toFixed(3)}</span>
                </label>
                <label class="slider-row">${t('world.softness')}
                    <input type="range" id="worldShadowRadius" min="0" max="16" step="0.5" value="${w.shadowRadius}">
                    <span id="worldShadowRadiusValue">${w.shadowRadius.toFixed(1)}</span>
                </label>
                <label class="slider-row">${t('world.dirBounds')}
                    <input type="range" id="worldDirShadowBounds" min="5" max="60" step="1" value="${w.directionalShadowBounds}">
                    <span id="worldDirShadowBoundsValue">${w.directionalShadowBounds.toFixed(0)}</span>
                </label>
                <label class="slider-row">${t('world.dirFar')}
                    <input type="range" id="worldDirShadowFar" min="20" max="200" step="5" value="${w.directionalShadowFar}">
                    <span id="worldDirShadowFarValue">${w.directionalShadowFar.toFixed(0)}</span>
                </label>
            </div>
        </div>
        <div class="editor-row">
            <div class="row-head"><strong>${t('world.toneMapping')}</strong></div>
            <div class="row-body">
                <label>${t('world.toneMode')}
                    <select id="worldToneMapping">
                        ${Object.keys(TONE_MAPPING_TYPES).map(name =>
                            `<option value="${name}" ${name === w.toneMapping ? 'selected' : ''}>${name}</option>`
                        ).join('')}
                    </select>
                </label>
                <label class="slider-row">${t('world.exposure')}
                    <input type="range" id="worldToneExposure" min="0" max="4" step="0.01" value="${w.toneMappingExposure}">
                    <span id="worldToneExposureValue">${w.toneMappingExposure.toFixed(2)}</span>
                </label>
            </div>
        </div>
        <div class="editor-row">
            <div class="row-head"><strong>${t('world.filters')}</strong></div>
            <div class="row-body" id="worldFiltersBody">
                ${filtersMarkup(w.postFx || [])}
                <div class="add-bar filters-add-bar">
                    <select id="worldFilterTypeSelect">
                        ${Object.keys(FILTER_TYPES).map(k =>
                            `<option value="${k}">${t(`world.filterType.${k}`)}</option>`
                        ).join('')}
                    </select>
                    <button id="worldFilterAddBtn">${t('world.addFilter')}</button>
                </div>
            </div>
        </div>
        <div class="add-bar">
            <span style="color:#b3b3b3; flex:1; font-size:11px;">${t('world.perfHint')}</span>
        </div>
    `;

    pane.querySelector('#worldTransparentBg').onchange = (e) => {
        registry.updateWorld({ transparentBackground: e.target.checked });
        renderWorldPanel();
    };
    pane.querySelector('#worldBgColor').oninput = (e) => {
        registry.updateWorld({ backgroundColor: e.target.value });
    };
    const bgBindEl = pane.querySelector('#worldBgColorBindingSlot .color-binding-select');
    if (bgBindEl) bgBindEl.onchange = (e) => {
        registry.updateWorld({ backgroundColorBinding: e.target.value });
        renderWorldPanel();
    };

    const fileInput = pane.querySelector('#worldSkyboxFile');
    pane.querySelector('#worldSkyboxUpload').onclick = () => fileInput.click();
    fileInput.onchange = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // allow re-selecting the same file later
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) {
            alert(t('world.imageTooLarge'));
            return;
        }
        try {
            const dataUrl = await readFileAsDataURL(file);
            registry.updateWorld({ skyboxImage: dataUrl });
            renderWorldPanel();
        } catch (err) {
            console.error('Failed to read skybox image:', err);
        }
    };
    pane.querySelector('#worldSkyboxClear').onclick = () => {
        registry.updateWorld({ skyboxImage: null });
        renderWorldPanel();
    };
    const mappingSel = pane.querySelector('#worldSkyboxMapping');
    if (mappingSel) mappingSel.onchange = (e) => registry.updateWorld({ skyboxMapping: e.target.value });
    const opacityInput = pane.querySelector('#worldSkyboxImageOpacity');
    const opacityLabel = pane.querySelector('#worldSkyboxImageOpacityValue');
    if (opacityInput) opacityInput.oninput = () => {
        const v = parseFloat(opacityInput.value);
        opacityLabel.textContent = `${(v * 100).toFixed(0)}%`;
        registry.updateWorld({ skyboxImageOpacity: v });
    };
    pane.querySelector('#worldShadowsEnabled').onchange = (e) => {
        registry.updateWorld({ shadowsEnabled: e.target.checked });
    };
    pane.querySelector('#worldShadowType').onchange = (e) => {
        registry.updateWorld({ shadowMapType: e.target.value });
    };
    pane.querySelector('#worldShadowMapSize').onchange = (e) => {
        registry.updateWorld({ shadowMapSize: parseInt(e.target.value) });
    };

    const biasInput = pane.querySelector('#worldShadowBias');
    const biasLabel = pane.querySelector('#worldShadowBiasValue');
    biasInput.oninput = () => {
        biasLabel.textContent = parseFloat(biasInput.value).toFixed(4);
        registry.updateWorld({ shadowBias: parseFloat(biasInput.value) });
    };

    const nbiasInput = pane.querySelector('#worldShadowNormalBias');
    const nbiasLabel = pane.querySelector('#worldShadowNormalBiasValue');
    nbiasInput.oninput = () => {
        nbiasLabel.textContent = parseFloat(nbiasInput.value).toFixed(3);
        registry.updateWorld({ shadowNormalBias: parseFloat(nbiasInput.value) });
    };

    const radiusInput = pane.querySelector('#worldShadowRadius');
    const radiusLabel = pane.querySelector('#worldShadowRadiusValue');
    radiusInput.oninput = () => {
        radiusLabel.textContent = parseFloat(radiusInput.value).toFixed(1);
        registry.updateWorld({ shadowRadius: parseFloat(radiusInput.value) });
    };

    const dirBoundsInput = pane.querySelector('#worldDirShadowBounds');
    const dirBoundsLabel = pane.querySelector('#worldDirShadowBoundsValue');
    dirBoundsInput.oninput = () => {
        dirBoundsLabel.textContent = parseFloat(dirBoundsInput.value).toFixed(0);
        registry.updateWorld({ directionalShadowBounds: parseFloat(dirBoundsInput.value) });
    };

    const dirFarInput = pane.querySelector('#worldDirShadowFar');
    const dirFarLabel = pane.querySelector('#worldDirShadowFarValue');
    dirFarInput.oninput = () => {
        dirFarLabel.textContent = parseFloat(dirFarInput.value).toFixed(0);
        registry.updateWorld({ directionalShadowFar: parseFloat(dirFarInput.value) });
    };

    pane.querySelector('#worldToneMapping').onchange = (e) => {
        registry.updateWorld({ toneMapping: e.target.value });
    };

    const expInput = pane.querySelector('#worldToneExposure');
    const expLabel = pane.querySelector('#worldToneExposureValue');
    expInput.oninput = () => {
        expLabel.textContent = parseFloat(expInput.value).toFixed(2);
        registry.updateWorld({ toneMappingExposure: parseFloat(expInput.value) });
    };

    wireFilters(pane);
}
