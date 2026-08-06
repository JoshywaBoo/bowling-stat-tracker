// main.js

import { resetThumbZoom } from './thumbZoom.js';
import { renderStats, setStatsPanelVisible } from './stats.js';
import { setAuthMode, checkSession } from './auth.js';

// CONFIG — constants used everywhere below 
export const API_BASE = "";

const navAccountEl = document.querySelector('.nav-account'); // currently unreferenced elsewhere, kept for parity

export const appContent = document.getElementById('app-content');
const historyList = document.getElementById('history-list');

const confirmModalOverlay = document.getElementById('confirm-modal-overlay');
const confirmModalMessage = document.getElementById('confirm-modal-message');
const confirmModalOk = document.getElementById('confirm-modal-ok');
const confirmModalCancel = document.getElementById('confirm-modal-cancel');

export const playerRowsEl = document.getElementById('player-rows');
export const resultThumb = document.getElementById('result-thumb');

export function showConfirmModal(message) {
    return new Promise((resolve) => {
        confirmModalMessage.textContent = message;
        confirmModalOverlay.style.display = 'flex';

        function cleanup(result) {
            confirmModalOverlay.style.display = 'none';
            confirmModalOk.removeEventListener('click', onOk);
            confirmModalCancel.removeEventListener('click', onCancel);
            confirmModalOverlay.removeEventListener('click', onOverlay);
            resolve(result);
        }
        function onOk() { cleanup(true); }
        function onCancel() { cleanup(false); }
        function onOverlay(e) { if (e.target === confirmModalOverlay) cleanup(false); }

        confirmModalOk.addEventListener('click', onOk);
        confirmModalCancel.addEventListener('click', onCancel);
        confirmModalOverlay.addEventListener('click', onOverlay);
    });
}

// INIT
setAuthMode('login');
checkSession();