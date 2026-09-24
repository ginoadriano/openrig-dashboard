import { useCallback, useEffect, useRef, useState } from 'react'
import {
  bindSession,
  createRig,
  createSnapshot,
  getPosture,
  getSeatModel,
  getSnapshots,
  restoreSnapshot,
  rigAction,
  savePosture,
  scanSessions,
  seatAction,
  setSeatModel,
} from './api'
import type { ActionResult, DiscoveredSession, Rig, RigPosture, Seat, Snapshot } from './types'

async function runAction(
  fn: () => Promise<ActionResult>,
  options: {
    setBusy: (value: boolean) => void
    setError: (value: string | null) => void
    onResult: (result: ActionResult) => void
    isAlive: () => boolean
  },
) {
  const update = (callback: () => void) => options.isAlive() && callback()
  update(() => {
    options.setBusy(true)
    options.setError(null)
  })
  try {
    const result = await fn()
    if (!result.ok) {
      update(() => options.setError(result.message || 'Action failed'))
      return null
    }
    update(() => options.onResult(result))
    return result
  } catch (cause) {
    update(() => options.setError(cause instanceof Error ? cause.message : 'Action failed'))
    return null
  } finally {
    update(() => options.setBusy(false))
  }
}

export function Toast({ result, onClose }: { result: ActionResult | null; onClose: () => void }) {
  if (!result) return null
  return (
    <div className="toast">
      <button onClick={onClose}>×</button>
      <strong>
        {result.ok ? 'Done' : 'Action failed'} · {result.message}
      </strong>
      {result.detail !== undefined && (
        <details>
          <summary>Details</summary>
          <pre>{JSON.stringify(result.detail, null, 2)}</pre>
        </details>
      )}
    </div>
  )
}
export function ConfirmDialog({
  name,
  warning,
  onClose,
  onConfirm,
}: {
  name: string
  warning?: string
  onClose: () => void
  onConfirm: () => Promise<ActionResult>
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)
  useEffect(
    () => () => {
      aliveRef.current = false
    },
    [],
  )
  return (
    <div className="dialog-backdrop">
      <section className="task-dialog" role="dialog" aria-modal="true">
        <h2>Confirm destructive action</h2>
        <p>
          Type <b>{name}</b> exactly to continue.
        </p>
        {warning && <p className="stalled-note">Warning: {warning}</p>}
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} />
        <footer>
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={typed !== name || busy}
            onClick={async () => {
              try {
                setBusy(true)
                setError(null)
                const result = await onConfirm()
                if (!result.ok) throw new Error(result.message || 'Action failed')
                if (aliveRef.current) onClose()
              } catch (cause) {
                if (aliveRef.current) setError(cause instanceof Error ? cause.message : 'Action failed')
              } finally {
                if (aliveRef.current) setBusy(false)
              }
            }}
          >
            {busy ? 'Working…' : 'Confirm'}
          </button>
        </footer>
        {error && (
          <p className="action-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  )
}
export function RigManagement({
  rig,
  onResult,
  onManageSeat,
}: {
  rig: Rig
  onResult: (r: ActionResult) => void
  onManageSeat: (s: Seat) => void
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [posture, setPosture] = useState<RigPosture | null>(null)
  const [postureMode, setPostureMode] = useState('')
  const [postureText, setPostureText] = useState('{}')
  const [postureError, setPostureError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<(() => Promise<ActionResult>) | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const aliveRef = useRef(true)
  const refresh = useCallback(async () => {
    const rigId = rig.rigId
    const [nextSnapshots, nextPosture] = await Promise.all([getSnapshots(rigId), getPosture(rigId)])
    if (!aliveRef.current) return
    const { mode, ...record } = nextPosture.effective
    setSnapshots(nextSnapshots)
    setPosture(nextPosture)
    setPostureMode(typeof mode === 'string' ? mode : '')
    setPostureText(JSON.stringify(record, null, 2))
  }, [rig.rigId])
  useEffect(() => {
    aliveRef.current = true
    const t = setTimeout(() => {
      refresh().catch((cause) => {
        if (aliveRef.current) setError(cause instanceof Error ? cause.message : 'Could not load rig details')
      })
    }, 0)
    return () => {
      aliveRef.current = false
      clearTimeout(t)
    }
  }, [refresh])
  const doAction = async (fn: () => Promise<ActionResult>) => {
    const result = await runAction(fn, { setBusy, setError, onResult, isAlive: () => aliveRef.current })
    if (result) await refresh()
  }
  return (
    <div className="content rig-management">
      <header className="page-header queue-header">
        <div>
          <p className="eyebrow">Rig management</p>
          <h1>{rig.name}</h1>
          <p className="subtitle">
            {rig.status} · {rig.seats.length} seats · {rig.attentionCount} need attention
          </p>
        </div>
        <div className="action-row">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void doAction(() => rigAction(rig.rigId, 'up'))}
          >
            Start
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              setConfirmName(rig.name)
              setConfirm(() => () => rigAction(rig.rigId, 'down', { confirm: rig.name }))
            }}
          >
            Stop
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void doAction(() => rigAction(rig.rigId, 'archive'))}
          >
            Archive
          </button>
        </div>
      </header>
      <section className="management-grid">
        {error && (
          <p className="action-error" role="alert">
            {error}
          </p>
        )}
        <article className="management-card">
          <h2>Seats</h2>
          <table>
            <thead>
              <tr>
                <th>Seat</th>
                <th>State</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rig.seats.map((seat) => (
                <tr key={seat.session}>
                  <td>
                    {seat.logicalId}
                    <small>{seat.session}</small>
                  </td>
                  <td>{seat.activity}</td>
                  <td>
                    <button className="secondary-button" onClick={() => onManageSeat(seat)}>
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
        <article className="management-card">
          <div className="card-title">
            <h2>Snapshots</h2>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void doAction(() => createSnapshot(rig.rigId))}
            >
              Create snapshot
            </button>
          </div>
          {snapshots.length ? (
            snapshots.map((snapshot) => (
              <div className="snapshot" key={snapshot.id}>
                <span>
                  {snapshot.label ?? snapshot.kind ?? 'Snapshot'}
                  <small>{new Date(snapshot.createdAt).toLocaleString()}</small>
                </span>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setConfirmName(rig.name)
                    setConfirm(() => () => restoreSnapshot(snapshot.id, rig.name))
                  }}
                >
                  Restore
                </button>
              </div>
            ))
          ) : (
            <p className="subtitle">No snapshots yet.</p>
          )}
        </article>
        <article className="management-card posture">
          <div className="card-title">
            <h2>Permission / mode</h2>
            <span>{posture?.editable ? 'Editable' : 'Read-only'}</span>
          </div>
          <label>
            Mode
            <input
              disabled={!posture?.editable}
              value={postureMode}
              onChange={(event) => setPostureMode(event.target.value)}
              placeholder="operator"
            />
          </label>
          <textarea
            disabled={!posture?.editable}
            value={postureText}
            onChange={(e) => {
              setPostureText(e.target.value)
              try {
                const value: unknown = JSON.parse(e.target.value)
                setPostureError(
                  value && typeof value === 'object' && !Array.isArray(value)
                    ? null
                    : 'Posture must be a JSON object.',
                )
              } catch {
                setPostureError('Invalid JSON. Fix it before saving.')
              }
            }}
            rows={8}
          />
          {postureError && (
            <p className="action-error" role="alert">
              {postureError}
            </p>
          )}
          {posture?.editable && (
            <button
              className="primary-button"
              disabled={Boolean(postureError) || !postureMode.trim() || busy}
              onClick={() =>
                posture &&
                void doAction(() =>
                  savePosture(
                    rig.rigId,
                    postureMode.trim(),
                    JSON.parse(postureText) as Record<string, unknown>,
                  ),
                )
              }
            >
              Save posture
            </button>
          )}
        </article>
      </section>
      {confirm && (
        <ConfirmDialog
          name={confirmName}
          warning={
            rig.name === 'dashboard-team'
              ? 'This stops the orchestrator of this dashboard.'
              : rig.name === 'kernel'
                ? 'This stops the OpenRig kernel: operator-agent, queue-worker, and related services.'
                : undefined
          }
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const result = await confirm()
            onResult(result)
            await refresh()
            return result
          }}
        />
      )}
    </div>
  )
}
export function SeatManagement({ seat, onResult }: { seat: Seat; onResult: (r: ActionResult) => void }) {
  const [model, setModel] = useState('')
  const [available, setAvailable] = useState<string[]>([])
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    void getSeatModel(seat.session)
      .then((data) => {
        if (!aliveRef.current) return
        setModel(data.current ?? '')
        setAvailable(data.available)
      })
      .catch(
        (cause) =>
          aliveRef.current && setError(cause instanceof Error ? cause.message : 'Could not load model'),
      )
    return () => {
      aliveRef.current = false
    }
  }, [seat.session])
  return (
    <div className="seat-manage">
      <h3>Management</h3>
      {error && (
        <p className="action-error" role="alert">
          {error}
        </p>
      )}
      <button
        disabled={busy}
        className="secondary-button"
        onClick={() =>
          void runAction(() => seatAction(seat.session, 'launch'), {
            setBusy,
            setError,
            onResult,
            isAlive: () => aliveRef.current,
          })
        }
      >
        Launch
      </button>
      <button className="secondary-button" onClick={() => setConfirm(true)}>
        Stop
      </button>
      <label>
        Model
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">Free text…</option>
          {available.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model" />
      <p className="subtitle">Not persistent after restart in OpenRig 0.5.14.</p>
      <button
        disabled={busy}
        className="primary-button"
        onClick={() =>
          void runAction(() => setSeatModel(seat.session, model), {
            setBusy,
            setError,
            onResult,
            isAlive: () => aliveRef.current,
          })
        }
      >
        Switch model
      </button>
      {confirm && (
        <ConfirmDialog
          name={seat.session}
          warning={
            seat.session === 'orch-lead@dashboard-team'
              ? 'This stops the orchestrator of this dashboard.'
              : undefined
          }
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            const result = await seatAction(seat.session, 'stop', { confirm: seat.session })
            onResult(result)
            return result
          }}
        />
      )}
    </div>
  )
}
export function Discovery({ fleet, onResult }: { fleet: Rig[]; onResult: (r: ActionResult) => void }) {
  const [items, setItems] = useState<DiscoveredSession[]>([])
  const [rigId, setRigId] = useState(fleet[0]?.rigId ?? '')
  const [logicalId, setLogicalId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)
  useEffect(
    () => () => {
      aliveRef.current = false
    },
    [],
  )
  const actionOptions = { setBusy, setError, onResult, isAlive: () => aliveRef.current }
  return (
    <div className="content rig-management">
      <header className="page-header queue-header">
        <div>
          <p className="eyebrow">Rig setup</p>
          <h1>Discover sessions</h1>
        </div>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() =>
            void runAction(async () => {
              const sessions = await scanSessions()
              if (aliveRef.current) setItems(sessions)
              return { ok: true, message: 'Sessions scanned' }
            }, actionOptions)
          }
        >
          Scan
        </button>
      </header>
      {error && (
        <p className="action-error" role="alert">
          {error}
        </p>
      )}
      {items.map((item) => (
        <article className="management-card discovery" key={item.id}>
          <b>{item.session}</b>
          <span>
            {item.runtime} · {item.cwd}
          </span>
          <select value={rigId} onChange={(e) => setRigId(e.target.value)}>
            {fleet.map((rig) => (
              <option key={rig.rigId} value={rig.rigId}>
                {rig.name}
              </option>
            ))}
          </select>
          <input value={logicalId} onChange={(e) => setLogicalId(e.target.value)} placeholder="logicalId" />
          <button
            className="secondary-button"
            disabled={!rigId || !logicalId || busy}
            onClick={() => void runAction(() => bindSession(item.id, rigId, logicalId), actionOptions)}
          >
            Bind
          </button>
        </article>
      ))}
    </div>
  )
}
export function NewRig({ onClose, onResult }: { onClose: () => void; onResult: (r: ActionResult) => void }) {
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)
  useEffect(
    () => () => {
      aliveRef.current = false
    },
    [],
  )
  return (
    <div className="dialog-backdrop">
      <section className="task-dialog">
        <h2>Start rig</h2>
        <label>
          Source path / library entry
          <input value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <footer>
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!source || busy}
            onClick={() =>
              void runAction(() => createRig(source), {
                setBusy,
                setError,
                onResult: (result) => {
                  onResult(result)
                  onClose()
                },
                isAlive: () => aliveRef.current,
              })
            }
          >
            Start rig
          </button>
        </footer>
        {error && (
          <p className="action-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  )
}
