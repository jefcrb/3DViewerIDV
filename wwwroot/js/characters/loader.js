import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TARGET_HEIGHT } from '../config.js';

export const state = {
    loadedCharacters: {
        hunter: null,
        survivors: [null, null, null, null]
    },
    customScales: null
};

export async function loadCustomScales() {
    if (state.customScales) return state.customScales;

    try {
        const response = await fetch('./custom_scales.json');
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

export function loadCharacterModel(scene, url, name, transform, type, index) {
    console.log(`Loading ${type}: ${name} from ${url}`);

    const loader = new GLTFLoader();
    loader.load(
        url,
        (gltf) => {
            console.log(`Successfully loaded ${type}: ${name}`);

            const model = gltf.scene;

            model.position.set(0, 0, 0);
            model.scale.set(1, 1, 1);

            model.updateMatrixWorld(true);

            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const height = size.y;

            if (height > 0) {
                const baseScale = TARGET_HEIGHT / height;
                let finalScale = baseScale;

                if (state.customScales && state.customScales[name]) {
                    finalScale *= state.customScales[name];
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

            model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            let mixer = null;
            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(model);

                gltf.animations.forEach((clip) => {
                    const action = mixer.clipAction(clip);
                    action.play();
                });

                console.log(`Loaded ${gltf.animations.length} animation(s) for ${name}`);
            }

            scene.add(model);

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
        },
        undefined,
        (error) => {
            console.error(`Error loading ${type} ${name}:`, error);
        }
    );
}
