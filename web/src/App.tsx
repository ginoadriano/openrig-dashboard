import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getFleet,
  getNeedsYou,
  getSeatOutput,
  isMockMode,
  sendSeatMessage,
  subscribeToInvalidations,
} from './api'
import { QueueView } from './QueueView'
import { Discovery, NewRig, RigManagement, SeatManagement, Toast } from './RigManagement'
import { TerminalPane } from './TerminalPane'
import type { NeedsYouItem, Rig, Seat, SeatActivity, UnresolvedNeedsYouItem } from './types'
import './App.css'

type View =
  | { kind: 'needs' }
  | { kind: 'queue' }
  | { kind: 'rig'; rig: Rig }
  | { kind: 'discovery' }
  | { kind: 'seat'; rig: Rig; seat: Seat; tab: 'chat' | 'terminal' | 'tasks' }
const label = (activity: SeatActivity) =>
  activity === 'needs_input' ? 'Needs input' : activity[0].toUpperCase() + activity.slice(1)
const time = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
    : 'Unknown time'

function App() {
  const [fleet, setFleet] = useState<Rig[]>([])
  const [items, setItems] = useState<NeedsYouItem[]>([])
  const [unresolved, setUnresolved] = useState<UnresolvedNeedsYouItem[]>([])
  const [view, setView] = useState<View>({ kind: 'needs' })
  const [loading, setLoading] = useState(true)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [queueVersion, setQueueVersion] = useState(0)
  const [result, setResult] = useState<import('./types').ActionResult | null>(null)
  const [newRig, setNewRig] = useState(false)
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const loadFleet = useCallback(async () => setFleet(await getFleet()), [])
  const loadNeeds = useCallback(async () => {
    const data = await getNeedsYou()
    setItems(data.items)
    setUnresolved(data.unresolved)
  }, [])
  const refresh = useCallback(async () => {
    try {
      setRequestError(null)
      await Promise.all([loadFleet(), loadNeeds()])
    } catch (cause) {
      setRequestError(cause instanceof Error ? cause.message : 'Unable to reach the dashboard server')
    } finally {
      setLoading(false)
    }
  }, [loadFleet, loadNeeds])
  useEffect(() => {
    const initialTimer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(initialTimer)
  }, [refresh])
  useEffect(
    () =>
      subscribeToInvalidations(
        (scope) => {
          if (scope === 'fleet') {
            void loadFleet()
              .then(() => setConnectionError(null))
              .catch((cause) => setConnectionError(cause instanceof Error ? cause.message : String(cause)))
          }
          if (scope === 'needs-you') {
            void loadNeeds()
              .then(() => setConnectionError(null))
              .catch((cause) => setConnectionError(cause instanceof Error ? cause.message : String(cause)))
          }
          if (scope === 'queue') {
            setQueueVersion((version) => version + 1)
            setConnectionError(null)
          }
        },
        () => setConnectionError('Connection interrupted; reconnecting…'),
      ),
    [loadFleet, loadNeeds],
  )
  const selectSeat = (rig: Rig, seat: Seat, tab: 'chat' | 'terminal' = 'chat') =>
    setView({ kind: 'seat', rig, seat, tab })
  const openNeed = (item: NeedsYouItem) => {
    const candidates = fleet
      .flatMap((rig) => rig.seats.map((seat) => ({ rig, seat })))
      .filter(({ seat }) => seat.session === item.session)
    const found =
      candidates.find(({ rig }) => rig.name === item.rigName && rig.status === 'running') ??
      candidates.find(({ rig }) => rig.name === item.rigName) ??
      candidates.find(({ rig }) => rig.status === 'running') ??
      candidates[0]
    if (found) {
      selectSeat(found.rig, found.seat, 'terminal')
      return
    }
    selectSeat(
      {
        rigId: `unresolved:${item.session}`,
        name: item.rigName ?? 'Unknown rig',
        status: 'unknown',
        attentionCount: 0,
        seats: [],
      },
      {
        logicalId: item.logicalId ?? 'Unresolved seat',
        session: item.session,
        runtime: null,
        lifecycle: null,
        activity: 'unknown',
        hasWork: false,
        reason: 'This needs-you item is no longer in the latest fleet roster.',
      },
      'terminal',
    )
  }
  const openOwnerTerminal = (session: string) => {
    const found = fleet
      .flatMap((rig) => rig.seats.map((seat) => ({ rig, seat })))
      .find(({ seat }) => seat.session === session)
    if (found) {
      selectSeat(found.rig, found.seat, 'terminal')
      return
    }
    selectSeat(
      {
        rigId: `unresolved:${session}`,
        name: 'Unknown rig',
        status: 'unknown',
        attentionCount: 0,
        seats: [],
      },
      {
        logicalId: 'Unresolved seat',
        session,
        runtime: null,
        lifecycle: null,
        activity: 'unknown',
        hasWork: false,
        reason: 'This queue owner is no longer in the latest fleet roster.',
      },
      'terminal',
    )
  }
  const selected = view.kind === 'seat' ? view : null
  return (
    <main className={dark ? 'app dark' : 'app'}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">◒</span>
          <span>OpenRig</span>
          <small>Dashboard</small>
        </div>
        <button
          className={`needs-nav ${view.kind === 'needs' ? 'active' : ''}`}
          onClick={() => setView({ kind: 'needs' })}
          type="button"
        >
          <span className="spark">✦</span>
          <span>Needs you</span>
          <b>{items.length + unresolved.length}</b>
        </button>
        <button
          className={`tasks-nav ${view.kind === 'queue' ? 'active' : ''}`}
          onClick={() => setView({ kind: 'queue' })}
          type="button"
        >
          <span>✓</span>
          Taken
        </button>
        <button className="tasks-nav" onClick={() => setView({ kind: 'discovery' })} type="button">
          ⌁ Discover sessions
        </button>
        <div className="sidebar-heading">
          <span>Rigs</span>
          <button type="button" onClick={() => void refresh()} aria-label="Refresh dashboard">
            ↻
          </button>
        </div>
        <nav aria-label="Rigs and seats" className="rig-list">
          {fleet.map((rig) => (
            <section className="rig-group" key={rig.rigId}>
              <div className="rig-title">
                <button className="rig-link" onClick={() => setView({ kind: 'rig', rig })}>
                  {rig.name}
                </button>
                <small className={`rig-status ${rig.status}`}>{rig.status}</small>
                <button className="kebab" onClick={() => setView({ kind: 'rig', rig })}>
                  ⋮
                </button>
              </div>
              {rig.seats.map((seat) => (
                <button
                  type="button"
                  key={seat.session}
                  className={`seat-nav ${selected?.rig.rigId === rig.rigId && selected.seat.session === seat.session ? 'selected' : ''}`}
                  onClick={() => selectSeat(rig, seat)}
                >
                  <span
                    className={`status-dot ${seat.activity}`}
                    title={`${label(seat.activity)}${seat.reason ? `: ${seat.reason}` : ''}`}
                  />
                  <span className="seat-name">{seat.logicalId}</span>
                  {seat.hasWork && (
                    <span className="work-mark" aria-label="Has assigned work">
                      •
                    </span>
                  )}
                </button>
              ))}
            </section>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="mode">
            <i></i>
            {isMockMode() ? 'Mock data' : 'Live server'}
          </span>
          <button type="button" className="theme-button" onClick={() => setDark((value) => !value)}>
            {dark ? 'Light' : 'Dark'}
          </button>
        </div>
        <button className="new-rig-button" onClick={() => setNewRig(true)}>
          + Rig
        </button>
      </aside>
      <section className="workspace">
        {(requestError || connectionError) && (
          <div className="connection-error">
            <span>Unable to refresh: {requestError || connectionError}</span>
            <button type="button" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        )}
        {loading ? (
          <div className="loading">Opening your workspace…</div>
        ) : view.kind === 'needs' ? (
          <NeedsYouView items={items} unresolved={unresolved} onOpen={openNeed} />
        ) : view.kind === 'queue' ? (
          <QueueView fleet={fleet} onOpenOwner={openOwnerTerminal} refreshKey={queueVersion} />
        ) : view.kind === 'rig' ? (
          <RigManagement
            key={view.rig.rigId}
            rig={view.rig}
            onResult={setResult}
            onManageSeat={(seat) => selectSeat(view.rig, seat)}
          />
        ) : view.kind === 'discovery' ? (
          <Discovery fleet={fleet} onResult={setResult} />
        ) : selected ? (
          <SeatDetail
            {...selected}
            queueVersion={queueVersion}
            onResult={setResult}
            onTab={(tab) => setView({ ...selected, tab })}
          />
        ) : null}
      </section>
      <Toast result={result} onClose={() => setResult(null)} />
      {newRig && <NewRig onClose={() => setNewRig(false)} onResult={setResult} />}
    </main>
  )
}

function NeedsYouView({
  items,
  unresolved,
  onOpen,
}: {
  items: NeedsYouItem[]
  unresolved: UnresolvedNeedsYouItem[]
  onOpen: (item: NeedsYouItem) => void
}) {
  return (
    <div className="content needs-content">
      <header className="page-header">
        <p className="eyebrow">Your attention</p>
        <h1>Needs you</h1>
        <p className="subtitle">The items that need a human decision or a reply.</p>
      </header>
      <div className="needs-grid">
        {items.map((item) => (
          <button type="button" className="need-card" key={item.id} onClick={() => onOpen(item)}>
            <span className="need-kind">{item.kind.replaceAll('_', ' ')}</span>
            <h2>{item.title}</h2>
            <p>{item.detail ?? 'Open this seat to continue.'}</p>
            <footer>
              <span>
                {item.rigName} · {item.logicalId}
              </span>
              <time>{time(item.createdAt)}</time>
            </footer>
            <span className="open-terminal">
              Open terminal <span>→</span>
            </span>
          </button>
        ))}
      </div>
      {items.length === 0 && <div className="empty-state">Nothing needs you right now.</div>}
      {unresolved.length > 0 && (
        <section className="unresolved">
          <div>
            <p className="eyebrow">Unresolved</p>
            <h2>Items without a terminal</h2>
            <p>
              The server could not safely map these items to a live tmux seat, so no terminal action is
              offered.
            </p>
          </div>
          {unresolved.map((item) => (
            <article key={item.id} className="unresolved-card">
              <span className="unresolved-icon">?</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.detail ?? 'No session could be resolved.'}</p>
                <small>
                  {item.source} · {item.rigName ?? 'No rig'}
                </small>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}

function SeatDetail({
  rig,
  seat,
  tab,
  queueVersion,
  onResult,
  onTab,
}: Extract<View, { kind: 'seat' }> & {
  queueVersion: number
  onResult: (result: import('./types').ActionResult) => void
  onTab: (tab: 'chat' | 'terminal' | 'tasks') => void
}) {
  return (
    <div className="seat-detail">
      <header className="seat-header">
        <div>
          <p className="eyebrow">{rig.name}</p>
          <h1>{seat.logicalId}</h1>
          <p className="seat-meta">
            <span className={`status-dot ${seat.activity}`}></span>
            {label(seat.activity)} · {seat.runtime ?? 'Unknown runtime'}
            {seat.reason ? ` · ${seat.reason}` : ''}
          </p>
        </div>
        <span className={`lifecycle ${seat.lifecycle ?? 'unknown'}`}>{seat.lifecycle ?? 'unknown'}</span>
        <SeatManagement key={seat.session} seat={seat} onResult={onResult} />
      </header>
      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'chat'}
          className={tab === 'chat' ? 'active' : ''}
          onClick={() => onTab('chat')}
          type="button"
        >
          Chat
        </button>
        <button
          role="tab"
          aria-selected={tab === 'terminal'}
          className={tab === 'terminal' ? 'active' : ''}
          onClick={() => onTab('terminal')}
          type="button"
        >
          Terminal
        </button>
        <button
          role="tab"
          aria-selected={tab === 'tasks'}
          className={tab === 'tasks' ? 'active' : ''}
          onClick={() => onTab('tasks')}
          type="button"
        >
          Taken
        </button>
      </div>
      <div className="tab-panel">
        {tab === 'terminal' ? (
          <TerminalPane key={seat.session} session={seat.session} />
        ) : tab === 'tasks' ? (
          <QueueView
            key={seat.session}
            fleet={[rig]}
            seatSession={seat.session}
            onOpenOwner={() => onTab('terminal')}
            refreshKey={queueVersion}
          />
        ) : (
          <ChatPane key={seat.session} session={seat.session} />
        )}
      </div>
    </div>
  )
}

function ChatPane({ session }: { session: string }) {
  const aliveRef = useRef(true)
  const [output, setOutput] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const refreshOutput = useCallback(async () => {
    try {
      const output = await getSeatOutput(session)
      if (!aliveRef.current) return
      setOutput(output)
    } catch {
      if (aliveRef.current)
        setOutput('Recent output is unavailable. Open Terminal to inspect the live session.')
    }
  }, [session])

  useEffect(() => {
    aliveRef.current = true
    const initialTimer = window.setTimeout(() => void refreshOutput(), 0)
    const timer = window.setInterval(() => void refreshOutput(), 3_000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
      aliveRef.current = false
    }
  }, [refreshOutput])

  const send = async () => {
    if (!text.trim() || sending) return
    if (!aliveRef.current) return
    setSending(true)
    setNotice(null)
    setWarning(null)
    try {
      const result = await sendSeatMessage(session, text.trim())
      if (!result.ok) throw new Error(result.error ?? 'Message was not delivered')
      if (!aliveRef.current) return
      setNotice(
        `Verzonden · ${new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date())}`,
      )
      setWarning(result.warning ?? null)
      setText('')
      await refreshOutput()
    } catch (cause) {
      if (aliveRef.current) setNotice(cause instanceof Error ? cause.message : 'Message was not delivered')
    } finally {
      if (aliveRef.current) setSending(false)
    }
  }
  return (
    <section className="chat-pane">
      <div className="output-label">
        Recent output <span>{session}</span>
      </div>
      <pre className="output">{output || 'Loading recent output…'}</pre>
      <div className="composer">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void send()
            }
          }}
          placeholder="Message this seat…"
          aria-label="Message this seat"
          rows={3}
        />
        <div>
          <span>{notice ?? '⌘/Ctrl + Enter to send'}</span>
          {warning && (
            <details className="chat-warning">
              <summary>Details</summary>
              <small>{warning}</small>
            </details>
          )}
          <button type="button" onClick={() => void send()} disabled={!text.trim() || sending}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </section>
  )
}

export default App
