import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
    createChain,
    updateChain,
    deleteChain,
    getChainsForObject,
    addKeyframe,
    updateKeyframe,
    deleteKeyframe,
    getKeyframe,
    createLight,
    deleteObject,
    updateObjectProperties,
    getAllAnimatableObjects,
    getAnimationData,
    setAnimationData
} from './keyframeEditor.js';
import { animationPlayer } from './keyframeEngine.js';
import { createSceneLight, getSceneLight, updateLightProperties, deleteSceneLight, updateSpotlightTarget } from './lightManager.js';
import { saveKeyframeAnimations } from '../storage/keyframeAnimationStorage.js';

// Panel state
let selectedObjectName = null;
let selectedObjectData = null;
let selectedChain = null;
let selectedKeyframe = null;
let transformControls = null;
let scene = null;
let camera = null; // Animatable camera (Blender camera)
let viewportCamera = null; // Viewport camera for rendering
let controls = null; // Orbit controls
let originalObjectState = null; // Store original state when editing keyframes

// Setup keyframe panel
export function setupKeyframePanel(sceneRef, animatableCameraRef, viewportCameraRef, renderer, orbitControls) {
    scene = sceneRef;
    camera = animatableCameraRef; // Camera to animate
    viewportCamera = viewportCameraRef; // Camera for viewing
    controls = orbitControls; // Store orbit controls

    // Initialize transform controls with viewport camera (for correct gizmo positioning)
    transformControls = new TransformControls(viewportCamera, renderer.domElement);

    // Disable orbit controls when dragging
    transformControls.addEventListener('dragging-changed', (event) => {
        orbitControls.enabled = !event.value;

        // Save position when dragging ends
        if (!event.value && transformControls.object && selectedObjectName && selectedObjectData) {
            // Check if we're editing a keyframe or static properties
            if (selectedKeyframe && selectedChain) {
                // Update the selected keyframe's properties
                const obj = transformControls.object;
                const properties = {
                    position: {
                        x: obj.position.x,
                        y: obj.position.y,
                        z: obj.position.z
                    },
                    rotation: {
                        x: obj.rotation.x,
                        y: obj.rotation.y,
                        z: obj.rotation.z
                    }
                };

                // Add type-specific properties
                if (selectedObjectData.type === 'camera') {
                    properties.fov = obj.fov;
                } else if (selectedObjectData.type === 'light') {
                    properties.intensity = obj.intensity;
                    properties.color = obj.color.getHex();
                    if (obj.isSpotLight) {
                        properties.angle = obj.angle;
                        properties.penumbra = obj.penumbra;
                    }
                }

                // Update keyframe
                const keyframeId = selectedKeyframe.id;
                updateKeyframe(selectedObjectName, selectedChain.id, keyframeId, { properties });
                reloadChainAndKeyframe(keyframeId);

                console.log(`Updated keyframe ${keyframeId} from drag`);
            } else {
                // Update static properties
                if (selectedObjectData.type === 'light') {
                    const light = transformControls.object;
                    updateObjectProperties(selectedObjectName, {
                        position: {
                            x: light.position.x,
                            y: light.position.y,
                            z: light.position.z
                        },
                        rotation: {
                            x: light.rotation.x,
                            y: light.rotation.y,
                            z: light.rotation.z
                        }
                    });
                    console.log(`Updated static position for ${selectedObjectName}:`, light.position);

                    // Update spotlight target after moving/rotating
                    if (light.isSpotLight) {
                        updateSpotlightTarget(light);
                    }
                } else if (selectedObjectData.type === 'camera') {
                    const cam = transformControls.object;
                    updateObjectProperties(selectedObjectName, {
                        position: {
                            x: cam.position.x,
                            y: cam.position.y,
                            z: cam.position.z
                        },
                        rotation: {
                            x: cam.rotation.x,
                            y: cam.rotation.y,
                            z: cam.rotation.z
                        }
                    });
                    console.log(`Updated static position for camera:`, cam.position);
                }
            }
        }
    });

    // Listen for transform changes
    transformControls.addEventListener('change', () => {
        if (transformControls.object) {
            // If editing a keyframe, update keyframe inputs instead of main property inputs
            if (selectedKeyframe && selectedChain) {
                updateKeyframePropertyDisplays();
            } else {
                updatePropertyDisplays();
            }

            // Update spotlight target when rotating/moving spotlight
            if (selectedObjectData && selectedObjectData.type === 'light') {
                const light = transformControls.object;
                if (light.isSpotLight) {
                    updateSpotlightTarget(light);
                }
            }
        }
    });

    scene.add(transformControls);

    // Initialize UI
    // refreshLightList();
}

// ==================== OBJECT MANAGEMENT ====================

function refreshLightList() {
    const objects = getAllAnimatableObjects();
    const listEl = document.getElementById('lightList');

    // Filter to get only lights
    const lights = Object.entries(objects).filter(([name, data]) => data.type === 'light');

    if (lights.length === 0) {
        listEl.innerHTML = '<p class="empty-state">No lights added</p>';
        return;
    }

    listEl.innerHTML = '';
    lights.forEach(([name, data]) => {
        const item = document.createElement('div');
        item.className = 'light-item';
        item.innerHTML = `
            <span class="light-name">${name}</span>
            <span class="light-type">${data.lightType}</span>
        `;
        item.onclick = () => selectObject(name);
        listEl.appendChild(item);
    });
}

function selectObject(objectName) {
    // Detach transform controls to prevent updates to wrong object
    if (transformControls) {
        transformControls.detach();
    }

    // Hide all helpers before selecting new object
    hideAllHelpers();

    // Clear chain and keyframe selection when switching objects
    selectedChain = null;
    selectedKeyframe = null;
    hideKeyframeEditor();
    hideChainEditor();

    selectedObjectName = objectName;
    const objects = getAllAnimatableObjects();
    selectedObjectData = objects[objectName];

    if (!selectedObjectData) {
        console.error(`Object "${objectName}" not found`);
        return;
    }

    // Update UI selection states
    document.querySelectorAll('.object-button, .light-item').forEach(el => {
        el.classList.remove('selected');
    });

    if (objectName === 'Camera') {
        document.getElementById('cameraButton').classList.add('selected');
        // Show camera helper
        showCameraHelper();
    } else {
        document.querySelectorAll('.light-item').forEach(el => {
            if (el.querySelector('.light-name').textContent === objectName) {
                el.classList.add('selected');
            }
        });
        // Show light helper
        const light = getSceneLight(objectName);
        if (light && light.userData.helper) {
            light.userData.helper.visible = true;
        }
    }

    // Show selected info
    document.getElementById('selectedInfo').innerHTML = `
        <p><strong>${objectName}</strong></p>
        <p>Type: ${selectedObjectData.type}</p>
    `;

    // Show appropriate property editor
    showObjectProperties();

    // Load animation chains for this object
    loadObjectChains(objectName);

    // Default to Properties tab when selecting an object
    switchToTab('properties');

    // Attach transform controls
    attachTransformControlsToObject();
}

function hideAllHelpers() {
    // Hide all light helpers
    const objects = getAllAnimatableObjects();
    Object.entries(objects).forEach(([name, data]) => {
        if (data.type === 'light') {
            const light = getSceneLight(name);
            if (light && light.userData.helper) {
                light.userData.helper.visible = false;
            }
        }
    });

    // Hide camera helper
    hideCameraHelper();
}

function showCameraHelper() {
    // Find camera helper in scene
    scene.traverse((child) => {
        if (child.type === 'CameraHelper' && child.camera === camera) {
            child.visible = true;
        }
    });
}

function hideCameraHelper() {
    // Find camera helper in scene
    scene.traverse((child) => {
        if (child.type === 'CameraHelper' && child.camera === camera) {
            child.visible = false;
        }
    });
}

