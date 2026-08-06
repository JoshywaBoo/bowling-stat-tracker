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