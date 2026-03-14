import { state as sceneState, hideDummyModels } from '../scene/loader.js';
import { state as characterState, loadCharacterModel } from './loader.js';
import { playOutroAnimation } from '../customization/outroAnimation.js';

// Detect if running in web context (localhost) vs WebView2 (app.local)
const isWebContext = window.location.hostname === 'localhost';
let lastFetchedData = null;

console.log('[Init] Hostname:', window.location.hostname);
console.log('[Init] Is web context:', isWebContext);

// Poll character data from web server (only in web context)
async function pollCharacterData() {
    if (!isWebContext) return; // Skip if in WebView2

    try {
        console.log('[Polling] Fetching /api/characters...');
        const response = await fetch('/api/characters');
        const data = await response.json();
        const dataStr = JSON.stringify(data);

        console.log('[Polling] Received data:', data);
        console.log('[Polling] Last data:', lastFetchedData);

        // Only update if data changed
        if (dataStr !== lastFetchedData) {
            console.log('[Polling] Data changed, updating scene');
            lastFetchedData = dataStr;
            window.loadCharactersJson(data);
        } else {
            console.log('[Polling] Data unchanged, skipping update');
        }
    } catch (error) {
        console.error('Failed to fetch character data:', error);
    }
}

export function setupCharacterAPI(scene) {
    window.loadCharactersJson = function(jsonData) {
        console.log('Received character data from backend:', jsonData);

        if (sceneState.sceneLoaded) {
            hideDummyModels(sceneState.dummyModels);
        }

        const hunterUrl = (jsonData.hunter && jsonData.hunter.hasModel)
            ? jsonData.hunter.modelPath + jsonData.hunter.modelFile
            : null;

        if (hunterUrl !== (characterState.loadedCharacters.hunter?.url || null)) {
            if (characterState.loadedCharacters.hunter) {
                scene.remove(characterState.loadedCharacters.hunter.model);
                characterState.loadedCharacters.hunter = null;
                console.log('Removed old hunter');
            }

            if (hunterUrl) {
                loadCharacterModel(
                    scene,
                    hunterUrl,
                    jsonData.hunter.name,
                    sceneState.characterPositions.hunter,
                    'hunter',
                    -1
                );
            }
        } else if (hunterUrl) {
            console.log(`Hunter unchanged: ${jsonData.hunter.name}`);
        }

        if (jsonData.survivors && Array.isArray(jsonData.survivors)) {
            jsonData.survivors.forEach((survivor, index) => {
                if (index >= 4) return;

                const survivorUrl = (survivor && survivor.hasModel)
                    ? survivor.modelPath + survivor.modelFile
                    : null;

                if (survivorUrl !== (characterState.loadedCharacters.survivors[index]?.url || null)) {
                    if (characterState.loadedCharacters.survivors[index]) {
                        const oldModel = characterState.loadedCharacters.survivors[index].model;
                        playOutroAnimation(oldModel).then(() => {
                            scene.remove(oldModel);
                        });
                        characterState.loadedCharacters.survivors[index] = null;
                        console.log(`Removed old survivor at position ${index}`);
                    }

                    if (survivorUrl) {
                        loadCharacterModel(
                            scene,
                            survivorUrl,
                            survivor.name,
                            sceneState.characterPositions.survivors[index],
                            'survivor',
                            index
                        );
                    }
                } else if (survivorUrl) {
                    console.log(`Survivor ${index} unchanged: ${survivor.name}`);
                }
            });
        }

        for (let i = (jsonData.survivors?.length || 0); i < 4; i++) {
            if (characterState.loadedCharacters.survivors[i]) {
                const oldModel = characterState.loadedCharacters.survivors[i].model;
                playOutroAnimation(oldModel).then(() => {
                    scene.remove(oldModel);
                });
                characterState.loadedCharacters.survivors[i] = null;
                console.log(`Removed survivor at position ${i} (no longer in data)`);
            }
        }
    };

    window.loadHunterFromJson = window.loadCharactersJson;

    // Start polling if in web context (OBS browser source)
    if (isWebContext) {
        console.log('[Init] Starting polling (every 1 second)');
        setInterval(pollCharacterData, 1000); // Poll every 1 second
        pollCharacterData(); // Initial fetch
    } else {
        console.log('[Init] WebView2 context detected, polling disabled');
    }
}
