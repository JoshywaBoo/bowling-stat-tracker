// live.js
// Host module for the live-tracking flow. For now this just mounts a
// pin rack you can click through to try it out — the actual
// turn-by-turn frame logic comes next.

import { renderPinRack, allPinsStanding, pinsDownCount } from './pinRack.js';

const pinRackContainer = document.getElementById('pin-rack');
const readoutEl = document.getElementById('pin-rack-readout');
const resetBtn = document.getElementById('pin-rack-reset-btn');

let standingPins = allPinsStanding();

function render() {
    renderPinRack(pinRackContainer, standingPins, handleToggle);
    const down = pinsDownCount(standingPins);
    readoutEl.textContent = `${down} pin${down === 1 ? '' : 's'} down`;
}

function handleToggle(pinNumber) {
    standingPins[pinNumber - 1] = !standingPins[pinNumber - 1];
    render();
}

resetBtn.addEventListener('click', () => {
    standingPins = allPinsStanding();
    render();
});

render();