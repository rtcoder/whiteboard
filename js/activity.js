import {app} from './main.js';

const activityPanel = document.querySelector('.activity-panel');
const activityToggle = document.querySelector('.activity-toggle');
const activityClose = document.querySelector('.activity-close');
const activityList = document.querySelector('.activity-list');
const MAX_ACTIVITY_ITEMS = 200;

const objectLabels = {
    arrow: 'strzałka',
    bitmap: 'rysunek',
    ellipse: 'elipsa',
    line: 'linia',
    marker: 'marker',
    path: 'rysunek',
    pen: 'ołówek',
    rectangle: 'prostokąt',
    sticky: 'notatka',
    text: 'tekst',
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatTime(timestamp) {
    return new Intl.DateTimeFormat('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(new Date(timestamp));
}

export function getObjectLabel(type) {
    return objectLabels[type] || type || 'obiekt';
}

export function getObjectName(object) {
    if (!object) {
        return 'obiekt';
    }

    return `${getObjectLabel(object.type)} ${object.id?.slice(-4) || ''}`.trim();
}

function getActivityText(event) {
    const user = event.user?.name || event.userName || 'Guest';
    const details = event.details || {};

    if (event.kind === 'user-joined') {
        return `user ${user} dołączył`;
    }

    if (event.kind === 'user-left') {
        return `user ${user} opuścił pokój`;
    }

    if (event.kind === 'shape-added') {
        return `user ${user} dodał kształt ${getObjectLabel(details.objectType)} kolorem ${details.color}`;
    }

    if (event.kind === 'object-deleted') {
        return `user ${user} usunął kształt ${details.objectName}`;
    }

    if (event.kind === 'tool-used') {
        return `user ${user} użył ${getObjectLabel(details.tool)}`;
    }

    if (event.kind === 'text-added') {
        return `user ${user} dodał tekst "${details.text}"`;
    }

    if (event.kind === 'sticky-added') {
        return `user ${user} dodał notatkę "${details.text}"`;
    }

    if (event.kind === 'history-used') {
        return `user ${user} użył ${details.action === 'redo' ? 'powtórz' : 'cofnij'}`;
    }

    if (event.kind === 'fill-used') {
        return `user ${user} wypełnił kształt ${getObjectLabel(details.objectType)} kolorem ${details.color}`;
    }

    if (event.kind === 'object-moved') {
        return `user ${user} zmienił pozycję ${details.objectName}`;
    }

    if (event.kind === 'board-cleared') {
        return `user ${user} wyczyścił tablicę`;
    }

    return `user ${user} wykonał akcję`;
}

function renderActivityLog() {
    if (!activityList) {
        return;
    }

    if (!app.activityLog.length) {
        activityList.innerHTML = '<li class="activity-empty">Brak zdarzeń</li>';
        return;
    }

    activityList.innerHTML = app.activityLog
        .slice()
        .reverse()
        .map(event => `
            <li class="activity-item">
                <time>${formatTime(event.timestamp)}</time>
                <span>${escapeHtml(getActivityText(event))}</span>
            </li>
        `)
        .join('');
}

export function addActivityEntries(entries) {
    const existingIds = new Set(app.activityLog.map(event => event.id));
    const freshEntries = entries.filter(event => event?.id && !existingIds.has(event.id));

    if (!freshEntries.length) {
        return;
    }

    app.activityLog = [...app.activityLog, ...freshEntries]
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .slice(-MAX_ACTIVITY_ITEMS);

    renderActivityLog();
}

export function initActivityPanel() {
    renderActivityLog();

    activityToggle?.addEventListener('click', () => {
        const isOpen = document.body.classList.toggle('activity-open');
        activityToggle.setAttribute('aria-expanded', String(isOpen));
    });

    activityClose?.addEventListener('click', () => {
        document.body.classList.remove('activity-open');
        activityToggle?.setAttribute('aria-expanded', 'false');
    });
}
