# Whiteboard Roadmap

This file tracks implemented tools, planned features, and useful next steps for the collaborative whiteboard.

## 1. Drawing

- [x] Pen: freehand drawing.
- [x] Marker: thicker semi-transparent stroke.
- [x] Pencil/sketch: thinner, softer drawing style.
- [x] Eraser: point/stroke erasing.
- [x] Eraser: erase an entire object.
- [x] Fill: region and shape fill.
- [x] Fill: adjustable color tolerance.

## 2. Shapes

- [x] Line.
- [x] Arrow.
- [x] Rectangle.
- [x] Circle/ellipse.
- [x] Diamond, useful for diagrams.
- [x] Polygon shape.
- [x] Freeform shape.
- [x] Magnetic connectors between objects, especially for flowcharts.

## 3. Text And Notes

- [x] Text box.
- [x] Sticky note.
- [x] Callout/speech bubble.
- [x] Bulleted list.
- [x] Small label for diagram annotations.

## 4. Selection And Editing

- [x] Select/move.
- [x] Lasso select.
- [x] Resize handles.
- [x] Rotate handles.
- [x] Duplicate.
- [x] Delete.
- [x] Bring forward/send backward.
- [x] Group/ungroup.
- [x] Lock/unlock.

## 5. Navigation

- [x] Pan/hand tool.
- [x] Fit to screen.
- [x] Zoom to selection.
- [x] Minimap in the corner.
- [x] Frames, for example workshop sections, slides, or export areas.

## 6. Live Collaboration

- [x] Shared rooms.
- [x] Join by room code/link.
- [x] Live cursors for other users.
- [x] User avatars with distinct colors.
- [x] Shared board state over WebSocket.
- [x] Shared activity history.
- [x] Avatars attached to selected objects.
- [x] Follow user, so the viewport tracks another participant.
- [x] Laser pointer for presenting.
- [x] Comments pinned to canvas positions.
- [x] Reactions/quick markers, for example approve/question.

## 7. Diagrams And Team Work

- [x] Ready-made flowchart shapes.
- [x] Mind map node.
- [x] Connector with automatic routing.
- [x] Swimlanes.
- [x] Table/kanban mini-board.
- [x] Templates: retro, user journey, architecture sketch, brainstorming.

## 8. Export And Import

- [x] Export PNG.
- [x] Export PDF.
- [x] Export SVG.
- [x] Copy as image.
- [x] Import image.
- [x] Import from clipboard.
- [x] Import image by drag and drop.
- [x] Snapshot/version history.

## Recommended Next Work

- [x] Add resize handles for selected objects.
- [x] Add layer ordering controls: bring forward, send backward.
- [x] Add lasso selection and multi-select.
- [x] Add frames as named canvas areas.
- [x] Add PNG export for the current board or selected frame.
- [x] Add pinned comments for collaboration.
- [x] Add selected-object presence, showing who is editing what.
- [x] Add basic connector objects before more complex diagram templates.
- [x] Add persisted room storage so board state survives server restarts.

## Hardening Backlog

These groups track the remaining "tip-top" work. Each group should land as a focused commit.

## Pure SVG Migration

- [x] SVG board layer as the visible render surface.
- [x] SVG rendering for current object types.
- [x] Remove persistent canvas board runtime.
- [x] Make SVG renderer authoritative.
- [x] Use SVG DOM node picking for hit testing.
- [x] Replace pixel flood fill with object/path SVG fill.
- [x] Add freeform closed SVG shape.
- [x] Migrate legacy bitmap fills to SVG image objects.
- [x] Make export and clipboard independent from board canvas.
- [x] Send undo/redo as operation diffs.

Pure SVG fill is intentionally object based. Arbitrary pixel flood fill is no longer a target behavior.

### Collaboration Stability

- [x] Server-side object leases/locks.
- [x] Client-side object lock state.
- [x] Conflict rejection for locked objects.
- [x] Hide remote cursor while laser pointer is active.
- [x] Visible "Locked by user" badge on board objects.
- [x] Connection status: Connecting, Connected, Reconnecting, Offline.
- [x] Reconnect recovery flow.
- [x] Peer cleanup for cursors, lasers, selection badges, and locks.

