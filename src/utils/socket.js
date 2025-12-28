// Shared Socket.IO client instance
// All components should import and use this single instance

import { io } from 'socket.io-client'

let socketInstance = null

export function getSocket() {
  if (!socketInstance) {
    // Use environment variable for production, fallback to localhost for development
    const serverUrl = import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:8000`
    socketInstance = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      forceNew: false,
      timeout: 20000
    })

    // Log connection events for debugging
    socketInstance.on('connect', () => {
      console.log('[Socket] Connected:', socketInstance.id)
    })

    socketInstance.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason)
    })

    socketInstance.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error)
    })
  }

  return socketInstance
}

export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.disconnect()
    socketInstance = null
  }
}

export default getSocket

