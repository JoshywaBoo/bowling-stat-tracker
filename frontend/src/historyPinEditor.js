// historyPinEditor.js
// Standalone modal for pin-by-pin editing of an already-saved game.
// Fully self-contained (own DOM, own buffer state) — never touches
// live.js's module state, so it can be opened regardless of whatever's
// going on in the Live tracking section. Reuses live.js's pure bowling
// logic (no DOM/module-state dependency) rather than re-deriving it, and
// shares the frame-edit engine + split-pin detection with live.js via
// frameEditor.js / splitDetection.js so both editors can't drift apart.

import { renderPinRack, allPinsStanding, pinsDownCount } from './pinRack.js';
import {
    parseFrames, validateGame, parseAnnotatedFrameString,
    annotateFrameWithSplits, buildFrameOverlayHtml, frame10ValidMarkIndices, parseRollValue,
} from './frames.js';
import { API_BASE } from './main.js';
import { loadHistory } from './history.js';
import { showLoggedOut } from './auth.js';
import { knockedPinNumbers, isFirstRollOfFrame, advanceAfterRoll } from './live.js';
import { createFrameEditor, markSplitIfNeeded, isFrame10Complete } from './frameEditor.js';

const overlay = document.getElementById('pin-edit-modal-overlay');
const pinRackContainer = document.getElementById('pin-edit-pin-rack');
const readoutEl = document.getElementById('pin-edit-readout');
const resetBtn = document.getElementById('pin-edit-reset-btn');
const confirmBtn = document.getElementById('pin-edit-confirm-btn');
const frameCancelBtn = document.getElementById('pin-edit-frame-cancel-btn');
const frameStringEl = document.getElementById('pin-edit-frame-string');
const playerNameInput = document.getElementById('pin-edit-player-name');
const saveBtn = document.getElementById('pin-edit-save-btn');
const discardBtn = document.getElementById('pin-edit-discard-btn');
const closeBtn = document.getElementById('pin-edit-close-btn');
const statusEl = document.getElementById('pin-edit-status');
const strikeBtn = document.getElementById('pin-edit-strike-btn');
const invertBtn = document.getElementById('pin-edit-invert-btn');

let gameId = null;
let rollSymbols = [];
let pinHistory = [];
let rackAtRollStart = allPinsStanding();
let standingPins = allPinsStanding();
let gameDone = false;

let splitFrames = {};

// Same shared engine live.js uses, wired to THIS module's own
// rollSymbols/pinHistory/splitFrames. Independent instance — nothing here
// is shared with live.js's own frameEditor beyond the pure logic.
const frameEditor = createFrameEditor({
    getRollSymbols: () => rollSymbols,
    getPinHistory: () => pinHistory,
    getSplitFrames: () => splitFrames,
});

export function openPinEditModal(game) {
    gameId = game.id;
    const parsed = parseAnnotatedFrameString(game.frame_string);
    rollSymbols = parsed.rollSymbols;
    splitFrames = parsed.splitFrames;
    pinHistory = (game.pin_history || []).map(pins => [...pins]);
    rackAtRollStart = allPinsStanding();
    standingPins = allPinsStanding();
    const loadedFrames = parseFrames(rollSymbols);
    gameDone = loadedFrames.length >= 10 ? isFrame10Complete(loadedFrames[9].split('')) : false;
    frameEditor.reset();
    playerNameInput.value = game.player_name || '';
    statusEl.textContent = '';
    saveBtn.disabled = false;
    overlay.style.display = 'flex';
    render();
}

function closeModal() {
    overlay.style.display = 'none';
    gameId = null;
    rollSymbols = [];
    pinHistory = [];
    frameEditor.reset();
    splitFrames = {};
}

