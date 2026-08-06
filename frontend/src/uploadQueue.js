// uploadQueue.js

import { API_BASE, resultThumb, playerRowsEl } from './main.js';
import { players, setPlayers, parseAnnotatedFrameString, renderEditableFrames } from './frames.js';
import { resetThumbZoom } from './thumbZoom.js';
import { formatDateTimeInput } from './format.js';
import { loadHistory } from './history.js';
import {
    resetResultPanel, setPendingUpload, setPendingEdit,
    resultEl, saveBtn, discardBtn, deleteBtn, thumbRow, editedDateTimeInput
} from './saveOps.js';

const dropzone = document.getElementById('dropzone');
const statusEl = document.getElementById('status');
const MAX_CONCURRENT_UPLOADS = 1; // only one upload in flight at a time
const CAN_PREVIEW_LOCALLY = /^image\/(jpeg|png|webp)$/i;

export const fileInput = document.getElementById('file-input');
export const thumbFilename = document.getElementById('thumb-filename');

// Each entry: { file, promise, result, error }
// - promise resolves to the parsed /api/upload response (or rejects on failure)
// - result/error get filled in once the promise settles, so showQueueItem()
//   doesn't need to re-await something that already finished
let uploadQueue = [];
let queueIndex = 0;
let queueSuspendedForEdit = false;
let queueRequestToken = 0;
let pendingRetry = null; // { index } - set when the currently-shown queue item failed

// ---- upload concurrency pool ----
// Uploads are launched from a self-refilling pool, not tied to how fast
// the user reviews/saves/discards. The moment a request comes back
// (success or failure), the next unstarted file is launched immediately.
let activeUploadCount = 0;
let nextUploadToLaunch = 0; // index of the next file that hasn't started yet

export { uploadQueue, queueIndex, queueSuspendedForEdit, pendingRetry };

export function setQueueSuspendedForEdit(value) {
    queueSuspendedForEdit = value;
}

export function bumpQueueRequestToken() {
    queueRequestToken++;
}

export function setPendingRetry(value) {
    pendingRetry = value;
}

export function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', isError);
}

export function resetQueueState() {
    uploadQueue = [];
    queueIndex = 0;
    queueSuspendedForEdit = false;
}

function canPreviewLocally(file) {
    return CAN_PREVIEW_LOCALLY.test(file.type);
}

function kickOffUpload(entry) {
    activeUploadCount++;

    const formData = new FormData();
    formData.append('file', entry.file);
    formData.append('auto_crop', document.getElementById('auto-crop-toggle')?.checked ?? true);

    entry.promise = fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
    })
        .then(async (res) => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Upload failed');
            entry.result = data;
            return data;
        })
        .catch((err) => {
            entry.error = err.message || 'Upload failed';
            throw err;
        })
        .finally(() => {
            activeUploadCount--;
            pumpUploadQueue(); // this slot is free — launch the next unstarted file
        });
}

// Keeps up to MAX_CONCURRENT_UPLOADS in flight at all times, launching a
// new file the moment a slot opens up — not tied to save/discard/review speed.
function pumpUploadQueue() {
    while (activeUploadCount < MAX_CONCURRENT_UPLOADS && nextUploadToLaunch < uploadQueue.length) {
        kickOffUpload(uploadQueue[nextUploadToLaunch]);
        nextUploadToLaunch++;
    }
}

export function startUploadQueue(files) {
    const queueActive = uploadQueue.length > 0 && queueIndex < uploadQueue.length;

    if (!queueActive) {
        // No queue running — start fresh, same as before.
        resetResultPanel();
        uploadQueue = files.map(file => ({ file, promise: null, result: null, error: null }));
        queueIndex = 0;
        nextUploadToLaunch = 0;
        activeUploadCount = 0;
        pumpUploadQueue();
        showQueueItem(0);
        return;
    }

    // A queue is already processing — append instead of clobbering it.
    const newEntries = files.map(file => ({ file, promise: null, result: null, error: null }));
    uploadQueue.push(...newEntries);
    pumpUploadQueue(); // picks up the new entries once a slot frees up
    if (!queueSuspendedForEdit) {
        document.getElementById('queue-progress').textContent =
            `Photo ${queueIndex + 1}/${uploadQueue.length}`;
    }
}

// Only browser-natively-previewable formats get a local preview while OCR
// runs. Formats like HEIC/HEIF aren't renderable by <img> directly, so we
// skip straight to no preview rather than attempting a client-side
// conversion — the OCR response's preview_image replaces it once it lands.
function getLocalPreviewUrl(file) {
    return canPreviewLocally(file) ? URL.createObjectURL(file) : null;
}

