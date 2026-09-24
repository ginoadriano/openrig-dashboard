import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { isMockMode } from './api'

interface TerminalPaneProps {
  session: string
}

function keyboardFrame(data: string) {
  if (data === '\r') return { type: 'keys', keys: ['Enter'] }
  if (data === '\u0003') return { type: 'keys', keys: ['C-c'] }
  if (data === '\u0004') return { type: 'keys', keys: ['C-d'] }
  return { type: 'text', text: data }
}

export function TerminalPane({ session }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting' | 'offline'>(
    'connecting',
  )
  const [closeReason, setCloseReason] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: { background: '#111315', foreground: '#e7e9ed', cursor: '#d8ff72' },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    fit.fit()

    let socket: WebSocket | null = null
    let retryTimer: number | undefined
    let retryCount = 0
    let disposed = false
    const resizeObserver = new ResizeObserver(() => fit.fit())
    resizeObserver.observe(host)

    const connect = () => {
      if (disposed) return
      if (isMockMode()) {
        setConnection('live')
        terminal.writeln('\x1b[1;32mMock terminal connected\x1b[0m')
        terminal.writeln(`Attached to ${session}. Input is rendered locally.`)
        return
      }
      setConnection(retryCount ? 'reconnecting' : 'connecting')
      setCloseReason(null)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(
        `${protocol}//${window.location.host}/dash/terminal/${encodeURIComponent(session)}`,
      )
      socketRef.current = socket
      socket.onopen = () => {
        retryCount = 0
        setConnection('live')
      }
      socket.onmessage = (event) => {
        if (typeof event.data === 'string') terminal.write(event.data)
      }
      socket.onerror = () => socket?.close()
      socket.onclose = (event) => {
        if (disposed) return
        const reason = event.reason || `Connection closed (${event.code})`
        setCloseReason(reason)
        if (event.code === 1007 || event.code === 1008) {
          setConnection('offline')
          return
        }
        retryCount += 1
        setConnection('reconnecting')
        retryTimer = window.setTimeout(connect, Math.min(10_000, 600 * 2 ** Math.min(retryCount, 4)))
      }
    }

    const input = terminal.onData((data) => {
      if (isMockMode()) {
        terminal.write(data === '\r' ? '\r\n' : data)
        return
      }
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(keyboardFrame(data)))
        socket.send(JSON.stringify({ type: 'scroll', offset: 0 }))
      }
    })
    const scroll = terminal.onScroll((position) => {
      if (isMockMode() || socket?.readyState !== WebSocket.OPEN) return
      const offset = Math.max(0, terminal.buffer.active.baseY - position)
      socket.send(JSON.stringify({ type: 'scroll', offset }))
    })
    connect()

    return () => {
      disposed = true
      if (retryTimer) window.clearTimeout(retryTimer)
      input.dispose()
      scroll.dispose()
      resizeObserver.disconnect()
      socket?.close()
      socketRef.current = null
      terminal.dispose()
    }
  }, [session])

  return (
    <section className="terminal-shell" aria-label={`Terminal for ${session}`}>
      <div className="terminal-toolbar">
        <span className={`connection ${connection}`}></span>
        {connection === 'live'
          ? 'Live terminal'
          : connection === 'offline'
            ? (closeReason ?? 'Offline')
            : 'Connecting…'}
        <button
          className="terminal-live"
          onClick={() =>
            socketRef.current?.readyState === WebSocket.OPEN &&
            socketRef.current.send(JSON.stringify({ type: 'scroll', offset: 0 }))
          }
        >
          Live
        </button>
        <span>{session}</span>
      </div>
      <div className="terminal-host" ref={hostRef} />
    </section>
  )
}
