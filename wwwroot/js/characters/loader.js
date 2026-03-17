import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { TARGET_HEIGHT } from '../config.js';
import { playIntroAnimation, stopIntroAnimation } from '../customization/introAnimation.js';
import { applyMaterialSettings } from '../customization/materials.js';

export const state = {
    loadedCharacters: {
        hunter: null,
        survivors: [null, null, null, null]
    },
    customScales: null
};

const modelCache = new Map();
let preloadComplete = false;

function disposeModel(characterData) {
    if (!characterData || !characterData.model) return;

    console.log('Disposing model resources:', characterData.name);

    stopIntroAnimation(characterData.model);

    if (characterData.mixer) {
        characterData.mixer.stopAllAction();
        characterData.mixer = null;
    }

    characterData.model.traverse((node) => {
        if (node.geometry) {
            node.geometry.dispose();
        }

        if (node.material) {
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            materials.forEach((material) => {
                if (material) {
                    if (material.map) material.map.dispose();
                    if (material.lightMap) material.lightMap.dispose();
                    if (material.bumpMap) material.bumpMap.dispose();
                    if (material.normalMap) material.normalMap.dispose();
                    if (material.specularMap) material.specularMap.dispose();
                    if (material.envMap) material.envMap.dispose();
                    if (material.alphaMap) material.alphaMap.dispose();
                    if (material.aoMap) material.aoMap.dispose();
                    if (material.displacementMap) material.displacementMap.dispose();
                    if (material.emissiveMap) material.emissiveMap.dispose();
                    if (material.gradientMap) material.gradientMap.dispose();
                    if (material.metalnessMap) material.metalnessMap.dispose();
                    if (material.roughnessMap) material.roughnessMap.dispose();

                    material.dispose();
                }
            });
        }
    });
}

export async function loadCustomScales() {
    if (state.customScales) return state.customScales;

    try {
        const response = await fetch('./custom_scales.json?t=' + Date.now());
        if (!response.ok) {
            console.warn('custom_scales.json not found, using default scales');
            state.customScales = {};
            return state.customScales;
        }
        state.customScales = await response.json();
        console.log('Loaded custom scales:', state.customScales);
        return state.customScales;
    } catch (error) {
        console.warn('Failed to load custom_scales.json:', error);
        state.customScales = {};
        return state.customScales;
    }
}

export async function preloadAllModels() {
    if (preloadComplete) {
        console.log('Models already preloaded');
        return;
    }

    console.log('Starting model preload...');
    const startTime = performance.now();

    const loader = new GLTFLoader();
    const directories = ['hunters', 'survivors'];
    let totalLoaded = 0;
    let totalFailed = 0;

    for (const dir of directories) {
        try {
            const response = await fetch(`./${dir}/character_list.json`);
            if (!response.ok) {
                console.warn(`No character_list.json found in ${dir}, skipping preload for this directory`);
                continue;
            }

            const characterList = await response.json();

            // Load each model
            for (const characterName of characterList) {
                const url = `./${dir}/${characterName}/${characterName}.gltf`;

                try {
                    const gltf = await new Promise((resolve, reject) => {
                        loader.load(url, resolve, undefined, reject);
                    });

                    // Cache the entire GLTF object
                    modelCache.set(url, gltf);
                    totalLoaded++;
                    console.log(`Cached: ${characterName} (${totalLoaded} loaded)`);
                } catch (error) {
                    console.warn(`Failed to preload ${characterName}:`, error.message);
                    totalFailed++;
                }
            }
        } catch (error) {
            console.warn(`Failed to load character list for ${dir}:`, error);
        }
    }

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`Model preload complete: ${totalLoaded} models cached, ${totalFailed} failed in ${elapsed}s`);
    preloadComplete = true;
}

