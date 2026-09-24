# Desktop shell — notes for the next phase

Status: **not started.** This document records the decision and the preparation. It is not a design.

## 1. Decision

The operator decided (2026-09-24): first a local web application, later a desktop shell.
The desktop shell must give the dashboard its own window, as the Claude desktop application does.

## 2. What v1 already prepares

- The web interface sends requests only to relative paths (`/dash/*`). It does not know the daemon address.
- The dashboard server keeps all tokens. The web interface has no secret.
- Thus a shell can load the same web build and send `/dash/*` to the same server. No change to the web code is necessary for this.

## 3. The main technical problem: Windows and WSL

OpenRig, tmux and the dashboard server run in WSL. A desktop shell runs on Windows.

| Part | Where it runs |
|---|---|
| OpenRig daemon, tmux, agent seats | WSL |
| Dashboard server (`server/`) | WSL (it needs `127.0.0.1:7433` of the daemon) |
| Desktop shell window | Windows |

Thus the shell must:

1. Start the dashboard server in WSL, or connect to a server that already runs.
   Example: `wsl.exe -d Ubuntu -- bash -lc "cd <repo> && npm --prefix server run dev"`.
2. Load the web build. Serve `/dash/*` from the WSL server.
   WSL2 forwards `127.0.0.1` from Windows to WSL, so `http://127.0.0.1:7500` works from Windows.
3. Stop the server when the window closes, but only if the shell started it.

## 4. Options

| Option | Advantages | Disadvantages |
|---|---|---|
| **Electron** | The same Node and Chromium as in development. Easy WebSocket and xterm.js support. Many examples. | Large installer (about 100 MB or more). Higher memory use. |
| **Tauri** | Small installer. Low memory use. Uses WebView2 on Windows. | Rust toolchain necessary. Test WebSocket and xterm.js behavior in WebView2. |
| **PWA** (installable web app) | Almost no work. Edge or Chrome can install it as a window. | The shell cannot start the WSL server. No tray icon or native notifications without more work. |

Recommendation for a first step: make a **PWA** (web manifest and icons). This gives a separate window at a small cost.
Then decide between Electron and Tauri with real needs, for example notifications, a tray icon or auto-start.

## 5. Open questions for the operator

1. Must the shell start OpenRig (`rig start`) and the dashboard server, or only connect to them?
2. Are desktop notifications for new Needs you items necessary?
3. Is a tray icon or auto-start with Windows necessary?
4. Is an installer necessary, or is a portable application sufficient?

## 6. Before you start

- Build the web interface for production (`npm --prefix web run build`). Serve `web/dist` from the dashboard server,
  so that one process gives both the UI and `/dash/*`. v1 does not do this yet. In v1, Vite serves the UI during development.
- Keep the security checks of the server. A shell origin (for example `app://…` or `tauri://…`) must be added to
  `DASH_ALLOWED_ORIGINS`. Do not disable the Origin check.
- Run `npm run smoke` against the server that the shell uses.
