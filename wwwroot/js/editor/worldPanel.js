import { registry } from './registry.js';
import { SHADOW_MAP_TYPES, TONE_MAPPING_TYPES, SKYBOX_MAPPINGS } from './registry.js';
import { t } from '../i18n.js';

const SHADOW_MAP_SIZES = [256, 512, 1024, 2048, 4096];

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
    });
}

export function renderWorldPanel() {
    const pane = document.querySelector('.tab-pane[data-tab="world"]');
    if (!pane) return;
    const w = registry.world;
    const hasImage = !!w.skyboxImage;
    const transparent = !!w.transparentBackground;
    const disAttr = transparent ? 'disabled' : '';
    pane.innerHTML = `
        <div class="editor-row">
            <div class="row-head"><strong>${t('world.skybox')}</strong></div>
            <div class="row-body">
                <label><input type="checkbox" id="worldTransparentBg" ${transparent ? 'checked' : ''}> ${t('world.transparent')}</label>
                <label>${t('world.skyboxColor')}
                    <input type="color" id="worldBgColor" value="${w.backgroundColor}" ${(hasImage || transparent) ? 'disabled' : ''}>
                </label>
                <div class="skybox-image">
                    <div class="skybox-image-actions">
                        <button type="button" class="btn" id="worldSkyboxUpload" ${disAttr}>${hasImage ? t('world.replaceImage') : t('world.uploadImage')}</button>
                        <button type="button" class="btn" id="worldSkyboxClear" ${(hasImage && !transparent) ? '' : 'disabled'}>${t('world.clearImage')}</button>
                        <input type="file" id="worldSkyboxFile" accept="image/*" hidden>
                    </div>
                    ${hasImage ? `<img class="skybox-preview" src="${w.skyboxImage}" alt="skybox preview">` : ''}
                    ${hasImage ? `
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
}
