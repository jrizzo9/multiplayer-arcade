import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { getApiUrl } from '../utils/apiUrl'

export default function SocketTest() {
  const [status, setStatus] = useState('disconnected')
  const [socketId, setSocketId] = useState(null)
  const [connectedUsers, setConnectedUsers] = useState(0)
  const [logs, setLogs] = useState([])
  const [testMessage, setTestMessage] = useState('')
  
  const socketRef = useRef(null)
  const logsRef = useRef([])
  const sessionIdRef = useRef(`socket-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`)

  const sendLogToServer = async (message, level = 'info') => {
    const logEntry = {
      message,
      level,
      timestamp: new Date().toISOString(),
      source: 'SocketTest',
      socketId: socketRef.current?.id || null
    }

    try {
      const serverUrl = getApiUrl()
      if (!serverUrl) return // Skip if API URL not available
      const response = await fetch(`${serverUrl}/api/debug/client-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logs: [logEntry],
          sessionId: sessionIdRef.current
        })
      })
      if (!response.ok) {
        console.error('[SocketTest] Failed to send log to server:', response.status, response.statusText)
      }
    } catch (error) {
      console.error('[SocketTest] Error sending log to server:', error)
      // Don't break the UI, but log the error
    }
  }

  const addLog = (message, level = 'info') => {
    const timestamp = new Date().toLocaleTimeString()
    const logEntry = {
      id: Date.now() + Math.random(),
      timestamp,
      message
    }
    logsRef.current = [...logsRef.current.slice(-19), logEntry] // Keep last 20 logs
    setLogs(logsRef.current)
    
    // Send to server
    sendLogToServer(message, level)
  }

  const connect = () => {
    if (socketRef.current?.connected) {
      addLog('Already connected')
      return
    }

    // Clean up any existing socket
    if (socketRef.current) {
      socketRef.current.removeAllListeners()
      socketRef.current.disconnect()
      socketRef.current = null
    }

    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
    const serverUrl = getApiUrl() || `${protocol}//${window.location.hostname}:8000`
    addLog(`Connecting to ${serverUrl}...`)
    setStatus('connecting')

    const socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      forceNew: true, // Force new connection to avoid reusing old socket
      timeout: 20000,
      autoConnect: true
    })

    // Register all handlers BEFORE the socket might connect
    socket.on('connect', () => {
      setStatus('connected')
      setSocketId(socket.id)
      addLog(`Connected! Socket ID: ${socket.id}`)
      // Request user count immediately after connecting
      setTimeout(() => {
        if (socket.connected) {
          socket.emit('request-user-count')
          addLog('Requested user count from server')
        }
      }, 100)
    })

    socket.on('disconnect', (reason) => {
      setStatus('disconnected')
      setSocketId(null)
      setConnectedUsers(0)
      addLog(`Disconnected: ${reason}`)
    })

    socket.on('connect_error', (error) => {
      setStatus('error')
      addLog(`Connection error: ${error.message}`, 'error')
    })

    socket.on('user-count-update', (data) => {
      console.log('[SocketTest] Received user-count-update:', data)
      const otherUsers = Math.max(0, data.count - 1) // Subtract 1 to exclude self
      setConnectedUsers(otherUsers)
      addLog(`Total connected users: ${data.count} (${otherUsers} other users)`)
    })

    socket.on('test-message', (data) => {
      console.log('[SocketTest] Received test-message:', data)
      // Handle both 'from' (client-sent) and 'fromSocketId' (server-added)
      const from = data.from || data.fromSocketId || 'Unknown'
      addLog(`Message from ${from}: ${data.message}`)
    })

    socketRef.current = socket
  }

  const disconnect = () => {
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
      setStatus('disconnected')
      setSocketId(null)
      setConnectedUsers(0)
      addLog('Disconnected')
    }
  }

  const sendMessage = () => {
    if (!socketRef.current?.connected) {
      addLog('Not connected - cannot send message')
      return
    }

    const message = testMessage || 'Test message'
    socketRef.current.emit('test-message', {
      from: socketId || 'Unknown',
      message,
      timestamp: Date.now()
    })
    addLog(`Sent: ${message}`)
    setTestMessage('')
  }

  const clearLogs = () => {
    logsRef.current = []
    setLogs([])
  }

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect()
      }
    }
  }, [])

  const getStatusColor = (status) => {
    switch (status) {
      case 'connected': return 'text-green-500'
      case 'connecting': return 'text-yellow-500'
      case 'error': return 'text-red-500'
      default: return 'text-gray-500'
    }
  }

  return (
    <div className="min-h-screen bg-black text-white p-8 pt-20 sm:pt-24">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Socket Connection Test</h1>

        {/* Connection Panel */}
        <div className="bg-gray-900 p-6 rounded-lg border border-gray-700 mb-6">
          <h2 className="text-xl font-semibold mb-4">Your Connection</h2>
          <div className="space-y-4">
            <div>
              <span className="text-gray-400">Status: </span>
              <span className={getStatusColor(status)}>{status}</span>
            </div>
            {socketId && (
              <div>
                <span className="text-gray-400">Socket ID: </span>
                <span className="text-sm font-mono break-all">{socketId}</span>
              </div>
            )}
            <div>
              <span className="text-gray-400">Other users connected: </span>
              <span className="text-lg font-semibold">{connectedUsers}</span>
            </div>
            {status === 'connected' && connectedUsers === 0 && (
              <div className="text-sm text-yellow-400">
                Waiting for other users to connect...
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={connect}
                disabled={status === 'connected' || status === 'connecting'}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded"
              >
                Connect
              </button>
              <button
                onClick={disconnect}
                disabled={status !== 'connected'}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded"
              >
                Disconnect
              </button>
            </div>
            {status === 'connected' && connectedUsers > 0 && (
              <div className="p-4 bg-green-900/30 border border-green-500 rounded">
                <div className="text-green-400 font-semibold">Connection successful!</div>
                <div className="text-sm text-gray-400 mt-1">You can communicate with {connectedUsers} other user(s).</div>
              </div>
            )}
          </div>
        </div>

        {/* Message Test */}
        {status === 'connected' && (
          <div className="bg-gray-900 p-6 rounded-lg border border-gray-700 mb-6">
            <h2 className="text-xl font-semibold mb-4">Test Message</h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Type a message to send to other users..."
                className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white"
              />
              <button
                onClick={sendMessage}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded"
              >
                Send
              </button>
            </div>
            <div className="text-sm text-gray-400 mt-2">
              Messages will be broadcast to all connected users
            </div>
          </div>
        )}

        {/* Logs */}
        <div className="bg-gray-900 p-6 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Event Logs</h2>
            <button
              onClick={clearLogs}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              Clear Logs
            </button>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {logs.length === 0 ? (
              <div className="text-gray-500 text-center py-8">No logs yet. Click Connect to start.</div>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className="bg-gray-800 p-3 rounded border border-gray-700 text-sm"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-gray-500 font-mono text-xs">{log.timestamp}</span>
                    <span className="text-white">{log.message}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
