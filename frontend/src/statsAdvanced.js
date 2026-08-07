// statsAdvanced.js
// Full-screen "advanced stats" page. Sits as an overlay outside <main>, so
// it doesn't need to hook into nav.js's view-switching logic - it just
// shows/hides on top of whatever view is currently active and closes back
// to it. Opens pre-loaded with whatever the mini stats panel is currently
// showing (via getCurrentStatsContext), but keeps its own independent
// All/Last 20 toggle from that point on.

import { computeStats, getCurrentStatsContext, statsRowsHtml, setStatsPanelVisible } from './stats.js';
import { stripSplitMarkers, calculateBowlingScore } from './frames.js';
import { formatTime } from './format.js';
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

// chart variables
const chartInstances = {}; // { [canvasId]: Chart instance }
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let chartGroupMode = 'day'; // 'day' | 'month' | 'year'
let chartSelectedYear = null;
let chartSelectedMonth = null; // 1-12
let chartMonthPickerYear = null;

rangeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        advancedRange = btn.dataset.range;
        rangeBtns.forEach(b => b.classList.toggle('active', b === btn));
        render();
    });
});

// Strike/spare/open counts per frame position (1-10), across every game
// in the current scope. Frame 10 is judged by its first roll only, same
// convention stats.js's computeStats() uses.
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

function formatDateTwoLine(dateStr) {
    return formatTime(dateStr).replace(/, /, ',<br>');
}

function render() {
    // assumes allGames is ordered newest-first, same as the mini panel
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
        <h3>Score History</h3>
        <div class="stats-range-toggle" id="chart-group-toggle">
            <button type="button" class="stats-range-btn ${chartGroupMode === 'day' ? 'active' : ''}" data-mode="day">Day</button>
            <button type="button" class="stats-range-btn ${chartGroupMode === 'month' ? 'active' : ''}" data-mode="month">Month</button>
            <button type="button" class="stats-range-btn ${chartGroupMode === 'year' ? 'active' : ''}" data-mode="year">Year</button>
            <button type="button" class="stats-range-btn ${chartGroupMode === 'alltime' ? 'active' : ''}" data-mode="alltime">All time</button>
        </div>
        ${chartGroupMode === 'day' ? dayPickerHtml(games) : ''}
        ${chartGroupMode === 'month' ? monthYearPickerHtml(games) : ''}
        <canvas id="score-chart" height="200"></canvas>
        <h3 style="margin-top:24px;">Frame-by-frame breakdown</h3>
        ${frameRows}
        <h3 style="margin-top:24px;">Recent Games</h3>
        ${trendRows}
    `;

    renderChart('score-chart', scoreChartConfig(allGames));
}

// Returns { "2025": [1, 3, 4], "2024": [11, 12] } - years mapped to which
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

function average(nums) {
    return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function dayIndexToLabel(idx) {
    const d = new Date(idx * 86400000);
    return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function dayIndexToShortLabel(idx) {
    const d = new Date(idx * 86400000);
    return `${MONTH_NAMES[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;
}

function monthIndexToLabel(idx) {
    return MONTH_NAMES[Math.floor(idx)];
}

function groupByDay(games, year, month) {
    const buckets = {}; // day-of-month -> array of {time, score}, unsorted
    games.forEach(g => {
        const d = new Date(g.created_at);
        if (d.getFullYear() !== year || d.getMonth() + 1 !== month) return;
        const day = d.getDate();
        const score = calculateBowlingScore(stripSplitMarkers(g.frame_string));
        if (typeof score !== 'number') return;
        if (!buckets[day]) buckets[day] = [];
        buckets[day].push({ time: d.getTime(), score });
    });

    const days = Object.keys(buckets).map(Number).sort((a, b) => a - b);
    const points = [];

    days.forEach(day => {
        const gamesOnDay = buckets[day].sort((a, b) => a.time - b.time); // chronological order within the day
        const n = gamesOnDay.length;
        gamesOnDay.forEach((g, i) => {
            points.push({ x: day + i / n, y: g.score });
        });
    });

    return { points };
}

function groupByMonth(games, year) {
    const buckets = {};
    games.forEach(g => {
        const d = new Date(g.created_at);
        if (d.getFullYear() !== year) return;
        const monthIndex = d.getMonth(); // 0-11, just within this one year now
        const score = calculateBowlingScore(stripSplitMarkers(g.frame_string));
        if (typeof score !== 'number') return;
        if (!buckets[monthIndex]) buckets[monthIndex] = [];
        buckets[monthIndex].push({ time: d.getTime(), score });
    });

    const monthIndices = Object.keys(buckets).map(Number).sort((a, b) => a - b);
    const points = [];

    monthIndices.forEach(idx => {
        const gamesInMonth = buckets[idx].sort((a, b) => a.time - b.time);
        const n = gamesInMonth.length;
        gamesInMonth.forEach((g, i) => {
            points.push({ x: idx + i / n, y: g.score }); // x is now 0-11 (month within the chosen year)
        });
    });

    return { points };
}

function groupByYear(games) {
    const buckets = {}; // year -> array of {time, score}
    games.forEach(g => {
        const d = new Date(g.created_at);
        const year = d.getFullYear();
        const score = calculateBowlingScore(stripSplitMarkers(g.frame_string));
        if (typeof score !== 'number') return;
        if (!buckets[year]) buckets[year] = [];
        buckets[year].push({ time: d.getTime(), score });
    });

    const years = Object.keys(buckets).map(Number).sort((a, b) => a - b);
    const points = [];

    years.forEach(year => {
        const gamesInYear = buckets[year].sort((a, b) => a.time - b.time);
        const n = gamesInYear.length;
        gamesInYear.forEach((g, i) => {
            points.push({ x: year + i / n, y: g.score });
        });
    });

    return { points };
}

function groupByAllTime(games) {
    const buckets = {}; // "days since epoch" -> array of {time, score}
    games.forEach(g => {
        const d = new Date(g.created_at);
        const dayIndex = Math.floor(d.getTime() / 86400000); // ms per day
        const score = calculateBowlingScore(stripSplitMarkers(g.frame_string));
        if (typeof score !== 'number') return;
        if (!buckets[dayIndex]) buckets[dayIndex] = [];
        buckets[dayIndex].push({ time: d.getTime(), score });
    });

    const dayIndices = Object.keys(buckets).map(Number).sort((a, b) => a - b);
    const points = [];

    dayIndices.forEach(idx => {
        const gamesOnDay = buckets[idx].sort((a, b) => a.time - b.time);
        const n = gamesOnDay.length;
        gamesOnDay.forEach((g, i) => {
            points.push({ x: idx + i / n, y: g.score });
        });
    });

    return { points };
}

function renderChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);

    if (!canvas) return;

    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
    }

    chartInstances[canvasId] = new Chart(canvas, config);
}

