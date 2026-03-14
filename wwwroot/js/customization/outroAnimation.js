// Outro animation
export const OUTRO_CONFIG = {
    duration: 600,          // ms
    endOffset: -1.0,
    fadeOut: true,
    easing: 'easeInCubic'
};

const easingFunctions = {
    linear: t => t,
    easeInCubic: t => t * t * t,
    easeOutCubic: t => 1 - Math.pow(1 - t, 3),
    easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
};

export function playOutroAnimation(model) {
    return new Promise((resolve) => {
        const config = OUTRO_CONFIG;
        const startY = model.position.y;
        const endY = model.position.y + config.endOffset;
        const startTime = performance.now();

        if (config.fadeOut) {
            model.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.transparent = true;
                }
            });
        }

        const easingFn = easingFunctions[config.easing] || easingFunctions.easeInCubic;

        function animate() {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / config.duration, 1);
            const eased = easingFn(progress);

            // Animate position
            model.position.y = startY + (endY - startY) * eased;

            // Animate opacity
            if (config.fadeOut) {
                model.traverse((child) => {
                    if (child.isMesh && child.material) {
                        child.material.opacity = 1 - eased;
                    }
                });
            }

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                resolve();
            }
        }

        animate();
    });
}
