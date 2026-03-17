import * as THREE from 'three';
import { DEV, DEV_DATA } from './config.js';
import { setupRenderer, setupScene, setupCamera, setupControls, setupStudioLighting, setupWindowResize } from './scene/setup.js';
import { loadBlenderScene, createMinimalFallbackScene } from './scene/loader.js';
import { loadCustomScales, preloadAllModels, state as characterState } from './characters/loader.js';
import { setupCharacterAPI } from './characters/api.js';
import { populateDevDropdowns, setupDevMode, setDevReferences, applyStoredSettings } from './dev/devMode.js';
import { loadSettings } from './storage/settingsStorage.js';

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

        // Preload all character models in background
        preloadAllModels().catch(err => {
            console.warn('Model preload encountered errors:', err);
        });

        animate();

        if (DEV) {
            console.log('DEV MODE: Enabled');
            document.getElementById('devPanel').style.display = 'block';
            populateDevDropdowns();

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
