// Snake-specific networking layer
// Handles Snake game events separate from room/presence logic

import { getSocket } from '../../utils/socket'

/**
 * Emit direction change
 * @param {string} roomId - Room ID
 * @param {number} playerNumber - Player number (1 or 2)
 * @param {Object} direction - Direction object { x, y }
 */
export function emitDirectionChange(roomId, playerNumber, direction) {
  const socket = getSocket()
  if (socket.connected) {
    socket.emit('snake-direction-change', { roomId, playerNumber, direction })
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
    socket.emit('snake-game-state', { roomId, gameState })
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
    socket.emit('snake-game-start', { roomId, gameState })
  }
}

/**
 * Subscribe to Snake game events
 * @param {Object} handlers - Event handlers
 * @param {Function} handlers.onGameStart - Handler for snake-game-start
 * @param {Function} handlers.onGameState - Handler for snake-game-state
 * @param {Function} handlers.onDirectionChange - Handler for snake-direction-change
 * @returns {Function} Cleanup function to remove listeners
 */
export function subscribeToSnakeEvents(handlers) {
  const socket = getSocket()
  
  const onGameStart = (data) => {
    if (handlers.onGameStart) {
      handlers.onGameStart(data)
    }
  }
  
  const onGameState = (gameState) => {
    // Server emits snake-game-state with just gameState (not wrapped)
    if (handlers.onGameState) {
      handlers.onGameState(gameState)
    }
  }
  
  const onDirectionChange = (data) => {
    if (handlers.onDirectionChange) {
      handlers.onDirectionChange(data)
    }
  }
  
  socket.on('snake-game-start', onGameStart)
  socket.on('snake-game-state', onGameState)
  socket.on('snake-direction-change', onDirectionChange)
  
  // Return cleanup function
  return () => {
    socket.off('snake-game-start', onGameStart)
    socket.off('snake-game-state', onGameState)
    socket.off('snake-direction-change', onDirectionChange)
  }
}

