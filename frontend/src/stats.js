// stats.js
// Stats panel — shared fixed/drawer panel, reused for both the "me" view
// and any player-detail view. Only its title + content are swapped between
// views; the panel/toggle DOM itself is a single instance outside <main>.

import { stripSplitMarkers, calculateBowlingScore, parseFrameChars } from './frames.js';

const statsPanel = document.getElementById('stats-panel');
const statsPanelTitle = document.getElementById('stats-panel-title');
const statsContent = document.getElementById('stats-content');
const statsToggle = document.getElementById('stats-toggle');
const statsRangeToggle = document.getElementById('stats-range-toggle');
const statsRangeBtns = Array.from(statsRangeToggle.querySelectorAll('.stats-range-btn'));

let statsRange = 'all'; // 'all' | '20'
let lastStatsGames = []; // full (untrimmed) game list currently backing the panel, so switching range doesn't need a re-fetch

statsRangeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        statsRange = btn.dataset.range;
        statsRangeBtns.forEach(b => b.classList.toggle('active', b === btn));
        renderStats(lastStatsGames, statsPanelTitle.textContent);
    });
});

statsToggle.addEventListener('click', () => {
    const open = statsPanel.classList.toggle('open');
    statsToggle.classList.toggle('panel-open', open);
});

export function setStatsPanelVisible(visible) {
    document.body.classList.toggle('stats-active', visible);
    if (!visible) {
        statsPanel.classList.remove('open');
        statsToggle.classList.remove('panel-open');
    }
}

// Rough strike/spare counts scan every frame character directly (including
// frame 10's bonus rolls) - counts literal 'X'/'/' occurrences rather than
// re-deriving strict per-frame bowling semantics, since this is purely
// informational, not scored.
function computeStats(games) {
    if (!games.length) {
        return {
            count: 0, average: null, high: null, strikes: 0, spares: 0,
            spareConversionRate: null, splitRate: null, splitConversionRate: null,
            strikeRate: null, openFrames: 0, openFrameRate: null,
            longestStrikeStreak: null, cleanGames: 0,
        };
    }

    let total = 0;
    let scored = 0;
    let high = -Infinity;
    let strikes = 0;
    let spares = 0;

    let totalFrames = 0;
    let strikeFrames = 0;
    let openFrames = 0;
    let cleanGames = 0;
    let longestStrikeStreak = 0;

    // "Opportunity" = any first-ball roll at a fresh, full rack of pins -
    // i.e. any point a split could physically occur. For frames 1-9 that's
    // just roll 1 of the frame (unless it's a strike, which leaves no pins
    // to split). Frame 10 can contain several such fresh-rack rolls, since
    // a strike or spare there resets the pins for the next roll.
    let spareOpportunities = 0;
    let spareConversions = 0;
    let splitsLeft = 0;
    let splitsConverted = 0; // subset of splitsLeft that were then picked up

    games.forEach(g => {
        const clean = stripSplitMarkers(g.frame_string);
        const score = calculateBowlingScore(clean);
        if (typeof score === 'number') {
            total += score;
            scored++;
            if (score > high) high = score;
        }

        const frames = clean.trim().split(/\s+/).filter(Boolean);
        frames.forEach(frame => {
            for (const ch of frame) {
                if (ch === 'X') strikes++;
                if (ch === '/') spares++;
            }
        });

        // Per-frame classification: strike / spare / open. Frame 10 is
        // judged by its first roll only, same convention used for the
        // strikes/spares counters above and for spareOpportunities below.
        let gameHasOpenFrame = false;
        frames.forEach(frame => {
            totalFrames++;
            const upper = frame.toUpperCase();
            if (upper[0] === 'X') {
                strikeFrames++;
            } else if (upper[1] === '/') {
                // spare - not open
            } else {
                openFrames++;
                gameHasOpenFrame = true;
            }
        });
        if (frames.length && !gameHasOpenFrame) cleanGames++;

        // Longest run of consecutive strikes. 'X' only ever appears for an
        // actual strike roll - whether it's a normal frame or a frame-10
        // bonus roll - so a flat scan across frame boundaries is safe and
        // correctly captures streaks that run into/through the 10th.
        let currentStreak = 0;
        for (const ch of frames.join('')) {
            if (ch === 'X') {
                currentStreak++;
                if (currentStreak > longestStrikeStreak) longestStrikeStreak = currentStreak;
            } else {
                currentStreak = 0;
            }
        }

        // Split/spare-conversion analysis needs the *unstripped* frame_string,
        // since that's where the split markers ('*') live.
        const rawFrames = (g.frame_string || '').trim().length
            ? g.frame_string.trim().split(/\s+/)
            : [];

        rawFrames.forEach((frame, frameIdx) => {
            const { chars, marks } = parseFrameChars(frame);
            if (!chars.length) return;
            const isFrame10 = frameIdx === 9;

            if (!isFrame10) {
                // Standard frame: only roll 1 is a fresh-rack opportunity.
                if (chars[0].toUpperCase() === 'X') return; // strike - no pins left to split
                spareOpportunities++;
                const wasSplit = marks.includes(0);
                if (wasSplit) splitsLeft++;
                if (chars[1] === '/') {
                    spareConversions++;
                    if (wasSplit) splitsConverted++;
                }
                return;
            }

            // Frame 10: walk each roll, tracking whether the PREVIOUS roll in
            // this frame reset the rack (strike or spare) - roll 0 always does
            // (fresh frame), so it's always an opportunity.
            let prevReset = true;
            for (let i = 0; i < chars.length; i++) {
                const ch = chars[i].toUpperCase();
                if (prevReset && ch !== '/') {
                    spareOpportunities++;
                    const wasSplit = marks.includes(i);
                    if (wasSplit) splitsLeft++;

                    const nextCh = chars[i + 1];
                    if (nextCh === '/') {
                        spareConversions++;
                        if (wasSplit) splitsConverted++;
                    }
                }
                prevReset = (ch === 'X' || ch === '/');
            }
        });
    });

    return {
        count: games.length,
        average: scored ? Math.round(total / scored) : null,
        high: high === -Infinity ? null : high,
        strikes,
        spares,
        spareConversionRate: spareOpportunities
            ? Math.round((spareConversions / spareOpportunities) * 100)
            : null,
        splitRate: spareOpportunities
            ? Math.round((splitsLeft / spareOpportunities) * 100)
            : null,
        splitConversionRate: splitsLeft
            ? Math.round((splitsConverted / splitsLeft) * 100)
            : null,
        strikeRate: totalFrames ? Math.round((strikeFrames / totalFrames) * 100) : null,
        openFrames,
        openFrameRate: totalFrames ? Math.round((openFrames / totalFrames) * 100) : null,
        longestStrikeStreak: totalFrames ? longestStrikeStreak : null,
        cleanGames,
    };
}

