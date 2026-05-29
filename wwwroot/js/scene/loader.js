import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SCENE_CONFIG, DEFAULT_POSITIONS } from '../config.js';
import { state as characterState } from '../characters/loader.js';

export const state = {
    dummyModels: {
        hunter: null,
        survivors: []
    },
    dummyTransforms: {
        hunter: null,
        survivors: []
    },
    characterPositions: {
        hunter: null,
        survivors: []
    },
    sceneLoaded: false
};

function cloneTransform(t) {
    if (!t) return null;
    return {
        position: t.position.clone(),
        rotation: t.rotation.clone(),
        scale: t.scale.clone()
    };
}

function cloneTransforms(t) {
    return {
        hunter: cloneTransform(t.hunter),
        survivors: t.survivors.map(cloneTransform)
    };
}

function configureLightShadow(light, mapSize = 1024) {
    light.castShadow = true;
    light.shadow.mapSize.width = mapSize;
    light.shadow.mapSize.height = mapSize;
    light.shadow.bias = -0.0001;
    light.shadow.normalBias = 0.02;
    light.shadow.radius = 2;
}

function findDummyModels(loadedScene) {
    const hunter = loadedScene.getObjectByName(SCENE_CONFIG.dummyNames.hunter);
    const survivors = SCENE_CONFIG.dummyNames.survivors.map(name =>
        loadedScene.getObjectByName(name)
    ).filter(obj => obj !== undefined);

    if (hunter) {
        console.log(`Found hunter dummy: ${SCENE_CONFIG.dummyNames.hunter}`);
    } else {
        console.warn(`Hunter dummy not found: ${SCENE_CONFIG.dummyNames.hunter}`);
    }

    console.log(`Found ${survivors.length} survivor dummies`);

    return { hunter, survivors };
}

// Decompose dummy.matrixWorld into world-space position/quaternion/scale,
// then convert quaternion → Euler so the rest of the codebase can keep using Euler.
function worldTransformFromDummy(dummy) {
    dummy.updateWorldMatrix(true, false);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    dummy.matrixWorld.decompose(position, quaternion, scale);
    const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
    return { position, rotation, scale };
}

function getTransformsFromDummies(dummies) {
    const transforms = {
        hunter: null,
        survivors: []
    };

    if (dummies.hunter) {
        transforms.hunter = worldTransformFromDummy(dummies.hunter);
    } else {
        transforms.hunter = {
            position: DEFAULT_POSITIONS.hunter.clone(),
            rotation: new THREE.Euler(0, 0, 0),
            scale: new THREE.Vector3(1, 1, 1)
        };
    }

    for (let i = 0; i < 4; i++) {
        if (dummies.survivors[i]) {
            transforms.survivors.push(worldTransformFromDummy(dummies.survivors[i]));
        } else {
            transforms.survivors.push({
                position: DEFAULT_POSITIONS.survivors[i].clone(),
                rotation: new THREE.Euler(0, 0, 0),
                scale: new THREE.Vector3(1, 1, 1)
            });
        }
    }

    return transforms;
}

export function hideDummyModels(dummies) {
    if (dummies.hunter) {
        dummies.hunter.visible = false;
    }
    dummies.survivors.forEach(dummy => {
        if (dummy) dummy.visible = false;
    });
}

