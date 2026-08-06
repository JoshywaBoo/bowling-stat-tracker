// players.js

import { API_BASE } from './main.js';
import { setStatsPanelVisible } from './stats.js';
import { applyHistoryFilter } from './history.js';
import { formatTime } from './format.js';
import { frameStringToHtml, calculateBowlingScore, stripSplitMarkers } from './frames.js';

const playersListView = document.getElementById('players-list-view');
const playersListEl = document.getElementById('players-list');
const playerDetailBack = document.getElementById('player-detail-back');
const playerDetailName = document.getElementById('player-detail-name');
const playerDetailHistory = document.getElementById('player-detail-history');

export const playerDetailView = document.getElementById('player-detail-view');
export const playersContent = document.getElementById('players-content');

export let selectedPlayerUsername = null;
export let currentPlayerGames = null;

export async function loadPlayersList() {
    currentPlayerGames = null;
    playersListView.style.display = '';
    playerDetailView.style.display = 'none';
    playersListEl.innerHTML = '<p class="empty-history">Loading players…</p>';

    try {
        const res = await fetch(`${API_BASE}/api/players`);
        if (!res.ok) throw new Error();
        const players = await res.json();

        if (!players.length) {
            playersListEl.innerHTML = '<p class="empty-history">No players yet.</p>';
            return;
        }

        playersListEl.innerHTML = '';
        players.forEach(p => {
            const item = document.createElement('div');
            item.className = 'history-item';
            item.style.cursor = 'pointer';
            item.innerHTML = `<span class="frame-string">${p.username}</span>`;
            item.addEventListener('click', () => openPlayerDetail(p.username));
            playersListEl.appendChild(item);
        });
    } catch {
        playersListEl.innerHTML = '<p class="empty-history">Could not load players.</p>';
    }
}

export async function openPlayerDetail(username) {
    selectedPlayerUsername = username;
    playersListView.style.display = 'none';
    playerDetailView.style.display = '';
    playerDetailName.textContent = username;
    playerDetailHistory.innerHTML = '<p class="empty-history">Loading games…</p>';

    setStatsPanelVisible(true);

    try {
        const res = await fetch(`${API_BASE}/api/players/${encodeURIComponent(username)}/games`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        currentPlayerGames = data.games;
        applyHistoryFilter();
    } catch {
        currentPlayerGames = null;
        playerDetailHistory.innerHTML = '<p class="empty-history">Could not load this player\'s games.</p>';
    }
}

// Same rendering as renderHistory(), minus the edit/delete buttons.
export function renderPlayerHistory(games) {
    playerDetailHistory.innerHTML = '';
    if (!games.length) {
        playerDetailHistory.innerHTML = '<p class="empty-history">No games yet.</p>';
        return;
    }
    games.forEach(g => {
        const item = document.createElement('div');
        item.className = 'history-item';
        const cleanScore = calculateBowlingScore(stripSplitMarkers(g.frame_string));
        item.innerHTML = `
        <div class="history-main">
        <span class="frame-string">${frameStringToHtml(g.frame_string)}</span>
        <span class="history-score">${cleanScore}</span>
        </div>
        <div class="history-item-actions">
        <time>${formatTime(g.created_at)}</time>
        </div>
        `;
        playerDetailHistory.appendChild(item);
    });
}

playerDetailBack.addEventListener('click', () => {
    selectedPlayerUsername = null;
    currentPlayerGames = null;
    setStatsPanelVisible(false);
    loadPlayersList();
});