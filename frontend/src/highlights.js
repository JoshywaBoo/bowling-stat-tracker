// highlights.js
// "Interesting recent games" panel — same fixed/drawer panel mechanics as
// stats.js (see stats.css / highlights.css), mirrored onto the left side.
// Unlike the stats panel this isn't gated behind login/view state: the
// backing data (/api/highlights/recent-games) is public, so the panel is
// simply always visible.

import { calculateBowlingScore, isCleanGame, stripSplitMarkers, frameStringToHtml } from './frames.js';
import { formatTime } from './format.js';
import { API_BASE } from './main.js';
import { showLoggedOut } from './auth.js';

const highlightsPanel = document.getElementById('highlights-panel');
const highlightsListEl = document.getElementById('highlights-list');
const highlightsToggle = document.getElementById('highlights-toggle');
const emojiPickerEl = document.getElementById('emoji-picker');

// Higher = more "interesting". Tune the weights to taste.
export function interestingnessScore(frameString) {
    const clean = stripSplitMarkers(frameString);
    const score = calculateBowlingScore(clean);
    let points = typeof score === 'number' ? score : 0;

    if (isCleanGame(frameString)) points += 40; // no open frames at all

    let streak = 0, longestStreak = 0;
    for (const ch of clean.replace(/\s+/g, '')) {
        if (ch.toUpperCase() === 'X') {
            streak++;
            longestStreak = Math.max(longestStreak, streak);
        } else {
            streak = 0;
        }
    }
    points += longestStreak * 12; // reward strike runs

    return points;
}

