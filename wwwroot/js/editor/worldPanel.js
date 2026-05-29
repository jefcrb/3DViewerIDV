import { registry } from './registry.js';
import { SHADOW_MAP_TYPES } from './registry.js';

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
}
