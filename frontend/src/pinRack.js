// pinRack.js
// Renders a 2D bowling pin diagram (standard 1-2-3-4 triangle layout) as
// an SVG, letting the user tap individual pins to toggle them between
// "standing" and "knocked down". This is a display+input primitive only —
// it doesn't know about frames, rolls, or scoring. The caller owns the
// pin state and passes it in; renderPinRack just draws it and reports
// taps via onToggle, the same rebuild-from-state pattern
// renderEditableFrames() uses in frames.js.

// Back row (7 8 9 10) at the top, front pin (1) at the bottom — mirrors
// how the pins sit on the lane relative to the bowler. Index = pin
// number - 1, so standingPins[0] is pin 1, standingPins[9] is pin 10.
const PIN_POSITIONS = [
    { number: 1, x: 100, y: 130 },  // row 4 (front)
    { number: 2, x: 82, y: 96 },   // row 3
    { number: 3, x: 118, y: 96 },
    { number: 4, x: 64, y: 62 },   // row 2
    { number: 5, x: 100, y: 62 },
    { number: 6, x: 136, y: 62 },
    { number: 7, x: 46, y: 28 },   // row 1 (back)
    { number: 8, x: 82, y: 28 },
    { number: 9, x: 118, y: 28 },
    { number: 10, x: 154, y: 28 },
];

const PIN_RADIUS = 15;

/**
 * Renders a pin rack into `container`.
 *
 * @param {HTMLElement} container - existing contents are replaced.
 * @param {boolean[]} standingPins - length-10 array, index 0 = pin 1 ...
 *   index 9 = pin 10. true = still standing, false = knocked down.
 * @param {(pinNumber: number) => void} onToggle - called with the
 *   1-indexed pin number when the user taps/activates a pin. This
 *   function does NOT mutate standingPins itself — the caller updates
 *   its own state and calls renderPinRack again to redraw.
 */
export function renderPinRack(container, standingPins, onToggle) {
    container.innerHTML = '';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 150');
    svg.classList.add('pin-rack-svg');

    PIN_POSITIONS.forEach(({ number, x, y }) => {
        const standing = standingPins[number - 1];

        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.classList.add('pin', standing ? 'pin-standing' : 'pin-down');
        group.setAttribute('tabindex', '0');
        group.setAttribute('role', 'button');
        group.setAttribute('aria-pressed', String(standing));
        group.setAttribute('aria-label', `Pin ${number}${standing ? ', standing' : ', knocked down'}`);

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', PIN_RADIUS);
        group.appendChild(circle);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', x);
        label.setAttribute('y', y);
        label.textContent = number;
        group.appendChild(label);

        const toggle = () => onToggle(number);
        group.addEventListener('click', toggle);
        group.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
            }
        });

        svg.appendChild(group);
    });

    container.appendChild(svg);
}

/** Fresh "all pins standing" state — the starting state of any frame. */
export function allPinsStanding() {
    return new Array(10).fill(true);
}

/**
 * Inverse of pin-number extraction: given a list of 1-based pin numbers,
 * returns the length-10 standing-pins boolean array with just those pins
 * standing. Used to visualize a known combo (e.g. a split) via
 * renderMiniPinRack without needing real pin_history for it.
 */
export function standingArrayFromPins(pinNumbers) {
    const arr = new Array(10).fill(false);
    pinNumbers.forEach(p => { arr[p - 1] = true; });
    return arr;
}

/** How many pins are down right now — this is what a roll symbol needs. */
export function pinsDownCount(standingPins) {
    return standingPins.filter((standing) => !standing).length;
}

/**
 * Given the pin_history entries for ONE frame (array of arrays of 1-based
 * knocked-pin numbers, one per roll), reconstructs the standing-pins state
 * AFTER each roll. Whenever a roll knocks down every remaining pin (a
 * strike, or a spare/bonus completing the rack), the next roll starts
 * fresh — this needs no knowledge of frame position or roll symbols since
 * pin_history already records exactly which pins fell.
 */
export function frameRollStates(frameKnockedPins) {
    const states = [];
    let rack = allPinsStanding();
    frameKnockedPins.forEach((knockedPins) => {
        rack = rack.map((standing, i) => standing && !knockedPins.includes(i + 1));
        states.push(rack);
        if (rack.every((standing) => !standing)) {
            rack = allPinsStanding();
        }
    });
    return states;
}

/**
 * Like frameRollStates, but only returns the standing-pins state after
 * each FRESH-RACK-OPENING roll that left something standing — i.e. every
 * "leave" in this frame. A strike or a fully-converted spare produces no
 * entry (nothing left standing). Frame 10's mid-frame resets are handled
 * the same way frameRollStates does, so a leave right after a strike/spare
 * reset is captured too.
 */
export function frameLeaves(frameKnockedPins) {
    const leaves = [];
    let rack = allPinsStanding();
    frameKnockedPins.forEach((knockedPins) => {
        const wasFreshStart = rack.every(Boolean);
        rack = rack.map((standing, i) => standing && !knockedPins.includes(i + 1));
        if (wasFreshStart && rack.some(Boolean)) {
            leaves.push([...rack]);
        }
        if (rack.every((standing) => !standing)) {
            rack = allPinsStanding();
        }
    });
    return leaves;
}

/**
 * Same visual as renderPinRack but read-only: no click/keyboard handlers,
 * no tabindex. Used for small historical snapshots, e.g. the expanded
 * per-roll view in game history.
 */
export function renderMiniPinRack(container, standingPins) {
    container.innerHTML = '';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 150');
    svg.classList.add('pin-rack-mini-svg');

    PIN_POSITIONS.forEach(({ number, x, y }) => {
        const standing = standingPins[number - 1];

        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.classList.add('pin', standing ? 'pin-standing' : 'pin-down');

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', PIN_RADIUS);
        group.appendChild(circle);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', x);
        label.setAttribute('y', y);
        label.textContent = number;
        group.appendChild(label);

        svg.appendChild(group);
    });

    container.appendChild(svg);
}