// nav.js

import { API_BASE, appContent } from './main.js';
import { playersContent, loadPlayersList } from './players.js';
import { applyHistoryFilter } from './history.js';
import { setStatsPanelVisible } from './stats.js';
import { showLoggedOut, authPanel, verifyPanel, forgotPanel } from './auth.js';

const navLinkMe = document.getElementById('nav-link-me');
const navLinkPlayers = document.getElementById('nav-link-players');
const navLoginBtn = document.getElementById('nav-login-btn');
const navDropdown = document.getElementById('nav-dropdown');
const navLogoutBtn = document.getElementById('nav-logout-btn');

export const navLoginTrigger = document.getElementById('nav-login-trigger');
export const navAvatarContainer = document.getElementById('nav-avatar-container');
export const navAvatar = document.getElementById('nav-avatar');
export const navDropdownEmail = document.getElementById('nav-dropdown-email');
export const historySearch = document.getElementById('history-search');

let navDropdownOpen = false;

export let currentView = 'players';
export let isLoggedIn = false;

export function setIsLoggedIn(value) {
    isLoggedIn = value;
    document.body.classList.toggle('logged-in', value);
}

export function setNavView(view) {
    currentView = view;
    navLinkMe.classList.toggle('active', view === 'me');
    navLinkPlayers.classList.toggle('active', view === 'players');
    updateAppVisibility();
}

export function setNavDropdownOpen(open) {
    navDropdownOpen = open;
    navDropdown.style.display = open ? 'block' : 'none';
}

export function updateAppVisibility() {
    if (currentView === 'me') {
        playersContent.style.display = 'none';
        if (isLoggedIn) {
            appContent.classList.add('visible');
            authPanel.classList.remove('visible');
            applyHistoryFilter();
            setStatsPanelVisible(true);
        } else {
            forgotPanel.classList.remove('visible');
            appContent.classList.remove('visible');
            authPanel.classList.add('visible');
            setStatsPanelVisible(false);
        }
    } else {
        appContent.classList.remove('visible');
        authPanel.classList.remove('visible');
        verifyPanel.classList.remove('visible');
        forgotPanel.classList.remove('visible');
        setStatsPanelVisible(false);
    }

    if (currentView === 'players') {
        playersContent.style.display = '';
        loadPlayersList();
    } else {
        playersContent.style.display = 'none';
    }
}

navLinkMe.addEventListener('click', () => setNavView('me'));

navLinkPlayers.addEventListener('click', () => setNavView('players'));

navLoginBtn.addEventListener('click', () => setNavView('me'));

navAvatarContainer.addEventListener('click', (e) => {
    e.stopPropagation();
    setNavDropdownOpen(!navDropdownOpen);
});

document.addEventListener('click', () => {
    if (navDropdownOpen) setNavDropdownOpen(false);
});

navLogoutBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include' });
    showLoggedOut();
});

historySearch.addEventListener('input', applyHistoryFilter);