// editGameModal.js
// Standalone modal for editing an already-saved PHOTO-sourced game (no
// pin_history) via typed frame-input boxes. Fully self-contained (own DOM,
// own state) — completely independent of the upload queue's #result /
// players array, so editing a past game never touches or pauses whatever
// photo review might be in progress. Mirrors historyPinEditor.js's
// independence from live.js.

import {
    parseFrames, parseAnnotatedFrameString, annotateFrameWithSplits,
    validateGame, buildFrameOverlayHtml, frame10ValidMarkIndices,
    parseRollValue, sanitizeText, ALLOWED_SYMBOLS,
} from './frames.js';
import { formatDateTimeInput } from './format.js';
import { API_BASE } from './main.js';
import { showLoggedOut } from './auth.js';
import { loadHistory } from './history.js';

const overlay = document.getElementById('edit-game-modal-overlay');
const closeBtn = document.getElementById('edit-game-close-btn');
const datetimeInput = document.getElementById('edit-game-datetime');
const playerNameInput = document.getElementById('edit-game-player-name');
const framesEl = document.getElementById('edit-game-frames');
const saveBtn = document.getElementById('edit-game-save-btn');
const discardBtn = document.getElementById('edit-game-discard-btn');
const errorEl = document.getElementById('edit-game-error');

let gameId = null;
let rollSymbols = [];
let splitFrames = {};
let pendingCursor = null;

export function openEditGameModal(game) {
    gameId = game.id;
    const parsed = parseAnnotatedFrameString(game.frame_string);
    rollSymbols = parsed.rollSymbols;
    splitFrames = parsed.splitFrames;
    pendingCursor = null;
    playerNameInput.value = game.player_name || '';
    datetimeInput.value = formatDateTimeInput(game.created_at);
    errorEl.textContent = '';
    saveBtn.disabled = false;
    discardBtn.disabled = false;
    overlay.style.display = 'flex';
    render();
}

function closeModal() {
    overlay.style.display = 'none';
    gameId = null;
    rollSymbols = [];
    splitFrames = {};
    pendingCursor = null;
}

