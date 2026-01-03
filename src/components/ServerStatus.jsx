import { useState, useEffect } from 'react'
import { startHealthMonitoring, stopHealthMonitoring, getLastHealthStatus, waitForServer, checkServerHealth } from '../utils/serverHealth'

export default function ServerStatus() {
  const [healthStatus, setHealthStatus] = useState(getLastHealthStatus())

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
      <div className="bg-black/90 text-white rounded-lg shadow-lg border border-white/20 min-w-[280px] max-w-[400px]">
        {/* Expanded Details */}
        <div className="px-4 py-3 space-y-2 text-xs max-h-[70vh] overflow-y-auto">
            {/* Latency/Performance */}
            <div className="space-y-1 pb-2 border-b border-white/10">
              <div className="font-semibold text-xs mb-1 opacity-90">Performance</div>
              {healthStatus.responseTime !== null && (
                <div className="flex justify-between">
                  <span className="opacity-75">Latency:</span>
                  <span className={healthStatus.responseTime < 200 ? 'text-green-400' : healthStatus.responseTime < 500 ? 'text-yellow-400' : 'text-red-400'}>
                    {healthStatus.responseTime}ms
                  </span>
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
            </div>

            {/* Render Service Info */}
            {healthStatus.render && (
              <div className="space-y-1 pt-2 pb-2 border-b border-white/10">
                <div className="font-semibold text-xs mb-1 opacity-90">Render Service</div>
                <div className="flex justify-between">
                  <span className="opacity-75">Service:</span>
                  <span>{healthStatus.render.serviceName || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-75">Environment:</span>
                  <span className="uppercase">{healthStatus.render.environment || 'N/A'}</span>
                </div>
                {healthStatus.render.region && (
                  <div className="flex justify-between">
                    <span className="opacity-75">Region:</span>
                    <span>{healthStatus.render.region}</span>
                  </div>
                )}
              </div>
            )}

            {/* Database Status */}
            {healthStatus.database && (
              <div className="space-y-1 pt-2 pb-2 border-b border-white/10">
                <div className="font-semibold text-xs mb-1 opacity-90">Database</div>
                <div className="flex justify-between">
                  <span className="opacity-75">Status:</span>
                  <span className={healthStatus.database.status === 'connected' ? 'text-green-400' : 'text-red-400'}>
                    {healthStatus.database.status === 'connected' ? '✓ Connected' : '✗ Error'}
                  </span>
                </div>
                {healthStatus.database.activeRooms !== undefined && (
                  <div className="flex justify-between">
                    <span className="opacity-75">Active Rooms:</span>
                    <span>{healthStatus.database.activeRooms}</span>
                  </div>
                )}
                {healthStatus.database.activePlayers !== undefined && (
                  <div className="flex justify-between">
                    <span className="opacity-75">Active Players:</span>
                    <span>{healthStatus.database.activePlayers}</span>
                  </div>
                )}
                {healthStatus.database.totalRooms !== undefined && (
                  <div className="flex justify-between">
                    <span className="opacity-75">Total Rooms:</span>
                    <span>{healthStatus.database.totalRooms}</span>
                  </div>
                )}
                {healthStatus.database.error && (
                  <div className="mt-1 text-red-300 text-xs">
                    {healthStatus.database.error}
                  </div>
                )}
              </div>
            )}

            {/* Socket Connections */}
            {healthStatus.sockets && (
              <div className="space-y-1 pt-2 pb-2 border-b border-white/10">
                <div className="font-semibold text-xs mb-1 opacity-90">WebSocket</div>
                <div className="flex justify-between">
                  <span className="opacity-75">Connections:</span>
                  <span>{healthStatus.sockets.totalConnections || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-75">Active Rooms:</span>
                  <span>{healthStatus.sockets.activeRooms || 0}</span>
                </div>
              </div>
            )}

            {/* Environment Info */}
            {healthStatus.environment && (
              <div className="space-y-1 pt-2 pb-2 border-b border-white/10">
                <div className="font-semibold text-xs mb-1 opacity-90">Environment</div>
                <div className="flex justify-between">
                  <span className="opacity-75">Node.js:</span>
                  <span>{healthStatus.environment.nodeVersion || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-75">Platform:</span>
                  <span>{healthStatus.environment.platform || 'N/A'}</span>
                </div>
              </div>
            )}

            {/* Error Display */}
            {healthStatus.error && (
              <div className="mt-2 pt-2 border-t border-white/10">
                <div className="opacity-75 mb-1 font-semibold">Error:</div>
                <div className="text-red-300 text-xs">{healthStatus.error}</div>
              </div>
            )}

            {/* Actions */}
            <div className="pt-2 space-y-2">
              {healthStatus.status === 'offline' && (
                <button
                  onClick={handleWakeServer}
                  className="w-full px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 rounded text-xs font-medium transition-colors"
                >
                  Wake Server
                </button>
              )}

              {healthStatus.status === 'waking' && (
                <div className="text-center text-xs opacity-75">
                  Waiting for server to wake up...
                </div>
              )}

              {healthStatus.status === 'online' && (
                <div className="text-center text-xs opacity-75">
                  All systems operational
                </div>
              )}
            </div>
          </div>
      </div>
    </div>
  )
}