export function loadBlenderScene(scene, liveCamera) {
    return new Promise((resolve, reject) => {
        console.log(`Loading Blender scene from: ${SCENE_CONFIG.sceneUrl}`);

        const loader = new GLTFLoader();
        loader.load(
            SCENE_CONFIG.sceneUrl,
            (gltf) => {
                console.log('Blender scene loaded successfully');

                scene.add(gltf.scene);

                let lightCount = 0;
                gltf.scene.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;

                        if (child.material && child.material.emissive) {
                            child.material.emissive.setHex(0x000000);
                            child.material.emissiveIntensity = 0;
                        }
                    }

                    if (child.isLight) {
                        lightCount++;
                        const originalIntensity = child.intensity;
                        child.intensity *= SCENE_CONFIG.lightIntensityMultiplier;

                        if (child.isDirectionalLight) {
                            configureLightShadow(child, 2048);
                            child.shadow.camera.near = 0.5;
                            child.shadow.camera.far = 50;
                            child.shadow.camera.left = -20;
                            child.shadow.camera.right = 20;
                            child.shadow.camera.top = 20;
                            child.shadow.camera.bottom = -20;
                        } else if (child.isPointLight || child.isSpotLight) {
                            configureLightShadow(child);
                        }
                    }
                });

                if (lightCount === 0) {
                    console.warn('No lights in Blender scene (studio lights handle illumination)');
                } else {
                    console.log(`Configured ${lightCount} light(s) from Blender`);
                }

                if (gltf.cameras && gltf.cameras.length > 0 && liveCamera) {
                    const blenderCamera = gltf.cameras[0];
                    liveCamera.position.copy(blenderCamera.position);
                    liveCamera.rotation.copy(blenderCamera.rotation);
                    console.log('Using camera from Blender scene for liveCamera');
                }

                state.dummyModels = findDummyModels(gltf.scene);
                state.dummyTransforms = getTransformsFromDummies(state.dummyModels);
                state.characterPositions = cloneTransforms(state.dummyTransforms);
                hideDummyModels(state.dummyModels);

                state.sceneLoaded = true;
                resolve();
            },
            (progress) => {
                if (progress.total) {
                    const percent = (progress.loaded / progress.total) * 100;
                    console.log(`Loading: ${percent.toFixed(1)}%`);
                }
            },
            (error) => {
                console.error('Failed to load Blender scene:', error);
                reject(error);
            }
        );
    });
}

// Layer editor slot overrides on top of the dummy defaults. Called after the
// registry has been hydrated from saved settings AND whenever a slot changes.
// Also nudges any already-loaded character model to the new transform so edits
// are visible immediately in the scene.
export function applyRegistrySlotsToCharacterPositions(registry) {
    const fromRegistry = registry.resolveCharacterPositions();
    const updates = { hunter: null, survivors: [null, null, null, null] };

    if (fromRegistry.hunter) {
        state.characterPositions.hunter = fromRegistry.hunter;
        updates.hunter = fromRegistry.hunter;
    } else if (state.dummyTransforms.hunter) {
        state.characterPositions.hunter = state.dummyTransforms.hunter;
    }
    for (let i = 0; i < 4; i++) {
        if (fromRegistry.survivors[i]) {
            state.characterPositions.survivors[i] = fromRegistry.survivors[i];
            updates.survivors[i] = fromRegistry.survivors[i];
        } else if (state.dummyTransforms.survivors[i]) {
            state.characterPositions.survivors[i] = state.dummyTransforms.survivors[i];
        }
    }

    // Push transforms to already-loaded character models
    const hunterChar = characterState.loadedCharacters.hunter;
    if (hunterChar?.model && updates.hunter) {
        hunterChar.model.position.copy(updates.hunter.position);
        hunterChar.model.rotation.copy(updates.hunter.rotation);
    }
    for (let i = 0; i < 4; i++) {
        const char = characterState.loadedCharacters.survivors[i];
        if (char?.model && updates.survivors[i]) {
            char.model.position.copy(updates.survivors[i].position);
            char.model.rotation.copy(updates.survivors[i].rotation);
        }
    }
}

export function createMinimalFallbackScene(scene) {
    console.log('Creating minimal fallback scene');

    const groundGeometry = new THREE.PlaneGeometry(20, 20);
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x333333,
        roughness: 0.8,
        metalness: 0.1
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    state.dummyTransforms = {
        hunter: {
            position: DEFAULT_POSITIONS.hunter.clone(),
            rotation: new THREE.Euler(0, 0, 0),
            scale: new THREE.Vector3(1, 1, 1)
        },
        survivors: DEFAULT_POSITIONS.survivors.map(p => ({
            position: p.clone(),
            rotation: new THREE.Euler(0, 0, 0),
            scale: new THREE.Vector3(1, 1, 1)
        }))
    };
    state.characterPositions = state.dummyTransforms;
    state.sceneLoaded = true;
    console.log('Fallback scene created');
}
