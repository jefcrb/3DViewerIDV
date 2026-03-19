import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// Global state
let scene, camera, renderer, orbitControls;
let transformControls = null;
let selectedObject = null;
let sceneObjects = {};
let animatorOpen = false;

// Animation chain state
let currentChain = [];
let fromState = null;
let savedAnimations = [];

// Initialize the keyframe editor
export function initKeyframeEditor(sceneRef, cameraRef, rendererRef, controlsRef) {
    scene = sceneRef;
    camera = cameraRef;
    renderer = rendererRef;
    orbitControls = controlsRef;

    console.log('Simple Animator initialized');

    // Create TransformControls
    setupTransformControls();

    // Load saved animations
    loadSavedAnimations();

    // Update UI
    updateSavedAnimationsList();

    console.log('Animator ready - click "Animator" button to open');
}

// Register scene objects
export function registerSceneObjects(objects) {
    sceneObjects = { ...objects };
    console.log('Registered objects:', Object.keys(sceneObjects));
    updateSceneObjectsList();
}

// Setup TransformControls
function setupTransformControls() {
    transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode('translate');
    transformControls.setSize(0.8);
    scene.add(transformControls);

    // Disable orbit controls when dragging
    transformControls.addEventListener('dragging-changed', (event) => {
        orbitControls.enabled = !event.value;
    });

    // Update properties while dragging
    transformControls.addEventListener('objectChange', () => {
        if (selectedObject) {
            updateCurrentProperties();
        }
    });

    // Hide by default
    transformControls.enabled = false;
    transformControls.visible = false;

    // Keyboard shortcuts for transform modes
    window.addEventListener('keydown', (event) => {
        if (!transformControls.enabled || !selectedObject) return;

        switch(event.key.toLowerCase()) {
            case 'g':
                transformControls.setMode('translate');
                console.log('Mode: Translate');
                break;
            case 'r':
                transformControls.setMode('rotate');
                console.log('Mode: Rotate');
                break;
            case 's':
                transformControls.setMode('scale');
                console.log('Mode: Scale');
                break;
        }
    });

    console.log('TransformControls created');
}

// Toggle animator panel
window.toggleAnimator = function() {
    const panel = document.getElementById('keyframeEditor');
    const btn = document.getElementById('animatorToggle');

    animatorOpen = !animatorOpen;

    if (animatorOpen) {
        panel.style.display = 'block';
        btn.classList.add('active');
        btn.textContent = '✕ Close';

        // Unlock camera controls
        if (orbitControls) {
            orbitControls.enabled = true;
        }

        console.log('Animator opened');
    } else {
        panel.style.display = 'none';
        btn.classList.remove('active');
        btn.textContent = '🎬 Animator';

        // Disable transform controls
        if (transformControls.enabled) {
            transformControls.enabled = false;
            transformControls.visible = false;
            transformControls.detach();
        }

        deselectObject();
        console.log('Animator closed');
    }
};

// Update scene objects list UI
function updateSceneObjectsList() {
    const container = document.getElementById('sceneObjectsList');

    if (Object.keys(sceneObjects).length === 0) {
        container.innerHTML = '<p class="hint">No objects available</p>';
        return;
    }

    // Group objects by type
    const groups = {
        'Camera': [],
        'Lights': [],
        'Meshes': [],
        'Groups': [],
        'Other': []
    };

    Object.entries(sceneObjects).forEach(([name, obj]) => {
        // Skip objects without names
        if (!name || name === '') return;

        if (obj.isCamera) {
            groups.Camera.push({ name, obj, type: 'Camera' });
        } else if (obj.isLight) {
            const lightType = obj.type.replace('Light', '');
            groups.Lights.push({ name, obj, type: lightType });
        } else if (obj.isMesh) {
            groups.Meshes.push({ name, obj, type: 'Mesh' });
        } else if (obj.isGroup) {
            groups.Groups.push({ name, obj, type: 'Group' });
        } else {
            groups.Other.push({ name, obj, type: obj.type || 'Object' });
        }
    });

    let html = '';
    Object.entries(groups).forEach(([groupName, items]) => {
        if (items.length === 0) return;

        html += `<div class="object-group">`;
        html += `<div class="object-group-title">${groupName} (${items.length})</div>`;

        items.forEach(({ name, obj, type }) => {
            const isSelected = selectedObject === obj;
            html += `
                <div class="object-list-item ${isSelected ? 'selected' : ''}" onclick="selectObjectByName('${name}')">
                    <span class="object-list-name">${name}</span>
                    <span class="object-list-type">${type}</span>
                </div>
            `;
        });

        html += `</div>`;
    });

    container.innerHTML = html;
}

