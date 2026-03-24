import * as THREE from 'three';
import { easingFunctions } from './easingFunctions.js';
import { getSceneLight, updateSpotlightTarget } from './lightManager.js';

// Multi-Object Animation Player Class
export class AnimationPlayer {
    constructor() {
        this.activeAnimations = new Map(); // Map of objectName -> animation instance
        this.animationData = null;
        this.camera = null;
    }

    // Set camera reference
    setCamera(camera) {
        this.camera = camera;
    }

    // Load animation data from JSON
    loadAnimations(data) {
        this.animationData = data;
    }

    // Start animation chain for an object
    playChain(objectName, chainId) {
        if (!this.animationData || !this.animationData.animatableObjects) {
            console.warn('No animation data loaded');
            return;
        }

        const objectData = this.animationData.animatableObjects[objectName];
        if (!objectData) {
            console.warn(`Object "${objectName}" not found in animation data`);
            return;
        }

        const chain = objectData.chains.find(c => c.id === chainId);
        if (!chain) {
            console.warn(`Animation chain "${chainId}" not found for "${objectName}"`);
            return;
        }

        // Get the actual Three.js object
        let threeObject;
        if (objectData.type === 'camera') {
            threeObject = this.camera;
        } else if (objectData.type === 'light') {
            threeObject = getSceneLight(objectName);
        }

        if (!threeObject) {
            console.warn(`Three.js object for "${objectName}" not found`);
            return;
        }

        // Stop any existing animation on this object
        this.stopAnimation(objectName);

        // Create animation instance
        const instance = {
            objectName,
            objectType: objectData.type,
            object: threeObject,
            chain,
            currentKeyframeIndex: 0,
            keyframeStartTime: null,
            chainStartTime: performance.now(),
            isWaitingForDelay: true,
            startState: this.captureObjectState(threeObject, objectData.type),
            stopConditionStartTime: null  // Track time for stop condition time_delay
        };

        this.activeAnimations.set(objectName, instance);
        console.log(`Playing animation "${chain.name}" on "${objectName}"`);
    }

    captureObjectState(object, objectType) {
        const state = {
            position: object.position.clone(),
            rotation: object.rotation.clone()
        };

        if (objectType === 'camera') {
            state.fov = object.fov;
        } else if (objectType === 'light') {
            state.color = object.color.getHex();
            state.intensity = object.intensity;

            if (object.isSpotLight) {
                state.angle = object.angle;
                state.penumbra = object.penumbra;
            }
        }

        return state;
    }

    // Update all active animations (called in main loop)
    update() {
        if (this.activeAnimations.size === 0) return;

        this.activeAnimations.forEach((instance, objectName) => {
            this.updateAnimation(instance, objectName);
        });
    }

    updateAnimation(instance, objectName) {
        const now = performance.now();

        // Check stop condition
        if (this.shouldStopAnimation(instance, now)) {
            this.stopAnimation(objectName);
            console.log(`Animation "${instance.chain.name}" on "${objectName}" stopped by stop condition`);
            return;
        }

        const keyframe = instance.chain.keyframes[instance.currentKeyframeIndex];

        if (!keyframe) {
            // Chain complete
            if (instance.chain.loop) {
                // Loop back to start
                console.log(`Animation "${instance.chain.name}" on "${objectName}" looping`);
                instance.currentKeyframeIndex = 0;
                instance.isWaitingForDelay = true;
                instance.keyframeStartTime = null;
                // Reset start state to current object state for smooth looping
                instance.startState = this.captureObjectState(instance.object, instance.objectType);
                return;
            } else {
                // Stop animation
                this.stopAnimation(objectName);
                console.log(`Animation "${instance.chain.name}" on "${objectName}" completed`);
                return;
            }
        }

        // Handle delay before keyframe starts
        if (instance.isWaitingForDelay) {
            if (!instance.keyframeStartTime) {
                instance.keyframeStartTime = now;
            }

            const delayElapsed = now - instance.keyframeStartTime;
            if (delayElapsed < keyframe.delay) {
                return;  // Still waiting
            }

            instance.isWaitingForDelay = false;
            instance.keyframeStartTime = now;  // Reset for duration timing
        }

        // Animate keyframe
        const elapsed = now - instance.keyframeStartTime;
        const progress = Math.min(elapsed / keyframe.duration, 1);

        // Apply easing
        const easingFn = easingFunctions[keyframe.easing] || easingFunctions.linear;
        const eased = easingFn(progress);

        // Get start state (previous keyframe target or initial state)
        let startState;
        if (instance.currentKeyframeIndex === 0) {
            startState = instance.startState;
        } else {
            const prevKeyframe = instance.chain.keyframes[instance.currentKeyframeIndex - 1];
            startState = this.extractStateFromKeyframe(prevKeyframe, instance.objectType);
        }

        // Interpolate common properties
        this.interpolatePosition(instance.object, keyframe, startState, eased);
        this.interpolateRotation(instance.object, keyframe, startState, eased);

        // Interpolate type-specific properties
        if (instance.objectType === 'camera') {
            this.interpolateCameraProperties(instance.object, keyframe, startState, eased);
        } else if (instance.objectType === 'light') {
            this.interpolateLightProperties(instance.object, keyframe, startState, eased);

            // Update spotlight target after position/rotation changes
            if (instance.object.isSpotLight) {
                updateSpotlightTarget(instance.object);
            }
        }

        // Update object matrix
        instance.object.updateMatrixWorld();

        // Check if keyframe complete
        if (progress >= 1) {
            instance.currentKeyframeIndex++;
            instance.isWaitingForDelay = true;
            instance.keyframeStartTime = null;
        }
    }