function currentChartData(games) {
    if (chartGroupMode === 'day') {
        if (!chartSelectedYear || !chartSelectedMonth) return { points: [] };
        return groupByDay(games, chartSelectedYear, chartSelectedMonth);
    }
    if (chartGroupMode === 'month') return groupByMonth(games, chartMonthPickerYear);
    if (chartGroupMode === 'year') return groupByYear(games);
    return groupByAllTime(games); // 'alltime'
}

// Centered simple moving average over points already in x-ascending order
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

function scoreChartConfig(games) {
    const { points } = currentChartData(games);

    const xTickCallback =
        chartGroupMode === 'month' ? (value) => monthIndexToLabel(Math.round(value)) :
            chartGroupMode === 'alltime' ? (value) => dayIndexToShortLabel(Math.round(value)) :
                (value) => Math.round(value);

    const datasets = [{
        label: 'Score',
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
            borderColor: '#29e6c8',
            backgroundColor: '#29e6c8',
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.3,
            fill: false,
            order: 1,
        });
    }

    return {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    position: 'aboveHighest',
                    yAlign: 'bottom',   // box sits above the anchor point
                    xAlign: 'center',   // box centers horizontally on the anchor point
                    caretPadding: 20,   // this now controls the actual gap
                    callbacks: {
                        title: (items) => {
                            const x = items[0].parsed.x;
                            return chartGroupMode === 'month' ? monthIndexToLabel(Math.floor(x)) : String(Math.floor(x));
                        },
                    },
                },
            },
            scales: {
                x: {
                    type: 'linear',
                    ticks: {
                        color: '#7b8792',
                        stepSize: chartGroupMode === 'alltime' ? undefined : 1,
                        maxTicksLimit: chartGroupMode === 'alltime' ? 8 : undefined,
                        maxRotation: 0,
                        precision: chartGroupMode === 'alltime' ? undefined : 0,
                        callback: xTickCallback,
                    },
                    grid: { color: '#232b33' },
                },
                y: { ticks: { color: '#7b8792' }, grid: { color: '#232b33' }, beginAtZero: true, max: 300 },
            },
        },
    };
}

sideToggleBtn.addEventListener('click', () => {
    sideEl.classList.toggle('open');
    sideToggleBtn.classList.toggle('panel-open');
});

openBtn.addEventListener('click', () => {
    const { games, title } = getCurrentStatsContext();
    allGames = games;
    advancedRange = 'all';
    rangeBtns.forEach(b => b.classList.toggle('active', b.dataset.range === 'all'));
    titleEl.textContent = title;
    sideEl.classList.remove('open');
    sideToggleBtn.classList.remove('panel-open');
    setStatsPanelVisible(false); // close/hide the mini panel + its toggle so they don't overlap
    overlay.style.display = 'block';
    render();
});

backBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
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
        y: minY, // raw anchor — no manual offset here
    };
};