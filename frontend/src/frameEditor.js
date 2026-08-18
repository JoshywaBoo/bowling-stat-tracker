// frameEditor.js
// Shared "replay one already-recorded frame from scratch" engine, used by
// both live.js's inline frame-edit flow and historyPinEditor.js's modal.
// Also carries the small pieces of split-detection wiring that both hosts'
// FRESH (non-edit) roll-confirm handlers need, so that logic isn't
// duplicated either.
//
// This module holds no DOM and no host-specific state — it only knows
// about roll symbols / pin history / split-frame maps, via accessors the
// host provides. That keeps historyPinEditor.js's "never touches live.js's
// module state" guarantee intact: each host creates its own independent
// createFrameEditor() instance, so nothing is shared between them but this
// pure logic.

import { parseFrames } from './frames.js';
import { allPinsStanding } from './pinRack.js';
import { isKnownSplit } from './splitDetection.js';

// Frame 10 needs 3 rolls if it opened with a strike, or if the first two
// rolls made a spare — otherwise it's done after 2.
export function isFrame10Complete(chars) {
    if (chars.length < 2) return false;
    if (chars.length === 2) {
        if (chars[0].toUpperCase() === 'X') return false; // strike — bonus roll(s) still due
        if (chars[1] === '/') return false;                // spare — bonus roll still due
        return true;                                        // open frame, done after 2
    }
    return true; // 3 rolls is always the max/complete
}

// Offsets (in a flat rollSymbols array) where each currently-recorded
// frame starts — needed to know exactly what range to splice when an
// edit is committed, or which roll-index within frame 10 a fresh roll
// landed on.
export function frameStartOffsets(symbols) {
    const frames = parseFrames(symbols);
    const offsets = [];
    let cum = 0;
    frames.forEach(f => {
        offsets.push(cum);
        cum += f.length;
    });
    return offsets;
}

// Call this right after pushing a FRESH (non-edit) roll onto rollSymbols,
// to mark a split if that roll left a known split pattern standing.
// `wasFrameStart` is whether the just-played roll opened its frame.
// `pinsLeftStandingAfterRoll` is the rack AFTER the roll's pins fell —
// i.e. whatever the host's own `standingPins` held right before this
// call (NOT the pre-roll `rackAtRollStart`, which is always all-standing
// at a frame start and would make split detection never fire).
export function markSplitIfNeeded(splitFrames, rollSymbols, wasFrameStart, pinsLeftStandingAfterRoll) {
    if (!wasFrameStart || !isKnownSplit(pinsLeftStandingAfterRoll)) return;

    const frames = parseFrames(rollSymbols);
    const frameIdx = frames.length - 1;
    if (frameIdx !== 9) {
        splitFrames[frameIdx] = [0];
        return;
    }
    const offsets = frameStartOffsets(rollSymbols);
    const rollIdx = rollSymbols.length - 1 - offsets[9];
    const existing = splitFrames[9] || [];
    splitFrames[9] = existing.includes(rollIdx) ? existing : [...existing, rollIdx].sort((a, b) => a - b);
}

