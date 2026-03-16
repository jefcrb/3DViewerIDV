import { AVAILABLE_HUNTERS, AVAILABLE_SURVIVORS } from '../config.js';
import * as THREE from 'three';
import { saveSettings, loadSettings, getStorageInfo } from '../storage/settingsStorage.js';

let devLights = null;
let devRenderer = null;

async function saveToStorage() {
    const settings = {
        rendering: {
            rendererType: document.getElementById('rendererSelect').value,
            toneMapping: document.getElementById('toneMappingSelect').value,
            exposure: parseFloat(document.getElementById('exposureSlider').value),
            shadowMapType: document.getElementById('shadowMapTypeSelect').value
        },
        lighting: {
            hemisphere: parseFloat(document.getElementById('hemisphereSlider').value),
            keyLight: parseFloat(document.getElementById('keyLightSlider').value),
            fillLight: parseFloat(document.getElementById('fillLightSlider').value),
            rimLight: parseFloat(document.getElementById('rimLightSlider').value),
            sunLight: parseFloat(document.getElementById('sunLightSlider').value),
            lightColor: document.getElementById('lightColorPicker').value,
            sunColor: document.getElementById('sunColorPicker').value
        },
        sunPosition: {
            x: parseFloat(document.getElementById('sunXSlider').value),
            y: parseFloat(document.getElementById('sunYSlider').value),
            z: parseFloat(document.getElementById('sunZSlider').value)
        },
        keyLightPosition: {
            x: parseFloat(document.getElementById('keyLightXSlider').value),
            y: parseFloat(document.getElementById('keyLightYSlider').value),
            z: parseFloat(document.getElementById('keyLightZSlider').value)
        }
    };

    await saveSettings(settings);
}

export async function setDevReferences(lights, renderer) {
    devLights = lights;
    devRenderer = renderer;

    getStorageInfo();

    const saved = await loadSettings();
    if (saved) {
        applyLoadedSettings(saved);
    } else {
        console.log('No saved settings found, using defaults from config');
    }
}

export async function applyStoredSettings(lights, renderer) {
    const saved = await loadSettings();
    if (!saved) return;

    console.log('Applying stored settings to scene');

    if (saved.rendering && renderer) {
        const toneMappingMap = {
            'NoToneMapping': THREE.NoToneMapping,
            'Linear': THREE.LinearToneMapping,
            'Reinhard': THREE.ReinhardToneMapping,
            'Cineon': THREE.CineonToneMapping,
            'ACESFilmic': THREE.ACESFilmicToneMapping
        };
        renderer.toneMapping = toneMappingMap[saved.rendering.toneMapping];
        renderer.toneMappingExposure = saved.rendering.exposure;
    }

    if (saved.lighting && lights) {
        lights.hemisphere.intensity = saved.lighting.hemisphere;
        lights.keyLight.intensity = saved.lighting.keyLight;
        lights.fillLight.intensity = saved.lighting.fillLight;
        lights.rimLight.intensity = saved.lighting.rimLight;
        lights.sunLight.intensity = saved.lighting.sunLight;

        lights.keyLight.color.setHex(parseInt(saved.lighting.lightColor.replace('#', '0x')));
        lights.fillLight.color.setHex(parseInt(saved.lighting.lightColor.replace('#', '0x')));
        lights.rimLight.color.setHex(parseInt(saved.lighting.lightColor.replace('#', '0x')));
        lights.sunLight.color.setHex(parseInt(saved.lighting.sunColor.replace('#', '0x')));
    }

    if (saved.sunPosition && lights && lights.sunLight) {
        lights.sunLight.position.set(
            saved.sunPosition.x,
            saved.sunPosition.y,
            saved.sunPosition.z
        );
    }

    if (saved.keyLightPosition && lights && lights.keyLight) {
        lights.keyLight.position.set(
            saved.keyLightPosition.x,
            saved.keyLightPosition.y,
            saved.keyLightPosition.z
        );
    }
}