    shouldStopAnimation(instance, now) {
        // Migrate old format if needed
        if (instance.chain.stopCondition && !Array.isArray(instance.chain.stopConditions)) {
            instance.chain.stopConditions = [this.convertOldStopConditionFormat(instance.chain.stopCondition)];
        }
        if (!instance.chain.stopConditions) return false;

        // Check each stop condition
        for (const stopCondition of instance.chain.stopConditions) {
            if (!stopCondition || stopCondition.type === 'none') {
                continue;
            }

            // Time delay stop condition
            if (stopCondition.type === 'time_delay') {
                if (!instance.stopConditionStartTime) {
                    instance.stopConditionStartTime = now;
                }
                const elapsed = now - instance.stopConditionStartTime;
                if (elapsed >= stopCondition.delay) {
                    return true;
                }
            }

            // Character-based stop conditions are checked by the trigger system
            // They will call stopAnimation directly when the condition is met
        }

        return false;
    }

    convertOldStopConditionFormat(oldCondition) {
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

    extractStateFromKeyframe(keyframe, objectType) {
        const state = {
            position: new THREE.Vector3(
                keyframe.properties.position?.x || 0,
                keyframe.properties.position?.y || 0,
                keyframe.properties.position?.z || 0
            ),
            rotation: new THREE.Euler(
                keyframe.properties.rotation?.x || 0,
                keyframe.properties.rotation?.y || 0,
                keyframe.properties.rotation?.z || 0
            )
        };

        if (objectType === 'camera') {
            state.fov = keyframe.properties.fov || 50;
        } else if (objectType === 'light') {
            state.color = keyframe.properties.color || 0xffffff;
            state.intensity = keyframe.properties.intensity || 1;
            state.angle = keyframe.properties.angle;
            state.penumbra = keyframe.properties.penumbra;
        }

        return state;
    }

    interpolatePosition(object, keyframe, startState, eased) {
        if (!keyframe.properties.position) return;

        const enabledProps = keyframe.properties.enabledProps || {};
        const targetPos = new THREE.Vector3(
            keyframe.properties.position.x,
            keyframe.properties.position.y,
            keyframe.properties.position.z
        );

        // Interpolate only enabled axes
        if (enabledProps['position.x'] !== false) {
            object.position.x = startState.position.x + (targetPos.x - startState.position.x) * eased;
        }
        if (enabledProps['position.y'] !== false) {
            object.position.y = startState.position.y + (targetPos.y - startState.position.y) * eased;
        }
        if (enabledProps['position.z'] !== false) {
            object.position.z = startState.position.z + (targetPos.z - startState.position.z) * eased;
        }
    }

    interpolateRotation(object, keyframe, startState, eased) {
        if (keyframe.properties.rotation) {
            const startQuat = new THREE.Quaternion().setFromEuler(startState.rotation);
            const endEuler = new THREE.Euler(
                keyframe.properties.rotation.x,
                keyframe.properties.rotation.y,
                keyframe.properties.rotation.z
            );
            const endQuat = new THREE.Quaternion().setFromEuler(endEuler);

            const resultQuat = new THREE.Quaternion().slerpQuaternions(startQuat, endQuat, eased);
            object.rotation.setFromQuaternion(resultQuat);
        }
    }

    interpolateCameraProperties(camera, keyframe, startState, eased) {
        // Interpolate FOV
        if (keyframe.properties.fov !== undefined) {
            const startFov = startState.fov;
            const targetFov = keyframe.properties.fov;
            camera.fov = startFov + (targetFov - startFov) * eased;
            camera.updateProjectionMatrix();
        }
    }

    interpolateLightProperties(light, keyframe, startState, eased) {
        // Interpolate intensity
        if (keyframe.properties.intensity !== undefined) {
            const startIntensity = startState.intensity;
            const targetIntensity = keyframe.properties.intensity;
            light.intensity = startIntensity + (targetIntensity - startIntensity) * eased;
        }

        // Interpolate color
        if (keyframe.properties.color !== undefined) {
            const startColor = new THREE.Color(startState.color);
            const targetColor = new THREE.Color(keyframe.properties.color);
            light.color.copy(startColor).lerp(targetColor, eased);
        }

        // Interpolate spotlight-specific properties
        if (light.isSpotLight) {
            if (keyframe.properties.angle !== undefined && startState.angle !== undefined) {
                const startAngle = startState.angle;
                const targetAngle = keyframe.properties.angle;
                light.angle = startAngle + (targetAngle - startAngle) * eased;
            }

            if (keyframe.properties.penumbra !== undefined && startState.penumbra !== undefined) {
                const startPenumbra = startState.penumbra;
                const targetPenumbra = keyframe.properties.penumbra;
                light.penumbra = startPenumbra + (targetPenumbra - startPenumbra) * eased;
            }
        }

        // Update light helper
        if (light.userData.helper) {
            light.userData.helper.update();
        }
    }

    stopAnimation(objectName) {
        if (this.activeAnimations.has(objectName)) {
            this.activeAnimations.delete(objectName);
        }
    }

    stopAll() {
        this.activeAnimations.clear();
    }

    isAnimating(objectName) {
        return this.activeAnimations.has(objectName);
    }
}

// Trigger Manager Class
export class TriggerManager {
    constructor(animationPlayer) {
        this.player = animationPlayer;
        this.timers = new Map();
        // Track previous state to detect load/unload events
        this.previousState = {
            hunter: null,
            survivors: [null, null, null, null]
        };
    }

