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
            startState: this.captureObjectState(threeObject, objectData.type)
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
        const keyframe = instance.chain.keyframes[instance.currentKeyframeIndex];

        if (!keyframe) {
            // Chain complete
            this.stopAnimation(objectName);
            console.log(`Animation "${instance.chain.name}" on "${objectName}" completed`);
            return;
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
        if (keyframe.properties.position) {
            const targetPos = new THREE.Vector3(
                keyframe.properties.position.x,
                keyframe.properties.position.y,
                keyframe.properties.position.z
            );
            object.position.lerpVectors(startState.position, targetPos, eased);
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
                const triggerType = chain.trigger.type;

                if (triggerType === 'character_load') {
                    this.checkLoadTrigger(chain, objectName, currentState);
                } else if (triggerType === 'character_unload') {
                    this.checkUnloadTrigger(chain, objectName, currentState);
                }
            });
        });

        // Update previous state for next comparison
        this.previousState = JSON.parse(JSON.stringify(currentState));
    }

    checkLoadTrigger(chain, objectName, currentState) {
        let shouldTrigger = false;
        let triggerDesc = 'character load';

        if (chain.trigger.characterType === 'hunter') {
            // Check if hunter was just loaded (wasn't there before, is there now)
            const wasLoaded = this.previousState.hunter !== null;
            const isLoaded = currentState.hunter !== null;

            if (!wasLoaded && isLoaded) {
                shouldTrigger = true;
                triggerDesc = 'Hunter load';
            }
        } else if (chain.trigger.characterType === 'survivor') {
            // Check if specific survivor position is set
            if (chain.trigger.survivorPosition) {
                const position = parseInt(chain.trigger.survivorPosition) - 1; // Convert 1-4 to 0-3

                const wasSurvivorLoaded = this.previousState.survivors[position] !== null;
                const isSurvivorLoaded = currentState.survivors[position] !== null;

                console.log(`[Trigger] Checking Survivor position ${position + 1}: was=${wasSurvivorLoaded}, is=${isSurvivorLoaded}`);

                if (!wasSurvivorLoaded && isSurvivorLoaded) {
                    shouldTrigger = true;
                    triggerDesc = `Survivor ${chain.trigger.survivorPosition} load`;
                }
            } else {
                // No position specified - check if any survivor was just loaded
                for (let i = 0; i < 4; i++) {
                    const wasSurvivorLoaded = this.previousState.survivors[i] !== null;
                    const isSurvivorLoaded = currentState.survivors[i] !== null;

                    if (!wasSurvivorLoaded && isSurvivorLoaded) {
                        shouldTrigger = true;
                        triggerDesc = `Any Survivor load (position ${i + 1})`;
                        break;
                    }
                }
            }
        } else if (!chain.trigger.characterType) {
            // No specific character type - trigger on any load
            const hunterChanged = this.previousState.hunter === null && currentState.hunter !== null;
            const anyNewSurvivor = currentState.survivors.some((s, i) =>
                this.previousState.survivors[i] === null && s !== null
            );

            if (hunterChanged || anyNewSurvivor) {
                shouldTrigger = true;
                triggerDesc = 'Any character load';
            }
        }

        if (shouldTrigger) {
            console.log(`[Trigger] ✓ Triggering animation "${chain.name}" on "${objectName}" from ${triggerDesc}`);
            this.player.playChain(objectName, chain.id);
        }
    }

    checkUnloadTrigger(chain, objectName, currentState) {
        let shouldTrigger = false;
        let triggerDesc = 'character unload';

        if (chain.trigger.characterType === 'hunter') {
            // Check if hunter was just unloaded (was there before, not there now)
            const wasLoaded = this.previousState.hunter !== null;
            const isLoaded = currentState.hunter !== null;

            if (wasLoaded && !isLoaded) {
                shouldTrigger = true;
                triggerDesc = 'Hunter unload';
            }
        } else if (chain.trigger.characterType === 'survivor') {
            // Check if specific survivor position is set
            if (chain.trigger.survivorPosition) {
                const position = parseInt(chain.trigger.survivorPosition) - 1; // Convert 1-4 to 0-3

                const wasSurvivorLoaded = this.previousState.survivors[position] !== null;
                const isSurvivorLoaded = currentState.survivors[position] !== null;

                console.log(`[Trigger] Checking Survivor position ${position + 1} unload: was=${wasSurvivorLoaded}, is=${isSurvivorLoaded}`);

                if (wasSurvivorLoaded && !isSurvivorLoaded) {
                    shouldTrigger = true;
                    triggerDesc = `Survivor ${chain.trigger.survivorPosition} unload`;
                }
            } else {
                // No position specified - check if any survivor was just unloaded
                for (let i = 0; i < 4; i++) {
                    const wasSurvivorLoaded = this.previousState.survivors[i] !== null;
                    const isSurvivorLoaded = currentState.survivors[i] !== null;

                    if (wasSurvivorLoaded && !isSurvivorLoaded) {
                        shouldTrigger = true;
                        triggerDesc = `Any Survivor unload (position ${i + 1})`;
                        break;
                    }
                }
            }
        } else if (!chain.trigger.characterType) {
            // No specific character type - trigger on any unload
            const hunterChanged = this.previousState.hunter !== null && currentState.hunter === null;
            const anyRemovedSurvivor = this.previousState.survivors.some((s, i) =>
                s !== null && currentState.survivors[i] === null
            );

            if (hunterChanged || anyRemovedSurvivor) {
                shouldTrigger = true;
                triggerDesc = 'Any character unload';
            }
        }

        if (shouldTrigger) {
            console.log(`[Trigger] ✓ Triggering animation "${chain.name}" on "${objectName}" from ${triggerDesc}`);
            this.player.playChain(objectName, chain.id);
        }
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
