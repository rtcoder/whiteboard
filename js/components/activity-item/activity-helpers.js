import {activityIcons} from './activity-icons.js';
import {objectLabels} from './object-labels.js';

function articleFor(label) {
    return /^[aeiou]/i.test(label) ? 'an' : 'a';
}

export function getObjectLabel(type) {
    return objectLabels[type] || type || 'object';
}

export function getActivityText(event) {
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

    if (event.kind === 'object-styled') {
        return `${user} updated ${details.objectName}`;
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

export function getEventUser(event) {
    const {user, userName} = event;
    return {
        color: user?.color || '#64748b',
        initials: user?.initials || (user?.name || userName || 'Guest').slice(0, 2).toUpperCase(),
    };
}

export function getEventHumanTime(event) {
    const {timestamp} = event;
    return new Intl.DateTimeFormat('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(new Date(timestamp));
}

export function getActivityIcon(kind) {
    return activityIcons[kind] || '<circle cx="12" cy="12" r="7"/><path d="M12 8V12L15 15"/>';
}