    // Register character load trigger
    setupCharacterLoadTrigger() {
        // Trigger all "on_load" animations immediately
        this.triggerOnLoadAnimations();

        // Hook into existing character loading system
        if (typeof window.loadCharactersJson === 'function') {
            const originalLoadCharacters = window.loadCharactersJson;

            window.loadCharactersJson = (jsonData) => {
                originalLoadCharacters(jsonData);

                // Wait for characters to be loaded, then trigger animations
                setTimeout(() => {
                    this.triggerCharacterAnimations(jsonData);
                }, 100);
            };

            console.log('Animation character load/unload trigger registered');
        } else {
            console.warn('window.loadCharactersJson not found, character load triggers will not work');
        }
    }

    // Trigger all animations with "on_load" trigger
    triggerOnLoadAnimations() {
        if (!this.player.animationData || !this.player.animationData.animatableObjects) {
            console.log('[On Load] No animation data available');
            return;
        }

        const objects = this.player.animationData.animatableObjects || {};
        let triggeredCount = 0;

        Object.entries(objects).forEach(([objectName, objectData]) => {
            objectData.chains.forEach(chain => {
                // Migrate old format if needed
                if (chain.trigger && !Array.isArray(chain.triggers)) {
                    chain.triggers = [this.convertOldTriggerFormat(chain.trigger)];
                }
                if (!chain.triggers) chain.triggers = [];

                // Check if chain has on_load trigger
                const hasOnLoadTrigger = chain.triggers.some(trigger => trigger.type === 'on_load');

                if (hasOnLoadTrigger) {
                    console.log(`[On Load] Triggering animation "${chain.name}" on "${objectName}"`);
                    this.player.playChain(objectName, chain.id);
                    triggeredCount++;
                }
            });
        });

        if (triggeredCount > 0) {
            console.log(`[On Load] Triggered ${triggeredCount} animation(s)`);
        }
    }

