// live.js
import { renderPinRack, allPinsStanding, pinsDownCount } from './pinRack.js';
import { saveLiveGameState, loadLiveGameState, clearLiveGameState } from './liveStorage.js';
import { parseFrames, validateGame, frameStringToHtml } from './frames.js';
import { API_BASE } from './main.js';
import { loadHistory } from './history.js';
import { showLoggedOut } from './auth.js';

const pinRackContainer = document.getElementById('pin-rack');
const readoutEl = document.getElementById('pin-rack-readout');
const resetBtn = document.getElementById('pin-rack-reset-btn');
const confirmBtn = document.getElementById('pin-rack-confirm-btn');
const editCancelBtn = document.getElementById('pin-rack-edit-cancel-btn');
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

// ---- frame-edit state ----
// Editing replays ONE already-recorded frame from scratch using the same
// tap-pins-then-confirm flow as live entry, in an isolated buffer, then
// splices the result back into rollSymbols at that frame's original
// position. Because frames are re-derived positionally from the flat
// rollSymbols array (see parseFrames), this is safe even if the edited
// frame's roll count changes — everything after it just re-flows, same
// as editing the raw roll boxes on the OCR review screen does.
let editingFrameIndex = null;   // null = not editing, otherwise 0-based frame index
let editStartOffset = 0;        // where this frame's symbols start in rollSymbols
let editOriginalLength = 0;     // how many symbols this frame currently occupies
let editIsFrame10 = false;
let editRollSymbols = [];
let editPinHistory = [];        // mirrors editRollSymbols
let editRackAtRollStart = allPinsStanding();
let editStandingPins = allPinsStanding();

function persist() {
    saveLiveGameState({ rollSymbols, pinHistory, rackAtRollStart, standingPins });
}

