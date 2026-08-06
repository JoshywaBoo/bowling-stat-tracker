//auth.js

import { API_BASE } from './main.js';
import {
    setIsLoggedIn, setNavView, updateAppVisibility, navAvatarContainer,
    navLoginTrigger, navAvatar, navDropdownEmail, setNavDropdownOpen
} from './nav.js';
import { loadHistory } from './history.js';
import { resetQueueState } from './uploadQueue.js';

export const authPanel = document.getElementById('auth-panel');
const tabLogin = document.getElementById('tab-login');
const tabSignup = document.getElementById('tab-signup');

const authForm = document.getElementById('auth-form');
const authEmail = document.getElementById('auth-email');
const authEmailLabel = document.getElementById('auth-email-label');
const authUsername = document.getElementById('auth-username');
const usernameField = document.getElementById('username-field');
const authPassword = document.getElementById('auth-password');
const authSubmit = document.getElementById('auth-submit');
const authError = document.getElementById('auth-error');
const forgotPasswordBtn = document.getElementById('forgot-password-btn');

export const verifyPanel = document.getElementById('verify-panel');
const verifyForm = document.getElementById('verify-form');
const verifyCode = document.getElementById('verify-code');
const verifySubmit = document.getElementById('verify-submit');
const verifyError = document.getElementById('verify-error');
const verifyHint = document.getElementById('verify-hint');
const resendCodeBtn = document.getElementById('resend-code-btn');
const verifyBackBtn = document.getElementById('verify-back-btn');

export const forgotPanel = document.getElementById('forgot-panel');
const forgotRequestForm = document.getElementById('forgot-request-form');
const forgotEmail = document.getElementById('forgot-email');
const forgotRequestSubmit = document.getElementById('forgot-request-submit');
const forgotRequestError = document.getElementById('forgot-request-error');
const forgotResetForm = document.getElementById('forgot-reset-form');

const resetCode = document.getElementById('reset-code');
const resetNewPassword = document.getElementById('reset-new-password');
const forgotResetSubmit = document.getElementById('forgot-reset-submit');
const forgotResetError = document.getElementById('forgot-reset-error');
const forgotBackBtn = document.getElementById('forgot-back-btn');

let authMode = 'login';
let pendingVerifyEmail = null;
let pendingResetEmail = null;
let pendingVerifyPassword = null;
let verifyPollTimer = null;

export function setAuthMode(mode) {
    authMode = mode;
    tabLogin.classList.toggle('active', mode === 'login');
    tabSignup.classList.toggle('active', mode === 'signup');
    authSubmit.textContent = mode === 'login' ? 'Sign in' : 'Create account';
    authPassword.autocomplete = mode === 'login' ? 'current-password' : 'new-password';

    if (mode === 'login') {
        authEmailLabel.textContent = 'Username or email';
        authEmail.autocomplete = 'username';
        authEmail.placeholder = '';
        usernameField.style.display = 'none';
        authUsername.required = false;
        authUsername.value = '';
    } else {
        authEmailLabel.textContent = 'Email';
        authEmail.autocomplete = 'email';
        usernameField.style.display = '';
        authUsername.required = true;
    }

    authError.textContent = '';
}

// Error responses come in a few different shapes depending on the endpoint:
//  - plain string (most HTTPException(status, "message") calls)
//  - { message, email } (the unverified-login 403 case)
//  - an array of Pydantic validation errors (422s, e.g. bad email format)
// This normalizes all three into a single displayable string.
function formatAuthError(data) {
    const detail = data?.detail;
    if (!detail) return 'Something went wrong.';
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
        return detail.map(err => err.msg || 'Invalid input').join(' ');
    }
    if (typeof detail === 'object' && detail.message) return detail.message;
    return 'Something went wrong.';
}

