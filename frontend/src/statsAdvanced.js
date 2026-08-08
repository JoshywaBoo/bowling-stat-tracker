// statsAdvanced.js
// full-screen "advanced stats" page. Sits as an overlay outside <main>, so
// it doesn't need to hook into nav.js's view-switching logic - it just
// shows/hides on top of whatever view is currently active and closes back
// to it. Opens pre-loaded with whatever the mini stats panel is currently
// showing (via getCurrentStatsContext), but keeps its own independent
// all/Last 20 toggle from that point on.

import { computeStats, getCurrentStatsContext, statsRowsHtml, setStatsPanelVisible } from './stats.js';
import { stripSplitMarkers, calculateBowlingScore, parseFrameChars } from './frames.js';
import { formatTime } from './format.js';
import { closeHighlightsPanel } from './highlights.js';
import { Chart } from 'chart.js/auto';
import { Tooltip } from 'chart.js';

const overlay = document.getElementById('stats-advanced-overlay');
const titleEl = document.getElementById('stats-advanced-title');
const bodyEl = document.getElementById('stats-advanced-body');
const summaryEl = document.getElementById('stats-advanced-summary');
const sideEl = document.getElementById('stats-advanced-side');
const sideToggleBtn = document.getElementById('stats-advanced-toggle');
const openBtn = document.getElementById('stats-advanced-btn');
const backBtn = document.getElementById('stats-advanced-back');
const rangeToggle = document.getElementById('stats-advanced-range-toggle');
const rangeBtns = Array.from(rangeToggle.querySelectorAll('.stats-range-btn'));

let advancedRange = 'all'; // 'all' | '20'
let allGames = []; // full (untrimmed) list backing the current advanced-page session

const chartInstances = {}; // { [canvasId]: Chart instance }
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let chartGroupMode = 'day'; // 'day' | 'month' | 'year' | 'alltime'
let chartSelectedYear = null;
let chartSelectedMonth = null; // 1-12
let chartMonthPickerYear = null;

// ------------------------------------------------------------- height sync
// .stats-advanced-header (back button + title) and .stats-advanced-sticky-controls
// (mode toggle + period picker) are both position:fixed and stacked below
// .nav-bar, so the overlay's scroll padding and the controls' own top offset
// need to track their *real* rendered heights live (mirrors main.js's
// syncNavHeight() pattern), since the header/controls change height
// (safe-area insets, and the controls gaining/losing the picker row per
// chartGroupMode).
const advancedHeaderEl = document.querySelector('.stats-advanced-header');

const headerResizeObserver = new ResizeObserver((entries) => {
    document.documentElement.style.setProperty('--stats-advanced-header-height', `${entries[0].contentRect.height}px`);
});
if (advancedHeaderEl) headerResizeObserver.observe(advancedHeaderEl);

// controls' own height changes between renders (the day/month picker row
// appears/disappears with chartGroupMode), so we re-observe the fresh
// node at the end of every render() rather than observing once up front.
const controlsResizeObserver = new ResizeObserver((entries) => {
    document.documentElement.style.setProperty('--stats-advanced-controls-height', `${entries[0].contentRect.height}px`);
});

// ------------------------------------------------------- formatting / date helpers

function formatDateTwoLine(dateStr) {
    return formatTime(dateStr).replace(/, | at /, ',<br>');
}