function showObjectProperties() {
    const tabContainer = document.getElementById('objectTabContainer');
    const objectActionsEl = document.getElementById('objectActions');
    const cameraPropsEl = document.getElementById('cameraProperties');
    const lightPropsEl = document.getElementById('lightProperties');
    const spotlightPropsEl = document.getElementById('spotlightProperties');

    tabContainer.style.display = 'block';

    if (selectedObjectData.type === 'camera') {
        cameraPropsEl.style.display = 'block';
        lightPropsEl.style.display = 'none';
        objectActionsEl.style.display = 'none'; // Hide action buttons for camera

        // Update FOV slider from the actual camera being animated (Blender camera)
        const fov = camera.fov;
        document.getElementById('cameraFovSlider').value = fov;
        document.getElementById('cameraFovValue').textContent = fov.toFixed(0);

    } else if (selectedObjectData.type === 'light') {
        cameraPropsEl.style.display = 'none';
        lightPropsEl.style.display = 'block';
        objectActionsEl.style.display = 'flex'; // Show action buttons for lights

        const light = getSceneLight(selectedObjectName);
        if (light) {
            // Update light property inputs
            document.getElementById('lightNameInput').value = selectedObjectName;
            document.getElementById('lightTypeSelect').value = selectedObjectData.lightType;
            document.getElementById('lightIntensityInput').value = light.intensity.toFixed(1);
            document.getElementById('lightColorInput').value = '#' + light.color.getHex().toString(16).padStart(6, '0');

            // Show/hide spotlight properties
            if (selectedObjectData.lightType === 'spot') {
                spotlightPropsEl.style.display = 'block';
                document.getElementById('spotAngleSlider').value = THREE.MathUtils.radToDeg(light.angle);
                document.getElementById('spotAngleValue').textContent = THREE.MathUtils.radToDeg(light.angle).toFixed(0);
                document.getElementById('spotPenumbraSlider').value = light.penumbra;
                document.getElementById('spotPenumbraValue').textContent = light.penumbra.toFixed(2);
            } else {
                spotlightPropsEl.style.display = 'none';
            }
        }
    }

    updatePropertyDisplays();
}

function updatePropertyDisplays() {
    if (!selectedObjectName) return;

    // If we're editing a keyframe, use the original state for property displays
    // This prevents the main properties from showing the temporary keyframe position
    let displaySource;
    if (originalObjectState && selectedKeyframe) {
        displaySource = originalObjectState;
    } else {
        // Otherwise, read from the actual object
        if (selectedObjectData.type === 'camera') {
            displaySource = {
                position: camera.position,
                rotation: camera.rotation
            };
        } else if (selectedObjectData.type === 'light') {
            const light = getSceneLight(selectedObjectName);
            if (light) {
                displaySource = {
                    position: light.position,
                    rotation: light.rotation
                };
            }
        }
    }

    if (!displaySource) return;

    if (selectedObjectData.type === 'camera') {
        // Position
        document.getElementById('posX').value = displaySource.position.x.toFixed(2);
        document.getElementById('posY').value = displaySource.position.y.toFixed(2);
        document.getElementById('posZ').value = displaySource.position.z.toFixed(2);

        // Rotation (convert to degrees)
        document.getElementById('rotX').value = THREE.MathUtils.radToDeg(displaySource.rotation.x).toFixed(1);
        document.getElementById('rotY').value = THREE.MathUtils.radToDeg(displaySource.rotation.y).toFixed(1);
        document.getElementById('rotZ').value = THREE.MathUtils.radToDeg(displaySource.rotation.z).toFixed(1);
    } else if (selectedObjectData.type === 'light') {
        // Position (light-specific IDs)
        document.getElementById('posX_light').value = displaySource.position.x.toFixed(2);
        document.getElementById('posY_light').value = displaySource.position.y.toFixed(2);
        document.getElementById('posZ_light').value = displaySource.position.z.toFixed(2);

        // Rotation (convert to degrees, light-specific IDs)
        document.getElementById('rotX_light').value = THREE.MathUtils.radToDeg(displaySource.rotation.x).toFixed(1);
        document.getElementById('rotY_light').value = THREE.MathUtils.radToDeg(displaySource.rotation.y).toFixed(1);
        document.getElementById('rotZ_light').value = THREE.MathUtils.radToDeg(displaySource.rotation.z).toFixed(1);
    }
}

// Update keyframe property displays during keyframe editing
function updateKeyframePropertyDisplays() {
    if (!selectedObjectName || !selectedKeyframe) return;

    let obj;
    if (selectedObjectData.type === 'camera') {
        obj = camera;
    } else if (selectedObjectData.type === 'light') {
        obj = getSceneLight(selectedObjectName);
    }

    if (!obj) return;

    // Update keyframe inputs
    document.getElementById('kfPosX').value = obj.position.x.toFixed(2);
    document.getElementById('kfPosY').value = obj.position.y.toFixed(2);
    document.getElementById('kfPosZ').value = obj.position.z.toFixed(2);

    document.getElementById('kfRotX').value = THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(1);
    document.getElementById('kfRotY').value = THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(1);
    document.getElementById('kfRotZ').value = THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(1);

    // Auto-save the keyframe properties
    updateKeyframeProperties();
}

function attachTransformControlsToObject() {
    if (!selectedObjectData) {
        transformControls.detach();
        return;
    }

    if (selectedObjectData.type === 'camera') {
        transformControls.attach(camera);
        transformControls.setMode('translate');
    } else if (selectedObjectData.type === 'light') {
        const light = getSceneLight(selectedObjectName);
        if (light) {
            transformControls.attach(light);
            transformControls.setMode('translate');
        }
    }
}

// ==================== CHAIN MANAGEMENT ====================

function loadObjectChains(objectName) {
    const chains = getChainsForObject(objectName);
    const listEl = document.getElementById('chainList');

    if (chains.length === 0) {
        listEl.innerHTML = '<p class="empty-state">No animations</p>';
        return;
    }

    listEl.innerHTML = '';
    chains.forEach(chain => {
        const item = document.createElement('div');
        item.className = 'chain-item';
        item.title = 'Click to edit this animation';

        // Migrate old format if needed
        if (chain.trigger && !Array.isArray(chain.triggers)) {
            chain.triggers = [convertOldTriggerFormat(chain.trigger)];
        }
        if (!chain.triggers) chain.triggers = [];

        // Build trigger info text
        let triggerInfo = 'No triggers';
        if (chain.triggers.length === 1) {
            const trigger = chain.triggers[0];
            triggerInfo = getTriggerDisplayName(trigger.type, trigger.delay);
        } else if (chain.triggers.length > 1) {
            triggerInfo = `${chain.triggers.length} triggers`;
        }

        item.innerHTML = `
            <button class="chain-delete-btn" onclick="deleteChainFromCard('${objectName}', '${chain.id}')" title="Delete animation">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
            </button>
            <div class="chain-name">${chain.name}</div>
            <div class="chain-info">${chain.keyframes.length} keyframe${chain.keyframes.length !== 1 ? 's' : ''} • ${triggerInfo}</div>
            <div class="chain-buttons">
                <button onclick="playChain('${objectName}', '${chain.id}')" title="Play animation">Play</button>
                <button onclick="editChainFromCard('${objectName}', '${chain.id}')" title="Edit animation">Edit</button>
            </div>
        `;
        listEl.appendChild(item);
    });
}

function selectChain(chain) {
    console.log('[Chain] Selecting chain:', chain.name, 'for object:', selectedObjectName, 'Keyframes:', chain.keyframes?.length || 0);

    selectedChain = chain;
    selectedKeyframe = null;
    hideKeyframeEditor();

    // Switch to animations tab
    switchToTab('animations');

    // Highlight chain in list
    document.querySelectorAll('.chain-item').forEach(el => {
        el.classList.toggle('selected', el.querySelector('.chain-name').textContent === chain.name);
    });

    // Show chain editor
    showChainEditor(chain);
}

function showChainEditor(chain) {
    console.log('[Chain Editor] Opening editor for chain:', chain.name, 'Keyframes:', chain.keyframes?.length || 0);

    const editor = document.getElementById('chainEditor');
    editor.style.display = 'block';

    // Populate fields
    document.getElementById('chainNameInput').value = chain.name;

    // Migrate old trigger format to new array format if needed
    if (chain.trigger && !Array.isArray(chain.triggers)) {
        chain.triggers = [convertOldTriggerFormat(chain.trigger)];
        delete chain.trigger;
    }
    if (chain.stopCondition && !Array.isArray(chain.stopConditions)) {
        chain.stopConditions = [convertOldStopConditionFormat(chain.stopCondition)];
        delete chain.stopCondition;
    }

    // Ensure triggers/stopConditions arrays exist
    if (!chain.triggers) chain.triggers = [];
    if (!chain.stopConditions) chain.stopConditions = [];

    // Display triggers
    displayTriggers(chain.triggers);

    // Populate loop checkbox
    document.getElementById('loopCheckbox').checked = chain.loop || false;

    // Display stop conditions
    displayStopConditions(chain.stopConditions);

    // Reset new trigger/stop condition inputs
    document.getElementById('newTriggerSelect').value = '';
    document.getElementById('newStopConditionSelect').value = '';
    document.getElementById('newTriggerOptions').innerHTML = '';
    document.getElementById('newStopConditionOptions').innerHTML = '';

    // Load keyframes
    loadKeyframesForChain(chain);
}

