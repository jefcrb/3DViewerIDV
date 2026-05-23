// Trigger event bus. Sequences in Theatre.js can be tagged with event names; firing an event
// plays all sequences bound to it.

const bus = new EventTarget();

// triggerMap: { sequenceName: [eventName, ...] }
let triggerMap = {};

// sequencePlayers: { sequenceName: { play(opts), stop() } } registered by theatreSetup
const sequencePlayers = new Map();

const LOOP_EVENT = 'loop';

export const STANDARD_EVENTS = [
    'scene_loaded',
    'hunter_selected',
    'hunter_changed',
    'survivor_1_selected',
    'survivor_2_selected',
    'survivor_3_selected',
    'survivor_4_selected',
    'survivor_any_selected',
    LOOP_EVENT
];

export function setTriggerMap(map) {
    triggerMap = map ? { ...map } : {};
}

export function getTriggerMap() {
    return { ...triggerMap };
}

export function listKnownEvents() {
    const userEvents = new Set();
    for (const events of Object.values(triggerMap)) {
        for (const e of events) {
            if (!STANDARD_EVENTS.includes(e)) userEvents.add(e);
        }
    }
    return [...STANDARD_EVENTS, ...userEvents];
}

export function setSequenceTriggers(sequenceName, events) {
    if (!Array.isArray(events) || events.length === 0) {
        delete triggerMap[sequenceName];
    } else {
        triggerMap[sequenceName] = [...events];
    }
}

export function registerSequencePlayer(sequenceName, player) {
    sequencePlayers.set(sequenceName, player);
    // Auto-start sequences bound to loop
    const events = triggerMap[sequenceName] || [];
    if (events.includes(LOOP_EVENT)) {
        player.play({ iterationCount: Infinity });
    }
}

export function unregisterSequencePlayer(sequenceName) {
    const player = sequencePlayers.get(sequenceName);
    if (player && player.stop) player.stop();
    sequencePlayers.delete(sequenceName);
}

export function fire(eventName, detail = {}) {
    console.log(`[trigger] ${eventName}`, detail);
    bus.dispatchEvent(new CustomEvent(eventName, { detail }));
    bus.dispatchEvent(new CustomEvent('any', { detail: { eventName, ...detail } }));

    // Play all sequences bound to this event
    for (const [sequenceName, events] of Object.entries(triggerMap)) {
        if (!events.includes(eventName)) continue;
        const player = sequencePlayers.get(sequenceName);
        if (!player) continue;
        if (eventName === LOOP_EVENT) {
            player.play({ iterationCount: Infinity });
        } else {
            player.play({ iterationCount: 1 });
        }
    }
}

export function on(eventName, handler) {
    bus.addEventListener(eventName, handler);
    return () => bus.removeEventListener(eventName, handler);
}

// Convenience for any-event listening
export function onAny(handler) {
    return on('any', handler);
}
