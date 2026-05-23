import {app} from './main.js';

const activityPanel = document.querySelector('.activity-panel');
const activityToggle = document.querySelector('.activity-toggle');
const activityClose = document.querySelector('.activity-close');
const activityList = document.querySelector('.activity-list');
const MAX_ACTIVITY_ITEMS = 200;

const objectLabels = {
    arrow: 'arrow',
    bitmap: 'drawing',
    callout: 'callout',
    comment: 'comment',
    connector: 'connector',
    diamond: 'diamond',
    ellipse: 'ellipse',
    frame: 'frame',
    image: 'image',
    label: 'label',
    line: 'line',
    list: 'list',
    marker: 'marker',
    path: 'drawing',
    pen: 'pen',
    pencil: 'pencil',
    polygon: 'polygon',
    rectangle: 'rectangle',
    sticky: 'note',
    text: 'text',
};

const activityIcons = {
    'board-cleared': '<path d="M7 7L17 17M17 7L7 17"/><circle cx="12" cy="12" r="8"/>',
    'fill-used': '<path d="M7 11L12 6L18 12L13 17L7 11Z"/><path d="M17 17C17 17 19 19.2 19 20.5C19 21.3 18.3 22 17.5 22C16.7 22 16 21.3 16 20.5C16 19.2 17 17 17 17Z"/>',
    'history-used': '<path d="M8 8H5V5"/><path d="M5.5 8.5C7 6.4 9.5 5 12.3 5C16.6 5 20 8.4 20 12.7S16.6 20 12.3 20C9.4 20 6.9 18.4 5.7 16"/>',
    'object-deleted': '<path d="M7 8H17"/><path d="M10 8V6H14V8"/><path d="M9 11V17M12 11V17M15 11V17"/><path d="M8 8L9 20H15L16 8"/>',
    'object-moved': '<path d="M12 3V21M12 3L9 6M12 3L15 6M12 21L9 18M12 21L15 18"/><path d="M3 12H21M3 12L6 9M3 12L6 15M21 12L18 9M21 12L18 15"/>',
    'object-resized': '<path d="M5 9V5H9"/><path d="M19 15V19H15"/><path d="M5 5L11 11"/><path d="M19 19L13 13"/>',
    'object-duplicated': '<path d="M8 8H18V18H8V8Z"/><path d="M5 15H4V4H15V5"/>',
    'object-layered': '<path d="M6 8L12 4L18 8L12 12L6 8Z"/><path d="M6 12L12 16L18 12"/><path d="M6 16L12 20L18 16"/>',
    'shape-added': '<path d="M6 6H18V18H6V6Z"/><path d="M12 9V15M9 12H15"/>',
    'sticky-added': '<path d="M7 5H17V14L12 19H7V5Z"/><path d="M12 19V14H17"/>',
    'text-added': '<path d="M6 6H18"/><path d="M12 6V19"/><path d="M9 19H15"/>',
    'comment-added': '<path d="M5 5H19V15H13L9 20V15H5V5Z"/><path d="M8 9H16M8 12H14"/>',
    'image-imported': '<path d="M6 5H18V19H6V5Z"/><path d="M8 16L11 13L13 15L16 11L18 14"/><circle cx="10" cy="9" r="1.5"/>',
    'object-rotated': '<path d="M7 7C8.3 5.8 10 5 12 5C15.9 5 19 8.1 19 12S15.9 19 12 19C9.8 19 7.8 18 6.5 16.4"/><path d="M7 7H4V4"/>',
    'objects-grouped': '<path d="M4 8V4H8M16 4H20V8M20 16V20H16M8 20H4V16"/><path d="M8 8H16V16H8V8Z"/>',
    'objects-ungrouped': '<path d="M4 8V4H8M16 4H20V8M20 16V20H16M8 20H4V16"/><path d="M9 9H12V12H9V9ZM13 13H16V16H13V13Z"/>',
    'objects-locked': '<path d="M7 10H17V20H7V10Z"/><path d="M9 10V7C9 5.3 10.3 4 12 4S15 5.3 15 7V10"/>',
    'objects-unlocked': '<path d="M7 10H17V20H7V10Z"/><path d="M9 10V7C9 5.3 10.3 4 12 4C13.1 4 14 4.5 14.5 5.3"/>',
    'snapshot-created': '<path d="M6 7H18V19H6V7Z"/><path d="M9 7L10 5H14L15 7"/><circle cx="12" cy="13" r="3"/>',
    'snapshot-restored': '<path d="M8 8H5V5"/><path d="M5.5 8.5C7 6.4 9.5 5 12.3 5C16.6 5 20 8.4 20 12.7S16.6 20 12.3 20C9.4 20 6.9 18.4 5.7 16"/><path d="M12 9V13L15 15"/>',
    'tool-used': '<path d="M6 18L16.5 7.5C17.3 6.7 18.6 6.7 19.3 7.5C20.1 8.3 20.1 9.6 19.3 10.3L8.8 20H5L6 18Z"/><path d="M14.5 9.5L17.5 12.5"/>',
    'user-joined': '<path d="M8 20C8 16.7 10.2 15 12 15C13.8 15 16 16.7 16 20"/><circle cx="12" cy="9" r="3"/><path d="M18 8V14M15 11H21"/>',
    'user-left': '<path d="M8 20C8 16.7 10.2 15 12 15C13.8 15 16 16.7 16 20"/><circle cx="12" cy="9" r="3"/><path d="M16 11H22"/><path d="M19 8L22 11L19 14"/>',
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

function getEventUser(event) {
    return {
        color: event.user?.color || '#64748b',
        initials: event.user?.initials || (event.user?.name || event.userName || 'Guest').slice(0, 2).toUpperCase(),
    };
}

export function getObjectLabel(type) {
    return objectLabels[type] || type || 'object';
}

export function getObjectName(object) {
    if (!object) {
        return 'object';
    }

    return `${getObjectLabel(object.type)} ${object.id?.slice(-4) || ''}`.trim();
}

function getActivityText(event) {
    const user = event.user?.name || event.userName || 'Guest';
    const details = event.details || {};

    if (event.kind === 'user-joined') {
        return `${user} joined the room`;
    }

    if (event.kind === 'user-left') {
        return `${user} left the room`;
    }

    if (event.kind === 'shape-added') {
        let label = getObjectLabel(details.objectType);
        label = articleFor(label) + ' ' + label;
        return `${user} added ${label} with color ${details.color}`;
    }

    if (event.kind === 'object-deleted') {
        return `${user} deleted ${details.objectName}`;
    }

    if (event.kind === 'tool-used') {
        return `${user} used ${getObjectLabel(details.tool)}`;
    }

    if (event.kind === 'text-added') {
        const label = getObjectLabel(details.objectType || 'text');
        return `${user} added ${label} "${details.text}"`;
    }

    if (event.kind === 'sticky-added') {
        return `${user} added note "${details.text}"`;
    }

    if (event.kind === 'comment-added') {
        return `${user} added comment "${details.text}"`;
    }

    if (event.kind === 'history-used') {
        return `${user} used ${details.action === 'redo' ? 'redo' : 'undo'}`;
    }

    if (event.kind === 'fill-used') {
        return `${user} filled ${getObjectLabel(details.objectType)} with color ${details.color}`;
    }

    if (event.kind === 'object-moved') {
        return `${user} moved ${details.objectName}`;
    }

    if (event.kind === 'object-resized') {
        return `${user} resized ${details.objectName}`;
    }

    if (event.kind === 'object-rotated') {
        return `${user} rotated ${details.objectName}`;
    }

    if (event.kind === 'objects-grouped') {
        return `${user} grouped ${details.objectName}`;
    }

    if (event.kind === 'objects-ungrouped') {
        return `${user} ungrouped ${details.objectName}`;
    }

    if (event.kind === 'objects-locked') {
        return `${user} locked ${details.objectName}`;
    }

    if (event.kind === 'objects-unlocked') {
        return `${user} unlocked ${details.objectName}`;
    }

    if (event.kind === 'image-imported') {
        return `${user} imported ${details.objectName}`;
    }

    if (event.kind === 'snapshot-created') {
        return `${user} created a snapshot`;
    }

    if (event.kind === 'snapshot-restored') {
        return `${user} restored a snapshot`;
    }

    if (event.kind === 'object-duplicated') {
        return `${user} duplicated ${details.objectName}`;
    }

    if (event.kind === 'object-layered') {
        return `${user} sent ${details.objectName} ${details.direction === 'backward' ? 'backward' : 'forward'}`;
    }

    if (event.kind === 'board-cleared') {
        return `${user} cleared the board`;
    }

    return `${user} performed an action`;
}
function articleFor(label) {
    return /^[aeiou]/i.test(label) ? 'an' : 'a';
}
function getActivityIcon(kind) {
    return activityIcons[kind] || '<circle cx="12" cy="12" r="7"/><path d="M12 8V12L15 15"/>';
}

function renderActivityLog() {
    if (!activityList) {
        return;
    }

    if (!app.activityLog.length) {
        activityList.innerHTML = '<li class="activity-empty">No events yet</li>';
        return;
    }

    activityList.innerHTML = app.activityLog
        .slice()
        .reverse()
        .map(event => {
            const user = getEventUser(event);
            const objectId = event.details?.objectId;
            const isExistingObjectEvent = objectId && app.objects.some(object => object.id === objectId);
            const objectAttrs = isExistingObjectEvent
                ? ` data-object-id="${escapeHtml(objectId)}" tabindex="0" title="Highlight object"`
                : '';

            return `
            <li class="activity-item${isExistingObjectEvent ? ' has-object-link' : ''}" style="--activity-color: ${escapeHtml(user.color)}"${objectAttrs}>
                <time>${formatTime(event.timestamp)}</time>
                <span class="activity-avatar">${escapeHtml(user.initials)}</span>
                <span class="activity-kind-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">${getActivityIcon(event.kind)}</svg>
                </span>
                <span class="activity-text">${escapeHtml(getActivityText(event))}</span>
            </li>
        `;
        })
        .join('');
}

function highlightActivityObject(item) {
    const objectId = item?.dataset.objectId;

    if (!objectId || !app.objects.some(object => object.id === objectId)) {
        return;
    }

    app.selectedObjectId = objectId;
    app.selectedObjectIds = [objectId];
    window.whiteboardRender?.();
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

export function refreshActivityLog() {
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

    activityList?.addEventListener('click', event => {
        if (!(event.target instanceof Element)) {
            return;
        }

        highlightActivityObject(event.target.closest('.activity-item'));
    });

    activityList?.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        if (!(event.target instanceof Element)) {
            return;
        }

        const item = event.target.closest('.activity-item');

        if (!item?.dataset.objectId) {
            return;
        }

        event.preventDefault();
        highlightActivityObject(item);
    });
}
