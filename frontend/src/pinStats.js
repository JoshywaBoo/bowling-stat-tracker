// pinStats.js
// Aggregates pin_history data into "which spares get left most" stats,
// grouped by the labeled split groups in splitDetection.js.

import { SPLIT_GROUPS, SPLIT_GROUP_LABELS, standingPinNumbers } from './splitDetection.js';
import { frameLeaves } from './pinRack.js';
import { stripSplitMarkers } from './frames.js';

const SINGLE_PINS_LABEL = 'Single pins';
const OTHER_LABEL = 'Other';

function comboKeyFor(pins) {
    return [...pins].sort((a, b) => a - b).join('-');
}

// label -> ordered list of known combos (pin-number arrays) for that
// label. "Single pins" gets pins 1-10 individually; each split group
// gets its SPLIT_GROUPS membership; "Other" has no fixed set — it's
// built dynamically from whatever unmatched leaves actually occur.
const KNOWN_COMBOS_BY_LABEL = new Map();
KNOWN_COMBOS_BY_LABEL.set(SINGLE_PINS_LABEL, Array.from({ length: 10 }, (_, i) => [i + 1]));
SPLIT_GROUPS.forEach((combos, i) => {
    KNOWN_COMBOS_BY_LABEL.set(SPLIT_GROUP_LABELS[i], combos);
});

// comboKey -> label, so a leave can be classified in one lookup.
const COMBO_TO_LABEL = new Map();
KNOWN_COMBOS_BY_LABEL.forEach((combos, label) => {
    combos.forEach(pins => COMBO_TO_LABEL.set(comboKeyFor(pins), label));
});

export function classifyLeave(standingArr) {
    const pins = standingPinNumbers(standingArr);
    const comboKey = comboKeyFor(pins);
    const label = COMBO_TO_LABEL.get(comboKey) || OTHER_LABEL;
    return { label, comboKey, pins };
}

const LABEL_ORDER = [SINGLE_PINS_LABEL, ...SPLIT_GROUP_LABELS, OTHER_LABEL];

// Returns { sampleSize, groups }, where groups is sorted by total count
// descending, and each group's `combos` list is sorted the same way.
// Only games with pin_history are considered.
export function computeLeaveBreakdown(games) {
    const withPinData = games.filter(g => g.pin_history && g.pin_history.length);

    // label -> Map(comboKey -> { pins, count })
    const tally = new Map();
    LABEL_ORDER.forEach(label => tally.set(label, new Map()));

    // Pre-seed every known combo at 0 so a group's dropdown always shows
    // its full membership, not just the combos that happened to occur.
    KNOWN_COMBOS_BY_LABEL.forEach((combos, label) => {
        combos.forEach(pins => {
            tally.get(label).set(comboKeyFor(pins), { pins, count: 0 });
        });
    });

    withPinData.forEach(g => {
        const strippedChunks = stripSplitMarkers(g.frame_string).trim().split(/\s+/).filter(Boolean);
        let offset = 0;
        strippedChunks.forEach(stripped => {
            const rollCount = stripped.length;
            const frameKnockedPins = g.pin_history.slice(offset, offset + rollCount);
            offset += rollCount;

            frameLeaves(frameKnockedPins).forEach(standingArr => {
                const { label, comboKey, pins } = classifyLeave(standingArr);
                const combos = tally.get(label);
                if (!combos.has(comboKey)) combos.set(comboKey, { pins, count: 0 }); // "Other" — first time seeing this one
                combos.get(comboKey).count++;
            });
        });
    });

    const groups = LABEL_ORDER
        .map(label => {
            const combos = Array.from(tally.get(label).values()).sort((a, b) => b.count - a.count);
            const count = combos.reduce((sum, c) => sum + c.count, 0);
            return { label, count, combos };
        })
        .filter(g => g.count > 0)
        .sort((a, b) => b.count - a.count);

    return { sampleSize: withPinData.length, groups };
}