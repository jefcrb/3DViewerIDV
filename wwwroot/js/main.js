import * as THREE from 'three';
import { DEV, DEV_DATA } from './config.js';
import {
    setupRenderer,
    setupScene,
    setupLiveCamera,
    setupEditorCamera,
    setupEditorControls,
    setupStudioLighting,
    setupWindowResize,
    createLiveCameraHelper
} from './scene/setup.js';
import {
    loadBlenderScene,
    createMinimalFallbackScene,
    applyRegistrySlotsToCharacterPositions,
    state as sceneState
} from './scene/loader.js';
import { loadCustomScales, preloadAllModels, state as characterState } from './characters/loader.js';
import { setupCharacterAPI, fireSceneLoaded } from './characters/api.js';
import { loadSettings } from './storage/settingsStorage.js';
import { registry } from './editor/registry.js';
import { sequencer } from './animation/sequencer.js';

const canvas = document.getElementById('renderCanvas');
const clock = new THREE.Clock();

let renderer, scene, editorCamera, liveCamera, editorControls, cameraHelper;

const TARGET_FPS = 60;
const MIN_FRAME_TIME = 1000 / TARGET_FPS;
let lastFrameTime = 0;

function getCurrentCamera() {
    if (window.__editor && window.__editor.getActiveCamera) {
        return window.__editor.getActiveCamera() || liveCamera;
    }
    return liveCamera;
}

function animate(currentTime) {
    requestAnimationFrame(animate);

    const elapsed = currentTime - lastFrameTime;
    if (elapsed < MIN_FRAME_TIME) return;
    lastFrameTime = currentTime - (elapsed % MIN_FRAME_TIME);

    const delta = clock.getDelta();

    if (characterState.loadedCharacters.hunter?.mixer) {
        characterState.loadedCharacters.hunter.mixer.update(delta);
    }
    characterState.loadedCharacters.survivors.forEach(survivor => {
        if (survivor?.mixer) survivor.mixer.update(delta);
    });

    // Drive any active sequences. update() takes wall-clock seconds.
    sequencer.update(currentTime / 1000);

    if (editorControls && editorControls.enabled) {
        editorControls.update();
    }

    if (cameraHelper && cameraHelper.visible) {
        cameraHelper.update();
    }

    renderer.render(scene, getCurrentCamera());
}

(async function() {
    try {
        const settings = await loadSettings();
        const rendererType = settings?.rendering?.rendererType || 'webgl';
        console.log('Using renderer:', rendererType);

        renderer = await setupRenderer(canvas, rendererType);
        scene = setupScene(renderer);
        liveCamera = setupLiveCamera();
        editorCamera = setupEditorCamera();
        editorControls = setupEditorControls(editorCamera, canvas);
        cameraHelper = createLiveCameraHelper(liveCamera);
        // TransformControls requires its target to be in a scene graph
        scene.add(liveCamera);
        scene.add(cameraHelper);

        setupWindowResize([liveCamera, editorCamera], renderer);

        // Initialize registry with scene + liveCamera + renderer references
        registry.init(scene, liveCamera, renderer);

        // Hydrate registry from saved editor settings BEFORE seeding defaults
        if (settings?.editor) {
            registry.hydrate(settings.editor);
        }

        // Seed default lighting rig if registry is still empty
        setupStudioLighting();

        const hadSavedLiveCamera = !!settings?.editor?.liveCamera;
        try {
            // Skip Blender camera override if user has a saved live camera
            await loadBlenderScene(scene, hadSavedLiveCamera ? null : liveCamera);
            await loadCustomScales();
        } catch (error) {
            console.error('Blender scene loading failed:', error);
            createMinimalFallbackScene(scene);
        }

        // Sync registry's stored liveCamera with the actual camera state after Blender
        // load (only if user had no saved liveCamera — otherwise registry already holds
        // the authored values).
        if (!hadSavedLiveCamera) {
            registry.liveCamera.position = [liveCamera.position.x, liveCamera.position.y, liveCamera.position.z];
            registry.liveCamera.rotation = [liveCamera.rotation.x, liveCamera.rotation.y, liveCamera.rotation.z];
            registry.liveCamera.fov = liveCamera.fov;
        }

        // Seed default slots from dummies if none persisted
        if (registry.slots.size === 0) {
            registry.seedDefaultSlots(sceneState.dummyTransforms);
        }

        // Layer registry slot overrides onto current character positions
        applyRegistrySlotsToCharacterPositions(registry);

        // Keep characterPositions in sync whenever slots change
        registry.addEventListener('slots:update', () => applyRegistrySlotsToCharacterPositions(registry));
        registry.addEventListener('slots:add', () => applyRegistrySlotsToCharacterPositions(registry));
        registry.addEventListener('slots:remove', () => applyRegistrySlotsToCharacterPositions(registry));

        setupCharacterAPI(scene);

        // Hydrate sequences from saved settings
        if (Array.isArray(settings?.editor?.sequences)) {
            sequencer.hydrate(settings.editor.sequences);
        }

        // Initialize editor only in DEV mode. In DEV the editor's setMode('editor')
        // call disables auto-firing; in non-DEV the live view fires triggers freely.
        if (DEV) {
            const editorMod = await import('./editor/editorMode.js');
            const camPanelMod = await import('./editor/cameraPanel.js');
            camPanelMod.setEditorCameraRef(editorCamera);
            await editorMod.initEditor({
                scene,
                editorCamera,
                liveCamera,
                orbitControls: editorControls,
                cameraHelper,
                canvas
            });
            window.__editor = editorMod;
            document.getElementById('modeToggleBtn').style.display = 'inline-block';
        }

        // Preload all character models in background
        preloadAllModels().catch(err => {
            console.warn('Model preload encountered errors:', err);
        });

        animate();

        // Fire scene_loaded after first frame so animations can react
        requestAnimationFrame(() => fireSceneLoaded());

        if (DEV) {
            console.log('DEV MODE: Enabled');
            setTimeout(() => {
                if (window.loadCharactersJson) window.loadCharactersJson(DEV_DATA);
            }, 500);
        }
    } catch (error) {
        console.error('Fatal initialization error:', error);
        document.getElementById('error').style.display = 'block';
        document.getElementById('errorMessage').textContent = `Fatal error: ${error.message}`;
    }
})();