function showVerifyScreen(email, hintMsg, password) {
    pendingVerifyEmail = email;
    pendingVerifyPassword = password || null;
    authPanel.classList.remove('visible');
    forgotPanel.classList.remove('visible');
    verifyPanel.classList.add('visible');
    verifyError.textContent = '';
    verifyCode.value = '';
    verifyHint.textContent = hintMsg || `Enter the 6-digit code we emailed to ${email}.`;
    startVerifyPolling();
}

function startVerifyPolling() {
    stopVerifyPolling();
    verifyPollTimer = setInterval(checkVerifyStatus, 3000);
}

function stopVerifyPolling() {
    if (verifyPollTimer) {
        clearInterval(verifyPollTimer);
        verifyPollTimer = null;
    }
}

async function checkVerifyStatus() {
    if (!pendingVerifyEmail) return;
    try {
        const res = await fetch(`${API_BASE}/api/verify-status?email=${encodeURIComponent(pendingVerifyEmail)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.verified) {
            await completeAutoLogin();
        }
    } catch {
        // transient network hiccup - just try again on the next tick
    }
}

async function completeAutoLogin() {
    stopVerifyPolling();
    const email = pendingVerifyEmail;
    const password = pendingVerifyPassword;
    pendingVerifyEmail = null;
    pendingVerifyPassword = null;

    if (!password) {
        // Page was reloaded, or user got here via the login-403 path on a
        // different session - we don't have credentials cached, so just
        // point them at sign-in instead of silently failing.
        setAuthMode('login');
        showLoggedOut();
        authEmail.value = email || '';
        authError.textContent = 'Email verified! Please sign in.';
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ identifier: email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
            setAuthMode('login');
            showLoggedOut();
            authEmail.value = email;
            authError.textContent = 'Email verified! Please sign in.';
            return;
        }
        showLoggedIn(data);
    } catch {
        setAuthMode('login');
        showLoggedOut();
        authEmail.value = email;
        authError.textContent = 'Email verified! Please sign in.';
    }
}

function showForgotScreen() {
    authPanel.classList.remove('visible');
    verifyPanel.classList.remove('visible');
    forgotPanel.classList.add('visible');
    forgotRequestForm.style.display = '';
    forgotResetForm.style.display = 'none';
    forgotRequestError.textContent = '';
    forgotResetError.textContent = '';
    forgotEmail.value = '';
    resetCode.value = '';
    resetNewPassword.value = '';
}

export function showLoggedIn(user) {
    stopVerifyPolling();
    setIsLoggedIn(true);
    navAvatarContainer.style.display = 'block';
    navLoginTrigger.style.display = 'none';
    navAvatar.textContent = (user.email || '?').charAt(0).toUpperCase();
    navDropdownEmail.textContent = user.email;
    setNavDropdownOpen(false);
    verifyPanel.classList.remove('visible');
    forgotPanel.classList.remove('visible');
    loadHistory();
    updateAppVisibility();
}

export function showLoggedOut() {
    stopVerifyPolling();
    setIsLoggedIn(false);
    resetQueueState()
    navAvatarContainer.style.display = 'none';
    navLoginTrigger.style.display = 'block';
    setNavDropdownOpen(false);
    verifyPanel.classList.remove('visible');
    forgotPanel.classList.remove('visible');
    updateAppVisibility();
}

export async function checkSession() {
    try {
        const res = await fetch(`${API_BASE}/api/me`, { credentials: 'include' });
        const user = await res.json();
        if (user) {
            showLoggedIn(user);
            setNavView('me');
        } else {
            showLoggedOut();
            setNavView('players');
        }
    } catch {
        showLoggedOut();
    }
}

tabLogin.addEventListener('click', () => setAuthMode('login'));

tabSignup.addEventListener('click', () => setAuthMode('signup'));

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.textContent = '';
    authSubmit.disabled = true;

    const endpoint = authMode === 'login' ? `${API_BASE}/api/login` : `${API_BASE}/api/signup`;
    const submittedIdentifier = authEmail.value; // email field doubles as "username or email" in login mode
    const submittedUsername = authUsername.value.trim();
    const submittedPassword = authPassword.value;

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(
                authMode === 'login'
                    ? { identifier: submittedIdentifier, password: submittedPassword }
                    : { email: submittedIdentifier, username: submittedUsername, password: submittedPassword }
            ),
        });
        const data = await res.json();

        if (!res.ok) {
            if (res.status === 403 && authMode === 'login') {
                // Account exists but email isn't verified yet.
                // data.detail is now an object: { message, email }
                const verifyEmail = data.detail?.email || submittedIdentifier;
                authPassword.value = '';
                showVerifyScreen(verifyEmail, undefined, submittedPassword);
                return;
            }
            authError.textContent = formatAuthError(data);
            return;
        }

        authPassword.value = '';

        if (authMode === 'signup') {
            showVerifyScreen(submittedIdentifier, 'Account created! Enter the 6-digit code we emailed you to finish signing up.', submittedPassword);
            return;
        }

        showLoggedIn(data);
    } catch {
        authError.textContent = 'Could not reach the server.';
    } finally {
        authSubmit.disabled = false;
    }
});

verifyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pendingVerifyEmail) return;
    verifyError.textContent = '';
    verifySubmit.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/api/verify-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email: pendingVerifyEmail, code: verifyCode.value }),
        });
        const data = await res.json();

        if (!res.ok) {
            verifyError.textContent = formatAuthError(data);
            return;
        }

        pendingVerifyEmail = null;
        pendingVerifyPassword = null;
        stopVerifyPolling();
        showLoggedIn(data); // verify-email also sets the session cookie
    } catch {
        verifyError.textContent = 'Could not reach the server.';
    } finally {
        verifySubmit.disabled = false;
    }
});

resendCodeBtn.addEventListener('click', async () => {
    if (!pendingVerifyEmail) return;
    verifyError.textContent = '';
    resendCodeBtn.disabled = true;

    try {
        await fetch(`${API_BASE}/api/resend-verification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email: pendingVerifyEmail }),
        });
        verifyHint.textContent = `Code resent to ${pendingVerifyEmail}.`;
    } catch {
        verifyError.textContent = 'Could not reach the server.';
    } finally {
        resendCodeBtn.disabled = false;
    }
});