function hideChainEditor() {
    document.getElementById('chainEditor').style.display = 'none';
    selectedChain = null;
}

// Convert old trigger format to new format
function convertOldTriggerFormat(oldTrigger) {
    let type = oldTrigger.type;

    // Convert old time_delay trigger to on_load
    if (type === 'time_delay') {
        type = 'on_load';
    }

    if (type === 'character_load' || type === 'character_unload') {
        if (oldTrigger.characterType === 'hunter') {
            type = `${type}_hunter`;
        } else if (oldTrigger.characterType === 'survivor') {
            if (oldTrigger.survivorPosition) {
                type = `${type}_survivor_${oldTrigger.survivorPosition}`;
            } else {
                type = `${type}_survivor`;
            }
        }
    }

    const newTrigger = { type };
    return newTrigger;
}

// Convert old stop condition format to new format
function convertOldStopConditionFormat(oldCondition) {
    let type = oldCondition.type;

    if (type === 'character_load' || type === 'character_unload') {
        if (oldCondition.characterType === 'hunter') {
            type = `${type}_hunter`;
        } else if (oldCondition.characterType === 'survivor') {
            if (oldCondition.survivorPosition) {
                type = `${type}_survivor_${oldCondition.survivorPosition}`;
            } else {
                type = `${type}_survivor`;
            }
        }
    }

    const newCondition = { type };
    if (type === 'time_delay') {
        newCondition.delay = oldCondition.delay || 0;
    }
    return newCondition;
}

// Get display name for trigger/stop condition type
function getTriggerDisplayName(type, delay) {
    const names = {
        'on_load': 'On Load',
        'manual': 'Manual',
        'character_load': 'Any Character Load',
        'character_load_hunter': 'Hunter Load',
        'character_load_survivor': 'Any Survivor Load',
        'character_load_survivor_1': 'Survivor 1 Load',
        'character_load_survivor_2': 'Survivor 2 Load',
        'character_load_survivor_3': 'Survivor 3 Load',
        'character_load_survivor_4': 'Survivor 4 Load',
        'character_unload': 'Any Character Unload',
        'character_unload_hunter': 'Hunter Unload',
        'character_unload_survivor': 'Any Survivor Unload',
        'character_unload_survivor_1': 'Survivor 1 Unload',
        'character_unload_survivor_2': 'Survivor 2 Unload',
        'character_unload_survivor_3': 'Survivor 3 Unload',
        'character_unload_survivor_4': 'Survivor 4 Unload',
        'time_delay': `Time Delay (${delay}ms)`,
        'none': 'None'
    };
    return names[type] || type;
}

// Display triggers list
function displayTriggers(triggers) {
    const listEl = document.getElementById('triggersList');

    if (!triggers || triggers.length === 0) {
        listEl.innerHTML = '<p style="padding: 0 12px; margin: 8px 0; font-size: 11px; color: #888;">No triggers set</p>';
        return;
    }

    let html = '<div style="padding: 0 12px; margin-bottom: 12px;">';
    triggers.forEach((trigger, index) => {
        html += `
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; padding: 6px; background: #1e1e1e; border: 1px solid #3c3c3c; border-radius: 4px;">
                <span style="flex: 1; font-size: 11px; color: #e5e5e5;">${getTriggerDisplayName(trigger.type, trigger.delay)}</span>
                <button onclick="removeTrigger(${index})" style="padding: 2px 6px; font-size: 10px; background: #3c2c2c; border: 1px solid #5c3c3c; color: #ff6b6b; border-radius: 3px; cursor: pointer;">Remove</button>
            </div>
        `;
    });
    html += '</div>';
    listEl.innerHTML = html;
}

// Display stop conditions list
function displayStopConditions(stopConditions) {
    const listEl = document.getElementById('stopConditionsList');

    if (!stopConditions || stopConditions.length === 0) {
        listEl.innerHTML = '<p style="padding: 0 12px; margin: 8px 0; font-size: 11px; color: #888;">No stop conditions set</p>';
        return;
    }

    let html = '<div style="padding: 0 12px; margin-bottom: 12px;">';
    stopConditions.forEach((condition, index) => {
        html += `
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; padding: 6px; background: #1e1e1e; border: 1px solid #3c3c3c; border-radius: 4px;">
                <span style="flex: 1; font-size: 11px; color: #e5e5e5;">${getTriggerDisplayName(condition.type, condition.delay)}</span>
                <button onclick="removeStopCondition(${index})" style="padding: 2px 6px; font-size: 10px; background: #3c2c2c; border: 1px solid #5c3c3c; color: #ff6b6b; border-radius: 3px; cursor: pointer;">Remove</button>
            </div>
        `;
    });
    html += '</div>';
    listEl.innerHTML = html;
}

// ==================== KEYFRAME MANAGEMENT ====================

