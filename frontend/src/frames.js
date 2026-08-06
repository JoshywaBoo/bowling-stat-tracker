// frames.js
// parsing roll symbols into bowling frames,
// rendering the editable frame boxes, and score calculation

import { playerRowsEl } from './main.js';

// Only these symbols are ever valid on a bowling scoreboard roll.
// Used by: sanitizeText, keydown handler (frames section)
const ALLOWED_CHARS = /[^X1-9/\-F]/gi;

export const ALLOWED_SYMBOLS = /^[X1-9/\-F]$/i;

// Each entry: { name: string, rollSymbols: string[], pendingCursor: {global}|null, selected: boolean }
// Single-player flows (editing a saved game) just use a 1-item array.
export let players = [];

export function setPlayers(newPlayers) {
    players = newPlayers;
}

// ------------------------------------------------------ frame grouping
// Mirrors parse_frames() in app/ocr.py exactly, plus one safety net: if
// more symbols exist than a legal 10-frame game can hold (shouldn't
// happen with real data, but can happen transiently while editing),
// extra symbols are grouped as additional 2-symbol frames instead of
// being silently dropped, so nothing the user typed disappears.
export function parseFrames(symbols) {
    const frames = [];
    let i = 0;

    for (let frameNum = 1; frameNum <= 10 || i < symbols.length; frameNum++) {
        if (i >= symbols.length) break;

        let chunk;
        if (frameNum < 10) {
            if (symbols[i] === 'X') {
                chunk = [symbols[i]];
            } else {
                chunk = symbols.slice(i, i + 2);
            }
        } else if (frameNum === 10) {
            // Editing needs a stable box, not one that reclassifies mid-typing.
            // Just take up to 3 remaining symbols — legality (strike/spare
            // required for a 3rd roll) is validated server-side on save, not here.
            chunk = symbols.slice(i, i + 3);
        } else {
            // Overflow past frame 10 - not a real bowling frame, just a safety
            // net so extra typed symbols stay visible instead of vanishing.
            chunk = symbols.slice(i, i + 2);
        }

        i += chunk.length;
        frames.push(chunk.join(''));
    }

    return frames;
}

// removes all white space from the frame string (a string of frames representing a bowling game)
export function flattenFrameString(frameString) {
    return frameString.replace(/\s+/g, '').split('');
}

// ------------------------------------------------- split-marker encoding
// Splits are a cosmetic annotation (first roll of a frame left a split,
// or for frame 10 specifically, first AND third roll each left one).
// They're encoded directly into the saved frame_string using a leading
// '*' immediately before the marked character, e.g. "*7/" or, for a
// frame 10 with two splits, "*X5*/". This keeps everything in the one
// string field the backend already stores, so it round-trips through
// save/edit/history without needing a schema change.
export function annotateFrameWithSplits(frame, markedIndices) {
    if (!markedIndices || !markedIndices.length) return frame;
    const markedSet = new Set(markedIndices);
    return frame
        .split('')
        .map((ch, i) => (markedSet.has(i) ? '*' + ch : ch))
        .join('');
}

// Parses a single frame token (e.g. "*7/" or "X") into its bare characters
// plus which of those characters carried a '*' split marker. Same logic
// parseAnnotatedFrameString uses per-frame, extracted for reuse in stats.
export function parseFrameChars(frame) {
    const marks = [];
    const chars = [];
    for (let i = 0; i < frame.length; i++) {
        if (frame[i] === '*') {
            marks.push(chars.length);
        } else {
            chars.push(frame[i]);
        }
    }
    return { chars, marks };
}

// Inverse of the above: strips '*' markers out of a saved frame_string,
// returning both the clean roll symbols (for scoring/editing) and a
// { frameIndex: state } map describing which frames were marked.
// splitFrames[idx] is now the array of roll-indices (within that frame)
// that carry a split marker - e.g. [0], [1], [2], or [0, 2] - rather than
// a collapsed 0/1/2 "state" number. This lets any individual roll in
// frame 10 (or combinations, e.g. from OCR) be marked independently.
export function parseAnnotatedFrameString(frameString) {
    const frames = (frameString || '').trim().length ? frameString.trim().split(/\s+/) : [];
    const rollSymbols = [];
    const splitFrames = {};

    frames.forEach((frame, idx) => {
        const marks = [];
        const chars = [];
        for (let i = 0; i < frame.length; i++) {
            if (frame[i] === '*') {
                marks.push(chars.length);
            } else {
                chars.push(frame[i]);
            }
        }
        if (marks.length) {
            splitFrames[idx] = marks;
        }
        rollSymbols.push(...chars);
    });

    return { rollSymbols, splitFrames };
}

