// liveStorage.js
const STORAGE_KEY = 'liveGame:v2'; // bumped — v1's shape (standingPins only) is incompatible

export function saveLiveGameState(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // storage full/disabled — fail silently, it's just a convenience feature
    }
}

export function loadLiveGameState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function clearLiveGameState() {
    localStorage.removeItem(STORAGE_KEY);
}