function loadKeyframesForChain(chain) {
    console.log('[Keyframes] Loading keyframes for chain:', chain.name, 'Count:', chain.keyframes?.length || 0, 'Keyframes:', chain.keyframes);

    const listEl = document.getElementById('keyframeList');

    // Ensure keyframes array exists
    if (!chain.keyframes) {
        console.warn('[Keyframes] No keyframes array found, initializing empty array');
        chain.keyframes = [];
    }

    if (chain.keyframes.length === 0) {
        listEl.innerHTML = '<p class="empty-state">No keyframes</p>';
        return;
    }

    listEl.innerHTML = '';
    chain.keyframes.forEach((keyframe, index) => {
        const item = document.createElement('div');
        item.className = 'keyframe-item';

        // Build property summary
        const props = keyframe.properties;
        let propSummary = [];

        if (props.position) {
            const pos = props.position;
            propSummary.push(`Pos: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
        }
        if (props.fov !== undefined) {
            propSummary.push(`FOV: ${props.fov}°`);
        }
        if (props.intensity !== undefined) {
            propSummary.push(`Intensity: ${props.intensity.toFixed(1)}`);
        }
        if (props.color !== undefined) {
            const colorHex = '#' + props.color.toString(16).padStart(6, '0');
            propSummary.push(`Color: ${colorHex}`);
        }

        item.innerHTML = `
            <div class="keyframe-number">Keyframe ${index + 1}</div>
            <div class="keyframe-props">${keyframe.duration}ms • ${keyframe.easing}${keyframe.delay > 0 ? ` • +${keyframe.delay}ms` : ''}</div>
            <div class="keyframe-targets">${propSummary.join(' • ')}</div>
        `;
        item.onclick = () => selectKeyframeItem(keyframe, index);
        listEl.appendChild(item);
    });
}

function selectKeyframeItem(keyframe, index) {
    selectedKeyframe = keyframe;

    // Highlight keyframe in list
    document.querySelectorAll('.keyframe-item').forEach((el, i) => {
        el.classList.toggle('selected', i === index);
    });

    // Move object to keyframe's position (preview)
    if (selectedObjectData && keyframe.properties) {
        let obj;
        if (selectedObjectData.type === 'camera') {
            obj = camera;
        } else if (selectedObjectData.type === 'light') {
            obj = getSceneLight(selectedObjectName);
        }

        if (obj) {
            const props = keyframe.properties;

            if (props.position) {
                obj.position.set(props.position.x, props.position.y, props.position.z);
            }
            if (props.rotation) {
                obj.rotation.set(props.rotation.x, props.rotation.y, props.rotation.z);
            }

            // Apply type-specific properties
            if (selectedObjectData.type === 'camera' && props.fov !== undefined) {
                obj.fov = props.fov;
                obj.updateProjectionMatrix();
            } else if (selectedObjectData.type === 'light') {
                if (props.intensity !== undefined) obj.intensity = props.intensity;
                if (props.color !== undefined) obj.color.setHex(props.color);
                if (obj.isSpotLight) {
                    if (props.angle !== undefined) obj.angle = props.angle;
                    if (props.penumbra !== undefined) obj.penumbra = props.penumbra;
                }
                if (obj.userData.helper) obj.userData.helper.update();
            }
        }
    }

    // Show keyframe editor
    showKeyframeEditor(keyframe, index);

    updatePropertyDisplays();
}

function showKeyframeEditor(keyframe, index) {
    const editor = document.getElementById('keyframeEditor');
    editor.style.display = 'block';

    // Store original object state from saved static properties (not current object position)
    // This ensures we restore to the true static position, not any temporary position
    const objects = getAllAnimatableObjects();
    const objectData = objects[selectedObjectName];

    if (objectData && objectData.properties) {
        originalObjectState = {
            position: new THREE.Vector3(
                objectData.properties.position.x,
                objectData.properties.position.y,
                objectData.properties.position.z
            ),
            rotation: new THREE.Euler(
                objectData.properties.rotation.x,
                objectData.properties.rotation.y,
                objectData.properties.rotation.z
            )
        };

        // Add type-specific properties from saved data
        if (selectedObjectData.type === 'camera' && objectData.properties.fov !== undefined) {
            originalObjectState.fov = objectData.properties.fov;
        } else if (selectedObjectData.type === 'light') {
            if (objectData.properties.intensity !== undefined) {
                originalObjectState.intensity = objectData.properties.intensity;
            }
            if (objectData.properties.color !== undefined) {
                originalObjectState.color = new THREE.Color(objectData.properties.color);
            }
            if (objectData.lightType === 'spot') {
                if (objectData.properties.angle !== undefined) {
                    originalObjectState.angle = objectData.properties.angle;
                }
                if (objectData.properties.penumbra !== undefined) {
                    originalObjectState.penumbra = objectData.properties.penumbra;
                }
            }
        }

        // Move object to keyframe's position/rotation for editing
        let obj;
        if (selectedObjectData.type === 'camera') {
            obj = camera;
        } else if (selectedObjectData.type === 'light') {
            obj = getSceneLight(selectedObjectName);
        }

        if (obj) {
            const props = keyframe.properties;
            if (props.position) {
                obj.position.set(props.position.x, props.position.y, props.position.z);
            }
            if (props.rotation) {
                obj.rotation.set(props.rotation.x, props.rotation.y, props.rotation.z);
            }
        }
    }

    // Populate fields
    document.getElementById('keyframeIndex').textContent = index + 1;
    document.getElementById('durationSlider').value = keyframe.duration;
    document.getElementById('durationValue').textContent = keyframe.duration;
    document.getElementById('delaySlider').value = keyframe.delay;
    document.getElementById('delayValue').textContent = keyframe.delay;
    document.getElementById('easingSelect').value = keyframe.easing;

    // Show/hide property groups based on object type
    const cameraPropsEl = document.getElementById('kfCameraProperties');
    const lightPropsEl = document.getElementById('kfLightProperties');
    const spotlightPropsEl = document.getElementById('kfSpotlightProperties');

    if (selectedObjectData.type === 'camera') {
        cameraPropsEl.style.display = 'block';
        lightPropsEl.style.display = 'none';
    } else if (selectedObjectData.type === 'light') {
        cameraPropsEl.style.display = 'none';
        lightPropsEl.style.display = 'block';

        if (selectedObjectData.lightType === 'spot') {
            spotlightPropsEl.style.display = 'block';
        } else {
            spotlightPropsEl.style.display = 'none';
        }
    }

    // Populate transform input fields
    const props = keyframe.properties;
    if (props.position) {
        document.getElementById('kfPosX').value = props.position.x.toFixed(2);
        document.getElementById('kfPosY').value = props.position.y.toFixed(2);
        document.getElementById('kfPosZ').value = props.position.z.toFixed(2);
    }
    if (props.rotation) {
        document.getElementById('kfRotX').value = (props.rotation.x * 180 / Math.PI).toFixed(1);
        document.getElementById('kfRotY').value = (props.rotation.y * 180 / Math.PI).toFixed(1);
        document.getElementById('kfRotZ').value = (props.rotation.z * 180 / Math.PI).toFixed(1);
    }

    // Camera-specific properties
    if (selectedObjectData.type === 'camera' && props.fov !== undefined) {
        document.getElementById('kfFovSlider').value = props.fov;
        document.getElementById('kfFovValue').textContent = props.fov.toFixed(0);
    }

    // Light-specific properties
    if (selectedObjectData.type === 'light') {
        if (props.intensity !== undefined) {
            document.getElementById('kfIntensityInput').value = props.intensity.toFixed(1);
        }
        if (props.color !== undefined) {
            document.getElementById('kfLightColor').value = '#' + props.color.toString(16).padStart(6, '0');
        }

        // Spotlight properties
        if (selectedObjectData.lightType === 'spot') {
            if (props.angle !== undefined) {
                const angleDeg = THREE.MathUtils.radToDeg(props.angle);
                document.getElementById('kfSpotAngleSlider').value = angleDeg;
                document.getElementById('kfSpotAngleValue').textContent = angleDeg.toFixed(0);
            }
            if (props.penumbra !== undefined) {
                document.getElementById('kfSpotPenumbraSlider').value = props.penumbra;
                document.getElementById('kfSpotPenumbraValue').textContent = props.penumbra.toFixed(2);
            }
        }
    }
}

function hideKeyframeEditor() {
    document.getElementById('keyframeEditor').style.display = 'none';
    selectedKeyframe = null;
    restoreOriginalObjectState();
}

// Restore object to its original state
function restoreOriginalObjectState() {
    if (!originalObjectState) return;

    let obj;
    if (selectedObjectData && selectedObjectData.type === 'camera') {
        obj = camera;
    } else if (selectedObjectData && selectedObjectData.type === 'light') {
        obj = getSceneLight(selectedObjectName);
    }

    if (obj) {
        obj.position.copy(originalObjectState.position);
        obj.rotation.copy(originalObjectState.rotation);

        // Restore type-specific properties
        if (selectedObjectData.type === 'camera' && originalObjectState.fov !== undefined) {
            obj.fov = originalObjectState.fov;
            obj.updateProjectionMatrix();
        } else if (selectedObjectData.type === 'light') {
            if (originalObjectState.intensity !== undefined) {
                obj.intensity = originalObjectState.intensity;
            }
            if (originalObjectState.color) {
                obj.color.copy(originalObjectState.color);
            }
            if (obj.isSpotLight) {
                if (originalObjectState.angle !== undefined) {
                    obj.angle = originalObjectState.angle;
                }
                if (originalObjectState.penumbra !== undefined) {
                    obj.penumbra = originalObjectState.penumbra;
                }
                updateSpotlightTarget(obj);
            }
        }

        // Update property displays to reflect restored state
        updatePropertyDisplays();
    }

    originalObjectState = null;
}

// Helper function to reload chain and maintain keyframe selection
function reloadChainAndKeyframe(keyframeId) {
    if (!selectedObjectName || !selectedChain) return;

    // Reload chain from storage to get fresh data
    const chains = getChainsForObject(selectedObjectName);
    const updatedChain = chains.find(c => c.id === selectedChain.id);

    if (updatedChain) {
        selectedChain = updatedChain;

        // Find and update the selected keyframe reference
        const keyframeIndex = updatedChain.keyframes.findIndex(kf => kf.id === keyframeId);
        if (keyframeIndex !== -1) {
            selectedKeyframe = updatedChain.keyframes[keyframeIndex];
        }

        // Refresh the keyframe list display
        loadKeyframesForChain(selectedChain);

        // Re-highlight the selected keyframe
        document.querySelectorAll('.keyframe-item').forEach((el, i) => {
            el.classList.toggle('selected', i === keyframeIndex);
        });
    }
}

// ==================== WINDOW-SCOPED FUNCTIONS (for HTML onclick/oninput) ====================

window.selectObject = selectObject;

window.setTransformMode = function(mode) {
    if (transformControls) {
        transformControls.setMode(mode);
    }
};

window.showAddLightDialog = function() {
    // Auto-generate light name preview
    const objects = getAllAnimatableObjects();
    let lightNumber = 1;
    let lightName;

    // Find next available number
    do {
        lightName = `Light_${String(lightNumber).padStart(3, '0')}`;
        lightNumber++;
    } while (objects[lightName]);

    document.getElementById('newLightNamePreview').textContent = lightName;
    document.getElementById('addLightDialog').style.display = 'flex';
};

window.closeAddLightDialog = function() {
    document.getElementById('addLightDialog').style.display = 'none';
};

window.confirmAddLight = function() {
    const lightType = document.getElementById('newLightType').value;
    const lightName = document.getElementById('newLightNamePreview').textContent;

    const finalName = createLight(lightName, lightType);
    if (finalName) {
        const objects = getAllAnimatableObjects();
        const lightData = objects[finalName];
        createSceneLight(scene, finalName, lightType, lightData.properties);
        // refreshLightList();

        // Auto-select the new light
        setTimeout(() => selectObject(finalName), 100);

        // Close dialog
        window.closeAddLightDialog();
    }
};

window.duplicateLightObject = function() {
    if (!selectedObjectName || selectedObjectData.type !== 'light') return;

    const objects = getAllAnimatableObjects();
    const sourceLight = objects[selectedObjectName];
    if (!sourceLight) return;

    // Generate unique name for duplicate
    let duplicateNumber = 1;
    let newName;
    do {
        newName = `${selectedObjectName}_Copy${duplicateNumber > 1 ? duplicateNumber : ''}`;
        duplicateNumber++;
    } while (objects[newName]);

    // Get current scene light for properties
    const sceneLight = getSceneLight(selectedObjectName);
    if (!sceneLight) return;

    // Prepare properties for the duplicate (offset position slightly)
    const duplicateProps = {
        position: {
            x: sceneLight.position.x + 1, // Offset slightly so it's visible
            y: sceneLight.position.y,
            z: sceneLight.position.z
        },
        rotation: {
            x: sceneLight.rotation.x,
            y: sceneLight.rotation.y,
            z: sceneLight.rotation.z
        },
        color: sceneLight.color.getHex(),
        intensity: sceneLight.intensity
    };

    // Copy type-specific properties
    if (sceneLight.isSpotLight) {
        duplicateProps.angle = sceneLight.angle;
        duplicateProps.penumbra = sceneLight.penumbra;
    }

    // Create the light in the animation data
    const finalName = createLight(newName, sourceLight.lightType);
    if (!finalName) return;

    // Update properties
    updateObjectProperties(finalName, duplicateProps);

    // Deep copy all animation chains
    const animData = getAnimationData();
    const newLightData = animData.animatableObjects[finalName];

    // Copy chains with new UUIDs
    newLightData.chains = sourceLight.chains.map(chain => ({
        ...JSON.parse(JSON.stringify(chain)), // Deep copy
        id: THREE.MathUtils.generateUUID() // Generate new ID
    }));

    // Update in-memory data and save to file
    setAnimationData(animData);
    saveKeyframeAnimations(animData);

    // Create the light in the scene
    createSceneLight(scene, finalName, sourceLight.lightType, duplicateProps);

    // Refresh UI
    // refreshLightList();

    // Auto-select the duplicate
    setTimeout(() => selectObject(finalName), 100);

    console.log(`Duplicated light "${selectedObjectName}" as "${finalName}" with ${newLightData.chains.length} animation(s)`);
};

window.deleteLightObject = function() {
    if (!selectedObjectName || selectedObjectData.type !== 'light') return;

    if (!confirm(`Delete light "${selectedObjectName}"?`)) return;

    deleteSceneLight(scene, selectedObjectName);
    deleteObject(selectedObjectName);

    selectedObjectName = null;
    selectedObjectData = null;

    document.getElementById('selectedInfo').innerHTML = '<p class="empty-state">No object selected</p>';
    document.getElementById('objectActions').style.display = 'none';
    document.getElementById('objectTabContainer').style.display = 'none';
    document.getElementById('chainList').innerHTML = '<p class="empty-state">No animations</p>';

    transformControls.detach();
    // refreshLightList();
    hideChainEditor();
    hideKeyframeEditor();
};

window.updateCameraFov = function() {
    // Don't update static properties while editing a keyframe
    if (selectedKeyframe) return;

    // Verify we have the camera selected
    if (!selectedObjectName || selectedObjectName !== 'Camera' || !selectedObjectData || selectedObjectData.type !== 'camera') return;

    const fov = parseFloat(document.getElementById('cameraFovSlider').value);
    document.getElementById('cameraFovValue').textContent = fov.toFixed(0);
    camera.fov = fov;
    camera.updateProjectionMatrix();

    // Save to Camera properties
    updateObjectProperties('Camera', { fov });
};

window.updateCameraTransform = function() {
    // Don't update static properties while editing a keyframe
    if (selectedKeyframe) return;

    // Verify we have the camera selected
    if (!selectedObjectName || selectedObjectName !== 'Camera' || !selectedObjectData || selectedObjectData.type !== 'camera') return;

    const posX = parseFloat(document.getElementById('posX').value) || 0;
    const posY = parseFloat(document.getElementById('posY').value) || 0;
    const posZ = parseFloat(document.getElementById('posZ').value) || 0;

    const rotX = (parseFloat(document.getElementById('rotX').value) || 0) * Math.PI / 180;
    const rotY = (parseFloat(document.getElementById('rotY').value) || 0) * Math.PI / 180;
    const rotZ = (parseFloat(document.getElementById('rotZ').value) || 0) * Math.PI / 180;

    // Update camera transform
    camera.position.set(posX, posY, posZ);
    camera.rotation.set(rotX, rotY, rotZ);

    // Save to Camera properties
    updateObjectProperties('Camera', {
        position: { x: posX, y: posY, z: posZ },
        rotation: { x: rotX, y: rotY, z: rotZ }
    });
};

window.updateLightIntensity = function() {
    // Don't update static properties while editing a keyframe
    if (selectedKeyframe) return;

    // Verify we have a light selected
    if (!selectedObjectName || !selectedObjectData || selectedObjectData.type !== 'light') return;

    const intensity = parseFloat(document.getElementById('lightIntensityInput').value);

    const light = getSceneLight(selectedObjectName);
    if (light) {
        light.intensity = intensity;
        updateLightProperties(selectedObjectName, { intensity });
        updateObjectProperties(selectedObjectName, { intensity });
    }
};

window.updateLightColor = function() {
    // Don't update static properties while editing a keyframe
    if (selectedKeyframe) return;

    // Verify we have a light selected
    if (!selectedObjectName || !selectedObjectData || selectedObjectData.type !== 'light') return;

    const colorHex = document.getElementById('lightColorInput').value.replace('#', '');
    const color = parseInt(colorHex, 16);

    const light = getSceneLight(selectedObjectName);
    if (light) {
        light.color.setHex(color);
        updateLightProperties(selectedObjectName, { color });
        updateObjectProperties(selectedObjectName, { color });
    }
};

window.updateSpotAngle = function() {
    // Don't update static properties while editing a keyframe
    if (selectedKeyframe) return;

    // Verify we have a spotlight selected
    if (!selectedObjectName || !selectedObjectData || selectedObjectData.type !== 'light' || selectedObjectData.lightType !== 'spot') return;

    const angleDeg = parseFloat(document.getElementById('spotAngleSlider').value);
    document.getElementById('spotAngleValue').textContent = angleDeg.toFixed(0);

    const light = getSceneLight(selectedObjectName);
    if (light && light.isSpotLight) {
        const angleRad = THREE.MathUtils.degToRad(angleDeg);
        light.angle = angleRad;
        updateLightProperties(selectedObjectName, { angle: angleRad });

        // Save to animation data
        const objects = getAllAnimatableObjects();
        const lightData = objects[selectedObjectName];
        if (lightData && lightData.properties) {
            lightData.properties.angle = angleRad;
            updateObjectProperties(selectedObjectName, { angle: angleRad });
        }

        if (light.userData.helper) light.userData.helper.update();
    }
};

window.updateSpotPenumbra = function() {
    // Don't update static properties while editing a keyframe
    if (selectedKeyframe) return;

    // Verify we have a spotlight selected
    if (!selectedObjectName || !selectedObjectData || selectedObjectData.type !== 'light' || selectedObjectData.lightType !== 'spot') return;

    const penumbra = parseFloat(document.getElementById('spotPenumbraSlider').value);
    document.getElementById('spotPenumbraValue').textContent = penumbra.toFixed(2);

    const light = getSceneLight(selectedObjectName);
    if (light && light.isSpotLight) {
        light.penumbra = penumbra;
        updateLightProperties(selectedObjectName, { penumbra });

        // Save to animation data
        const objects = getAllAnimatableObjects();
        const lightData = objects[selectedObjectName];
        if (lightData && lightData.properties) {
            lightData.properties.penumbra = penumbra;
            updateObjectProperties(selectedObjectName, { penumbra });
        }

        if (light.userData.helper) light.userData.helper.update();
    }
};

window.updateLightTransform = function() {
    // Verify we have a light selected
    if (!selectedObjectName || !selectedObjectData || selectedObjectData.type !== 'light') return;

    // Don't update static properties while editing a keyframe
    if (selectedKeyframe) return;

    const posX = parseFloat(document.getElementById('posX_light').value) || 0;
    const posY = parseFloat(document.getElementById('posY_light').value) || 0;
    const posZ = parseFloat(document.getElementById('posZ_light').value) || 0;

    const rotX = (parseFloat(document.getElementById('rotX_light').value) || 0) * Math.PI / 180;
    const rotY = (parseFloat(document.getElementById('rotY_light').value) || 0) * Math.PI / 180;
    const rotZ = (parseFloat(document.getElementById('rotZ_light').value) || 0) * Math.PI / 180;

    const light = getSceneLight(selectedObjectName);
    if (light) {
        // Update light transform
        light.position.set(posX, posY, posZ);
        light.rotation.set(rotX, rotY, rotZ);

        // Update spotlight target if needed
        if (light.isSpotLight) {
            updateSpotlightTarget(light);
        }

        // Save to light properties
        updateObjectProperties(selectedObjectName, {
            position: { x: posX, y: posY, z: posZ },
            rotation: { x: rotX, y: rotY, z: rotZ }
        });
    }
};

window.createNewChain = function() {
    if (!selectedObjectName) {
        alert('Please select an object first');
        return;
    }

    const chainName = prompt('Enter animation name:', 'New Animation');
    if (!chainName) return;

    const chainId = createChain(selectedObjectName, chainName);
    if (chainId) {
        loadObjectChains(selectedObjectName);

        // Auto-select the newly created chain
        const chains = getChainsForObject(selectedObjectName);
        const newChain = chains.find(c => c.id === chainId);
        if (newChain) {
            setTimeout(() => selectChain(newChain), 100);
        }
    }
};

window.addTrigger = function() {
    if (!selectedChain) return;

    const triggerType = document.getElementById('newTriggerSelect').value;
    if (!triggerType) return;

    const trigger = { type: triggerType };

    // Ensure triggers array exists
    if (!selectedChain.triggers) selectedChain.triggers = [];

    selectedChain.triggers.push(trigger);
    displayTriggers(selectedChain.triggers);

    // Reset selection
    document.getElementById('newTriggerSelect').value = '';
};

window.removeTrigger = function(index) {
    if (!selectedChain || !selectedChain.triggers) return;

    selectedChain.triggers.splice(index, 1);
    displayTriggers(selectedChain.triggers);
};

window.addStopCondition = function() {
    if (!selectedChain) return;

    const conditionType = document.getElementById('newStopConditionSelect').value;
    if (!conditionType) return;

    const condition = { type: conditionType };

    // Handle time delay
    if (conditionType === 'time_delay') {
        const delayInput = document.getElementById('newStopConditionDelaySlider');
        condition.delay = delayInput ? parseInt(delayInput.value) : 0;
    }

    // Ensure stopConditions array exists
    if (!selectedChain.stopConditions) selectedChain.stopConditions = [];

    selectedChain.stopConditions.push(condition);
    displayStopConditions(selectedChain.stopConditions);

    // Reset selection
    document.getElementById('newStopConditionSelect').value = '';
    document.getElementById('newStopConditionOptions').innerHTML = '';
};

window.removeStopCondition = function(index) {
    if (!selectedChain || !selectedChain.stopConditions) return;

    selectedChain.stopConditions.splice(index, 1);
    displayStopConditions(selectedChain.stopConditions);
};

// Handle trigger selection change (no options needed for triggers)
window.handleNewTriggerChange = function() {
    // Triggers don't have additional options anymore
};

// Handle stop condition selection change to show delay options
window.handleNewStopConditionChange = function() {
    const conditionType = document.getElementById('newStopConditionSelect').value;
    const optionsEl = document.getElementById('newStopConditionOptions');

    if (conditionType === 'time_delay') {
        optionsEl.innerHTML = `
            <div class="slider-group">
                <label>Duration (ms): <span id="newStopConditionDelayValue">0</span></label>
                <input type="range" id="newStopConditionDelaySlider" min="0" max="60000" step="100" value="0" oninput="updateNewStopConditionDelay()">
            </div>
        `;
    } else {
        optionsEl.innerHTML = '';
    }
};

window.updateNewStopConditionDelay = function() {
    const value = parseInt(document.getElementById('newStopConditionDelaySlider').value);
    document.getElementById('newStopConditionDelayValue').textContent = value;
};

window.saveChain = function() {
    if (!selectedObjectName || !selectedChain) return;

    // Get chain name
    const chainName = document.getElementById('chainNameInput').value.trim();
    if (!chainName) {
        alert('Animation name cannot be empty');
        return;
    }

    // Get loop setting
    const loop = document.getElementById('loopCheckbox').checked;

    // Ensure triggers and stopConditions arrays exist
    if (!selectedChain.triggers) selectedChain.triggers = [];
    if (!selectedChain.stopConditions) selectedChain.stopConditions = [];

    // Update chain
    updateChain(selectedObjectName, selectedChain.id, {
        name: chainName,
        triggers: selectedChain.triggers,
        loop,
        stopConditions: selectedChain.stopConditions
    });

    // Refresh UI
    loadObjectChains(selectedObjectName);
    // alert('Animation saved successfully');
};

window.deleteChain = function() {
    if (!selectedObjectName || !selectedChain) return;

    if (!confirm(`Delete animation "${selectedChain.name}"?`)) return;

    deleteChain(selectedObjectName, selectedChain.id);
    hideChainEditor();
    hideKeyframeEditor();
    loadObjectChains(selectedObjectName);
};

// Edit chain from card
window.editChainFromCard = function(objectName, chainId) {
    // Ensure the correct object is selected first
    if (selectedObjectName !== objectName) {
        selectObject(objectName);
    }

    // Now get the chain data (after object is selected)
    const chains = getChainsForObject(objectName);
    const chain = chains.find(c => c.id === chainId);
    if (chain) {
        selectChain(chain);
    }
};

// Delete chain from card (without needing to select it first)
window.deleteChainFromCard = function(objectName, chainId) {
    const chains = getChainsForObject(objectName);
    const chain = chains.find(c => c.id === chainId);
    if (!chain) return;

    if (!confirm(`Delete animation "${chain.name}"?`)) return;

    deleteChain(objectName, chainId);

    // If the deleted chain was selected, clear selection
    if (selectedChain && selectedChain.id === chainId) {
        hideChainEditor();
        hideKeyframeEditor();
        selectedChain = null;
    }

    loadObjectChains(objectName);
};

window.addKeyframe = function() {
    if (!selectedObjectName) {
        alert('Please select an object first');
        return;
    }

    if (!selectedChain) {
        alert('Please select or create an animation first');
        return;
    }

    // Use current object state as default
    let obj;
    if (selectedObjectData.type === 'camera') {
        obj = camera;
    } else if (selectedObjectData.type === 'light') {
        obj = getSceneLight(selectedObjectName);
    }

    if (!obj) return;

    const properties = {
        position: {
            x: obj.position.x,
            y: obj.position.y,
            z: obj.position.z
        },
        rotation: {
            x: obj.rotation.x,
            y: obj.rotation.y,
            z: obj.rotation.z
        }
    };

    // Add type-specific properties
    if (selectedObjectData.type === 'camera') {
        properties.fov = obj.fov;
    } else if (selectedObjectData.type === 'light') {
        properties.intensity = obj.intensity;
        properties.color = obj.color.getHex();
        if (obj.isSpotLight) {
            properties.angle = obj.angle;
            properties.penumbra = obj.penumbra;
        }
    }

    const keyframeId = addKeyframe(selectedObjectName, selectedChain.id, properties);
    if (keyframeId) {
        // Reload the chain to get updated data
        const chains = getChainsForObject(selectedObjectName);
        const updatedChain = chains.find(c => c.id === selectedChain.id);
        if (updatedChain) {
            selectedChain = updatedChain;
        }

        loadKeyframesForChain(selectedChain);

        // Auto-select the newly added keyframe
        const newKeyframeIndex = selectedChain.keyframes.length - 1;
        const newKeyframe = selectedChain.keyframes[newKeyframeIndex];
        if (newKeyframe) {
            setTimeout(() => selectKeyframeItem(newKeyframe, newKeyframeIndex), 100);
        }
    }
};

window.updateKeyframeDuration = function() {
    const value = parseInt(document.getElementById('durationSlider').value);
    document.getElementById('durationValue').textContent = value;

    // Auto-save
    if (selectedObjectName && selectedChain && selectedKeyframe) {
        const keyframeId = selectedKeyframe.id;
        updateKeyframe(selectedObjectName, selectedChain.id, keyframeId, {
            duration: value
        });

        // Reload chain from storage to get fresh data
        reloadChainAndKeyframe(keyframeId);
    }
};

window.updateKeyframeDelay = function() {
    const value = parseInt(document.getElementById('delaySlider').value);
    document.getElementById('delayValue').textContent = value;

    // Auto-save
    if (selectedObjectName && selectedChain && selectedKeyframe) {
        const keyframeId = selectedKeyframe.id;
        updateKeyframe(selectedObjectName, selectedChain.id, keyframeId, {
            delay: value
        });

        // Reload chain from storage to get fresh data
        reloadChainAndKeyframe(keyframeId);
    }
};

window.updateKeyframeEasing = function() {
    const value = document.getElementById('easingSelect').value;

    // Auto-save
    if (selectedObjectName && selectedChain && selectedKeyframe) {
        const keyframeId = selectedKeyframe.id;
        updateKeyframe(selectedObjectName, selectedChain.id, keyframeId, {
            easing: value
        });

        // Reload chain from storage to get fresh data
        reloadChainAndKeyframe(keyframeId);
    }
};

window.updateKeyframeProperties = function() {
    if (!selectedObjectName || !selectedChain || !selectedKeyframe) return;

    // Read values from inputs
    const posX = parseFloat(document.getElementById('kfPosX').value) || 0;
    const posY = parseFloat(document.getElementById('kfPosY').value) || 0;
    const posZ = parseFloat(document.getElementById('kfPosZ').value) || 0;

    // Convert degrees to radians
    const rotX = (parseFloat(document.getElementById('kfRotX').value) || 0) * Math.PI / 180;
    const rotY = (parseFloat(document.getElementById('kfRotY').value) || 0) * Math.PI / 180;
    const rotZ = (parseFloat(document.getElementById('kfRotZ').value) || 0) * Math.PI / 180;

    // Update keyframe properties
    const properties = {
        position: { x: posX, y: posY, z: posZ },
        rotation: { x: rotX, y: rotY, z: rotZ }
    };

    // Add type-specific properties
    if (selectedObjectData.type === 'camera') {
        const fov = parseFloat(document.getElementById('kfFovSlider').value);
        document.getElementById('kfFovValue').textContent = fov.toFixed(0);
        properties.fov = fov;
    } else if (selectedObjectData.type === 'light') {
        const intensity = parseFloat(document.getElementById('kfIntensityInput').value);
        const colorHex = document.getElementById('kfLightColor').value.replace('#', '');
        const color = parseInt(colorHex, 16);

        properties.intensity = intensity;
        properties.color = color;

        if (selectedObjectData.lightType === 'spot') {
            const angleDeg = parseFloat(document.getElementById('kfSpotAngleSlider').value);
            const penumbra = parseFloat(document.getElementById('kfSpotPenumbraSlider').value);

            document.getElementById('kfSpotAngleValue').textContent = angleDeg.toFixed(0);
            document.getElementById('kfSpotPenumbraValue').textContent = penumbra.toFixed(2);

            properties.angle = THREE.MathUtils.degToRad(angleDeg);
            properties.penumbra = penumbra;
        }
    }

    // Update object in scene to match
    let obj;
    if (selectedObjectData.type === 'camera') {
        obj = camera;
    } else if (selectedObjectData.type === 'light') {
        obj = getSceneLight(selectedObjectName);
    }

    if (obj) {
        obj.position.set(posX, posY, posZ);
        obj.rotation.set(rotX, rotY, rotZ);

        if (selectedObjectData.type === 'camera') {
            obj.fov = properties.fov;
            obj.updateProjectionMatrix();
        } else if (selectedObjectData.type === 'light') {
            obj.intensity = properties.intensity;
            obj.color.setHex(properties.color);
            if (obj.isSpotLight) {
                obj.angle = properties.angle;
                obj.penumbra = properties.penumbra;
            }
            if (obj.userData.helper) obj.userData.helper.update();
        }
    }

    // Auto-save
    const keyframeId = selectedKeyframe.id;
    updateKeyframe(selectedObjectName, selectedChain.id, keyframeId, {
        properties: properties
    });

    // Update property displays
    updatePropertyDisplays();

    // Reload chain from storage to get fresh data
    reloadChainAndKeyframe(keyframeId);
};

window.syncFromObject = function() {
    if (!selectedObjectName || !selectedChain || !selectedKeyframe) return;

    let obj;
    if (selectedObjectData.type === 'camera') {
        obj = camera;
    } else if (selectedObjectData.type === 'light') {
        obj = getSceneLight(selectedObjectName);
    }

    if (!obj) return;

    // Copy current object transform to input fields
    document.getElementById('kfPosX').value = obj.position.x.toFixed(2);
    document.getElementById('kfPosY').value = obj.position.y.toFixed(2);
    document.getElementById('kfPosZ').value = obj.position.z.toFixed(2);

    document.getElementById('kfRotX').value = (obj.rotation.x * 180 / Math.PI).toFixed(1);
    document.getElementById('kfRotY').value = (obj.rotation.y * 180 / Math.PI).toFixed(1);
    document.getElementById('kfRotZ').value = (obj.rotation.z * 180 / Math.PI).toFixed(1);

    // Copy type-specific properties
    if (selectedObjectData.type === 'camera') {
        document.getElementById('kfFovSlider').value = obj.fov;
        document.getElementById('kfFovValue').textContent = obj.fov.toFixed(0);
    } else if (selectedObjectData.type === 'light') {
        document.getElementById('kfIntensityInput').value = obj.intensity.toFixed(1);
        document.getElementById('kfLightColor').value = '#' + obj.color.getHex().toString(16).padStart(6, '0');

        if (obj.isSpotLight) {
            const angleDeg = THREE.MathUtils.radToDeg(obj.angle);
            document.getElementById('kfSpotAngleSlider').value = angleDeg;
            document.getElementById('kfSpotAngleValue').textContent = angleDeg.toFixed(0);
            document.getElementById('kfSpotPenumbraSlider').value = obj.penumbra;
            document.getElementById('kfSpotPenumbraValue').textContent = obj.penumbra.toFixed(2);
        }
    }

    // Trigger auto-save
    window.updateKeyframeProperties();
};

window.resetToStaticPosition = function() {
    if (!selectedObjectName || !selectedChain || !selectedKeyframe) return;

    // Get static properties from saved animation data
    const objects = getAllAnimatableObjects();
    const objectData = objects[selectedObjectName];

    if (!objectData || !objectData.properties) return;

    const staticProps = objectData.properties;

    // Load static properties into keyframe input fields
    document.getElementById('kfPosX').value = staticProps.position.x.toFixed(2);
    document.getElementById('kfPosY').value = staticProps.position.y.toFixed(2);
    document.getElementById('kfPosZ').value = staticProps.position.z.toFixed(2);

    document.getElementById('kfRotX').value = (staticProps.rotation.x * 180 / Math.PI).toFixed(1);
    document.getElementById('kfRotY').value = (staticProps.rotation.y * 180 / Math.PI).toFixed(1);
    document.getElementById('kfRotZ').value = (staticProps.rotation.z * 180 / Math.PI).toFixed(1);

    // Load type-specific static properties
    if (selectedObjectData.type === 'camera' && staticProps.fov !== undefined) {
        document.getElementById('kfFovSlider').value = staticProps.fov;
        document.getElementById('kfFovValue').textContent = staticProps.fov.toFixed(0);
    } else if (selectedObjectData.type === 'light') {
        if (staticProps.intensity !== undefined) {
            document.getElementById('kfIntensityInput').value = staticProps.intensity.toFixed(1);
        }
        if (staticProps.color !== undefined) {
            document.getElementById('kfLightColor').value = '#' + staticProps.color.toString(16).padStart(6, '0');
        }

        if (objectData.lightType === 'spot') {
            if (staticProps.angle !== undefined) {
                const angleDeg = THREE.MathUtils.radToDeg(staticProps.angle);
                document.getElementById('kfSpotAngleSlider').value = angleDeg;
                document.getElementById('kfSpotAngleValue').textContent = angleDeg.toFixed(0);
            }
            if (staticProps.penumbra !== undefined) {
                document.getElementById('kfSpotPenumbraSlider').value = staticProps.penumbra;
                document.getElementById('kfSpotPenumbraValue').textContent = staticProps.penumbra.toFixed(2);
            }
        }
    }

    // Update the object visually to match static position
    let obj;
    if (selectedObjectData.type === 'camera') {
        obj = camera;
    } else if (selectedObjectData.type === 'light') {
        obj = getSceneLight(selectedObjectName);
    }

    if (obj) {
        obj.position.set(staticProps.position.x, staticProps.position.y, staticProps.position.z);
        obj.rotation.set(staticProps.rotation.x, staticProps.rotation.y, staticProps.rotation.z);

        if (selectedObjectData.type === 'camera' && staticProps.fov !== undefined) {
            obj.fov = staticProps.fov;
            obj.updateProjectionMatrix();
        } else if (selectedObjectData.type === 'light') {
            if (staticProps.intensity !== undefined) {
                obj.intensity = staticProps.intensity;
            }
            if (staticProps.color !== undefined) {
                obj.color.setHex(staticProps.color);
            }
            if (obj.isSpotLight) {
                if (staticProps.angle !== undefined) {
                    obj.angle = staticProps.angle;
                }
                if (staticProps.penumbra !== undefined) {
                    obj.penumbra = staticProps.penumbra;
                }
                updateSpotlightTarget(obj);
            }
            if (obj.userData.helper) obj.userData.helper.update();
        }
    }

    // Trigger auto-save
    window.updateKeyframeProperties();
};

window.previewKeyframe = function() {
    if (!selectedObjectName || !selectedChain || !selectedKeyframe) return;

    // Play only this chain
    animationPlayer.playChain(selectedObjectName, selectedChain.id);
};

window.deleteKeyframe = function() {
    if (!selectedObjectName || !selectedChain || !selectedKeyframe) return;

    if (!confirm('Delete this keyframe?')) return;

    deleteKeyframe(selectedObjectName, selectedChain.id, selectedKeyframe.id);
    hideKeyframeEditor();
    loadKeyframesForChain(selectedChain);
};

window.playChain = function(objectName, chainId) {
    animationPlayer.playChain(objectName, chainId);
};

// Helper function to switch tabs (can be called programmatically)
function switchToTab(tabName) {
    console.log('[Tabs] Switching to:', tabName);

    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach((btn, index) => {
        btn.classList.remove('active');
        if ((tabName === 'properties' && index === 0) || (tabName === 'animations' && index === 1)) {
            btn.classList.add('active');
        }
    });

    // Update tab content
    const propertiesTab = document.getElementById('propertiesTab');
    const animationsTab = document.getElementById('animationsTab');

    if (tabName === 'properties') {
        propertiesTab.classList.add('active');
        animationsTab.classList.remove('active');

        // Restore object to original position when switching to properties tab
        if (selectedKeyframe) {
            hideKeyframeEditor();
        } else {
            restoreOriginalObjectState();
        }
    } else if (tabName === 'animations') {
        propertiesTab.classList.remove('active');
        animationsTab.classList.add('active');
    }

    console.log('[Tabs] Properties active:', propertiesTab.classList.contains('active'));
    console.log('[Tabs] Animations active:', animationsTab.classList.contains('active'));
}

window.switchObjectTab = function(tabName) {
    switchToTab(tabName);
};

// Adopt viewport camera position/rotation to static properties
window.adoptViewportCamera = function() {
    if (!selectedObjectName || selectedObjectData?.type !== 'camera') {
        console.warn('Can only adopt viewport camera when Camera is selected');
        return;
    }

    if (!viewportCamera) {
        console.error('Viewport camera not available');
        return;
    }

    // Copy viewport camera position and rotation to animatable camera
    camera.position.copy(viewportCamera.position);
    camera.rotation.copy(viewportCamera.rotation);

    // Update input fields
    document.getElementById('posX').value = camera.position.x.toFixed(2);
    document.getElementById('posY').value = camera.position.y.toFixed(2);
    document.getElementById('posZ').value = camera.position.z.toFixed(2);

    document.getElementById('rotX').value = (camera.rotation.x * 180 / Math.PI).toFixed(1);
    document.getElementById('rotY').value = (camera.rotation.y * 180 / Math.PI).toFixed(1);
    document.getElementById('rotZ').value = (camera.rotation.z * 180 / Math.PI).toFixed(1);

    // Trigger save
    window.updateCameraTransform();

    console.log('Adopted viewport camera position and rotation');
};

// Adopt viewport camera position/rotation to keyframe properties
window.adoptViewportCameraToKeyframe = function() {
    if (!selectedObjectName || !selectedChain || !selectedKeyframe) {
        console.warn('No keyframe selected');
        return;
    }

    if (selectedObjectData?.type !== 'camera') {
        console.warn('Can only adopt viewport camera for camera keyframes');
        return;
    }

    if (!viewportCamera) {
        console.error('Viewport camera not available');
        return;
    }

    // Copy viewport camera position and rotation to animatable camera
    camera.position.copy(viewportCamera.position);
    camera.rotation.copy(viewportCamera.rotation);

    // Update keyframe input fields
    document.getElementById('kfPosX').value = camera.position.x.toFixed(2);
    document.getElementById('kfPosY').value = camera.position.y.toFixed(2);
    document.getElementById('kfPosZ').value = camera.position.z.toFixed(2);

    document.getElementById('kfRotX').value = (camera.rotation.x * 180 / Math.PI).toFixed(1);
    document.getElementById('kfRotY').value = (camera.rotation.y * 180 / Math.PI).toFixed(1);
    document.getElementById('kfRotZ').value = (camera.rotation.z * 180 / Math.PI).toFixed(1);

    // Trigger auto-save
    window.updateKeyframeProperties();

    console.log('Adopted viewport camera position and rotation to keyframe');
};

// Set viewport camera to match animatable camera (static properties)
window.viewFromCamera = function() {
    if (!selectedObjectName || selectedObjectData?.type !== 'camera') {
        console.warn('Can only view from camera when Camera is selected');
        return;
    }

    if (!viewportCamera) {
        console.error('Viewport camera not available');
        return;
    }

    // Get world position and quaternion from animatable camera
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    camera.getWorldPosition(worldPos);
    camera.getWorldQuaternion(worldQuat);

    // Apply to viewport camera
    viewportCamera.position.copy(worldPos);
    viewportCamera.quaternion.copy(worldQuat);
    viewportCamera.updateProjectionMatrix();

    // Update orbit controls target to point where camera is looking
    if (controls) {
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(worldQuat);
        const target = worldPos.clone().add(direction.multiplyScalar(5));
        controls.target.copy(target);
        controls.update();
    }

    console.log('Viewport camera set to match animatable camera at world position:', worldPos);
};

// Set viewport camera to match keyframe camera position
window.viewFromCameraKeyframe = function() {
    if (!selectedObjectName || !selectedChain || !selectedKeyframe) {
        console.warn('No keyframe selected');
        return;
    }

    if (selectedObjectData?.type !== 'camera') {
        console.warn('Can only view from camera for camera keyframes');
        return;
    }

    if (!viewportCamera) {
        console.error('Viewport camera not available');
        return;
    }

    // Get world position and quaternion from animatable camera (which is at keyframe position)
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    camera.getWorldPosition(worldPos);
    camera.getWorldQuaternion(worldQuat);

    // Apply to viewport camera
    viewportCamera.position.copy(worldPos);
    viewportCamera.quaternion.copy(worldQuat);
    viewportCamera.updateProjectionMatrix();

    // Update orbit controls target to point where camera is looking
    if (controls) {
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(worldQuat);
        const target = worldPos.clone().add(direction.multiplyScalar(5));
        controls.target.copy(target);
        controls.update();
    }

    console.log('Viewport camera set to match keyframe camera position:', worldPos);
};
