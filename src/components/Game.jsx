import { useState, useEffect, useRef, useCallback } from 'react'
import soundManager from '../utils/sounds'

// Responsive game dimensions
const getGameDimensions = () => {
  const isMobile = window.innerWidth < 768
  const maxWidth = isMobile ? window.innerWidth - 20 : 400
  const aspectRatio = 600 / 400
  return {
    width: maxWidth,
    height: maxWidth * aspectRatio,
    isMobile
  }
}

const GRAVITY = 0.25
const JUMP_STRENGTH = -6
const PIPE_SPEED = 2
const PIPE_SPACING = 200

function Game() {
  const [dimensions, setDimensions] = useState(getGameDimensions())
  const [gameState, setGameState] = useState('start') // 'start', 'playing', 'gameover'
  const [kiwiY, setKiwiY] = useState(dimensions.height / 2)
  const [kiwiVelocity, setKiwiVelocity] = useState(0)
  const [pipes, setPipes] = useState([])
  const [score, setScore] = useState(0)
  
  // Calculate responsive constants
  const GAME_WIDTH = dimensions.width
  const GAME_HEIGHT = dimensions.height
  const PIPE_WIDTH = Math.max(30, GAME_WIDTH * 0.1)
  const PIPE_GAP = GAME_HEIGHT * 0.33
  const KIWI_SIZE = Math.max(20, GAME_WIDTH * 0.075)
  const KIWI_X = GAME_WIDTH * 0.125
  
  const gameLoopRef = useRef(null)
  const lastPipeXRef = useRef(GAME_WIDTH)
  const passedPipesRef = useRef(new Set())
  const gameStateRef = useRef('start')
  const kiwiYRef = useRef(GAME_HEIGHT / 2)
  const kiwiVelocityRef = useRef(0)
  const pipesRef = useRef([])
  
  // Update dimensions on resize
  useEffect(() => {
    const handleResize = () => {
      setDimensions(getGameDimensions())
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const jump = useCallback(() => {
    const currentHeight = dimensions.height
    const currentWidth = dimensions.width
    if (gameStateRef.current === 'start') {
      gameStateRef.current = 'playing'
      setGameState('playing')
      kiwiYRef.current = currentHeight / 2
      setKiwiY(currentHeight / 2)
      kiwiVelocityRef.current = JUMP_STRENGTH
      setKiwiVelocity(JUMP_STRENGTH)
      pipesRef.current = []
      setPipes([])
      setScore(0)
      passedPipesRef.current = new Set()
      lastPipeXRef.current = currentWidth
      soundManager.playJump()
    } else if (gameStateRef.current === 'playing') {
      kiwiVelocityRef.current = JUMP_STRENGTH
      setKiwiVelocity(JUMP_STRENGTH)
      soundManager.playJump()
    } else if (gameStateRef.current === 'gameover') {
      gameStateRef.current = 'start'
      setGameState('start')
    }
  }, [dimensions])

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        jump()
      }
    }

    const handleClick = (e) => {
      // Only handle clicks on the game area, not on UI elements
      if (e.target.closest('.game-area')) {
        jump()
      }
    }

    const handleTouchStart = (e) => {
      e.preventDefault()
      jump()
    }

    window.addEventListener('keydown', handleKeyPress)
    window.addEventListener('click', handleClick)
    window.addEventListener('touchstart', handleTouchStart, { passive: false })

    return () => {
      window.removeEventListener('keydown', handleKeyPress)
      window.removeEventListener('click', handleClick)
      window.removeEventListener('touchstart', handleTouchStart)
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

  useEffect(() => {
    if (gameState !== 'playing') return

    const gameLoop = () => {
      if (gameStateRef.current !== 'playing') return

      const currentWidth = dimensions.width
      const currentHeight = dimensions.height
      const pipeWidth = Math.max(30, currentWidth * 0.1)
      const pipeGap = currentHeight * 0.33
      const kiwiSize = Math.max(20, currentWidth * 0.075)
      const kiwiX = currentWidth * 0.125

      // Update kiwi physics
      kiwiVelocityRef.current += GRAVITY
      kiwiYRef.current += kiwiVelocityRef.current
      
      // Check ground/ceiling collision
      if (kiwiYRef.current < 0 || kiwiYRef.current > currentHeight - kiwiSize) {
        gameStateRef.current = 'gameover'
        setGameState('gameover')
        soundManager.playCollision()
        return
      }

      setKiwiY(kiwiYRef.current)
      setKiwiVelocity(kiwiVelocityRef.current)

      // Update pipes
      let newPipes = [...pipesRef.current]
      
      // Add new pipe if needed
      if (lastPipeXRef.current > currentWidth - PIPE_SPACING) {
        const pipeHeight = Math.random() * (currentHeight - pipeGap - 100) + 50
        newPipes.push({
          id: Date.now(),
          x: currentWidth,
          topHeight: pipeHeight,
          bottomY: pipeHeight + pipeGap,
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
        .filter((pipe) => pipe.x > -pipeWidth)

      // Update score
      newPipes.forEach((pipe) => {
        if (pipe.x + pipeWidth < kiwiX && !passedPipesRef.current.has(pipe.id)) {
          passedPipesRef.current.add(pipe.id)
          setScore((prev) => prev + 1)
          soundManager.playScore()
        }
      })

      // Check collisions
      newPipes.forEach((pipe) => {
        // Check if kiwi is in pipe's x range
        if (
          kiwiX < pipe.x + pipeWidth &&
          kiwiX + kiwiSize > pipe.x
        ) {
          // Check top or bottom pipe collision
          if (kiwiYRef.current < pipe.topHeight || kiwiYRef.current + kiwiSize > pipe.bottomY) {
            gameStateRef.current = 'gameover'
            setGameState('gameover')
            soundManager.playCollision()
            setTimeout(() => soundManager.playGameOver(), 100)
          }
        }
      })

      pipesRef.current = newPipes
      setPipes(newPipes)

      gameLoopRef.current = requestAnimationFrame(gameLoop)
    }

    gameLoopRef.current = requestAnimationFrame(gameLoop)

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current)
      }
    }
  }, [gameState, dimensions])

  return (
    <div className="flex flex-col items-center justify-center w-full px-2 pt-20 sm:pt-24">
      <div
        className="relative border-2 border-white bg-black overflow-hidden game-area"
        style={{ 
          width: GAME_WIDTH, 
          height: GAME_HEIGHT,
          maxWidth: '100%',
          touchAction: 'none'
        }}
      >
        {/* Kiwi Bird */}
        <div
          className="absolute bg-white rounded-full transition-transform duration-75"
          style={{
            left: GAME_WIDTH * 0.125,
            top: kiwiY,
            width: Math.max(20, GAME_WIDTH * 0.075),
            height: Math.max(20, GAME_WIDTH * 0.075),
            transform: `rotate(${gameState === 'playing' ? Math.min(kiwiVelocity * 3, 30) : 0}deg)`,
          }}
        >
          {/* Simple kiwi face */}
          <div className="absolute top-2 left-2 w-2 h-2 bg-black rounded-full"></div>
          <div className="absolute top-2 right-2 w-2 h-2 bg-black rounded-full"></div>
        </div>

        {/* Pipes */}
        {pipes.map((pipe) => {
          const pipeWidth = Math.max(30, GAME_WIDTH * 0.1)
          return (
            <div key={pipe.id}>
              {/* Top pipe */}
              <div
                className="absolute bg-white"
                style={{
                  left: pipe.x,
                  top: 0,
                  width: pipeWidth,
                  height: pipe.topHeight,
                }}
              />
              {/* Bottom pipe */}
              <div
                className="absolute bg-white"
                style={{
                  left: pipe.x,
                  top: pipe.bottomY,
                  width: pipeWidth,
                  height: GAME_HEIGHT - pipe.bottomY,
                }}
              />
            </div>
          )
        })}

        {/* Score */}
        {gameState === 'playing' && (
          <div className="absolute top-2 md:top-4 left-1/2 transform -translate-x-1/2 text-white text-xl md:text-2xl font-bold">
            {score}
          </div>
        )}

        {/* Start Screen */}
        {gameState === 'start' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-80">
            <h1 className="text-2xl md:text-4xl font-bold mb-4 text-center px-4">Multiplayer Arcade</h1>
            <p className="text-sm md:text-lg mb-2 text-center px-4">Tap or press SPACE to start</p>
            <p className="text-xs md:text-sm text-gray-400 text-center px-4">Keep flying!</p>
          </div>
        )}

        {/* Game Over Screen */}
        {gameState === 'gameover' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-90">
            <h2 className="text-2xl md:text-3xl font-bold mb-4 text-center px-4">Game Over</h2>
            <p className="text-lg md:text-xl mb-2 text-center px-4">Score: {score}</p>
            <p className="text-xs md:text-sm text-gray-400 text-center px-4">Tap or press SPACE to restart</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default Game

