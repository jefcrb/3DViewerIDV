// Trigger event bus. Sequences carry their own trigger list; firing an event plays
// every sequence whose triggers include that event name.
//
// Auto-triggers (fired by characters/api.js, scene_loaded, etc.) only play in live
// mode. Editor mode is for authoring; the user manually clicks Play to test.

import { sequencer } from './sequencer.js';

const bus = new EventTarget();

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

let firingAllowed = true;

export function setFiringAllowed(allowed) {
    firingAllowed = allowed;
    if (!allowed) sequencer.stopAll();
}

export function isFiringAllowed() {
    return firingAllowed;
}

export function listKnownEvents() {
    const userEvents = new Set();
    for (const seq of sequencer.listSequences()) {
        for (const e of seq.triggers || []) {
            if (!STANDARD_EVENTS.includes(e)) userEvents.add(e);
        }
    }
    return [...STANDARD_EVENTS, ...userEvents];
}

// Always fires the DOM event (for listeners), but only plays sequences in live mode.
export function fire(eventName, detail = {}) {
    console.log(`[trigger] ${eventName}`, detail);
    bus.dispatchEvent(new CustomEvent(eventName, { detail }));
    bus.dispatchEvent(new CustomEvent('any', { detail: { eventName, ...detail } }));

    if (!firingAllowed) return;

    for (const seq of sequencer.listSequences()) {
        if (!seq.triggers || !seq.triggers.includes(eventName)) continue;
        const iterationCount = (eventName === LOOP_EVENT) ? Infinity : 1;
        sequencer.play(seq.id, { iterationCount });
    }
}

// Manual play helper (used by the Animations panel's Play button — bypasses
// firingAllowed so editor previews work).
export function playSequence(id, opts) {
    sequencer.play(id, opts);
}

export function stopSequence(id) {
    sequencer.stop(id);
}

export function on(eventName, handler) {
    bus.addEventListener(eventName, handler);
    return () => bus.removeEventListener(eventName, handler);
}

export function onAny(handler) {
    return on('any', handler);
}
