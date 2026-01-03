import { useState, useEffect, useRef, useCallback } from 'react'
import { getSocket } from '../utils/socket'
import { getCurrentProfile } from '../utils/profiles'
import { useRoom } from '../multiplayer/RoomProvider'
import { emitDirectionChange, emitGameStart, emitGameState, subscribeToSnakeEvents } from '../games/snake/network'
import soundManager from '../utils/sounds'
import Notification from './Notification'

// Game constants
const GRID_SIZE = 20
const CELL_SIZE = 20
const GAME_SPEED = 150 // milliseconds
const WIN_SCORE = 50 // First to 50 points wins

// Responsive game dimensions
const getGameDimensions = () => {
  const isMobile = window.innerWidth < 768
  const maxWidth = isMobile ? window.innerWidth - 20 : 400
  const gridWidth = Math.floor(maxWidth / CELL_SIZE)
  const gridHeight = Math.floor((maxWidth * 1.2) / CELL_SIZE)
  return {
    width: gridWidth * CELL_SIZE,
    height: gridHeight * CELL_SIZE,
    gridWidth,
    gridHeight,
    isMobile
  }
}

function Snake({ roomId, isHost: propIsHost, onLeave, onRoomCreated, playerName, onScoreUpdate, onScorePulse }) {
  // Get room state from multiplayer foundation
  const roomState = useRoom(roomId)
  const [currentProfile, setCurrentProfile] = useState(null)
  
  // Derive values from room state
  const players = roomState.players || []
  const isHost = currentProfile?.id ? roomState.isHost(currentProfile.id) : propIsHost || false
  
  const [dimensions, setDimensions] = useState(getGameDimensions())
  const [gameState, setGameState] = useState('waiting') // 'waiting', 'playing', 'gameover'
  const [snake1, setSnake1] = useState([{ x: 10, y: 10 }])
  const [snake2, setSnake2] = useState([{ x: 15, y: 15 }])
  const [direction1, setDirection1] = useState({ x: 1, y: 0 })
  const [direction2, setDirection2] = useState({ x: -1, y: 0 })
  const [nextDirection1, setNextDirection1] = useState({ x: 1, y: 0 })
  const [nextDirection2, setNextDirection2] = useState({ x: -1, y: 0 })
  const [food, setFood] = useState({ x: 20, y: 20 })
  const [score1, setScore1] = useState(0)
  const [score2, setScore2] = useState(0)
  const [error, setError] = useState(null)
  const [notification, setNotification] = useState(null)
  const [scorePulse, setScorePulse] = useState(false)
  
  const gameLoopRef = useRef(null)
  const gameStateRef = useRef('waiting')
  const snake1Ref = useRef([{ x: 10, y: 10 }])
  const snake2Ref = useRef([{ x: 15, y: 15 }])
  const direction1Ref = useRef({ x: 1, y: 0 })
  const direction2Ref = useRef({ x: -1, y: 0 })
  const nextDirection1Ref = useRef({ x: 1, y: 0 })
  const nextDirection2Ref = useRef({ x: -1, y: 0 })
  const foodRef = useRef({ x: 20, y: 20 })
  const score1Ref = useRef(0)
  const score2Ref = useRef(0)
  const playerNumberRef = useRef(1)
  const socketInitializedRef = useRef(false)
  const lastBroadcastTimeRef = useRef(0)
  const BROADCAST_THROTTLE_MS = 100 // ~10 Hz for snake updates
  
  // Load current profile
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const profile = await getCurrentProfile()
        setCurrentProfile(profile)
      } catch (err) {
        console.error('[Snake] Error loading profile:', err)
      }
    }
    loadProfile()
  }, [])
  
  // Determine player number based on position in players array
  useEffect(() => {
    if (currentProfile?.id && players.length > 0) {
      const myIndex = players.findIndex(p => p.userProfileId && String(p.userProfileId) === String(currentProfile.id))
      playerNumberRef.current = myIndex >= 0 ? myIndex + 1 : 1
    } else if (isHost) {
      playerNumberRef.current = 1
    }
  }, [currentProfile?.id, players, isHost])

  // Update dimensions on resize
  useEffect(() => {
    const handleResize = () => {
      setDimensions(getGameDimensions())
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Generate new food position
  const generateFood = useCallback(() => {
    const { gridWidth, gridHeight } = dimensions
    let newFood
    let attempts = 0
    do {
      newFood = {
        x: Math.floor(Math.random() * gridWidth),
        y: Math.floor(Math.random() * gridHeight)
      }
      attempts++
    } while (
      (snake1Ref.current.some(segment => segment.x === newFood.x && segment.y === newFood.y) ||
       snake2Ref.current.some(segment => segment.x === newFood.x && segment.y === newFood.y)) &&
      attempts < 100
    )
    
    foodRef.current = newFood
    setFood(newFood)
  }, [dimensions])

  // Handle direction changes
  const changeDirection = useCallback((newDirection) => {
    if (gameStateRef.current !== 'playing') return
    
    const isPlayer1 = playerNumberRef.current === 1
    const currentDirection = isPlayer1 ? direction1Ref.current : direction2Ref.current
    
    // Prevent reversing into itself
    if (
      (newDirection.x === -currentDirection.x && currentDirection.x !== 0) ||
      (newDirection.y === -currentDirection.y && currentDirection.y !== 0)
    ) {
      return
    }
    
    if (isPlayer1) {
      nextDirection1Ref.current = newDirection
      setNextDirection1(newDirection)
    } else {
      nextDirection2Ref.current = newDirection
      setNextDirection2(newDirection)
    }
    
    // Send direction change to server
    if (roomId) {
      emitDirectionChange(roomId, playerNumberRef.current, newDirection)
    }
  }, [roomId])

  // Initialize Snake networking
  useEffect(() => {
    if (!roomId || socketInitializedRef.current) return

    const socket = getSocket()
    socketInitializedRef.current = true

    // Subscribe to Snake game events
    const cleanup = subscribeToSnakeEvents({
      onGameStart: ({ gameState: startGameState }) => {
        if (!isHost && startGameState) {
          gameStateRef.current = 'playing'
          setGameState('playing')
          
          if (startGameState.snake1) {
            setSnake1(startGameState.snake1)
            snake1Ref.current = startGameState.snake1
          }
          if (startGameState.snake2) {
            setSnake2(startGameState.snake2)
            snake2Ref.current = startGameState.snake2
          }
          if (startGameState.direction1) {
            setDirection1(startGameState.direction1)
            direction1Ref.current = startGameState.direction1
            nextDirection1Ref.current = startGameState.direction1
            setNextDirection1(startGameState.direction1)
          }
          if (startGameState.direction2) {
            setDirection2(startGameState.direction2)
            direction2Ref.current = startGameState.direction2
            nextDirection2Ref.current = startGameState.direction2
            setNextDirection2(startGameState.direction2)
          }
          if (startGameState.food) {
            setFood(startGameState.food)
            foodRef.current = startGameState.food
          }
          if (startGameState.score1 !== undefined) {
            setScore1(startGameState.score1)
            score1Ref.current = startGameState.score1
          }
          if (startGameState.score2 !== undefined) {
            setScore2(startGameState.score2)
            score2Ref.current = startGameState.score2
          }
        }
      },
      onGameState: (gameState) => {
        if (!isHost) {
          if (gameState.snake1) {
            setSnake1(gameState.snake1)
            snake1Ref.current = gameState.snake1
          }
          if (gameState.snake2) {
            setSnake2(gameState.snake2)
            snake2Ref.current = gameState.snake2
          }
          if (gameState.direction1) {
            direction1Ref.current = gameState.direction1
            setDirection1(gameState.direction1)
          }
          if (gameState.direction2) {
            direction2Ref.current = gameState.direction2
            setDirection2(gameState.direction2)
          }
          if (gameState.food) {
            setFood(gameState.food)
            foodRef.current = gameState.food
          }
          if (gameState.score1 !== undefined) {
            setScore1(gameState.score1)
            score1Ref.current = gameState.score1
          }
          if (gameState.score2 !== undefined) {
            setScore2(gameState.score2)
            score2Ref.current = gameState.score2
          }
          if (gameState.state && gameState.state !== gameStateRef.current) {
            setGameState(gameState.state)
            gameStateRef.current = gameState.state
            if (gameState.state === 'gameover') {
              soundManager.playGameOver()
            }
          }
        }
      },
      onDirectionChange: ({ playerNumber, direction }) => {
        if (isHost) {
          // Host receives direction changes and applies them
          if (playerNumber === 1) {
            const currentDir = direction1Ref.current
            if (
              !(direction.x === -currentDir.x && currentDir.x !== 0) &&
              !(direction.y === -currentDir.y && currentDir.y !== 0)
            ) {
              nextDirection1Ref.current = direction
              setNextDirection1(direction)
            }
          } else if (playerNumber === 2) {
            const currentDir = direction2Ref.current
            if (
              !(direction.x === -currentDir.x && currentDir.x !== 0) &&
              !(direction.y === -currentDir.y && currentDir.y !== 0)
            ) {
              nextDirection2Ref.current = direction
              setNextDirection2(direction)
            }
          }
        }
      }
    })

    return () => {
      cleanup()
      socketInitializedRef.current = false
    }
  }, [roomId, isHost])

  // Start game when host clicks
  const startGame = useCallback(() => {
    if (gameStateRef.current !== 'waiting' || !isHost) return
    
    const { gridWidth, gridHeight } = dimensions
    const initialSnake1 = [{ x: Math.floor(gridWidth / 4), y: Math.floor(gridHeight / 2) }]
    const initialSnake2 = [{ x: Math.floor(gridWidth * 3 / 4), y: Math.floor(gridHeight / 2) }]
    const initialDirection1 = { x: 1, y: 0 }
    const initialDirection2 = { x: -1, y: 0 }
    
    snake1Ref.current = initialSnake1
    snake2Ref.current = initialSnake2
    direction1Ref.current = initialDirection1
    direction2Ref.current = initialDirection2
    nextDirection1Ref.current = initialDirection1
    nextDirection2Ref.current = initialDirection2
    setSnake1(initialSnake1)
    setSnake2(initialSnake2)
    setDirection1(initialDirection1)
    setDirection2(initialDirection2)
    setNextDirection1(initialDirection1)
    setNextDirection2(initialDirection2)
    setScore1(0)
    setScore2(0)
    score1Ref.current = 0
    score2Ref.current = 0
    gameStateRef.current = 'playing'
    setGameState('playing')
    generateFood()
    soundManager.playSelect()
    
    // Broadcast game start
    if (roomId) {
      const gameStartState = {
        state: 'playing',
        snake1: initialSnake1,
        snake2: initialSnake2,
        direction1: initialDirection1,
        direction2: initialDirection2,
        food: foodRef.current,
        score1: 0,
        score2: 0
      }
      emitGameStart(roomId, gameStartState)
    }
  }, [isHost, roomId, dimensions, generateFood])

  // Keyboard controls
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (gameStateRef.current === 'waiting' && e.code === 'Space' && isHost) {
        e.preventDefault()
        startGame()
        return
      }
      
      if (gameStateRef.current !== 'playing') return
      
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          e.preventDefault()
          changeDirection({ x: 0, y: -1 })
          break
        case 'ArrowDown':
        case 's':
        case 'S':
          e.preventDefault()
          changeDirection({ x: 0, y: 1 })
          break
        case 'ArrowLeft':
        case 'a':
        case 'A':
          e.preventDefault()
          changeDirection({ x: -1, y: 0 })
          break
        case 'ArrowRight':
        case 'd':
        case 'D':
          e.preventDefault()
          changeDirection({ x: 1, y: 0 })
          break
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [startGame, changeDirection, isHost])

  // Touch controls for mobile - swipe gestures
  const touchStartRef = useRef({ x: null, y: null })
  
  const handleTouchStart = useCallback((e) => {
    if (gameStateRef.current === 'waiting' && isHost) {
      e.preventDefault()
      startGame()
      return
    }
    
    if (gameStateRef.current !== 'playing') return
    
    const touch = e.touches[0]
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY
    }
  }, [startGame, isHost])

  const handleTouchEnd = useCallback((e) => {
    if (!touchStartRef.current.x || !touchStartRef.current.y || gameStateRef.current !== 'playing') {
      touchStartRef.current = { x: null, y: null }
      return
    }
    
    const touch = e.changedTouches[0]
    const deltaX = touch.clientX - touchStartRef.current.x
    const deltaY = touch.clientY - touchStartRef.current.y
    const minSwipeDistance = 20 // Reduced threshold for more responsive controls

    // Determine swipe direction based on primary axis
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      // Horizontal swipe
      if (Math.abs(deltaX) > minSwipeDistance) {
        e.preventDefault()
        changeDirection(deltaX > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 })
      }
    } else {
      // Vertical swipe
      if (Math.abs(deltaY) > minSwipeDistance) {
        e.preventDefault()
        changeDirection(deltaY > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 })
      }
    }

    touchStartRef.current = { x: null, y: null }
  }, [changeDirection])

  // Attach touch handlers to game area element
  const gameAreaRef = useRef(null)

  // Sync refs with state
  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])

  useEffect(() => {
    snake1Ref.current = snake1
  }, [snake1])

  useEffect(() => {
    snake2Ref.current = snake2
  }, [snake2])

  useEffect(() => {
    foodRef.current = food
  }, [food])

  // Game loop (only host runs physics)
  useEffect(() => {
    if (gameState !== 'playing' || !isHost) return

    const gameLoop = () => {
      if (gameStateRef.current !== 'playing') return

      const { gridWidth, gridHeight } = dimensions
      
      // Update directions
      direction1Ref.current = nextDirection1Ref.current
      direction2Ref.current = nextDirection2Ref.current
      setDirection1(direction1Ref.current)
      setDirection2(direction2Ref.current)

      // Move snake 1
      const head1 = { ...snake1Ref.current[0] }
      head1.x += direction1Ref.current.x
      head1.y += direction1Ref.current.y

      // Move snake 2
      const head2 = { ...snake2Ref.current[0] }
      head2.x += direction2Ref.current.x
      head2.y += direction2Ref.current.y

      // Check wall collisions
      let gameOver = false
      let winner = null
      
      if (head1.x < 0 || head1.x >= gridWidth || head1.y < 0 || head1.y >= gridHeight) {
        gameOver = true
        winner = 2
      }
      if (head2.x < 0 || head2.x >= gridWidth || head2.y < 0 || head2.y >= gridHeight) {
        if (!gameOver) {
          gameOver = true
          winner = 1
        } else {
          winner = 0 // Tie
        }
      }

      // Check self collisions
      if (snake1Ref.current.some(segment => segment.x === head1.x && segment.y === head1.y && segment !== snake1Ref.current[0])) {
        if (!gameOver) {
          gameOver = true
          winner = 2
        } else {
          winner = 0
        }
      }
      if (snake2Ref.current.some(segment => segment.x === head2.x && segment.y === head2.y && segment !== snake2Ref.current[0])) {
        if (!gameOver) {
          gameOver = true
          winner = 1
        } else {
          winner = 0
        }
      }

      // Check snake-to-snake collisions
      if (snake1Ref.current.some(segment => segment.x === head2.x && segment.y === head2.y)) {
        if (!gameOver) {
          gameOver = true
          winner = 1
        } else {
          winner = 0
        }
      }
      if (snake2Ref.current.some(segment => segment.x === head1.x && segment.y === head1.y)) {
        if (!gameOver) {
          gameOver = true
          winner = 2
        } else {
          winner = 0
        }
      }

      if (gameOver) {
        gameStateRef.current = 'gameover'
        setGameState('gameover')
        soundManager.playCollision()
        setTimeout(() => soundManager.playGameOver(), 100)
        
        // Record win if there's a winner (not a tie)
        if (winner === 1 || winner === 2) {
          const winnerPlayer = players[winner - 1]
          // Wins are automatically saved to NoCodeBackend via match history
          if (winnerPlayer?.userProfileId) {
            // No need to record win separately - handled by match history
          }
        }
        
        // Broadcast gameover
        if (roomId) {
          emitGameState(roomId, {
            state: 'gameover',
            snake1: snake1Ref.current,
            snake2: snake2Ref.current,
            direction1: direction1Ref.current,
            direction2: direction2Ref.current,
            food: foodRef.current,
            score1: score1Ref.current,
            score2: score2Ref.current,
            winner
          })
        }
        return
      }

      // Check food collisions
      let ateFood1 = false
      let ateFood2 = false
      
      if (head1.x === foodRef.current.x && head1.y === foodRef.current.y) {
        ateFood1 = true
        score1Ref.current += 10
        setScore1(score1Ref.current)
        soundManager.playScore()
        generateFood()
        
        if (score1Ref.current >= WIN_SCORE) {
          gameStateRef.current = 'gameover'
          setGameState('gameover')
          soundManager.playGameOver()
          
          // Record win for player 1
          const winnerPlayer = players[0]
          if (winnerPlayer?.userProfileId) {
            const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
            const serverUrl = `${protocol}//${window.location.hostname}:8000`
            fetch(`${serverUrl}/api/wins/record`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userProfileId: winnerPlayer.userProfileId,
                gameType: 'snake'
              })
            }).catch(err => console.error('[Snake] Error recording win:', err))
          }
          
          if (roomId) {
            emitGameState(roomId, {
              state: 'gameover',
              snake1: snake1Ref.current,
              snake2: snake2Ref.current,
              direction1: direction1Ref.current,
              direction2: direction2Ref.current,
              food: foodRef.current,
              score1: score1Ref.current,
              score2: score2Ref.current,
              winner: 1
            })
          }
          return
        }
      }
      
      if (head2.x === foodRef.current.x && head2.y === foodRef.current.y) {
        ateFood2 = true
        score2Ref.current += 10
        setScore2(score2Ref.current)
        soundManager.playScore()
        generateFood()
        
        if (score2Ref.current >= WIN_SCORE) {
          gameStateRef.current = 'gameover'
          setGameState('gameover')
          soundManager.playGameOver()
          
          // Record win for player 2
          const winnerPlayer = players[1]
          if (winnerPlayer?.userProfileId) {
            const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
            const serverUrl = `${protocol}//${window.location.hostname}:8000`
            fetch(`${serverUrl}/api/wins/record`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userProfileId: winnerPlayer.userProfileId,
                gameType: 'snake'
              })
            }).catch(err => console.error('[Snake] Error recording win:', err))
          }
          
          if (roomId) {
            emitGameState(roomId, {
              state: 'gameover',
              snake1: snake1Ref.current,
              snake2: snake2Ref.current,
              direction1: direction1Ref.current,
              direction2: direction2Ref.current,
              food: foodRef.current,
              score1: score1Ref.current,
              score2: score2Ref.current,
              winner: 2
            })
          }
          return
        }
      }

      // Update snakes
      const newSnake1 = [head1, ...snake1Ref.current]
      if (!ateFood1) {
        newSnake1.pop()
      }
      
      const newSnake2 = [head2, ...snake2Ref.current]
      if (!ateFood2) {
        newSnake2.pop()
      }

      snake1Ref.current = newSnake1
      snake2Ref.current = newSnake2
      setSnake1(newSnake1)
      setSnake2(newSnake2)

      // Update scores for parent component
      if (onScoreUpdate) {
        const player1Style = players[0] ? {
          emoji: players[0].emoji || '⚪',
          color: players[0].color || '#FFFFFF',
          name: players[0].name || 'Player 1'
        } : { emoji: '⚪', color: '#FFFFFF', name: 'Player 1' }
        const player2Style = players[1] ? {
          emoji: players[1].emoji || '⚪',
          color: players[1].color || '#FFFFFF',
          name: players[1].name || 'Player 2'
        } : { emoji: '⚪', color: '#FFFFFF', name: 'Player 2' }
        
        onScoreUpdate({
          leftScore: score1Ref.current,
          rightScore: score2Ref.current,
          leftPlayerStyle: player1Style,
          rightPlayerStyle: player2Style
        })
      }

      // Broadcast game state (throttled)
      const now = Date.now()
      if (roomId && (now - lastBroadcastTimeRef.current >= BROADCAST_THROTTLE_MS)) {
        lastBroadcastTimeRef.current = now
        emitGameState(roomId, {
          state: 'playing',
          snake1: newSnake1,
          snake2: newSnake2,
          direction1: direction1Ref.current,
          direction2: direction2Ref.current,
          food: foodRef.current,
          score1: score1Ref.current,
          score2: score2Ref.current
        })
      }

      gameLoopRef.current = setTimeout(gameLoop, GAME_SPEED)
    }

    gameLoopRef.current = setTimeout(gameLoop, GAME_SPEED)

    return () => {
      if (gameLoopRef.current) {
        clearTimeout(gameLoopRef.current)
      }
    }
  }, [gameState, isHost, dimensions, generateFood, roomId, players, onScoreUpdate])

  // Get player styles
  const getPlayerStyle = (playerIndex) => {
    if (playerIndex < players.length) {
      const player = players[playerIndex]
      return {
        emoji: player.emoji || '⚪',
        color: player.color || '#FFFFFF',
        name: player.name || `Player ${playerIndex + 1}`
      }
    }
    return { emoji: '⚪', color: '#FFFFFF', name: `Player ${playerIndex + 1}` }
  }

  const player1Style = getPlayerStyle(0)
  const player2Style = getPlayerStyle(1)

  const { width, height } = dimensions
  const isPlayer1 = playerNumberRef.current === 1

  return (
    <div className="bg-black" style={{ 
      width: '100vw', 
      height: '100vh', 
      position: 'absolute', 
      top: 0, 
      left: 0, 
      right: 0, 
      bottom: 0,
      paddingTop: '10vh',
      paddingBottom: '15vh',
      overflow: 'visible',
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      {error && (
        <div 
          className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 border rounded-xl px-large py-medium text-white text-center max-w-md backdrop-blur-xl"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.8)',
            borderColor: 'rgba(255, 255, 255, 0.3)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
          }}
        >
          <div className="font-bold mb-2">Error</div>
          <div>{error}</div>
          <button
            onClick={() => {
              setError(null)
              if (onLeave) {
                onLeave()
              }
            }}
            className="mt-3 px-medium py-small text-sm border rounded-lg hover:bg-white hover:text-red-600 transition-all duration-300 cursor-pointer font-medium"
            style={{
              borderColor: 'rgba(255, 255, 255, 0.3)'
            }}
          >
            Close
          </button>
        </div>
      )}

      <div className="flex flex-col items-center justify-center w-full px-2">
        <div
          ref={gameAreaRef}
          className="relative border-2 border-white bg-black overflow-hidden game-area"
          style={{ 
            width, 
            height,
            maxWidth: '100%',
            touchAction: 'none'
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
        {/* Score Display - Where each player is on the board */}
        {gameState === 'playing' && (
          <>
            {/* Player 1 (snake1, left side) score - on left side, vertically centered */}
            <div 
              className="absolute left-2 top-1/2 z-20"
              style={{
                transform: `translateY(-50%) ${scorePulse ? 'scale(1.15)' : 'scale(1)'}`,
                transition: 'transform 0.3s ease'
              }}
            >
              <div 
                className="text-4xl sm:text-5xl font-bold"
                style={{ color: player1Style.color, textShadow: '0 4px 12px rgba(0, 0, 0, 0.9)' }}
              >
                {score1}
              </div>
            </div>
            {/* Player 2 (snake2, right side) score - on right side, vertically centered */}
            <div 
              className="absolute right-2 top-1/2 z-20"
              style={{
                transform: `translateY(-50%) ${scorePulse ? 'scale(1.15)' : 'scale(1)'}`,
                transition: 'transform 0.3s ease'
              }}
            >
              <div 
                className="text-4xl sm:text-5xl font-bold"
                style={{ color: player2Style.color, textShadow: '0 4px 12px rgba(0, 0, 0, 0.9)' }}
              >
                {score2}
              </div>
            </div>
          </>
        )}
          {/* Grid background */}
          <div 
            className="absolute inset-0"
            style={{
              backgroundImage: `
                linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px)
              `,
              backgroundSize: `${CELL_SIZE}px ${CELL_SIZE}px`
            }}
          />

          {/* Food */}
          <div
            className="absolute bg-white rounded-sm"
            style={{
              left: food.x * CELL_SIZE,
              top: food.y * CELL_SIZE,
              width: CELL_SIZE - 2,
              height: CELL_SIZE - 2,
              boxShadow: '0 0 8px rgba(255, 255, 255, 0.6)'
            }}
          />

          {/* Snake 1 */}
          {snake1.map((segment, index) => (
            <div
              key={`snake1-${index}`}
              className="absolute rounded-sm"
              style={{
                left: segment.x * CELL_SIZE,
                top: segment.y * CELL_SIZE,
                width: CELL_SIZE - 2,
                height: CELL_SIZE - 2,
                backgroundColor: index === 0 ? player1Style.color : `${player1Style.color}CC`,
                boxShadow: index === 0 
                  ? `0 0 12px ${player1Style.color}80` 
                  : `0 0 4px ${player1Style.color}40`
              }}
            />
          ))}

          {/* Snake 2 */}
          {snake2.map((segment, index) => (
            <div
              key={`snake2-${index}`}
              className="absolute rounded-sm"
              style={{
                left: segment.x * CELL_SIZE,
                top: segment.y * CELL_SIZE,
                width: CELL_SIZE - 2,
                height: CELL_SIZE - 2,
                backgroundColor: index === 0 ? player2Style.color : `${player2Style.color}CC`,
                boxShadow: index === 0 
                  ? `0 0 12px ${player2Style.color}80` 
                  : `0 0 4px ${player2Style.color}40`
              }}
            />
          ))}

          {/* Waiting Screen */}
          {gameState === 'waiting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-80">
              <h1 className="text-2xl md:text-4xl font-bold mb-4 text-center px-4">SNAKE</h1>
              <p className="text-sm md:text-lg mb-2 text-center px-4">Waiting for players...</p>
              <p className="text-xs text-white/60 mb-3">
                {players.length}/2 players
              </p>
              {isHost && (
                <button
                  onClick={startGame}
                  className="px-3 py-1.5 text-sm font-bold text-white border rounded-lg hover:bg-white hover:text-black transition-all duration-300 cursor-pointer hover:scale-105 hover:shadow-lg hover:shadow-white/10"
                  style={{
                    borderColor: 'rgba(255, 255, 255, 0.3)',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(12px)',
                    boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
                  }}
                >
                  Start Game
                </button>
              )}
              {!isHost && (
                <p className="text-xs text-white/60">Waiting for host to start...</p>
              )}
            </div>
          )}

          {/* Game Over Screen */}
          {gameState === 'gameover' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-90">
              <h2 className="text-2xl md:text-3xl font-bold mb-4 text-center px-4">Game Over</h2>
              <p className="text-lg md:text-xl mb-2 text-center px-4">
                Score: {isPlayer1 ? score1 : score2} - {isPlayer1 ? score2 : score1}
              </p>
              {isHost && (
                <button
                  onClick={() => {
                    soundManager.playSelect()
                    gameStateRef.current = 'waiting'
                    setGameState('waiting')
                    setScore1(0)
                    setScore2(0)
                    score1Ref.current = 0
                    score2Ref.current = 0
                    
                    if (roomId) {
                      emitGameState(roomId, {
                        state: 'waiting',
                        snake1: snake1Ref.current,
                        snake2: snake2Ref.current,
                        direction1: { x: 1, y: 0 },
                        direction2: { x: -1, y: 0 },
                        food: foodRef.current,
                        score1: 0,
                        score2: 0
                      })
                    }
                  }}
                  className="px-large py-medium text-lg font-bold text-white border rounded-xl hover:bg-white hover:text-black transition-all duration-300 cursor-pointer hover:scale-105 hover:shadow-lg hover:shadow-white/10"
                  style={{
                    borderColor: 'rgba(255, 255, 255, 0.3)',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(12px)',
                    boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
                  }}
                >
                  Play Again
                </button>
              )}
            </div>
          )}
        </div>
      </div>

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

export default Snake
