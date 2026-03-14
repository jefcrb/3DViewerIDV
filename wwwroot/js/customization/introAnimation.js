// Intro animation
export const INTRO_CONFIG = {
    duration: 800,          // ms
    startOffset: 1.5,
    fadeIn: true,
    easing: 'easeOutCubic'
};

const easingFunctions = {
    linear: t => t,
    easeInCubic: t => t * t * t,
    easeOutCubic: t => 1 - Math.pow(1 - t, 3),
    easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
};

export function playIntroAnimation(model) {
    const config = INTRO_CONFIG;
    const startY = model.position.y - config.startOffset;
    const endY = model.position.y;
    const startTime = performance.now();

    model.position.y = startY;

    if (config.fadeIn) {
        model.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.transparent = true;
                child.material.opacity = 0;
            }
        });
    }

    const easingFn = easingFunctions[config.easing] || easingFunctions.easeOutCubic;

    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / config.duration, 1);
        const eased = easingFn(progress);

        model.position.y = startY + (endY - startY) * eased;

        if (config.fadeIn) {
            model.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.opacity = eased;
                }
            });
        }

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            if (config.fadeIn) {
                model.traverse((child) => {
                    if (child.isMesh && child.material) {
                        child.material.transparent = false;
                        child.material.opacity = 1;
                    }
                });
            }
        }
    }

    animate();
}
