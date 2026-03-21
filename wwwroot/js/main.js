import * as THREE from 'three';
import { DEV, DEV_DATA } from './config.js';
import { setupRenderer, setupScene, setupCamera, setupControls, setupStudioLighting, setupWindowResize } from './scene/setup.js';
import { loadBlenderScene, createMinimalFallbackScene, state as sceneState } from './scene/loader.js';
import { loadCustomScales, preloadAllModels, state as characterState } from './characters/loader.js';
import { setupCharacterAPI } from './characters/api.js';
import { populateDevDropdowns, setupDevMode, setDevReferences, applyStoredSettings } from './dev/devMode.js';
import { loadSettings } from './storage/settingsStorage.js';
import { setupKeyframePanel } from './keyframes/keyframePanel.js';
import { animationPlayer, TriggerManager } from './keyframes/keyframeEngine.js';
import { loadKeyframeAnimations } from './storage/keyframeAnimationStorage.js';
import { setAnimationData } from './keyframes/keyframeEditor.js';
import { initializeLightsFromData } from './keyframes/lightManager.js';

const canvas = document.getElementById('renderCanvas');
const clock = new THREE.Clock();

let renderer, scene, camera, controls, lights;

const TARGET_FPS = 60;
const MIN_FRAME_TIME = 1000 / TARGET_FPS;
let lastFrameTime = 0;

async function initializeScene() {
    try {
        await loadBlenderScene(scene, camera);
        await loadCustomScales();
        console.log('Scene initialization complete');
    } catch (error) {
        console.error('Blender scene loading failed:', error);
        console.error('Error details:', error.message);
        console.warn('Creating fallback scene. Please add scene.glb to assets/ folder.');

        createMinimalFallbackScene(scene);
    }
}

function animate(currentTime) {
    requestAnimationFrame(animate);

    // FPS throttling
    const elapsed = currentTime - lastFrameTime;
    if (elapsed < MIN_FRAME_TIME) {
        return;
    }
    lastFrameTime = currentTime - (elapsed % MIN_FRAME_TIME);

    const delta = clock.getDelta();

    if (characterState.loadedCharacters.hunter?.mixer) {
        characterState.loadedCharacters.hunter.mixer.update(delta);
    }
    characterState.loadedCharacters.survivors.forEach(survivor => {
        if (survivor?.mixer) {
            survivor.mixer.update(delta);
        }
    });

    if (controls.enabled) {
        controls.update();
    }

    // Update all animations (camera and lights)
    animationPlayer.update();

    // Sync viewport camera to animated Blender camera (only in live mode)
    if (!DEV && sceneState.blenderCamera) {
        camera.position.copy(sceneState.blenderCamera.position);
        camera.rotation.copy(sceneState.blenderCamera.rotation);
        camera.fov = sceneState.blenderCamera.fov;
        camera.updateProjectionMatrix();
    }

    // Update all camera helpers in the scene (only in DEV mode)
    if (DEV) {
        scene.traverse((child) => {
            if (child.type === 'CameraHelper') {
                child.update();
            }
        });
    }

    renderer.render(scene, camera);
}

(async function() {
    try {
        const settings = await loadSettings();
        const rendererType = settings?.rendering?.rendererType || 'webgl';
        console.log('Using renderer:', rendererType);

        renderer = await setupRenderer(canvas, rendererType);
        scene = setupScene(renderer);
        camera = setupCamera();
        controls = setupControls(camera, canvas);

        lights = setupStudioLighting(scene);
        await applyStoredSettings(lights, renderer);

        setupWindowResize(camera, renderer);
        setupCharacterAPI(scene);
        setupDevMode();
        await setDevReferences(lights, renderer);

        await initializeScene();
        console.log('Scene ready');

        // Load and initialize animation system (camera + lights)
        const keyframeData = await loadKeyframeAnimations();
        if (keyframeData) {
            // Use Blender camera for animations if available, otherwise fall back to viewport camera
            const animatableCamera = sceneState.blenderCamera || camera;
            animationPlayer.setCamera(animatableCamera);
            animationPlayer.loadAnimations(keyframeData);
            setAnimationData(keyframeData);

            // Initialize Camera properties from the Blender camera if available
            if (sceneState.blenderCamera && keyframeData.animatableObjects?.Camera) {
                const cameraObj = keyframeData.animatableObjects.Camera;
                if (!cameraObj.properties) {
                    cameraObj.properties = {};
                }

                // If Camera properties don't have values yet, initialize from Blender camera
                if (!cameraObj.properties.position) {
                    cameraObj.properties.position = {
                        x: sceneState.blenderCamera.position.x,
                        y: sceneState.blenderCamera.position.y,
                        z: sceneState.blenderCamera.position.z
                    };
                }
                if (!cameraObj.properties.rotation) {
                    cameraObj.properties.rotation = {
                        x: sceneState.blenderCamera.rotation.x,
                        y: sceneState.blenderCamera.rotation.y,
                        z: sceneState.blenderCamera.rotation.z
                    };
                }
                if (cameraObj.properties.fov === undefined) {
                    cameraObj.properties.fov = sceneState.blenderCamera.fov;
                }

                // Apply stored properties to Blender camera
                sceneState.blenderCamera.position.set(
                    cameraObj.properties.position.x,
                    cameraObj.properties.position.y,
                    cameraObj.properties.position.z
                );
                sceneState.blenderCamera.rotation.set(
                    cameraObj.properties.rotation.x,
                    cameraObj.properties.rotation.y,
                    cameraObj.properties.rotation.z
                );
                sceneState.blenderCamera.fov = cameraObj.properties.fov;
                sceneState.blenderCamera.updateProjectionMatrix();

                console.log('Applied Camera properties to Blender camera (FOV:', cameraObj.properties.fov + '°)');
            }

            // Initialize lights from animation data
            initializeLightsFromData(scene, keyframeData);

            console.log('Animation system loaded (camera + lights)');
            console.log('Animatable camera:', animatableCamera.name || 'viewport camera');
        }

        // Setup keyframe panel (in DEV mode)
        if (DEV) {
            // Pass both cameras: Blender camera for animations, viewport camera for TransformControls
            const animatableCamera = sceneState.blenderCamera || camera;
            setupKeyframePanel(scene, animatableCamera, camera, renderer, controls);
        }

        // Setup animation triggers
        const triggerManager = new TriggerManager(animationPlayer);
        triggerManager.setupCharacterLoadTrigger();

        // Preload all character models in background
        preloadAllModels().catch(err => {
            console.warn('Model preload encountered errors:', err);
        });

        animate();

        if (DEV) {
            console.log('DEV MODE: Enabled');
            document.getElementById('devPanel').style.display = 'block';
            document.getElementById('keyframePanel').style.display = 'block';
            populateDevDropdowns();

            // Enable camera controls in DEV mode
            controls.enabled = true;

            setTimeout(() => {
                window.loadCharactersJson(DEV_DATA);
            }, 500);
        }
    } catch (error) {
        console.error('Fatal initialization error:', error);
        document.getElementById('error').style.display = 'block';
        document.getElementById('errorMessage').textContent = `Fatal error: ${error.message}`;
    }
})();
