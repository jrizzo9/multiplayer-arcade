import { useState, useEffect, useRef, useCallback } from 'react'
import { getSocket } from '../utils/socket'
import { getCurrentProfile, updateProfileScore } from '../utils/profiles'
import { useRoom } from '../multiplayer/RoomProvider'
import soundManager from '../utils/sounds'
import Notification from './Notification'

// Microgame components
import ClickButtonMicrogame from './microgames/ClickButtonMicrogame'
import CatchFallingMicrogame from './microgames/CatchFallingMicrogame'
import AvoidObstaclesMicrogame from './microgames/AvoidObstaclesMicrogame'
import CountNumbersMicrogame from './microgames/CountNumbersMicrogame'
import MatchColorsMicrogame from './microgames/MatchColorsMicrogame'
import TapFastMicrogame from './microgames/TapFastMicrogame'

const INITIAL_TIME_LIMIT = 3000 // 3 seconds per game initially
const TIME_DECREASE = 50 // Decrease time by 50ms per game
const MIN_TIME_LIMIT = 1000 // Minimum 1 second
const LIVES = 3 // Number of failures before game over

// All available microgames
const MICROGAMES = [
  { id: 'click-button', component: ClickButtonMicrogame },
  { id: 'catch-falling', component: CatchFallingMicrogame },
  { id: 'avoid-obstacles', component: AvoidObstaclesMicrogame },
  { id: 'count-numbers', component: CountNumbersMicrogame },
  { id: 'match-colors', component: MatchColorsMicrogame },
  { id: 'tap-fast', component: TapFastMicrogame },
]

