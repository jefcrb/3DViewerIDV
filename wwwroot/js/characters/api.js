import { state as sceneState, hideDummyModels } from '../scene/loader.js';
import { state as characterState, loadCharacterModel } from './loader.js';
import { playOutroAnimation } from '../customization/outroAnimation.js';
import { fire } from '../animation/triggers.js';
import { updateTeamColors } from '../state/teamColors.js';
import { registry } from '../editor/registry.js';

const isWebContext = window.location.hostname === 'localhost';
let lastFetchedData = null;
let lastHunterKey = null;
let lastSurvivorKeys = [null, null, null, null];
let lastHunterPicking = false;
let lastSurvivorPicking = [false, false, false, false];
let sceneLoadedFired = false;

const pendingLoads = { hunter: null, survivors: [null, null, null, null] };

function cancelPending(slotKey) {
    if (slotKey === 'hunter') {
        if (pendingLoads.hunter) { clearTimeout(pendingLoads.hunter); pendingLoads.hunter = null; }
    } else {
        const i = parseInt(slotKey.split('_')[1]) - 1;
        if (pendingLoads.survivors[i]) { clearTimeout(pendingLoads.survivors[i]); pendingLoads.survivors[i] = null; }
    }
}

function scheduleLoad(slotKey, doLoad) {
    cancelPending(slotKey);
    const delayMs = (registry.getSlot(slotKey)?.pickDelay ?? 0) * 1000;
    if (delayMs <= 0) { doLoad(); return; }
    const timer = setTimeout(() => {
        if (slotKey === 'hunter') pendingLoads.hunter = null;
        else pendingLoads.survivors[parseInt(slotKey.split('_')[1]) - 1] = null;
        doLoad();
    }, delayMs);
    if (slotKey === 'hunter') pendingLoads.hunter = timer;
    else pendingLoads.survivors[parseInt(slotKey.split('_')[1]) - 1] = timer;
}

console.log('[Init] Hostname:', window.location.hostname);
console.log('[Init] Is web context:', isWebContext);

function characterKey(c) {
    if (!c || !c.hasModel) return null;
    return (c.modelPath || '') + (c.modelFile || '');
}

async function pollCharacterData() {
    if (!isWebContext) return;

    try {
        const response = await fetch('/api/characters');
        const data = await response.json();
        const dataStr = JSON.stringify(data);
        if (dataStr !== lastFetchedData) {
            lastFetchedData = dataStr;
            window.loadCharactersJson(data);
        }
    } catch (error) {
        console.error('Failed to fetch character data:', error);
    }
}

function fireDiffEvents(jsonData) {
    const newHunterKey = characterKey(jsonData.hunter);
    if (newHunterKey !== lastHunterKey) {
        if (newHunterKey === null) {
            fire('hunter_deselected', {});
        } else if (lastHunterKey === null) {
            fire('hunter_selected', { name: jsonData.hunter?.name });
        }
    }
    lastHunterKey = newHunterKey;

    let anySelected = false;
    let anyDeselected = false;
    const survivors = jsonData.survivors || [];
    for (let i = 0; i < 4; i++) {
        const survivor = survivors[i];
        const newKey = characterKey(survivor);
        if (newKey !== lastSurvivorKeys[i]) {
            if (newKey === null) {
                fire(`survivor_${i + 1}_deselected`, { index: i });
                anyDeselected = true;
            } else {
                fire(`survivor_${i + 1}_selected`, { index: i, name: survivor?.name });
                anySelected = true;
            }
        }
        lastSurvivorKeys[i] = newKey;
    }
    if (anySelected) fire('survivor_any_selected', {});
    if (anyDeselected) fire('survivor_any_deselected', {});

    const newHunterPicking = !!jsonData.hunter?.isPicking;
    if (newHunterPicking !== lastHunterPicking) {
        fire(newHunterPicking ? 'hunter_picking_started' : 'hunter_picking_ended',
             { name: jsonData.hunter?.name });
        lastHunterPicking = newHunterPicking;
    }

    let anyPickingStarted = false;
    let anyPickingEnded = false;
    for (let i = 0; i < 4; i++) {
        const newPicking = !!survivors[i]?.isPicking;
        if (newPicking !== lastSurvivorPicking[i]) {
            fire(`survivor_${i + 1}_${newPicking ? 'picking_started' : 'picking_ended'}`,
                 { index: i, name: survivors[i]?.name });
            if (newPicking) anyPickingStarted = true;
            else anyPickingEnded = true;
            lastSurvivorPicking[i] = newPicking;
        }
    }
    if (anyPickingStarted) fire('survivor_any_picking_started', {});
    if (anyPickingEnded) fire('survivor_any_picking_ended', {});
}

export function setupCharacterAPI(scene) {
    window.loadCharactersJson = function(jsonData) {
        console.log('Received character data from backend:', jsonData);

        if (jsonData.teams) updateTeamColors(jsonData.teams);

        // Fire triggers up-front so pickDelay only delays the model load, not the animation.
        fireDiffEvents(jsonData);

        if (sceneState.sceneLoaded) {
            hideDummyModels(sceneState.dummyModels);
        }

        const hunterTransform = sceneState.characterPositions.hunter;
        const survivorTransforms = sceneState.characterPositions.survivors;

        const hunterUrl = (jsonData.hunter && jsonData.hunter.hasModel)
            ? jsonData.hunter.modelPath + jsonData.hunter.modelFile
            : null;

        if (hunterUrl !== (characterState.loadedCharacters.hunter?.url || null)) {
            cancelPending('hunter');
            if (characterState.loadedCharacters.hunter) {
                scene.remove(characterState.loadedCharacters.hunter.model);
                characterState.loadedCharacters.hunter = null;
                console.log('Removed old hunter');
            }
            if (hunterUrl && hunterTransform) {
                scheduleLoad('hunter', () => loadCharacterModel(
                    scene, hunterUrl, jsonData.hunter.name, hunterTransform, 'hunter', -1
                ));
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
                    cancelPending(`survivor_${index + 1}`);
                    if (characterState.loadedCharacters.survivors[index]) {
                        const oldModel = characterState.loadedCharacters.survivors[index].model;
                        playOutroAnimation(oldModel).then(() => {
                            scene.remove(oldModel);
                        });
                        characterState.loadedCharacters.survivors[index] = null;
                        console.log(`Removed old survivor at position ${index}`);
                    }
                    if (survivorUrl && survivorTransforms[index]) {
                        scheduleLoad(`survivor_${index + 1}`, () => loadCharacterModel(
                            scene, survivorUrl, survivor.name, survivorTransforms[index], 'survivor', index
                        ));
                    }
                } else if (survivorUrl) {
                    console.log(`Survivor ${index} unchanged: ${survivor.name}`);
                }
            });
        }

        for (let i = (jsonData.survivors?.length || 0); i < 4; i++) {
            if (characterState.loadedCharacters.survivors[i]) {
                cancelPending(`survivor_${i + 1}`);
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

    if (isWebContext) {
        console.log('[Init] Starting polling (every 1 second)');
        setInterval(pollCharacterData, 1000);
        pollCharacterData();
    } else {
        console.log('[Init] WebView2 context detected, polling disabled');
    }
}

export function fireSceneLoaded() {
    if (sceneLoadedFired) return;
    sceneLoadedFired = true;
    fire('scene_loaded', {});
    fire('loop', {});
}
