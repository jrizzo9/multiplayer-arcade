import { useState, useEffect, useRef } from 'react'

const MAX_LOGS = 100
const LOG_LEVELS = ['all', 'error', 'warn', 'info', 'debug']

// Generate a unique session ID for this browser session
const SESSION_ID = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

function ErrorLogger() {
  const [isOpen, setIsOpen] = useState(false)
  const [logs, setLogs] = useState([])
  const [filter, setFilter] = useState('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const logsEndRef = useRef(null)
  const logBufferRef = useRef([])
  const sendLogsIntervalRef = useRef(null)
  const originalConsole = useRef({
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug
  })

  // Scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && isOpen) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll, isOpen])

  // Intercept console methods
  useEffect(() => {
    // Send logs to server periodically
    const sendLogsToServer = async () => {
      if (logBufferRef.current.length === 0) return
      
      // Limit batch size to prevent payload too large errors (max 50 logs per batch)
      const MAX_BATCH_SIZE = 50
      const logsToSend = logBufferRef.current.splice(0, MAX_BATCH_SIZE)
      
      // Truncate large objects in raw field to prevent huge payloads
      const truncatedLogs = logsToSend.map(log => {
        const truncatedLog = { ...log }
        if (truncatedLog.raw && Array.isArray(truncatedLog.raw)) {
          truncatedLog.raw = truncatedLog.raw.map(arg => {
            if (typeof arg === 'object' && arg !== null) {
              try {
                const str = JSON.stringify(arg)
                // Truncate objects larger than 1000 characters
                if (str.length > 1000) {
                  return JSON.parse(str.substring(0, 1000) + '... [truncated]')
                }
                return arg
              } catch {
                return String(arg).substring(0, 1000)
              }
            }
            return arg
          })
        }
        return truncatedLog
      })
      
      try {
        const apiUrl = `http://${window.location.hostname}:8000`
        const response = await fetch(`${apiUrl}/api/debug/client-logs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            logs: truncatedLogs,
            sessionId: SESSION_ID
          })
        })
        
        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}`)
        }
      } catch (error) {
        // Silently fail - don't spam console with errors
        // Put logs back in buffer to retry later (but limit buffer size)
        if (logBufferRef.current.length < 200) {
          logBufferRef.current.unshift(...logsToSend)
        }
      }
    }
    
    const addLog = (level, args) => {
      const timestamp = new Date().toLocaleTimeString()
      const message = args
        .map(arg => {
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg, null, 2)
            } catch {
              return String(arg)
            }
          }
          return String(arg)
        })
        .join(' ')

      const newLog = {
        id: Date.now() + Math.random(),
        timestamp,
        level,
        message,
        raw: args
      }
      
      // Add to buffer for sending to server
      logBufferRef.current.push(newLog)
      
      // Defer setState to avoid updating during render
      // Use setTimeout to schedule the update after the current render cycle
      setTimeout(() => {
        setLogs(prev => {
          const updated = [...prev, newLog]
          // Keep only last MAX_LOGS
          return updated.slice(-MAX_LOGS)
        })
      }, 0)
    }
    
    // Send logs every 2 seconds
    if (!sendLogsIntervalRef.current) {
      sendLogsIntervalRef.current = setInterval(sendLogsToServer, 2000)
    }

    // Override console methods
    console.log = (...args) => {
      originalConsole.current.log(...args)
      addLog('info', args)
    }

    console.error = (...args) => {
      originalConsole.current.error(...args)
      addLog('error', args)
    }

    console.warn = (...args) => {
      originalConsole.current.warn(...args)
      addLog('warn', args)
    }

    console.info = (...args) => {
      originalConsole.current.info(...args)
      addLog('info', args)
    }

    console.debug = (...args) => {
      originalConsole.current.debug(...args)
      addLog('debug', args)
    }

    // Capture unhandled errors
    const handleError = (event) => {
      addLog('error', [`Unhandled Error: ${event.message}`, event.filename, event.lineno])
    }

    const handleRejection = (event) => {
      addLog('error', [`Unhandled Promise Rejection: ${event.reason}`])
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)

    return () => {
      // Restore original console methods
      console.log = originalConsole.current.log
      console.error = originalConsole.current.error
      console.warn = originalConsole.current.warn
      console.info = originalConsole.current.info
      console.debug = originalConsole.current.debug
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
      
      // Clear interval
      if (sendLogsIntervalRef.current) {
        clearInterval(sendLogsIntervalRef.current)
        sendLogsIntervalRef.current = null
      }
      
      // Send any remaining logs
      sendLogsToServer()
    }
  }, [])

  const filteredLogs = filter === 'all' 
    ? logs 
    : logs.filter(log => log.level === filter)

  const getLogColor = (level) => {
    switch (level) {
      case 'error': return 'text-red-400'
      case 'warn': return 'text-yellow-400'
      case 'info': return 'text-blue-400'
      case 'debug': return 'text-gray-400'
      default: return 'text-white'
    }
  }

  const getLogBgColor = (level) => {
    switch (level) {
      case 'error': return 'bg-red-900 bg-opacity-20'
      case 'warn': return 'bg-yellow-900 bg-opacity-20'
      case 'info': return 'bg-blue-900 bg-opacity-20'
      case 'debug': return 'bg-gray-900 bg-opacity-20'
      default: return 'bg-black bg-opacity-20'
    }
  }

  const clearLogs = () => {
    setLogs([])
  }

  const errorCount = logs.filter(log => log.level === 'error').length
  const warnCount = logs.filter(log => log.level === 'warn').length

  return (
    <>
      {/* Log Panel */}
      {isOpen && (
        <div className="fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] sm:w-full max-w-2xl h-96 bg-black border-2 border-white rounded-lg flex flex-col shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b-2 border-white">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-bold text-white">Error Logger</h3>
              <div className="flex items-center gap-2">
                {errorCount > 0 && (
                  <span className="px-2 py-1 text-xs font-bold text-white bg-red-600 rounded">
                    {errorCount} errors
                  </span>
                )}
                {warnCount > 0 && (
                  <span className="px-2 py-1 text-xs font-bold text-white bg-yellow-600 rounded">
                    {warnCount} warnings
                  </span>
                )}
                <span className="px-2 py-1 text-xs font-bold text-white bg-gray-600 rounded">
                  {logs.length} total
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-white text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="cursor-pointer"
                />
                Auto-scroll
              </label>
              <button
                onClick={clearLogs}
                className="px-3 py-1 text-xs font-bold text-white border border-white rounded hover:bg-white hover:text-black transition-all duration-200 cursor-pointer"
              >
                Clear
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="px-3 py-1 text-xs font-bold text-white border border-white rounded hover:bg-white hover:text-black transition-all duration-200 cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2 p-2 border-b border-gray-700 overflow-x-auto">
            {LOG_LEVELS.map(level => (
              <button
                key={level}
                onClick={() => setFilter(level)}
                className={`px-3 py-1 text-xs font-bold rounded transition-all duration-200 cursor-pointer whitespace-nowrap ${
                  filter === level
                    ? 'bg-white text-black'
                    : 'bg-gray-800 text-white border border-gray-600 hover:bg-gray-700'
                }`}
              >
                {level.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Logs */}
          <div className="flex-1 overflow-y-auto p-2 font-mono text-xs">
            {filteredLogs.length === 0 ? (
              <div className="text-gray-500 text-center py-8">No logs to display</div>
            ) : (
              filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className={`mb-2 p-2 rounded border-l-4 ${
                    log.level === 'error' ? 'border-red-500' :
                    log.level === 'warn' ? 'border-yellow-500' :
                    log.level === 'info' ? 'border-blue-500' :
                    'border-gray-500'
                  } ${getLogBgColor(log.level)}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-gray-500 text-xs whitespace-nowrap">
                      {log.timestamp}
                    </span>
                    <span className={`font-bold text-xs ${getLogColor(log.level)}`}>
                      [{log.level.toUpperCase()}]
                    </span>
                  </div>
                  <div className={`mt-1 break-words ${getLogColor(log.level)}`}>
                    {log.message}
                  </div>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </>
  )
}

export default ErrorLogger