### Editing UX And Properties

- [x] Properties panel for stroke, fill, stroke size, rotation, lock.
- [x] Properties panel for text, font size, opacity, connector style, arrowhead.
- [x] Inline text editor overlay instead of prompt.
- [x] Mixed values in multi-select properties.
- [x] Keyboard shortcuts for duplicate, group, ungroup, lock, unlock.
- [x] Shortcut suppression while editing text.
- [x] Better resize and rotate support for all object types.

### Fill And Drawing

- [x] System-level safe fill tolerance.
- [x] Bitmap fill stored as board object and synced.
- [x] Fill edge cleanup preset.
- [x] Smaller bitmap fill payloads.
- [x] Fill undo/redo as operation, not full replace.
- [x] Freehand path simplification.
- [x] Pen/pencil smoothing.
- [x] Point eraser for freehand paths.

### Diagram Tools

- [x] Flowchart process, decision, terminator, and database shapes.
- [x] Mind map node.
- [x] Automatic connector routing around objects.
- [x] Magnetic connector anchors.
- [x] Connector endpoint drag and rewire.
- [x] Connector labels.
- [x] Swimlanes.
- [x] Mini kanban/table object.
- [x] Templates for retro, user journey, architecture sketch, brainstorming.

### UI Polish And Navigation

- [x] Grouped toolbar popovers.
- [x] System tooltip positioning.
- [x] Activity click-to-highlight object.
- [x] Activity search/filter.
- [x] Group similar activity events.
- [x] Drag minimap viewport.
- [x] Saving/synced/offline status.
- [x] Mobile toolbar polish.

### Export Import And Versions

- [x] Export PNG, SVG, PDF.
- [x] Copy as image.
- [x] Image import from picker, clipboard, and drag/drop.
- [x] Basic snapshot history.
- [x] Export selected frame and selection consistently.
- [x] Paste text as text object.
- [x] Import basic SVG as editable objects.
- [x] Named snapshots and restore confirmation.

### Sync Protocol And Event Log

- [x] Board operation diff for merge-mode sync.
- [x] Full state for init/recovery.
- [x] Standardized operation event names.
- [x] Bounded server operation log.
- [x] Undo/redo as operation output.
- [x] Persisted room schema migration.

### Reliability And Tests

- [x] Smoke tests for schema, operations, and lock conflicts.
- [x] Atomic room writes with backup.
- [x] Damaged room file recovery.
- [x] Message size limits.
- [x] Cursor/laser/operation rate limits.
- [x] Old empty room cleanup.
- [x] Two-client WebSocket integration tests.
- [x] Browser QA smoke script and manual checklist.
- [ ] Full automated browser E2E coverage.

## Manual QA Checklist

The full manual checklist lives in `QA_CHECKLIST.md`. `npm run test:e2e` runs static browser QA smoke checks and prints the manual scenarios that still need a real browser pass.

Current automated coverage includes schema/operation smoke tests plus two-client WebSocket tests for open rooms, closed-room access tokens, accept/deny join requests, object lock conflicts, independent object updates, and full-state replace rejection outside explicit replace mode. Full browser automation remains planned.

- [ ] Create a room, join as a second user, and confirm both clients receive late-join state.
- [ ] Draw a shape, fill it, refresh both clients, and confirm the fill persists.
- [ ] Move, duplicate, delete, undo, and redo while a second client is connected.
- [ ] Select one object on client A and confirm client B sees lock/presence and cannot edit it.
- [ ] Use laser pointer and confirm the remote cursor is hidden while the laser is active.
- [ ] Create flowchart shapes, mind nodes, swimlanes, kanban, templates, and connectors.
- [ ] Drag connector endpoints between objects and edit connector labels.
- [ ] Export full board, selected object, and selected frame as PNG/SVG/PDF.
- [ ] Paste plain text, paste basic SVG, import image, and drag/drop image.
- [ ] Create, name, restore, and sync a snapshot.
- [ ] Check desktop and mobile viewport toolbar overflow, activity search/filter, and properties panel.
