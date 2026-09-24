# OpenRig Dashboard

OpenRig Dashboard is a web interface for [OpenRig](https://github.com/mvschwarz/openrig).
It replaces the built-in OpenRig web UI and `rig tui` for daily operation.

The main function is the **Needs you** list. Each card opens a live terminal of the agent that needs you.
The built-in OpenRig web UI cannot do this. It shows "No session resolved for this card".

> This documentation uses Standard Technical English (ASD-STE100 style).

## Functions

- **Needs you.** The dashboard shows each item that needs the operator. Click a card to open the live terminal of the related seat.
- **Seats.** The sidebar shows all rigs and their seats. Each seat has three tabs:
  - **Chat** shows recent output and sends a message to the seat.
  - **Terminal** shows the live, interactive terminal (xterm.js).
  - **Tasks** shows the queue items of the seat.
- **Tasks.** You can list, filter, create, update and hand off queue items.
- **Rig management.** You can start, stop, archive and restore rigs. You can make snapshots.
  You can launch and stop seats, change the model of a seat, and bind discovered tmux sessions.
- **Safety.** A destructive action (rig stop, restore, seat stop) starts only after you type the exact name of the rig or session.

## Requirements

- WSL2 (Ubuntu) or Linux, with tmux.
- Node.js 22 or later.
- OpenRig `@openrig/cli` 0.5.14. The OpenRig daemon must run on `http://127.0.0.1:7433` (`rig start`).

## Installation

1. Install the dependencies:
   ```bash
   npm install
   npm --prefix server install
   npm --prefix web install
   ```
2. Start the server and the web interface:
   ```bash
   npm run dev
   ```
3. Open **http://127.0.0.1:5173** in a browser. On Windows, you can use a Windows browser.

To use the web interface without a server, use test data:
```bash
VITE_MOCK=1 npm --prefix web run dev
```

## Architecture

```
browser ──/dash/*──▶ web (Vite, :5173) ──proxy──▶ server (Hono, 127.0.0.1:7500) ──▶ OpenRig daemon (:7433)
```

- `web/` contains the user interface (React, TypeScript, xterm.js). It sends requests only to `server/`.
- `server/` contains the dashboard server. It is the only part that sends requests to the daemon.
  It keeps tokens on the server side. The browser never receives a token.
- `docs/CONTRACT.md` gives the API between `web/` and `server/`.

## Configuration

Set these environment variables for `server/`:

| Variable | Default | Function |
|---|---|---|
| `PORT` | `7500` | The port of the dashboard server. The server always binds to `127.0.0.1`. |
| `DASH_ALLOWED_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` | The `Origin` values that the server accepts for changes and for the terminal WebSocket. The server always accepts its own origin. |
| `DASH_MUTATION_ALLOWLIST` | not set | A comma-separated list of rig names. When you set it, rig and seat management works only on these rigs. When you do not set it, there is no limit. Use `dashtest` during development. |
| `DASH_OPERATOR_SESSION` | `operator-human@kernel` | The sender identity for queue and management actions. |
| `OPENRIG_TERMINAL_BEARER_TOKEN` | not set | Necessary only when the daemon requires a terminal token. A daemon on loopback does not require it. |
| `OPENRIG_AUTH_BEARER_TOKEN` | not set | The operator token of the daemon. It is necessary to change the rig posture (`PUT /dash/rigs/:rigId/posture`). Without it, the server refuses the change and gives a clear error. |

## Tests

| Command | What it does |
|---|---|
| `npm test` | Runs the server unit tests (needs-you resolution, queue transitions). No daemon is necessary. |
| `npm run check` | Runs the type check, the lint and the web build. |
| `npm run smoke` | Runs 12 read-only checks against a running server: bind address, API shapes, Host and Origin refusal, identifier validation and the terminal WebSocket. It does not change a rig, a seat or the queue. |

## Known limits

- **No file watching on `/mnt/c`.** On WSL, file watching does not work on a Windows drive (`/mnt/c`).
  Thus `npm run dev` starts the server without a watcher. After you change server code, restart the server.
  Vite uses polling, so web changes show without a restart.
- **Seat names.** The daemon addresses a queue task to `<session>@<rig>`, but it wakes the seat with the tmux session name.
  If the tmux session name of a seat has no `@<rig>` part, the seat cannot receive queue tasks.
  The dashboard refuses such a task and tells you why. Use Chat, or bind the seat again with a name `<name>@<rig>`.
- **Model selection.** In OpenRig 0.5.14, a model change is not kept after a seat restart.
- **Duplicate rig names.** If two rigs have the same name, the dashboard uses the running rig.

## Documentation

| File | Contents |
|---|---|
| `docs/SCOPE.md` | Purpose, decisions, delivered scope and safety limits. |
| `docs/CONTRACT.md` | The API between `web/` and `server/`. |
| `docs/DESKTOP-SHELL.md` | Notes for the next phase: a desktop application. |
| `docs/HANDOVER-2026-09-24.md` | The handover of the first OpenRig session that built this project. |
| `docs/discovery/` | Research notes about the daemon API (historical record, partly in Dutch). |
| `docs/reviews/` | The independent review rounds (historical record, partly in Dutch). |

## License

No license is set yet. All rights reserved by the author until a license is added.
