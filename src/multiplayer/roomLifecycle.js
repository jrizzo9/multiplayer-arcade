// Room lifecycle helpers - thin wrappers over socket events
// These functions handle room creation, joining, leaving, and game selection

import { getSocket } from '../utils/socket'

/**
 * Create a new room
 * @param {Object} payload - { playerName, userProfileId, colorId }
 * @returns {Promise} Resolves when room-created event is received
 */
export function createRoom(payload) {
  const socket = getSocket()
  
  console.log('[DIAG] [CREATE-ROOM] Step 1: createRoom called', {
    socketId: socket.id,
    socketConnected: socket.connected,
    payload: payload,
    timestamp: Date.now()
  })
  
  if (!socket.connected) {
    return Promise.reject(new Error('Socket not connected. Please wait for connection.'))
  }
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('room-created', onRoomCreated)
      socket.off('room-error', onError)
      reject(new Error('Room creation timeout'))
    }, 10000)

    const onRoomCreated = ({ roomId, players, hostUserProfileId }) => {
      socket.off('room-created', onRoomCreated)
      socket.off('room-error', onError)
      clearTimeout(timeout)
      console.log('[DIAG] [CREATE-ROOM] Step 3: Received room-created event', {
        socketId: socket.id,
        roomId: roomId,
        roomIdType: typeof roomId,
        playersCount: players?.length || 0,
        hostUserProfileId: hostUserProfileId,
        timestamp: Date.now()
      })
      console.log('[roomLifecycle] Room created:', roomId)
      resolve({ roomId, players, hostUserProfileId })
    }

    const onError = ({ message }) => {
      socket.off('room-created', onRoomCreated)
      socket.off('room-error', onError)
      clearTimeout(timeout)
      console.error('[roomLifecycle] Room creation error:', message)
      reject(new Error(message || 'Failed to create room'))
    }

    socket.once('room-created', onRoomCreated)
    socket.once('room-error', onError)
    
    console.log('[DIAG] [CREATE-ROOM] Step 2: About to emit create-room', {
      socketId: socket.id,
      payload: payload,
      timestamp: Date.now()
    })
    console.log('[roomLifecycle] Emitting create-room with payload:', payload)
    socket.emit('create-room', payload)
  })
}

/**
 * Join an existing room
 * @param {string} roomId - Room ID to join
 * @param {Object} payload - { playerName, userProfileId, colorId }
 * @returns {Promise} Resolves when player-joined event is received
 */
export function joinRoom(roomId, payload) {
  const socket = getSocket()
  
  console.log('[DIAG] [JOIN-ROOM] Step 1: joinRoom called', {
    socketId: socket.id,
    socketConnected: socket.connected,
    roomId: roomId,
    roomIdType: typeof roomId,
    payload: payload,
    timestamp: Date.now()
  })
  
  if (!socket.connected) {
    return Promise.reject(new Error('Socket not connected. Please wait for connection.'))
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('player-joined', onPlayerJoined)
      socket.off('room-error', onError)
      reject(new Error('Join room timeout - server did not respond'))
    }, 15000) // Increased timeout to 15 seconds

    const onPlayerJoined = ({ players, gameState, isHost, hostUserProfileId, selectedGame }) => {
      console.log('[DIAG] [JOIN-ROOM] Step 3: Received player-joined event', {
        socketId: socket.id,
        playersCount: players?.length || 0,
        isHost: isHost,
        hostUserProfileId: hostUserProfileId,
        timestamp: Date.now()
      })
      console.log('[roomLifecycle] Received player-joined event:', { playersCount: players?.length, isHost, hostUserProfileId })
      socket.off('player-joined', onPlayerJoined)
      socket.off('room-error', onError)
      clearTimeout(timeout)
      resolve({ players, gameState, isHost, hostUserProfileId, selectedGame })
    }

    const onError = ({ message }) => {
      console.error('[roomLifecycle] Received room-error event:', message)
      socket.off('player-joined', onPlayerJoined)
      socket.off('room-error', onError)
      clearTimeout(timeout)
      reject(new Error(message || 'Failed to join room'))
    }

    socket.once('player-joined', onPlayerJoined)
    socket.once('room-error', onError)
    
    console.log('[DIAG] [JOIN-ROOM] Step 2: About to emit join-room', {
      socketId: socket.id,
      roomId: roomId,
      roomIdType: typeof roomId,
      timestamp: Date.now()
    })
    console.log('[roomLifecycle] Emitting join-room with payload:', { roomId, ...payload })
    socket.emit('join-room', { roomId, ...payload })
  })
}

/**
 * Leave a room
 * @param {string} roomId - Room ID to leave
 * @param {Object} payload - { userProfileId }
 */
export function leaveRoom(roomId, payload) {
  const socket = getSocket()
  socket.emit('leave-room', { roomId, ...payload })
}

/**
 * Set player ready status
 * @param {string} roomId - Room ID
 * @param {boolean} ready - Ready status
 */
export function setReady(roomId, ready) {
  const socket = getSocket()
  socket.emit('player-ready', { roomId, ready })
}

/**
 * Select a game (host only)
 * @param {string} roomId - Room ID
 * @param {string} game - Game identifier
 */
export function selectGame(roomId, game) {
  const socket = getSocket()
  socket.emit('game-selected', { roomId, game })
}

