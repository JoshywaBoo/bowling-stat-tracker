//history.js

import { API_BASE, showConfirmModal } from './main.js';
import { historySearch, currentView } from './nav.js';
import { showLoggedOut } from './auth.js';
import { stripSplitMarkers, isCleanGame, frameStringToHtml, calculateBowlingScore, parseAnnotatedFrameString } from './frames.js';
import { renderStats } from './stats.js';
import { formatTime, formatDateTimeInput } from './format.js';
import { openGameForEditing, deleteGameById } from './saveOps.js';
import { playerDetailView, currentPlayerGames, renderPlayerHistory, selectedPlayerUsername } from './players.js';

const historyList = document.getElementById('history-list');
const historyItemDropdown = document.getElementById('history-item-dropdown');
const historyDropdownEdit = document.getElementById('history-dropdown-edit');
const historyDropdownDelete = document.getElementById('history-dropdown-delete');

let allGames = [];
let activeHistoryMenuGameId = null;

export function renderHistory(games) {
    historyList.innerHTML = '';
    if (!games.length) {
        historyList.innerHTML = '<p class="empty-history">No games uploaded yet.</p>';
        return;
    }
    games.forEach(g => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.dataset.gameId = g.id;
        const cleanScore = calculateBowlingScore(stripSplitMarkers(g.frame_string));
        item.innerHTML = `
        <div class="history-main">
        <span class="frame-string">${frameStringToHtml(g.frame_string)}</span>
        <span class="history-score">${cleanScore}</span>
        </div>
        <div class="history-item-actions">
        <time>${formatTime(g.created_at)}</time>
        <button type="button" class="btn-menu-dots" data-game-id="${g.id}" aria-label="Game options">&#8942;</button>
        </div>
        `;
        historyList.appendChild(item);
    });
}

function closeHistoryMenu() {
    historyItemDropdown.style.display = 'none';
    activeHistoryMenuGameId = null;
}

function openHistoryMenu(dotsBtn, gameId) {
    const wasOpenForThis = activeHistoryMenuGameId === gameId && historyItemDropdown.style.display !== 'none';
    closeHistoryMenu();
    if (wasOpenForThis) return; // clicking the same dots again just closes it

    const rect = dotsBtn.getBoundingClientRect();
    const dropdownWidth = 130; // matches the CSS min-width
    const horizontalOffset = 20;
    const verticalOffset = 13;

    const opensRight = rect.right + horizontalOffset + dropdownWidth <= window.innerWidth;

    historyItemDropdown.style.top = `${rect.top - verticalOffset}px`;
    if (opensRight) {
        historyItemDropdown.style.left = `${rect.right + horizontalOffset}px`;
        historyItemDropdown.style.right = 'auto';
    } else {
        historyItemDropdown.style.left = 'auto';
        historyItemDropdown.style.right = `${window.innerWidth - rect.left + horizontalOffset}px`;
    }
    historyItemDropdown.style.display = 'block';
    activeHistoryMenuGameId = gameId;
}

export async function loadHistory() {
    try {
        const res = await fetch(`${API_BASE}/api/games`, { credentials: 'include' });
        if (res.status === 401) { showLoggedOut(); return; }
        allGames = await res.json();
        applyHistoryFilter();
    } catch {
        historyList.innerHTML = '<p class="empty-history">Could not load history.</p>';
    }
}

export function applyHistoryFilter() {
    const rawQuery = historySearch.value.trim().toLowerCase();

    const viewingPlayer = currentView === 'players'
        && playerDetailView.style.display !== 'none'
        && currentPlayerGames !== null;
    const sourceGames = viewingPlayer ? currentPlayerGames : allGames;

    let filtered;
    if (!rawQuery) {
        filtered = sourceGames;
    } else if (rawQuery === 'clean') {
        filtered = sourceGames.filter(g => isCleanGame(g.frame_string));
    } else {
        const q = rawQuery.replace(/\s+/g, '');
        filtered = sourceGames.filter(g =>
            g.frame_string.toLowerCase().replace(/\s+/g, '').includes(q)
        );
    }

    if (viewingPlayer) {
        renderPlayerHistory(filtered);
        renderStats(filtered, `${selectedPlayerUsername}'s stats`);
    } else {
        renderHistory(filtered);
        renderStats(filtered, 'Your stats');
    }
}

historyList.addEventListener('click', (e) => {
    const dotsBtn = e.target.closest('.btn-menu-dots');
    if (!dotsBtn) return;
    e.stopPropagation();
    openHistoryMenu(dotsBtn, Number(dotsBtn.dataset.gameId));
});

historyItemDropdown.addEventListener('click', (e) => e.stopPropagation());

historyDropdownEdit.addEventListener('click', () => {
    const gameId = activeHistoryMenuGameId;
    closeHistoryMenu();
    const game = allGames.find(g => g.id === gameId);
    if (game) openGameForEditing(game);
});

historyDropdownDelete.addEventListener('click', async () => {
    const gameId = activeHistoryMenuGameId;
    closeHistoryMenu();
    const confirmed = await showConfirmModal('Delete selected game?');
    if (confirmed) await deleteGameById(gameId);
});

document.addEventListener('click', () => closeHistoryMenu());

window.addEventListener('scroll', () => closeHistoryMenu(), true);