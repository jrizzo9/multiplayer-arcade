// Magnet Mayhem-specific networking layer
// Handles Magnet Mayhem game events separate from room/presence logic

import { getSocket } from '../../utils/socket'

/**
 * Emit player movement
 * @param {string} roomId - Room ID
 * @param {string} userProfileId - User profile ID
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} vx - X velocity
 * @param {number} vy - Y velocity
 */
export function emitPlayerMove(roomId, userProfileId, x, y, vx, vy) {
  const socket = getSocket()
  if (socket.connected) {
    socket.emit('magnet-player-move', { roomId, userProfileId, x, y, vx, vy })
  }
}

/**
 * Emit pole flip
 * @param {string} roomId - Room ID
 * @param {string} userProfileId - User profile ID
 * @param {string} pole - 'north' or 'south'
 */
export function emitPoleFlip(roomId, userProfileId, pole) {
  const socket = getSocket()
  if (socket.connected) {
    socket.emit('magnet-pole-flip', { roomId, userProfileId, pole })
  }
}

/**
 * Emit game state update (host only)
 * @param {string} roomId - Room ID
 * @param {Object} gameState - Game state object
 */
export function emitGameState(roomId, gameState) {
  const socket = getSocket()
  if (socket.connected) {
    socket.emit('magnet-game-state', { roomId, gameState })
  }
}

/**
 * Emit game start (host only)
 * @param {string} roomId - Room ID
 * @param {Object} gameState - Initial game state
 */
export function emitGameStart(roomId, gameState) {
  const socket = getSocket()
  if (socket.connected) {
    socket.emit('magnet-game-start', { roomId, gameState })
  }
}

/**
 * Subscribe to Magnet Mayhem game events
 * @param {Object} handlers - Event handlers
 * @param {Function} handlers.onGameStart - Handler for magnet-game-start
 * @param {Function} handlers.onGameState - Handler for magnet-game-state
 * @param {Function} handlers.onPlayerMove - Handler for magnet-player-move
 * @param {Function} handlers.onPoleFlip - Handler for magnet-pole-flip
 * @returns {Function} Cleanup function to remove listeners
 */
export function subscribeToMagnetEvents(handlers) {
  const socket = getSocket()
  
  const onGameStart = (data) => {
    if (handlers.onGameStart) {
      handlers.onGameStart(data)
    }
  }
  
  const onGameState = (data) => {
    // Server emits magnet-game-state with { roomId, gameState }
    if (handlers.onGameState && data.gameState) {
      handlers.onGameState(data.gameState)
    }
  }
  
  const onPlayerMove = (data) => {
    if (handlers.onPlayerMove) {
      handlers.onPlayerMove(data)
    }
  }
  
  const onPoleFlip = (data) => {
    if (handlers.onPoleFlip) {
      handlers.onPoleFlip(data)
    }
  }
  
  socket.on('magnet-game-start', onGameStart)
  socket.on('magnet-game-state', onGameState)
  socket.on('magnet-player-move', onPlayerMove)
  socket.on('magnet-pole-flip', onPoleFlip)
  
  // Return cleanup function
  return () => {
    socket.off('magnet-game-start', onGameStart)
    socket.off('magnet-game-state', onGameState)
    socket.off('magnet-player-move', onPlayerMove)
    socket.off('magnet-pole-flip', onPoleFlip)
  }
}

