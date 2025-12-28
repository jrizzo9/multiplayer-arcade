/**
 * Server Health Check Utility
 * Monitors Render service status (which shuts down after 15 min inactivity)
 */

import { getApiUrl } from './apiUrl'

const HEALTH_CHECK_INTERVAL = 5000 // Check every 5 seconds
const WAKE_UP_TIMEOUT = 90000 // 90 seconds max wait for server to wake up
const HEALTH_CHECK_TIMEOUT = 3000 // 3 second timeout for health check

let healthCheckInterval = null
let healthCheckCallbacks = []
let lastHealthStatus = {
  status: 'unknown',
  timestamp: null,
  responseTime: null,
  error: null
}

/**
 * Check server health by pinging /health endpoint
 */
export async function checkServerHealth() {
  const apiUrl = getApiUrl()
  if (!apiUrl) {
    return {
      status: 'unavailable',
      error: 'API URL not configured',
      timestamp: Date.now()
    }
  }

  const startTime = Date.now()
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT)

    const response = await fetch(`${apiUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Cache-Control': 'no-cache'
      }
    })

    clearTimeout(timeoutId)
    const responseTime = Date.now() - startTime

    if (response.ok) {
      const data = await response.json()
      
      // Debug: Log the response to see what we're getting
      console.log('[ServerHealth] Health check response:', data)
      
      const status = {
        status: 'online',
        timestamp: Date.now(),
        responseTime,
        latency: responseTime, // Alias for clarity
        uptime: data.uptime,
        serverTime: data.timestamp,
        database: data.database || null,
        sockets: data.sockets || null,
        render: data.render || null,
        environment: data.environment || null
      }
      
      // Debug: Log what we're storing
      console.log('[ServerHealth] Parsed status:', {
        hasDatabase: !!status.database,
        hasSockets: !!status.sockets,
        hasRender: !!status.render,
        hasEnvironment: !!status.environment,
        database: status.database,
        sockets: status.sockets,
        render: status.render,
        environment: status.environment
      })
      
      lastHealthStatus = status
      return status
    } else {
      const status = {
        status: 'error',
        timestamp: Date.now(),
        responseTime,
        error: `HTTP ${response.status}`,
        httpStatus: response.status
      }
      lastHealthStatus = status
      return status
    }
  } catch (error) {
    const responseTime = Date.now() - startTime
    let status = 'offline'
    let errorMessage = error.message

    // Check if it's a timeout (server might be waking up)
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      status = 'waking'
      errorMessage = 'Server is waking up (this may take up to 60 seconds)'
    } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      status = 'offline'
      errorMessage = 'Cannot reach server - it may be sleeping'
    }

    const healthStatus = {
      status,
      timestamp: Date.now(),
      responseTime,
      error: errorMessage
    }
    lastHealthStatus = healthStatus
    return healthStatus
  }
}

/**
 * Start monitoring server health
 * @param {Function} callback - Called whenever health status changes
 */
export function startHealthMonitoring(callback) {
  if (typeof callback === 'function') {
    healthCheckCallbacks.push(callback)
  }

  // If already monitoring, don't start another interval
  if (healthCheckInterval) {
    return
  }

  // Initial check
  checkServerHealth().then(status => {
    healthCheckCallbacks.forEach(cb => cb(status))
  })

  // Start periodic checks
  healthCheckInterval = setInterval(async () => {
    const status = await checkServerHealth()
    healthCheckCallbacks.forEach(cb => cb(status))
  }, HEALTH_CHECK_INTERVAL)
}

/**
 * Stop monitoring server health
 */
export function stopHealthMonitoring() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval)
    healthCheckInterval = null
  }
  healthCheckCallbacks = []
}

/**
 * Get last known health status
 */
export function getLastHealthStatus() {
  return { ...lastHealthStatus }
}

/**
 * Wait for server to wake up (useful before making API calls)
 * @param {number} maxWaitTime - Maximum time to wait in milliseconds
 * @returns {Promise<boolean>} - true if server came online, false if timeout
 */
export async function waitForServer(maxWaitTime = WAKE_UP_TIMEOUT) {
  const startTime = Date.now()
  const checkInterval = 2000 // Check every 2 seconds

  while (Date.now() - startTime < maxWaitTime) {
    const status = await checkServerHealth()
    
    if (status.status === 'online') {
      return true
    }

    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, checkInterval))
  }

  return false
}

