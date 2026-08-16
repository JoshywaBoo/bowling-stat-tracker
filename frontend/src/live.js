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
const frameStringEl = document.getElementById('live-frame-string');
const playerNameInput = document.getElementById('live-player-name');
const saveBtn = document.getElementById('live-save-btn');
const saveStatusEl = document.getElementById('live-save-status');

// ---- state ----
// rollSymbols mirrors the same format frames.js/parseFrames expects
// elsewhere in the app (e.g. what gets typed into the frame-input boxes).
// rackAtRollStart is a snapshot of which pins were standing when the
// CURRENT (in-progress) roll began — used to work out how many pins
// were knocked down by this roll specifically.
const saved = loadLiveGameState();
let rollSymbols = saved?.rollSymbols ?? [];
let rackAtRollStart = saved?.rackAtRollStart ?? allPinsStanding();
let standingPins = saved?.standingPins ?? allPinsStanding();
let gameDone = false;

function persist() {
    saveLiveGameState({ rollSymbols, rackAtRollStart, standingPins });
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

function render() {
    renderPinRack(pinRackContainer, standingPins, handleToggle);
    const down = pinsDownCount(standingPins);
    readoutEl.textContent = gameDone
        ? 'Game complete'
        : `${down} pin${down === 1 ? '' : 's'} down this roll`;

    frameStringEl.innerHTML = frameStringToHtml(parseFrames(rollSymbols).join(' '));

    confirmBtn.disabled = gameDone;
    saveBtn.disabled = rollSymbols.length === 0;

    persist();
}

function handleToggle(pinNumber) {
    if (gameDone) return;
    standingPins[pinNumber - 1] = !standingPins[pinNumber - 1];
    render();
}

confirmBtn.addEventListener('click', () => {
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

    const { gameDone: done, nextRack } = advanceAfterRoll(symbol);
    gameDone = done;
    rackAtRollStart = nextRack;
    standingPins = [...nextRack];

    render();
});

resetBtn.addEventListener('click', () => {
    rollSymbols = [];
    rackAtRollStart = allPinsStanding();
    standingPins = allPinsStanding();
    gameDone = false;
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
                player_name: playerNameInput.value || null,
                created_at: new Date().toISOString(),
                file_name: null,
            }),
        });
        if (res.status === 401) { showLoggedOut(); return; }
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Could not save this game.');

        rollSymbols = [];
        rackAtRollStart = allPinsStanding();
        standingPins = allPinsStanding();
        gameDone = false;
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