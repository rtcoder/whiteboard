# Whiteboard Browser QA Checklist

Use this checklist for manual browser verification after changes that touch collaboration, board editing, export/import, or responsive UI.

`npm run test:e2e` runs static browser QA smoke checks and prints the most important manual browser scenarios. It is not a replacement for a real two-window browser pass.

## Room Access

- [ ] Create an open room and join it from a second window by share link.
- [ ] Join an open room by pasting the meeting code on the lobby screen.
- [ ] Create a closed room and request access from a second window.
- [ ] Accept the request as host and confirm the guest enters the board.
- [ ] Deny the request as host and confirm the guest remains on the join screen with a decline message.
- [ ] Refresh an accepted guest and confirm the access token allows re-entry.
- [ ] Clear guest local storage and confirm the closed room asks for access again.

## Collaboration And Editing

- [ ] Draw different objects in two windows and confirm both objects remain.
- [ ] Select an object in one window and confirm the other window sees the lock/presence badge.
- [ ] Try to edit the locked object from the second window and confirm the conflict status appears.
- [ ] Move, duplicate, delete, undo, and redo while both windows are connected.
- [ ] Use the laser pointer and confirm the remote cursor is hidden while the laser is active.
- [ ] Create and restore a named snapshot while a second window is connected.

## Drawing, Diagrams, And Import

- [ ] Draw and fill rectangle, ellipse, diamond, polygon, and freeform shape.
- [ ] Draw an open path and confirm fill is unavailable or rejected with a clear status.
- [ ] Create flowchart shapes, mind node, swimlane, kanban, and each template.
- [ ] Drag connector endpoints between objects and edit a connector label.
- [ ] Paste plain text, paste a basic SVG, import an image, and drag/drop an image.

## Export And Responsive UI

- [ ] Export full board, selected object, and selected frame as PNG, SVG, and PDF.
- [ ] Copy board or selection as image.
- [ ] Check desktop layout for toolbar, activity panel, properties panel, minimap, and join request card.
- [ ] Check mobile width for toolbar overflow, activity panel, properties panel, minimap, and join request card.