// Select object by name
window.selectObjectByName = function(name) {
    const object = sceneObjects[name];
    if (object) {
        selectObject(object);
    }
};

// Select an object
function selectObject(object) {
    selectedObject = object;

    // Auto-enable transform controls
    if (!transformControls.enabled) {
        transformControls.enabled = true;
        transformControls.visible = true;
        console.log('Transform controls enabled');
    }

    // Attach transform controls
    transformControls.attach(object);

    // Update UI
    const infoDiv = document.getElementById('selectedObjectInfo');
    const objectType = object.isLight ? 'Light' :
                       object.isCamera ? 'Camera' :
                       object.isMesh ? 'Mesh' :
                       object.isGroup ? 'Group' : 'Object';

    infoDiv.innerHTML = `
        <p class="object-name">${object.name}</p>
        <p class="object-type">${objectType} | G: Move | R: Rotate | S: Scale</p>
    `;

    // Show intensity property if it's a light
    const intensityRow = document.getElementById('propIntensityRow');
    if (object.isLight) {
        intensityRow.style.display = 'flex';
    } else {
        intensityRow.style.display = 'none';
    }

    updateCurrentProperties();
    updateSceneObjectsList();

    // Enable step buttons
    document.getElementById('recordFromBtn').disabled = false;
    document.getElementById('addToChainBtn').disabled = fromState !== null;

    console.log('Selected:', object.name);
}

// Deselect object
function deselectObject() {
    selectedObject = null;
    fromState = null;
    transformControls.detach();

    const infoDiv = document.getElementById('selectedObjectInfo');
    infoDiv.innerHTML = '<p class="hint">Select an object from the list above</p>';

    // Reset properties
    document.getElementById('propPosX').textContent = '-';
    document.getElementById('propPosY').textContent = '-';
    document.getElementById('propPosZ').textContent = '-';
    document.getElementById('propRotX').textContent = '-';
    document.getElementById('propRotY').textContent = '-';
    document.getElementById('propRotZ').textContent = '-';
    document.getElementById('propScale').textContent = '-';
    document.getElementById('propIntensity').textContent = '-';

    // Disable step buttons
    document.getElementById('recordFromBtn').disabled = true;
    document.getElementById('addToChainBtn').disabled = true;

    updateSceneObjectsList();
}

// Update current properties display
function updateCurrentProperties() {
    if (!selectedObject) return;

    const pos = selectedObject.position;
    const rot = selectedObject.rotation;
    const scale = selectedObject.scale;

    document.getElementById('propPosX').textContent = pos.x.toFixed(2);
    document.getElementById('propPosY').textContent = pos.y.toFixed(2);
    document.getElementById('propPosZ').textContent = pos.z.toFixed(2);

    document.getElementById('propRotX').textContent = (rot.x * (180 / Math.PI)).toFixed(1) + '°';
    document.getElementById('propRotY').textContent = (rot.y * (180 / Math.PI)).toFixed(1) + '°';
    document.getElementById('propRotZ').textContent = (rot.z * (180 / Math.PI)).toFixed(1) + '°';

    document.getElementById('propScale').textContent = scale.x.toFixed(2);

    if (selectedObject.isLight && selectedObject.intensity !== undefined) {
        document.getElementById('propIntensity').textContent = selectedObject.intensity.toFixed(2);
    }
}

