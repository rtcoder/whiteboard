export const ConnectionStatus = Object.freeze({
    Connecting: 'connecting',
    Connected: 'connected',
    Reconnecting: 'reconnecting',
    Offline: 'offline',
    Saving: 'saving',
    Synced: 'synced',
});

export const ConnectionStatusLabels = Object.freeze({
    [ConnectionStatus.Connecting]: 'Connecting',
    [ConnectionStatus.Connected]: 'Connected',
    [ConnectionStatus.Reconnecting]: 'Reconnecting',
    [ConnectionStatus.Offline]: 'Offline',
    [ConnectionStatus.Saving]: 'Saving\u2026',
    [ConnectionStatus.Synced]: 'Synced',
})
