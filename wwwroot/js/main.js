import * as THREE from 'three';
import { DEV, DEV_DATA, SCENE_DISPLAY_NAME } from './config.js';

// Tab title = scene name only, so multi-scene work is easy to navigate.
document.title = SCENE_DISPLAY_NAME;

// Favicon distinguishes live vs dev pages at a glance in the tab bar.
const faviconLink = document.getElementById('faviconLink');
if (faviconLink) {
    faviconLink.href = DEV ? './assets/favicon-dev.svg' : './assets/favicon-live.svg';
}
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
import { clipManager } from './animation/clips.js';
import { PostFxPipeline } from './scene/postFx.js';
import { initPerfMonitor, updatePerfMonitor } from './perf/statsMonitor.js';
import { t } from './i18n.js';

const canvas = document.getElementById('renderCanvas');
const clock = new THREE.Clock();

let renderer, scene, editorCamera, liveCamera, editorControls, cameraHelper, postFx;

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
    clipManager.update(delta);

    if (editorControls && editorControls.enabled) {
        editorControls.update();
    }

    if (cameraHelper && cameraHelper.visible) {
        cameraHelper.update();
    }

    const cam = getCurrentCamera();
    if (postFx) {
        postFx.setCamera(cam);
        postFx.render(delta);
    } else {
        renderer.render(scene, cam);
    }

    updatePerfMonitor();
}

(async function() {
    try {
        const settings = await loadSettings();
        initPerfMonitor();
        // rendererType is ignored; force webgl
        renderer = await setupRenderer(canvas, 'webgl');
        scene = setupScene(renderer);
        liveCamera = setupLiveCamera();
        editorCamera = setupEditorCamera();
        editorControls = setupEditorControls(editorCamera, canvas);
        cameraHelper = createLiveCameraHelper(liveCamera);
        // TransformControls needs its target in the scene graph
        scene.add(liveCamera);
        scene.add(cameraHelper);

        postFx = new PostFxPipeline(renderer, scene, liveCamera);
        setupWindowResize([liveCamera, editorCamera], renderer, (w, h) => postFx.setSize(w, h));

        registry.init(scene, liveCamera, renderer);
        // Prime and subscribe: rebuild the composer's filter passes any time world settings change.
        postFx.applyFilters(registry.world.postFx);
        registry.addEventListener('world:update', (e) => {
            postFx.applyFilters(e.detail?.spec?.postFx || []);
        });

        // Wire clipManager BEFORE hydrate so async asset .glb loads can register their clips
        // even if they complete during the awaits that follow.
        registry.addEventListener('assets:loaded', (e) => {
            const { id, spec, root, animations } = e.detail;
            if (animations && animations.length) {
                clipManager.addSource(`asset:${id}`, root, animations, spec.name || id);
            }
        });
        registry.addEventListener('assets:remove', (e) => {
            clipManager.removeSource(`asset:${e.detail.id}`);
        });

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

        // Re-sync the static committed mirrors after all startup edits are done, so the
        // seeded slots and any scene-derived camera become the initial "static" state.
        registry._commitStatic();

        registry.addEventListener('slots:update', () => applyRegistrySlotsToCharacterPositions(registry));
        registry.addEventListener('slots:add', () => applyRegistrySlotsToCharacterPositions(registry));
        registry.addEventListener('slots:remove', () => applyRegistrySlotsToCharacterPositions(registry));

        setupCharacterAPI(scene);

        if (Array.isArray(settings?.editor?.sequences)) {
            sequencer.hydrate(settings.editor.sequences);
        }

        clipManager.init(sceneState.gltfRoot, sceneState.gltfAnimations);
        if (settings?.editor?.clips) {
            clipManager.hydrate(settings.editor.clips);
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
            setupFeedbackTab();
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

function setupFeedbackTab() {
    const tab = document.getElementById('feedbackTab');
    if (!tab) return;

    document.getElementById('feedbackSummary').textContent = t('feedback.summary');
    document.getElementById('feedbackDiscordLabel').textContent = t('feedback.discord');
    document.getElementById('feedbackGithubLink').textContent = t('feedback.github');

    const userCode = document.getElementById('feedbackDiscordUser');
    userCode.title = t('feedback.copyTitle');

    const copied = document.getElementById('feedbackCopied');
    copied.textContent = t('feedback.copied');

    let copiedTimeout = null;
    userCode.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(userCode.textContent);
            copied.classList.add('show');
            clearTimeout(copiedTimeout);
            copiedTimeout = setTimeout(() => copied.classList.remove('show'), 1500);
        } catch (err) {
            console.warn('Clipboard write failed:', err);
        }
    });

    tab.style.display = 'block';
}
