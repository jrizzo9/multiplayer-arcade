// Pong-specific networking layer
// Handles Pong game events separate from room/presence logic

import { getSocket } from '../../utils/socket'

/**
 * Emit paddle movement
 * @param {string} roomId - Room ID
 * @param {number} playerNumber - Player number (1 or 2)
 * @param {number} paddleX - Paddle X position (horizontal for vertical gameplay)
 */
export function emitPaddleMove(roomId, playerNumber, paddleX) {
  const socket = getSocket()
  if (socket.connected) {
    socket.emit('pong-paddle-move', { roomId, playerNumber, paddleX })
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
    socket.emit('pong-game-state', { roomId, gameState })
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
    socket.emit('pong-game-start', { roomId, gameState })
  }
}

/**
 * Subscribe to Pong game events
 * @param {Object} handlers - Event handlers
 * @param {Function} handlers.onGameStart - Handler for pong-game-start
 * @param {Function} handlers.onGameState - Handler for pong-game-state
 * @param {Function} handlers.onPaddleMove - Handler for pong-paddle-move
 * @returns {Function} Cleanup function to remove listeners
 */
export function subscribeToPongEvents(handlers) {
  const socket = getSocket()
  
  const onGameStart = (data) => {
    if (handlers.onGameStart) {
      handlers.onGameStart(data)
    }
  }
  
  const onGameState = (gameState) => {
    // Server emits pong-game-state with just gameState (not wrapped)
    if (handlers.onGameState) {
      handlers.onGameState(gameState)
    }
  }
  
  const onPaddleMove = (data) => {
    if (handlers.onPaddleMove) {
      handlers.onPaddleMove(data)
    }
  }
  
  socket.on('pong-game-start', onGameStart)
  socket.on('pong-game-state', onGameState)
  socket.on('pong-paddle-move', onPaddleMove)
  
  // Return cleanup function
  return () => {
    socket.off('pong-game-start', onGameStart)
    socket.off('pong-game-state', onGameState)
    socket.off('pong-paddle-move', onPaddleMove)
  }
}

