// live.js
import { renderPinRack, allPinsStanding, pinsDownCount } from './pinRack.js';
import { saveLiveGameState, loadLiveGameState, clearLiveGameState } from './liveStorage.js';
import {
    parseFrames, validateGame, stripSplitMarkers,
    annotateFrameWithSplits, buildFrameOverlayHtml, frame10ValidMarkIndices, parseRollValue,
} from './frames.js';
import { API_BASE, showConfirmModal } from './main.js';
import { loadHistory } from './history.js';
import { showLoggedOut } from './auth.js';
import { createFrameEditor, markSplitIfNeeded, isFrame10Complete } from './frameEditor.js';

const pinRackContainer = document.getElementById('pin-rack');
const readoutEl = document.getElementById('pin-rack-readout');
const resetBtn = document.getElementById('pin-rack-reset-btn');
const confirmBtn = document.getElementById('pin-rack-confirm-btn');
const editCancelBtn = document.getElementById('pin-rack-edit-cancel-btn');
const strikeBtn = document.getElementById('pin-rack-strike-btn');
const invertBtn = document.getElementById('pin-rack-invert-btn');
const liveBackBtn = document.getElementById('live-back-btn');
const frameStringEl = document.getElementById('live-frame-string');
const playerNameInput = document.getElementById('live-player-name');
const saveBtn = document.getElementById('live-save-btn');
const saveStatusEl = document.getElementById('live-save-status');

// ---- live-entry state ----
// rollSymbols mirrors the same format frames.js/parseFrames expects
// elsewhere in the app (e.g. what gets typed into the frame-input boxes).
// pinHistory is a parallel array: pinHistory[i] is the list of 1-based
// pin numbers knocked down by rollSymbols[i]. It's kept 1:1 with
// rollSymbols everywhere — every push/splice to one has a matching
// push/splice to the other.
// rackAtRollStart is a snapshot of which pins were standing when the
// CURRENT (in-progress) roll began — used to work out how many pins
// were knocked down by this roll specifically.
const saved = loadLiveGameState();
let rollSymbols = saved?.rollSymbols ?? [];
let pinHistory = saved?.pinHistory ?? [];

let rackAtRollStart = saved?.rackAtRollStart ?? allPinsStanding();
let standingPins = saved?.standingPins ?? allPinsStanding();
let gameDone = false;

// ---- saved-game-edit state ----
// null = ordinary live entry (a fresh, unsaved game). Non-null = the id of
// an already-saved game, loaded via loadGameForEditing(), whose pin-tap
// history is being redone from scratch in this same buffer. Saving then
// PUTs back to that game instead of POSTing a new one.
let editingSavedGameId = null;

// Per-frame split markers, same shape/semantics as the upload editor's
// player.splitFrames: { [frameIdx]: number[] } — roll-indices *within
// that frame* marked as a split. Cosmetic only; folded into the saved
// frame_string at save time via annotateFrameWithSplits, same as
// frames.js's collectFrameStringFor does for the upload flow.
let splitFrames = {};

// Replaying one already-recorded frame from scratch (tap pins, Confirm,
// repeat) is shared logic with historyPinEditor.js's modal — see
// frameEditor.js. Each host (this module and the modal) creates its own
// independent instance wired to its own buffers, so nothing but the pure
// logic is shared, and the two editors can't drift apart.
const frameEditor = createFrameEditor({
    getRollSymbols: () => rollSymbols,
    getPinHistory: () => pinHistory,
    getSplitFrames: () => splitFrames,
});

function persist() {
    saveLiveGameState({ rollSymbols, pinHistory, rackAtRollStart, standingPins });
}

// Returns the 1-based pin numbers knocked down between two standing-pin
// snapshots (pins that were up in `before` and are down in `after`).
export function knockedPinNumbers(before, after) {
    const knocked = [];
    before.forEach((wasStanding, i) => {
        if (wasStanding && !after[i]) knocked.push(i + 1);
    });
    return knocked;
}