function applyLoadedSettings(settings) {
    if (settings.rendering) {
        if (settings.rendering.rendererType) {
            document.getElementById('rendererSelect').value = settings.rendering.rendererType;
        }
        document.getElementById('toneMappingSelect').value = settings.rendering.toneMapping;
        document.getElementById('exposureSlider').value = settings.rendering.exposure;
        document.getElementById('shadowMapTypeSelect').value = settings.rendering.shadowMapType;
    }

    if (settings.lighting) {
        document.getElementById('hemisphereSlider').value = settings.lighting.hemisphere;
        document.getElementById('keyLightSlider').value = settings.lighting.keyLight;
        document.getElementById('fillLightSlider').value = settings.lighting.fillLight;
        document.getElementById('rimLightSlider').value = settings.lighting.rimLight;
        document.getElementById('sunLightSlider').value = settings.lighting.sunLight;
        document.getElementById('lightColorPicker').value = settings.lighting.lightColor;
        document.getElementById('sunColorPicker').value = settings.lighting.sunColor;
    }

    if (settings.sunPosition) {
        document.getElementById('sunXSlider').value = settings.sunPosition.x;
        document.getElementById('sunYSlider').value = settings.sunPosition.y;
        document.getElementById('sunZSlider').value = settings.sunPosition.z;
    }

    if (settings.keyLightPosition) {
        document.getElementById('keyLightXSlider').value = settings.keyLightPosition.x;
        document.getElementById('keyLightYSlider').value = settings.keyLightPosition.y;
        document.getElementById('keyLightZSlider').value = settings.keyLightPosition.z;
    }

    window.applyRenderingSettings();
    window.applyLightingSettings();
    window.applySunPosition();
    window.applyKeyLightPosition();

    console.log('Settings loaded from localStorage');
}

export function populateDevDropdowns() {
    const hunterSelect = document.getElementById('hunterSelect');
    const survivor1Select = document.getElementById('survivor1Select');
    const survivor2Select = document.getElementById('survivor2Select');
    const survivor3Select = document.getElementById('survivor3Select');
    const survivor4Select = document.getElementById('survivor4Select');

    AVAILABLE_HUNTERS.forEach(hunter => {
        const option = document.createElement('option');
        option.value = hunter.folder;
        option.textContent = hunter.name;
        hunterSelect.appendChild(option);
    });

    [survivor1Select, survivor2Select, survivor3Select, survivor4Select].forEach(select => {
        AVAILABLE_SURVIVORS.forEach(survivor => {
            const option = document.createElement('option');
            option.value = survivor.folder;
            option.textContent = survivor.name;
            select.appendChild(option);
        });
    });

    hunterSelect.value = 'Hell_Ember';
    survivor1Select.value = 'Doctor';
    survivor2Select.value = 'Lawyer';
    survivor3Select.value = 'Thief';
    survivor4Select.value = 'Gardener';
}

