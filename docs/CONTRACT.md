# Contract server ↔ web (wave 1)

De web-UI praat **alleen** met de dashboard-server (`server/`, standaard `http://127.0.0.1:7500`),
nooit direct met de daemon (`:7433`). Alle paden onder `/dash`. In dev proxyt Vite `/dash` naar `:7500`
(ook websockets).

Types staan canoniek in `server/src/contract.ts`; `web/` importeert ze vanaf daar (of kopieert ze 1-op-1).

```ts
type SeatActivity = "working" | "idle" | "needs_input" | "unknown";

interface Seat {
  logicalId: string;          // "dev.codexdev"
  session: string;            // tmux-sessienaam, bv. "dev-codexdev@dashboard-team" — altijd gevuld
  runtime: string | null;     // "claude-code" | "codex" | "opencode" | null
  lifecycle: string | null;   // "run" | "att" | ... ruw van daemon
  activity: SeatActivity;     // "unknown" als daemon het niet weet — nooit stil "idle" gokken
  hasWork: boolean;
  reason: string | null;      // ruwe daemon-reden, voor tooltip
}

interface Rig {
  rigId: string;              // ULID
  name: string;
  status: string;
  attentionCount: number;
  seats: Seat[];
}

interface NeedsYouItem {
  id: string;                 // stabiel over refreshes
  kind: string;               // bv. "queue_human", "permission_prompt", "blocked", ...
  title: string;
  detail: string | null;
  rigName: string | null;
  logicalId: string | null;
  session: string;            // VERPLICHT: server garandeert een tmux-sessienaam die bestaat
  createdAt: string | null;   // ISO
  source: string;             // welke daemon-bron het item leverde
}
```

## Endpoints

| Methode | Pad | Respons |
|---|---|---|
| GET | `/dash/fleet` | `Rig[]` |
| GET | `/dash/needs-you` | `{ items: NeedsYouItem[], unresolved: Omit<NeedsYouItem,"session">[] }` — items zonder te herleiden sessie gaan naar `unresolved` (UI toont ze, zonder terminal-knop, met uitleg) |
| GET | `/dash/seats/:session/output?lines=200` | `{ text: string }` (recente schermoutput, platte tekst/ANSI) |
| POST | `/dash/seats/:session/send` body `{ text: string }` | `{ ok: true, warning?: string }` of `{ ok: false, error: string }` |
| WS | `/dash/terminal/:session` | Transparante doorgifte van daemon `/api/terminal/:session`. Server→client: ruwe ANSI-strings. Client→server: JSON `{"type":"text","text":"…"}`, `{"type":"keys","keys":["Enter"]}`, `{"type":"scroll","offset":N}`. Geen resize. |
| GET | `/dash/events` (SSE) | `data: {"type":"invalidate","scope":"fleet"|"needs-you"}` — UI refetcht die scope. Server mag intern pollen. |

`:session` is altijd URL-encoded (`@` → `%40`).

Wave 2 (queue) en wave 3 (rig-beheer) breiden dit contract later uit.

---

# Wave 2 — queue/taken

Daemon-bron: `/api/queue/*`. Mutaties vereisen een afzender (`X-OpenRig-Session`); de dashboard-server
handelt namens de menselijke operator en zet die header zelf. De UI stuurt nooit een afzender mee.

```ts
type QueueState = "pending" | "in-progress" | "blocked" | "done" | "handed-off" | "failed" | "canceled"
                | (string & {});               // onbekende staten tonen, niet crashen

interface QueueItem {
  qitemId: string;
  state: QueueState;
  priority: string | null;       // bv. "routine", "urgent"
  tier: string | null;
  sourceSession: string;
  destinationSession: string;
  body: string;                  // kan lang en multiline zijn; eerste regel = titel in lijst
  tags: string[];
  tsCreated: string;             // ISO
  tsUpdated: string;
  blockedOn: string | null;
  handedOffTo: string | null;
  stalled: string | null;        // pickup.state van daemon als dat op vastlopen wijst, anders null
}

interface QueueTransition { at: string; fromState: string | null; toState: string; actor: string | null; note: string | null }
```