// Returns the 1-based pin numbers knocked down between two standing-pin
// snapshots (pins that were up in `before` and are down in `after`).
function knockedPinNumbers(before, after) {
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
function isFirstRollOfFrame(symbolsSoFar) {
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

// Reconstructs which pins are standing after replaying `symbols` (a
// prefix of a single frame's rolls) in order. The app only ever stores
// how many pins a roll knocked down, not which ones, so this picks a
// deterministic order (lowest pin number first) each time — it's a
// stand-in for "the pins that are actually left," not a memory of the
// exact original layout.
function pinsStandingAfter(symbols) {
    let standing = allPinsStanding();
    symbols.forEach((sym) => {
        const upper = sym.toUpperCase();
        if (upper === 'X' || upper === '/') {
            standing = allPinsStanding(); // strike or spare clears the rack
            return;
        }
        let knocked = (upper === '-' || upper === 'F') ? 0 : (Number(upper) || 0);
        standing = standing.map((isUp) => {
            if (isUp && knocked > 0) {
                knocked--;
                return false;
            }
            return isUp;
        });
    });
    return standing;
}

// Frame 10 needs 3 rolls if the frame opened with a strike, or if the
// first two rolls made a spare — otherwise it's done after 2.
function isFrame10Complete(chars) {
    if (chars.length < 2) return false;
    if (chars.length === 2) {
        if (chars[0].toUpperCase() === 'X') return false; // strike — bonus roll(s) still due
        if (chars[1] === '/') return false;                // spare — bonus roll still due
        return true;                                        // open frame, done after 2
    }
    return true; // 3 rolls is always the max/complete
}

// Works out, after the roll just recorded, whether the frame just
// finished, whether the whole game just finished, and what rack the
// NEXT roll should start from.
function advanceAfterRoll(justPlayedSymbol) {
    const frames = parseFrames(rollSymbols);
    const frameIdx = frames.length - 1;
    const chunk = frames[frameIdx];
    const isFrame10 = frameIdx === 9;

    if (!isFrame10) {
        if (chunk === 'X' || chunk.length === 2) {
            return { frameDone: true, gameDone: false, nextRack: allPinsStanding() };
        }
        return { frameDone: false, gameDone: false, nextRack: standingPins };
    }

    const chars = chunk.split('');
    if (isFrame10Complete(chars)) {
        return { frameDone: true, gameDone: true, nextRack: allPinsStanding() };
    }
    // Not done yet — a strike or spare just played means the rack resets
    // for the bonus roll; otherwise the remaining standing pins carry over.
    const justCleared = justPlayedSymbol === 'X' || justPlayedSymbol === '/';
    return { frameDone: false, gameDone: false, nextRack: justCleared ? allPinsStanding() : standingPins };
}

// ------------------------------------------------------------ edit helpers
// These are deliberately NOT shared with isFirstRollOfFrame/advanceAfterRoll
// above: those two infer "is this frame 10?" from parseFrames(rollSymbols)'s
// position in the whole game, which only works when the buffer IS the
// whole game so far. editRollSymbols is an isolated single-frame buffer, so
// it needs its own small, explicit versions instead.

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

// Offsets (in the flat rollSymbols array) where each currently-recorded
// frame starts — needed so we know exactly what range to splice out when
// an edit is committed.
function frameStartOffsets(symbols) {
    const frames = parseFrames(symbols);
    const offsets = [];
    let cum = 0;
    frames.forEach(f => {
        offsets.push(cum);
        cum += f.length;
    });
    return offsets;
}

function startFrameEdit(frameIdx) {
    if (editingFrameIndex !== null) return;

    const frames = parseFrames(rollSymbols);
    if (frameIdx < 0 || frameIdx >= frames.length) return;

    const frameChars = frames[frameIdx].split('');

    const offsets = frameStartOffsets(rollSymbols);
    editingFrameIndex = frameIdx;
    editStartOffset = offsets[frameIdx];
    editOriginalLength = frames[frameIdx].length;
    editIsFrame10 = frameIdx === 9;

    // Editing always begins at roll 0 of the frame (editRollSymbols stays
    // empty until Confirm is pressed), but the pin display is pre-filled
    // with what the first roll actually knocked down. That way, if the
    // user only wants to redo roll 2, they can hit Confirm once to replay
    // roll 1 unchanged instead of re-tapping every pin.
    editRollSymbols = [];
    editPinHistory = [];
    editRackAtRollStart = allPinsStanding();
    editStandingPins = frameChars.length
        ? pinsStandingAfter([frameChars[0]])
        : [...editRackAtRollStart];

    saveStatusEl.textContent = '';
    render();
}

function cancelFrameEdit() {
    editingFrameIndex = null;
    editRollSymbols = [];
    editPinHistory = [];
    render();
}

function confirmEditRoll() {
    const pinsAvailable = editRackAtRollStart.filter(Boolean).length;
    const knockedThisRoll = editRackAtRollStart.filter((wasStanding, i) => wasStanding && !editStandingPins[i]).length;
    const frameStart = editFrameStart();

    let symbol;
    if (knockedThisRoll === pinsAvailable) {
        symbol = frameStart ? 'X' : '/';
    } else {
        symbol = knockedThisRoll === 0 ? '-' : String(knockedThisRoll);
    }

    editRollSymbols.push(symbol);
    editPinHistory.push(knockedPinNumbers(editRackAtRollStart, editStandingPins));

    if (editFrameDone()) {
        // Commit: replace exactly the symbols this frame used to occupy.
        // Everything before and after re-flows/re-groups naturally the
        // next time parseFrames runs over the updated rollSymbols.
        rollSymbols.splice(editStartOffset, editOriginalLength, ...editRollSymbols);
        pinHistory.splice(editStartOffset, editOriginalLength, ...editPinHistory);
        editingFrameIndex = null;
        editRollSymbols = [];
        editPinHistory = [];
        recomputeStateAfterEdit();
    } else {
        const justCleared = symbol === 'X' || symbol === '/';
        const nextRack = (!editIsFrame10 || !justCleared)
            ? [...editStandingPins]
            : allPinsStanding();
        editRackAtRollStart = nextRack;
        editStandingPins = [...nextRack];
    }

    render();
}

// An edit only ever commits once its frame is fully complete, so after
// committing we're always sitting exactly at a frame boundary — the next
// roll (if any) always starts from a fresh rack.
function recomputeStateAfterEdit() {
    const frames = parseFrames(rollSymbols);
    if (frames.length >= 10) {
        gameDone = isFrame10Complete(frames[9].split(''));
    } else {
        gameDone = false;
    }
    rackAtRollStart = allPinsStanding();
    standingPins = allPinsStanding();
}

// ------------------------------------------------------------------ render

function renderFrameChips() {
    const frames = parseFrames(rollSymbols);
    const editing = editingFrameIndex !== null;

    frameStringEl.innerHTML = '';

    for (let idx = 0; idx < 10; idx++) {
        const hasFrame = idx < frames.length;
        const isEditingThis = idx === editingFrameIndex;
        const displayFrame = isEditingThis
            ? editRollSymbols.join('')
            : (hasFrame ? frames[idx] : '');

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'frame-chip'
            + (isEditingThis ? ' frame-chip-editing' : '')
            + (hasFrame ? '' : ' frame-chip-empty');
        chip.innerHTML = displayFrame ? frameStringToHtml(displayFrame) : '&nbsp;';

        // Only frames that actually exist yet are editable, and only
        // when nothing else is currently being edited. Empty frames
        // still render (and hover) like real chips, they just don't
        // do anything on click.
        if (!editing && hasFrame) {
            chip.title = 'Tap to fix this frame';
            chip.addEventListener('click', () => startFrameEdit(idx));
        }

        frameStringEl.appendChild(chip);
    }
}

function render() {
    const editing = editingFrameIndex !== null;
    const activeStandingPins = editing ? editStandingPins : standingPins;

    renderPinRack(pinRackContainer, activeStandingPins, editing ? handleEditToggle : handleToggle);

    const down = pinsDownCount(activeStandingPins);
    if (editing) {
        readoutEl.textContent = `Editing frame ${editingFrameIndex + 1} — ${down} pin${down === 1 ? '' : 's'} down this roll`;
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
    editStandingPins[pinNumber - 1] = !editStandingPins[pinNumber - 1];
    render();
}

confirmBtn.addEventListener('click', () => {
    if (editingFrameIndex !== null) {
        confirmEditRoll();
        return;
    }

    if (gameDone) return;

    const pinsAvailable = rackAtRollStart.filter(Boolean).length;
    const knockedThisRoll = rackAtRollStart.filter((wasStanding, i) => wasStanding && !standingPins[i]).length;
    const frameStart = isFirstRollOfFrame(rollSymbols); // ← computed BEFORE pushing this roll

    let symbol;
    if (knockedThisRoll === pinsAvailable) {
        symbol = frameStart ? 'X' : '/';
    } else {
        symbol = knockedThisRoll === 0 ? '-' : String(knockedThisRoll);
    }

    rollSymbols.push(symbol);
    pinHistory.push(knockedPinNumbers(rackAtRollStart, standingPins));

    const { gameDone: done, nextRack } = advanceAfterRoll(symbol);
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
    editingFrameIndex = null;
    editRollSymbols = [];
    editPinHistory = [];
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

    const frameString = parseFrames(rollSymbols).join(' ');
    saveBtn.disabled = true;
    saveStatusEl.textContent = 'Saving…';

    try {
        const res = await fetch(`${API_BASE}/api/games`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                image_key: '',
                frame_string: frameString,
                pin_history: pinHistory,
                player_name: playerNameInput.value || null,
                created_at: new Date().toISOString(),
                file_name: null,
            }),
        });
        if (res.status === 401) { showLoggedOut(); return; }
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Could not save this game.');

        rollSymbols = [];
        pinHistory = [];
        rackAtRollStart = allPinsStanding();
        standingPins = allPinsStanding();
        gameDone = false;
        editingFrameIndex = null;
        editRollSymbols = [];
        editPinHistory = [];
        playerNameInput.value = '';
        clearLiveGameState();
        saveStatusEl.textContent = 'Saved!';
        loadHistory();
        render();
    } catch (err) {
        saveStatusEl.textContent = err.message || 'Could not save this game.';
        saveBtn.disabled = false;
    }
});

render();