export function setupDevMode() {
    window.applyDevSelection = function() {
        const hunterFolder = document.getElementById('hunterSelect').value;
        const survivor1Folder = document.getElementById('survivor1Select').value;
        const survivor2Folder = document.getElementById('survivor2Select').value;
        const survivor3Folder = document.getElementById('survivor3Select').value;
        const survivor4Folder = document.getElementById('survivor4Select').value;

        const gameData = {
            hunter: null,
            survivors: []
        };

        if (hunterFolder) {
            const hunterInfo = AVAILABLE_HUNTERS.find(h => h.folder === hunterFolder);
            gameData.hunter = {
                name: hunterInfo.name,
                hasModel: true,
                modelPath: `./hunters/${hunterFolder}/`,
                modelFile: `${hunterFolder}.gltf`
            };
        }

        [survivor1Folder, survivor2Folder, survivor3Folder, survivor4Folder].forEach(folder => {
            if (folder) {
                const survivorInfo = AVAILABLE_SURVIVORS.find(s => s.folder === folder);
                gameData.survivors.push({
                    name: survivorInfo.name,
                    hasModel: true,
                    modelPath: `./survivors/${folder}/`,
                    modelFile: `${folder}.gltf`
                });
            }
        });

        console.log('DEV MODE: Applying new selection...', gameData);
        window.loadCharactersJson(gameData);
    };

    window.applyRenderingSettings = function() {
        if (!devRenderer) return;

        const toneMapping = document.getElementById('toneMappingSelect').value;
        const exposure = parseFloat(document.getElementById('exposureSlider').value);
        const shadowMapType = document.getElementById('shadowMapTypeSelect').value;

        const toneMappingMap = {
            'NoToneMapping': THREE.NoToneMapping,
            'Linear': THREE.LinearToneMapping,
            'Reinhard': THREE.ReinhardToneMapping,
            'Cineon': THREE.CineonToneMapping,
            'ACESFilmic': THREE.ACESFilmicToneMapping
        };

        devRenderer.toneMapping = toneMappingMap[toneMapping];
        devRenderer.toneMappingExposure = exposure;

        document.getElementById('exposureValue').textContent = exposure.toFixed(1);
        saveToStorage();
        console.log('Rendering settings updated:', { toneMapping, exposure, shadowMapType });
    };

    window.applyLightingSettings = function() {
        if (!devLights) return;

        const hemisphere = parseFloat(document.getElementById('hemisphereSlider').value);
        const keyLight = parseFloat(document.getElementById('keyLightSlider').value);
        const fillLight = parseFloat(document.getElementById('fillLightSlider').value);
        const rimLight = parseFloat(document.getElementById('rimLightSlider').value);
        const sunLight = parseFloat(document.getElementById('sunLightSlider').value);

        const lightColor = document.getElementById('lightColorPicker').value;
        const sunColor = document.getElementById('sunColorPicker').value;

        devLights.hemisphere.intensity = hemisphere;
        devLights.keyLight.intensity = keyLight;
        devLights.fillLight.intensity = fillLight;
        devLights.rimLight.intensity = rimLight;
        devLights.sunLight.intensity = sunLight;

        devLights.keyLight.color.setHex(parseInt(lightColor.replace('#', '0x')));
        devLights.fillLight.color.setHex(parseInt(lightColor.replace('#', '0x')));
        devLights.rimLight.color.setHex(parseInt(lightColor.replace('#', '0x')));
        devLights.sunLight.color.setHex(parseInt(sunColor.replace('#', '0x')));

        document.getElementById('hemisphereValue').textContent = hemisphere.toFixed(2);
        document.getElementById('keyLightValue').textContent = keyLight.toFixed(1);
        document.getElementById('fillLightValue').textContent = fillLight.toFixed(2);
        document.getElementById('rimLightValue').textContent = rimLight.toFixed(2);
        document.getElementById('sunLightValue').textContent = sunLight.toFixed(1);

        saveToStorage();
        console.log('Lighting updated:', { hemisphere, keyLight, fillLight, rimLight, sunLight });
    };

    window.applySunPosition = function() {
        if (!devLights) return;

        const x = parseFloat(document.getElementById('sunXSlider').value);
        const y = parseFloat(document.getElementById('sunYSlider').value);
        const z = parseFloat(document.getElementById('sunZSlider').value);

        devLights.sunLight.position.set(x, y, z);

        document.getElementById('sunXValue').textContent = x;
        document.getElementById('sunYValue').textContent = y;
        document.getElementById('sunZValue').textContent = z;

        saveToStorage();
        console.log('Sun position updated:', { x, y, z });
    };

    window.applyKeyLightPosition = function() {
        if (!devLights) return;

        const x = parseFloat(document.getElementById('keyLightXSlider').value);
        const y = parseFloat(document.getElementById('keyLightYSlider').value);
        const z = parseFloat(document.getElementById('keyLightZSlider').value);

        devLights.keyLight.position.set(x, y, z);

        document.getElementById('keyLightXValue').textContent = x;
        document.getElementById('keyLightYValue').textContent = y;
        document.getElementById('keyLightZValue').textContent = z;

        saveToStorage();
        console.log('Key light position updated:', { x, y, z });
    };

    window.applyRendererSetting = async function() {
        const rendererType = 'webgl';
        console.log('Renderer type changed to:', rendererType);

        await saveToStorage();

        alert(`Renderer changed to ${rendererType.toUpperCase()}.\n\nPlease reload the page for changes to take effect.`);
    };
}