// For display-only contexts (history list) where we just want to render
// marked characters in red without needing the parsed symbol array.
export function stripSplitMarkers(str) {
    return (str || '').replace(/\*/g, '');
}

// A frame counts as "open" if it's neither a strike nor a spare - same
// rule used by computeStats' per-frame classification.
export function isFrameOpen(frame) {
    const upper = (frame || '').toUpperCase();
    return upper[0] !== 'X' && upper[1] !== '/';
}

export function isCleanGame(frameString) {
    const frames = stripSplitMarkers(frameString).trim().split(/\s+/).filter(Boolean);
    return frames.length > 0 && frames.every(f => !isFrameOpen(f));
}

// Shared per-character color rules for a roll symbol: split marks win
// (red), then strikes (cyan), then everything else (amber). Used by
// both the editable frame overlay and the read-only history list so
// the two stay in sync.
export function rollCharStyle(ch, marked) {
    if (marked) {
        return { color: 'var(--danger)', shadow: '0 0 8px rgba(255, 93, 93, 0.4)' };
    }
    const isX = ch.toUpperCase() === 'X';
    return isX
        ? { color: 'var(--cyan)', shadow: '0 0 8px rgba(41, 230, 200, 0.4)' }
        : { color: 'var(--amber)', shadow: '0 0 8px var(--amber-glow)' };
}

export function frameStringToHtml(frameString) {
    return (frameString || '').split(' ').map(frame => {
        let out = '';
        for (let i = 0; i < frame.length; i++) {
            if (frame[i] === '*') {
                const ch = frame[i + 1] || '';
                const style = rollCharStyle(ch, true);
                out += `<span style="color:${style.color}; text-shadow:${style.shadow};">${ch}</span>`;
                i += 1;
            } else {
                const ch = frame[i];
                const style = rollCharStyle(ch, false);
                out += `<span style="color:${style.color}; text-shadow:${style.shadow};">${ch}</span>`;
            }
        }
        return out;
    }).join(' ');
}

// Builds the colored-overlay markup shown over a frame-input whenever
// that frame has a split marked (the input's own text is made
// transparent so only this overlay is visible, while the input keeps
// handling actual typing/caret/selection). Each character is colored
// independently, so e.g. a 10th-frame box like "X72" only turns the
// literal "X" cyan — the "7" and "2" stay amber.
export function buildFrameOverlayHtml(frame, markedIndices) {
    const markedSet = new Set(markedIndices || []);
    return frame.split('').map((ch, i) => {
        const marked = markedSet.has(i);
        const style = rollCharStyle(ch, marked);
        return `<span style="color:${style.color}; text-shadow:${style.shadow};">${ch}</span>`;
    }).join('');
}

export function parseRollValue(char) {
    if (!char) return 0;
    const normalized = char.toUpperCase();
    if (normalized === 'X') return 10;
    if (normalized === '-' || normalized === 'F') return 0;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : 0;
}

export function sanitizeText(raw) {
    return raw.toUpperCase().replace(ALLOWED_CHARS, '');
}

// Rebuilds the frame boxes from rollSymbols (never from what's currently
// in the DOM) and restores the caret to pendingCursor's position in the
// new layout, even if that position now falls in a different box.
// Keeps rollSymbols capped at whatever a legal 10-frame game can hold.
// If an edit pushes symbols past frame 10 (e.g. the OCR misread a digit
// from the running score total as an extra roll), the overflow is
// dropped rather than shown as a phantom 11th frame.
function enforceCapacity(player) {
    const frames = parseFrames(player.rollSymbols);
    if (frames.length <= 10) return;
    const keepLength = frames.slice(0, 10).reduce((sum, f) => sum + f.length, 0);
    player.rollSymbols = player.rollSymbols.slice(0, keepLength);
    if (player.pendingCursor) {
        player.pendingCursor.global = Math.min(player.pendingCursor.global, player.rollSymbols.length);
    }
}

// Returns which roll-indices in a frame-10 chunk are legal split targets:
// the roll must follow a "fresh rack" (frame start, or previous roll was
// a strike/spare) and must not itself be a strike or a spare-completion —
// both of those clear the rack, so there's no split left standing.
function frame10ValidMarkIndices(rollChars) {
    const valid = [];
    let prevReset = true;
    for (let i = 0; i < rollChars.length; i++) {
        const ch = rollChars[i].toUpperCase();
        const pins = parseRollValue(ch);
        const canSplit = prevReset && pins > 0 && pins < 10; // fresh rack, knocked some down but not all
        if (canSplit) {
            valid.push(i);
        }
        prevReset = (ch === 'X' || ch === '/');
    }
    return valid;
}

