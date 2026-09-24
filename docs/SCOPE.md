# Scope — OpenRig Dashboard v1

Status: **v1 delivered** on 2026-09-24. Owner of the scope: the operator.

## 1. Purpose

The dashboard is a graphical interface for OpenRig. It must be as easy to use as the Claude desktop application.
It replaces the built-in OpenRig web UI and `rig tui`.

The primary requirement: each **Needs you** card must open a live terminal of the correct seat.
The built-in OpenRig web UI does not do this. It shows "No session resolved for this card".

## 2. Decisions of the operator

| Subject | Decision |
|---|---|
| Actions in v1 | Needs you → live terminal. Chat (send a message, read output). Status of each seat. Queue management. |
| Navigation | A sidebar as in the Claude desktop application: Needs you and Tasks at the top, then rigs and their seats. The seat detail is on the right side, with the tabs Chat, Terminal and Tasks. |
| Rig management | Full: start, stop, archive, snapshot, restore, seat launch and stop, model, posture, discovery and bind. |
| Kernel rig | Show it as a usual rig, with management. |
| Runtime | First a local web application. Later a desktop shell. See `DESKTOP-SHELL.md`. |

## 3. Delivered scope

The work was done in three waves. An independent reviewer examined each wave.

| Wave | Contents |
|---|---|
| 1 | Server proxy, sidebar with live status, Needs you list, Chat tab, Terminal tab (WebSocket). |
| 2 | Queue: list, filter, detail with history, create, update, hand off. |
| 3 | Rig management: rigs, seats, snapshots, posture, discovery and bind. |

### 3.1 Needs-you resolution

The daemon does not always give a terminal session for a Needs you item. The server finds the session in this sequence:

1. The destination session of the item.
2. The source session of the item. For a queue item, the server reads it from `/api/queue/:qitemId`.
3. The session part of the item identity (the text before the first `|`).
4. A logical-ID match: the server converts `<pod>-<member>@<rig>` to the seat `<pod>.<member>` in that rig. It accepts only one unique match.

The server accepts a candidate only if it is a live seat (`sessionStatus` is `running`).
It never accepts a human address (`human@…`). If no candidate is acceptable, the item goes into the `unresolved` list.
The web interface shows unresolved items with an explanation, and without a terminal button.

A seat that waits at a permission prompt (`activity = needs_input`) also gives a Needs you card of kind `permission_prompt`.

## 4. Safety limits

- The server binds only to `127.0.0.1`.
- The server refuses a request with an unknown `Host` header. This prevents DNS rebinding.
- The server refuses a change or a WebSocket upgrade with a missing or unknown `Origin` header.
- The server validates each identifier (session, rig ID, queue item ID, snapshot ID) before it sends it to the daemon.
- A destructive action requires the exact rig or session name as a confirmation. The server checks it again.
- Actions on the rigs `dashboard-team` and `kernel` show an additional warning.
- The browser never receives a daemon token.
- During development, set `DASH_MUTATION_ALLOWLIST=dashtest`. Then management works only on the disposable test rig
  `test/fixtures/rig-dashtest.yaml`. Do not test destructive actions on a rig of the operator.

## 5. Out of scope for v1

- The desktop shell (next phase, see `DESKTOP-SHELL.md`).
- Access from another computer. The dashboard is local only.
- Changes to OpenRig itself. The dashboard uses only the daemon API.
