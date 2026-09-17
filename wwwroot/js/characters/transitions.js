// Per-character intro/outro transitions with configurable delay + optional fade.
// Config is pushed from main.js on registry world:update events; both fields are read
// synchronously at transition start so mid-flight changes don't stutter an in-progress
// fade — the change takes effect on the next mount/unmount.

const config = {
    fadeEnabled: true,
    fadeDuration: 400,   // ms
    introDelay: 0,       // ms — hidden between mount and fade-in start
    outroDelay: 0        // ms — visible between unmount request and fade-out start
};

export function setTransitionConfig(partial) {
    if (!partial || typeof partial !== 'object') return;
    if (typeof partial.fadeEnabled === 'boolean') config.fadeEnabled = partial.fadeEnabled;
    if (Number.isFinite(partial.fadeDuration)) config.fadeDuration = Math.max(0, partial.fadeDuration);
    if (Number.isFinite(partial.introDelay)) config.introDelay = Math.max(0, partial.introDelay);
    if (Number.isFinite(partial.outroDelay)) config.outroDelay = Math.max(0, partial.outroDelay);
}

// Force materials into a fade-friendly state and stamp userData so we can restore later.
function beginFade(model, initialOpacity) {
    model.traverse((child) => {
        if (child.isMesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => {
                if (m.userData.__prevTransparent === undefined) {
                    m.userData.__prevTransparent = m.transparent;
                    m.userData.__prevOpacity = m.opacity;
                }
                m.transparent = true;
                m.opacity = initialOpacity;
            });
        }
    });
}

function setFadeOpacity(model, opacity) {
    model.traverse((child) => {
        if (child.isMesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => { m.opacity = opacity; });
        }
    });
}

// Restore transparent/opacity to what the material had before beginFade stamped it.
function endFade(model) {
    model.traverse((child) => {
        if (child.isMesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => {
                if (m.userData.__prevTransparent !== undefined) {
                    m.transparent = m.userData.__prevTransparent;
                    m.opacity = m.userData.__prevOpacity;
                    delete m.userData.__prevTransparent;
                    delete m.userData.__prevOpacity;
                } else {
                    m.transparent = false;
                    m.opacity = 1;
                }
            });
        }
    });
}

// Cancel any pending delay timer or fade rAF on a model. Restores material state so
// disposeModel isn't fighting a half-finished transition.
export function stopTransition(model) {
    if (!model?.userData?.transition) return;
    const t = model.userData.transition;
    if (t.timeoutId) clearTimeout(t.timeoutId);
    if (t.rafId) cancelAnimationFrame(t.rafId);
    if (t.visibleWas !== undefined) model.visible = t.visibleWas;
    if (t.faded) endFade(model);
    model.userData.transition = null;
}

export function playIntro(model) {
    stopTransition(model);
    const cfg = { ...config };
    const state = { timeoutId: 0, rafId: 0, faded: false, visibleWas: model.visible };
    model.userData.transition = state;

    if (cfg.fadeEnabled) {
        state.faded = true;
        beginFade(model, 0);
    } else if (cfg.introDelay > 0) {
        // No fade + non-zero delay: hide entirely during the delay, then pop back on.
        model.visible = false;
    }

    const startFade = () => {
        if (model.userData.transition !== state) return; // superseded/stopped
        if (!cfg.fadeEnabled) {
            model.visible = state.visibleWas;
            model.userData.transition = null;
            return;
        }
        if (cfg.fadeDuration <= 0) {
            endFade(model);
            state.faded = false;
            model.userData.transition = null;
            return;
        }
        const t0 = performance.now();
        const step = () => {
            if (model.userData.transition !== state) return;
            const p = Math.min((performance.now() - t0) / cfg.fadeDuration, 1);
            setFadeOpacity(model, p);
            if (p < 1) {
                state.rafId = requestAnimationFrame(step);
            } else {
                endFade(model);
                state.faded = false;
                model.userData.transition = null;
            }
        };
        state.rafId = requestAnimationFrame(step);
    };

    if (cfg.introDelay > 0) {
        state.timeoutId = setTimeout(startFade, cfg.introDelay);
    } else {
        startFade();
    }
}

// Returns a promise that resolves when the outro (delay + fade) is done.
// The caller is responsible for removing/disposing the model on resolve.
export function playOutro(model) {
    stopTransition(model);
    return new Promise((resolve) => {
        const cfg = { ...config };
        const state = { timeoutId: 0, rafId: 0, faded: false, visibleWas: model.visible };
        model.userData.transition = state;

        const finish = () => {
            if (model.userData.transition === state) model.userData.transition = null;
            resolve();
        };

        const startFade = () => {
            if (model.userData.transition !== state) return;
            if (!cfg.fadeEnabled || cfg.fadeDuration <= 0) {
                finish();
                return;
            }
            state.faded = true;
            beginFade(model, 1);
            const t0 = performance.now();
            const step = () => {
                if (model.userData.transition !== state) return;
                const p = Math.min((performance.now() - t0) / cfg.fadeDuration, 1);
                setFadeOpacity(model, 1 - p);
                if (p < 1) {
                    state.rafId = requestAnimationFrame(step);
                } else {
                    // Leave materials at opacity=0/transparent=true; caller disposes right after.
                    finish();
                }
            };
            state.rafId = requestAnimationFrame(step);
        };

        if (cfg.outroDelay > 0) {
            state.timeoutId = setTimeout(startFade, cfg.outroDelay);
        } else {
            startFade();
        }
    });
}
