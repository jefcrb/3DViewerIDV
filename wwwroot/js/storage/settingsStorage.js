import { SCENE_ID } from '../config.js';

const SETTINGS_FILE = `./scenes/${encodeURIComponent(SCENE_ID)}/settings.json`;
const SETTINGS_API = `./api/settings?scene=${encodeURIComponent(SCENE_ID)}`;
let lastLoaded = null;

function legacyToLightSpecs(legacy) {
    const lightColor = legacy?.lighting?.lightColor || '#ffffff';
    const sunColor = legacy?.lighting?.sunColor || '#ffffff';
    const sunPos = legacy?.sunPosition;
    const keyPos = legacy?.keyLightPosition;
    return [
        {
            id: 'hemisphere',
            name: 'Hemisphere',
            type: 'Hemisphere',
            color: '#ffffff',
            groundColor: '#444444',
            intensity: legacy?.lighting?.hemisphere ?? 0.02,
            position: [0, 20, 0]
        },
        {
            id: 'keyLight',
            name: 'Key Light',
            type: 'Directional',
            color: lightColor,
            intensity: legacy?.lighting?.keyLight ?? 0.8,
            position: keyPos ? [keyPos.x, keyPos.y, keyPos.z] : [5, 8, 5],
            target: [0, 1, 0],
            castShadow: true
        },
        {
            id: 'fillLight',
            name: 'Fill Light',
            type: 'Directional',
            color: lightColor,
            intensity: legacy?.lighting?.fillLight ?? 0.02,
            position: [-5, 4, 5],
            target: [0, 1, 0]
        },
        {
            id: 'rimLight',
            name: 'Rim Light',
            type: 'Directional',
            color: lightColor,
            intensity: legacy?.lighting?.rimLight ?? 0.02,
            position: [0, 6, -8],
            target: [0, 1, 0]
        },
        {
            id: 'sunLight',
            name: 'Sun Light',
            type: 'Directional',
            color: sunColor,
            intensity: legacy?.lighting?.sunLight ?? 0.8,
            position: sunPos ? [sunPos.x, sunPos.y, sunPos.z] : [5, 15, 10],
            target: [0, 0, 0],
            castShadow: true
        }
    ];
}

export function migrate(settings) {
    if (!settings) return null;
    if (settings.editor && Array.isArray(settings.editor.lights) && settings.editor.lights.length > 0) {
        return settings;
    }
    if (settings.lighting || settings.sunPosition || settings.keyLightPosition) {
        console.log('Migrating legacy lighting settings into editor.lights[]');
        settings.editor = settings.editor || {};
        settings.editor.lights = legacyToLightSpecs(settings);
        settings.editor.slots = settings.editor.slots || [];
        settings.editor.liveCamera = settings.editor.liveCamera || null;
        settings.editor.triggers = settings.editor.triggers || {};
    }
    return settings;
}

export async function loadSettings() {
    try {
        const response = await fetch(SETTINGS_FILE + '?t=' + Date.now());

        if (response.ok) {
            const settings = await response.json();
            lastLoaded = settings;
            console.log(`Settings loaded for scene '${SCENE_ID}'`);
            return migrate(settings);
        } else if (response.status === 404) {
            console.log(`No settings for scene '${SCENE_ID}', using defaults`);
            lastLoaded = null;
            return null;
        } else {
            console.error('Failed to load settings:', response.status);
            return null;
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
        return null;
    }
}

// Merges into lastLoaded so unknown keys survive partial saves.
export async function saveSettings(patch) {
    const merged = { ...(lastLoaded || {}), ...patch };
    lastLoaded = merged;

    const json = JSON.stringify(merged, null, 2);

    try {
        const response = await fetch(SETTINGS_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: json
        });

        if (response.ok) {
            console.log('Settings saved to viewer_settings.json');
            return true;
        }
        console.error('Failed to save settings:', response.status);
        return false;
    } catch (error) {
        console.error('Failed to save settings:', error);
        return false;
    }
}

export function getLastLoaded() {
    return lastLoaded;
}

export function exportSettings() {
    const data = lastLoaded || {};
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `viewer_settings_${SCENE_ID}_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export async function importSettings(file) {
    const text = await file.text();
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        throw new Error('Invalid JSON: ' + e.message);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Settings file must contain a JSON object at the root');
    }
    const json = JSON.stringify(parsed, null, 2);
    const response = await fetch('./api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json
    });
    if (!response.ok) {
        throw new Error(`Save failed (${response.status})`);
    }
    lastLoaded = parsed;
    return parsed;
}

export function getStorageInfo() {
    console.log(`Settings API: ${SETTINGS_API}`);
    return {
        storageMethod: 'Per-scene API endpoint',
        settingsFile: SETTINGS_API,
        sceneId: SCENE_ID
    };
}
