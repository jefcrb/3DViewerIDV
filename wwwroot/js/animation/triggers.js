// Trigger event bus. Sequences carry start-trigger and (when looping) stop-trigger
// lists. Firing an event:
//   - plays every sequence whose start-triggers include the event name
//     (with iterationCount = Infinity if seq.loop, else 1).
//   - stops every looping sequence whose stop-triggers include the event name.
// A loop can therefore be started and stopped multiple times by different events.
//
// Auto-triggers (fired by characters/api.js, scene_loaded, mode changes, etc.) only
// act on sequences in live mode. Editor mode is for authoring; the user manually
// clicks Play to test.

import { sequencer } from './sequencer.js';

const bus = new EventTarget();

export const STANDARD_EVENTS = [
    'scene_loaded',
    'live_mode_entered',
    'hunter_selected',
    'hunter_changed',
    'hunter_deselected',
    'survivor_1_selected',
    'survivor_2_selected',
    'survivor_3_selected',
    'survivor_4_selected',
    'survivor_any_selected',
    'survivor_1_deselected',
    'survivor_2_deselected',
    'survivor_3_deselected',
    'survivor_4_deselected',
    'survivor_any_deselected'
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
        const both = [...(seq.triggers || []), ...(seq.stopTriggers || [])];
        for (const e of both) {
            if (!STANDARD_EVENTS.includes(e)) userEvents.add(e);
        }
    }
    return [...STANDARD_EVENTS, ...userEvents];
}

// Always fires the DOM event (for listeners), but only plays/stops sequences in
// live mode.
export function fire(eventName, detail = {}) {
    console.log(`[trigger] ${eventName}`, detail);
    bus.dispatchEvent(new CustomEvent(eventName, { detail }));
    bus.dispatchEvent(new CustomEvent('any', { detail: { eventName, ...detail } }));

    if (!firingAllowed) return;

    for (const seq of sequencer.listSequences()) {
        if (Array.isArray(seq.triggers) && seq.triggers.includes(eventName)) {
            sequencer.play(seq.id, { iterationCount: seq.loop ? Infinity : 1 });
        }
        if (seq.loop && Array.isArray(seq.stopTriggers) && seq.stopTriggers.includes(eventName)) {
            sequencer.stop(seq.id);
        }
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