function MicroGames({ onBack, roomId, isHost: propIsHost, players: propPlayers, profile: propProfile, onStartMultiplayer }) {
  // Multiplayer games require a room - if no roomId, this is invalid
  const isMultiplayer = !!roomId
  
  // Get room state from multiplayer foundation (room-snapshot is source of truth)
  const roomState = useRoom(roomId)
  
  // Derive values from room state
  const players = roomState.players || propPlayers || []
  const hostUserProfileId = roomState.hostUserProfileId
  const isHost = propProfile?.id ? roomState.isHost(propProfile.id) : propIsHost || false
  
  // If accessed as multiplayer but no roomId, show error
  if (!roomId && !onStartMultiplayer) {
    return (
      <div className="w-full h-full bg-black flex flex-col items-center justify-center text-white">
        <h1 className="text-4xl font-bold mb-4">MULTIPLAYER GAME</h1>
        <p className="text-xl mb-8 text-center px-4 max-w-md">
          You must join a room to play multiplayer games.
        </p>
        <button
          onClick={onBack}
          className="px-6 py-3 text-lg font-bold border-2 border-white rounded-lg hover:bg-white hover:text-black transition-all duration-200 cursor-pointer"
        >
          ← Back to Menu
        </button>
      </div>
    )
  }
  const [gameState, setGameState] = useState('start') // 'start', 'playing', 'gameover', 'instructions'
  const [currentMicrogame, setCurrentMicrogame] = useState(null)
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(LIVES)
  const [timeLimit, setTimeLimit] = useState(INITIAL_TIME_LIMIT)
  const [currentProfile, setCurrentProfile] = useState(propProfile || null)
  const [gameResult, setGameResult] = useState(null) // 'win' or 'lose'
  const [showResult, setShowResult] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState(100) // Percentage
  const [error, setError] = useState(null)
  const [round, setRound] = useState(0)
  const [playerCompletions, setPlayerCompletions] = useState(new Map()) // Track who completed each round
  const [notification, setNotification] = useState(null)
  
  const timerRef = useRef(null)
  const gameTimeoutRef = useRef(null)
  const gameResultRef = useRef(null)
  const timeIntervalRef = useRef(null)
  const timeLimitRef = useRef(INITIAL_TIME_LIMIT)
  const socketRef = useRef(null)
  const socketInitializedRef = useRef(false)
  const userProfileIdRef = useRef(null) // Use userProfileId instead of socket.id
  const roundStartTimeRef = useRef(null)
  const gameStateRef = useRef('start')

  // Load current profile (only if not provided as prop)
  useEffect(() => {
    if (propProfile) {
      setCurrentProfile(propProfile)
      userProfileIdRef.current = propProfile.id
      return
    }
    const loadProfile = async () => {
      try {
        const profile = await getCurrentProfile()
        setCurrentProfile(profile)
        if (profile?.id) {
          userProfileIdRef.current = profile.id
        }
      } catch (err) {
        console.error('Error loading profile:', err)
        setError('Failed to load profile')
      }
    }
    loadProfile()
  }, [propProfile])

  // Initialize Socket.IO for multiplayer
  useEffect(() => {
    if (!isMultiplayer || socketInitializedRef.current) return

    const socket = getSocket()
    socketRef.current = socket
    socketInitializedRef.current = true

    // Handle connection errors
    socket.on('connect_error', (error) => {
      console.error('[MicroGames] Socket connection error:', error)
      // Don't disconnect shared socket - let Socket.IO handle reconnection
    })

    socket.on('disconnect', (reason) => {
      console.log('[MicroGames] Socket disconnected:', reason)
      if (reason === 'io server disconnect') {
        socket.connect()
      }
    })

    socket.on('connect', () => {
      // Room state is managed by RoomProvider via room-snapshot
      // Store userProfileId for game events
      if (currentProfile?.id) {
        userProfileIdRef.current = currentProfile.id
      }
    })

    // Legacy events for backward compatibility (optional side effects only)
    // Roster is now managed by room-snapshot, not these events
    socket.on('player-joined', () => {
      // Roster updates come from room-snapshot
    })

    socket.on('player-left', () => {
      // Roster updates come from room-snapshot
    })

    // Handle room errors (e.g., non-host trying to start game)
    socket.on('room-error', ({ message }) => {
      console.error('[MicroGames] Room error:', message)
      setNotification({ message: message || 'Room error occurred', type: 'error' })
      // If error is about permissions, reset game state
      if (message && message.includes('host')) {
        setGameState('start')
      }
    })

    // Listen for microgame start from host
    socket.on('microgame-start', ({ gameType, round: roundNum, gameData }) => {
      if (!isHost) {
        const microgame = MICROGAMES.find(m => m.id === gameType)
        if (microgame) {
          setCurrentMicrogame(microgame)
          setRound(roundNum)
          setGameResult(null)
          setShowResult(false)
          setTimeRemaining(100)
          gameResultRef.current = null
          roundStartTimeRef.current = Date.now()
          
          // Start local timer
          const currentTimeLimit = gameData?.timeLimit || INITIAL_TIME_LIMIT
          timeLimitRef.current = currentTimeLimit
          
          const startTime = Date.now()
          if (timeIntervalRef.current) {
            clearInterval(timeIntervalRef.current)
          }
          timeIntervalRef.current = setInterval(() => {
            const elapsed = Date.now() - startTime
            const remaining = Math.max(0, 100 - (elapsed / currentTimeLimit) * 100)
            setTimeRemaining(remaining)
          }, 16)
          
          if (gameTimeoutRef.current) {
            clearTimeout(gameTimeoutRef.current)
          }
          gameTimeoutRef.current = setTimeout(() => {
            if (gameResultRef.current === null) {
              handleGameEnd(false)
            }
          }, currentTimeLimit)
        }
      }
    })

    // Listen for other players' completions
    socket.on('microgame-playing', ({ playerId }) => {
      // Track that a player is playing/completed
    })

    socket.on('microgame-end', ({ scores, totalScores }) => {
      // Score updates come from room-snapshot, but we can update local state for immediate feedback
      // Update local score if this is the current player (use userProfileId)
      if (userProfileIdRef.current && totalScores?.[userProfileIdRef.current] !== undefined) {
        setScore(totalScores[userProfileIdRef.current])
      }
    })

    // Listen for room-closed event (when host leaves)
    socket.on('room-closed', ({ reason, message }) => {
      console.log('[MicroGames] Room closed event received', { reason, message })
      setNotification({ 
        message: message || 'Room has been closed by host', 
        type: 'error' 
      })
      // Stop any ongoing game
      if (gameTimeoutRef.current) {
        clearTimeout(gameTimeoutRef.current)
        gameTimeoutRef.current = null
      }
      if (timeIntervalRef.current) {
        clearInterval(timeIntervalRef.current)
        timeIntervalRef.current = null
      }
      // Return to title screen after showing notification
      setTimeout(() => {
        if (onBack) {
          onBack()
        }
      }, 2000) // Show notification for 2 seconds before going back
    })

    return () => {
      if (socketRef.current) {
        socketRef.current.off('room-closed')
        // Don't disconnect shared socket
        socketInitializedRef.current = false
      }
    }
  }, [isMultiplayer, isHost, onBack])

  // Sync timeLimit ref with state
  useEffect(() => {
    timeLimitRef.current = timeLimit
  }, [timeLimit])

  // Get random microgame
  const getRandomMicrogame = useCallback(() => {
    const randomIndex = Math.floor(Math.random() * MICROGAMES.length)
    return MICROGAMES[randomIndex]
  }, [])

  // Helper function to start a microgame (extracted to avoid circular dependency)
  const startMicrogameInternal = useCallback(() => {
    const microgame = getRandomMicrogame()
    setCurrentMicrogame(microgame)
    setGameResult(null)
    setShowResult(false)
    setTimeRemaining(100)
    gameResultRef.current = null
    roundStartTimeRef.current = Date.now()

    // Clear any existing timers
    if (gameTimeoutRef.current) {
      clearTimeout(gameTimeoutRef.current)
    }
    if (timeIntervalRef.current) {
      clearInterval(timeIntervalRef.current)
    }
    
    const currentTimeLimit = timeLimitRef.current
    
    // In multiplayer, host broadcasts the game selection
    if (isMultiplayer && isHost && socketRef.current && roomId) {
      const newRound = round + 1
      setRound(newRound)
      socketRef.current.emit('microgame-start', {
        roomId,
        gameType: microgame.id,
        round: newRound,
        gameData: {
          timeLimit: currentTimeLimit
        }
      })
    }
    
    // Animate time bar
    const startTime = Date.now()
    timeIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime
      const remaining = Math.max(0, 100 - (elapsed / currentTimeLimit) * 100)
      setTimeRemaining(remaining)
    }, 16) // ~60fps
    
    // Set timeout for the game
    gameTimeoutRef.current = setTimeout(() => {
      if (gameResultRef.current === null) {
        // Time ran out - player lost
        if (timeIntervalRef.current) {
          clearInterval(timeIntervalRef.current)
        }
        setTimeRemaining(0)
        handleGameEnd(false)
      }
    }, currentTimeLimit)
  }, [getRandomMicrogame, isMultiplayer, isHost, roomId, round])

  // Handle game end (win or lose)
  const handleGameEnd = useCallback((won) => {
    if (gameTimeoutRef.current) {
      clearTimeout(gameTimeoutRef.current)
      gameTimeoutRef.current = null
    }
    if (timeIntervalRef.current) {
      clearInterval(timeIntervalRef.current)
      timeIntervalRef.current = null
    }

    gameResultRef.current = won ? 'win' : 'lose'
    setGameResult(won ? 'win' : 'lose')
    setShowResult(true)

    // In multiplayer, emit completion event (use userProfileId)
    if (isMultiplayer && socketRef.current && userProfileIdRef.current && roomId) {
      const completionTime = roundStartTimeRef.current ? Date.now() - roundStartTimeRef.current : 0
      socketRef.current.emit('microgame-playing', { roomId, userProfileId: userProfileIdRef.current })
      
      // Calculate score: base points for completion, bonus for speed
      const roundScore = won ? 10 + Math.max(0, Math.floor((timeLimitRef.current - completionTime) / 100)) : 0
      
      socketRef.current.emit('microgame-end', {
        roomId,
        scores: {
          [userProfileIdRef.current]: roundScore
        }
      })
    }

    if (won) {
      // In single player, increment score
      if (!isMultiplayer) {
        setScore(prev => prev + 1)
      }
      // In multiplayer, score is updated via socket event
      
      // Decrease time limit for next game (make it faster)
      setTimeLimit(prev => {
        const newLimit = Math.max(prev - TIME_DECREASE, MIN_TIME_LIMIT)
        timeLimitRef.current = newLimit
        return newLimit
      })
      soundManager.playScore?.()
      
      // In multiplayer, wait for host to start next round
      // In single player, continue immediately
      if (!isMultiplayer || isHost) {
        setTimeout(() => {
          startMicrogameInternal()
        }, 800)
      }
    } else {
      setLives(prev => {
        const newLives = prev - 1
        if (newLives <= 0) {
          // Game over
          setTimeout(() => {
            setGameState('gameover')
            setScore(currentScore => {
              if (currentProfile) {
                updateProfileScore(currentProfile.id || currentProfile.name, 'microgames', {
                  score: currentScore,
                  completed: false
                })
              }
              return currentScore
            })
          }, 1000)
          return 0
        }
        soundManager.playCollision?.()
        
        // In multiplayer, wait for host to start next round
        // In single player, continue immediately
        if (!isMultiplayer || isHost) {
          setTimeout(() => {
            startMicrogameInternal()
          }, 800)
        }
        
        return newLives
      })
    }
  }, [currentProfile, startMicrogameInternal, isMultiplayer, isHost, roomId])

  // Start a new microgame (public function)
  const startMicrogame = useCallback(() => {
    startMicrogameInternal()
  }, [startMicrogameInternal])

  // Handle microgame completion callback
  const handleMicrogameComplete = useCallback((success) => {
    if (gameResultRef.current === null) {
      handleGameEnd(success)
    }
  }, [handleGameEnd])

  // Start the game
  const handleStart = () => {
    setGameState('playing')
    setScore(0)
    setLives(LIVES)
    setTimeLimit(INITIAL_TIME_LIMIT)
    setRound(0)
    timeLimitRef.current = INITIAL_TIME_LIMIT
    
    // In multiplayer, host broadcasts game start
    if (isMultiplayer && isHost && socketRef.current) {
      socketRef.current.emit('game-state-update', {
        roomId,
        gameState: {
          state: 'playing',
          round: 0
        }
      })
    }
    
    startMicrogame()
  }

  // Listen for game state updates in multiplayer
  useEffect(() => {
    if (!isMultiplayer || !socketRef.current) return

    const socket = socketRef.current
    socket.on('game-state-update', (gameState) => {
      if (!isHost && gameState.state) {
        if (gameState.state === 'playing' && gameStateRef.current !== 'playing') {
          setGameState('playing')
          setScore(0)
          setLives(LIVES)
          setTimeLimit(INITIAL_TIME_LIMIT)
          timeLimitRef.current = INITIAL_TIME_LIMIT
        } else if (gameState.state === 'gameover') {
          setGameState('gameover')
        }
      }
    })

    return () => {
      socket.off('game-state-update')
    }
  }, [isMultiplayer, isHost])

  // Restart game
  const handleRestart = () => {
    setGameState('start')
    setScore(0)
    setLives(LIVES)
    setTimeLimit(INITIAL_TIME_LIMIT)
    setCurrentMicrogame(null)
    setGameResult(null)
    setShowResult(false)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gameTimeoutRef.current) {
        clearTimeout(gameTimeoutRef.current)
      }
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      if (timeIntervalRef.current) {
        clearInterval(timeIntervalRef.current)
      }
    }
  }, [])

  const MicrogameComponent = currentMicrogame?.component

  // Debug: Log component state
  useEffect(() => {
    console.log('MicroGames rendered:', { 
      gameState, 
      currentProfile: !!currentProfile,
      isMultiplayer,
      onStartMultiplayer: !!onStartMultiplayer,
      roomId,
      isHost
    })
  }, [gameState, currentProfile, isMultiplayer, onStartMultiplayer, roomId, isHost])

  // Show error if there's one
  if (error) {
    return (
      <div className="w-full min-h-screen bg-black flex flex-col items-center justify-center relative" style={{ minHeight: '100vh' }}>
        <button
          onClick={onBack}
          className="absolute top-4 left-4 px-4 py-2 text-white border-2 border-white rounded-lg hover:bg-white hover:text-black transition-all duration-200 cursor-pointer z-50"
        >
          ← Back
        </button>
        <div className="text-white text-xl">Error: {error}</div>
      </div>
    )
  }

  return (
    <div className="w-full min-h-screen bg-black flex flex-col items-center justify-center relative" style={{ minHeight: '100vh' }}>
      {/* Back Button */}
      <button
        onClick={onBack}
        className="absolute top-4 left-4 px-4 py-2 text-white border-2 border-white rounded-lg hover:bg-white hover:text-black transition-all duration-200 cursor-pointer z-50"
      >
        ← Back
      </button>

      {/* Start Screen */}
      {gameState === 'start' && (
        <div className="flex flex-col items-center justify-center text-white" style={{ minHeight: '400px' }}>
          <h1 className="text-6xl md:text-7xl font-bold mb-8">MICRO GAMES</h1>
          {!isMultiplayer ? (
            <>
              <p className="text-xl md:text-2xl mb-4 text-center px-4">
                {currentProfile ? `Playing as ${currentProfile.name}` : 'Select a profile to play'}
              </p>
              <p className="text-base md:text-lg mb-8 text-gray-400 text-center px-4 max-w-md">
                Play microgames with friends!<br />
                Create or join a room to get started.
              </p>
              {onStartMultiplayer ? (
                <button
                  onClick={onStartMultiplayer}
                  disabled={!currentProfile}
                  className={`px-8 py-4 text-xl font-bold border-2 border-white rounded-lg transition-all duration-200 cursor-pointer ${
                    currentProfile
                      ? 'text-white hover:bg-white hover:text-black'
                      : 'text-gray-500 border-gray-500 cursor-not-allowed'
                  }`}
                >
                  {currentProfile ? 'FIND ROOM' : 'SELECT PROFILE FIRST'}
                </button>
              ) : (
                <p className="text-gray-400">Loading...</p>
              )}
            </>
          ) : (
            <>
              <p className="text-xl md:text-2xl mb-4 text-center px-4">
                Room: {roomId} {isHost && '(Host)'}
              </p>
              <p className="text-base md:text-lg mb-4 text-gray-400 text-center px-4 max-w-md">
                {players.length} player{players.length !== 1 ? 's' : ''} in room
              </p>
              {players.length > 0 && (
                <div className="mb-6 space-y-2">
                  {players.map((player, idx) => {
                    const isPlayerHost = player.userProfileId && hostUserProfileId && 
                      String(player.userProfileId) === String(hostUserProfileId)
                    return (
                      <div
                        key={player.userProfileId || player.id || idx}
                        className="flex items-center gap-2 text-lg"
                        style={{ color: player.color || '#FFFFFF' }}
                      >
                        <span>{player.emoji || '⚪'}</span>
                        <span>{player.name || `Player ${idx + 1}`}</span>
                        {isPlayerHost && <span className="text-sm text-gray-400">(Host)</span>}
                      </div>
                    )
                  })}
                </div>
              )}
              <p className="text-base md:text-lg mb-8 text-gray-400 text-center px-4 max-w-md">
                Complete microgames as fast as you can!<br />
                Speed increases with each game.<br />
                {isHost ? 'You control the game flow.' : 'Waiting for host to start...'}
              </p>
              {isHost && (
                <button
                  onClick={handleStart}
                  className="px-8 py-4 text-xl font-bold text-white border-2 border-white rounded-lg hover:bg-white hover:text-black transition-all duration-200 cursor-pointer"
                >
                  START GAME
                </button>
              )}
              {!isHost && (
                <p className="text-gray-400">Waiting for host to start the game...</p>
              )}
            </>
          )}
        </div>
      )}

      {/* Playing State */}
      {gameState === 'playing' && (
        <div className="w-full h-full flex flex-col items-center justify-center relative">
          {/* Score and Lives */}
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 flex gap-8 text-white z-10">
            <div className="text-2xl font-bold">Score: {score}</div>
            {!isMultiplayer && <div className="text-2xl font-bold">Lives: {lives}</div>}
          </div>

          {/* Multiplayer Leaderboard */}
          {isMultiplayer && players.length > 0 && (
            <div className="absolute top-4 right-4 bg-black border-2 border-white rounded-lg p-3 z-10 max-w-xs">
              <div className="text-white text-sm font-bold mb-2">Players</div>
              <div className="space-y-1">
                {players
                  .sort((a, b) => (b.score || 0) - (a.score || 0))
                  .map((player, idx) => {
                    const isCurrentPlayer = player.userProfileId && currentProfile?.id && 
                      String(player.userProfileId) === String(currentProfile.id)
                    return (
                      <div
                        key={player.userProfileId || player.id || idx}
                        className={`flex items-center gap-2 text-xs ${
                          isCurrentPlayer ? 'font-bold' : ''
                        }`}
                        style={{ color: player.color || '#FFFFFF' }}
                      >
                        <span>{player.emoji || '⚪'}</span>
                        <span className="flex-1 truncate">{player.name || `Player ${idx + 1}`}</span>
                        <span>{player.score || 0}</span>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}

          {/* Time Remaining Bar */}
          <div className="absolute top-20 left-1/2 transform -translate-x-1/2 w-80 h-2 bg-gray-800 border border-white rounded-full overflow-hidden z-10">
            <div
              className="h-full bg-white transition-none"
              style={{
                width: `${timeRemaining}%`
              }}
            />
          </div>

          {/* Result Overlay */}
          {showResult && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-80 z-20">
              <div className="text-6xl font-bold">
                {gameResult === 'win' ? (
                  <span className="text-green-400">SUCCESS!</span>
                ) : (
                  <span className="text-red-400">FAILED!</span>
                )}
              </div>
            </div>
          )}

          {/* Current Microgame */}
          {MicrogameComponent && (
            <div className="w-full max-w-2xl px-4">
              <MicrogameComponent
                onComplete={handleMicrogameComplete}
                timeLimit={timeLimit}
              />
            </div>
          )}
        </div>
      )}

      {/* Game Over Screen */}
      {gameState === 'gameover' && (
        <div className="flex flex-col items-center justify-center text-white">
          <h2 className="text-5xl md:text-6xl font-bold mb-8">GAME OVER</h2>
          {isMultiplayer && players.length > 0 ? (
            <>
              <p className="text-2xl md:text-3xl mb-6">Final Rankings</p>
              <div className="mb-8 space-y-3 w-full max-w-md px-4">
                {players
                  .sort((a, b) => (b.score || 0) - (a.score || 0))
                  .map((player, idx) => {
                    const isCurrentPlayer = player.userProfileId && currentProfile?.id && 
                      String(player.userProfileId) === String(currentProfile.id)
                    return (
                      <div
                        key={player.userProfileId || player.id || idx}
                        className={`flex items-center gap-3 px-4 py-3 border-2 rounded-lg ${
                          isCurrentPlayer ? 'border-white bg-white bg-opacity-10' : 'border-gray-600'
                        }`}
                        style={{ borderColor: isCurrentPlayer ? player.color || '#FFFFFF' : undefined }}
                      >
                        <span className="text-2xl font-bold w-8">#{idx + 1}</span>
                        <span className="text-2xl">{player.emoji || '⚪'}</span>
                        <div className="flex-1">
                          <div
                            className="text-lg font-bold"
                            style={{ color: player.color || '#FFFFFF' }}
                          >
                            {player.name || `Player ${idx + 1}`}
                            {isCurrentPlayer && <span className="text-sm text-gray-400 ml-2">(You)</span>}
                          </div>
                        </div>
                        <div className="text-2xl font-bold">{player.score || 0}</div>
                      </div>
                    )
                  })}
              </div>
            </>
          ) : (
            <>
              <p className="text-3xl md:text-4xl mb-4">Final Score: {score}</p>
              <p className="text-lg md:text-xl mb-8 text-gray-400">
                {score >= 20 ? 'Amazing!' : score >= 10 ? 'Great job!' : score >= 5 ? 'Good try!' : 'Keep practicing!'}
              </p>
            </>
          )}
          <div className="flex gap-4">
            {!isMultiplayer && (
              <button
                onClick={handleRestart}
                className="px-8 py-4 text-xl font-bold text-white border-2 border-white rounded-lg hover:bg-white hover:text-black transition-all duration-200 cursor-pointer"
              >
                PLAY AGAIN
              </button>
            )}
            <button
              onClick={onBack}
              className="px-8 py-4 text-xl font-bold text-white border-2 border-white rounded-lg hover:bg-white hover:text-black transition-all duration-200 cursor-pointer"
            >
              {isMultiplayer ? 'BACK TO ROOM' : 'BACK TO MENU'}
            </button>
          </div>
        </div>
      )}

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

export default MicroGames