// Reports whether the NEXT roll to be recorded would be the first roll
// of its frame (frame boundary just crossed, or — in frame 10 only —
// the rack was reset by a strike/spare mid-frame). This is what actually
// determines strike-eligibility, not how many pins happen to be standing.
export function isFirstRollOfFrame(symbolsSoFar) {
    const frames = parseFrames(symbolsSoFar);
    if (!frames.length) return true; // very first roll of the game

    const frameIdx = frames.length - 1;
    const lastChunk = frames[frameIdx];
    const isFrame10 = frameIdx === 9;

    if (!isFrame10) {
        // A completed chunk (strike, or two rolls already played) means
        // we're actually about to start the NEXT frame.
        return lastChunk === 'X' || lastChunk.length === 2;
    }

    const chars = lastChunk.split('');
    if (isFrame10Complete(chars)) return true; // game's over, value unused
    const lastChar = chars[chars.length - 1].toUpperCase();
    return lastChar === 'X' || lastChar === '/'; // rack was reset
}

// Works out, after the roll just recorded, whether the frame just
// finished, whether the whole game just finished, and what rack the
// NEXT roll should start from.
export function advanceAfterRoll(justPlayedSymbol, symbolsSoFar, currentStandingPins) {
    const frames = parseFrames(symbolsSoFar);
    const frameIdx = frames.length - 1;
    const chunk = frames[frameIdx];
    const isFrame10 = frameIdx === 9;

    if (!isFrame10) {
        if (chunk === 'X' || chunk.length === 2) {
            return { frameDone: true, gameDone: false, nextRack: allPinsStanding() };
        }
        return { frameDone: false, gameDone: false, nextRack: currentStandingPins };
    }

    const chars = chunk.split('');
    if (isFrame10Complete(chars)) {
        return { frameDone: true, gameDone: true, nextRack: allPinsStanding() };
    }
    const justCleared = justPlayedSymbol === 'X' || justPlayedSymbol === '/';
    return { frameDone: false, gameDone: false, nextRack: justCleared ? allPinsStanding() : currentStandingPins };
}

function startFrameEdit(frameIdx) {
    if (frameEditor.start(frameIdx)) {
        saveStatusEl.textContent = '';
        render();
    }
}

