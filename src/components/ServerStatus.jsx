import { useState, useEffect } from 'react'
import { startHealthMonitoring, stopHealthMonitoring, getLastHealthStatus, waitForServer, checkServerHealth } from '../utils/serverHealth'

export default function ServerStatus() {
  const [healthStatus, setHealthStatus] = useState(getLastHealthStatus())
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    // Start monitoring
    const handleStatusChange = (status) => {
      setHealthStatus(status)
    }

    startHealthMonitoring(handleStatusChange)

    // Cleanup on unmount
    return () => {
      stopHealthMonitoring()
    }
  }, [])

  const getStatusColor = () => {
    switch (healthStatus.status) {
      case 'online':
        return 'bg-green-500'
      case 'waking':
        return 'bg-yellow-500'
      case 'offline':
        return 'bg-red-500'
      case 'error':
        return 'bg-orange-500'
      default:
        return 'bg-gray-500'
    }
  }

  const getStatusText = () => {
    switch (healthStatus.status) {
      case 'online':
        return 'Server Online'
      case 'waking':
        return 'Server Waking Up...'
      case 'offline':
        return 'Server Offline'
      case 'error':
        return 'Server Error'
      case 'unavailable':
        return 'API Not Configured'
      default:
        return 'Checking...'
    }
  }

  const getStatusIcon = () => {
    switch (healthStatus.status) {
      case 'online':
        return '✓'
      case 'waking':
        return '⏳'
      case 'offline':
        return '✗'
      case 'error':
        return '⚠'
      default:
        return '?'
    }
  }

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Never'
    const date = new Date(timestamp)
    const now = Date.now()
    const diff = now - timestamp
    const seconds = Math.floor(diff / 1000)
    
    if (seconds < 5) return 'Just now'
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    return date.toLocaleTimeString()
  }

  const handleWakeServer = async () => {
    setHealthStatus({ ...healthStatus, status: 'waking', error: 'Attempting to wake server...' })
    const wokeUp = await waitForServer()
    if (wokeUp) {
      const newStatus = await checkServerHealth()
      setHealthStatus(newStatus)
    } else {
      setHealthStatus({
        ...healthStatus,
        status: 'offline',
        error: 'Server did not wake up in time. Please try again.'
      })
    }
  }

  // Don't show if status is unknown or unavailable
  if (healthStatus.status === 'unknown' || healthStatus.status === 'unavailable') {
    return null
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-black/90 text-white rounded-lg shadow-lg border border-white/20 min-w-[200px]">
        {/* Status Bar */}
        <div
          className={`flex items-center justify-between px-4 py-2 cursor-pointer ${getStatusColor()}`}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">{getStatusIcon()}</span>
            <span className="text-sm font-medium">{getStatusText()}</span>
          </div>
          <span className="text-xs opacity-75">{isExpanded ? '▼' : '▲'}</span>
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="px-4 py-3 space-y-2 text-xs border-t border-white/10">
            {healthStatus.responseTime !== null && (
              <div className="flex justify-between">
                <span className="opacity-75">Response Time:</span>
                <span>{healthStatus.responseTime}ms</span>
              </div>
            )}
            
            {healthStatus.timestamp && (
              <div className="flex justify-between">
                <span className="opacity-75">Last Check:</span>
                <span>{formatTimestamp(healthStatus.timestamp)}</span>
              </div>
            )}

            {healthStatus.uptime && (
              <div className="flex justify-between">
                <span className="opacity-75">Server Uptime:</span>
                <span>{healthStatus.uptime.formatted}</span>
              </div>
            )}

            {healthStatus.error && (
              <div className="mt-2 pt-2 border-t border-white/10">
                <div className="opacity-75 mb-1">Error:</div>
                <div className="text-red-300 text-xs">{healthStatus.error}</div>
              </div>
            )}

            {healthStatus.status === 'offline' && (
              <button
                onClick={handleWakeServer}
                className="w-full mt-2 px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 rounded text-xs font-medium transition-colors"
              >
                Wake Server
              </button>
            )}

            {healthStatus.status === 'waking' && (
              <div className="mt-2 text-center text-xs opacity-75">
                Waiting for server to wake up...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