// Record FROM position
window.recordFrom = function() {
    if (!selectedObject) {
        alert('Please select an object first');
        return;
    }

    if (!selectedObject.name || selectedObject.name === '') {
        alert('This object has no name and cannot be animated. Please select a named object from scene.glb or lights (keyLight, fillLight, etc.)');
        return;
    }

    fromState = {
        objectName: selectedObject.name,
        position: {
            x: selectedObject.position.x,
            y: selectedObject.position.y,
            z: selectedObject.position.z
        },
        rotation: {
            x: selectedObject.rotation.x,
            y: selectedObject.rotation.y,
            z: selectedObject.rotation.z
        },
        scale: {
            x: selectedObject.scale.x,
            y: selectedObject.scale.y,
            z: selectedObject.scale.z
        }
    };

    if (selectedObject.isLight && selectedObject.intensity !== undefined) {
        fromState.intensity = selectedObject.intensity;
    }

    document.getElementById('fromStatus').innerHTML = `
        <span style="color: #4CAF50;">✓ FROM position recorded for "${selectedObject.name}"</span><br>
        <span style="font-size: 11px; color: #999;">Now move the object to the target position</span>
    `;

    document.getElementById('addToChainBtn').disabled = false;

    console.log('Recorded FROM state for:', selectedObject.name, fromState);
};

// Add animation step to chain
window.addToChain = function() {
    if (!selectedObject || !fromState) {
        alert('Please record a FROM position first');
        return;
    }

    const duration = parseInt(document.getElementById('stepDuration').value);
    const easing = document.getElementById('stepEasing').value;

    const step = {
        objectName: selectedObject.name,
        from: fromState,
        to: {
            objectName: selectedObject.name,
            position: {
                x: selectedObject.position.x,
                y: selectedObject.position.y,
                z: selectedObject.position.z
            },
            rotation: {
                x: selectedObject.rotation.x,
                y: selectedObject.rotation.y,
                z: selectedObject.rotation.z
            },
            scale: {
                x: selectedObject.scale.x,
                y: selectedObject.scale.y,
                z: selectedObject.scale.z
            }
        },
        duration: duration,
        easing: easing
    };

    if (selectedObject.isLight && selectedObject.intensity !== undefined) {
        step.to.intensity = selectedObject.intensity;
    }

    currentChain.push(step);

    // Reset from state for next step
    fromState = null;
    document.getElementById('fromStatus').innerHTML = '';
    document.getElementById('addToChainBtn').disabled = true;

    updateChainList();

    console.log('Added step to chain for:', selectedObject.name);
};