export function renderEditableFrames() {
    playerRowsEl.innerHTML = '';
    let totalScore = 0;

    players.forEach((player, playerIdx) => {
        if (!player.splitFrames) player.splitFrames = {};
        enforceCapacity(player);
        const frames = parseFrames(player.rollSymbols);
        const displayFrames = frames.length ? frames : [''];
        const playerScore = calculateBowlingScore(frames.join(' '));
        if (typeof playerScore === 'number') totalScore += playerScore;

        const row = document.createElement('div');
        row.className = 'player-row';

        const main = document.createElement('div');
        main.className = 'player-row-main';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'player-name-input';
        nameInput.placeholder = 'Player name';
        nameInput.value = player.name;
        nameInput.style.marginBottom = '0';
        nameInput.addEventListener('input', () => {
            player.name = nameInput.value;
        });

        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'player-row-score';
        scoreSpan.textContent = typeof playerScore === 'number' ? playerScore : '—';
        scoreSpan.style.marginLeft = 'auto';
        scoreSpan.style.minWidth = '32px';
        scoreSpan.style.textAlign = 'right';

        const nameRow = document.createElement('div');
        nameRow.style.display = 'flex';
        nameRow.style.alignItems = 'center';
        nameRow.style.marginBottom = '8px';
        nameRow.style.width = '100%';
        nameRow.appendChild(nameInput);
        nameRow.appendChild(scoreSpan);
        main.appendChild(nameRow);

        const framesRow = document.createElement('div');
        framesRow.className = 'frames';

        let offset = 0;
        const inputs = [];

        displayFrames.forEach((f, idx) => {
            const cell = document.createElement('div');
            cell.className = 'frame-cell';

            const isFrame10 = idx === 9;
            const markedIndices = player.splitFrames[idx] || [];

            const n = document.createElement('span');
            n.className = 'frame-n' + (markedIndices.length ? ' split-marked' : '');
            n.textContent = idx + 1;
            n.title = isFrame10
                ? 'Click to cycle: none → 1st roll → 2nd roll → 3rd roll → 1st + 3rd roll'
                : 'Click to toggle split';
            n.addEventListener('click', (e) => {
                e.stopPropagation();
                const current = player.splitFrames[idx] || [];

                if (!isFrame10) {
                    const rollChar = f[0]; // only roll 0 of the frame can carry the split mark
                    const pins = parseRollValue(rollChar);
                    const canSplit = pins > 0 && pins < 10; // not a strike, not a miss/gutter
                    if (current.length) {
                        // Always allow clearing an existing mark, even if it's now invalid.
                        delete player.splitFrames[idx];
                        renderEditableFrames();
                        return;
                    }
                    if (!canSplit) return; // strike or miss — nothing to split
                    player.splitFrames[idx] = [0];
                    renderEditableFrames();
                    return;
                }

                // Frame 10: cycle none -> roll1 -> roll2 -> roll3 -> roll1+roll3 -> none,
                // skipping any state that references a roll that doesn't exist yet OR
                // isn't a legal split target (strike, spare-completion, or not a fresh rack).
                const validIdx = new Set(frame10ValidMarkIndices(f.split('')));
                const sameSet = (a, b) => a.length === b.length && a.every(v => b.includes(v));
                const sequence = [[], [0], [1], [2], [0, 2]];
                const currentPos = sequence.findIndex(s => sameSet(s, current));
                let nextPos = (currentPos === -1 ? 0 : currentPos) + 1;

                while (nextPos < sequence.length && sequence[nextPos].some(i => !validIdx.has(i))) {
                    nextPos++;
                }
                const next = nextPos < sequence.length ? sequence[nextPos] : [];

                if (next.length) {
                    player.splitFrames[idx] = next;
                } else {
                    delete player.splitFrames[idx];
                }
                renderEditableFrames();
            });

            const inputWrap = document.createElement('div');
            inputWrap.className = 'frame-input-wrap';

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'frame-input has-overlay';
            input.value = f;
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.dataset.player = playerIdx;
            input.dataset.start = offset;
            input.dataset.len = f.length;

            input.addEventListener('input', () => {
                const start = parseInt(input.dataset.start, 10);
                const len = parseInt(input.dataset.len, 10);
                const clean = sanitizeText(input.value);
                player.rollSymbols.splice(start, len, ...clean.split(''));
                player.pendingCursor = { global: start + clean.length };
                renderEditableFrames();
            });

            inputWrap.appendChild(input);

            const overlay = document.createElement('div');
            overlay.className = 'frame-overlay';
            overlay.innerHTML = buildFrameOverlayHtml(f, markedIndices);
            inputWrap.appendChild(overlay);

            offset += f.length;
            cell.appendChild(n);
            cell.appendChild(inputWrap);
            framesRow.appendChild(cell);
            inputs.push(input);
        });

        main.appendChild(framesRow);
        row.appendChild(main);

        const selectWrap = document.createElement('div');
        selectWrap.className = 'player-select';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = player.selected;
        checkbox.title = 'Include this player when saving';
        checkbox.addEventListener('change', () => {
            player.selected = checkbox.checked;
        });
        selectWrap.appendChild(checkbox);
        row.appendChild(selectWrap);

        playerRowsEl.appendChild(row);
        restoreCursor(inputs, player);
    });
}

