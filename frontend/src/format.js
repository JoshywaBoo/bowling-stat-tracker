// format.js

export function formatTime(iso) {
    try {
        return new Date(iso).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        });
    } catch {
        return '';
    }
}

export function formatDateTimeInput(iso) {
    try {
        const value = iso || new Date().toISOString();
        // Naive datetime (e.g. EXIF capture_date) has no timezone designator —
        // it's already wall-clock time, so use it directly.
        if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(value)) {
            return value.slice(0, 16);
        }
        const date = new Date(value);
        const offset = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() - offset).toISOString().slice(0, 16);
    } catch {
        return '';
    }
}