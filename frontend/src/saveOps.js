// saveOps.js

import {
    players, setPlayers, parseFrames, parseAnnotatedFrameString,
    annotateFrameWithSplits, validateGame, renderEditableFrames
} from './frames.js';
import { formatDateTimeInput } from './format.js';
import { resetThumbZoom } from './thumbZoom.js';
import { API_BASE, resultThumb, playerRowsEl } from './main.js';
import { showLoggedOut } from './auth.js';
import { loadHistory } from './history.js';
import {
    uploadQueue, queueIndex, queueSuspendedForEdit, setQueueSuspendedForEdit,
    showQueueItem, pendingRetry, retryCurrentUpload, fileInput, thumbFilename,
    bumpQueueRequestToken, setStatus
} from './uploadQueue.js';

const saveError = document.getElementById('save-error');

export const resultEl = document.getElementById('result');
export const saveBtn = document.getElementById('save-btn');
export const discardBtn = document.getElementById('discard-btn');
export const deleteBtn = document.getElementById('delete-btn');
export const editedDateTimeInput = document.getElementById('edited-datetime');
export const thumbRow = document.querySelector('.thumb-row');

let pendingUpload = null;
let pendingEdit = null; // { gameId }

export function setPendingUpload(value) {
    pendingUpload = value;
}

export function setPendingEdit(value) {
    pendingEdit = value;
}

let saveOpQueue = [];
let saveOpRunning = false;

export function resetResultPanel() {
    bumpQueueRequestToken();
    saveBtn.disabled = false;
    discardBtn.disabled = false;
    setPendingUpload(null);
    setPendingEdit(null);
    setPlayers([]);
    playerRowsEl.innerHTML = '';
    playerRowsEl.classList.remove('hide-checkboxes');
    resultEl.classList.remove('visible');
    saveError.textContent = '';
    fileInput.value = '';
    editedDateTimeInput.value = formatDateTimeInput(new Date().toISOString());
    saveBtn.textContent = 'Save game';
    discardBtn.textContent = 'Discard';
    deleteBtn.style.display = 'none';
    thumbRow.style.display = '';
    if (resultThumb.src && resultThumb.src.startsWith('blob:')) {
        URL.revokeObjectURL(resultThumb.src);
    }
    resultThumb.removeAttribute('src');
    thumbFilename.textContent = '';
    resetThumbZoom();
}

function collectFrameStringFor(player) {
    if (!player.rollSymbols.length) return null;
    const frames = parseFrames(player.rollSymbols);
    const splitFrames = player.splitFrames || {};
    return frames.map((f, idx) => annotateFrameWithSplits(f, splitFrames[idx] || [])).join(' ');
}

function enqueueSaveOp(run) {
    saveOpQueue.push(run);
    pumpSaveOpQueue();
}

async function pumpSaveOpQueue() {
    if (saveOpRunning) return;
    saveOpRunning = true;
    while (saveOpQueue.length) {
        const run = saveOpQueue.shift();
        try {
            await run();
        } catch (err) {
            console.error('Background save failed:', err);
            setStatus(err?.message || 'Could not save a game in the background.', true);
        }
    }
    saveOpRunning = false;
}

export function openGameForEditing(game) {
    const suspendQueue = uploadQueue.length > 0 && queueIndex < uploadQueue.length;
    resetResultPanel();
    setQueueSuspendedForEdit(suspendQueue);
    setPendingEdit({ gameId: game.id });
    const parsed = parseAnnotatedFrameString(game.frame_string);
    setPlayers([{
        name: game.player_name || '',
        rollSymbols: parsed.rollSymbols,
        pendingCursor: null,
        selected: true,
        splitFrames: parsed.splitFrames,
    }]);
    playerRowsEl.classList.add('hide-checkboxes');
    editedDateTimeInput.value = formatDateTimeInput(game.created_at);
    renderEditableFrames();
    resultThumb.removeAttribute('src');
    thumbFilename.textContent = '';
    thumbRow.style.display = 'none';
    resultEl.classList.add('visible');
    saveBtn.textContent = 'Save changes';
    discardBtn.textContent = 'Cancel';
    deleteBtn.style.display = '';
    setStatus('');
    document.getElementById('queue-progress').textContent = 'Editing a past game';
}