// `host` = {
//   getRollSymbols: () => string[],
//   getPinHistory:  () => number[][],
//   getSplitFrames: () => Record<number, number[]>,
// }
// Each accessor is called fresh every time an edit is started or
// committed, so the editor never holds a stale reference across a
// host-side reset (e.g. `rollSymbols = []`).
export function createFrameEditor(host) {
    let editingFrameIndex = null;
    let editStartOffset = 0;
    let editOriginalLength = 0;
    let editIsFrame10 = false;
    let editRollSymbols = [];
    let editPinHistory = [];
    let editAutoSplitMarks = [];
    let editRackAtRollStart = allPinsStanding();
    let editStandingPins = allPinsStanding();

    function reset() {
        editingFrameIndex = null;
        editRollSymbols = [];
        editPinHistory = [];
        editAutoSplitMarks = [];
        editRackAtRollStart = allPinsStanding();
        editStandingPins = allPinsStanding();
    }

    function isActive() {
        return editingFrameIndex !== null;
    }

    function activeFrameIndex() {
        return editingFrameIndex;
    }

    function isFrame10() {
        return editIsFrame10;
    }

    function displayRollSymbols() {
        return editRollSymbols;
    }

    function displayStandingPins() {
        return editStandingPins;
    }

    // Split marks detected so far THIS edit session, live — i.e. as of
    // whatever rolls have been confirmed, before the frame is fully done
    // and spliced back into the host's splitFrames. Hosts use this (rather
    // than their own splitFrames[frameIdx], which is stale until commit)
    // to color the frame being actively edited, so the split indicator
    // updates the instant a roll is confirmed instead of waiting for the
    // whole frame to complete. Starts empty each time an edit begins,
    // same as displayRollSymbols() — a fresh replay, not a memory of
    // whatever was marked before this edit started.
    function displaySplitMarks() {
        return editAutoSplitMarks;
    }

    // Begins editing frameIdx. Returns false (no-op) if already editing
    // something, or if frameIdx doesn't exist yet.
    function start(frameIdx) {
        if (isActive()) return false;

        const rollSymbols = host.getRollSymbols();
        const pinHistory = host.getPinHistory();
        const frames = parseFrames(rollSymbols);
        if (frameIdx < 0 || frameIdx >= frames.length) return false;

        const offsets = frameStartOffsets(rollSymbols);
        editingFrameIndex = frameIdx;
        editStartOffset = offsets[frameIdx];
        editOriginalLength = frames[frameIdx].length;
        editIsFrame10 = frameIdx === 9;
        editRollSymbols = [];
        editPinHistory = [];
        editAutoSplitMarks = [];
        editRackAtRollStart = allPinsStanding();

        // Pre-fill with the ACTUAL pins this frame's first roll knocked
        // down — pinHistory already has that recorded, so there's no need
        // to reconstruct a fake layout from the roll symbol. This is what
        // makes "hit Confirm once to replay roll 1 unchanged" show the
        // real pins instead of a lowest-numbered-first guess.
        const roll1Knocked = pinHistory[editStartOffset] || [];
        editStandingPins = editRackAtRollStart.map((_, i) => !roll1Knocked.includes(i + 1));

        return true;
    }

    function cancel() {
        reset();
    }

    function togglePin(pinNumber) {
        if (!isActive()) return;
        editStandingPins[pinNumber - 1] = !editStandingPins[pinNumber - 1];
    }

    // Deliberately separate from the top-level isFirstRollOfFrame that
    // hosts use for fresh rolls: that one infers "is this frame 10?" from
    // parseFrames(rollSymbols)'s position in the whole game, which only
    // works when the buffer IS the whole game so far. editRollSymbols is
    // an isolated single-frame buffer, so it needs this small explicit
    // version instead.
    function editFrameStart() {
        if (!editRollSymbols.length) return true; // first roll of the frame being edited
        if (!editIsFrame10) return false;          // any roll after the first, for a normal frame, is never "fresh"
        const lastChar = editRollSymbols[editRollSymbols.length - 1].toUpperCase();
        return lastChar === 'X' || lastChar === '/'; // frame 10 rack was reset by a strike/spare
    }

    function editFrameDone() {
        if (!editIsFrame10) {
            const first = editRollSymbols[0].toUpperCase();
            return first === 'X' || editRollSymbols.length === 2;
        }
        return isFrame10Complete(editRollSymbols);
    }

    // Confirms the currently-tapped rack state as the next roll of the
    // frame being edited. Returns { committed, frameIndex? }:
    // committed=true means the frame finished and was spliced back into
    // the host's rollSymbols/pinHistory/splitFrames — the host should
    // treat this as "editing just ended" (e.g. recompute its own
    // rackAtRollStart/standingPins/gameDone for what comes after).
    //
    // Split detection happens here per-roll (not just at commit): only a
    // frame-opening roll can leave a known split standing, so that's the
    // only roll that can change editAutoSplitMarks — but it's updated
    // (added to OR left alone) on every confirm so displaySplitMarks()
    // always reflects the current edit, letting a host recolor the frame
    // right after this one confirm instead of waiting for the frame to
    // fully commit.
    function confirmRoll() {
        if (!isActive()) return { committed: false };

        const pinsAvailable = editRackAtRollStart.filter(Boolean).length;
        const knockedThisRoll = editRackAtRollStart.filter((wasUp, i) => wasUp && !editStandingPins[i]).length;
        const frameStart = editFrameStart();

        let symbol;
        if (knockedThisRoll === pinsAvailable) {
            symbol = frameStart ? 'X' : '/';
        } else {
            symbol = knockedThisRoll === 0 ? '-' : String(knockedThisRoll);
        }

        if (frameStart) {
            if (editIsFrame10) {
                const rollIdx = editRollSymbols.length;
                const hit = isKnownSplit(editStandingPins);
                const already = editAutoSplitMarks.includes(rollIdx);
                if (hit && !already) editAutoSplitMarks.push(rollIdx);
                if (!hit && already) editAutoSplitMarks = editAutoSplitMarks.filter(i => i !== rollIdx);
            } else {
                // A normal frame only ever has one frame-opening roll, so
                // this roll alone determines the frame's split status —
                // set or clear it outright, immediately, right vs wrong.
                editAutoSplitMarks = isKnownSplit(editStandingPins) ? [0] : [];
            }
        }

        const knockedPins = [];
        editRackAtRollStart.forEach((wasUp, i) => {
            if (wasUp && !editStandingPins[i]) knockedPins.push(i + 1);
        });

        editRollSymbols.push(symbol);
        editPinHistory.push(knockedPins);

        if (editFrameDone()) {
            // Commit: replace exactly the symbols this frame used to
            // occupy. Everything before and after re-flows/re-groups
            // naturally the next time parseFrames runs over the updated
            // rollSymbols.
            const rollSymbols = host.getRollSymbols();
            const pinHistory = host.getPinHistory();
            const splitFrames = host.getSplitFrames();

            rollSymbols.splice(editStartOffset, editOriginalLength, ...editRollSymbols);
            pinHistory.splice(editStartOffset, editOriginalLength, ...editPinHistory);
            delete splitFrames[editingFrameIndex]; // roll composition changed — any old split mark is stale
            if (editAutoSplitMarks.length) {
                splitFrames[editingFrameIndex] = editIsFrame10
                    ? [...editAutoSplitMarks].sort((a, b) => a - b)
                    : [0];
            }

            const finishedFrameIndex = editingFrameIndex;
            reset();
            return { committed: true, frameIndex: finishedFrameIndex };
        }

        const justCleared = symbol === 'X' || symbol === '/';
        const nextRack = (!editIsFrame10 || !justCleared) ? [...editStandingPins] : allPinsStanding();
        editRackAtRollStart = nextRack;
        editStandingPins = [...nextRack];
        return { committed: false };
    }

    function knockAllStanding() {
        if (!isActive()) return;
        editStandingPins = editStandingPins.map(() => false);
    }

    function invertStandingPins() {
        if (!isActive()) return;
        editStandingPins = editStandingPins.map(p => !p);
    }

    return {
        start,
        cancel,
        reset,
        togglePin,
        knockAllStanding,
        invertStandingPins,
        confirmRoll,
        isActive,
        activeFrameIndex,
        isFrame10,
        displayRollSymbols,
        displayStandingPins,
        displaySplitMarks,
    };
}
