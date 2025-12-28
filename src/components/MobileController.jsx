import { useState, useEffect, useRef } from 'react'
import { getSocket } from '../utils/socket'
import { useRoom } from '../multiplayer/RoomProvider'
import { emitPaddleMove, subscribeToPongEvents } from '../games/pong/network'

function MobileController({ roomId, playerName, profile }) {
  // Get room state from multiplayer foundation (room-snapshot is source of truth)
  const roomState = useRoom(roomId)
  
  const [socketConnected, setSocketConnected] = useState(false)
  const [error, setError] = useState(null)
  const [paddleY, setPaddleY] = useState(300) // Center position
  const [playerNumber, setPlayerNumber] = useState(null)
  
  const socketRef = useRef(null)
  const socketInitializedRef = useRef(false)
  const paddleYRef = useRef(300)
  const PADDLE_SPEED = 5
  const GAME_HEIGHT = 600
  const PADDLE_HEIGHT = 80
  
  // Derive values from room state
  const players = roomState.players || []
  
  // Determine player number based on position in players array (using userProfileId)
  useEffect(() => {
    if (profile?.id && players.length > 0) {
      const myIndex = players.findIndex(p => p.userProfileId && String(p.userProfileId) === String(profile.id))
      // First player (index 0) is player 1 (left), second player (index 1) is player 2 (right)
      setPlayerNumber(myIndex >= 0 ? myIndex + 1 : null)
    }
  }, [profile?.id, players])

  // Initialize socket connection
  useEffect(() => {
    if (socketInitializedRef.current && socketRef.current?.connected) {
      return
    }

    if (!roomId) {
      setError('No room ID provided')
      return
    }

    const socket = getSocket()
    socketRef.current = socket
    socketInitializedRef.current = true

    socket.on('connect', () => {
      console.log('[MobileController] Socket connected:', socket.id)
      setSocketConnected(true)
      // Room joining is handled by RoomManager, not here
    })

    socket.on('disconnect', (reason) => {
      console.log('[MobileController] Socket disconnected:', reason)
      setSocketConnected(false)
    })

    socket.on('connect_error', (error) => {
      console.error('[MobileController] Socket connection error:', error)
      setError(error.message)
    })

    // Player number is determined from room state (room-snapshot)
    // No need to listen to player-joined for roster updates

    // Subscribe to Pong game events
    const cleanup = subscribeToPongEvents({
      onGameStart: ({ gameState: startGameState }) => {
        console.log('[MobileController] Game started')
        if (startGameState && playerNumber) {
          const initialY = playerNumber === 1 ? startGameState.leftPaddleY : startGameState.rightPaddleY
          if (initialY !== undefined) {
            setPaddleY(initialY)
            paddleYRef.current = initialY
          }
        }
      },
      onGameState: (gameState) => {
        // Update paddle position from host's game state
        if (gameState && playerNumber) {
          const currentY = playerNumber === 1 ? gameState.leftPaddleY : gameState.rightPaddleY
          if (currentY !== undefined) {
            setPaddleY(currentY)
            paddleYRef.current = currentY
          }
        }
      }
    })

    socket.on('room-error', ({ message }) => {
      console.error('[MobileController] Room error:', message)
      setError(message)
    })

    return () => {
      cleanup()
      // Don't disconnect shared socket or leave room - RoomManager handles that
    }
  }, [roomId, profile, playerNumber])

  const movePaddle = (direction) => {
    if (!roomId || !playerNumber) return
    
    const currentY = paddleYRef.current
    let newY = currentY + (direction * PADDLE_SPEED)
    newY = Math.max(0, Math.min(GAME_HEIGHT - PADDLE_HEIGHT, newY))
    
    setPaddleY(newY)
    paddleYRef.current = newY
    
    // Send paddle movement to server (use pong/network.js)
    emitPaddleMove(roomId, playerNumber, newY)
  }

  const handleTouchStart = (direction) => {
    movePaddle(direction)
  }

  const handleTouchMove = (e) => {
    if (!roomId || !playerNumber) return
    
    e.preventDefault()
    const touch = e.touches[0]
    const rect = e.currentTarget.getBoundingClientRect()
    const touchY = touch.clientY - rect.top
    const normalizedY = (touchY / rect.height) * GAME_HEIGHT
    const newY = Math.max(0, Math.min(GAME_HEIGHT - PADDLE_HEIGHT, normalizedY - PADDLE_HEIGHT / 2))
    
    setPaddleY(newY)
    paddleYRef.current = newY
    
    emitPaddleMove(roomId, playerNumber, newY)
  }

  if (!roomId) {
    return (
      <div className="w-full h-screen bg-black flex items-center justify-center text-white p-4 pt-20 sm:pt-24">
        <div className="text-center">
          <p className="text-xl mb-4">No room ID provided</p>
          <p className="text-sm text-gray-400">Join a room to use the mobile controller</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full h-screen bg-black flex items-center justify-center text-white p-4 pt-20 sm:pt-24">
        <div className="text-center">
          <p className="text-xl mb-4 text-red-500">Error</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full min-h-screen bg-black flex flex-col items-center justify-center text-white p-4">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold mb-2">Mobile Controller</h1>
        <p className="text-sm text-gray-400">Room: {roomId}</p>
        {playerNumber && (
          <p className="text-sm text-gray-400 mt-1">
            Player {playerNumber} {playerNumber === 1 ? '(Left)' : '(Right)'}
          </p>
        )}
        {socketConnected ? (
          <p className="text-xs text-green-400 mt-2">Connected</p>
        ) : (
          <p className="text-xs text-yellow-400 mt-2">Connecting...</p>
        )}
      </div>

      {/* Touch area for direct paddle control */}
      <div
        className="w-full max-w-md h-96 border-2 border-white rounded-lg mb-4 relative touch-none"
        onTouchMove={handleTouchMove}
        style={{ touchAction: 'none' }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-gray-500 text-sm">Touch and drag to move paddle</p>
        </div>
        {/* Visual indicator of paddle position */}
        <div
          className="absolute left-4 w-2 bg-white rounded transition-all duration-75"
          style={{
            height: `${PADDLE_HEIGHT}px`,
            top: `${(paddleYRef.current / GAME_HEIGHT) * 100}%`,
            transform: 'translateY(-50%)'
          }}
        />
      </div>

      {/* Button controls */}
      <div className="w-full max-w-md flex flex-col gap-4">
        <button
          onTouchStart={(e) => {
            e.preventDefault()
            handleTouchStart(-1)
          }}
          onMouseDown={() => handleTouchStart(-1)}
          className="w-full py-6 text-3xl font-bold text-white border-2 border-white rounded-lg active:bg-white active:text-black transition-all duration-200 cursor-pointer touch-manipulation"
          style={{ minHeight: '80px' }}
        >
          ↑ Up
        </button>
        <button
          onTouchStart={(e) => {
            e.preventDefault()
            handleTouchStart(1)
          }}
          onMouseDown={() => handleTouchStart(1)}
          className="w-full py-6 text-3xl font-bold text-white border-2 border-white rounded-lg active:bg-white active:text-black transition-all duration-200 cursor-pointer touch-manipulation"
          style={{ minHeight: '80px' }}
        >
          ↓ Down
        </button>
      </div>

      {/* Instructions */}
      <div className="mt-6 text-center text-sm text-gray-400 max-w-md">
        <p>Use the buttons or touch and drag in the area above to control your paddle</p>
      </div>
    </div>
  )
}

export default MobileController

