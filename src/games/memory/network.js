// Memory game-specific networking layer
// Handles Memory game events separate from room/presence logic

import { getSocket } from '../../utils/socket'

/**
 * Emit card flip action
 * @param {string} roomId - Room ID
 * @param {string} userProfileId - User profile ID
 * @param {number} cardIndex - Index of the card being flipped
 */
export function emitCardFlip(roomId, userProfileId, cardIndex) {
  const socket = getSocket()
  if (socket.connected) {
    socket.emit('memory-card-flip', { roomId, userProfileId, cardIndex })
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
    socket.emit('memory-game-state', { roomId, gameState })
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
    socket.emit('memory-game-start', { roomId, gameState })
  }
}

/**
 * Subscribe to Memory game events
 * @param {Object} handlers - Event handlers
 * @param {Function} handlers.onGameStart - Handler for memory-game-start
 * @param {Function} handlers.onGameState - Handler for memory-game-state
 * @param {Function} handlers.onCardFlip - Handler for memory-card-flip
 * @returns {Function} Cleanup function to remove listeners
 */
export function subscribeToMemoryEvents(handlers) {
  const socket = getSocket()
  
  const onGameStart = (data) => {
    if (handlers.onGameStart) {
      handlers.onGameStart(data)
    }
  }
  
  const onGameState = (gameState) => {
    // Server emits memory-game-state with just gameState (not wrapped)
    if (handlers.onGameState) {
      handlers.onGameState(gameState)
    }
  }
  
  const onCardFlip = (data) => {
    if (handlers.onCardFlip) {
      handlers.onCardFlip(data)
    }
  }
  
  socket.on('memory-game-start', onGameStart)
  socket.on('memory-game-state', onGameState)
  socket.on('memory-card-flip', onCardFlip)
  
  // Return cleanup function
  return () => {
    socket.off('memory-game-start', onGameStart)
    socket.off('memory-game-state', onGameState)
    socket.off('memory-card-flip', onCardFlip)
  }
}

