# Remote PowerPoint Control MVP

## Goal
Build a browser-only MVP focused on fast, reliable static slide playback. Desktop users upload and present `.pptx` files; one phone at a time controls the active presentation with Previous and Next.

## User flow
1. The desktop opens an operator workspace and uploads one or more PowerPoint files.
2. Each file receives a short, unique access code and appears in the presentation list.
3. The operator opens one presentation, enters fullscreen, and enables remote control.
4. A participant opens `/remote`, enters the active code, and automatically becomes the controller if the slot is free.
5. Additional participants see that control is already in use and cannot send commands.
6. The phone sends one Previous or Next command, then waits until the desktop finishes the transition and acknowledges it before another command is accepted.
7. The operator can disable remote control, switch decks, or remove the current controller. Switching immediately invalidates control for the previous deck.

## Build scope

### Desktop operator
- Create a practical desktop workspace for multiple `.pptx` uploads, upload progress, file status, access codes, and removal.
- Store uploaded files and presentation metadata in Lovable Cloud.
- Render common PowerPoint content as static browser slides; prioritize quick page changes over animations, transitions, audio, or video.
- Provide presenter mode with fullscreen entry/exit, keyboard navigation, current slide number, remote enable/disable, controller status, and a clear escape path.
- Keep the desktop authoritative: local operator navigation always wins and every accepted remote command is completed by the desktop.

### Mobile remote
- Create a separate `/remote` page with code entry and a touch-first controller.
- Automatically claim the single controller slot on a first-come basis.
- Provide large Previous/Next controls, connection and command status, and a lock toggle that ignores slide touches while locked.
- Request a screen wake lock after joining, restore it when the page becomes visible, and degrade safely when the browser or device refuses it.
- Release the controller slot on explicit leave; use heartbeat expiry so an abandoned or disconnected phone does not block the session indefinitely.

### Realtime synchronization
- Keep an authoritative active-presentation record in Lovable Cloud.
- Use realtime database events for controller presence, pending commands, acknowledgements, current slide, and session shutdown.
- Issue monotonic command sequence numbers and allow only one unacknowledged command at a time.
- Validate every command against the active deck, active controller, current slide, and session state.
- Disable the phone controls until the matching acknowledgement arrives; reject stale, duplicate, out-of-order, and inactive-deck commands.
- Recover after reconnect by loading the latest authoritative state instead of replaying old commands.

### Data and access rules
- Use anonymous device sessions so the MVP requires no account or sign-in screen.
- Store operator ownership, presentations, active sessions, controller leases, and commands separately.
- Protect uploaded files and mutations with row-level access rules; short presentation codes identify sessions but do not grant operator authority.
- Generate collision-checked, expiring access codes and revoke them when remote control stops or a different deck becomes active.

## Technical details
- Enable Lovable Cloud for file storage, anonymous sessions, persistence, and realtime updates.
- Use a browser-compatible PPTX renderer and validate it against representative decks before finalizing the adapter. The accepted MVP output is static slides; unsupported animation/media features are ignored without blocking the deck.
- Keep PPTX parsing and fullscreen/browser APIs client-side; keep access-code creation, controller claiming, command submission, acknowledgement, and lease cleanup behind validated server functions or atomic database functions.
- Add database migrations with explicit grants, row-level policies, indexes, and atomic functions for controller claiming and serialized command submission.
- Add route-specific metadata for both the operator and remote pages.

## Verification
- Test multiple uploaded presentations and confirm only the active fullscreen deck responds.
- Test two phones racing to join and confirm exactly one receives control.
- Rapidly tap navigation and verify no overlapping or duplicate transitions occur.
- Test lock/unlock, fullscreen exit, deck switching, operator override, controller disconnect/expiry, reconnect, first/last-slide bounds, invalid codes, and unsupported files.
- Verify desktop and common phone widths in the live preview, inspect runtime logs, and leave the project with a clean build.

## MVP boundary
- Included: static slide playback, multiple decks, codes, one automatic controller, realtime next/previous, serialization, fullscreen, wake lock, and mobile lock mode.
- Excluded: PowerPoint animations, embedded media playback, native PowerPoint control, presenter notes, audience viewing, multi-controller voting, and visual polish beyond clear usable controls.
