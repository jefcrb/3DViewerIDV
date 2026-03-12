import { state as sceneState, hideDummyModels } from '../scene/loader.js';
import { state as characterState, loadCharacterModel } from './loader.js';

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
                        scene.remove(characterState.loadedCharacters.survivors[index].model);
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
                scene.remove(characterState.loadedCharacters.survivors[i].model);
                characterState.loadedCharacters.survivors[i] = null;
                console.log(`Removed survivor at position ${i} (no longer in data)`);
            }
        }
    };

    window.loadHunterFromJson = window.loadCharactersJson;
}