export async function deleteGameById(gameId) {
    try {
        const res = await fetch(`${API_BASE}/api/games/${gameId}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        if (res.status === 401) { showLoggedOut(); return; }
        if (!res.ok) {
            setStatus('Could not delete that game.', true);
            return;
        }
        // If this game happened to be open in the edit panel, close it too.
        if (pendingEdit && pendingEdit.gameId === gameId) {
            if (queueSuspendedForEdit) {
                setQueueSuspendedForEdit(false);
                showQueueItem(queueIndex);
            } else {
                resetResultPanel();
            }
        }
        await loadHistory();
    } catch {
        setStatus('Could not delete that game.', true);
    }
}

saveBtn.addEventListener('click', () => {
    if (saveBtn.disabled) return; // ignore rapid double-clicks/taps

    if (pendingRetry) {
        retryCurrentUpload();
        return;
    }

    if (!pendingUpload && !pendingEdit) return;
    saveError.textContent = '';

    if (pendingEdit) {
        const player = players[0];
        const frameString = collectFrameStringFor(player);
        if (frameString === null) {
            saveError.textContent = 'Add at least one roll before saving.';
            return;
        }
        const validationError = validateGame(player.rollSymbols);
        if (validationError) {
            saveError.textContent = validationError;
            return;
        }

        saveBtn.disabled = true;
        discardBtn.disabled = true;

        const gameId = pendingEdit.gameId;
        const playerName = player.name || null;
        const createdAtValue = editedDateTimeInput.value
            ? new Date(editedDateTimeInput.value).toISOString()
            : null;
        const wasQueueSuspended = queueSuspendedForEdit;

        if (wasQueueSuspended) {
            setQueueSuspendedForEdit(false);
            showQueueItem(queueIndex); // re-enables the buttons once it renders
        } else {
            resetResultPanel(); // also re-enables the buttons
        }

        enqueueSaveOp(async () => {
            const res = await fetch(`${API_BASE}/api/games/${gameId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ frame_string: frameString, player_name: playerName, created_at: createdAtValue }),
            });
            if (res.status === 401) { showLoggedOut(); return; }
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Could not save this game.');
            loadHistory();
        });
        return;
    }

    const selectedPlayers = players.filter(p => p.selected);

    for (const player of selectedPlayers) {
        const frameString = collectFrameStringFor(player);
        if (frameString === null) {
            saveError.textContent = `${player.name || 'A player'}: add at least one roll before saving.`;
            return;
        }
        const validationError = validateGame(player.rollSymbols);
        if (validationError) {
            saveError.textContent = `${player.name || 'A player'}: ${validationError}`;
            return;
        }
    }

    saveBtn.disabled = true;
    discardBtn.disabled = true;

    const imageKey = pendingUpload.imageKey;
    const createdAtValue = editedDateTimeInput.value ? new Date(editedDateTimeInput.value).toISOString() : null;
    const currentFileName = uploadQueue[queueIndex]?.file?.name || null;
    const payloads = selectedPlayers.map(player => ({
        image_key: imageKey,
        frame_string: collectFrameStringFor(player),
        player_name: player.name || null,
        created_at: createdAtValue,
        file_name: currentFileName,
    }));

    if (uploadQueue.length) {
        showQueueItem(queueIndex + 1); // re-enables the buttons once it renders
    } else {
        resetResultPanel(); // also re-enables the buttons
    }

    enqueueSaveOp(async () => {
        for (const payload of payloads) {
            const res = await fetch(`${API_BASE}/api/games`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload),
            });
            if (res.status === 401) { showLoggedOut(); return; }
            const data = await res.json();
            if (!res.ok) throw new Error(`${payload.player_name || 'A player'}: ${data.detail || 'Could not save.'}`);
        }
        loadHistory();
    });
});

discardBtn.addEventListener('click', () => {
    if (discardBtn.disabled) return; // ignore rapid double-clicks/taps
    saveBtn.disabled = true;
    discardBtn.disabled = true;

    if (pendingEdit) {
        if (queueSuspendedForEdit) {
            setQueueSuspendedForEdit(false);
            showQueueItem(queueIndex);
        } else {
            resetResultPanel();
        }
        return;
    }
    if (uploadQueue.length) {
        showQueueItem(queueIndex + 1);
    } else {
        resetResultPanel();
    }
});

deleteBtn.addEventListener('click', async () => {
    if (deleteBtn.disabled || !pendingEdit) return;

    const gameId = pendingEdit.gameId;
    deleteBtn.disabled = true;
    saveBtn.disabled = true;
    discardBtn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/api/games/${gameId}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        if (res.status === 401) { showLoggedOut(); return; }
        if (!res.ok) {
            setStatus('Could not delete that game.', true);
            return;
        }

        if (queueSuspendedForEdit) {
            setQueueSuspendedForEdit(false);
            showQueueItem(queueIndex);
        } else {
            resetResultPanel();
        }
        await loadHistory();
    } catch {
        setStatus('Could not delete that game.', true);
    } finally {
        deleteBtn.disabled = false;
    }
});