export async function showQueueItem(index) {
    if (index >= uploadQueue.length) {
        document.getElementById('queue-progress').textContent = '';
        resultEl.classList.remove('visible');
        setStatus('');
        uploadQueue = [];
        queueIndex = 0;
        loadHistory();
        return;
    }

    queueIndex = index;
    const token = ++queueRequestToken;
    const entry = uploadQueue[index];
    document.getElementById('queue-progress').textContent =
        `Photo ${index + 1}/${uploadQueue.length}`;

    setPendingUpload(null);
    setPendingEdit(null);            // resuming the queue always ends any pending edit
    setPendingRetry(null);           // clear any stale retry state from a previous failed item
    setPlayers([]);
    playerRowsEl.innerHTML = '';
    playerRowsEl.classList.remove('hide-checkboxes'); // make sure checkboxes come back for multi-player queue items
    saveBtn.textContent = 'Save game';   // undo "Save changes" label left over from editing
    discardBtn.textContent = 'Discard';  // undo "Cancel" label left over from editing
    deleteBtn.style.display = 'none';    // hide the delete button for edit menu
    if (resultThumb.src && resultThumb.src.startsWith('blob:')) {
        URL.revokeObjectURL(resultThumb.src);
    }
    // Show the user's own photo right away instead of a blank box while OCR runs.
    let localPreviewUrl = null;
    try {
        localPreviewUrl = await getLocalPreviewUrl(entry.file);
    } catch {
        localPreviewUrl = null;
    }
    if (localPreviewUrl) {
        resultThumb.src = localPreviewUrl;
    } else {
        resultThumb.removeAttribute('src');
        thumbRow.style.display = 'none';
    }
    thumbFilename.textContent = entry.file.name;
    resetThumbZoom();
    saveBtn.disabled = true;
    discardBtn.disabled = true;
    resultEl.classList.add('visible');

    setStatus(entry.result || entry.error ? '' : 'Reading scoreboard…');

    try {
        // entry.promise should already be in flight (or settled) thanks to
        // pumpUploadQueue; kick it off directly only as a defensive fallback.
        const data = entry.promise ? await entry.promise : (kickOffUpload(entry), await entry.promise);
        if (token !== queueRequestToken) return; // superseded by a newer call

        setStatus('');
        setPendingUpload({ imageKey: '' });
        setPlayers(data.players.map(p => {
            const parsed = parseAnnotatedFrameString(p.frame_string);
            return {
                name: p.name || '',
                rollSymbols: parsed.rollSymbols,
                pendingCursor: null,
                selected: data.players.length === 1, // checked by default only if theres only one player
                splitFrames: parsed.splitFrames,
            };
        }));
        playerRowsEl.classList.remove('hide-checkboxes');
        editedDateTimeInput.value = formatDateTimeInput(data.capture_date || new Date().toISOString());
        renderEditableFrames();

        if (resultThumb.src && resultThumb.src.startsWith('blob:')) {
            URL.revokeObjectURL(resultThumb.src); // revokes the local preview blob set above
        }
        resultThumb.src = data.preview_image.startsWith('data:')
            ? dataUrlToBlobUrl(data.preview_image)
            : data.preview_image;
        thumbRow.style.display = '';
        resultEl.classList.add('visible');
    } catch {
        if (token !== queueRequestToken) return;
        setStatus(`Could not read photo ${index + 1}: ${entry.error}`, true);
        playerRowsEl.innerHTML = '';
        setPlayers([]);
        setPendingUpload(null);
        setPendingRetry({ index });      // let the user retry this specific queue slot
        saveBtn.textContent = 'Retry';
        resultEl.classList.add('visible');
    } finally {
        if (token === queueRequestToken) {
            saveBtn.disabled = false;
            discardBtn.disabled = false;
        }
    }
}

// Re-sends the failed file to the OCR endpoint by re-queuing it as a
// fresh entry (so it goes through the normal concurrency pool), then
// moves the UI forward to whatever's next, same as Discard would.
// The retried entry will get its own turn in showQueueItem() once the
// queue reaches it.
export function retryCurrentUpload() {
    if (!pendingRetry) return;
    const { index } = pendingRetry;
    const failedEntry = uploadQueue[index];
    setPendingRetry(null);
    if (!failedEntry) return;

    const retryEntry = { file: failedEntry.file, promise: null, result: null, error: null };
    uploadQueue.push(retryEntry);
    pumpUploadQueue(); // launches it once a slot is free, just like any queued upload

    showQueueItem(queueIndex + 1);
}

function dataUrlToBlobUrl(dataUrl) {
    const [header, base64] = dataUrl.split(',');
    const mime = header.match(/data:(.*?);base64/)[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

['dragover', 'dragenter'].forEach(evt =>
    dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add('dragover'); })
);

['dragleave', 'drop'].forEach(evt =>
    dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove('dragover'); })
);

fileInput.addEventListener('change', () => {
    if (fileInput.files.length) startUploadQueue(Array.from(fileInput.files));
});

dropzone.addEventListener('drop', e => {
    const files = Array.from(e.dataTransfer.files);
    if (files.length) startUploadQueue(files);
});