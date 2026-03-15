// Settings Storage - Simple file-based (works everywhere)

const SETTINGS_FILE = './viewer_settings.json';

// Save settings via POST
export async function saveSettings(settings) {
    const json = JSON.stringify(settings, null, 2);

    try {
        const response = await fetch('./api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: json
        });

        if (response.ok) {
            console.log('Settings saved to viewer_settings.json');
            return true;
        } else {
            console.error('Failed to save settings:', response.status);
            return false;
        }
    } catch (error) {
        console.error('Failed to save settings:', error);
        return false;
    }
}

// Load settings from static file
export async function loadSettings() {
    try {
        const response = await fetch(SETTINGS_FILE);

        if (response.ok) {
            const settings = await response.json();
            console.log('Settings loaded from viewer_settings.json');
            return settings;
        } else if (response.status === 404) {
            console.log('No settings file found, using defaults');
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

// Get storage info for debugging
export function getStorageInfo() {
    console.log('=== STORAGE INFO ===');
    console.log('Settings file: viewer_settings.json (in wwwroot)');
    console.log('Load: GET ./viewer_settings.json');
    console.log('Save: POST ./api/settings');
    console.log('====================');

    return {
        storageMethod: 'Static file in wwwroot',
        settingsFile: SETTINGS_FILE
    };
}