verifyBackBtn.addEventListener('click', () => {
    pendingVerifyEmail = null;
    pendingVerifyPassword = null;
    stopVerifyPolling();
    setAuthMode('login');
    showLoggedOut();
});

forgotPasswordBtn.addEventListener('click', () => {
    showForgotScreen();
});

forgotRequestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    forgotRequestError.textContent = '';
    forgotRequestSubmit.disabled = true;

    const submittedEmail = forgotEmail.value;

    try {
        const res = await fetch(`${API_BASE}/api/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email: submittedEmail }),
        });
        const data = await res.json();

        if (!res.ok) {
            forgotRequestError.textContent = formatAuthError(data);
            return;
        }

        pendingResetEmail = submittedEmail;
        forgotRequestForm.style.display = 'none';
        forgotResetForm.style.display = '';
    } catch {
        forgotRequestError.textContent = 'Could not reach the server.';
    } finally {
        forgotRequestSubmit.disabled = false;
    }
});

forgotResetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pendingResetEmail) return;
    forgotResetError.textContent = '';
    forgotResetSubmit.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/api/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                email: pendingResetEmail,
                code: resetCode.value,
                password: resetNewPassword.value,
            }),
        });
        const data = await res.json();

        if (!res.ok) {
            forgotResetError.textContent = formatAuthError(data) !== 'Something went wrong.' ? formatAuthError(data) : 'Invalid reset code.';
            return;
        }

        pendingResetEmail = null;
        setAuthMode('login');
        showLoggedOut();
        authError.textContent = 'Password updated. Please sign in.';
    } catch {
        forgotResetError.textContent = 'Could not reach the server.';
    } finally {
        forgotResetSubmit.disabled = false;
    }
});

forgotBackBtn.addEventListener('click', () => {
    pendingResetEmail = null;
    setAuthMode('login');
    showLoggedOut();
});