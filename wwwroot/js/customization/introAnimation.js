import * as THREE from 'three';

// Intro animation
export const INTRO_CONFIG = {
    duration: 1600,         // ms
    startOffset: 1.5,
    fadeIn: true,
    easing: 'easeOutCubic',
    smoke: {
        enabled: false,
        particleCount: 16,
        radius: 0.05,
        height: 2,
        opacity: 0.7,
        dissipateDelay: 0.85,
        dissipateDuration: 1.0
    }
};

const easingFunctions = {
    linear: t => t,
    easeInCubic: t => t * t * t,
    easeOutCubic: t => 1 - Math.pow(1 - t, 3),
    easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
};

// Create smoke particle sprite texture
function createSmokeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.9)');
    gradient.addColorStop(0.4, 'rgba(20, 20, 20, 0.5)');
    gradient.addColorStop(1, 'rgba(40, 40, 40, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    return new THREE.CanvasTexture(canvas);
}

export function playIntroAnimation(model) {
    const config = INTRO_CONFIG;
    // const startY = model.position.y - config.startOffset;
    // const endY = model.position.y;                         
    const startTime = performance.now();

    // model.position.y = startY;

    // Set initial opacity to 0
    if (config.fadeIn) {
        model.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.transparent = true;
                child.material.opacity = 0;
            }
        });
    }

    // Create smoke particles
    const smokeParticles = [];
    if (config.smoke.enabled) {
        const smokeTexture = createSmokeTexture();
        const spriteMaterial = new THREE.SpriteMaterial({
            map: smokeTexture,
            transparent: true,
            opacity: config.smoke.opacity,
            depthWrite: false,
            blending: THREE.NormalBlending
        });

        for (let i = 0; i < config.smoke.particleCount; i++) {
            const sprite = new THREE.Sprite(spriteMaterial.clone());
            const angle = (i / config.smoke.particleCount) * Math.PI * 2;
            const radius = config.smoke.radius + Math.random() * 0.5;

            sprite.position.set(
                model.position.x + Math.cos(angle) * radius,
                model.position.y + Math.random() * config.smoke.height,
                model.position.z + Math.sin(angle) * radius
            );

            sprite.scale.set(1.5, 1.5, 1);
            sprite.userData.initialY = sprite.position.y;
            sprite.userData.riseSpeed = 0.3 + Math.random() * 0.5;

            model.parent.add(sprite);
            smokeParticles.push(sprite);
        }
    }

    const easingFn = easingFunctions[config.easing] || easingFunctions.easeOutCubic;

    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / config.duration, 1);
        const eased = easingFn(progress);

        // Translation animation (commented out as example)
        // model.position.y = startY + (endY - startY) * eased;

        // Fade in character
        if (config.fadeIn && progress < 1) {
            model.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.opacity = eased;
                }
            });
        }

        // Animate smoke particles
        if (config.smoke.enabled) {
            const totalSmokeDuration = config.duration * config.smoke.dissipateDuration;
            const dissipateStartTime = config.duration * config.smoke.dissipateDelay;

            // Calculate smoke dissipation progress
            let smokeOpacity = config.smoke.opacity;
            if (elapsed > dissipateStartTime) {
                const dissipateElapsed = elapsed - dissipateStartTime;
                const dissipateDuration = totalSmokeDuration - dissipateStartTime;
                const dissipateProgress = Math.min(dissipateElapsed / dissipateDuration, 1);
                smokeOpacity = config.smoke.opacity * (1 - dissipateProgress);
            }

            smokeParticles.forEach((sprite) => {
                // Rise up
                sprite.position.y = sprite.userData.initialY + (progress * sprite.userData.riseSpeed);

                // Fade out gradually after delay
                sprite.material.opacity = smokeOpacity;

                // Expand slightly
                const scale = 1.5 + progress * 0.5;
                sprite.scale.set(scale, scale, 1);
            });
        }

        // Check if both character and smoke are done
        const totalSmokeDuration = config.duration * config.smoke.dissipateDuration;
        const smokeDone = !config.smoke.enabled || elapsed >= totalSmokeDuration;
        const characterDone = progress >= 1;

        if (!smokeDone || !characterDone) {
            requestAnimationFrame(animate);
        } else {
            // Cleanup
            if (config.fadeIn) {
                model.traverse((child) => {
                    if (child.isMesh && child.material) {
                        child.material.transparent = false;
                        child.material.opacity = 1;
                    }
                });
            }

            // Remove smoke particles
            smokeParticles.forEach((sprite) => {
                model.parent.remove(sprite);
                sprite.material.dispose();
            });
        }
    }

    animate();
}
