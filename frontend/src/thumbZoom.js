// thumbZoom.js
// Thumbnail zoom/pan for the uploaded scoreboard preview. Lets the user
// inspect scoreboard detail without changing the fixed-size preview box.
// Click zooms in centered on the click point (click again, or drag, to
// interact further); scroll wheel zooms centered on the cursor; drag pans
// once zoomed. Resets to 1x whenever a new image is loaded into #result-thumb.
//
// Math note: the image transform uses transform-origin: 0 0 (top-left),
// so all cursor/click coordinates below are measured relative to the
// wrap's top-left corner (NOT its center), and the pan clamp is the
// asymmetric range [wrapSize * (1 - scale), 0] rather than a symmetric
// +/- range - that's what keeps the image's actual edges reachable.

import { resultThumb } from './main.js';

const thumbZoomWrap = document.getElementById('thumb-zoom-wrap');
const thumbZoomResetBtn = document.getElementById('thumb-zoom-reset');

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_CLICK_SCALE = 2;
const DRAG_THRESHOLD_PX = 4;

let thumbScale = 1;
let thumbX = 0;
let thumbY = 0;
let thumbDragging = false;
let thumbDragStartX = 0;
let thumbDragStartY = 0;
let thumbDragOriginX = 0;
let thumbDragOriginY = 0;
let thumbMouseDownPos = null;
let thumbDragMoved = false;

function applyThumbTransform() {
    resultThumb.style.transform = `translate(${thumbX}px, ${thumbY}px) scale(${thumbScale})`;
    thumbZoomWrap.classList.toggle('zoomed', thumbScale > 1);
    thumbZoomWrap.style.touchAction = thumbScale > 1 ? 'none' : 'pan-y';
}

function clampThumbPan() {
    const wrapRect = thumbZoomWrap.getBoundingClientRect();
    const minX = wrapRect.width * (1 - thumbScale);
    const minY = wrapRect.height * (1 - thumbScale);
    thumbX = Math.min(0, Math.max(minX, thumbX));
    thumbY = Math.min(0, Math.max(minY, thumbY));
}

export function resetThumbZoom() {
    thumbScale = 1;
    thumbX = 0;
    thumbY = 0;
    applyThumbTransform();
}

thumbZoomResetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetThumbZoom();
});

// Keeps (cursorX, cursorY) - measured relative to the wrap's top-left -
// visually fixed in place while scale changes from thumbScale to newScale.
function zoomTowardPoint(cursorX, cursorY, newScale) {
    const prevScale = thumbScale;
    const scaleRatio = newScale / prevScale;
    thumbX = cursorX - scaleRatio * (cursorX - thumbX);
    thumbY = cursorY - scaleRatio * (cursorY - thumbY);
    thumbScale = newScale;

    if (thumbScale === ZOOM_MIN) {
        thumbX = 0;
        thumbY = 0;
    } else {
        clampThumbPan();
    }
    applyThumbTransform();
}

thumbZoomWrap.addEventListener('wheel', (e) => {
    if (!resultThumb.getAttribute('src')) return;
    e.preventDefault();

    const wrapRect = thumbZoomWrap.getBoundingClientRect();
    const cursorX = e.clientX - wrapRect.left;
    const cursorY = e.clientY - wrapRect.top;

    const delta = -e.deltaY * 0.0015;
    const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, thumbScale + delta * thumbScale));
    zoomTowardPoint(cursorX, cursorY, newScale);
}, { passive: false });

thumbZoomWrap.addEventListener('mousedown', (e) => {
    if (!resultThumb.getAttribute('src')) return;
    if (e.target.closest('.thumb-zoom-reset')) return;
    thumbMouseDownPos = { x: e.clientX, y: e.clientY };
    thumbDragMoved = false;

    if (thumbScale > 1) {
        thumbDragging = true;
        thumbZoomWrap.classList.add('dragging');
        thumbDragStartX = e.clientX;
        thumbDragStartY = e.clientY;
        thumbDragOriginX = thumbX;
        thumbDragOriginY = thumbY;
    }
});

window.addEventListener('mousemove', (e) => {
    if (thumbMouseDownPos) {
        const dx = e.clientX - thumbMouseDownPos.x;
        const dy = e.clientY - thumbMouseDownPos.y;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) thumbDragMoved = true;
    }

    if (!thumbDragging) return;
    thumbX = thumbDragOriginX + (e.clientX - thumbDragStartX);
    thumbY = thumbDragOriginY + (e.clientY - thumbDragStartY);
    clampThumbPan();
    applyThumbTransform();
});

