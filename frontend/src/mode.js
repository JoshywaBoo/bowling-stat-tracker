// mode.js
// Controls which "add a game" entry point is showing: the mode picker,
// the photo-upload flow, or the live-tracking flow. Only one is visible
// at a time; the other shared panels (#status, #result, history) are
// untouched by this module.

const modePicker = document.getElementById('mode-picker');
const uploadSection = document.getElementById('upload-section');
const liveSection = document.getElementById('live-section');

const modeUploadBtn = document.getElementById('mode-upload-btn');
const modeLiveBtn = document.getElementById('mode-live-btn');
const uploadBackBtn = document.getElementById('upload-back-btn');
const liveBackBtn = document.getElementById('live-back-btn');

export function showModePicker() {
    modePicker.classList.remove('hidden');
    uploadSection.classList.remove('visible');
    liveSection.classList.remove('visible');
}

function showUploadSection() {
    modePicker.classList.add('hidden');
    uploadSection.classList.add('visible');
    liveSection.classList.remove('visible');
}

export function showLiveSection() {
    modePicker.classList.add('hidden');
    liveSection.classList.add('visible');
    uploadSection.classList.remove('visible');
}

modeUploadBtn.addEventListener('click', showUploadSection);
modeLiveBtn.addEventListener('click', showLiveSection);
uploadBackBtn.addEventListener('click', showModePicker);
liveBackBtn.addEventListener('click', showModePicker);