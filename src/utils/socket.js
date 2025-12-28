// Shared Socket.IO client instance
// All components should import and use this single instance

import { io } from 'socket.io-client'
import { checkServerHealth } from './serverHealth'

let socketInstance = null

/**
 * Get or create socket instance (synchronous)
 * Socket.IO will handle reconnection automatically
 */
export function getSocket() {
  if (!socketInstance) {
    // Use environment variable for production, fallback to localhost for development
    // Always use the same protocol as the current page to avoid mixed content errors
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
    const serverUrl = import.meta.env.VITE_SERVER_URL || `${protocol}//${window.location.hostname}:8000`
    
    // For Render free tier, use longer timeouts and try polling first (more reliable during wake-up)
    const isProduction = serverUrl.includes('onrender.com') || serverUrl.includes('vercel.app')
    
    socketInstance = io(serverUrl, {
      // Try polling first, then upgrade to websocket (more reliable during server wake-up)
      transports: isProduction ? ['polling', 'websocket'] : ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000, // Increased max delay for Render wake-up
      reconnectionAttempts: 20, // Increased attempts for Render free tier (can take ~60s to wake)
      forceNew: false,
      timeout: isProduction ? 60000 : 20000, // 60s timeout for production (Render wake-up), 20s for dev
      // Additional options for better reliability
      upgrade: true, // Allow transport upgrade
      rememberUpgrade: false, // Don't remember upgrade (start fresh each time)
      // Increase ping timeout for slow connections
      pingTimeout: isProduction ? 60000 : 20000,
      pingInterval: 25000
    })

    // Log connection events for debugging
    socketInstance.on('connect', () => {
      console.log('[Socket] Connected:', socketInstance.id)
      // Check server health when connected to verify it's fully up
      checkServerHealth().then(status => {
        if (status.status === 'online') {
          console.log('[Socket] Server health confirmed:', status)
        }
      })
    })

    socketInstance.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason)
      // If server went to sleep, log it for debugging
      if (reason === 'transport close' || reason === 'transport error') {
        console.log('[Socket] Server may have gone to sleep (Render free tier)')
      }
    })

    socketInstance.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error.message)
      console.error('[Socket] Error details:', {
        type: error.type,
        description: error.description,
        context: error.context
      })
      // Check server health to see if it's waking up
      checkServerHealth().then(status => {
        console.log('[Socket] Server health check after error:', status)
        if (status.status === 'waking' || status.status === 'offline') {
          console.log('[Socket] Server appears to be waking up, will retry...')
        } else if (status.status === 'online') {
          console.warn('[Socket] Server health check shows online, but socket connection failed. This may indicate a WebSocket/CORS issue.')
        }
      }).catch(err => {
        console.error('[Socket] Error checking server health:', err)
      })
    })

    socketInstance.on('reconnect_attempt', (attemptNumber) => {
      console.log(`[Socket] Reconnection attempt ${attemptNumber}`)
    })

    socketInstance.on('reconnect', (attemptNumber) => {
      console.log(`[Socket] Reconnected after ${attemptNumber} attempts`)
    })

    socketInstance.on('reconnect_failed', () => {
      console.error('[Socket] Reconnection failed after all attempts')
    })
  }

  return socketInstance
}

/**
 * Wait for server to be online before getting socket (optional)
 * Useful when you know server might be sleeping
 */
export async function getSocketWhenReady() {
  const { waitForServer } = await import('./serverHealth')
  const isReady = await waitForServer(60000) // Wait up to 60 seconds
  if (!isReady) {
    console.warn('[Socket] Server did not wake up in time, connecting anyway...')
  }
  return getSocket()
}

export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.disconnect()
    socketInstance = null
  }
}

export default getSocket

