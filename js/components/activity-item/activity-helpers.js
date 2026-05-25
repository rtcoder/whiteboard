import {ActivityKind} from '../../enums/activity-kind.js';
import {ObjectType} from '../../enums/object-type.js';
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

    if (event.kind === ActivityKind.UserJoined) {
        return `${user} joined the room`;
    }

    if (event.kind === ActivityKind.UserLeft) {
        return `${user} left the room`;
    }

    if (event.kind === ActivityKind.ShapeAdded) {
        let label = getObjectLabel(details.objectType);
        label = articleFor(label) + ' ' + label;
        return `${user} added ${label} with color ${details.color}`;
    }

    if (event.kind === ActivityKind.ObjectDeleted) {
        return `${user} deleted ${details.objectName}`;
    }

    if (event.kind === ActivityKind.ToolUsed) {
        return `${user} used ${getObjectLabel(details.tool)}`;
    }

    if (event.kind === ActivityKind.TextAdded) {
        const label = getObjectLabel(details.objectType || ObjectType.Text);
        return `${user} added ${label} "${details.text}"`;
    }

    if (event.kind === ActivityKind.StickyAdded) {
        return `${user} added note "${details.text}"`;
    }

    if (event.kind === ActivityKind.CommentAdded) {
        return `${user} added comment "${details.text}"`;
    }

    if (event.kind === ActivityKind.HistoryUsed) {
        return `${user} used ${details.action === 'redo' ? 'redo' : 'undo'}`;
    }

    if (event.kind === ActivityKind.HostJoined) {
        return `${user} joined as host`;
    }

    if (event.kind === ActivityKind.HostLeft) {
        return `${user} left as host`;
    }

    if (event.kind === ActivityKind.HostTransferred) {
        return `${user} transferred host permissions to ${details.targetUser?.name || 'another user'}`;
    }

    if (event.kind === ActivityKind.HostRestored) {
        return `${user} restored host permissions`;
    }

    if (event.kind === ActivityKind.FillUsed) {
        return `${user} filled ${getObjectLabel(details.objectType)} with color ${details.color}`;
    }

    if (event.kind === ActivityKind.ObjectMoved) {
        return `${user} moved ${details.objectName}`;
    }

    if (event.kind === ActivityKind.ObjectResized) {
        return `${user} resized ${details.objectName}`;
    }

    if (event.kind === ActivityKind.ObjectRotated) {
        return `${user} rotated ${details.objectName}`;
    }

    if (event.kind === ActivityKind.ObjectStyled) {
        return `${user} updated ${details.objectName}`;
    }

    if (event.kind === ActivityKind.ObjectsGrouped) {
        return `${user} grouped ${details.objectName}`;
    }

    if (event.kind === ActivityKind.ObjectsUngrouped) {
        return `${user} ungrouped ${details.objectName}`;
    }

    if (event.kind === ActivityKind.ObjectsLocked) {
        return `${user} locked ${details.objectName}`;
    }

    if (event.kind === ActivityKind.ObjectsUnlocked) {
        return `${user} unlocked ${details.objectName}`;
    }

    if (event.kind === ActivityKind.ImageImported) {
        return `${user} imported ${details.objectName}`;
    }

    if (event.kind === ActivityKind.SnapshotCreated) {
        return `${user} created a snapshot`;
    }

    if (event.kind === ActivityKind.SnapshotRestored) {
        return `${user} restored a snapshot`;
    }

    if (event.kind === ActivityKind.ObjectDuplicated) {
        return `${user} duplicated ${details.objectName}`;
    }

    if (event.kind === ActivityKind.ObjectLayered) {
        return `${user} sent ${details.objectName} ${details.direction === 'backward' ? 'backward' : 'forward'}`;
    }

    if (event.kind === ActivityKind.BoardCleared) {
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