    triggerCharacterAnimations(characterData) {
        if (!this.player.animationData) return;

        // Build current state
        const currentState = {
            hunter: characterData.hunter?.hasModel ? characterData.hunter : null,
            survivors: [null, null, null, null]
        };

        // Populate survivors array (sparse array with nulls for empty slots)
        if (characterData.survivors && Array.isArray(characterData.survivors)) {
            characterData.survivors.forEach((survivor, index) => {
                if (index < 4 && survivor && survivor.hasModel) {
                    currentState.survivors[index] = survivor;
                }
            });
        }

        console.log('[Trigger] Current state:', currentState);
        console.log('[Trigger] Previous state:', this.previousState);

        const objects = this.player.animationData.animatableObjects || {};

        // Process all animation chains
        Object.entries(objects).forEach(([objectName, objectData]) => {
            objectData.chains.forEach(chain => {
                // Migrate old format to new if needed
                if (chain.trigger && !Array.isArray(chain.triggers)) {
                    chain.triggers = [this.convertOldTriggerFormat(chain.trigger)];
                }
                if (!chain.triggers) chain.triggers = [];

                // Check each trigger
                chain.triggers.forEach(trigger => {
                    if (this.checkTrigger(trigger, currentState)) {
                        console.log(`[Trigger] ✓ Triggering animation "${chain.name}" on "${objectName}"`);
                        this.player.playChain(objectName, chain.id);
                    }
                });
            });
        });

        // Check stop conditions for running animations
        this.activeAnimations.forEach((instance, objectName) => {
            // Migrate old format to new if needed
            if (instance.chain.stopCondition && !Array.isArray(instance.chain.stopConditions)) {
                instance.chain.stopConditions = [this.convertOldStopConditionFormat(instance.chain.stopCondition)];
            }
            if (!instance.chain.stopConditions) instance.chain.stopConditions = [];

            // Check each stop condition
            instance.chain.stopConditions.forEach(condition => {
                if (this.checkStopCondition(condition, currentState)) {
                    console.log(`[Stop Condition] Stopping animation "${instance.chain.name}" on "${objectName}"`);
                    this.player.stopAnimation(objectName);
                }
            });
        });

        // Update previous state for next comparison
        this.previousState = JSON.parse(JSON.stringify(currentState));
    }

    convertOldTriggerFormat(oldTrigger) {
        let type = oldTrigger.type;

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
        if (type === 'time_delay') {
            newTrigger.delay = oldTrigger.delay || 0;
        }
        return newTrigger;
    }

    convertOldStopConditionFormat(oldCondition) {
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

    checkTrigger(trigger, currentState) {
        const type = trigger.type;

        // Character load triggers
        if (type.startsWith('character_load')) {
            if (type === 'character_load') {
                // Any character load
                const hunterChanged = this.previousState.hunter === null && currentState.hunter !== null;
                const anyNewSurvivor = currentState.survivors.some((s, i) =>
                    this.previousState.survivors[i] === null && s !== null
                );
                return hunterChanged || anyNewSurvivor;
            } else if (type === 'character_load_hunter') {
                return this.previousState.hunter === null && currentState.hunter !== null;
            } else if (type === 'character_load_survivor') {
                // Any survivor load
                for (let i = 0; i < 4; i++) {
                    if (this.previousState.survivors[i] === null && currentState.survivors[i] !== null) {
                        return true;
                    }
                }
                return false;
            } else if (type.startsWith('character_load_survivor_')) {
                const position = parseInt(type.split('_')[3]) - 1;
                return this.previousState.survivors[position] === null && currentState.survivors[position] !== null;
            }
        }

        // Character unload triggers
        if (type.startsWith('character_unload')) {
            if (type === 'character_unload') {
                // Any character unload
                const hunterChanged = this.previousState.hunter !== null && currentState.hunter === null;
                const anyRemovedSurvivor = this.previousState.survivors.some((s, i) =>
                    s !== null && currentState.survivors[i] === null
                );
                return hunterChanged || anyRemovedSurvivor;
            } else if (type === 'character_unload_hunter') {
                return this.previousState.hunter !== null && currentState.hunter === null;
            } else if (type === 'character_unload_survivor') {
                // Any survivor unload
                for (let i = 0; i < 4; i++) {
                    if (this.previousState.survivors[i] !== null && currentState.survivors[i] === null) {
                        return true;
                    }
                }
                return false;
            } else if (type.startsWith('character_unload_survivor_')) {
                const position = parseInt(type.split('_')[3]) - 1;
                return this.previousState.survivors[position] !== null && currentState.survivors[position] === null;
            }
        }

        return false;
    }

    checkStopCondition(condition, currentState) {
        return this.checkTrigger(condition, currentState);
    }

    // Manual trigger (from button click)
    triggerManual(objectName, chainId) {
        this.player.playChain(objectName, chainId);
    }

    // Time-based trigger
    setupTimeDelayTrigger(objectName, chainId, delay) {
        const timerId = setTimeout(() => {
            this.player.playChain(objectName, chainId);
            this.timers.delete(`${objectName}-${chainId}`);
        }, delay);

        this.timers.set(`${objectName}-${chainId}`, timerId);
        console.log(`Time delay trigger set for "${objectName}" chain "${chainId}" (${delay}ms)`);
    }

    cancelAllTimers() {
        this.timers.forEach(timerId => clearTimeout(timerId));
        this.timers.clear();
        console.log('All time delay triggers cancelled');
    }
}

// Global instance
export const animationPlayer = new AnimationPlayer();
