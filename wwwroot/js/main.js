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
        // rendererType is ignored: WebGPU is broken on many configs; force webgl.
        renderer = await setupRenderer(canvas, 'webgl');
        scene = setupScene(renderer);
        liveCamera = setupLiveCamera();
        editorCamera = setupEditorCamera();
        editorControls = setupEditorControls(editorCamera, canvas);
        cameraHelper = createLiveCameraHelper(liveCamera);
        // TransformControls needs its target in the scene graph.
        scene.add(liveCamera);
        scene.add(cameraHelper);

        setupWindowResize([liveCamera, editorCamera], renderer);

        registry.init(scene, liveCamera, renderer);

        if (settings?.editor) {
            registry.hydrate(settings.editor);
        }

        setupStudioLighting();

        const hadSavedLiveCamera = !!settings?.editor?.liveCamera;
        try {
            await loadBlenderScene(scene, hadSavedLiveCamera ? null : liveCamera);
            await loadCustomScales();
        } catch (error) {
            console.error('Blender scene loading failed:', error);
            createMinimalFallbackScene(scene);
        }

        if (!hadSavedLiveCamera) {
            registry.liveCamera.position = [liveCamera.position.x, liveCamera.position.y, liveCamera.position.z];
            registry.liveCamera.rotation = [liveCamera.rotation.x, liveCamera.rotation.y, liveCamera.rotation.z];
            registry.liveCamera.fov = liveCamera.fov;
        }

        if (registry.slots.size === 0) {
            registry.seedDefaultSlots(sceneState.dummyTransforms);
        }

        applyRegistrySlotsToCharacterPositions(registry);

        registry.addEventListener('slots:update', () => applyRegistrySlotsToCharacterPositions(registry));
        registry.addEventListener('slots:add', () => applyRegistrySlotsToCharacterPositions(registry));
        registry.addEventListener('slots:remove', () => applyRegistrySlotsToCharacterPositions(registry));

        setupCharacterAPI(scene);

        if (Array.isArray(settings?.editor?.sequences)) {
            sequencer.hydrate(settings.editor.sequences);
        }

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
            document.getElementById('topActions').style.display = 'flex';
        }

        preloadAllModels().catch(err => {
            console.warn('Model preload encountered errors:', err);
        });

        animate();

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
