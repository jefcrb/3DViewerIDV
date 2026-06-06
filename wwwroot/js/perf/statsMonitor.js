import Stats from 'three/addons/libs/stats.module.js';

const LS_KEY = 'viewer.perfMonitor';

let stats = null;
let visible = false;

function readStoredVisibility() {
    try {
        return localStorage.getItem(LS_KEY) === '1';
    } catch {
        return false;
    }
}

function persist(v) {
    try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch {}
}

export function initPerfMonitor() {
    if (stats) return stats;

    stats = new Stats();
    stats.dom.style.position = 'fixed';
    stats.dom.style.top = '0';
    stats.dom.style.left = '';
    stats.dom.style.right = '0';
    stats.dom.style.zIndex = '200';

    document.body.appendChild(stats.dom);

    setPerfMonitorVisible(readStoredVisibility());

    window.addEventListener('keydown', (e) => {
        if (e.key !== 'p' && e.key !== 'P') return;
        const tag = e.target?.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        if (e.target?.isContentEditable) return;
        togglePerfMonitor();
    });

    return stats;
}

export function setPerfMonitorVisible(v) {
    if (!stats) return;
    visible = !!v;
    stats.dom.style.display = visible ? 'block' : 'none';
    persist(visible);
}

export function togglePerfMonitor() {
    setPerfMonitorVisible(!visible);
}

export function isPerfMonitorVisible() {
    return visible;
}

export function updatePerfMonitor() {
    if (stats) stats.update();
}
