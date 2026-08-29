const bus = new EventTarget();

let colors = { home: null, away: null, currentSur: null, currentHun: null };

export const TEAM_COLOR_BINDINGS = ['static', 'home', 'away', 'currentSur', 'currentHun'];

export function updateTeamColors(next) {
    if (!next || typeof next !== 'object') return;
    const merged = {
        home: next.home ?? null,
        away: next.away ?? null,
        currentSur: next.currentSur ?? null,
        currentHun: next.currentHun ?? null
    };
    if (merged.home === colors.home
        && merged.away === colors.away
        && merged.currentSur === colors.currentSur
        && merged.currentHun === colors.currentHun) return;
    colors = merged;
    bus.dispatchEvent(new CustomEvent('change', { detail: { ...colors } }));
}

export function getTeamColors() {
    return { ...colors };
}

export function getTeamColor(binding) {
    if (!binding || binding === 'static') return null;
    return colors[binding] ?? null;
}

export function onTeamColorsChange(handler) {
    bus.addEventListener('change', handler);
    return () => bus.removeEventListener('change', handler);
}
