import { useState, useEffect, useRef, useCallback } from 'react'
import { getSocket } from '../utils/socket'
import { getCurrentProfile } from '../utils/profiles'
import { isCPUProfile, cpuShouldSucceed, getCPUDelay } from '../utils/cpuPlayer'
import { useRoom } from '../multiplayer/RoomProvider'
import soundManager from '../utils/sounds'
import Notification from './Notification'

const GAME_WIDTH = 400
const GAME_HEIGHT = 600
const GRAVITY = 0.25
const JUMP_STRENGTH = -6
const PIPE_WIDTH = 40
const PIPE_GAP = 200
const PIPE_SPEED = 2
const PIPE_SPACING = 200
const KIWI_SIZE = 30
const KIWI_X = 50

// Different X positions for multiple players
const PLAYER_POSITIONS = [50, 100, 150, 200]

function MultiplayerGame({ roomId, isHost: propIsHost, onLeave, onRoomCreated, playerName }) {
  // Get room state from multiplayer foundation (room-snapshot is source of truth)
  const roomState = useRoom(roomId)
  const [currentProfile, setCurrentProfile] = useState(null)
  
  // Derive values from room state
  const players = roomState.players || []
  const hostUserProfileId = roomState.hostUserProfileId
  const isHost = currentProfile?.id ? roomState.isHost(currentProfile.id) : propIsHost || false
  
  const [gameState, setGameState] = useState('start')
  const [kiwiY, setKiwiY] = useState(GAME_HEIGHT / 2)
  const [kiwiVelocity, setKiwiVelocity] = useState(0)
  const [pipes, setPipes] = useState([])
  const [score, setScore] = useState(0)
  const [otherPlayers, setOtherPlayers] = useState(new Map()) // Map<userProfileId, {kiwiY, kiwiVelocity}>
  const [error, setError] = useState(null)
  const [notification, setNotification] = useState(null)
  
  const socketRef = useRef(null)
  const gameLoopRef = useRef(null)
  const lastPipeXRef = useRef(GAME_WIDTH)
  const passedPipesRef = useRef(new Set())
  const gameStateRef = useRef('start')
  const kiwiYRef = useRef(GAME_HEIGHT / 2)
  const kiwiVelocityRef = useRef(0)
  const pipesRef = useRef([])
  const playerIndexRef = useRef(0)
  const socketInitializedRef = useRef(false) // Track if socket has been initialized
  
  const [isCPU, setIsCPU] = useState(false)

  // Load current profile to get userProfileId
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const profile = await getCurrentProfile()
        setCurrentProfile(profile)
        setIsCPU(isCPUProfile(profile))
      } catch (err) {
        console.error('[MultiplayerGame] Error loading profile:', err)
      }
    }
    loadProfile()
  }, [])
  
  // Calculate player index based on userProfileId
  useEffect(() => {
    if (currentProfile?.id && players.length > 0) {
      const myIndex = players.findIndex(p => p.userProfileId && String(p.userProfileId) === String(currentProfile.id))
      playerIndexRef.current = myIndex >= 0 ? myIndex : 0
    }
  }, [currentProfile?.id, players])

  // Initialize socket connection (only once)
  useEffect(() => {
    // Only initialize if not already done
    if (socketInitializedRef.current && socketRef.current?.connected) {
      return // Socket already initialized and connected
    }

    const socket = getSocket()
    socketRef.current = socket
    socketInitializedRef.current = true

    // Handle connection errors
    socket.on('connect_error', (error) => {
      console.error('[MultiplayerGame] Socket connection error:', error)
      if (error.message.includes('400') || error.message.includes('Bad Request')) {
        console.warn('[MultiplayerGame] Received 400 error, forcing new connection...')
        socket.disconnect()
        setTimeout(() => {
          if (socketRef.current && !socketRef.current.connected) {
            socketRef.current.connect()
          }
        }, 1000)
      }
    })

    socket.on('disconnect', (reason) => {
      console.log('[MultiplayerGame] Socket disconnected:', reason)
      if (reason === 'io server disconnect') {
        socket.connect()
      }
    })

    socket.on('connect', () => {
      // Room state is managed by RoomProvider via room-snapshot
      // No need to track room creation/join here
    })

    // Legacy events for backward compatibility (optional side effects only)
    socket.on('room-created', ({ roomId: createdRoomId }) => {
      if (onRoomCreated) {
        onRoomCreated(createdRoomId)
      }
      // Update URL with room ID
      window.history.pushState({}, '', `?room=${createdRoomId}`)
    })

    socket.on('player-joined', ({ gameState: roomGameState }) => {
      // Sync with existing game state if game is in progress
      // Roster is now managed by room-snapshot, not this event
      if (roomGameState && roomGameState.state === 'playing') {
        setPipes(roomGameState.pipes || [])
        pipesRef.current = roomGameState.pipes || []
        lastPipeXRef.current = roomGameState.lastPipeX || GAME_WIDTH
      }
    })

    // Handle other players' actions
    socket.on('player-action', ({ playerId, action }) => {
      // Other players' jumps (visual feedback could be added here)
    })

    // Handle game state updates from host
    socket.on('game-state-update', (gameState) => {
      if (!isHost) {
        setPipes(gameState.pipes || [])
        pipesRef.current = gameState.pipes || []
        lastPipeXRef.current = gameState.lastPipeX || GAME_WIDTH
        
        if (gameState.state !== gameStateRef.current) {
          setGameState(gameState.state)
          gameStateRef.current = gameState.state
        }
      }
    })

    // Handle other players' positions (use userProfileId)
    socket.on('player-position', ({ userProfileId, kiwiY, kiwiVelocity }) => {
      if (!userProfileId) return // Ignore if no userProfileId
      setOtherPlayers(prev => {
        const newMap = new Map(prev)
        newMap.set(userProfileId, { kiwiY, kiwiVelocity })
        return newMap
      })
    })

    // Handle score updates (use userProfileId)
    socket.on('score-update', ({ userProfileId, score: playerScore }) => {
      // Score updates are handled via room-snapshot, but we can update local state for immediate feedback
      // The room-snapshot will eventually sync the authoritative score
    })

    // Handle room errors
    socket.on('room-error', ({ message }) => {
      console.error('Room error:', message)
      setError(message)
      // Auto-dismiss error after 5 seconds
      setTimeout(() => {
        setError(null)
        if (onLeave) {
          onLeave()
        }
      }, 5000)
    })

    return () => {
      // Cleanup on unmount - don't disconnect shared socket
      socketInitializedRef.current = false
      roomCreatedRef.current = false
    }
  }, []) // Empty deps - only run once on mount

  // Room joining is handled by RoomManager, not here
  // This component just uses the room state from useRoom()

  const jump = useCallback(() => {
    if (gameStateRef.current === 'start') {
      gameStateRef.current = 'playing'
      setGameState('playing')
      kiwiYRef.current = GAME_HEIGHT / 2
      setKiwiY(GAME_HEIGHT / 2)
      kiwiVelocityRef.current = JUMP_STRENGTH
      setKiwiVelocity(JUMP_STRENGTH)
      pipesRef.current = []
      setPipes([])
      setScore(0)
      passedPipesRef.current = new Set()
      lastPipeXRef.current = GAME_WIDTH
      soundManager.playJump()
      
      // Notify other players if host
      if (isHost && socketRef.current) {
        socketRef.current.emit('game-state-update', {
          roomId,
          gameState: {
            state: 'playing',
            pipes: [],
            lastPipeX: GAME_WIDTH
          }
        })
      }
    } else if (gameStateRef.current === 'playing') {
      kiwiVelocityRef.current = JUMP_STRENGTH
      setKiwiVelocity(JUMP_STRENGTH)
      soundManager.playJump()
      
      // Send action to other players (include userProfileId)
      if (socketRef.current && currentProfile?.id) {
        socketRef.current.emit('player-action', { roomId, userProfileId: currentProfile.id, action: 'jump' })
      }
    } else if (gameStateRef.current === 'gameover') {
      gameStateRef.current = 'start'
      setGameState('start')
    }
  }, [roomId, isHost])

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        jump()
      }
    }

    const handleClick = () => {
      jump()
    }

    window.addEventListener('keydown', handleKeyPress)
    window.addEventListener('click', handleClick)

    return () => {
      window.removeEventListener('keydown', handleKeyPress)
      window.removeEventListener('click', handleClick)
    }
  }, [jump])

  // Sync refs with state
  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])

  useEffect(() => {
    kiwiYRef.current = kiwiY
  }, [kiwiY])

  useEffect(() => {
    kiwiVelocityRef.current = kiwiVelocity
  }, [kiwiVelocity])

  useEffect(() => {
    pipesRef.current = pipes
  }, [pipes])

  // Send position updates to other players (use userProfileId)
  useEffect(() => {
    if (gameState === 'playing' && socketRef.current && currentProfile?.id) {
      socketRef.current.emit('player-position', {
        roomId,
        userProfileId: currentProfile.id,
        kiwiY,
        kiwiVelocity
      })
    }
  }, [kiwiY, kiwiVelocity, gameState, roomId, currentProfile?.id])

  // Send score updates (use userProfileId)
  useEffect(() => {
    if (gameState === 'playing' && socketRef.current && currentProfile?.id) {
      socketRef.current.emit('score-update', { roomId, userProfileId: currentProfile.id, score })
    }
  }, [score, gameState, roomId, currentProfile?.id])

  // Game loop (only host runs physics)
  useEffect(() => {
    if (gameState !== 'playing' || !isHost) return

    const gameLoop = () => {
      if (gameStateRef.current !== 'playing') return

      // Update kiwi physics
      kiwiVelocityRef.current += GRAVITY
      kiwiYRef.current += kiwiVelocityRef.current
      
      // Check ground/ceiling collision
      if (kiwiYRef.current < 0 || kiwiYRef.current > GAME_HEIGHT - KIWI_SIZE) {
        gameStateRef.current = 'gameover'
        setGameState('gameover')
        soundManager.playCollision()
        
        // Notify other players
        if (socketRef.current) {
          socketRef.current.emit('game-state-update', {
            roomId,
            gameState: { state: 'gameover', pipes: pipesRef.current, lastPipeX: lastPipeXRef.current }
          })
        }
        return
      }

      setKiwiY(kiwiYRef.current)
      setKiwiVelocity(kiwiVelocityRef.current)

      // Update pipes
      let newPipes = [...pipesRef.current]
      
      // Add new pipe if needed
      if (lastPipeXRef.current > GAME_WIDTH - PIPE_SPACING) {
        const pipeHeight = Math.random() * (GAME_HEIGHT - PIPE_GAP - 100) + 50
        newPipes.push({
          id: Date.now(),
          x: GAME_WIDTH,
          topHeight: pipeHeight,
          bottomY: pipeHeight + PIPE_GAP,
        })
        lastPipeXRef.current = 0
      } else {
        lastPipeXRef.current += PIPE_SPEED
      }

      // Move pipes and remove off-screen ones
      newPipes = newPipes
        .map((pipe) => ({
          ...pipe,
          x: pipe.x - PIPE_SPEED,
        }))
        .filter((pipe) => pipe.x > -PIPE_WIDTH)

      // Update score
      newPipes.forEach((pipe) => {
        if (pipe.x + PIPE_WIDTH < KIWI_X && !passedPipesRef.current.has(pipe.id)) {
          passedPipesRef.current.add(pipe.id)
          setScore((prev) => prev + 1)
          soundManager.playScore()
        }
      })

      // Check collisions
      newPipes.forEach((pipe) => {
        if (
          KIWI_X < pipe.x + PIPE_WIDTH &&
          KIWI_X + KIWI_SIZE > pipe.x
        ) {
          if (kiwiYRef.current < pipe.topHeight || kiwiYRef.current + KIWI_SIZE > pipe.bottomY) {
            gameStateRef.current = 'gameover'
            setGameState('gameover')
            soundManager.playCollision()
            setTimeout(() => soundManager.playGameOver(), 100)
            
            // Notify other players
            if (socketRef.current) {
              socketRef.current.emit('game-state-update', {
                roomId,
                gameState: { state: 'gameover', pipes: newPipes, lastPipeX: lastPipeXRef.current }
              })
            }
          }
        }
      })

      pipesRef.current = newPipes
      setPipes(newPipes)

      // Broadcast game state to other players
      if (socketRef.current) {
        socketRef.current.emit('game-state-update', {
          roomId,
          gameState: {
            state: 'playing',
            pipes: newPipes,
            lastPipeX: lastPipeXRef.current
          }
        })
      }

      gameLoopRef.current = requestAnimationFrame(gameLoop)
    }

    gameLoopRef.current = requestAnimationFrame(gameLoop)

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current)
      }
    }
  }, [gameState, isHost, roomId])

  // CPU auto-play - competitive pipe avoidance
  useEffect(() => {
    if (!isCPU || gameState !== 'playing') return

    const cpuInterval = setInterval(() => {
      if (gameStateRef.current !== 'playing') return

      const currentY = kiwiYRef.current
      const currentVelocity = kiwiVelocityRef.current
      const currentPipes = pipesRef.current

      // Jump if falling and close to ground (proactive)
      if (currentVelocity > 0 && currentY > GAME_HEIGHT - KIWI_SIZE - 40) {
        jump()
        return
      }

      // Better pipe avoidance - check all approaching pipes
      currentPipes.forEach((pipe) => {
        const pipeDistance = pipe.x - KIWI_X
        const gapCenter = (pipe.topHeight + pipe.bottomY) / 2
        const gapSize = pipe.bottomY - pipe.topHeight
        
        // Proactive jumping - jump earlier for better positioning
        if (pipeDistance > 0 && pipeDistance < 80 && pipeDistance > 15) {
          // Calculate optimal position (center of gap)
          const optimalY = gapCenter - KIWI_SIZE / 2
          const currentDistanceFromOptimal = Math.abs(currentY - optimalY)
          
          // If we're below the gap and need to jump
          if (currentY + KIWI_SIZE > pipe.bottomY - 15 && currentVelocity >= 0) {
            jump()
          }
          // If we're too high and need to fall faster
          else if (currentY < pipe.topHeight + 10 && currentVelocity < -2) {
            // Don't jump - let it fall
          }
          // If we're not well positioned, adjust
          else if (currentDistanceFromOptimal > 20 && currentVelocity >= 0 && currentY > optimalY) {
            // Jump to get closer to optimal position
            jump()
          }
        }
      })
    }, 50) // Check more frequently for competitive play

    return () => clearInterval(cpuInterval)
  }, [isCPU, gameState, jump])

  // Non-host players sync their local physics
  useEffect(() => {
    if (gameState !== 'playing' || isHost) return

    const gameLoop = () => {
      if (gameStateRef.current !== 'playing') return

      // Update local kiwi physics (client-side prediction)
      kiwiVelocityRef.current += GRAVITY
      kiwiYRef.current += kiwiVelocityRef.current
      
      // Check ground/ceiling collision
      if (kiwiYRef.current < 0 || kiwiYRef.current > GAME_HEIGHT - KIWI_SIZE) {
        gameStateRef.current = 'gameover'
        setGameState('gameover')
        soundManager.playCollision()
        return
      }

      setKiwiY(kiwiYRef.current)
      setKiwiVelocity(kiwiVelocityRef.current)

      // Check collisions with pipes (client-side)
      pipesRef.current.forEach((pipe) => {
        if (
          KIWI_X < pipe.x + PIPE_WIDTH &&
          KIWI_X + KIWI_SIZE > pipe.x
        ) {
          if (kiwiYRef.current < pipe.topHeight || kiwiYRef.current + KIWI_SIZE > pipe.bottomY) {
            gameStateRef.current = 'gameover'
            setGameState('gameover')
            soundManager.playCollision()
            setTimeout(() => soundManager.playGameOver(), 100)
          }
        }
      })

      gameLoopRef.current = requestAnimationFrame(gameLoop)
    }

    gameLoopRef.current = requestAnimationFrame(gameLoop)

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current)
      }
    }
  }, [gameState, isHost])

  const myPlayerX = PLAYER_POSITIONS[playerIndexRef.current] || KIWI_X

  return (
    <div className="flex flex-col items-center justify-center pt-20 sm:pt-24">
      {/* Error Notification */}
      {error && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-600 border-2 border-white px-6 py-4 text-white text-center max-w-md">
          <div className="font-bold mb-2">Error</div>
          <div>{error}</div>
          <button
            onClick={() => {
              setError(null)
              if (onLeave) {
                onLeave()
              }
            }}
            className="mt-3 px-4 py-1 text-sm border border-white hover:bg-white hover:text-red-600 transition-all duration-200 cursor-pointer"
          >
            Close
          </button>
        </div>
      )}
      
      {/* Room Info */}
      <div className="mb-4 text-white text-center">
        <div className="text-sm mb-2">Room: {roomId || 'Creating...'}</div>
        <div className="text-xs text-gray-400">
          Players: {players.length}/4 {isHost && '(Host)'}
        </div>
            {players.length > 1 && (
              <div className="text-xs text-gray-400 mt-1">
                {players.map((p, idx) => (
                  <span key={p.userProfileId || p.id || idx} className="mr-2">
                    Player {idx + 1}: {p.score || 0}
                  </span>
                ))}
              </div>
            )}
        {roomId && (
          <button
            onClick={() => {
              const url = `${window.location.origin}${window.location.pathname}?room=${roomId}`
              navigator.clipboard.writeText(url)
              setNotification({ message: 'Room link copied to clipboard!', type: 'success' })
            }}
            className="mt-2 mr-2 px-4 py-1 text-xs border border-white hover:bg-white hover:text-black transition-all duration-200 cursor-pointer"
          >
            Copy Link
          </button>
        )}
        <button
          onClick={onLeave}
          className="mt-2 px-4 py-1 text-xs border border-white hover:bg-white hover:text-black transition-all duration-200 cursor-pointer"
        >
          Leave Room
        </button>
      </div>

      <div
        className="relative border-2 border-white bg-black overflow-hidden"
        style={{ width: GAME_WIDTH, height: GAME_HEIGHT }}
      >
        {/* My Kiwi Bird */}
        <div
          className="absolute bg-white rounded-full transition-transform duration-75 z-10"
          style={{
            left: myPlayerX,
            top: kiwiY,
            width: KIWI_SIZE,
            height: KIWI_SIZE,
            transform: `rotate(${gameState === 'playing' ? Math.min(kiwiVelocity * 3, 30) : 0}deg)`,
          }}
        >
          <div className="absolute top-2 left-2 w-2 h-2 bg-black rounded-full"></div>
          <div className="absolute top-2 right-2 w-2 h-2 bg-black rounded-full"></div>
        </div>

        {/* Other Players' Kiwis */}
        {Array.from(otherPlayers.entries()).map(([userProfileId, { kiwiY: otherY, kiwiVelocity: otherVel }], idx) => {
          const otherPlayer = players.find(p => p.userProfileId && String(p.userProfileId) === String(userProfileId))
          const otherPlayerIndex = otherPlayer ? players.indexOf(otherPlayer) : -1
          const otherPlayerX = otherPlayerIndex >= 0 ? PLAYER_POSITIONS[otherPlayerIndex] : (KIWI_X + (idx + 1) * 50)
          
          return (
            <div
              key={userProfileId || `other-${idx}`}
              className="absolute bg-gray-500 rounded-full transition-transform duration-75 z-5"
              style={{
                left: otherPlayerX,
                top: otherY,
                width: KIWI_SIZE,
                height: KIWI_SIZE,
                transform: `rotate(${gameState === 'playing' ? Math.min(otherVel * 3, 30) : 0}deg)`,
                opacity: 0.7
              }}
            >
              <div className="absolute top-2 left-2 w-2 h-2 bg-black rounded-full"></div>
              <div className="absolute top-2 right-2 w-2 h-2 bg-black rounded-full"></div>
            </div>
          )
        })}

        {/* Pipes */}
        {pipes.map((pipe) => (
          <div key={pipe.id}>
            <div
              className="absolute bg-white"
              style={{
                left: pipe.x,
                top: 0,
                width: PIPE_WIDTH,
                height: pipe.topHeight,
              }}
            />
            <div
              className="absolute bg-white"
              style={{
                left: pipe.x,
                top: pipe.bottomY,
                width: PIPE_WIDTH,
                height: GAME_HEIGHT - pipe.bottomY,
              }}
            />
          </div>
        ))}

        {/* Score */}
        {gameState === 'playing' && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 text-white text-2xl font-bold">
            {score}
          </div>
        )}

        {/* Start Screen */}
        {gameState === 'start' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-80">
            <h1 className="text-4xl font-bold mb-4">Multiplayer Arcade</h1>
            <p className="text-lg mb-2">Click or press SPACE to start</p>
            <p className="text-sm text-gray-400">
              {isHost ? 'You are the host' : 'Waiting for host to start...'}
            </p>
            {players.length > 1 && (
              <p className="text-xs text-gray-500 mt-2">
                {players.length} players in room
              </p>
            )}
          </div>
        )}

        {/* Game Over Screen */}
        {gameState === 'gameover' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-90">
            <h2 className="text-3xl font-bold mb-4">Game Over</h2>
            <p className="text-xl mb-2">Your Score: {score}</p>
            {players.length > 1 && (
              <div className="text-sm mb-2">
                {players
                  .sort((a, b) => (b.score || 0) - (a.score || 0))
                  .map((p, idx) => (
                    <div key={p.userProfileId || p.id || idx} className="mb-1">
                      {idx + 1}. {p.name || `Player ${players.indexOf(p) + 1}`}: {p.score || 0}
                    </div>
                  ))}
              </div>
            )}
            <p className="text-sm text-gray-400">Click or press SPACE to restart</p>
          </div>
        )}
      </div>
      
      {/* Notification */}
      {notification && (
        <Notification
          message={notification.message}
          type={notification.type}
          onClose={() => setNotification(null)}
        />
      )}
    </div>
  )
}

export default MultiplayerGame