// An edit only ever commits once its frame is fully complete, so after
// committing we're always sitting exactly at a frame boundary — the next
// roll (if any) always starts from a fresh rack.
function recomputeStateAfterEdit() {
    const frames = parseFrames(rollSymbols);
    gameDone = frames.length >= 10 ? isFrame10Complete(frames[9].split('')) : false;
    rackAtRollStart = allPinsStanding();
    standingPins = allPinsStanding();
}

// ------------------------------------------------------------------ render

function renderFrameChips() {
    const frames = parseFrames(rollSymbols);
    const editing = frameEditor.isActive();
    const editingFrameIndex = frameEditor.activeFrameIndex();

    frameStringEl.innerHTML = '';

    for (let idx = 0; idx < 10; idx++) {
        const hasFrame = idx < frames.length;
        const isEditingThis = idx === editingFrameIndex;
        const displayFrame = isEditingThis
            ? frameEditor.displayRollSymbols().join('')
            : (hasFrame ? frames[idx] : '');
        const isFrame10 = idx === 9;
        // While this frame is the one being edited, use the frame editor's
        // own live split marks (updated on every confirm) instead of the
        // committed splitFrames — that way the split coloring changes the
        // instant a roll is confirmed, not only once the whole frame is
        // done and spliced back in.
        const markedIndices = isEditingThis ? frameEditor.displaySplitMarks() : (splitFrames[idx] || []);

        const cell = document.createElement('div');
        cell.className = 'frame-cell';

        const n = document.createElement('span');
        n.className = 'frame-n' + (markedIndices.length ? ' split-marked' : '');
        n.textContent = idx + 1;
        n.title = isFrame10
            ? 'Click to cycle: none → 1st roll → 2nd roll → 3rd roll → 1st + 3rd roll'
            : 'Click to toggle split';
        n.addEventListener('click', (e) => {
            e.stopPropagation();
            if (editing || !hasFrame) return;
            const current = splitFrames[idx] || [];

            if (!isFrame10) {
                const pins = parseRollValue(displayFrame[0]);
                const canSplit = pins > 0 && pins < 10;
                if (current.length) {
                    delete splitFrames[idx];
                    render();
                    return;
                }
                if (!canSplit) return;
                splitFrames[idx] = [0];
                render();
                return;
            }

            const validIdx = new Set(frame10ValidMarkIndices(displayFrame.split('')));
            const sameSet = (a, b) => a.length === b.length && a.every(v => b.includes(v));
            const sequence = [[], [0], [1], [2], [0, 2]];
            const currentPos = sequence.findIndex(s => sameSet(s, current));
            let nextPos = (currentPos === -1 ? 0 : currentPos) + 1;
            while (nextPos < sequence.length && sequence[nextPos].some(i => !validIdx.has(i))) {
                nextPos++;
            }
            const next = nextPos < sequence.length ? sequence[nextPos] : [];
            if (next.length) {
                splitFrames[idx] = next;
            } else {
                delete splitFrames[idx];
            }
            render();
        });

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'frame-chip'
            + (isEditingThis ? ' frame-chip-editing' : '')
            + (hasFrame ? '' : ' frame-chip-empty');
        chip.innerHTML = displayFrame ? buildFrameOverlayHtml(displayFrame, markedIndices) : '&nbsp;';

        if (!editing && hasFrame) {
            chip.title = 'Tap to fix this frame';
            chip.addEventListener('click', () => startFrameEdit(idx));
        }

        cell.appendChild(n);
        cell.appendChild(chip);
        frameStringEl.appendChild(cell);
    }
}

function startFrameEdit(frameIdx) {
    if (frameEditor.start(frameIdx)) {
        statusEl.textContent = '';
        render();
    }
}

