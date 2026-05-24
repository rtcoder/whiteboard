export const CURRENT_SCHEMA_VERSION = 5;

export function migrateObject(object) {
    const migrated = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        locked: false,
        groupId: null,
        rotation: 0,
        ...object,
    };

    if (migrated.type === 'path' || migrated.type === 'freeform') {
        migrated.opacity = migrated.opacity ?? 1;
        migrated.closed = migrated.type === 'freeform' ? migrated.closed ?? true : migrated.closed ?? false;
        migrated.fill = migrated.closed ? migrated.fill || 'transparent' : migrated.fill;
    }

    if (migrated.type === 'connector') {
        migrated.lineWidth = migrated.lineWidth || 3;
        migrated.connectorStyle = migrated.connectorStyle || 'orthogonal';
        migrated.endMarker = migrated.endMarker || 'arrow';
        migrated.fromAnchor = migrated.fromAnchor || null;
        migrated.toAnchor = migrated.toAnchor || null;
        migrated.label = migrated.label || '';
        migrated.route = migrated.route || [];
    }

    if (migrated.type === 'image') {
        migrated.rotation = migrated.rotation || 0;
        migrated.legacyBitmapFill = Boolean(migrated.legacyBitmapFill);
    }

    migrated.schemaVersion = CURRENT_SCHEMA_VERSION;
    return migrated;
}

export function migrateObjects(objects = []) {
    return objects.map(migrateObject);
}
