// Keyframe Animation Storage - File-based persistence following settingsStorage.js pattern

const ANIMATIONS_FILE = './keyframe_animations.json';

// Save keyframe animations via POST
export async function saveKeyframeAnimations(data) {
    const json = JSON.stringify(data, null, 2);

    try {
        const response = await fetch('./api/keyframe-animations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: json
        });

        if (response.ok) {
            console.log('Keyframe animations saved to keyframe_animations.json');
            return true;
        } else {
            console.error('Failed to save keyframe animations:', response.status);
            return false;
        }
    } catch (error) {
        console.error('Failed to save keyframe animations:', error);
        return false;
    }
}

// Load keyframe animations from static file
export async function loadKeyframeAnimations() {
    try {
        const response = await fetch(ANIMATIONS_FILE + '?t=' + Date.now());

        if (response.ok) {
            const data = await response.json();
            console.log('Keyframe animations loaded from keyframe_animations.json');
            return data;
        } else if (response.status === 404) {
            console.log('No keyframe animations file found, creating from defaults');
            return await createDefaultAnimationsFile();
        } else {
            console.error('Failed to load keyframe animations:', response.status);
            return null;
        }
    } catch (error) {
        console.error('Failed to load keyframe animations:', error);
        return null;
    }
}

// Create default animations file
async function createDefaultAnimationsFile() {
    const defaults = {
        version: "3.0",
        animatableObjects: {
            "Camera": {
                type: "camera",
                properties: {
                    position: { x: 0, y: 5, z: 10 },
                    rotation: { x: 0, y: 0, z: 0 },
                    fov: 50
                },
                chains: []
            }
        }
    };

    await saveKeyframeAnimations(defaults);
    return defaults;
}

// Get storage info for debugging
export function getKeyframeStorageInfo() {
    console.log('=== KEYFRAME ANIMATION STORAGE INFO ===');
    console.log('Animations file: keyframe_animations.json (in wwwroot)');
    console.log('Load: GET ./keyframe_animations.json');
    console.log('Save: POST ./api/keyframe-animations');
    console.log('========================================');

    return {
        storageMethod: 'Static file in wwwroot',
        animationsFile: ANIMATIONS_FILE
    };
}
