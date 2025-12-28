import { useState, useEffect, useRef, useCallback } from 'react'
import { getSocket } from '../utils/socket'
import { getCurrentProfile } from '../utils/profiles'
import { isCPUProfile, cpuShouldSucceed } from '../utils/cpuPlayer'
import { useRoom } from '../multiplayer/RoomProvider'
import { emitPaddleMove, emitGameStart, emitGameState, subscribeToPongEvents } from '../games/pong/network'
import soundManager from '../utils/sounds'
import Notification from './Notification'

const GAME_WIDTH = 400
const GAME_HEIGHT = 600
const PADDLE_WIDTH = 80  // Swapped for vertical gameplay
const PADDLE_HEIGHT = 10  // Swapped for vertical gameplay
const BALL_SIZE = 12
const PADDLE_SPEED = 5
const BALL_SPEED = 4
const WIN_SCORE = 5

function Pong({ roomId, isHost: propIsHost, onLeave, onRoomCreated, playerName, onScoreUpdate, onScorePulse }) {
  // Get room state from multiplayer foundation (room-snapshot is source of truth)
  const roomState = useRoom(roomId)
  const [currentProfile, setCurrentProfile] = useState(null)
  
  // Derive values from room state
  const players = roomState.players || []
  const hostUserProfileId = roomState.hostUserProfileId
  const isHost = currentProfile?.id ? roomState.isHost(currentProfile.id) : propIsHost || false
  
  const [gameState, setGameState] = useState('waiting') // waiting, playing, paused, gameover
  const [topPaddleX, setTopPaddleX] = useState(GAME_WIDTH / 2 - PADDLE_WIDTH / 2) // Top paddle (was left)
  const [bottomPaddleX, setBottomPaddleX] = useState(GAME_WIDTH / 2 - PADDLE_WIDTH / 2) // Bottom paddle (was right)
  const [ballX, setBallX] = useState(GAME_WIDTH / 2)
  const [ballY, setBallY] = useState(GAME_HEIGHT / 2)
  const [ballVelX, setBallVelX] = useState(0) // Horizontal velocity (sideways movement)
  const [ballVelY, setBallVelY] = useState(BALL_SPEED) // Vertical velocity (main movement)
  const [leftScore, setLeftScore] = useState(0)
  const [rightScore, setRightScore] = useState(0)
  const [error, setError] = useState(null)
  const [notification, setNotification] = useState(null)
  const [ballHitFlash, setBallHitFlash] = useState(false)
  const [paddleHitFlash, setPaddleHitFlash] = useState({ top: false, bottom: false })
  const [scorePulse, setScorePulse] = useState(false)
  const [showTouchAreaAnimation, setShowTouchAreaAnimation] = useState(false)
  const [countdown, setCountdown] = useState(null)
  const [goalFlash, setGoalFlash] = useState(false)
  const [goalFlashColor, setGoalFlashColor] = useState('#FFFFFF')
  const [isResetting, setIsResetting] = useState(false)
  const [resetMessage, setResetMessage] = useState(null)
  const [ballExploding, setBallExploding] = useState(false)
  const [ballVisible, setBallVisible] = useState(true)
  const [winnerUserProfileId, setWinnerUserProfileId] = useState(null)
  const [loserUserProfileId, setLoserUserProfileId] = useState(null)
  const [screenShake, setScreenShake] = useState(false)
  const [screenFlash, setScreenFlash] = useState(false)
  const [screenFlashColor, setScreenFlashColor] = useState('#FFFFFF')
  const [paddleRipple, setPaddleRipple] = useState({ top: null, bottom: null })
  const [lastPaddleX, setLastPaddleX] = useState({ top: GAME_WIDTH / 2 - PADDLE_WIDTH / 2, bottom: GAME_WIDTH / 2 - PADDLE_WIDTH / 2 })
  const [ballSpeed, setBallSpeed] = useState(0)
  const [gameStartTime, setGameStartTime] = useState(null)
  const touchStartXRef = useRef(null)
  const touchStartPaddleXRef = useRef(null)
  const isDraggingRef = useRef(false)
  const isMouseInControlAreaRef = useRef(false)
  const lastPaddleMoveEmitRef = useRef(0)
  const PADDLE_MOVE_THROTTLE_MS = 16 // ~60 Hz for paddle updates
  
  const socketRef = useRef(null)
  const gameLoopRef = useRef(null)
  const gameStateRef = useRef('waiting')
  const topPaddleXRef = useRef(GAME_WIDTH / 2 - PADDLE_WIDTH / 2)
  const bottomPaddleXRef = useRef(GAME_WIDTH / 2 - PADDLE_WIDTH / 2)
  const ballXRef = useRef(GAME_WIDTH / 2)
  const ballYRef = useRef(GAME_HEIGHT / 2)
  const ballVelXRef = useRef(0) // Horizontal velocity
  const ballVelYRef = useRef(BALL_SPEED) // Vertical velocity (main movement)
  const leftScoreRef = useRef(0)
  const rightScoreRef = useRef(0)
  const playerNumberRef = useRef(1) // Will be determined from players array
  const moveSequenceRef = useRef(0)
  const socketInitializedRef = useRef(false)
  const sessionIdRef = useRef(`pong-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`)
  const lastBroadcastTimeRef = useRef(0)
  const BROADCAST_THROTTLE_MS = 33 // ~30 Hz (33ms = 30 updates per second)
  const lastPaddleHitRef = useRef(false) // Track if we've already played sound for this paddle hit
  const lastWallHitRef = useRef(false) // Track if we've already played sound for this wall hit
  const lastStateUpdateTimeRef = useRef(0)
  const STATE_UPDATE_THROTTLE_MS = 33 // Throttle state updates to ~30fps for mobile performance
  const ballElementRef = useRef(null)
  const topPaddleElementRef = useRef(null)
  const bottomPaddleElementRef = useRef(null)
  const lastBallVelXRef = useRef(0) // Track previous ball velocity X for non-host sound detection
  const lastBallVelYRef = useRef(0) // Track previous ball velocity Y for non-host sound detection
  const lastBallXRef = useRef(GAME_WIDTH / 2) // Track previous ball X for non-host sound detection
  const lastBallYRef = useRef(GAME_HEIGHT / 2) // Track previous ball Y for non-host sound detection
  
  const [isCPU, setIsCPU] = useState(false)

  // Load current profile to get userProfileId
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const profile = await getCurrentProfile()
        setCurrentProfile(profile)
        setIsCPU(isCPUProfile(profile))
      } catch (err) {
        console.error('[Pong] Error loading profile:', err)
      }
    }
    loadProfile()
  }, [])
  
  // Determine player number based on position in players array (using userProfileId)
  useEffect(() => {
    if (currentProfile?.id && players.length > 0) {
      const myIndex = players.findIndex(p => p.userProfileId && String(p.userProfileId) === String(currentProfile.id))
      // First player (index 0) is player 1 (left), second player (index 1) is player 2 (right)
      playerNumberRef.current = myIndex >= 0 ? myIndex + 1 : 1
    } else if (isHost) {
      // Fallback: host is player 1
      playerNumberRef.current = 1
    }
  }, [currentProfile?.id, players, isHost])
  
  // Determine which side this player is on
  const isLeftPlayer = playerNumberRef.current === 1
  const isRightPlayer = playerNumberRef.current === 2
  
  // Determine if we should flip the view (player 1 sees their paddle at bottom)
  const shouldFlipView = playerNumberRef.current === 1
  
  // Helper function to flip Y coordinate
  const flipY = (y) => {
    if (!shouldFlipView) return y
    return GAME_HEIGHT - y
  }
  
  // Helper function to get display coordinates for ball
  const getDisplayBallY = () => {
    return shouldFlipView ? GAME_HEIGHT - ballY - BALL_SIZE : ballY
  }
  
  // Helper function to get display paddle positions
  const getDisplayPaddlePositions = () => {
    if (shouldFlipView) {
      // Swap paddles: top becomes bottom, bottom becomes top
      return {
        myPaddleX: topPaddleX, // Player 1's paddle (was top, now bottom)
        opponentPaddleX: bottomPaddleX, // Player 2's paddle (was bottom, now top)
        myPaddleTop: false, // My paddle is at bottom
        opponentPaddleTop: true // Opponent paddle is at top
      }
    } else {
      // Normal view: player 2's paddle is at bottom
      return {
        myPaddleX: bottomPaddleX, // Player 2's paddle (at bottom)
        opponentPaddleX: topPaddleX, // Player 1's paddle (at top)
        myPaddleTop: false, // My paddle is at bottom
        opponentPaddleTop: true // Opponent paddle is at top
      }
    }
  }
  
  // Helper function to get display scores (swap if flipped)
  const getDisplayScores = () => {
    if (shouldFlipView) {
      return {
        myScore: leftScore, // Player 1's score
        opponentScore: rightScore // Player 2's score
      }
    } else {
      return {
        myScore: rightScore, // Player 2's score
        opponentScore: leftScore // Player 1's score
      }
    }
  }
  
  const displayPaddles = getDisplayPaddlePositions()
  const displayScores = getDisplayScores()

  // Send logs to server for debugging
  const sendLogToServer = async (message, level = 'info') => {
    const logEntry = {
      message,
      level,
      timestamp: new Date().toISOString(),
      source: 'Pong',
      socketId: socketRef.current?.id || null,
      roomId: roomId || null,
      isHost: isHost || false,
      playerNumber: playerNumberRef.current
    }

    try {
      const serverUrl = `http://${window.location.hostname}:8000`
      await fetch(`${serverUrl}/api/debug/client-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logs: [logEntry],
          sessionId: sessionIdRef.current
        })
      })
    } catch (error) {
      // Silently fail - don't break the UI if server logging fails
    }
  }

  // Initialize Pong networking (use pong/network.js)
  useEffect(() => {
    if (!roomId || socketInitializedRef.current) return

    sendLogToServer(`Initializing Pong socket connection for room ${roomId} (Player ${playerNumberRef.current}, ${isHost ? 'Host' : 'Joining'})`)

    // Get shared socket connection
    const socket = getSocket()
    socketRef.current = socket
    socketInitializedRef.current = true

    // Subscribe to Pong game events via network layer
    const cleanup = subscribeToPongEvents({
      onGameStart: ({ gameState: startGameState }) => {
        sendLogToServer(`Received pong-game-start event`, 'info')
        if (!isHost && startGameState) {
          // Non-host receives game start - show countdown
          sendLogToServer(`Starting game as joining player`, 'info')
          setGameState('countdown')
          gameStateRef.current = 'countdown'
          setCountdown(3)
          
          const countdownInterval = setInterval(() => {
            setCountdown(prev => {
              if (prev <= 1) {
                clearInterval(countdownInterval)
                gameStateRef.current = 'playing'
                setGameState('playing')
                
                // Show touch control area animation
                setShowTouchAreaAnimation(true)
                setTimeout(() => {
                  setShowTouchAreaAnimation(false)
                }, 2500) // Show for 2.5 seconds
                
                return null
              }
              soundManager.playSelect()
              return prev - 1
            })
          }, 1000)
          
          if (startGameState.topPaddleX !== undefined) {
            setTopPaddleX(startGameState.topPaddleX)
            topPaddleXRef.current = startGameState.topPaddleX
          }
          if (startGameState.bottomPaddleX !== undefined) {
            setBottomPaddleX(startGameState.bottomPaddleX)
            bottomPaddleXRef.current = startGameState.bottomPaddleX
          }
          if (startGameState.ballX !== undefined) {
            setBallX(startGameState.ballX)
            ballXRef.current = startGameState.ballX
          }
          if (startGameState.ballY !== undefined) {
            setBallY(startGameState.ballY)
            ballYRef.current = startGameState.ballY
          }
          if (startGameState.ballVelX !== undefined) {
            setBallVelX(startGameState.ballVelX)
            ballVelXRef.current = startGameState.ballVelX
          }
          if (startGameState.ballVelY !== undefined) {
            setBallVelY(startGameState.ballVelY)
            ballVelYRef.current = startGameState.ballVelY
          }
          if (startGameState.leftScore !== undefined) {
            setLeftScore(startGameState.leftScore)
            leftScoreRef.current = startGameState.leftScore
          }
          if (startGameState.rightScore !== undefined) {
            setRightScore(startGameState.rightScore)
            rightScoreRef.current = startGameState.rightScore
          }
        }
      },
      onGameState: (gameState) => {
        const frameCount = moveSequenceRef.current
        if (frameCount % 60 === 0) { // Log every 60 frames to avoid spam
          sendLogToServer(`Received game state update from host`, 'debug')
        }
        if (!isHost) {
          // Check for score changes to trigger explosion effect
          const leftScoreChanged = gameState.leftScore !== undefined && gameState.leftScore !== leftScoreRef.current
          const rightScoreChanged = gameState.rightScore !== undefined && gameState.rightScore !== rightScoreRef.current
          
          if (leftScoreChanged) {
            // Score changed - trigger explosion and sounds
            const leftStyle = getPlayerStyle(0)
            setGoalFlash(true)
            setGoalFlashColor(leftStyle.color)
            setBallExploding(true)
            setBallVisible(false)
            setIsResetting(true)
            
            // Play score sound
            soundManager.playScore()
            
            // Set ball to center position for explosion
            setBallX(GAME_WIDTH / 2)
            setBallY(GAME_HEIGHT / 2)
            ballXRef.current = GAME_WIDTH / 2
            ballYRef.current = GAME_HEIGHT / 2
            
            setTimeout(() => {
              setGoalFlash(false)
              setBallExploding(false)
            }, 600)
            
            // Ball will reappear after reset period
            setTimeout(() => {
              setBallVisible(true)
              setIsResetting(false)
            }, 1000)
          }
          
          if (rightScoreChanged) {
            // Score changed - trigger explosion and sounds
            const rightStyle = getPlayerStyle(1)
            setGoalFlash(true)
            setGoalFlashColor(rightStyle.color)
            setBallExploding(true)
            setBallVisible(false)
            setIsResetting(true)
            
            // Play score sound
            soundManager.playScore()
            
            // Set ball to center position for explosion
            setBallX(GAME_WIDTH / 2)
            setBallY(GAME_HEIGHT / 2)
            ballXRef.current = GAME_WIDTH / 2
            ballYRef.current = GAME_HEIGHT / 2
            
            setTimeout(() => {
              setGoalFlash(false)
              setBallExploding(false)
            }, 600)
            
            // Ball will reappear after reset period
            setTimeout(() => {
              setBallVisible(true)
              setIsResetting(false)
            }, 1000)
          }
          
          // Non-host receives state updates
          if (gameState.topPaddleX !== undefined) {
            setTopPaddleX(gameState.topPaddleX)
            topPaddleXRef.current = gameState.topPaddleX
          }
          if (gameState.bottomPaddleX !== undefined) {
            setBottomPaddleX(gameState.bottomPaddleX)
            bottomPaddleXRef.current = gameState.bottomPaddleX
          }
          if (gameState.ballX !== undefined) {
            setBallX(gameState.ballX)
            ballXRef.current = gameState.ballX
            lastBallXRef.current = gameState.ballX
          }
          if (gameState.ballY !== undefined) {
            setBallY(gameState.ballY)
            ballYRef.current = gameState.ballY
            lastBallYRef.current = gameState.ballY
          }
          if (gameState.ballVelX !== undefined) {
            // Detect wall bounce (X velocity changes sign)
            if (lastBallVelXRef.current !== 0 && 
                gameState.ballVelX !== 0 && 
                Math.sign(lastBallVelXRef.current) !== Math.sign(gameState.ballVelX) &&
                !lastWallHitRef.current) {
              soundManager.playWallBounce(1)
              lastWallHitRef.current = true
              setTimeout(() => {
                lastWallHitRef.current = false
              }, 100)
            }
            setBallVelX(gameState.ballVelX)
            ballVelXRef.current = gameState.ballVelX
            lastBallVelXRef.current = gameState.ballVelX
          }
          if (gameState.ballVelY !== undefined) {
            // Detect paddle collision (Y velocity changes sign and ball is near paddle)
            const currentBallY = gameState.ballY !== undefined ? gameState.ballY : lastBallYRef.current
            const nearTopPaddle = currentBallY <= PADDLE_HEIGHT + 5
            const nearBottomPaddle = currentBallY >= GAME_HEIGHT - PADDLE_HEIGHT - 5
            
            if (lastBallVelYRef.current !== 0 && 
                gameState.ballVelY !== 0 && 
                Math.sign(lastBallVelYRef.current) !== Math.sign(gameState.ballVelY) &&
                (nearTopPaddle || nearBottomPaddle) &&
                !lastPaddleHitRef.current) {
              soundManager.playCollision()
              lastPaddleHitRef.current = true
              // Trigger hit flash effects
              setBallHitFlash(true)
              if (nearTopPaddle) {
                setPaddleHitFlash(prev => ({ ...prev, top: true }))
                setPaddleRipple(prev => ({ ...prev, top: { x: gameState.ballX || lastBallXRef.current, y: PADDLE_HEIGHT } }))
                setScreenShake(true)
                setTimeout(() => setScreenShake(false), 200)
                setTimeout(() => setPaddleHitFlash(prev => ({ ...prev, top: false })), 150)
                setTimeout(() => setPaddleRipple(prev => ({ ...prev, top: null })), 300)
              } else {
                setPaddleHitFlash(prev => ({ ...prev, bottom: true }))
                setPaddleRipple(prev => ({ ...prev, bottom: { x: gameState.ballX || lastBallXRef.current, y: GAME_HEIGHT - PADDLE_HEIGHT } }))
                setScreenShake(true)
                setTimeout(() => setScreenShake(false), 200)
                setTimeout(() => setPaddleHitFlash(prev => ({ ...prev, bottom: false })), 150)
                setTimeout(() => setPaddleRipple(prev => ({ ...prev, bottom: null })), 300)
              }
              setTimeout(() => {
                setBallHitFlash(false)
                lastPaddleHitRef.current = false
              }, 100)
            }
            
            setBallVelY(gameState.ballVelY)
            ballVelYRef.current = gameState.ballVelY
            lastBallVelYRef.current = gameState.ballVelY
            
            // If ball starts moving again after reset, make sure it's visible
            if (gameState.ballVelY !== 0 && isResetting && !leftScoreChanged && !rightScoreChanged) {
              setBallVisible(true)
              setIsResetting(false)
            }
          }
          // Always update scores (important for gameover state to show final score)
          if (gameState.leftScore !== undefined) {
            setLeftScore(gameState.leftScore)
            leftScoreRef.current = gameState.leftScore
          }
          if (gameState.rightScore !== undefined) {
            setRightScore(gameState.rightScore)
            rightScoreRef.current = gameState.rightScore
          }
          // Update game state (including gameover)
          if (gameState.state && gameState.state !== gameStateRef.current) {
            setGameState(gameState.state)
            gameStateRef.current = gameState.state
            // Play game over sound if transitioning to gameover
            if (gameState.state === 'gameover') {
              soundManager.playGameOver()
              
              // Track winner and loser for rotation (non-host also needs this)
              // Determine winner based on final scores
              const finalLeftScore = gameState.leftScore !== undefined ? gameState.leftScore : leftScoreRef.current
              const finalRightScore = gameState.rightScore !== undefined ? gameState.rightScore : rightScoreRef.current
              
              if (finalLeftScore >= WIN_SCORE) {
                // Player 1 (left/top) wins
                const winnerPlayer = players[0]
                const loserPlayer = players[1]
                if (winnerPlayer?.userProfileId && loserPlayer?.userProfileId) {
                  setWinnerUserProfileId(winnerPlayer.userProfileId)
                  setLoserUserProfileId(loserPlayer.userProfileId)
                  
                  // Record win in database
                  const serverUrl = `http://${window.location.hostname}:8000`
                  fetch(`${serverUrl}/api/wins/record`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      userProfileId: winnerPlayer.userProfileId,
                      gameType: 'pong'
                    })
                  }).catch(err => console.error('[Pong] Error recording win:', err))
                }
              } else if (finalRightScore >= WIN_SCORE) {
                // Player 2 (right/bottom) wins
                const winnerPlayer = players[1]
                const loserPlayer = players[0]
                if (winnerPlayer?.userProfileId && loserPlayer?.userProfileId) {
                  setWinnerUserProfileId(winnerPlayer.userProfileId)
                  setLoserUserProfileId(loserPlayer.userProfileId)
                  
                  // Record win in database
                  const serverUrl = `http://${window.location.hostname}:8000`
                  fetch(`${serverUrl}/api/wins/record`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      userProfileId: winnerPlayer.userProfileId,
                      gameType: 'pong'
                    })
                  }).catch(err => console.error('[Pong] Error recording win:', err))
                }
              }
            }
          }
          
          // Reset wall hit detection when ball moves away from walls
          if (gameState.ballX !== undefined) {
            const nearLeftWall = gameState.ballX > 5
            const nearRightWall = gameState.ballX < GAME_WIDTH - BALL_SIZE - 5
            if (nearLeftWall && nearRightWall) {
              lastWallHitRef.current = false
            }
          }
        }
      },
      onPaddleMove: ({ playerNumber: movePlayerNumber, paddleX }) => {
        sendLogToServer(`Received paddle move from player ${movePlayerNumber}: x=${paddleX}`, 'debug')
        // Update paddle position for both host and non-host
        // Host needs to see other player's paddle moves too
        if (movePlayerNumber === 1) {
          setTopPaddleX(paddleX)
          topPaddleXRef.current = paddleX
        } else if (movePlayerNumber === 2) {
          setBottomPaddleX(paddleX)
          bottomPaddleXRef.current = paddleX
        }
      }
    })

    // Listen for player rotation completion
    const handlePlayersRotated = ({ winnerUserProfileId: rotatedWinner, loserUserProfileId: rotatedLoser }) => {
      sendLogToServer(`Players rotated: winner ${rotatedWinner}, loser ${rotatedLoser}`, 'info')
      // Player order has changed, but player numbers will be recalculated automatically
      // when players array updates from room snapshot
    }

    socket.on('players-rotated', handlePlayersRotated)

    return () => {
      cleanup()
      socket.off('players-rotated', handlePlayersRotated)
      socketInitializedRef.current = false
    }

    return () => {
      cleanup()
      socketInitializedRef.current = false
    }
  }, [roomId, isHost])

  // Start game when host clicks
  const startGame = useCallback(() => {
    sendLogToServer(`startGame called: state=${gameStateRef.current}, isHost=${isHost}, socket=${socketRef.current?.id}, connected=${socketRef.current?.connected}`, 'info')
    
    if (gameStateRef.current !== 'waiting' || !isHost) {
      sendLogToServer(`Cannot start game: state=${gameStateRef.current}, isHost=${isHost}`, 'warn')
      return
    }
    
    sendLogToServer(`Host starting game`, 'info')
    soundManager.playSelect()
    
    // Reset game start time
    setGameStartTime(Date.now())
    
    // Start countdown
    setGameState('countdown')
    gameStateRef.current = 'countdown'
    setCountdown(3)
    
    const countdownInterval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownInterval)
          gameStateRef.current = 'playing'
          setGameState('playing')
          
          // Show touch control area animation
          setShowTouchAreaAnimation(true)
          setTimeout(() => {
            setShowTouchAreaAnimation(false)
          }, 2500) // Show for 2.5 seconds
          
          return null
        }
        soundManager.playSelect()
        return prev - 1
      })
    }, 1000)
    
    // Reset game state
    const centerX = GAME_WIDTH / 2 - PADDLE_WIDTH / 2
    setTopPaddleX(centerX)
    setBottomPaddleX(centerX)
    setBallX(GAME_WIDTH / 2)
    setBallY(GAME_HEIGHT / 2)
    const initialBallVelX = (Math.random() - 0.5) * 2 // Horizontal velocity (sideways)
    const initialBallVelY = BALL_SPEED * (Math.random() > 0.5 ? 1 : -1) // Vertical velocity (main movement)
    setBallVelX(initialBallVelX)
    setBallVelY(initialBallVelY)
    setLeftScore(0)
    setRightScore(0)
    
    topPaddleXRef.current = centerX
    bottomPaddleXRef.current = centerX
    ballXRef.current = GAME_WIDTH / 2
    ballYRef.current = GAME_HEIGHT / 2
    ballVelXRef.current = initialBallVelX
    ballVelYRef.current = initialBallVelY
    leftScoreRef.current = 0
    rightScoreRef.current = 0
    moveSequenceRef.current = 0
    
    // Broadcast game start to other players via socket
    sendLogToServer(`Checking socket before emit: socket exists=${!!socketRef.current}, connected=${socketRef.current?.connected}, socketId=${socketRef.current?.id}, roomId=${roomId}`, 'info')
    
    if (roomId) {
      const gameStartState = {
        state: 'playing',
        topPaddleX: centerX,
        bottomPaddleX: centerX,
        ballX: GAME_WIDTH / 2,
        ballY: GAME_HEIGHT / 2,
        ballVelX: initialBallVelX,
        ballVelY: initialBallVelY,
        leftScore: 0,
        rightScore: 0
      }
      sendLogToServer(`Emitting pong-game-start to room ${roomId}`, 'info')
      emitGameStart(roomId, gameStartState)
      sendLogToServer(`Emitted pong-game-start event`, 'info')
    } else {
      sendLogToServer(`Cannot emit game start: roomId=${roomId}`, 'error')
    }
  }, [isHost, roomId])

  // Handle paddle movement (horizontal for vertical gameplay)
  const movePaddle = useCallback((direction) => {
    if (gameStateRef.current !== 'playing') {
      sendLogToServer(`Cannot move paddle: game state is ${gameStateRef.current}`, 'debug')
      return
    }
    
    const isTop = playerNumberRef.current === 1
    const currentX = isTop ? topPaddleXRef.current : bottomPaddleXRef.current
    let newX = currentX + (direction * PADDLE_SPEED)
    
    newX = Math.max(0, Math.min(GAME_WIDTH - PADDLE_WIDTH, newX))
    
    if (isTop) {
      setTopPaddleX(newX)
      topPaddleXRef.current = newX
    } else {
      setBottomPaddleX(newX)
      bottomPaddleXRef.current = newX
    }
    
    // Send paddle position update via socket (use pong/network.js)
    if (roomId) {
      sendLogToServer(`Emitting paddle move: player ${playerNumberRef.current}, x=${newX}`, 'debug')
      emitPaddleMove(roomId, playerNumberRef.current, newX)
    } else {
      sendLogToServer(`Cannot emit paddle move: roomId=${roomId}`, 'warn')
    }
  }, [roomId])

  // Keyboard controls (horizontal movement for vertical gameplay)
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (gameStateRef.current === 'waiting' && e.code === 'Space' && isHost) {
        e.preventDefault()
        startGame()
        return
      }
      
      if (gameStateRef.current !== 'playing') return
      
      // All players use left/right arrows or A/D keys for horizontal movement
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        e.preventDefault()
        movePaddle(-1)
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
        e.preventDefault()
        movePaddle(1)
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => {
      window.removeEventListener('keydown', handleKeyPress)
    }
  }, [startGame, movePaddle, isHost])

  // Touch controls for mobile - drag to move paddle
  // Touch control area is the bottom 65% of the screen (wider area)
  const TOUCH_CONTROL_AREA_THRESHOLD = 0.35 // Top 35% is not touchable, bottom 65% is touchable
  
  const handleTouchStart = useCallback((e) => {
    if (gameStateRef.current !== 'playing') return
    
    const touch = e.touches[0]
    const rect = e.currentTarget.getBoundingClientRect()
    const touchX = touch.clientX - rect.left
    const touchY = touch.clientY - rect.top
    
    // User's paddle is always at the bottom from their perspective
    // Touch control area is the bottom 65% of the screen
    const touchThreshold = rect.height * TOUCH_CONTROL_AREA_THRESHOLD
    const isInTouchArea = touchY >= touchThreshold
    
    if (!isInTouchArea) return // Only allow control from bottom 65%
    
    e.preventDefault()
    touchStartXRef.current = touchX
    isDraggingRef.current = true
    
    // Store starting paddle position (always use the paddle that corresponds to current player)
    const isTop = playerNumberRef.current === 1
    touchStartPaddleXRef.current = isTop ? topPaddleXRef.current : bottomPaddleXRef.current
  }, [])

  const handleTouchMove = useCallback((e) => {
    if (!isDraggingRef.current || gameStateRef.current !== 'playing') return
    
    const touch = e.touches[0]
    const rect = e.currentTarget.getBoundingClientRect()
    const touchX = touch.clientX - rect.left
    
    e.preventDefault()
    
    if (touchStartXRef.current === null || touchStartPaddleXRef.current === null) return
    
    // Calculate delta from start position
    const deltaX = touchX - touchStartXRef.current
    const newPaddleX = touchStartPaddleXRef.current + deltaX
    
    // Clamp to bounds
    const clampedX = Math.max(0, Math.min(GAME_WIDTH - PADDLE_WIDTH, newPaddleX))
    
    // Update the paddle that corresponds to current player
    const isTop = playerNumberRef.current === 1
    if (isTop) {
      topPaddleXRef.current = clampedX
      setTopPaddleX(clampedX)
      // Direct DOM update for smoother touch response
      if (topPaddleElementRef.current) {
        topPaddleElementRef.current.style.transform = `translate3d(${clampedX}px, 0, 0)`
      }
    } else {
      bottomPaddleXRef.current = clampedX
      setBottomPaddleX(clampedX)
      // Direct DOM update for smoother touch response
      if (bottomPaddleElementRef.current) {
        bottomPaddleElementRef.current.style.transform = `translate3d(${clampedX}px, 0, 0)`
      }
    }
    
    // Throttle socket emissions to reduce network overhead and improve performance
    const now = Date.now()
    if (roomId && (now - lastPaddleMoveEmitRef.current >= PADDLE_MOVE_THROTTLE_MS)) {
      lastPaddleMoveEmitRef.current = now
      emitPaddleMove(roomId, playerNumberRef.current, clampedX)
    }
  }, [roomId])

  const handleTouchEnd = useCallback((e) => {
    if (!isDraggingRef.current) return
    
    e.preventDefault()
    isDraggingRef.current = false
    touchStartXRef.current = null
    touchStartPaddleXRef.current = null
  }, [])

  // Mouse controls - move paddle by mouse position (no click required)
  const handleMouseMove = useCallback((e) => {
    if (gameStateRef.current !== 'playing') return
    
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    // User's paddle is always at the bottom from their perspective
    // Mouse control area is the bottom 65% of the screen (same as touch)
    const mouseThreshold = rect.height * TOUCH_CONTROL_AREA_THRESHOLD
    const isInControlArea = mouseY >= mouseThreshold
    
    // Track if mouse is in control area
    isMouseInControlAreaRef.current = isInControlArea
    
    if (!isInControlArea) return // Only allow control from bottom 65%
    
    // Calculate paddle position from mouse X (center paddle on mouse)
    const newPaddleX = mouseX - PADDLE_WIDTH / 2
    
    // Clamp to bounds
    const clampedX = Math.max(0, Math.min(GAME_WIDTH - PADDLE_WIDTH, newPaddleX))
    
    // Update the paddle that corresponds to current player
    const isTop = playerNumberRef.current === 1
    if (isTop) {
      topPaddleXRef.current = clampedX
      setTopPaddleX(clampedX)
      // Direct DOM update for smoother mouse response
      if (topPaddleElementRef.current) {
        topPaddleElementRef.current.style.transform = `translate3d(${clampedX}px, 0, 0)`
      }
    } else {
      bottomPaddleXRef.current = clampedX
      setBottomPaddleX(clampedX)
      // Direct DOM update for smoother mouse response
      if (bottomPaddleElementRef.current) {
        bottomPaddleElementRef.current.style.transform = `translate3d(${clampedX}px, 0, 0)`
      }
    }
    
    // Throttle socket emissions to reduce network overhead and improve performance
    const now = Date.now()
    if (roomId && (now - lastPaddleMoveEmitRef.current >= PADDLE_MOVE_THROTTLE_MS)) {
      lastPaddleMoveEmitRef.current = now
      emitPaddleMove(roomId, playerNumberRef.current, clampedX)
    }
  }, [roomId])

  // Handle mouse leave to stop tracking when mouse leaves the game area
  const handleMouseLeave = useCallback((e) => {
    isMouseInControlAreaRef.current = false
  }, [])

  // Sync refs with state
  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])

  // Game loop (only host runs physics)
  useEffect(() => {
    if (gameState !== 'playing' || !isHost) return

    const gameLoop = () => {
      if (gameStateRef.current !== 'playing') return
      if (isResetting) {
        // Continue loop during reset to allow ball animation
        gameLoopRef.current = requestAnimationFrame(gameLoop)
        return
      }

      // Update ball position
      ballXRef.current += ballVelXRef.current
      ballYRef.current += ballVelYRef.current

      // Ball collision with left/right walls (side walls in vertical gameplay)
      if (ballXRef.current <= 0 || ballXRef.current >= GAME_WIDTH - BALL_SIZE) {
        if (!lastWallHitRef.current) {
          soundManager.playWallBounce(1)
          lastWallHitRef.current = true
        }
        ballVelXRef.current = -ballVelXRef.current
        ballXRef.current = Math.max(0, Math.min(GAME_WIDTH - BALL_SIZE, ballXRef.current))
      } else {
        lastWallHitRef.current = false
      }

      // Ball collision with top paddle
      let paddleHit = false
      if (
        ballYRef.current <= PADDLE_HEIGHT &&
        ballYRef.current >= 0 &&
        ballXRef.current + BALL_SIZE >= topPaddleXRef.current &&
        ballXRef.current <= topPaddleXRef.current + PADDLE_WIDTH
      ) {
        if (ballVelYRef.current < 0) {
          if (!lastPaddleHitRef.current) {
            soundManager.playCollision()
            lastPaddleHitRef.current = true
            paddleHit = true
            // Trigger hit flash effects
            setBallHitFlash(true)
            setPaddleHitFlash(prev => ({ ...prev, top: true }))
            setPaddleRipple(prev => ({ ...prev, top: { x: ballXRef.current, y: PADDLE_HEIGHT } }))
            setScreenShake(true)
            setTimeout(() => setScreenShake(false), 200)
            setTimeout(() => setBallHitFlash(false), 100)
            setTimeout(() => setPaddleHitFlash(prev => ({ ...prev, top: false })), 150)
            setTimeout(() => setPaddleRipple(prev => ({ ...prev, top: null })), 300)
          }
          ballVelYRef.current = -ballVelYRef.current
          const hitPos = (ballXRef.current - topPaddleXRef.current) / PADDLE_WIDTH
          ballVelXRef.current = (hitPos - 0.5) * 6
          ballYRef.current = PADDLE_HEIGHT
        }
      }

      // Ball collision with bottom paddle
      if (
        ballYRef.current >= GAME_HEIGHT - PADDLE_HEIGHT - BALL_SIZE &&
        ballYRef.current <= GAME_HEIGHT &&
        ballXRef.current + BALL_SIZE >= bottomPaddleXRef.current &&
        ballXRef.current <= bottomPaddleXRef.current + PADDLE_WIDTH
      ) {
        if (ballVelYRef.current > 0) {
          if (!lastPaddleHitRef.current) {
            soundManager.playCollision()
            lastPaddleHitRef.current = true
            paddleHit = true
            // Trigger hit flash effects
            setBallHitFlash(true)
            setPaddleHitFlash(prev => ({ ...prev, bottom: true }))
            setPaddleRipple(prev => ({ ...prev, bottom: { x: ballXRef.current, y: GAME_HEIGHT - PADDLE_HEIGHT } }))
            setScreenShake(true)
            setTimeout(() => setScreenShake(false), 200)
            setTimeout(() => setBallHitFlash(false), 100)
            setTimeout(() => setPaddleHitFlash(prev => ({ ...prev, bottom: false })), 150)
            setTimeout(() => setPaddleRipple(prev => ({ ...prev, bottom: null })), 300)
          }
          ballVelYRef.current = -ballVelYRef.current
          const hitPos = (ballXRef.current - bottomPaddleXRef.current) / PADDLE_WIDTH
          ballVelXRef.current = (hitPos - 0.5) * 6
          ballYRef.current = GAME_HEIGHT - PADDLE_HEIGHT - BALL_SIZE
        }
      }

      // Reset paddle hit flag when ball is not colliding with either paddle
      if (!paddleHit && ballYRef.current > PADDLE_HEIGHT + 5 && ballYRef.current < GAME_HEIGHT - PADDLE_HEIGHT - BALL_SIZE - 5) {
        lastPaddleHitRef.current = false
      }

      // Ball out of bounds - score (top/bottom boundaries in vertical gameplay)
      if (ballYRef.current < 0) {
        // Ball went off top - bottom player (player 2) scores
        rightScoreRef.current += 1
        setRightScore(rightScoreRef.current)
        // Trigger score pulse animation
        setScorePulse(true)
        if (onScorePulse) onScorePulse(true)
        // Trigger goal flash effect - get player style dynamically
        const rightStyle = getPlayerStyle(1)
        setGoalFlash(true)
        setGoalFlashColor(rightStyle.color)
        setScreenFlash(true)
        setScreenFlashColor(rightStyle.color)
        setTimeout(() => setScreenFlash(false), 300)
        
        // Explode the ball
        setBallExploding(true)
        setBallVisible(false)
        
        setTimeout(() => {
          setScorePulse(false)
          setGoalFlash(false)
          setBallExploding(false)
          if (onScorePulse) onScorePulse(false)
        }, 600)
        
        if (rightScoreRef.current >= WIN_SCORE) {
          gameStateRef.current = 'gameover'
          setGameState('gameover')
          soundManager.playGameOver()
          
          // Track winner and loser for rotation
          // Player 2 (right/bottom) wins, Player 1 (left/top) loses
          const winnerPlayer = players[1] // Player 2 (index 1)
          const loserPlayer = players[0] // Player 1 (index 0)
          if (winnerPlayer?.userProfileId && loserPlayer?.userProfileId) {
            setWinnerUserProfileId(winnerPlayer.userProfileId)
            setLoserUserProfileId(loserPlayer.userProfileId)
            
            // Record win in database
            const serverUrl = `http://${window.location.hostname}:8000`
            fetch(`${serverUrl}/api/wins/record`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userProfileId: winnerPlayer.userProfileId,
                gameType: 'pong'
              })
            }).catch(err => console.error('[Pong] Error recording win:', err))
          }
          
          // Immediately broadcast gameover state with final scores to all players
          if (roomId && isHost) {
            emitGameState(roomId, {
              state: 'gameover',
              topPaddleX: topPaddleXRef.current,
              bottomPaddleX: bottomPaddleXRef.current,
              ballX: ballXRef.current,
              ballY: ballYRef.current,
              ballVelX: ballVelXRef.current,
              ballVelY: ballVelYRef.current,
              leftScore: leftScoreRef.current,
              rightScore: rightScoreRef.current
            })
          }
        } else {
          soundManager.playScore()
          // Smooth transition: pause, then reset ball
          setIsResetting(true)
          
          // Reset ball to center (hidden)
          ballXRef.current = GAME_WIDTH / 2
          ballYRef.current = GAME_HEIGHT / 2
          ballVelXRef.current = 0
          ballVelYRef.current = 0
          setBallX(ballXRef.current)
          setBallY(ballYRef.current)
          
          // Brief pause before ball reappears
          setTimeout(() => {
            // Ball reappears with animation
            setBallVisible(true)
            // Set initial velocity for next serve
            ballVelXRef.current = (Math.random() - 0.5) * 2
            ballVelYRef.current = BALL_SPEED
            setIsResetting(false)
          }, 1000)
        }
      } else if (ballYRef.current > GAME_HEIGHT) {
        // Ball went off bottom - top player (player 1) scores
        leftScoreRef.current += 1
        setLeftScore(leftScoreRef.current)
        // Trigger score pulse animation
        setScorePulse(true)
        if (onScorePulse) onScorePulse(true)
        // Trigger goal flash effect - get player style dynamically
        const leftStyle = getPlayerStyle(0)
        setGoalFlash(true)
        setGoalFlashColor(leftStyle.color)
        setScreenFlash(true)
        setScreenFlashColor(leftStyle.color)
        setTimeout(() => setScreenFlash(false), 300)
        
        // Explode the ball
        setBallExploding(true)
        setBallVisible(false)
        
        setTimeout(() => {
          setScorePulse(false)
          setGoalFlash(false)
          setBallExploding(false)
          if (onScorePulse) onScorePulse(false)
        }, 600)
        
        if (leftScoreRef.current >= WIN_SCORE) {
          gameStateRef.current = 'gameover'
          setGameState('gameover')
          soundManager.playGameOver()
          
          // Track winner and loser for rotation
          // Player 1 (left/top) wins, Player 2 (right/bottom) loses
          const winnerPlayer = players[0] // Player 1 (index 0)
          const loserPlayer = players[1] // Player 2 (index 1)
          if (winnerPlayer?.userProfileId && loserPlayer?.userProfileId) {
            setWinnerUserProfileId(winnerPlayer.userProfileId)
            setLoserUserProfileId(loserPlayer.userProfileId)
            
            // Record win in database
            const serverUrl = `http://${window.location.hostname}:8000`
            fetch(`${serverUrl}/api/wins/record`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userProfileId: winnerPlayer.userProfileId,
                gameType: 'pong'
              })
            }).catch(err => console.error('[Pong] Error recording win:', err))
          }
          
          // Immediately broadcast gameover state with final scores to all players
          if (roomId && isHost) {
            emitGameState(roomId, {
              state: 'gameover',
              topPaddleX: topPaddleXRef.current,
              bottomPaddleX: bottomPaddleXRef.current,
              ballX: ballXRef.current,
              ballY: ballYRef.current,
              ballVelX: ballVelXRef.current,
              ballVelY: ballVelYRef.current,
              leftScore: leftScoreRef.current,
              rightScore: rightScoreRef.current
            })
          }
        } else {
          soundManager.playScore()
          // Smooth transition: pause, then reset ball
          setIsResetting(true)
          
          // Reset ball to center (hidden)
          ballXRef.current = GAME_WIDTH / 2
          ballYRef.current = GAME_HEIGHT / 2
          ballVelXRef.current = 0
          ballVelYRef.current = 0
          setBallX(ballXRef.current)
          setBallY(ballYRef.current)
          
          // Brief pause before ball reappears
          setTimeout(() => {
            // Ball reappears with animation
            setBallVisible(true)
            // Set initial velocity for next serve
            ballVelXRef.current = (Math.random() - 0.5) * 2
            ballVelYRef.current = -BALL_SPEED
            setIsResetting(false)
          }, 1000)
        }
      }

      // Throttle state updates for mobile performance (~30fps for state, 60fps for physics)
      const now = Date.now()
      if (now - lastStateUpdateTimeRef.current >= STATE_UPDATE_THROTTLE_MS) {
        lastStateUpdateTimeRef.current = now
        setBallX(ballXRef.current)
        setBallY(ballYRef.current)
        setBallVelX(ballVelXRef.current)
        setBallVelY(ballVelYRef.current)
      }
      
      // Direct DOM updates using transforms for better performance (GPU accelerated)
      // Only update if refs are available (they're set during render)
      if (ballElementRef.current) {
        const displayY = playerNumberRef.current === 1 ? GAME_HEIGHT - ballYRef.current - BALL_SIZE : ballYRef.current
        const scale = ballHitFlash ? 1.2 : 1
        ballElementRef.current.style.transform = `translate3d(${ballXRef.current}px, ${displayY}px, 0) scale(${scale})`
      }
      if (topPaddleElementRef.current) {
        const opponentX = playerNumberRef.current === 1 ? bottomPaddleXRef.current : topPaddleXRef.current
        topPaddleElementRef.current.style.left = `${opponentX}px`
      }
      if (bottomPaddleElementRef.current) {
        const myX = playerNumberRef.current === 1 ? topPaddleXRef.current : bottomPaddleXRef.current
        bottomPaddleElementRef.current.style.transform = `translate3d(${myX}px, 0, 0)`
      }

      // Broadcast game state to other players (throttled to ~30 Hz for network efficiency)
      // Only broadcast if still playing (gameover is broadcast immediately when it happens)
      if (gameStateRef.current === 'playing') {
        const now = Date.now()
        if (roomId && (now - lastBroadcastTimeRef.current >= BROADCAST_THROTTLE_MS)) {
          lastBroadcastTimeRef.current = now
          const frameCount = moveSequenceRef.current
          if (frameCount % 60 === 0) { // Log every 60 frames (~1 second at 60fps)
            sendLogToServer(`Broadcasting game state (frame ${frameCount}, throttled)`, 'debug')
          }
          emitGameState(roomId, {
            state: 'playing',
            topPaddleX: topPaddleXRef.current,
            bottomPaddleX: bottomPaddleXRef.current,
            ballX: ballXRef.current,
            ballY: ballYRef.current,
            ballVelX: ballVelXRef.current,
            ballVelY: ballVelYRef.current,
            leftScore: leftScoreRef.current,
            rightScore: rightScoreRef.current
          })
        }
      }

      gameLoopRef.current = requestAnimationFrame(gameLoop)
    }

    gameLoopRef.current = requestAnimationFrame(gameLoop)

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current)
      }
    }
  }, [gameState, isHost, isResetting])

  // CPU auto-play - competitive ball tracking with improved prediction
  useEffect(() => {
    if (!isCPU || gameState !== 'playing') return

    const cpuInterval = setInterval(() => {
      if (gameStateRef.current !== 'playing') return

      const currentBallX = ballXRef.current
      const currentBallY = ballYRef.current
      const currentBallVelX = ballVelXRef.current
      const currentBallVelY = ballVelYRef.current
      const playerNum = playerNumberRef.current

      let targetPaddleX
      let currentPaddleX
      
      if (playerNum === 1) {
        // Player 1 controls bottom paddle
        currentPaddleX = bottomPaddleXRef.current
        const paddleY = GAME_HEIGHT - PADDLE_HEIGHT
        
        // Predict ball position when it reaches bottom paddle
        if (currentBallVelY > 0) {
          // Ball is moving down towards our paddle
          const distanceToPaddle = paddleY - (currentBallY + BALL_SIZE)
          const timeToReachPaddle = distanceToPaddle / currentBallVelY
          
          if (timeToReachPaddle > 0 && timeToReachPaddle < 200) {
            // Predict ball X position accounting for wall bounces
            let remainingTime = timeToReachPaddle
            let ballX = currentBallX
            let ballVelX = currentBallVelX
            let iterations = 0
            const maxIterations = 10 // Safety limit
            
            // Simulate ball movement with wall bounces
            while (remainingTime > 0.1 && iterations < maxIterations) {
              iterations++
              const timeToWall = ballVelX > 0 
                ? (GAME_WIDTH - BALL_SIZE - ballX) / ballVelX
                : ballX / -ballVelX
              
              if (timeToWall > 0 && timeToWall < remainingTime && timeToWall < 100) {
                // Ball will hit a wall
                ballX += ballVelX * timeToWall
                ballVelX = -ballVelX // Bounce
                remainingTime -= timeToWall
              } else {
                // Ball reaches paddle before hitting wall
                ballX += ballVelX * remainingTime
                remainingTime = 0
              }
            }
            
            const predictedBallX = ballX
            // Center paddle on predicted ball center
            targetPaddleX = predictedBallX + BALL_SIZE / 2 - PADDLE_WIDTH / 2
          } else {
            // Ball too far or moving away - center paddle
            targetPaddleX = GAME_WIDTH / 2 - PADDLE_WIDTH / 2
          }
        } else {
          // Ball moving up - center paddle
          targetPaddleX = GAME_WIDTH / 2 - PADDLE_WIDTH / 2
        }
        
        // Clamp to game bounds
        targetPaddleX = Math.max(0, Math.min(GAME_WIDTH - PADDLE_WIDTH, targetPaddleX))
        
        // Move paddle towards target with smooth movement
        const diff = targetPaddleX - currentPaddleX
        if (Math.abs(diff) > 2) {
          const moveDirection = diff > 0 ? 1 : -1
          movePaddle(moveDirection)
        }
      } else if (playerNum === 2) {
        // Player 2 controls top paddle
        currentPaddleX = topPaddleXRef.current
        const paddleY = PADDLE_HEIGHT
        
        // Predict ball position when it reaches top paddle
        if (currentBallVelY < 0) {
          // Ball is moving up towards our paddle
          const distanceToPaddle = currentBallY - paddleY
          const timeToReachPaddle = distanceToPaddle / Math.abs(currentBallVelY)
          
          if (timeToReachPaddle > 0 && timeToReachPaddle < 200) {
            // Predict ball X position accounting for wall bounces
            let remainingTime = timeToReachPaddle
            let ballX = currentBallX
            let ballVelX = currentBallVelX
            let iterations = 0
            const maxIterations = 10 // Safety limit
            
            // Simulate ball movement with wall bounces
            while (remainingTime > 0.1 && iterations < maxIterations) {
              iterations++
              const timeToWall = ballVelX > 0 
                ? (GAME_WIDTH - BALL_SIZE - ballX) / ballVelX
                : ballX / -ballVelX
              
              if (timeToWall > 0 && timeToWall < remainingTime && timeToWall < 100) {
                // Ball will hit a wall
                ballX += ballVelX * timeToWall
                ballVelX = -ballVelX // Bounce
                remainingTime -= timeToWall
              } else {
                // Ball reaches paddle before hitting wall
                ballX += ballVelX * remainingTime
                remainingTime = 0
              }
            }
            
            const predictedBallX = ballX
            // Center paddle on predicted ball center
            targetPaddleX = predictedBallX + BALL_SIZE / 2 - PADDLE_WIDTH / 2
          } else {
            // Ball too far or moving away - center paddle
            targetPaddleX = GAME_WIDTH / 2 - PADDLE_WIDTH / 2
          }
        } else {
          // Ball moving down - center paddle
          targetPaddleX = GAME_WIDTH / 2 - PADDLE_WIDTH / 2
        }
        
        // Clamp to game bounds
        targetPaddleX = Math.max(0, Math.min(GAME_WIDTH - PADDLE_WIDTH, targetPaddleX))
        
        // Move paddle towards target with smooth movement
        const diff = targetPaddleX - currentPaddleX
        if (Math.abs(diff) > 2) {
          const moveDirection = diff > 0 ? 1 : -1
          movePaddle(moveDirection)
        }
      }
    }, 16) // Check every frame for competitive play

    return () => clearInterval(cpuInterval)
  }, [isCPU, gameState, movePaddle])

  // Calculate ball speed for visual effects
  useEffect(() => {
    if (gameState === 'playing') {
      const speed = Math.sqrt(ballVelX * ballVelX + ballVelY * ballVelY)
      setBallSpeed(speed)
    }
  }, [ballVelX, ballVelY, gameState])

  // Track paddle movement for trail effect
  useEffect(() => {
    if (gameState === 'playing') {
      setLastPaddleX({ top: topPaddleX, bottom: bottomPaddleX })
    }
  }, [topPaddleX, bottomPaddleX, gameState])

  // Get player styles (use userProfileId for identification)
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

  const leftPlayerStyle = getPlayerStyle(0)
  const rightPlayerStyle = getPlayerStyle(1)

  // Update parent component with score when it changes
  useEffect(() => {
    if (onScoreUpdate) {
      const leftStyle = getPlayerStyle(0)
      const rightStyle = getPlayerStyle(1)
      onScoreUpdate({
        leftScore,
        rightScore,
        leftPlayerStyle: leftStyle,
        rightPlayerStyle: rightStyle
      })
    }
  }, [leftScore, rightScore, players, onScoreUpdate])

  // Calculate responsive scale for mobile
  const [gameScale, setGameScale] = useState(1)
  
  useEffect(() => {
    const calculateScale = () => {
      // Game canvas is fixed at 70vh, calculate scale to fit within that space
      const availableHeight = window.innerHeight * 0.7 // 70vh
      const availableWidth = window.innerWidth
      
      const scaleByWidth = availableWidth / GAME_WIDTH
      const scaleByHeight = availableHeight / GAME_HEIGHT
      
      // Use the smaller scale to ensure it fits, but don't scale up beyond 1
      const scale = Math.min(scaleByWidth, scaleByHeight, 1)
      setGameScale(Math.max(scale, 0.3)) // Minimum scale of 0.3 for very small screens
    }
    
    calculateScale()
    window.addEventListener('resize', calculateScale)
    return () => window.removeEventListener('resize', calculateScale)
  }, []) // Remove dependencies so scale only calculates on mount and resize

  return (
    <div className="bg-black" style={{ 
      width: '100vw', 
      height: '100vh', 
      position: 'absolute', 
      top: 0, 
      left: 0, 
      right: 0, 
      bottom: 0,
      paddingTop: '10vh', // Space for AppHUD at top
      paddingBottom: '15vh', // Space for GameHUB at bottom (increased to push content up)
      overflow: 'visible', // Changed to visible so content isn't clipped
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      {/* Error Notification */}
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
      


      {/* Game Canvas Wrapper - scales on mobile */}
      <div
        style={{
          width: GAME_WIDTH,
          height: '70vh', // Fixed 70vh height
          transform: `${gameScale < 1 ? `scale(${gameScale})` : ''}`,
          transformOrigin: 'center center',
          overflow: 'visible', // Changed to visible so overlays aren't clipped
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <div
          className="relative border rounded-xl bg-black overflow-hidden shadow-2xl"
          style={{ 
            width: GAME_WIDTH, 
            height: '100%', // Expand to fill wrapper height
            minHeight: GAME_HEIGHT, // Maintain minimum game height
            touchAction: 'none',
            borderColor: 'rgba(255, 255, 255, 0.3)',
            borderRadius: '16px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.05)',
            backgroundImage: `
              radial-gradient(circle at 2px 2px, rgba(255, 255, 255, 0.05) 1px, transparent 0),
              linear-gradient(to bottom, transparent 0%, rgba(255, 255, 255, 0.02) 50%, transparent 100%),
              radial-gradient(ellipse at center top, rgba(255, 255, 255, 0.03) 0%, transparent 50%),
              radial-gradient(ellipse at center bottom, rgba(255, 255, 255, 0.03) 0%, transparent 50%)
            `,
            backgroundSize: '40px 40px, 100% 100%, 100% 30%, 100% 30%',
            position: 'relative'
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
        {/* Vignette Effect */}
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{
            background: 'radial-gradient(ellipse at center, transparent 0%, rgba(0, 0, 0, 0.3) 100%)',
            borderRadius: '16px'
          }}
        />
        
        {/* Corner Markers */}
        <div
          className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 pointer-events-none z-15"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.2)',
            borderRadius: '16px 0 0 0'
          }}
        />
        <div
          className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 pointer-events-none z-15"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.2)',
            borderRadius: '0 16px 0 0'
          }}
        />
        <div
          className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 pointer-events-none z-15"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.2)',
            borderRadius: '0 0 0 16px'
          }}
        />
        <div
          className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 pointer-events-none z-15"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.2)',
            borderRadius: '0 0 16px 0'
          }}
        />
        
        {/* Score Display - Inside board, left side, stacked top to bottom */}
        {gameState === 'playing' && (
          <div 
            className="absolute z-20"
            style={{
              left: '20px',
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              flexDirection: 'column',
              gap: '60px',
              alignItems: 'flex-end'
            }}
          >
            {/* Opponent score - top */}
            <div 
              style={{
                transform: scorePulse ? 'scale(1.15)' : 'scale(1)',
                transition: 'transform 0.3s ease',
                opacity: 0.7
              }}
            >
              <div 
                className="text-5xl sm:text-6xl font-bold"
                style={{ 
                  color: shouldFlipView ? rightPlayerStyle.color : leftPlayerStyle.color, 
                  textShadow: '0 4px 12px rgba(0, 0, 0, 0.9)' 
                }}
              >
                {displayScores.opponentScore}
              </div>
            </div>
            {/* My score - bottom */}
            <div 
              style={{
                transform: scorePulse ? 'scale(1.15)' : 'scale(1)',
                transition: 'transform 0.3s ease',
                opacity: 0.7
              }}
            >
              <div 
                className="text-5xl sm:text-6xl font-bold"
                style={{ 
                  color: shouldFlipView ? leftPlayerStyle.color : rightPlayerStyle.color, 
                  textShadow: '0 4px 12px rgba(0, 0, 0, 0.9)' 
                }}
              >
                {displayScores.myScore}
              </div>
            </div>
          </div>
        )}
        {/* Center Line */}
        <div
          className="absolute left-0 right-0"
          style={{
            top: '50%',
            height: '1px',
            background: 'repeating-linear-gradient(to right, rgba(255, 255, 255, 0.3) 0px, rgba(255, 255, 255, 0.3) 10px, transparent 10px, transparent 20px)',
            transform: 'translateY(-50%)',
            animation: 'centerLinePulse 3s ease-in-out infinite',
            boxShadow: '0 0 4px rgba(255, 255, 255, 0.2)'
          }}
        />

        {/* Goal Areas with Gradient */}
        <div
          className="absolute left-0 right-0"
          style={{
            top: 0,
            height: '20px',
            borderBottom: '1px dashed rgba(255, 255, 255, 0.2)',
            background: 'linear-gradient(to bottom, rgba(255, 255, 255, 0.05) 0%, transparent 100%)'
          }}
        />
        <div
          className="absolute left-0 right-0"
          style={{
            bottom: 0,
            height: '20px',
            borderTop: '1px dashed rgba(255, 255, 255, 0.2)',
            background: 'linear-gradient(to top, rgba(255, 255, 255, 0.05) 0%, transparent 100%)'
          }}
        />
        
        {/* Touch Control Area Animation */}
        {showTouchAreaAnimation && (
          <div
            className="absolute left-0 right-0 pointer-events-none"
            style={{
              top: `${TOUCH_CONTROL_AREA_THRESHOLD * 100}%`,
              bottom: 0,
              background: 'linear-gradient(to top, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.05) 50%, transparent 100%)',
              borderTop: '2px dashed rgba(255, 255, 255, 0.4)',
              animation: 'pulseTouchArea 2.5s ease-in-out',
              zIndex: 10
            }}
          >
            <div
              className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white text-sm font-medium whitespace-nowrap"
              style={{
                textShadow: '0 2px 8px rgba(0, 0, 0, 0.8)',
                animation: 'fadeInOut 2.5s ease-in-out'
              }}
            >
              Touch here to move your paddle
            </div>
          </div>
        )}
        {/* Opponent Paddle (at top) */}
        <div className="absolute top-0" style={{ left: 0, width: GAME_WIDTH, height: PADDLE_HEIGHT }}>
          {/* Paddle Trail */}
          {gameState === 'playing' && Math.abs(lastPaddleX.top - (shouldFlipView ? bottomPaddleX : topPaddleX)) > 2 && (
            <div
              className="absolute border-2 rounded"
              style={{
                left: lastPaddleX.top,
                top: 0,
                width: PADDLE_WIDTH,
                height: PADDLE_HEIGHT,
                borderColor: shouldFlipView ? rightPlayerStyle.color : leftPlayerStyle.color,
                backgroundColor: shouldFlipView ? rightPlayerStyle.color : leftPlayerStyle.color,
                opacity: 0.2,
                animation: 'paddleTrail 0.3s ease-out forwards',
                pointerEvents: 'none'
              }}
            />
          )}
          
          {/* Paddle Ripple Effect */}
          {paddleRipple.top && (
            <div
              className="absolute rounded-full pointer-events-none z-20"
              style={{
                left: paddleRipple.top.x,
                top: paddleRipple.top.y,
                width: PADDLE_WIDTH,
                height: PADDLE_WIDTH,
                border: `2px solid ${shouldFlipView ? rightPlayerStyle.color : leftPlayerStyle.color}`,
                transform: 'translate(-50%, -50%)',
                animation: 'paddleRipple 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards',
                opacity: 0.6
              }}
            />
          )}
          
          {/* Main Paddle */}
          <div
            ref={topPaddleElementRef}
            className="absolute border-2 rounded transition-all duration-75"
            style={{
              left: displayPaddles.opponentPaddleX,
              top: 0,
              width: PADDLE_WIDTH,
              height: PADDLE_HEIGHT,
              borderColor: shouldFlipView ? rightPlayerStyle.color : leftPlayerStyle.color,
              backgroundColor: shouldFlipView ? rightPlayerStyle.color : leftPlayerStyle.color,
              opacity: (shouldFlipView ? paddleHitFlash.bottom : paddleHitFlash.top) ? 1 : 0.8,
              willChange: 'transform', // Optimize for frequent position updates
              transform: 'translateZ(0)', // Force GPU acceleration
              borderRadius: '8px',
              boxShadow: (shouldFlipView ? paddleHitFlash.bottom : paddleHitFlash.top)
                ? `0 0 20px ${shouldFlipView ? rightPlayerStyle.color : leftPlayerStyle.color}, 0 0 40px ${shouldFlipView ? rightPlayerStyle.color : leftPlayerStyle.color}, inset 0 0 10px rgba(255, 255, 255, 0.2)`
                : `0 0 8px ${shouldFlipView ? rightPlayerStyle.color : leftPlayerStyle.color}40, inset 0 0 5px rgba(255, 255, 255, 0.1)`,
              transition: 'box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          >
            <div className="flex items-center justify-center h-full text-2xl">
              {shouldFlipView ? rightPlayerStyle.emoji : leftPlayerStyle.emoji}
            </div>
          </div>
          
          {/* Position Indicator Line */}
          {gameState === 'playing' && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: PADDLE_WIDTH / 2,
                top: PADDLE_HEIGHT,
                width: '1px',
                height: '30px',
                background: `linear-gradient(to bottom, ${shouldFlipView ? rightPlayerStyle.color : leftPlayerStyle.color}40, transparent)`,
                transform: 'translateX(-50%)',
                opacity: 0.3
              }}
            />
          )}
        </div>

        {/* My Paddle (at bottom) */}
        <div className="absolute bottom-0" style={{ left: 0, width: GAME_WIDTH, height: PADDLE_HEIGHT }}>
          {/* Paddle Trail */}
          {gameState === 'playing' && Math.abs(lastPaddleX.bottom - displayPaddles.myPaddleX) > 2 && (
            <div
              className="absolute border-2 rounded"
              style={{
                left: lastPaddleX.bottom,
                bottom: 0,
                width: PADDLE_WIDTH,
                height: PADDLE_HEIGHT,
                borderColor: shouldFlipView ? leftPlayerStyle.color : rightPlayerStyle.color,
                backgroundColor: shouldFlipView ? leftPlayerStyle.color : rightPlayerStyle.color,
                opacity: 0.2,
                animation: 'paddleTrail 0.3s ease-out forwards',
                pointerEvents: 'none'
              }}
            />
          )}
          
          {/* Paddle Ripple Effect */}
          {paddleRipple.bottom && (
            <div
              className="absolute rounded-full pointer-events-none z-20"
              style={{
                left: paddleRipple.bottom.x,
                bottom: GAME_HEIGHT - paddleRipple.bottom.y,
                width: PADDLE_WIDTH,
                height: PADDLE_WIDTH,
                border: `2px solid ${shouldFlipView ? leftPlayerStyle.color : rightPlayerStyle.color}`,
                transform: 'translate(-50%, 50%)',
                animation: 'paddleRipple 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards',
                opacity: 0.6
              }}
            />
          )}
          
          {/* Main Paddle */}
          <div
            ref={bottomPaddleElementRef}
            className="absolute border-2 rounded"
            style={{
              left: displayPaddles.myPaddleX,
              bottom: 0,
              width: PADDLE_WIDTH,
              height: PADDLE_HEIGHT,
              borderColor: shouldFlipView ? leftPlayerStyle.color : rightPlayerStyle.color,
              backgroundColor: shouldFlipView ? leftPlayerStyle.color : rightPlayerStyle.color,
              opacity: (shouldFlipView ? paddleHitFlash.top : paddleHitFlash.bottom) ? 1 : 0.8,
              willChange: 'transform', // Optimize for frequent position updates
              transform: `translate3d(${displayPaddles.myPaddleX}px, 0, 0)`, // GPU accelerated
              borderRadius: '8px',
              boxShadow: (shouldFlipView ? paddleHitFlash.top : paddleHitFlash.bottom)
                ? `0 0 20px ${shouldFlipView ? leftPlayerStyle.color : rightPlayerStyle.color}, 0 0 40px ${shouldFlipView ? leftPlayerStyle.color : rightPlayerStyle.color}, inset 0 0 10px rgba(255, 255, 255, 0.2)`
                : `0 0 8px ${shouldFlipView ? leftPlayerStyle.color : rightPlayerStyle.color}40, inset 0 0 5px rgba(255, 255, 255, 0.1)`,
              transition: 'box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          >
            <div className="flex items-center justify-center h-full text-2xl">
              {shouldFlipView ? leftPlayerStyle.emoji : rightPlayerStyle.emoji}
            </div>
          </div>
          
          {/* Position Indicator Line */}
          {gameState === 'playing' && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: displayPaddles.myPaddleX + PADDLE_WIDTH / 2,
                bottom: PADDLE_HEIGHT,
                width: '1px',
                height: '30px',
                background: `linear-gradient(to top, ${shouldFlipView ? leftPlayerStyle.color : rightPlayerStyle.color}40, transparent)`,
                transform: 'translateX(-50%)',
                opacity: 0.3
              }}
            />
          )}
        </div>

        {/* Enhanced Ball Shadow */}
        {ballVisible && !ballExploding && (
          <>
            <div
              className="absolute rounded-full"
              style={{
                left: ballX + BALL_SIZE / 2,
                top: getDisplayBallY() + BALL_SIZE + 2,
                width: BALL_SIZE * (1 + ballSpeed * 0.1),
                height: BALL_SIZE * 0.3 * (1 + ballSpeed * 0.1),
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                filter: `blur(${4 + ballSpeed * 0.5}px)`,
                transform: 'translateX(-50%)',
                opacity: 0.6 + ballSpeed * 0.05,
                transition: 'all 0.1s ease-out'
              }}
            />
            {/* Additional shadow layer for depth */}
            <div
              className="absolute rounded-full"
              style={{
                left: ballX + BALL_SIZE / 2,
                top: getDisplayBallY() + BALL_SIZE + 4,
                width: BALL_SIZE * 0.6,
                height: BALL_SIZE * 0.2,
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                filter: 'blur(6px)',
                transform: 'translateX(-50%)',
                opacity: 0.4
              }}
            />
          </>
        )}
        
        {/* Ball Explosion Effect */}
        {ballExploding && (
          <div
            className="absolute pointer-events-none z-20"
            style={{
              left: ballX + BALL_SIZE / 2,
              top: getDisplayBallY() + BALL_SIZE / 2,
              transform: 'translate(-50%, -50%)',
              width: BALL_SIZE * 4,
              height: BALL_SIZE * 4,
              animation: 'ballExplode 0.6s ease-out'
            }}
          >
            {/* Explosion particles */}
            {[...Array(12)].map((_, i) => {
              const angle = (i / 12) * Math.PI * 2
              const distance = BALL_SIZE * 2
              return (
                <div
                  key={i}
                  className="absolute bg-white rounded-full"
                  style={{
                    left: '50%',
                    top: '50%',
                    width: BALL_SIZE * 0.6,
                    height: BALL_SIZE * 0.6,
                    transform: `translate(-50%, -50%) translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px)`,
                    opacity: 0,
                    animation: `explodeParticle 0.6s ease-out ${i * 0.02}s`
                  }}
                />
              )
            })}
            {/* Central flash */}
            <div
              className="absolute bg-white rounded-full"
              style={{
                left: '50%',
                top: '50%',
                width: BALL_SIZE * 2,
                height: BALL_SIZE * 2,
                transform: 'translate(-50%, -50%)',
                opacity: 0,
                animation: 'explodeFlash 0.6s ease-out',
                boxShadow: '0 0 30px rgba(255, 255, 255, 0.8), 0 0 60px rgba(255, 255, 255, 0.4)'
              }}
            />
          </div>
        )}
        
        {/* Ball with Speed-based Glow */}
        {ballVisible && (
          <>
            {/* Speed Glow Effect */}
            {ballSpeed > 3 && (
              <div
                className="absolute bg-white rounded-full pointer-events-none"
                style={{
                  left: ballX + BALL_SIZE / 2,
                  top: getDisplayBallY() + BALL_SIZE / 2,
                  width: BALL_SIZE * (1 + ballSpeed * 0.15),
                  height: BALL_SIZE * (1 + ballSpeed * 0.15),
                  transform: 'translate(-50%, -50%)',
                  opacity: (ballSpeed - 3) * 0.1,
                  filter: `blur(${ballSpeed * 0.5}px)`,
                  animation: 'ballSpeedGlow 0.5s ease-in-out infinite',
                  zIndex: 1
                }}
              />
            )}
            
            {/* Main Ball */}
            <div
              ref={ballElementRef}
              className="absolute bg-white rounded-full"
              style={{
                left: 0,
                top: 0,
                width: BALL_SIZE,
                height: BALL_SIZE,
                boxShadow: ballHitFlash
                  ? '0 0 20px rgba(255, 255, 255, 0.8), 0 0 40px rgba(255, 255, 255, 0.4), inset 0 0 10px rgba(255, 255, 255, 0.3)'
                  : `0 0 ${10 + ballSpeed * 0.5}px rgba(255, 255, 255, ${0.5 + ballSpeed * 0.05}), inset 0 0 5px rgba(255, 255, 255, 0.2)`,
                transform: `translate3d(${ballX}px, ${getDisplayBallY()}px, 0) ${ballHitFlash ? 'scale(1.2)' : 'scale(1)'} rotate(${ballSpeed * 2}deg)`,
                transition: ballHitFlash ? 'transform 0.1s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.1s cubic-bezier(0.4, 0, 0.2, 1)' : 'box-shadow 0.1s cubic-bezier(0.4, 0, 0.2, 1)',
                animation: isResetting && ballVisible ? 'ballReappear 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'ballRotation 2s linear infinite',
                willChange: 'transform', // GPU acceleration
                backfaceVisibility: 'hidden', // Prevent flickering on mobile
                WebkitBackfaceVisibility: 'hidden',
                zIndex: 2
              }}
            />
          </>
        )}
        
        {/* Enhanced Ball Trail Effect with Motion Blur */}
        {gameState === 'playing' && (ballVelX !== 0 || ballVelY !== 0) && ballVisible && (
          <>
            {[...Array(3)].map((_, i) => {
              const trailOffset = (i + 1) * 0.2
              const trailOpacity = 0.3 - (i * 0.1)
              const trailSize = BALL_SIZE * (0.6 - i * 0.1)
              return (
                <div
                  key={i}
                  className="absolute bg-white rounded-full pointer-events-none"
                  style={{
                    left: ballX - ballVelX * trailOffset,
                    top: getDisplayBallY() - (shouldFlipView ? ballVelY : -ballVelY) * trailOffset,
                    width: trailSize,
                    height: trailSize,
                    opacity: trailOpacity,
                    filter: `blur(${2 + i}px)`,
                    transition: 'opacity 0.1s cubic-bezier(0.4, 0, 0.2, 1)',
                    zIndex: 1
                  }}
                />
              )
            })}
          </>
        )}


        {/* Goal Flash Effect */}
        {goalFlash && (
          <div
            className="absolute inset-0 pointer-events-none z-30"
            style={{
              background: `radial-gradient(circle at center, ${goalFlashColor}40 0%, transparent 70%)`,
              animation: 'goalFlash 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          />
        )}
        
        {/* Screen Flash Effect */}
        {screenFlash && (
          <div
            className="absolute inset-0 pointer-events-none z-35"
            style={{
              background: screenFlashColor,
              opacity: 0,
              animation: 'screenFlash 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          />
        )}
        
        {/* Screen Shake Effect */}
        {screenShake && (
          <div
            className="absolute inset-0 pointer-events-none z-35"
            style={{
              background: 'transparent',
              animation: 'screenShake 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          />
        )}
        
        {/* Win Condition Indicator */}
        {gameState === 'playing' && (
          <div
            className="absolute top-4 left-1/2 transform -translate-x-1/2 pointer-events-none z-15"
            style={{
              fontSize: '10px',
              color: 'rgba(255, 255, 255, 0.4)',
              letterSpacing: '0.1em',
              fontFamily: 'monospace',
              textTransform: 'uppercase',
              textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)'
            }}
          >
            First to {WIN_SCORE}
          </div>
        )}
        
        {/* Game Duration Timer (optional info) */}
        {gameState === 'playing' && gameStartTime && (
          <div
            className="absolute top-4 right-4 pointer-events-none z-15"
            style={{
              fontSize: '10px',
              color: 'rgba(255, 255, 255, 0.3)',
              letterSpacing: '0.1em',
              fontFamily: 'monospace',
              textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)'
            }}
          >
            {Math.floor((Date.now() - gameStartTime) / 1000)}s
          </div>
        )}

        {/* Reset Message Overlay */}
        {resetMessage && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              backdropFilter: 'blur(2px)'
            }}
          >
            <div
              className="text-2xl sm:text-3xl font-bold text-white"
              style={{
                textShadow: '0 0 20px rgba(255, 255, 255, 0.8), 0 0 40px rgba(255, 255, 255, 0.4)',
                animation: 'fadeInOut 1.3s ease-in-out'
              }}
            >
              {resetMessage}
            </div>
          </div>
        )}

        {/* Countdown Screen */}
        {gameState === 'countdown' && countdown !== null && (
          <div 
            className="absolute inset-0 flex items-center justify-center backdrop-blur-sm z-40"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.85)',
              backgroundImage: 'radial-gradient(circle at center, rgba(255, 255, 255, 0.05) 0%, transparent 70%)'
            }}
          >
            <div
              className="text-8xl sm:text-9xl font-bold"
              style={{
                color: '#FFFFFF',
                textShadow: '0 0 40px rgba(255, 255, 255, 0.8), 0 0 80px rgba(255, 255, 255, 0.4), 0 0 120px rgba(255, 255, 255, 0.2)',
                animation: 'countdownPulse 1s cubic-bezier(0.34, 1.56, 0.64, 1)',
                letterSpacing: '0.05em',
                fontFamily: 'monospace'
              }}
            >
              {countdown}
            </div>
          </div>
        )}

        {/* Waiting Screen */}
        {gameState === 'waiting' && (
          <div 
            className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-sm"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              backgroundImage: `
                radial-gradient(circle at 20% 30%, rgba(255, 255, 255, 0.03) 0%, transparent 50%),
                radial-gradient(circle at 80% 70%, rgba(255, 255, 255, 0.03) 0%, transparent 50%)
              `,
              backgroundSize: '200% 200%',
              animation: 'waitingPattern 20s ease-in-out infinite',
              padding: '16px'
            }}
          >
            <h1 
              className="text-4xl sm:text-5xl font-bold mb-6 text-white"
              style={{
                letterSpacing: '0.15em',
                textShadow: '0 4px 20px rgba(255, 255, 255, 0.3), 0 0 40px rgba(255, 255, 255, 0.1)',
                animation: 'slideInDown 0.6s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            >
              PONG
            </h1>
            
            {/* Player Display */}
            <div 
              className="flex items-center gap-6 mb-4"
              style={{
                animation: 'slideInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1) 0.1s both'
              }}
            >
              {players.length > 0 && (
                <div 
                  className="flex flex-col items-center gap-3 px-4 py-3 rounded-xl border"
                  style={{
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    backdropFilter: 'blur(8px)',
                    boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.1)',
                    animation: 'scaleIn 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.2s both'
                  }}
                >
                  <div 
                    className="text-5xl"
                    style={{ 
                      opacity: players[0] ? 1 : 0.3,
                      filter: players[0] ? 'none' : 'grayscale(100%)',
                      textShadow: `0 0 20px ${leftPlayerStyle.color}40`
                    }}
                  >
                    {leftPlayerStyle.emoji}
                  </div>
                  <div 
                    className="text-sm font-semibold"
                    style={{ 
                      color: leftPlayerStyle.color,
                      letterSpacing: '0.05em',
                      textShadow: `0 2px 8px ${leftPlayerStyle.color}40`
                    }}
                  >
                    {leftPlayerStyle.name}
                  </div>
                </div>
              )}
              
              <span 
                className="text-white/40 text-2xl font-bold"
                style={{
                  letterSpacing: '0.1em',
                  textShadow: '0 2px 10px rgba(255, 255, 255, 0.2)',
                  animation: 'scaleIn 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.3s both'
                }}
              >
                VS
              </span>
              
              {players.length > 1 && (
                <div 
                  className="flex flex-col items-center gap-3 px-4 py-3 rounded-xl border"
                  style={{
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    backdropFilter: 'blur(8px)',
                    boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.1)',
                    animation: 'scaleIn 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.4s both'
                  }}
                >
                  <div 
                    className="text-5xl"
                    style={{
                      textShadow: `0 0 20px ${rightPlayerStyle.color}40`
                    }}
                  >
                    {rightPlayerStyle.emoji}
                  </div>
                  <div 
                    className="text-sm font-semibold"
                    style={{ 
                      color: rightPlayerStyle.color,
                      letterSpacing: '0.05em',
                      textShadow: `0 2px 8px ${rightPlayerStyle.color}40`
                    }}
                  >
                    {rightPlayerStyle.name}
                  </div>
                </div>
              )}
              {players.length <= 1 && (
                <div 
                  className="flex flex-col items-center gap-3 px-4 py-3 rounded-xl border opacity-50"
                  style={{
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    animation: 'scaleIn 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.4s both'
                  }}
                >
                  <div className="text-5xl opacity-30 grayscale">⚪</div>
                  <div className="text-sm font-semibold text-white/40" style={{ letterSpacing: '0.05em' }}>Waiting...</div>
                </div>
              )}
            </div>
            
            <p className="text-xs text-white/60 mb-2">
              {players.length}/4 players
            </p>
            
            {/* Rotation explanation when 3+ players */}
            {players.length >= 3 && (
              <div className="mb-4 px-4 py-2 rounded-lg border" style={{
                borderColor: 'rgba(255, 255, 255, 0.2)',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                maxWidth: '280px'
              }}>
                <p className="text-xs text-white/80 text-center leading-relaxed">
                  <span className="font-semibold">Winner Stays Rotation:</span><br />
                  First 2 players play. Others wait in queue.<br />
                  Winner stays, loser rotates out.
                </p>
                {players.length > 2 && (
                  <div className="mt-2 pt-2 border-t" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
                    <p className="text-xs text-white/60 text-center mb-1">Waiting:</p>
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      {players.slice(2).map((player, idx) => (
                        <span key={player.userProfileId || idx} className="text-xs" style={{ color: player.color || '#FFFFFF' }}>
                          {player.emoji || '⚪'} {player.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {isHost && (
              <button
                onClick={startGame}
                disabled={players.length < 2}
                className="px-4 py-2 text-sm font-bold text-white border rounded-xl hover:bg-white hover:text-black transition-all duration-300 cursor-pointer hover:scale-105 hover:shadow-lg hover:shadow-white/10 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                style={{
                  borderColor: 'rgba(255, 255, 255, 0.3)',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
                  borderRadius: '12px',
                  letterSpacing: '0.05em',
                  animation: players.length >= 2 ? 'pulseGlow 2s ease-in-out infinite' : 'none',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                }}
              >
                {players.length < 2 ? 'Waiting for Player 2...' : 'Start Game'}
              </button>
            )}
            {!isHost && (
              <p className="text-xs text-white/60">Waiting for host to start...</p>
            )}
          </div>
        )}

        {/* Game Over Screen */}
        {gameState === 'gameover' && (
          <div 
            className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-sm z-40"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.92)',
              backgroundImage: 'radial-gradient(circle at center, rgba(255, 255, 255, 0.05) 0%, transparent 70%)'
            }}
          >
            <div 
              className="text-6xl sm:text-8xl mb-6"
              style={{
                animation: 'bounceSubtle 2s ease-in-out infinite, scaleIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                filter: 'drop-shadow(0 0 20px rgba(255, 255, 255, 0.3))'
              }}
            >
              {displayScores.myScore >= WIN_SCORE 
                ? (shouldFlipView ? leftPlayerStyle.emoji : rightPlayerStyle.emoji)
                : (shouldFlipView ? rightPlayerStyle.emoji : leftPlayerStyle.emoji)
              }
            </div>
            <h2 
              className="text-3xl sm:text-4xl font-bold mb-4 text-white"
              style={{
                letterSpacing: '0.1em',
                textShadow: '0 4px 20px rgba(255, 255, 255, 0.3), 0 0 40px rgba(255, 255, 255, 0.1)',
                animation: 'slideInDown 0.6s cubic-bezier(0.4, 0, 0.2, 1) 0.2s both'
              }}
            >
              Game Over
            </h2>
            <p 
              className="text-xl sm:text-2xl mb-6 font-bold"
              style={{
                animation: 'slideInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1) 0.3s both'
              }}
            >
              {displayScores.myScore >= WIN_SCORE ? (
                <span 
                  style={{ 
                    color: shouldFlipView ? leftPlayerStyle.color : rightPlayerStyle.color,
                    textShadow: `0 0 20px ${shouldFlipView ? leftPlayerStyle.color : rightPlayerStyle.color}40, 0 0 40px ${shouldFlipView ? leftPlayerStyle.color : rightPlayerStyle.color}20`,
                    letterSpacing: '0.05em'
                  }}
                >
                  {shouldFlipView ? leftPlayerStyle.name : rightPlayerStyle.name} Wins!
                </span>
              ) : (
                <span 
                  style={{ 
                    color: shouldFlipView ? rightPlayerStyle.color : leftPlayerStyle.color,
                    textShadow: `0 0 20px ${shouldFlipView ? rightPlayerStyle.color : leftPlayerStyle.color}40, 0 0 40px ${shouldFlipView ? rightPlayerStyle.color : leftPlayerStyle.color}20`,
                    letterSpacing: '0.05em'
                  }}
                >
                  {shouldFlipView ? rightPlayerStyle.name : leftPlayerStyle.name} Wins!
                </span>
              )}
            </p>
            <div 
              className="flex items-center gap-6 mb-8"
              style={{
                animation: 'slideInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1) 0.4s both'
              }}
            >
              <div 
                className="flex flex-col items-center px-4 py-3 rounded-xl border"
                style={{
                  borderColor: 'rgba(255, 255, 255, 0.2)',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  backdropFilter: 'blur(8px)',
                  boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.1)',
                  borderRadius: '12px'
                }}
              >
                <div 
                  className="text-3xl font-bold"
                  style={{ 
                    color: shouldFlipView ? leftPlayerStyle.color : rightPlayerStyle.color,
                    textShadow: `0 0 15px ${shouldFlipView ? leftPlayerStyle.color : rightPlayerStyle.color}40`,
                    letterSpacing: '0.05em',
                    fontFamily: 'monospace'
                  }}
                >
                  {displayScores.myScore}
                </div>
                <div className="text-xs text-white/60 mt-2" style={{ letterSpacing: '0.05em' }}>
                  {shouldFlipView ? leftPlayerStyle.name : rightPlayerStyle.name}
                </div>
              </div>
              <span className="text-white/40 text-2xl font-bold" style={{ letterSpacing: '0.1em' }}>-</span>
              <div 
                className="flex flex-col items-center px-4 py-3 rounded-xl border"
                style={{
                  borderColor: 'rgba(255, 255, 255, 0.2)',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  backdropFilter: 'blur(8px)',
                  boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.1)',
                  borderRadius: '12px'
                }}
              >
                <div 
                  className="text-3xl font-bold"
                  style={{ 
                    color: shouldFlipView ? rightPlayerStyle.color : leftPlayerStyle.color,
                    textShadow: `0 0 15px ${shouldFlipView ? rightPlayerStyle.color : leftPlayerStyle.color}40`,
                    letterSpacing: '0.05em',
                    fontFamily: 'monospace'
                  }}
                >
                  {displayScores.opponentScore}
                </div>
                <div className="text-xs text-white/60 mt-2" style={{ letterSpacing: '0.05em' }}>
                  {shouldFlipView ? rightPlayerStyle.name : leftPlayerStyle.name}
                </div>
              </div>
            </div>
            {isHost && (
              <button
                onClick={() => {
                  soundManager.playSelect()
                  
                  // If we have 3+ players and winner/loser tracked, rotate players
                  if (players.length >= 3 && winnerUserProfileId && loserUserProfileId) {
                    // Emit rotation request to server
                    if (socketRef.current && roomId) {
                      socketRef.current.emit('rotate-players', {
                        roomId,
                        winnerUserProfileId,
                        loserUserProfileId
                      })
                    }
                  }
                  
                  // Reset game state
                  gameStateRef.current = 'waiting'
                  setGameState('waiting')
                  setLeftScore(0)
                  setRightScore(0)
                  leftScoreRef.current = 0
                  rightScoreRef.current = 0
                  setWinnerUserProfileId(null)
                  setLoserUserProfileId(null)
                  setGameStartTime(null)
                  
                  // Broadcast game reset to other players (use pong/network.js)
                  if (roomId) {
                    emitGameState(roomId, {
                      state: 'waiting',
                      topPaddleX: topPaddleXRef.current,
                      bottomPaddleX: bottomPaddleXRef.current,
                      ballX: GAME_WIDTH / 2,
                      ballY: GAME_HEIGHT / 2,
                      ballVelX: 0,
                      ballVelY: 0,
                      leftScore: 0,
                      rightScore: 0
                    })
                  }
                }}
                className="px-large py-medium text-lg font-bold text-white border rounded-xl hover:bg-white hover:text-black transition-all duration-300 cursor-pointer hover:scale-105 hover:shadow-lg hover:shadow-white/10"
                style={{
                  borderColor: 'rgba(255, 255, 255, 0.3)',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
                  borderRadius: '12px',
                  letterSpacing: '0.05em',
                  animation: 'scaleIn 0.6s cubic-bezier(0.4, 0, 0.2, 1) 0.5s both',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                }}
              >
                {players.length >= 3 ? 'Next Game (Winner Stays)' : 'Play Again'}
              </button>
            )}
          </div>
        )}
        </div>
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

export default Pong