function restoreCursor(inputs, player) {
    if (!player.pendingCursor || !inputs.length) return;
    let cum = 0;
    let target = inputs[inputs.length - 1];
    let localPos = target.value.length;

    for (const input of inputs) {
        const len = input.value.length;
        if (player.pendingCursor.global <= cum + len) {
            target = input;
            localPos = player.pendingCursor.global - cum;
            break;
        }
        cum += len;
    }

    target.focus();
    target.setSelectionRange(localPos, localPos);
}

// Given a focused frame-input and its current selection, returns the
// equivalent [start, end] positions in the flat rollSymbols array.
function globalSelection(input) {
    const base = parseInt(input.dataset.start, 10);
    return [base + input.selectionStart, base + input.selectionEnd];
}

export function validateGame(symbols) {
    const frames = parseFrames(symbols);

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i].toUpperCase();
        const isLast = i === frames.length - 1;
        const isFrame10 = i === 9; // frame 10 has different rules regardless of whether more frames follow

        if (!frame) return `Frame ${i + 1} is empty.`;

        if (!isFrame10) {
            if (frame === 'X') continue;

            // If this is the last frame typed so far and only 1 symbol exists,
            // it's just in-progress (e.g. user typed "7" and hasn't rolled again yet) — not invalid.
            if (frame.length === 1) {
                if (isLast) continue;
                return `Frame ${i + 1} is incomplete.`;
            }

            const [first, second] = frame;
            if (first === '/') {
                return `Frame ${i + 1}: spare can't be the first roll.`;
            }

            if (second === '/') continue; // spare always valid

            if (parseRollValue(first) + parseRollValue(second) > 10) {
                return `Frame ${i + 1}: rolls can't total more than 10 pins (got "${frame}").`;
            }
            continue;
        }

        // Frame 10 - only fully validate once it looks "finished" for its case;
        // partial frame 10s (still being typed) are left alone.
        const chars = frame.split('');

        if (chars[0] === '/') {
            return `Frame 10: can't start with a spare (got "${frame}").`;
        }

        if (chars[0] === 'X') {
            if (chars.length < 2) continue; // still typing
            if (chars[1] !== 'X' && chars[1] !== '/' && chars.length === 3 &&
                parseRollValue(chars[1]) + parseRollValue(chars[2]) > 10) {
                return `Frame 10: 2nd and 3rd rolls can't total more than 10 pins.`;
            }
        } else if (chars.length >= 2 && chars[1] === '/') {
            continue; // spare, bonus roll (if present) is always valid
        } else if (chars.length === 2) {
            if (parseRollValue(chars[0]) + parseRollValue(chars[1]) > 10) {
                return `Frame 10: rolls can't total more than 10 pins (got "${frame}").`;
            }
        }
        // chars.length === 1 or 0: still typing, nothing to validate yet
    }

    return null; // valid so far
}

