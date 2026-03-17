import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TARGET_HEIGHT } from '../config.js';
import { playIntroAnimation } from '../customization/introAnimation.js';
import { applyMaterialSettings } from '../customization/materials.js';

export const state = {
    loadedCharacters: {
        hunter: null,
        survivors: [null, null, null, null]
    },
    customScales: null
};

function disposeModel(characterData) {
    if (!characterData || !characterData.model) return;

    console.log('Disposing model resources:', characterData.name);

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

export function loadCharacterModel(scene, url, name, transform, type, index, options = {}) {
    console.log(`Loading ${type}: ${name} from ${url}`);

    const loader = new GLTFLoader();
    loader.load(
        url,
        (gltf) => {
            console.log(`Successfully loaded ${type}: ${name}`);

            const model = gltf.scene;

            requestAnimationFrame(() => {
                model.position.set(0, 0, 0);
                model.scale.set(1, 1, 1);
                model.updateMatrixWorld(true);

                const box = new THREE.Box3().setFromObject(model);
                const size = box.getSize(new THREE.Vector3());
                const height = size.y;

                // Normalize height and apply custom scales
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

                        // Only play the first animation to avoid conflicts
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
        },
        undefined,
        (error) => {
            console.error(`Error loading ${type} ${name}:`, error);
        }
    );
}
