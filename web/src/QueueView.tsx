import { useCallback, useEffect, useMemo, useState } from 'react'
import { createQueue, getQueue, getQueueDetail, handoffQueue, updateQueue } from './api'
import type { QueueDetail, QueueItem, QueueState, Rig } from './types'

const activeStates = ['pending', 'in-progress', 'blocked']
const allStates = [...activeStates, 'done', 'handed-off', 'failed', 'canceled']

interface QueueViewProps {
  fleet: Rig[]
  seatSession?: string
  onOpenOwner: (session: string) => void
  refreshKey?: number
}

const age = (date: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60_000))
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const title = (body: string) => body.split('\n').find(Boolean) ?? 'Untitled task'
const transitionTime = (value: string | null | undefined) => {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Time unknown'
}
const isHumanDestination = (session: string) =>
  /^human(?:-[^@]+)?@(kernel|host)$/.test(session) || session.endsWith('@external')
const otherHumanOption = '__other_human__'

export function QueueView({ fleet, seatSession, onOpenOwner, refreshKey = 0 }: QueueViewProps) {
  const [items, setItems] = useState<QueueItem[]>([])
  const [selected, setSelected] = useState<QueueDetail | null>(null)
  const [rig, setRig] = useState('')
  const [seat, setSeat] = useState(seatSession ?? '')
  const [state, setState] = useState<string[]>(activeStates)
  const [error, setError] = useState<string | null>(null)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const seats = useMemo(() => fleet.flatMap((currentRig) => currentRig.seats), [fleet])
  const refresh = useCallback(async () => {
    try {
      setError(null)
      const data = await getQueue({
        rig: rig || undefined,
        session: seat || undefined,
        state,
        activeOnly: state.join() === activeStates.join(),
        limit: 100,
      })
      setItems(data.items)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load tasks')
    }
  }, [rig, seat, state])
  useEffect(() => {
    const initialTimer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(initialTimer)
  }, [refresh, refreshKey])
  const openDetail = async (qitemId: string) => {
    try {
      setError(null)
      setSelected(await getQueueDetail(qitemId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load task detail')
    }
  }
  const toggleState = (value: string) =>
    setState((current) =>
      current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value],
    )
  return (
    <div className={`queue-view ${seatSession ? 'queue-embedded' : ''}`}>
      <header className="page-header queue-header">
        <div>
          <p className="eyebrow">Coordination</p>
          <h1>{seatSession ? 'Tasks' : 'Taken'}</h1>
          <p className="subtitle">
            {seatSession ? `Work assigned to ${seatSession}` : 'Open work, handoffs and blocked decisions.'}
          </p>
        </div>
        {!seatSession && (
          <button className="primary-button" type="button" onClick={() => setNewTaskOpen(true)}>
            New task
          </button>
        )}
      </header>
      {error && (
        <div className="queue-error" role="alert">
          {error}
          <button type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      )}
      {!seatSession && (
        <section className="queue-filters" aria-label="Task filters">
          <label>
            Rig
            <select value={rig} onChange={(event) => setRig(event.target.value)}>
              <option value="">All rigs</option>
              {fleet.map((item) => (
                <option key={item.rigId} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Seat
            <select value={seat} onChange={(event) => setSeat(event.target.value)}>
              <option value="">All seats</option>
              {seats.map((item) => (
                <option key={item.session} value={item.session}>
                  {item.logicalId} · {item.session}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Status</legend>
            {allStates.map((value) => (
              <label key={value}>
                <input type="checkbox" checked={state.includes(value)} onChange={() => toggleState(value)} />
                {value}
              </label>
            ))}
          </fieldset>
        </section>
      )}
      <div className="queue-layout">
        <section className="queue-list" aria-label="Task list">
          {items.length ? (
            items.map((item) => (
              <button
                key={item.qitemId}
                type="button"
                className={`queue-row ${selected?.qitemId === item.qitemId ? 'selected' : ''}`}
                onClick={() => void openDetail(item.qitemId)}
              >
                <div className="queue-row-top">
                  <span className={`queue-state ${item.state}`}>{item.state}</span>
                  {item.stalled && (
                    <span className="stalled" title={item.stalled}>
                      Stuck
                    </span>
                  )}
                  <time>{age(item.tsCreated)}</time>
                </div>
                <strong>{title(item.body)}</strong>
                <span className="queue-route">
                  {item.sourceSession} <b>→</b> {item.destinationSession}
                </span>
                <footer>
                  <span>{item.priority ?? item.tier ?? 'normal'}</span>
                  {item.tags.slice(0, 2).map((tag) => (
                    <em key={tag}>#{tag}</em>
                  ))}
                </footer>
              </button>
            ))
          ) : (
            <div className="empty-state">No tasks match these filters.</div>
          )}
        </section>
        <QueueDetailPane
          key={selected?.qitemId ?? 'empty'}
          detail={selected}
          seats={seats}
          onChanged={async () => {
            await refresh()
            if (selected) setSelected(await getQueueDetail(selected.qitemId))
          }}
          onOpenOwner={onOpenOwner}
        />
      </div>
      {newTaskOpen && (
        <NewTaskDialog
          seats={seats}
          onClose={() => setNewTaskOpen(false)}
          onCreated={async () => {
            setNewTaskOpen(false)
            await refresh()
          }}
        />
      )}
    </div>
  )
}

function QueueDetailPane({
  detail,
  seats,
  onChanged,
  onOpenOwner,
}: {
  detail: QueueDetail | null
  seats: { session: string; logicalId: string }[]
  onChanged: () => Promise<void>
  onOpenOwner: (session: string) => void
}) {
  const [state, setState] = useState<QueueState>(detail?.state ?? 'pending')
  const [note, setNote] = useState('')
  const [handoff, setHandoff] = useState(detail?.destinationSession ?? '')
  const [error, setError] = useState<string | null>(null)
  if (!detail)
    return (
      <aside className="queue-detail empty-detail">Select a task to read its history and take action.</aside>
    )
  const changeState = async () => {
    try {
      setError(null)
      await updateQueue(detail.qitemId, { state, note: note || undefined })
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update task')
    }
  }
  const handoffTask = async () => {
    try {
      setError(null)
      await handoffQueue(detail.qitemId, { toSession: handoff, note: note || undefined })
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not hand off task')
    }
  }
  return (
    <aside className="queue-detail">
      <div className="queue-detail-heading">
        <span className={`queue-state ${detail.state}`}>{detail.state}</span>
        <span>{detail.priority ?? detail.tier ?? 'normal'}</span>
      </div>
      <h2>{title(detail.body)}</h2>
      <p className="queue-route">
        {detail.sourceSession} <b>→</b> {detail.destinationSession}
      </p>
      <pre className="queue-body">{detail.body}</pre>
      <div className="tags">
        {detail.tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
      </div>
      {detail.stalled && <p className="stalled-note">Stuck: {detail.stalled}</p>}
      <button
        className="secondary-button"
        type="button"
        onClick={() => onOpenOwner(detail.destinationSession)}
      >
        Open owner terminal
      </button>
      <section className="queue-actions">
        <h3>Change state</h3>
        <select value={state} onChange={(event) => setState(event.target.value)}>
          {allStates.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional note"
          rows={2}
        />
        <button className="primary-button" type="button" onClick={() => void changeState()}>
          Save state
        </button>
        <h3>Hand off</h3>
        <select value={handoff} onChange={(event) => setHandoff(event.target.value)}>
          {seats.map((seat) => (
            <option key={seat.session} value={seat.session}>
              {seat.logicalId} · {seat.session}
            </option>
          ))}
        </select>
        <button
          className="secondary-button"
          type="button"
          onClick={() => void handoffTask()}
          disabled={!handoff || handoff === detail.destinationSession}
        >
          Hand off task
        </button>
      </section>
      {error && (
        <p className="action-error" role="alert">
          {error}
        </p>
      )}
      <section className="transitions">
        <h3>History</h3>
        {detail.transitions.map((transition, index) => (
          <article key={`${transition.at}-${index}`}>
            <time>{transitionTime(transition.at)}</time>
            <strong>
              {transition.fromState ?? 'created'} → {transition.toState ?? 'unknown state'}
            </strong>
            <span>{transition.actor ?? 'unknown actor'}</span>
            {transition.note && <p>{transition.note}</p>}
          </article>
        ))}
      </section>
    </aside>
  )
}

function NewTaskDialog({
  seats,
  onClose,
  onCreated,
}: {
  seats: { session: string; logicalId: string }[]
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const [destinationChoice, setDestinationChoice] = useState(seats[0]?.session ?? '')
  const [otherHumanSession, setOtherHumanSession] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState('routine')
  const [summary, setSummary] = useState('')
  const [evidenceRef, setEvidenceRef] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const create = async () => {
    const destinationSession =
      destinationChoice === otherHumanOption ? otherHumanSession.trim() : destinationChoice
    const humanDestination = isHumanDestination(destinationSession)
    if (destinationChoice === otherHumanOption && !humanDestination) {
      setError('Enter a human address, such as human@kernel or human-review@host.')
      return
    }
    if (!destinationSession || !body.trim()) {
      setError('Choose a destination and write the task body.')
      return
    }
    if (humanDestination && (!summary.trim() || !evidenceRef.trim())) {
      setError('A summary and evidence reference are required for a human-routed task.')
      return
    }
    try {
      setSaving(true)
      setError(null)
      await createQueue({
        destinationSession,
        body: body.trim(),
        priority,
        summary: summary.trim() || undefined,
        evidenceRef: evidenceRef.trim() || undefined,
      })
      await onCreated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create task')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="task-dialog" role="dialog" aria-modal="true" aria-labelledby="new-task-title">
        <header>
          <div>
            <p className="eyebrow">Queue</p>
            <h2 id="new-task-title">New task</h2>
          </div>
          <button type="button" className="close-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <label>
          Destination
          <select value={destinationChoice} onChange={(event) => setDestinationChoice(event.target.value)}>
            <optgroup label="Fleet seats">
              {seats.map((seat) => (
                <option key={seat.session} value={seat.session}>
                  {seat.logicalId} · {seat.session}
                </option>
              ))}
            </optgroup>
            <optgroup label="Mens">
              <option value="human@kernel">human@kernel</option>
              <option value={otherHumanOption}>Other human address…</option>
            </optgroup>
          </select>
        </label>
        {destinationChoice === otherHumanOption && (
          <label>
            Human address
            <input
              value={otherHumanSession}
              onChange={(event) => setOtherHumanSession(event.target.value)}
              placeholder="human-review@host"
              required
            />
          </label>
        )}
        {(destinationChoice === otherHumanOption ||
          isHumanDestination(
            destinationChoice === otherHumanOption ? otherHumanSession.trim() : destinationChoice,
          )) && (
          <>
            <label>
              Summary
              <input
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="Concise decision or requested outcome"
                required
              />
            </label>
            <label>
              Evidence reference
              <input
                value={evidenceRef}
                onChange={(event) => setEvidenceRef(event.target.value)}
                placeholder="Queue item, file path, or URL with supporting context"
                required
              />
            </label>
          </>
        )}
        <label>
          Priority
          <select value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <label>
          Task body
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={7}
            placeholder="Describe the work and the desired outcome…"
          />
        </label>
        {error && (
          <p className="action-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => void create()} disabled={saving}>
            {saving ? 'Creating…' : 'Create task'}
          </button>
        </footer>
      </section>
    </div>
  )
}
