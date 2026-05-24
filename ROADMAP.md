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
- [ ] Fill: edge cleanup controls.

## 2. Shapes

- [x] Line.
- [x] Arrow.
- [x] Rectangle.
- [x] Circle/ellipse.
- [x] Diamond, useful for diagrams.
- [x] Polygon shape.
- [ ] Freeform shape.
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
- [ ] Reactions/quick markers, for example approve/question.

## 7. Diagrams And Team Work

- [ ] Ready-made flowchart shapes.
- [ ] Mind map node.
- [ ] Connector with automatic routing.
- [ ] Swimlanes.
- [ ] Table/kanban mini-board.
- [ ] Templates: retro, user journey, architecture sketch, brainstorming.

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

### Collaboration Stability

- [x] Server-side object leases/locks.
- [x] Client-side object lock state.
- [x] Conflict rejection for locked objects.
- [x] Hide remote cursor while laser pointer is active.
- [ ] Visible "Locked by user" badge on board objects.
- [ ] Connection status: Connecting, Connected, Reconnecting, Offline.
- [ ] Reconnect recovery flow.
- [ ] Peer cleanup for cursors, lasers, selection badges, and locks.

### Editing UX And Properties

- [x] Properties panel for stroke, fill, stroke size, rotation, lock.
- [x] Properties panel for text, font size, opacity, connector style, arrowhead.
- [ ] Inline text editor overlay instead of prompt.
- [ ] Mixed values in multi-select properties.
- [ ] Keyboard shortcuts for duplicate, group, ungroup, lock, unlock.
- [ ] Shortcut suppression while editing text.
- [ ] Better resize and rotate support for all object types.

### Fill And Drawing

- [x] System-level safe fill tolerance.
- [x] Bitmap fill stored as board object and synced.
- [ ] Fill edge cleanup preset.
- [ ] Smaller bitmap fill payloads.
- [ ] Fill undo/redo as operation, not full replace.
- [ ] Freehand path simplification.
- [ ] Pen/pencil smoothing.
- [ ] Point eraser for freehand paths.

### Diagram Tools

- [ ] Flowchart process, decision, terminator, and database shapes.
- [ ] Mind map node.
- [ ] Automatic connector routing around objects.
- [ ] Magnetic connector anchors.
- [ ] Connector endpoint drag and rewire.
- [ ] Connector labels.
- [ ] Swimlanes.
- [ ] Mini kanban/table object.
- [ ] Templates for retro, user journey, architecture sketch, brainstorming.

### UI Polish And Navigation

- [x] Grouped toolbar popovers.
- [x] System tooltip positioning.
- [x] Activity click-to-highlight object.
- [ ] Activity search/filter.
- [ ] Group similar activity events.
- [ ] Drag minimap viewport.
- [ ] Saving/synced/offline status.
- [ ] Mobile toolbar polish.

### Export Import And Versions

- [x] Export PNG, SVG, PDF.
- [x] Copy as image.
- [x] Image import from picker, clipboard, and drag/drop.
- [x] Basic snapshot history.
- [ ] Export selected frame and selection consistently.
- [ ] Paste text as text object.
- [ ] Import basic SVG as editable objects.
- [ ] Named snapshots and restore confirmation.

### Sync Protocol And Event Log

- [x] Board operation diff for merge-mode sync.
- [x] Full state for init/recovery.
- [ ] Standardized operation event names.
- [ ] Bounded server operation log.
- [ ] Undo/redo as operation output.
- [ ] Persisted room schema migration.

### Reliability And Tests

- [x] Smoke tests for schema, operations, and lock conflicts.
- [ ] Atomic room writes with backup.
- [ ] Damaged room file recovery.
- [ ] Message size limits.
- [ ] Cursor/laser/operation rate limits.
- [ ] Old empty room cleanup.
- [ ] Two-client WebSocket integration tests.
- [ ] Browser E2E coverage.
