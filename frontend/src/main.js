// main.js

import { resetThumbZoom } from './thumbZoom.js';
import { renderStats, setStatsPanelVisible } from './stats.js';
import { setAuthMode, checkSession } from './auth.js';
import './statsAdvanced.js';
import './mode.js';
import './live.js';
import { loadHighlights } from './highlights.js';
import { Capacitor } from '@capacitor/core';

// CONFIG — constants used everywhere below 
export const API_BASE = Capacitor.isNativePlatform()
    ? "https://bowling-stat-tracker-backend.onrender.com"
    : "";

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

// NAV HEIGHT SYNC — keeps main's padding and the nav background lined up with the nav's real height
function syncNavHeight() {
    const nav = document.getElementById('nav-bar');
    if (!nav) return;
    document.documentElement.style.setProperty('--nav-height', `${nav.offsetHeight}px`);
}

const navEl = document.getElementById('nav-bar');
if (navEl) {
    syncNavHeight(); // measure immediately, no flash of wrong padding
    window.addEventListener('resize', syncNavHeight);
    new ResizeObserver(syncNavHeight).observe(navEl);
}

// SCROLL STATE — toggles solid nav background once the page is scrolled
function syncScrollState() {
    const overlay = document.getElementById('stats-advanced-overlay');
    const overlayScrolled = overlay && overlay.style.display !== 'none' && overlay.scrollTop > 0;
    if (window.scrollY > 0 || overlayScrolled) {
        document.body.classList.add('scrolled');
    } else {
        document.body.classList.remove('scrolled');
    }
}

syncScrollState(); // set correct state on load (e.g. page refreshed mid-scroll)
window.addEventListener('scroll', syncScrollState, { passive: true });

const statsAdvancedOverlayEl = document.getElementById('stats-advanced-overlay');
if (statsAdvancedOverlayEl) {
    statsAdvancedOverlayEl.addEventListener('scroll', syncScrollState, { passive: true });
}

// INIT
setAuthMode('login');
checkSession();
loadHighlights();