function render() {
    const editing = frameEditor.isActive();
    const activeStandingPins = editing ? frameEditor.displayStandingPins() : standingPins;

    renderPinRack(pinRackContainer, activeStandingPins, editing ? handleEditToggle : handleToggle);

    const down = pinsDownCount(activeStandingPins);
    readoutEl.textContent = editing
        ? `Editing frame ${frameEditor.activeFrameIndex() + 1} — ${down} pin${down === 1 ? '' : 's'} down this roll`
        : (gameDone ? 'Game complete' : `${down} pin${down === 1 ? '' : 's'} down this roll`);

    renderFrameChips();

    confirmBtn.textContent = editing ? 'Confirm roll (editing)' : 'Confirm Roll';
    confirmBtn.disabled = editing ? false : gameDone;
    frameCancelBtn.style.display = editing ? '' : 'none';
}

function handleToggle(pinNumber) {
    if (gameDone) return;
    standingPins[pinNumber - 1] = !standingPins[pinNumber - 1];
    render();
}

function handleEditToggle(pinNumber) {
    frameEditor.togglePin(pinNumber);
    render();
}

function handleStrikeAll() {
    if (frameEditor.isActive()) {
        frameEditor.knockAllStanding();
    } else {
        if (gameDone) return;
        standingPins = standingPins.map(() => false);
    }
    render();
}

function handleInvertAll() {
    if (frameEditor.isActive()) {
        frameEditor.invertStandingPins();
    } else {
        if (gameDone) return;
        standingPins = standingPins.map(p => !p);
    }
    render();
}

confirmBtn.addEventListener('click', () => {
    if (frameEditor.isActive()) {
        const { committed } = frameEditor.confirmRoll();
        if (committed) recomputeStateAfterEdit();
        render();
        return;
    }
    if (gameDone) return;

    const pinsAvailable = rackAtRollStart.filter(Boolean).length;
    const knockedThisRoll = rackAtRollStart.filter((wasStanding, i) => wasStanding && !standingPins[i]).length;
    const frameStart = isFirstRollOfFrame(rollSymbols);

    let symbol;
    if (knockedThisRoll === pinsAvailable) {
        symbol = frameStart ? 'X' : '/';
    } else {
        symbol = knockedThisRoll === 0 ? '-' : String(knockedThisRoll);
    }

    rollSymbols.push(symbol);
    pinHistory.push(knockedPinNumbers(rackAtRollStart, standingPins));
    markSplitIfNeeded(splitFrames, rollSymbols, frameStart, standingPins);

    const { gameDone: done, nextRack } = advanceAfterRoll(symbol, rollSymbols, standingPins);
    gameDone = done;
    rackAtRollStart = nextRack;
    standingPins = [...nextRack];

    render();
});

frameCancelBtn.addEventListener('click', () => {
    frameEditor.cancel();
    render();
});

resetBtn.addEventListener('click', () => {
    rollSymbols = [];
    pinHistory = [];
    rackAtRollStart = allPinsStanding();
    standingPins = allPinsStanding();
    gameDone = false;
    frameEditor.reset();
    splitFrames = {};
    statusEl.textContent = '';
    render();
});

saveBtn.addEventListener('click', async () => {
    const validationError = validateGame(rollSymbols);
    if (validationError) {
        statusEl.textContent = validationError;
        return;
    }

    const frameString = parseFrames(rollSymbols)
        .map((f, idx) => annotateFrameWithSplits(f, splitFrames[idx] || []))
        .join(' ');
    saveBtn.disabled = true;
    statusEl.textContent = 'Saving…';

    try {
        const res = await fetch(`${API_BASE}/api/games/${gameId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                frame_string: frameString,
                pin_history: pinHistory,
                player_name: playerNameInput.value || null,
                created_at: null,
            }),
        });
        if (res.status === 401) { showLoggedOut(); return; }
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Could not save this game.');

        closeModal();
        loadHistory();
    } catch (err) {
        statusEl.textContent = err.message || 'Could not save this game.';
        saveBtn.disabled = false;
    }
});

strikeBtn.addEventListener('click', handleStrikeAll);

invertBtn.addEventListener('click', handleInvertAll);

discardBtn.addEventListener('click', closeModal);

closeBtn.addEventListener('click', closeModal);

overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
});
