import {getObjectLabel} from './components/activity-item/activity-helpers.js';
import {ActivityItemElement} from './components/activity-item/activity-item.js';
import {app} from './app.js';
import {ActivityKind} from './enums/activity-kind.js';

const activityPanel = document.querySelector('.activity-panel');
const activityToggle = document.querySelector('.activity-toggle');
const activityClose = document.querySelector('.activity-close');
const activityList = document.querySelector('.activity-list');
const activitySearch = document.querySelector('.activity-search');
const activityFilter = document.querySelector('.activity-filter');
const MAX_ACTIVITY_ITEMS = 200;

export function getObjectName(object) {
    if (!object) {
        return 'object';
    }

    return `${getObjectLabel(object.type)} ${object.id?.slice(-4) || ''}`.trim();
}

function getActivityFilterGroup(kind) {
    if (kind === ActivityKind.UserJoined || kind === ActivityKind.UserLeft) {
        return 'collaboration';
    }

    if (kind === ActivityKind.HistoryUsed || kind === ActivityKind.SnapshotCreated || kind === ActivityKind.SnapshotRestored) {
        return 'history';
    }

    if (kind === ActivityKind.TextAdded || kind === ActivityKind.StickyAdded || kind === ActivityKind.CommentAdded) {
        return 'text';
    }

    return 'objects';
}

function getGroupedActivityEvents(events) {
    return events.reduce((groups, event) => {
        const previous = groups[groups.length - 1];
        const details = event.details || {};
        const previousDetails = previous?.details || {};
        const sameBucket = previous &&
            previous.kind === event.kind &&
            previous.user?.name === event.user?.name &&
            details.objectType === previousDetails.objectType &&
            details.color === previousDetails.color &&
            Math.abs(new Date(previous.timestamp) - new Date(event.timestamp)) < 60000;

        if (sameBucket) {
            previous.count = (previous.count || 1) + 1;
            previous.timestamp = event.timestamp;
            return groups;
        }

        groups.push({...event, count: 1});
        return groups;
    }, []);
}

function renderActivityLog() {
    if (!activityList) {
        return;
    }

    if (!app.activityLog.length) {
        activityList.innerHTML = '<li class="activity-empty">No events yet</li>';
        return;
    }

    const query = activitySearch?.value?.trim().toLowerCase() || '';
    const filter = activityFilter?.value || 'all';
    const events = app.activityLog
        .filter(event => {
            if (filter !== 'all' && getActivityFilterGroup(event.kind) !== filter) {
                return false;
            }

            return !query || ActivityItemElement.getText(event).toLowerCase().includes(query);
        });

    if (!events.length) {
        activityList.innerHTML = '<li class="activity-empty">No matching events</li>';
        return;
    }

    activityList.replaceChildren(
        ...getGroupedActivityEvents(events)
            .reverse()
            .map(event => {
                const item = document.createElement('li', {is: 'activity-item'});
                item.activityEvent = event;
                return item;
            }),
    );
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
    activitySearch?.addEventListener('input', renderActivityLog);
    activityFilter?.addEventListener('change', renderActivityLog);

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