function localDateKey(dateInput) {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Highest-scoring game in a list, tagged with its score. Null for an empty list.
function bestOf(games) {
    return games.reduce((best, g) => {
        const score = interestingnessScore(g.frame_string);
        return (!best || score > best.score) ? { ...g, score } : best;
    }, null);
}

const LOOKBACK_DAYS = 7; // today counts as day 0, so this reaches back 6 days before today

// For each player, prefer their most interesting game from today; if they
// have none today, try yesterday, then the day before, walking back day by
// day up to LOOKBACK_DAYS. Only once the whole week comes up empty for that
// player do we fall back to their best game from any date. Returns the top
// N players' picks — this is what guarantees diversity across bowlers.
export function pickHighlights(games, count = 5) {
    const gamesByPlayer = new Map(); // username -> games[]
    for (const game of games) {
        if (!gamesByPlayer.has(game.username)) gamesByPlayer.set(game.username, []);
        gamesByPlayer.get(game.username).push(game);
    }

    const today = new Date();
    const picks = [];

    for (const [, playerGames] of gamesByPlayer) {
        let chosen = null;

        for (let daysAgo = 0; daysAgo < LOOKBACK_DAYS && !chosen; daysAgo++) {
            const target = new Date(today);
            target.setDate(target.getDate() - daysAgo);
            const key = localDateKey(target);
            const sameDay = playerGames.filter(g => localDateKey(g.created_at) === key);
            chosen = bestOf(sameDay);
        }

        if (!chosen) chosen = bestOf(playerGames); // nothing in the past week - use their all-time best

        if (chosen) picks.push(chosen);
    }

    return picks
        .sort((a, b) => b.score - a.score)
        .slice(0, count);
}

function renderHighlights(highlights) {
    if (!highlights.length) {
        highlightsListEl.innerHTML = '<p class="empty-history">No highlights yet.</p>';
        return;
    }

    highlightsListEl.innerHTML = highlights.map(g => `
        <div class="highlight-card" data-game-id="${g.id}">
            <div class="highlight-player-row">
                <span class="highlight-player">${g.username}</span>
                <time class="highlight-date">${formatTime(g.created_at)}</time>
            </div>
            <span class="frame-string">${frameStringToHtml(g.frame_string)}</span>
            <span class="history-score">${calculateBowlingScore(stripSplitMarkers(g.frame_string))}</span>
            <div class="reaction-row" data-game-id="${g.id}">
                ${Object.entries(g.reactions.counts).map(([emoji, count]) =>
        `<span class="reaction-pill" data-emoji="${emoji}">${emoji} ${count}</span>`).join('')}
                <button type="button" class="btn-react" data-game-id="${g.id}">+</button>
            </div>
        </div>
    `).join('');
}

function updateReactionRow(gameId, summary) {
    const row = highlightsListEl.querySelector(`.reaction-row[data-game-id="${gameId}"]`);
    if (!row) return;
    row.innerHTML = `
        ${Object.entries(summary.counts).map(([emoji, count]) =>
        `<span class="reaction-pill" data-emoji="${emoji}">${emoji} ${count}</span>`).join('')}
        <button type="button" class="btn-react" data-game-id="${gameId}">+</button>
    `;
}

export async function loadHighlights() {
    try {
        const res = await fetch(`${API_BASE}/api/highlights/recent-games`, { credentials: 'include' });
        if (!res.ok) {
            throw new Error(`GET /api/highlights/recent-games -> ${res.status} ${res.statusText}`);
        }
        const games = await res.json();
        renderHighlights(pickHighlights(games));
    } catch (err) {
        console.error('loadHighlights failed:', err);
        highlightsListEl.innerHTML = '<p class="empty-history">Could not load highlights.</p>';
    }
}

// PANEL TOGGLE — same open/close mechanics as the stats panel (stats.js),
// mirrored to the left-side drawer.
highlightsToggle.addEventListener('click', () => {
    const open = highlightsPanel.classList.toggle('open');
    highlightsToggle.classList.toggle('panel-open', open);
});

// EMOJI PICKER

const EMOJI_PALETTE = ['👍', '🔥', '😂', '🎳', '👏', '😮', '💀'];

function openEmojiPicker(button, gameId) {
    const rect = button.getBoundingClientRect();
    emojiPickerEl.innerHTML = EMOJI_PALETTE
        .map(e => `<button type="button" class="emoji-option" data-emoji="${e}">${e}</button>`)
        .join('');
    emojiPickerEl.style.top = `${rect.top - 10}px`;
    emojiPickerEl.style.left = `${rect.right + 8}px`;
    emojiPickerEl.style.display = 'flex';
    emojiPickerEl.dataset.gameId = gameId;
}

function closeEmojiPicker() {
    emojiPickerEl.style.display = 'none';
}

// Shared by both the emoji picker and clicking an existing pill directly -
// the backend already toggles per user+emoji (removes if you already
// reacted with it, adds otherwise), so both paths just hit the same call.
async function toggleReaction(gameId, emoji) {
    const res = await fetch(`${API_BASE}/api/games/${gameId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ emoji }),
    });
    if (res.status === 401) { showLoggedOut(); return; }
    const summary = await res.json();
    updateReactionRow(gameId, summary); // re-render just that card's pills
}

highlightsListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-react');
    if (!btn) return;
    e.stopPropagation(); // don't let this bubble into the doc listener that closes the picker
    openEmojiPicker(btn, Number(btn.dataset.gameId));
});

// Click an existing pill to toggle that reaction directly, without going
// through the + picker first.
highlightsListEl.addEventListener('click', (e) => {
    const pill = e.target.closest('.reaction-pill');
    if (!pill) return;
    e.stopPropagation();
    const gameId = pill.closest('.reaction-row').dataset.gameId;
    toggleReaction(gameId, pill.dataset.emoji);
});

emojiPickerEl.addEventListener('click', (e) => e.stopPropagation());

emojiPickerEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.emoji-option');
    if (!btn) return;
    const gameId = emojiPickerEl.dataset.gameId;
    closeEmojiPicker();
    toggleReaction(gameId, btn.dataset.emoji);
});

document.addEventListener('click', () => closeEmojiPicker());
window.addEventListener('scroll', () => closeEmojiPicker(), true);