// Process and add model to scene (shared logic for cached and loaded models)
function processAndAddModel(gltf, scene, url, name, transform, type, index, options) {
    const model = SkeletonUtils.clone(gltf.scene);

    requestAnimationFrame(() => {
        model.position.set(0, 0, 0);
        model.scale.set(1, 1, 1);
        model.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const height = size.y;

        if (height > 0) {
            const baseScale = TARGET_HEIGHT / height;
            let finalScale = baseScale;

            if (options.bypassNormalization) {
                finalScale = 1.0;
            }

            const folderName = url.split('/').filter(Boolean).slice(-2, -1)[0];

            if (state.customScales) {
                const customData = state.customScales[folderName] || state.customScales[name];
                if (customData) {
                    if (typeof customData === 'number') {
                        finalScale *= customData;
                        console.log(`Applied custom scale for ${folderName}: ${customData}`);
                    } else if (customData.scale) {
                        finalScale *= customData.scale;
                        console.log(`Applied custom scale for ${folderName}: ${customData.scale}`);
                    }
                }
            }

            model.scale.set(
                finalScale * transform.scale.x,
                finalScale * transform.scale.y,
                finalScale * transform.scale.z
            );

            console.log(`Normalized ${name}: height=${height.toFixed(2)}, base=${baseScale.toFixed(2)}, dummy scale=(${transform.scale.x.toFixed(2)}, ${transform.scale.y.toFixed(2)}, ${transform.scale.z.toFixed(2)})`);
        }

        model.position.copy(transform.position);
        model.rotation.copy(transform.rotation);

        // Apply Y-offset
        const folderName = url.split('/').filter(Boolean).slice(-2, -1)[0];
        if (state.customScales) {
            const customData = state.customScales[folderName] || state.customScales[name];
            if (customData && customData.yOffset) {
                model.position.y += customData.yOffset;
                console.log(`Applied Y-offset for ${folderName}: ${customData.yOffset}`);
            }
        }

        requestAnimationFrame(() => {
            applyMaterialSettings(model);

            let mixer = null;
            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(model);

                const clip = gltf.animations[0];
                const action = mixer.clipAction(clip);
                action.play();

                console.log(`Playing animation: "${clip.name}" (1 of ${gltf.animations.length})`);
            }

            requestAnimationFrame(() => {
                // Properly dispose and unload before loading new model
                if (type === 'survivor' && index >= 0 && index < 4) {
                    if (state.loadedCharacters.survivors[index]) {
                        disposeModel(state.loadedCharacters.survivors[index]);
                        scene.remove(state.loadedCharacters.survivors[index].model);
                    }
                } else if (type === 'hunter') {
                    if (state.loadedCharacters.hunter) {
                        disposeModel(state.loadedCharacters.hunter);
                        scene.remove(state.loadedCharacters.hunter.model);
                    }
                }

                scene.add(model);

                // Play intro animation
                playIntroAnimation(model);

                const characterData = {
                    model: model,
                    mixer: mixer,
                    name: name,
                    url: url
                };

                if (type === 'hunter') {
                    state.loadedCharacters.hunter = characterData;
                } else if (type === 'survivor' && index >= 0 && index < 4) {
                    state.loadedCharacters.survivors[index] = characterData;
                }
            });
        });
    });
}

export function loadCharacterModel(scene, url, name, transform, type, index, options = {}) {
    // Check cache first
    if (modelCache.has(url)) {
        console.log(`Loading ${type}: ${name} from cache (instant)`);
        const cachedGltf = modelCache.get(url);
        processAndAddModel(cachedGltf, scene, url, name, transform, type, index, options);
        return;
    }

    // Cache miss - load from disk
    console.log(`Loading ${type}: ${name} from ${url}`);

    const loader = new GLTFLoader();
    loader.load(
        url,
        (gltf) => {
            console.log(`Successfully loaded ${type}: ${name}`);

            // Cache for future use
            if (!modelCache.has(url)) {
                modelCache.set(url, gltf);
                console.log(`Cached model: ${name}`);
            }

            processAndAddModel(gltf, scene, url, name, transform, type, index, options);
        },
        undefined,
        (error) => {
            console.error(`Error loading ${type} ${name}:`, error);
        }
    );
}
