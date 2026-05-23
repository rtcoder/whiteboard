export const CURRENT_SCHEMA_VERSION = 2;

export function migrateObject(object) {
    const migrated = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        locked: false,
        groupId: null,
        rotation: 0,
        ...object,
    };

    if (migrated.type === 'connector') {
        migrated.lineWidth = migrated.lineWidth || 3;
        migrated.connectorStyle = migrated.connectorStyle || 'orthogonal';
        migrated.endMarker = migrated.endMarker || 'arrow';
    }

    if (migrated.type === 'image') {
        migrated.rotation = migrated.rotation || 0;
    }

    migrated.schemaVersion = CURRENT_SCHEMA_VERSION;
    return migrated;
}

export function migrateObjects(objects = []) {
    return objects.map(migrateObject);
}