function cancelFrameEdit() {
    frameEditor.cancel();
    render();
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
            if (editing || !hasFrame) return; // no toggling mid-edit, or on a frame that doesn't exist yet
            const current = splitFrames[idx] || [];

            if (!isFrame10) {
                const pins = parseRollValue(displayFrame[0]);
                const canSplit = pins > 0 && pins < 10; // not a strike, not a miss/gutter
                if (current.length) {
                    delete splitFrames[idx]; // always allow clearing, even if now invalid
                    render();
                    return;
                }
                if (!canSplit) return;
                splitFrames[idx] = [0];
                render();
                return;
            }

            // Frame 10: cycle none -> roll1 -> roll2 -> roll3 -> roll1+roll3 -> none,
            // skipping states that reference a roll that doesn't exist yet or isn't
            // a legal split target — same rule frames.js uses for the upload editor.
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

// Loads an already-saved game (with pin_history) into the live-entry
// buffer so its rolls can be redone pin-by-pin via the normal tap flow.
// NOTE: this discards any split-marker annotations on the original
// frame_string — pin-rack editing re-derives the frame string purely
// from rollSymbols, same as fresh live entry does.
export function loadGameForEditing(game) {
    const start = () => {
        editingSavedGameId = game.id;
        rollSymbols = stripSplitMarkers(game.frame_string).trim().split(/\s+/).join('').split('');
        pinHistory = (game.pin_history || []).map(pins => [...pins]);
        rackAtRollStart = allPinsStanding();
        standingPins = allPinsStanding();
        gameDone = true;
        frameEditor.reset();
        playerNameInput.value = game.player_name || '';
        saveStatusEl.textContent = '';
        clearLiveGameState(); // this loaded game replaces whatever live-entry state was persisted
        render();
    };

    // Loading a saved game clobbers the module's live-entry buffer, so if
    // there's an in-progress (unsaved) live game sitting in it, confirm first.
    if (editingSavedGameId === null && rollSymbols.length > 0) {
        showConfirmModal('Discard your in-progress live game and edit this one instead?')
            .then(ok => { if (ok) start(); });
    } else {
        start();
    }
}

export function isEditingSavedGame() {
    return editingSavedGameId !== null;
}

function render() {
    const editing = frameEditor.isActive();
    const activeStandingPins = editing ? frameEditor.displayStandingPins() : standingPins;

    renderPinRack(pinRackContainer, activeStandingPins, editing ? handleEditToggle : handleToggle);

    const down = pinsDownCount(activeStandingPins);
    if (editing) {
        readoutEl.textContent = `Editing frame ${frameEditor.activeFrameIndex() + 1} — ${down} pin${down === 1 ? '' : 's'} down this roll`;
    } else {
        readoutEl.textContent = gameDone
            ? 'Game complete'
            : `${down} pin${down === 1 ? '' : 's'} down this roll`;
    }

    renderFrameChips();

    confirmBtn.textContent = editing ? 'Confirm roll (editing)' : 'Confirm Roll';
    confirmBtn.disabled = editing ? false : gameDone;
    resetBtn.style.display = editing ? 'none' : '';
    editCancelBtn.style.display = editing ? '' : 'none';
    saveBtn.disabled = editing || rollSymbols.length === 0;

    persist();
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

editCancelBtn.addEventListener('click', () => {
    cancelFrameEdit();
});

resetBtn.addEventListener('click', () => {
    rollSymbols = [];
    pinHistory = [];
    rackAtRollStart = allPinsStanding();
    standingPins = allPinsStanding();
    gameDone = false;
    frameEditor.reset();
    editingSavedGameId = null;
    splitFrames = {};
    saveStatusEl.textContent = '';
    clearLiveGameState();
    render();
});

strikeBtn.addEventListener('click', handleStrikeAll);

invertBtn.addEventListener('click', handleInvertAll);

// mode.js's own listener on this button switches back to the mode picker;
// this just makes sure we don't leave a stale "editing saved game" buffer
// (with someone else's rolls) sitting around for next time Live is opened.
liveBackBtn.addEventListener('click', () => {
    if (editingSavedGameId === null) return;
    rollSymbols = [];
    pinHistory = [];
    rackAtRollStart = allPinsStanding();
    standingPins = allPinsStanding();
    gameDone = false;
    frameEditor.reset();
    editingSavedGameId = null;
    splitFrames = {};
    playerNameInput.value = '';
    saveStatusEl.textContent = '';
    clearLiveGameState();
    render();
});

saveBtn.addEventListener('click', async () => {
    const validationError = validateGame(rollSymbols);
    if (validationError) {
        saveStatusEl.textContent = validationError;
        return;
    }

    const frameString = parseFrames(rollSymbols)
        .map((f, idx) => annotateFrameWithSplits(f, splitFrames[idx] || []))
        .join(' ');
    const isEdit = editingSavedGameId !== null;
    saveBtn.disabled = true;
    saveStatusEl.textContent = 'Saving…';

    try {
        const url = isEdit ? `${API_BASE}/api/games/${editingSavedGameId}` : `${API_BASE}/api/games`;
        const body = isEdit
            ? {
                frame_string: frameString,
                pin_history: pinHistory,
                player_name: playerNameInput.value || null,
                created_at: null, // unchanged — live pin-edit has no date field of its own
            }
            : {
                image_key: '',
                frame_string: frameString,
                pin_history: pinHistory,
                player_name: playerNameInput.value || null,
                created_at: new Date().toISOString(),
                file_name: null,
            };

        const res = await fetch(url, {
            method: isEdit ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
        });
        if (res.status === 401) { showLoggedOut(); return; }
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Could not save this game.');

        rollSymbols = [];
        pinHistory = [];
        rackAtRollStart = allPinsStanding();
        standingPins = allPinsStanding();
        gameDone = false;
        frameEditor.reset();
        editingSavedGameId = null;
        splitFrames = {};
        playerNameInput.value = '';
        clearLiveGameState();
        saveStatusEl.textContent = 'Saved!';
        setTimeout(() => {
            if (saveStatusEl.textContent === 'Saved!') saveStatusEl.textContent = '';
        }, 3000);
        loadHistory();
        render();
    } catch (err) {
        saveStatusEl.textContent = err.message || 'Could not save this game.';
        saveBtn.disabled = false;
    }
});

render();