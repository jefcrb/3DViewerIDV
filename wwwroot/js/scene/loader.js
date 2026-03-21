import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SCENE_CONFIG, DEFAULT_POSITIONS } from '../config.js';

export const state = {
    dummyModels: {
        hunter: null,
        survivors: []
    },
    characterPositions: {
        hunter: null,
        survivors: []
    },
    sceneLoaded: false,
    blenderCamera: null  // Store reference to the Blender camera for animations
};

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

function getTransformsFromDummies(dummies) {
    const transforms = {
        hunter: null,
        survivors: []
    };

    if (dummies.hunter) {
        transforms.hunter = {
            position: dummies.hunter.getWorldPosition(new THREE.Vector3()),
            rotation: dummies.hunter.rotation.clone(),
            scale: dummies.hunter.scale.clone()
        };
    } else {
        transforms.hunter = {
            position: DEFAULT_POSITIONS.hunter.clone(),
            rotation: new THREE.Euler(0, 0, 0),
            scale: new THREE.Vector3(1, 1, 1)
        };
    }

    for (let i = 0; i < 4; i++) {
        if (dummies.survivors[i]) {
            transforms.survivors.push({
                position: dummies.survivors[i].getWorldPosition(new THREE.Vector3()),
                rotation: dummies.survivors[i].rotation.clone(),
                scale: dummies.survivors[i].scale.clone()
            });
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

export function loadBlenderScene(scene, camera) {
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

                        if (child.material) {
                            console.log(`Mesh: ${child.name}`);
                            console.log(`  Material:`, child.material.type);
                            console.log(`  Color:`, child.material.color);

                            if (child.material.emissive) {
                                console.log(`  Emissive BEFORE:`, child.material.emissive, 'Intensity:', child.material.emissiveIntensity);

                                child.material.emissive.setHex(0x000000);
                                child.material.emissiveIntensity = 0;

                                console.log(`  Emissive AFTER:`, child.material.emissive, 'Intensity:', child.material.emissiveIntensity);
                            }

                            console.log(`  CastShadow: ${child.castShadow}, ReceiveShadow: ${child.receiveShadow}`);
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
                            console.log(`  Configured DirectionalLight: ${originalIntensity.toFixed(2)} → ${child.intensity.toFixed(2)}`);
                        } else if (child.isPointLight) {
                            configureLightShadow(child);
                            console.log(`  Configured PointLight: ${originalIntensity.toFixed(2)} → ${child.intensity.toFixed(2)}`);
                        } else if (child.isSpotLight) {
                            configureLightShadow(child);
                            console.log(`  Configured SpotLight: ${originalIntensity.toFixed(2)} → ${child.intensity.toFixed(2)}`);
                        } else {
                            console.log(`  Found light: ${child.type}, ${originalIntensity.toFixed(2)} → ${child.intensity.toFixed(2)}`);
                        }
                    }
                });

                if (lightCount === 0) {
                    console.warn('No lights found in Blender scene (studio lights will handle illumination)');
                } else {
                    console.log(`Found and configured ${lightCount} light(s) from Blender`);
                }

                if (gltf.cameras && gltf.cameras.length > 0) {
                    const blenderCamera = gltf.cameras[0];
                    camera.position.copy(blenderCamera.position);
                    camera.rotation.copy(blenderCamera.rotation);
                    // Note: We don't copy FOV here - viewport camera keeps its own FOV for viewing
                    console.log('Using camera position/rotation from Blender scene (Blender FOV:', blenderCamera.fov + '°)');

                    // Add the Blender camera to the scene so it can be animated
                    // Find the camera in the scene hierarchy and add helper
                    gltf.scene.traverse((child) => {
                        if (child.isCamera) {
                            if (!child.name || child.name.trim() === '') {
                                child.name = 'BlenderCamera';
                            }

                            // Store reference to the Blender camera for animation system
                            state.blenderCamera = child;

                            // Add a CameraHelper to visualize the camera frustum
                            const cameraHelper = new THREE.CameraHelper(child);
                            cameraHelper.visible = false; // Hide by default
                            scene.add(cameraHelper);

                            console.log(`Found camera in scene: ${child.name} (FOV: ${child.fov}°, Aspect: ${child.aspect.toFixed(2)})`);
                        }
                    });
                }

                state.dummyModels = findDummyModels(gltf.scene);
                state.characterPositions = getTransformsFromDummies(state.dummyModels);
                hideDummyModels(state.dummyModels);

                state.sceneLoaded = true;
                resolve();
            },
            (progress) => {
                const percent = (progress.loaded / progress.total) * 100;
                console.log(`Loading: ${percent.toFixed(1)}%`);
            },
            (error) => {
                console.error('Failed to load Blender scene:', error);
                reject(error);
            }
        );
    });
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

    state.characterPositions = {
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

    console.log('Fallback scene created');
}