export function calculateBowlingScore(frameString) {
    const frames = frameString.trim().split(/\s+/).filter(Boolean);
    if (!frames.length) return '—';

    const rolls = [];

    frames.forEach((frame, index) => {
        const normalized = frame.toUpperCase();
        const chars = normalized.split('');
        const isLastFrame = index === frames.length - 1;

        if (isLastFrame) {
            if (chars[0] === 'X') {
                rolls.push(10);
                const secondChar = chars[1] || '';
                const thirdChar = chars[2] || '';

                if (secondChar === 'X') {
                    rolls.push(10);
                } else if (secondChar === '/') {
                    rolls.push(10 - rolls[rolls.length - 1]);
                } else {
                    rolls.push(parseRollValue(secondChar));
                }

                if (thirdChar) {
                    if (thirdChar === '/') {
                        const previousRoll = rolls[rolls.length - 1];
                        rolls.push(10 - previousRoll);
                    } else {
                        rolls.push(parseRollValue(thirdChar));
                    }
                }
                return;
            }

            const firstRoll = parseRollValue(chars[0]);
            rolls.push(firstRoll);

            if (chars[1] === '/') {
                rolls.push(10 - firstRoll);
            } else {
                rolls.push(parseRollValue(chars[1] || ''));
            }

            if (chars[2]) {
                const thirdChar = chars[2];
                if (thirdChar === '/') {
                    const previousRoll = rolls[rolls.length - 1];
                    rolls.push(10 - previousRoll);
                } else {
                    rolls.push(parseRollValue(thirdChar));
                }
            }
            return;
        }

        if (normalized === 'X') {
            rolls.push(10);
            return;
        }

        const firstRoll = parseRollValue(chars[0]);
        if (chars[1] === '/') {
            rolls.push(firstRoll, 10 - firstRoll);
        } else {
            rolls.push(firstRoll, parseRollValue(chars[1] || ''));
        }
    });

    let score = 0;
    let rollIndex = 0;

    for (let frameNum = 0; frameNum < Math.min(frames.length, 10); frameNum++) {
        const frame = frames[frameNum];
        if (!frame) break;

        const normalized = frame.toUpperCase();
        const isLastFrame = frameNum === frames.length - 1;

        if (isLastFrame) {
            const frameRolls = rolls.slice(rollIndex, rollIndex + 3);
            score += frameRolls.reduce((sum, value) => sum + value, 0);
            break;
        }

        if (normalized === 'X') {
            score += 10 + rolls[rollIndex + 1] + rolls[rollIndex + 2];
            rollIndex += 1;
            continue;
        }

        if (normalized.length > 1 && normalized[1] === '/') {
            score += 10 + rolls[rollIndex + 2];
            rollIndex += 2;
            continue;
        }

        score += rolls[rollIndex] + rolls[rollIndex + 1];
        rollIndex += 2;
    }

    return score;
}

document.addEventListener('keydown', (e) => {
    const input = e.target;
    if (!input.classList.contains('frame-input')) return;

    const playerIdx = parseInt(input.dataset.player, 10);
    const player = players[playerIdx];
    const [gStart, gEnd] = globalSelection(input);

    if (e.key === 'Backspace') {
        e.preventDefault();
        if (gStart !== gEnd) {
            player.rollSymbols.splice(gStart, gEnd - gStart);
            player.pendingCursor = { global: gStart };
        } else if (gStart > 0) {
            player.rollSymbols.splice(gStart - 1, 1);
            player.pendingCursor = { global: gStart - 1 };
        } else {
            return;
        }
        renderEditableFrames();
        return;
    }

    if (e.key === 'Delete') {
        e.preventDefault();
        if (gStart !== gEnd) {
            player.rollSymbols.splice(gStart, gEnd - gStart);
            player.pendingCursor = { global: gStart };
        } else if (gStart < player.rollSymbols.length) {
            player.rollSymbols.splice(gStart, 1);
            player.pendingCursor = { global: gStart };
        } else {
            return;
        }
        renderEditableFrames();
        return;
    }

    // Arrow-key box jumping now needs to stay within THIS player's inputs only.
    if (e.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0) {
        const rowInputs = Array.from(playerRowsEl.querySelectorAll(`.frame-input[data-player="${playerIdx}"]`));
        const idx = rowInputs.indexOf(input) - 1;
        if (idx >= 0) {
            e.preventDefault();
            rowInputs[idx].focus();
            const end = rowInputs[idx].value.length;
            rowInputs[idx].setSelectionRange(end, end);
        }
        return;
    }
    if (e.key === 'ArrowRight' && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
        const rowInputs = Array.from(playerRowsEl.querySelectorAll(`.frame-input[data-player="${playerIdx}"]`));
        const idx = rowInputs.indexOf(input) + 1;
        if (idx < rowInputs.length) {
            e.preventDefault();
            rowInputs[idx].focus();
            rowInputs[idx].setSelectionRange(0, 0);
        }
        return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const upper = e.key.toUpperCase();
        if (!ALLOWED_SYMBOLS.test(upper)) {
            e.preventDefault();
            return;
        }
        e.preventDefault();
        player.rollSymbols.splice(gStart, gEnd - gStart, upper);
        player.pendingCursor = { global: gStart + 1 };
        renderEditableFrames();
    }
});