// Update chain list UI
function updateChainList() {
    const container = document.getElementById('chainList');

    if (currentChain.length === 0) {
        container.innerHTML = '<p class="hint">No animation steps yet</p>';
        document.getElementById('saveChainBtn').disabled = true;
        return;
    }

    document.getElementById('saveChainBtn').disabled = false;

    let html = '';
    currentChain.forEach((step, index) => {
        html += `
            <div class="chain-step">
                <div class="chain-step-header">
                    <span class="chain-step-number">Step ${index + 1}: ${step.objectName}</span>
                    <button class="btn-icon btn-delete" onclick="removeFromChain(${index})">✕</button>
                </div>
                <div class="chain-step-info">
                    Duration: ${step.duration}ms | Easing: ${step.easing}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// Remove step from chain
window.removeFromChain = function(index) {
    currentChain.splice(index, 1);
    updateChainList();
};

// Clear entire chain
window.clearChain = function() {
    if (currentChain.length === 0) return;
    if (!confirm('Clear all animation steps?')) return;

    currentChain = [];
    fromState = null;
    document.getElementById('fromStatus').innerHTML = '';
    updateChainList();
};

// Preview chain
window.previewChain = function() {
    if (currentChain.length === 0) {
        alert('No animation steps to preview');
        return;
    }

    console.log('Previewing animation chain...');

    // Create GSAP timeline
    const timeline = gsap.timeline();

    let currentTime = 0;

    currentChain.forEach((step) => {
        const object = sceneObjects[step.objectName];
        if (!object) {
            console.warn('Object not found:', step.objectName);
            return;
        }

        // Set initial position
        object.position.set(step.from.position.x, step.from.position.y, step.from.position.z);
        object.rotation.set(step.from.rotation.x, step.from.rotation.y, step.from.rotation.z);
        object.scale.set(step.from.scale.x, step.from.scale.y, step.from.scale.z);
        if (step.from.intensity !== undefined && object.isLight) {
            object.intensity = step.from.intensity;
        }

        // Animate to target
        timeline.to(object.position, {
            x: step.to.position.x,
            y: step.to.position.y,
            z: step.to.position.z,
            duration: step.duration / 1000,
            ease: step.easing
        }, currentTime);

        timeline.to(object.rotation, {
            x: step.to.rotation.x,
            y: step.to.rotation.y,
            z: step.to.rotation.z,
            duration: step.duration / 1000,
            ease: step.easing
        }, currentTime);

        timeline.to(object.scale, {
            x: step.to.scale.x,
            y: step.to.scale.y,
            z: step.to.scale.z,
            duration: step.duration / 1000,
            ease: step.easing
        }, currentTime);

        if (step.to.intensity !== undefined && object.isLight) {
            timeline.to(object, {
                intensity: step.to.intensity,
                duration: step.duration / 1000,
                ease: step.easing
            }, currentTime);
        }

        currentTime += step.duration / 1000;
    });

    timeline.play();
    console.log('Preview started');
};

// Save chain as animation
window.saveChain = function() {
    if (currentChain.length === 0) {
        alert('No animation steps to save');
        return;
    }

    const name = document.getElementById('animationName').value.trim();
    if (!name) {
        alert('Please enter an animation name');
        return;
    }

    const triggerType = document.getElementById('animationTrigger').value;
    const triggerDelay = parseInt(document.getElementById('triggerDelay').value);

    const animation = {
        id: Date.now().toString(),
        name: name,
        chain: [...currentChain],
        trigger: {
            type: triggerType,
            delay: triggerDelay
        }
    };

    // Add trigger-specific data
    if (triggerType === 'time') {
        animation.trigger.time = parseInt(document.getElementById('triggerTime').value);
    } else if (triggerType === 'characterChange') {
        animation.trigger.role = document.getElementById('triggerCharacterRole').value;
    } else if (triggerType === 'custom') {
        animation.trigger.eventName = document.getElementById('triggerEventName').value;
    }

    savedAnimations.push(animation);
    saveToLocalStorage();
    updateSavedAnimationsList();

    // Clear chain
    currentChain = [];
    fromState = null;
    document.getElementById('fromStatus').innerHTML = '';
    document.getElementById('animationName').value = '';
    updateChainList();

    console.log('Animation saved:', animation.name);
};

// Save to localStorage
function saveToLocalStorage() {
    try {
        localStorage.setItem('gsap_animations', JSON.stringify(savedAnimations));
        console.log('Animations saved to localStorage');
    } catch (error) {
        console.error('Failed to save animations:', error);
    }
}

// Load saved animations from localStorage
function loadSavedAnimations() {
    try {
        const stored = localStorage.getItem('gsap_animations');
        if (stored) {
            savedAnimations = JSON.parse(stored);
            console.log('Loaded animations from localStorage:', savedAnimations.length);
        } else {
            console.log('No saved animations found');
        }
    } catch (error) {
        console.error('Failed to load animations:', error);
    }
}

// Export animations to JSON file
window.exportAnimations = function() {
    if (savedAnimations.length === 0) {
        alert('No animations to export');
        return;
    }

    const data = JSON.stringify({ animations: savedAnimations }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'animations_gsap.json';
    a.click();
    URL.revokeObjectURL(url);

    console.log('Animations exported to file');
};

// Import animations from JSON file
window.importAnimations = function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (data.animations && Array.isArray(data.animations)) {
                    savedAnimations = data.animations;
                    saveToLocalStorage();
                    updateSavedAnimationsList();
                    console.log('Imported animations:', savedAnimations.length);
                    alert(`Imported ${savedAnimations.length} animations`);
                } else {
                    alert('Invalid animation file format');
                }
            } catch (error) {
                console.error('Failed to import:', error);
                alert('Failed to import animations');
            }
        };
        reader.readAsText(file);
    };

    input.click();
};

// Update saved animations list
function updateSavedAnimationsList() {
    const container = document.getElementById('savedAnimationsList');

    if (!container) return;

    if (savedAnimations.length === 0) {
        container.innerHTML = '<p class="hint">No animations saved yet</p>';
        return;
    }

    container.innerHTML = savedAnimations.map((anim) => `
        <div class="saved-animation-item">
            <div class="saved-animation-header">
                <span class="saved-animation-name">${anim.name}</span>
                <div class="saved-animation-actions">
                    <button class="btn-icon" onclick="playAnimation('${anim.id}')" title="Play">▶</button>
                    <button class="btn-icon btn-delete" onclick="deleteAnimation('${anim.id}')" title="Delete">✕</button>
                </div>
            </div>
            <div class="saved-animation-info">
                <span>🎯 ${anim.trigger.type}</span>
                <span>📍 ${anim.chain.length} step${anim.chain.length !== 1 ? 's' : ''}</span>
            </div>
        </div>
    `).join('');
}

// Play saved animation
window.playAnimation = function(id) {
    const anim = savedAnimations.find(a => a.id === id);
    if (!anim) {
        console.error('Animation not found:', id);
        return;
    }

    console.log('Playing animation:', anim.name);

    const timeline = gsap.timeline();

    let currentTime = 0;

    anim.chain.forEach((step) => {
        const object = sceneObjects[step.objectName];
        if (!object) {
            console.warn('Object not found:', step.objectName);
            return;
        }

        // Set initial position
        object.position.set(step.from.position.x, step.from.position.y, step.from.position.z);
        object.rotation.set(step.from.rotation.x, step.from.rotation.y, step.from.rotation.z);
        object.scale.set(step.from.scale.x, step.from.scale.y, step.from.scale.z);
        if (step.from.intensity !== undefined && object.isLight) {
            object.intensity = step.from.intensity;
        }

        // Animate to target
        timeline.to(object.position, {
            x: step.to.position.x,
            y: step.to.position.y,
            z: step.to.position.z,
            duration: step.duration / 1000,
            ease: step.easing
        }, currentTime);

        timeline.to(object.rotation, {
            x: step.to.rotation.x,
            y: step.to.rotation.y,
            z: step.to.rotation.z,
            duration: step.duration / 1000,
            ease: step.easing
        }, currentTime);

        timeline.to(object.scale, {
            x: step.to.scale.x,
            y: step.to.scale.y,
            z: step.to.scale.z,
            duration: step.duration / 1000,
            ease: step.easing
        }, currentTime);

        if (step.to.intensity !== undefined && object.isLight) {
            timeline.to(object, {
                intensity: step.to.intensity,
                duration: step.duration / 1000,
                ease: step.easing
            }, currentTime);
        }

        currentTime += step.duration / 1000;
    });

    timeline.play();
    console.log('Animation playing');
};

// Delete saved animation
window.deleteAnimation = function(id) {
    if (!confirm('Delete this animation?')) return;

    savedAnimations = savedAnimations.filter(a => a.id !== id);
    saveToLocalStorage();
    updateSavedAnimationsList();
    console.log('Animation deleted');
};

// Play animation by trigger
export function playAnimationByTrigger(triggerType, triggerData = {}) {
    savedAnimations.forEach(anim => {
        if (anim.trigger.type !== triggerType) return;

        // Check trigger conditions
        if (triggerType === 'characterChange') {
            if (anim.trigger.role && triggerData.role !== anim.trigger.role) return;
        } else if (triggerType === 'custom') {
            if (anim.trigger.eventName && triggerData.eventName !== anim.trigger.eventName) return;
        }

        // Play after delay
        const delay = anim.trigger.delay || 0;
        setTimeout(() => {
            window.playAnimation(anim.id);
        }, delay);
    });
}

// Trigger dropdown change handler
window.updateTriggerFields = function() {
    const triggerType = document.getElementById('animationTrigger').value;

    document.getElementById('triggerDelayGroup').style.display = 'none';
    document.getElementById('triggerTimeGroup').style.display = 'none';
    document.getElementById('triggerCharacterGroup').style.display = 'none';
    document.getElementById('triggerEventGroup').style.display = 'none';

    if (triggerType === 'onLoad') {
        document.getElementById('triggerDelayGroup').style.display = 'block';
    } else if (triggerType === 'time') {
        document.getElementById('triggerTimeGroup').style.display = 'block';
    } else if (triggerType === 'characterChange') {
        document.getElementById('triggerCharacterGroup').style.display = 'block';
    } else if (triggerType === 'custom') {
        document.getElementById('triggerEventGroup').style.display = 'block';
    }
};
