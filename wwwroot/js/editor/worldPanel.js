import { registry } from './registry.js';
import { SHADOW_MAP_TYPES, TONE_MAPPING_TYPES } from './registry.js';

const SHADOW_MAP_SIZES = [256, 512, 1024, 2048, 4096];

export function renderWorldPanel() {
    const pane = document.querySelector('.tab-pane[data-tab="world"]');
    if (!pane) return;
    const w = registry.world;
    pane.innerHTML = `
        <div class="editor-row">
            <div class="row-head"><strong>Background</strong></div>
            <div class="row-body">
                <label>Skybox color
                    <input type="color" id="worldBgColor" value="${w.backgroundColor}">
                </label>
            </div>
        </div>
        <div class="editor-row">
            <div class="row-head"><strong>Shadows</strong></div>
            <div class="row-body">
                <label><input type="checkbox" id="worldShadowsEnabled" ${w.shadowsEnabled ? 'checked' : ''}> Enabled</label>
                <label>Filter
                    <select id="worldShadowType">
                        ${Object.keys(SHADOW_MAP_TYPES).map(t =>
                            `<option value="${t}" ${t === w.shadowMapType ? 'selected' : ''}>${t}</option>`
                        ).join('')}
                    </select>
                </label>
                <label>Map size
                    <select id="worldShadowMapSize">
                        ${SHADOW_MAP_SIZES.map(s =>
                            `<option value="${s}" ${s === w.shadowMapSize ? 'selected' : ''}>${s}×${s}</option>`
                        ).join('')}
                    </select>
                </label>
                <label class="slider-row">Bias
                    <input type="range" id="worldShadowBias" min="-0.01" max="0.01" step="0.0001" value="${w.shadowBias}">
                    <span id="worldShadowBiasValue">${w.shadowBias.toFixed(4)}</span>
                </label>
                <label class="slider-row">Normal bias
                    <input type="range" id="worldShadowNormalBias" min="0" max="0.5" step="0.001" value="${w.shadowNormalBias}">
                    <span id="worldShadowNormalBiasValue">${w.shadowNormalBias.toFixed(3)}</span>
                </label>
                <label class="slider-row">Softness (radius)
                    <input type="range" id="worldShadowRadius" min="0" max="16" step="0.5" value="${w.shadowRadius}">
                    <span id="worldShadowRadiusValue">${w.shadowRadius.toFixed(1)}</span>
                </label>
                <label class="slider-row" title="Half-width of the directional-light shadow frustum. Larger = shadows cover more ground but get blockier; bump Map size to compensate.">Directional bounds
                    <input type="range" id="worldDirShadowBounds" min="5" max="60" step="1" value="${w.directionalShadowBounds}">
                    <span id="worldDirShadowBoundsValue">${w.directionalShadowBounds.toFixed(0)}</span>
                </label>
                <label class="slider-row" title="Far plane of the directional shadow camera. Larger = shadows reach further along the light direction; may need a small bias bump.">Directional far
                    <input type="range" id="worldDirShadowFar" min="20" max="200" step="5" value="${w.directionalShadowFar}">
                    <span id="worldDirShadowFarValue">${w.directionalShadowFar.toFixed(0)}</span>
                </label>
            </div>
        </div>
        <div class="editor-row">
            <div class="row-head"><strong>Tone mapping</strong></div>
            <div class="row-body">
                <label>Mode
                    <select id="worldToneMapping">
                        ${Object.keys(TONE_MAPPING_TYPES).map(t =>
                            `<option value="${t}" ${t === w.toneMapping ? 'selected' : ''}>${t}</option>`
                        ).join('')}
                    </select>
                </label>
                <label class="slider-row">Exposure
                    <input type="range" id="worldToneExposure" min="0" max="4" step="0.01" value="${w.toneMappingExposure}">
                    <span id="worldToneExposureValue">${w.toneMappingExposure.toFixed(2)}</span>
                </label>
            </div>
        </div>
    `;

    pane.querySelector('#worldBgColor').oninput = (e) => {
        registry.updateWorld({ backgroundColor: e.target.value });
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
}