| Methode | Pad | Respons |
|---|---|---|
| GET | `/dash/queue?rig=&session=&state=a,b&activeOnly=1&limit=` | `{ items: QueueItem[] }` (nieuwste eerst) |
| GET | `/dash/queue/:qitemId` | `QueueItem & { transitions: QueueTransition[] }` |
| POST | `/dash/queue` body `{ destinationSession, body, priority?, tags?, summary?, evidenceRef? }` | `QueueItem` of `{ error }` — `summary`/`evidenceRef` zijn verplicht voor human-routed bestemmingen (daemon `human_route_fields_required`) en worden doorgestuurd als de UI ze stuurt. |
| POST | `/dash/queue/:qitemId/update` body `{ state, note? }` | `QueueItem` of `{ error }` |
| POST | `/dash/queue/:qitemId/handoff` body `{ toSession, note? }` | `QueueItem` of `{ error }` |

SSE `/dash/events` krijgt scope `"queue"` erbij.

---

# Wave 3 — rig-beheer

Daemon-bronnen: `/api/up`, `/api/down`, `/api/rigs/:id/{up,archive,unarchive}`, `/api/seat/{launch,stop,set-model}/:seatRef`,
`/api/discovery/{scan,:id/bind}`, `/api/rigs/:rigId/snapshots`, `/api/rigs/:rigId/restore/:snapshotId`, `/api/rig-mode/*`.
Alle mutaties zijn operator-acties; de server zet de afzender. Elke actie retourneert:

```ts
interface ActionResult { ok: boolean; message: string; detail?: unknown }   // detail = ruwe daemonrespons, tonen in uitklapper

interface Snapshot { id: string; createdAt: string; kind: string | null; label: string | null }
interface DiscoveredSession { id: string; session: string; runtime: string | null; cwd: string | null; boundTo: string | null }
interface SeatModel { current: string | null; available: string[] }         // available mag leeg zijn → vrij tekstveld
interface RigPosture { scope: string; effective: Record<string, unknown>; editable: boolean }   // permissie-/operatie-modus
```

| Methode | Pad | Doel |
|---|---|---|
| POST | `/dash/rigs/up` body `{ source: string }` | rig starten vanuit spec-pad / library-entry / bundle |
| POST | `/dash/rigs/:rigId/up` | gestopte rig weer opstarten |
| POST | `/dash/rigs/:rigId/down` body `{ confirm: rigName }` | rig stoppen (**destructief**) |
| POST | `/dash/rigs/:rigId/archive` · `/unarchive` | archiveren (omkeerbaar) |
| GET | `/dash/rigs/:rigId/snapshots` | `Snapshot[]` |
| POST | `/dash/rigs/:rigId/snapshots` | snapshot maken |
| POST | `/dash/snapshots/:snapshotId/restore` body `{ confirm: rigName }` | herstellen (**destructief**). Server roept daemon `POST /api/rigs/:rigId/restore/:snapshotId` aan (de echte mount, verzoend met de review), na server-side owner-rig-resolutie + exacte confirm-check. |
| POST | `/dash/seats/:session/launch` · `/stop` (stop: body `{ confirm: session }`) | seat starten / stoppen |
| GET | `/dash/seats/:session/model` | `SeatModel` |
| POST | `/dash/seats/:session/model` body `{ model }` | model wisselen (let op: niet persistent over herstart in 0.5.14 — UI meldt dat) |
| GET/PUT | `/dash/rigs/:rigId/posture` | `RigPosture` lezen / wijzigen. **PUT-body is `{ mode: string, record: Record<string, unknown> }`** (daemon-route `/api/rig-mode/bindings/rig/:rigId` vereist `{ mode, record }`); respons `ActionResult`. |
| POST | `/dash/discovery/scan` → `DiscoveredSession[]` · POST `/dash/discovery/:id/bind` body `{ rigId, logicalId }` | losse tmux-sessies vinden en binden |

**Destructieve acties** (down, restore, seat stop) vereisen in de UI dat de gebruiker de rig-/sessienaam intypt;
de server weigert als `confirm` niet exact overeenkomt. Acties op de rig/seat waar de dashboard-orchestrator zelf in draait
tonen een extra waarschuwing.
