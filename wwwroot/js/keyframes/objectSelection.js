import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// Discover selectable objects in the scene
export function discoverSceneObjects(scene) {
    const objects = [];
    const addedNames = new Set(); // Prevent duplicates

    // Blender helper/annotation names to filter out (case-insensitive)
    const helperNames = [
        'START', 'END', 'E',
        'X', 'Y', 'Z',
        'XY', 'XZ', 'YZ', 'XYZ', 'XYZE',
        'DELTA', 'AXIS',
        'Grid', 'Light',
        'Scene'
    ];

    scene.traverse((node) => {
        // Skip the scene itself
        if (node === scene) return;

        // Skip if no name or empty name
        if (!node.name || node.name.trim() === '') return;

        // Skip THREE.js helpers but allow cameras and lights
        if (node.isHelper) return;

        // Skip Blender helper objects (case-insensitive)
        if (helperNames.some(helper => node.name.toUpperCase() === helper.toUpperCase())) return;

        // Skip if already added
        if (addedNames.has(node.name)) return;

        // Include Groups, Meshes, Lights, Cameras, and Object3D nodes
        if (node.isGroup || node.isMesh || node.isLight || node.isCamera || node.isObject3D) {
            objects.push({
                name: node.name,
                type: node.type,
                object: node
            });
            addedNames.add(node.name);
        }
    });

    // Sort by name for better UX
    objects.sort((a, b) => a.name.localeCompare(b.name));

    return objects;
}

// Setup raycaster for object selection
export function setupObjectSelection(camera, canvas, scene, onObjectSelected) {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    canvas.addEventListener('click', (event) => {
        // Calculate normalized device coordinates
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);

        // Get all scene objects (excluding helpers, lights, cameras)
        const selectableObjects = [];
        scene.traverse((node) => {
            if (node.isMesh && node.name && !node.name.startsWith('_')) {
                selectableObjects.push(node);
            }
        });

        const intersects = raycaster.intersectObjects(selectableObjects, true);

        if (intersects.length > 0) {
            // Find the top-level parent object
            let selectedObject = intersects[0].object;
            while (selectedObject.parent &&
                   selectedObject.parent !== scene &&
                   selectedObject.parent.type !== 'Scene') {
                selectedObject = selectedObject.parent;
            }

            onObjectSelected(selectedObject);
        } else {
            // Clicked empty space - deselect
            onObjectSelected(null);
        }
    });
}

// Object highlighting system
let outlineMesh = null;

export function highlightObject(object, scene) {
    // Remove previous highlight
    if (outlineMesh) {
        // If it's a CameraHelper, restore original color instead of removing
        if (outlineMesh.type === 'CameraHelper' && outlineMesh.userData.originalColor) {
            outlineMesh.material.color.copy(outlineMesh.userData.originalColor);
        } else {
            // Remove from parent (could be scene or a camera/object)
            if (outlineMesh.parent) {
                outlineMesh.parent.remove(outlineMesh);
            }
            if (outlineMesh.geometry) outlineMesh.geometry.dispose();
            if (outlineMesh.material) outlineMesh.material.dispose();
        }
        outlineMesh = null;
    }

    if (!object) return;

    // Special handling for cameras - highlight the camera helper
    if (object.isCamera) {
        // Find the CameraHelper for this camera and change its color
        scene.traverse((child) => {
            if (child.type === 'CameraHelper' && child.camera === object) {
                // Store the original material to restore later
                child.userData.originalColor = child.material.color.clone();
                child.material.color.setHex(0x7b61ff);  // Purple highlight
                outlineMesh = child;
            }
        });
        return;
    }

    // Create bounding box outline for other objects
    const box = new THREE.Box3().setFromObject(object);
    const helper = new THREE.Box3Helper(box, 0x7b61ff);  // Purple accent color
    scene.add(helper);
    outlineMesh = helper;
}

export function clearHighlight(scene) {
    highlightObject(null, scene);
}

// TransformControls system
let transformControls = null;

export function setupTransformControls(camera, renderer, orbitControls) {
    transformControls = new TransformControls(camera, renderer.domElement);

    // Disable orbit controls when dragging
    transformControls.addEventListener('dragging-changed', (event) => {
        orbitControls.enabled = !event.value;
    });

    // Listen for transform changes to update keyframe data
    transformControls.addEventListener('change', () => {
        if (transformControls.object) {
            const obj = transformControls.object;
            window.dispatchEvent(new CustomEvent('objectTransformChanged', {
                detail: {
                    object: obj,
                    position: obj.position.clone(),
                    rotation: obj.rotation.clone(),
                    scale: obj.scale.clone()
                }
            }));
        }
    });

    return transformControls;
}

export function attachTransformControls(object, scene) {
    if (!transformControls) return;

    transformControls.detach();

    if (object) {
        transformControls.attach(object);
        if (!transformControls.parent) {
            scene.add(transformControls);
        }
    } else {
        scene.remove(transformControls);
    }
}

export function setTransformMode(mode) {
    // mode: "translate" | "rotate" | "scale"
    if (transformControls) {
        transformControls.setMode(mode);
    }
}

export function getTransformControls() {
    return transformControls;
}