window.addEventListener('mouseup', (e) => {
    if (thumbDragging) {
        thumbDragging = false;
        thumbZoomWrap.classList.remove('dragging');
    }

    // A "click" is a mousedown+mouseup with no meaningful movement between
    // them - toggle zoom in that case. A real drag (pan) doesn't also toggle.
    if (thumbMouseDownPos && !thumbDragMoved && resultThumb.getAttribute('src')) {
        const wrapRect = thumbZoomWrap.getBoundingClientRect();
        const clickX = e.clientX - wrapRect.left;
        const clickY = e.clientY - wrapRect.top;

        if (thumbScale > 1) {
            resetThumbZoom();
        } else {
            zoomTowardPoint(clickX, clickY, ZOOM_CLICK_SCALE);
        }
    }

    thumbMouseDownPos = null;
});

// ---- touch support: pinch to zoom, one-finger pan, tap to zoom ----
let touchStartDistance = null;
let touchStartScale = 1;
let touchPanStartX = 0, touchPanStartY = 0;
let touchOriginX = 0, touchOriginY = 0;
let touchTapPos = null;
let touchMoved = false;

function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
}

function getTouchMidpoint(touches, wrapRect) {
    return {
        x: (touches[0].clientX + touches[1].clientX) / 2 - wrapRect.left,
        y: (touches[0].clientY + touches[1].clientY) / 2 - wrapRect.top,
    };
}

thumbZoomWrap.addEventListener('touchstart', (e) => {
    if (!resultThumb.getAttribute('src')) return;
    if (e.target.closest('.thumb-zoom-reset')) return;

    if (e.touches.length === 2) {
        e.preventDefault();
        touchStartDistance = getTouchDistance(e.touches);
        touchStartScale = thumbScale;
        touchTapPos = null;
        touchMoved = true;
    } else if (e.touches.length === 1) {
        touchTapPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        touchMoved = false;
        if (thumbScale > 1) {
            touchPanStartX = e.touches[0].clientX;
            touchPanStartY = e.touches[0].clientY;
            touchOriginX = thumbX;
            touchOriginY = thumbY;
        }
    }
}, { passive: false });

thumbZoomWrap.addEventListener('touchmove', (e) => {
    if (!resultThumb.getAttribute('src')) return;

    if (e.touches.length === 2 && touchStartDistance) {
        e.preventDefault();
        const wrapRect = thumbZoomWrap.getBoundingClientRect();
        const newDistance = getTouchDistance(e.touches);
        const midpoint = getTouchMidpoint(e.touches, wrapRect);
        const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, touchStartScale * (newDistance / touchStartDistance)));
        zoomTowardPoint(midpoint.x, midpoint.y, newScale);
    } else if (e.touches.length === 1 && thumbScale > 1) {
        e.preventDefault();
        const dx = e.touches[0].clientX - touchPanStartX;
        const dy = e.touches[0].clientY - touchPanStartY;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) touchMoved = true;
        thumbX = touchOriginX + dx;
        thumbY = touchOriginY + dy;
        clampThumbPan();
        applyThumbTransform();
    } else if (e.touches.length === 1 && touchTapPos) {
        const dx = e.touches[0].clientX - touchTapPos.x;
        const dy = e.touches[0].clientY - touchTapPos.y;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) touchMoved = true;
    }
}, { passive: false });

thumbZoomWrap.addEventListener('touchend', (e) => {
    if (!resultThumb.getAttribute('src')) return;

    if (e.touches.length === 0) {
        if (touchStartDistance) {
            touchStartDistance = null;
        } else if (touchTapPos && !touchMoved) {
            const wrapRect = thumbZoomWrap.getBoundingClientRect();
            const tapX = touchTapPos.x - wrapRect.left;
            const tapY = touchTapPos.y - wrapRect.top;
            if (thumbScale > 1) {
                resetThumbZoom();
            } else {
                zoomTowardPoint(tapX, tapY, ZOOM_CLICK_SCALE);
            }
        }
        touchTapPos = null;
        touchMoved = false;
    } else if (e.touches.length === 1) {
        // Went from two fingers to one — reset pinch tracking, allow panning to continue.
        touchStartDistance = null;
        touchPanStartX = e.touches[0].clientX;
        touchPanStartY = e.touches[0].clientY;
        touchOriginX = thumbX;
        touchOriginY = thumbY;
    }
});