export function renderStats(games, title) {
    statsPanelTitle.textContent = title || 'Stats';
    lastStatsGames = games; // keep full list so range can re-slice without re-fetching

    // assumes game list is ordered newest-first
    const scoped = statsRange === '20' ? games.slice(0, 20) : games;
    const stats = computeStats(scoped);

    if (!stats.count) {
        statsContent.innerHTML = '<p class="empty-history">No stats yet.</p>';
        return;
    }

    statsContent.innerHTML = `
        <div class="stat-row"><span class="stat-label">Games</span><span class="stat-value">${stats.count}</span></div>
        <div class="stat-row"><span class="stat-label">Average</span><span class="stat-value">${stats.average ?? '—'}</span></div>
        <div class="stat-row"><span class="stat-label">High game</span><span class="stat-value">${stats.high ?? '—'}</span></div>
        <div class="stat-row"><span class="stat-label">Strikes</span><span class="stat-value">${stats.strikes}</span></div>
        <div class="stat-row"><span class="stat-label">Strike rate</span><span class="stat-value">${stats.strikeRate ?? '—'}%</span></div>
        <div class="stat-row"><span class="stat-label">Spares</span><span class="stat-value">${stats.spares}</span></div>
        <div class="stat-row"><span class="stat-label">Spare conversion</span><span class="stat-value">${stats.spareConversionRate ?? '—'}%</span></div>
        <div class="stat-row"><span class="stat-label">Open frames</span><span class="stat-value">${stats.openFrames}</span></div>
        <div class="stat-row"><span class="stat-label">Open frame rate</span><span class="stat-value">${stats.openFrameRate ?? '—'}%</span></div>
        <div class="stat-row"><span class="stat-label">Longest strike streak</span><span class="stat-value">${stats.longestStrikeStreak ?? '—'}</span></div>
        <div class="stat-row"><span class="stat-label">Clean games</span><span class="stat-value">${stats.cleanGames}</span></div>
        <div class="stat-row"><span class="stat-label">Split rate</span><span class="stat-value">${stats.splitRate ?? '—'}%</span></div>
        <div class="stat-row"><span class="stat-label">Split conversion</span><span class="stat-value">${stats.splitConversionRate ?? '—'}%</span></div>
        `;
}