function dayIndexToShortLabel(idx) {
    const d = new Date(idx * 86400000);
    return `${MONTH_NAMES[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;
}

function monthIndexToLabel(idx) {
    return MONTH_NAMES[Math.floor(idx)];
}

// returns day-since-epoch indices for the 1st of every month between
// two day-indices (inclusive), so alltime-mode ticks land on real month
// boundaries instead of Chart.js's arbitrary evenly-spaced day positions.
function monthStartDayIndices(minIdx, maxIdx) {
    const start = new Date(minIdx * 86400000);
    const end = new Date(maxIdx * 86400000);
    const ticks = [];
    let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const endD = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    while (d <= endD) {
        ticks.push(Math.floor(d.getTime() / 86400000));
        d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    }
    return ticks;
}

// thins month-start ticks to fit maxTicks, stepping by whole months
// (1, 2, 3, 6, 12) so spacing stays visually regular as history grows.
function thinnedMonthTicks(minIdx, maxIdx, maxTicks = 8) {
    const all = monthStartDayIndices(minIdx, maxIdx);
    for (const step of [1, 2, 3, 6, 12]) {
        const thinned = all.filter((_, i) => i % step === 0);
        if (thinned.length <= maxTicks) return thinned;
    }
    return all.filter((_, i) => i % 12 === 0); // beyond a year of steps, fall back to yearly
}

// returns { "2025": [1, 3, 4], "2024": [11, 12] } - years mapped to which
// months (1-12) have at least one game, so the dropdowns never show empty options.
function availablePeriods(games) {
    const map = {};
    games.forEach(g => {
        const d = new Date(g.created_at);
        const year = d.getFullYear();
        const month = d.getMonth() + 1;
        if (!map[year]) map[year] = new Set();
        map[year].add(month);
    });
    const result = {};
    Object.keys(map).sort().forEach(year => {
        result[year] = Array.from(map[year]).sort((a, b) => a - b);
    });
    return result;
}

// --------------------------------------------------------- per-game metrics
// each extractor returns this game's y-value, or null if this game
// shouldn't produce a point at all (e.g. unscored, or no split chances).

function scoreMetric(g) {
    const score = calculateBowlingScore(stripSplitMarkers(g.frame_string));
    return typeof score === 'number' ? score : null;
}

// strike rate for a single game
// strikes / total frames (first 10 only),
// all frames (including 10) are judged by its first roll
function strikeRateMetric(g) {
    const frames = stripSplitMarkers(g.frame_string).trim().split(/\s+/).filter(Boolean).slice(0, 10);
    if (!frames.length) return null;
    const strikeCount = frames.filter(f => f.toUpperCase()[0] === 'X').length;
    return Math.round((strikeCount / frames.length) * 100);
}

// spare conversion rate for a single game
function spareConversionMetric(g) {
    const rawFrames = (g.frame_string || '').trim().length ? g.frame_string.trim().split(/\s+/) : [];
    let spareOpportunities = 0;
    let spareConversions = 0;

    rawFrames.forEach((frame, frameIdx) => {
        const { chars } = parseFrameChars(frame);
        if (!chars.length) return;
        const isFrame10 = frameIdx === 9;

        if (!isFrame10) {
            if (chars[0].toUpperCase() === 'X') return;
            spareOpportunities++;
            if (chars[1] === '/') spareConversions++;
            return;
        }

        let prevReset = true;
        for (let i = 0; i < chars.length; i++) {
            const ch = chars[i].toUpperCase();
            if (prevReset && ch !== '/') {
                spareOpportunities++;
                if (chars[i + 1] === '/') spareConversions++;
            }
            prevReset = (ch === 'X' || ch === '/');
        }
    });

    if (!spareOpportunities) return null; // no spare chances this game (n)o data point)
    return Math.round((spareConversions / spareOpportunities) * 100);
}

// split conversion rate for a single game
function splitConversionMetric(g) {
    const rawFrames = (g.frame_string || '').trim().length ? g.frame_string.trim().split(/\s+/) : [];
    let splitsLeft = 0;
    let splitsConverted = 0;

    rawFrames.forEach((frame, frameIdx) => {
        const { chars, marks } = parseFrameChars(frame);
        if (!chars.length) return;
        const isFrame10 = frameIdx === 9;

        if (!isFrame10) {
            if (chars[0].toUpperCase() === 'X') return;
            if (marks.includes(0)) {
                splitsLeft++;
                if (chars[1] === '/') splitsConverted++;
            }
            return;
        }

        let prevReset = true;
        for (let i = 0; i < chars.length; i++) {
            const ch = chars[i].toUpperCase();
            if (prevReset && ch !== '/') {
                if (marks.includes(i)) {
                    splitsLeft++;
                    if (chars[i + 1] === '/') splitsConverted++;
                }
            }
            prevReset = (ch === 'X' || ch === '/');
        }
    });

    if (!splitsLeft) return null; // no split chances this game — no data point
    return Math.round((splitsConverted / splitsLeft) * 100);
}

// ------------------------------------------------------- grouping / charting

// buckets games into a period (day-of-month / month-of-year / year /
// day-since-epoch) and extracts a metric value + date per game via
// metricFn. Games where metricFn returns null are skipped entirely.
function groupGamesBy(games, mode, metricFn, extra = {}) {
    const buckets = {};

    const keyFor = (d) => {
        switch (mode) {
            case 'day':
                if (d.getFullYear() !== extra.year || d.getMonth() + 1 !== extra.month) return null;
                return d.getDate();
            case 'month':
                if (d.getFullYear() !== extra.year) return null;
                return d.getMonth(); // 0-11
            case 'year':
                return d.getFullYear();
            case 'alltime':
                return Math.floor(d.getTime() / 86400000);
        }
    };

    games.forEach(g => {
        const d = new Date(g.created_at);
        const key = keyFor(d);
        if (key === null || key === undefined) return;

        const value = metricFn(g);
        if (value === null) return;

        if (!buckets[key]) buckets[key] = [];
        buckets[key].push({ time: d.getTime(), value, date: d });
    });

    const keys = Object.keys(buckets).map(Number).sort((a, b) => a - b);
    const points = [];

    keys.forEach(key => {
        const entries = buckets[key].sort((a, b) => a.time - b.time); // chronological within the bucket
        const n = entries.length;
        entries.forEach((e, i) => {
            points.push({ x: key + i / n, y: e.value, date: e.date });
        });
    });

    return { points };
}

function currentChartData(games, metricFn) {
    if (chartGroupMode === 'day') {
        if (!chartSelectedYear || !chartSelectedMonth) return { points: [] };
        return groupGamesBy(games, 'day', metricFn, { year: chartSelectedYear, month: chartSelectedMonth });
    }
    if (chartGroupMode === 'month') return groupGamesBy(games, 'month', metricFn, { year: chartMonthPickerYear });
    if (chartGroupMode === 'year') return groupGamesBy(games, 'year', metricFn);
    return groupGamesBy(games, 'alltime', metricFn);
}

// centered simple moving average over points already in x-ascending order
// (which currentChartData's grouping functions guarantee). windowSize
// controls how smooth vs. reactive the trend line is.
function movingAverage(points, windowSize) {
    if (points.length < 2) return [];
    return points.map((p, i) => {
        const start = Math.max(0, i - Math.floor(windowSize / 2));
        const end = Math.min(points.length, i + Math.ceil(windowSize / 2));
        const slice = points.slice(start, end);
        const avgY = slice.reduce((sum, s) => sum + s.y, 0) / slice.length;
        return { x: p.x, y: avgY };
    });
}

// options: { metricFn, mainLabel, yMax, color }
function metricChartConfig(games, options) {
    const { metricFn, mainLabel, yMax, color } = options;
    const { points } = currentChartData(games, metricFn);

    const xMin = points.length ? points[0].x : undefined;
    const xMax = points.length ? points[points.length - 1].x : undefined;

    const xTickCallback =
        chartGroupMode === 'month' ? (value) => monthIndexToLabel(Math.round(value)) :
            chartGroupMode === 'alltime' ? (value) => dayIndexToShortLabel(Math.round(value)) :
                (value) => Math.round(value);

    const datasets = [{
        label: mainLabel,
        data: points,
        borderColor: 'rgba(123, 135, 146, 0.3)',
        backgroundColor: 'rgba(123, 135, 146, 0.08)',
        pointBackgroundColor: 'rgba(123, 135, 146, 0.3)',
        pointRadius: 2,
        tension: 0.25,
        fill: true,
        order: 2,
    }];

    if (points.length >= 2) {
        const windowSize = Math.max(3, Math.round(points.length / 8));
        const trendPoints = movingAverage(points, windowSize);
        datasets.push({
            label: 'Average',
            data: trendPoints,
            borderColor: color,
            backgroundColor: color,
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.3,
            fill: false,
            order: 1,
        });
    }

    const isPercent = yMax === 100;

    return {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    position: 'aboveHighest',
                    yAlign: 'bottom',
                    xAlign: 'center',
                    caretPadding: 20,
                    callbacks: {
                        title: (items) => {
                            const mainItem = items.find(item => item.dataset.label === mainLabel) ?? items[0];
                            const date = mainItem?.raw?.date;
                            if (!date) return '';
                            if (chartGroupMode === 'month') return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                            if (chartGroupMode === 'year') return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
                            if (chartGroupMode === 'alltime') return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                            return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                        },
                        label: (item) => `${item.formattedValue}${isPercent ? '%' : ''}`,
                    },
                },
            },
            scales: {
                x: {
                    type: 'linear',
                    min: xMin,
                    max: xMax,
                    afterBuildTicks: (chartGroupMode === 'alltime' && points.length)
                        ? (scale) => {
                            scale.ticks = thinnedMonthTicks(xMin, xMax)
                                .filter(v => v >= scale.min && v <= scale.max)
                                .map(value => ({ value }));
                        }
                        : undefined,
                    ticks: {
                        color: '#7b8792',
                        stepSize: chartGroupMode === 'month' ? 1 : undefined,
                        maxRotation: 0,
                        precision: chartGroupMode === 'alltime' ? undefined : 0,
                        callback: xTickCallback,
                    },
                    grid: { color: '#232b33' },
                },
                y: {
                    afterFit: (scale) => { scale.width = 40; },
                    ticks: { color: '#7b8792' },
                    grid: { color: '#232b33' },
                    beginAtZero: true,
                    max: yMax,
                },
            },
        },
    };
}

function renderChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
    }

    chartInstances[canvasId] = new Chart(canvas, config);
}

// ------------------------------------------------------------- UI fragments

// strike / spare / open frames by frame number 1-10
function frameBreakdown(games) {
    const counts = Array.from({ length: 10 }, () => ({ strike: 0, spare: 0, open: 0 }));
    games.forEach(g => {
        const frames = stripSplitMarkers(g.frame_string).trim().split(/\s+/).filter(Boolean);
        frames.slice(0, 10).forEach((f, i) => {
            const upper = f.toUpperCase();
            if (upper[0] === 'X') counts[i].strike++;
            else if (upper[1] === '/') counts[i].spare++;
            else counts[i].open++;
        });
    });
    return counts;
}

function dayPickerHtml(games) {
    const periods = availablePeriods(games);
    const years = Object.keys(periods);

    if (!years.includes(String(chartSelectedYear))) {
        chartSelectedYear = Number(years[years.length - 1]); // most recent year
    }

    if (!periods[chartSelectedYear] || !periods[chartSelectedYear].includes(chartSelectedMonth)) {
        const months = periods[chartSelectedYear];
        chartSelectedMonth = months[months.length - 1]; // most recent month in that year
    }

    const monthOptions = periods[chartSelectedYear].map(m =>
        `<option value="${m}" ${m === chartSelectedMonth ? 'selected' : ''}>${MONTH_NAMES[m - 1]}</option>`
    ).join('');
    const yearOptions = years.map(y =>
        `<option value="${y}" ${Number(y) === chartSelectedYear ? 'selected' : ''}>${y}</option>`
    ).join('');

    return `
        <div style="display:flex; gap:8px; margin-bottom:12px;">
            <select id="chart-month-select" class="chart-period-select">${monthOptions}</select>
            <select id="chart-year-select" class="chart-period-select">${yearOptions}</select>
        </div>
    `;
}

function monthYearPickerHtml(games) {
    const periods = availablePeriods(games); // reuse - just need the year keys
    const years = Object.keys(periods);

    if (!years.includes(String(chartMonthPickerYear))) {
        chartMonthPickerYear = Number(years[years.length - 1]); // most recent year with data
    }

    const yearOptions = years.map(y =>
        `<option value="${y}" ${Number(y) === chartMonthPickerYear ? 'selected' : ''}>${y}</option>`
    ).join('');

    return `
        <div style="display:flex; gap:8px; margin-bottom:12px;">
            <select id="chart-month-year-select" class="chart-period-select">${yearOptions}</select>
        </div>
    `;
}

// -------------------------------------------------------------------- render

function render() {
    // assumes allGames is ordered newest-first, same as mini panel
    const games = advancedRange === '20' ? allGames.slice(0, 20) : allGames;

    if (!games.length) {
        bodyEl.innerHTML = '<p class="empty-history">No games yet.</p>';
        summaryEl.innerHTML = '';
        return;
    }

    const stats = computeStats(games);

    const trendGames = allGames.slice(0, 20); // always the same 20, regardless of range toggle
    const maxScore = Math.max(...trendGames.map(g => {
        const s = calculateBowlingScore(stripSplitMarkers(g.frame_string));
        return typeof s === 'number' ? s : 0;
    }), 1);

    const trendRows = trendGames.map(g => {
        const score = calculateBowlingScore(stripSplitMarkers(g.frame_string));
        const pct = typeof score === 'number' ? Math.round((score / maxScore) * 100) : 0;
        return `
            <div class="stats-trend-row">
                <span class="stats-trend-date">${formatDateTwoLine(g.created_at)}</span>
                <div class="stats-trend-bar" style="width:${pct}%"></div>
                <span class="stats-trend-score">${typeof score === 'number' ? score : '—'}</span>
            </div>`;
    }).join('');

    const frameCounts = frameBreakdown(games);
    const frameRows = frameCounts.map((c, i) => {
        const total = c.strike + c.spare + c.open;
        const pct = (n) => total ? Math.round((n / total) * 100) : 0;
        return `
            <div class="stat-row">
                <span class="stat-label">Frame ${i + 1}</span>
                <span class="stat-value" style="font-size:14px;">${c.strike}(${pct(c.strike)}%) X | ${c.spare}(${pct(c.spare)}%) sp | ${c.open}(${pct(c.open)}%) op</span>
            </div>`;
    }).join('');

    summaryEl.innerHTML = statsRowsHtml(stats);

    bodyEl.innerHTML = `
        <div class="stats-advanced-sticky-controls">
            <div class="stats-advanced-sticky-controls-inner">
                <div class="stats-range-toggle" id="chart-group-toggle">
                    <button type="button" class="stats-range-btn ${chartGroupMode === 'day' ? 'active' : ''}" data-mode="day">Day</button>
                    <button type="button" class="stats-range-btn ${chartGroupMode === 'month' ? 'active' : ''}" data-mode="month">Month</button>
                    <button type="button" class="stats-range-btn ${chartGroupMode === 'year' ? 'active' : ''}" data-mode="year">Year</button>
                    <button type="button" class="stats-range-btn ${chartGroupMode === 'alltime' ? 'active' : ''}" data-mode="alltime">All time</button>
                </div>
                ${chartGroupMode === 'day' ? dayPickerHtml(games) : ''}
                ${chartGroupMode === 'month' ? monthYearPickerHtml(games) : ''}
            </div>
        </div>

        <h3 style="margin-top:24px;">Score History</h3>
        <canvas id="score-chart" height="200"></canvas>

        <h3 style="margin-top:24px;">Strike Rate History</h3>
        <canvas id="strike-rate-chart" height="200"></canvas>

        <h3 style="margin-top:24px;">Spare Conversion History</h3>
        <canvas id="spare-conversion-chart" height="200"></canvas>

        <h3 style="margin-top:24px;">Split Conversion History</h3>
        <canvas id="split-conversion-chart" height="200"></canvas>

        <h3 style="margin-top:24px;">Frame-by-frame breakdown</h3>
        ${frameRows}

        <h3 style="margin-top:24px;">Recent Games</h3>
        ${trendRows}
    `;

    // Re-observe the fresh sticky-controls node every render, since its
    // height changes with chartGroupMode (the day/month picker row
    // appears/disappears) and innerHTML replacement destroys the old node.
    const stickyControlsEl = bodyEl.querySelector('.stats-advanced-sticky-controls');
    if (stickyControlsEl) {
        controlsResizeObserver.disconnect();
        controlsResizeObserver.observe(stickyControlsEl);
    }

    renderChart('score-chart', metricChartConfig(allGames, {
        metricFn: scoreMetric, mainLabel: 'Score', yMax: 300, color: '#ffb000',
    }));
    renderChart('strike-rate-chart', metricChartConfig(allGames, {
        metricFn: strikeRateMetric, mainLabel: 'Strike Rate', yMax: 100, color: '#29e6c8',
    }));
    renderChart('spare-conversion-chart', metricChartConfig(allGames, {
        metricFn: spareConversionMetric, mainLabel: 'Spare Conversion', yMax: 100, color: '#aa3bff',
    }));
    renderChart('split-conversion-chart', metricChartConfig(allGames, {
        metricFn: splitConversionMetric, mainLabel: 'Split Conversion', yMax: 100, color: '#ff5d5d',
    }));
}

// ------------------------------------------------------------ public API

// highlights.js uses this in mobile view to close this panel when the
// highlights panel is opened
export function closeAdvancedSidePanel() {
    sideEl.classList.remove('open');
    sideToggleBtn.classList.remove('panel-open');
}

// ------------------------------------------------------------ event wiring

rangeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        advancedRange = btn.dataset.range;
        rangeBtns.forEach(b => b.classList.toggle('active', b === btn));
        render();
    });
});

sideToggleBtn.addEventListener('click', () => {
    const open = sideEl.classList.toggle('open');
    sideToggleBtn.classList.toggle('panel-open', open);
    if (open) closeHighlightsPanel(); // close highlights panel on mobile 
});

openBtn.addEventListener('click', () => {
    const { games, title } = getCurrentStatsContext();
    allGames = games;
    advancedRange = 'all';
    rangeBtns.forEach(b => b.classList.toggle('active', b.dataset.range === 'all'));
    titleEl.textContent = title;
    sideEl.classList.remove('open');
    sideToggleBtn.classList.remove('panel-open');
    setStatsPanelVisible(false); // close stats panel on mobile view
    overlay.style.display = 'block';
    render();
});

backBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
    setStatsPanelVisible(true);
});

document.getElementById('nav-link-me').addEventListener('click', () => {
    overlay.style.display = 'none';
});
document.getElementById('nav-link-players').addEventListener('click', () => {
    overlay.style.display = 'none';
});

bodyEl.addEventListener('click', (e) => {
    const modeBtn = e.target.closest('#chart-group-toggle .stats-range-btn');
    if (modeBtn) {
        chartGroupMode = modeBtn.dataset.mode;
        render();
    }
});

bodyEl.addEventListener('change', (e) => {
    if (e.target.id === 'chart-month-select') {
        chartSelectedMonth = Number(e.target.value);
        render();
    }
    if (e.target.id === 'chart-year-select') {
        chartSelectedYear = Number(e.target.value);
        chartSelectedMonth = null;
        render();
    }
    if (e.target.id === 'chart-month-year-select') {
        chartMonthPickerYear = Number(e.target.value);
        render();
    }
});

// -------------------------------------------------------------- chart.js plugin

Tooltip.positioners.aboveHighest = (elements) => {
    if (!elements.length) return false;

    let sumX = 0;
    let minY = Infinity;
    elements.forEach((el) => {
        const pos = el.element.tooltipPosition();
        sumX += pos.x;
        if (pos.y < minY) minY = pos.y;
    });

    return {
        x: sumX / elements.length,
        y: minY,
    };
};