function render() {
    framesEl.innerHTML = '';
    const frames = parseFrames(rollSymbols);
    const displayFrames = frames.length ? frames : [''];

    let offset = 0;
    const inputs = [];

    displayFrames.forEach((f, idx) => {
        const cell = document.createElement('div');
        cell.className = 'frame-cell';

        const isFrame10 = idx === 9;
        const markedIndices = splitFrames[idx] || [];

        const n = document.createElement('span');
        n.className = 'frame-n' + (markedIndices.length ? ' split-marked' : '');
        n.textContent = idx + 1;
        n.title = isFrame10
            ? 'Click to cycle: none → 1st roll → 2nd roll → 3rd roll → 1st + 3rd roll'
            : 'Click to toggle split';
        n.addEventListener('click', (e) => {
            e.stopPropagation();
            const current = splitFrames[idx] || [];

            if (!isFrame10) {
                const pins = parseRollValue(f[0]);
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

            const validIdx = new Set(frame10ValidMarkIndices(f.split('')));
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

        const inputWrap = document.createElement('div');
        inputWrap.className = 'frame-input-wrap';

        const input = document.createElement('input');
        input.type = 'text';
        // 'frame-input' reuses the shared visual styling from frames.css;
        // 'edit-game-input' is the marker frames.js's global keydown
        // listener excludes, so the two editors never collide.
        input.className = 'frame-input has-overlay edit-game-input';
        input.value = f;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.dataset.start = offset;
        input.dataset.len = f.length;

        input.addEventListener('input', () => {
            const start = parseInt(input.dataset.start, 10);
            const len = parseInt(input.dataset.len, 10);
            const clean = sanitizeText(input.value);
            rollSymbols.splice(start, len, ...clean.split(''));
            pendingCursor = { global: start + clean.length };
            render();
        });

        inputWrap.appendChild(input);

        const overlaySpan = document.createElement('div');
        overlaySpan.className = 'frame-overlay';
        overlaySpan.innerHTML = buildFrameOverlayHtml(f, markedIndices);
        inputWrap.appendChild(overlaySpan);

        offset += f.length;
        cell.appendChild(n);
        cell.appendChild(inputWrap);
        framesEl.appendChild(cell);
        inputs.push(input);
    });

    restoreCursor(inputs);
}

function restoreCursor(inputs) {
    if (!pendingCursor || !inputs.length) return;
    let cum = 0;
    let target = inputs[inputs.length - 1];
    let localPos = target.value.length;

    for (const input of inputs) {
        const len = input.value.length;
        if (pendingCursor.global <= cum + len) {
            target = input;
            localPos = pendingCursor.global - cum;
            break;
        }
        cum += len;
    }

    target.focus();
    target.setSelectionRange(localPos, localPos);
}

function globalSelection(input) {
    const base = parseInt(input.dataset.start, 10);
    return [base + input.selectionStart, base + input.selectionEnd];
}

document.addEventListener('keydown', (e) => {
    const input = e.target;
    if (!input.classList.contains('edit-game-input')) return;

    const [gStart, gEnd] = globalSelection(input);

    if (e.key === 'Backspace') {
        e.preventDefault();
        if (gStart !== gEnd) {
            rollSymbols.splice(gStart, gEnd - gStart);
            pendingCursor = { global: gStart };
        } else if (gStart > 0) {
            rollSymbols.splice(gStart - 1, 1);
            pendingCursor = { global: gStart - 1 };
        } else {
            return;
        }
        render();
        return;
    }

    if (e.key === 'Delete') {
        e.preventDefault();
        if (gStart !== gEnd) {
            rollSymbols.splice(gStart, gEnd - gStart);
            pendingCursor = { global: gStart };
        } else if (gStart < rollSymbols.length) {
            rollSymbols.splice(gStart, 1);
            pendingCursor = { global: gStart };
        } else {
            return;
        }
        render();
        return;
    }

    if (e.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0) {
        const rowInputs = Array.from(framesEl.querySelectorAll('.edit-game-input'));
        const idx = rowInputs.indexOf(input) - 1;
        if (idx >= 0) {
            e.preventDefault();
            rowInputs[idx].focus();
            const end = rowInputs[idx].value.length;
            rowInputs[idx].setSelectionRange(end, end);
        }
        return;
    }
    if (e.key === 'ArrowRight' && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
        const rowInputs = Array.from(framesEl.querySelectorAll('.edit-game-input'));
        const idx = rowInputs.indexOf(input) + 1;
        if (idx < rowInputs.length) {
            e.preventDefault();
            rowInputs[idx].focus();
            rowInputs[idx].setSelectionRange(0, 0);
        }
        return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const upper = e.key.toUpperCase();
        if (!ALLOWED_SYMBOLS.test(upper)) {
            e.preventDefault();
            return;
        }
        e.preventDefault();
        rollSymbols.splice(gStart, gEnd - gStart, upper);
        pendingCursor = { global: gStart + 1 };
        render();
    }
});

saveBtn.addEventListener('click', async () => {
    if (!rollSymbols.length) {
        errorEl.textContent = 'Add at least one roll before saving.';
        return;
    }
    const validationError = validateGame(rollSymbols);
    if (validationError) {
        errorEl.textContent = validationError;
        return;
    }

    const frameString = parseFrames(rollSymbols)
        .map((f, idx) => annotateFrameWithSplits(f, splitFrames[idx] || []))
        .join(' ');
    const playerName = playerNameInput.value || null;
    const createdAtValue = datetimeInput.value ? new Date(datetimeInput.value).toISOString() : null;
    const editedGameId = gameId;

    saveBtn.disabled = true;
    discardBtn.disabled = true;
    errorEl.textContent = '';

    try {
        const res = await fetch(`${API_BASE}/api/games/${editedGameId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ frame_string: frameString, player_name: playerName, created_at: createdAtValue }),
        });
        if (res.status === 401) { showLoggedOut(); return; }
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Could not save this game.');

        closeModal();
        loadHistory();
    } catch (err) {
        errorEl.textContent = err.message || 'Could not save this game.';
        saveBtn.disabled = false;
        discardBtn.disabled = false;
    }
});

discardBtn.addEventListener('click', closeModal);
closeBtn.addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
});