import { useState, useEffect, useRef, useCallback } from 'react'
import { getSocket } from '../utils/socket'
import { getCurrentProfile } from '../utils/profiles'
import { isCPUProfile } from '../utils/cpuPlayer'
import { useRoom } from '../multiplayer/RoomProvider'
import { emitPlayerMove, emitGameStart, emitGameState, subscribeToMagnetEvents } from '../games/magnet-mayhem/network'
import soundManager from '../utils/sounds'
import Notification from './Notification'

const GAME_WIDTH = 600
const GAME_HEIGHT = 600
const ARENA_RADIUS = 250
const PLAYER_SIZE = 50 // Increased from 30 for better visibility and easier collisions
const PLAYER_SPEED = 3
const FRICTION = 0.92 // Reduced friction for more momentum
const COLLISION_BOUNCE = 3.0 // Increased bounce strength for more bouncy collisions
const MIN_PLAYERS = 3
const WIN_SCORE = 1 // First to eliminate someone wins the round

function MagnetMayhem({ roomId, isHost: propIsHost, onLeave, onRoomCreated, playerName }) {
  const roomState = useRoom(roomId)
  const [currentProfile, setCurrentProfile] = useState(null)
  
  const players = roomState.players || []
  const hostUserProfileId = roomState.hostUserProfileId
  const isHost = currentProfile?.id ? roomState.isHost(currentProfile.id) : propIsHost || false
  
  const [gameState, setGameState] = useState('waiting') // waiting, countdown, playing, gameover
  const [playerPositions, setPlayerPositions] = useState(new Map()) // Map<userProfileId, {x, y}>
  const [playerVelocities, setPlayerVelocities] = useState(new Map()) // Map<userProfileId, {vx, vy}>
  const [eliminatedPlayers, setEliminatedPlayers] = useState(new Set()) // Set<userProfileId>
  const [error, setError] = useState(null)
  const [notification, setNotification] = useState(null)
  const [countdown, setCountdown] = useState(null)
  const [winnerUserProfileId, setWinnerUserProfileId] = useState(null)
  const [renderFrame, setRenderFrame] = useState(0) // Force re-render every frame for host
  const [touchBounces, setTouchBounces] = useState([]) // Array of {x, y, id, timestamp} for bounce effects
  const [explosions, setExplosions] = useState([]) // Array of {x, y, id, timestamp, color} for explosion effects
  
  const socketRef = useRef(null)
  const gameLoopRef = useRef(null)
  const gameStateRef = useRef('waiting')
  const playerPositionsRef = useRef(new Map())
  const playerVelocitiesRef = useRef(new Map())
  const eliminatedPlayersRef = useRef(new Set())
  const socketInitializedRef = useRef(false)
  const playerIndexRef = useRef(0)
  const keysPressedRef = useRef(new Set())
  const lastMoveEmitRef = useRef(0)
  const MOVE_EMIT_THROTTLE = 33 // ~30 Hz
  const frameCounterRef = useRef(0) // Force React to see state updates as new
  const touchTargetRef = useRef({ x: null, y: null }) // Target position for touch movement
  
  const [isCPU, setIsCPU] = useState(false)

  // Load current profile
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const profile = await getCurrentProfile()
        setCurrentProfile(profile)
        setIsCPU(isCPUProfile(profile))
      } catch (err) {
        console.error('[MagnetMayhem] Error loading profile:', err)
      }
    }
    loadProfile()
  }, [])
  
  // Calculate player index
  useEffect(() => {
    if (currentProfile?.id && players.length > 0) {
      const myIndex = players.findIndex(p => p.userProfileId && String(p.userProfileId) === String(currentProfile.id))
      playerIndexRef.current = myIndex >= 0 ? myIndex : 0
    }
  }, [currentProfile?.id, players])

  // Initialize socket
  useEffect(() => {
    if (socketInitializedRef.current) return

    const socket = getSocket()
    socketRef.current = socket
    socketInitializedRef.current = true

    socket.on('connect_error', (error) => {
      console.error('[MagnetMayhem] Socket connection error:', error)
    })

    socket.on('disconnect', (reason) => {
      console.log('[MagnetMayhem] Socket disconnected:', reason)
      if (reason === 'io server disconnect') {
        socket.connect()
      }
    })

    // Subscribe to magnet mayhem events
    const cleanup = subscribeToMagnetEvents({
      onGameStart: ({ gameState: startGameState }) => {
        if (!isHost && startGameState) {
          setGameState('countdown')
          gameStateRef.current = 'countdown'
          setCountdown(3)
          
          const countdownInterval = setInterval(() => {
            setCountdown(prev => {
              if (prev <= 1) {
                clearInterval(countdownInterval)
                gameStateRef.current = 'playing'
                setGameState('playing')
                return null
              }
              soundManager.playSelect()
              return prev - 1
            })
          }, 1000)
          
          // Initialize positions from game state
          if (startGameState.players) {
            const newPositions = new Map()
            const newVelocities = new Map()
            
            startGameState.players.forEach(({ userProfileId, x, y, vx, vy }) => {
              newPositions.set(userProfileId, { x, y })
              newVelocities.set(userProfileId, { vx: vx || 0, vy: vy || 0 })
            })
            
            setPlayerPositions(newPositions)
            setPlayerVelocities(newVelocities)
            playerPositionsRef.current = newPositions
            playerVelocitiesRef.current = newVelocities
          }
        }
      },
      onGameState: (gameState) => {
        // Host should never process game state updates (they are the source of truth)
        if (isHost) return
        
        // Update positions, velocities from host
        if (gameState.players) {
          const newPositions = new Map()
          const newVelocities = new Map()
          const newEliminated = new Set()
          
          gameState.players.forEach(({ userProfileId, x, y, vx, vy, eliminated }) => {
            newPositions.set(userProfileId, { x, y })
            newVelocities.set(userProfileId, { vx: vx || 0, vy: vy || 0 })
            if (eliminated) {
              newEliminated.add(userProfileId)
            }
          })
          
          setPlayerPositions(newPositions)
          setPlayerVelocities(newVelocities)
          setEliminatedPlayers(newEliminated)
          playerPositionsRef.current = newPositions
          playerVelocitiesRef.current = newVelocities
          eliminatedPlayersRef.current = newEliminated
        }
        
        if (gameState.state && gameState.state !== gameStateRef.current) {
          setGameState(gameState.state)
          gameStateRef.current = gameState.state
          if (gameState.state === 'gameover' && gameState.winner) {
            setWinnerUserProfileId(gameState.winner)
            soundManager.playGameOver()
          }
        }
      },
      onPlayerMove: ({ userProfileId, x, y, vx, vy }) => {
        // Update other players' positions (client-side prediction)
        if (userProfileId !== currentProfile?.id) {
          setPlayerPositions(prev => {
            const next = new Map(prev)
            if (next.has(userProfileId)) {
              next.set(userProfileId, { x, y })
            }
            return next
          })
          setPlayerVelocities(prev => {
            const next = new Map(prev)
            if (next.has(userProfileId)) {
              next.set(userProfileId, { vx, vy })
            }
            return next
          })
        }
      },
    })

    socket.on('room-error', ({ message }) => {
      console.error('Room error:', message)
      setError(message)
      setTimeout(() => {
        setError(null)
        if (onLeave) {
          onLeave()
        }
      }, 5000)
    })

    return () => {
      cleanup()
      socketInitializedRef.current = false
    }
  }, [roomId, isHost, currentProfile?.id, onLeave])

  // Initialize player positions in a circle
  const initializePositions = useCallback(() => {
    const newPositions = new Map()
    const newVelocities = new Map()
    const centerX = GAME_WIDTH / 2
    const centerY = GAME_HEIGHT / 2
    const radius = ARENA_RADIUS * 0.6 // Start players in inner circle
    
    players.forEach((player, index) => {
      if (!player.userProfileId) return
      const angle = (index / players.length) * Math.PI * 2
      const x = centerX + Math.cos(angle) * radius
      const y = centerY + Math.sin(angle) * radius
      
      newPositions.set(player.userProfileId, { x, y })
      newVelocities.set(player.userProfileId, { vx: 0, vy: 0 })
    })
    
    setPlayerPositions(newPositions)
    setPlayerVelocities(newVelocities)
    playerPositionsRef.current = newPositions
    playerVelocitiesRef.current = newVelocities
    setEliminatedPlayers(new Set())
    eliminatedPlayersRef.current = new Set()
  }, [players])

  // Start game
  const startGame = useCallback(() => {
    if (gameStateRef.current !== 'waiting' || !isHost || players.length < MIN_PLAYERS) return
    
    soundManager.playSelect()
    initializePositions()
    
    setGameState('countdown')
    gameStateRef.current = 'countdown'
    setCountdown(3)
    
    const countdownInterval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownInterval)
          gameStateRef.current = 'playing'
          setGameState('playing')
          return null
        }
        soundManager.playSelect()
        return prev - 1
      })
    }, 1000)
    
    // Broadcast game start
    if (socketRef.current && roomId) {
      const playersData = Array.from(playerPositionsRef.current.entries()).map(([userProfileId, pos]) => {
        const vel = playerVelocitiesRef.current.get(userProfileId) || { vx: 0, vy: 0 }
        return {
          userProfileId,
          x: pos.x,
          y: pos.y,
          vx: vel.vx,
          vy: vel.vy
        }
      })
      
      emitGameStart(roomId, {
        players: playersData
      })
    }
  }, [isHost, players.length, roomId, initializePositions])

  // Handle player movement
  const movePlayer = useCallback((direction) => {
    if (gameStateRef.current !== 'playing' || !currentProfile?.id) return
    
    const myPos = playerPositionsRef.current.get(currentProfile.id)
    const myVel = playerVelocitiesRef.current.get(currentProfile.id) || { vx: 0, vy: 0 }
    
    if (!myPos) return
    
    // Apply movement force (reduced for better control and slower movement)
    const force = 0.25
    myVel.vx += direction.dx * force
    myVel.vy += direction.dy * force
    
    // Cap maximum velocity for better control
    const maxVel = 4
    const currentSpeed = Math.sqrt(myVel.vx * myVel.vx + myVel.vy * myVel.vy)
    if (currentSpeed > maxVel) {
      myVel.vx = (myVel.vx / currentSpeed) * maxVel
      myVel.vy = (myVel.vy / currentSpeed) * maxVel
    }
    
    // Update refs immediately
    playerVelocitiesRef.current.set(currentProfile.id, myVel)
    
    // Update React state for immediate visual feedback (especially for host)
    setPlayerVelocities(prev => {
      const next = new Map(prev)
      next.set(currentProfile.id, { ...myVel })
      return next
    })
    
    // Throttle network updates
    const now = Date.now()
    if (now - lastMoveEmitRef.current >= MOVE_EMIT_THROTTLE) {
      lastMoveEmitRef.current = now
      if (socketRef.current && roomId) {
        emitPlayerMove(roomId, currentProfile.id, myPos.x, myPos.y, myVel.vx, myVel.vy)
      }
    }
  }, [currentProfile?.id, roomId])


  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (gameStateRef.current === 'waiting' && e.code === 'Space' && isHost) {
        e.preventDefault()
        startGame()
        return
      }
      
      if (gameStateRef.current !== 'playing') return
      
      keysPressedRef.current.add(e.key)
      
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault()
        movePlayer({ dx: 0, dy: -1 })
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        e.preventDefault()
        movePlayer({ dx: 0, dy: 1 })
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        movePlayer({ dx: -1, dy: 0 })
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        movePlayer({ dx: 1, dy: 0 })
      }
    }

    const handleKeyUp = (e) => {
      keysPressedRef.current.delete(e.key)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [startGame, movePlayer, isHost])

  // Continuous movement for held keys and touch
  useEffect(() => {
    if (gameStateRef.current !== 'playing') return

    const interval = setInterval(() => {
      const keys = Array.from(keysPressedRef.current)
      let dx = 0
      let dy = 0

      // Keyboard movement
      if (keys.includes('ArrowUp') || keys.includes('w') || keys.includes('W')) dy -= 1
      if (keys.includes('ArrowDown') || keys.includes('s') || keys.includes('S')) dy += 1
      if (keys.includes('ArrowLeft') || keys.includes('a') || keys.includes('A')) dx -= 1
      if (keys.includes('ArrowRight') || keys.includes('d') || keys.includes('D')) dx += 1

      // Touch movement - move toward touch target
      if (touchTargetRef.current.x !== null && touchTargetRef.current.y !== null && currentProfile?.id) {
        const myPos = playerPositionsRef.current.get(currentProfile.id)
        if (myPos) {
          const targetX = touchTargetRef.current.x
          const targetY = touchTargetRef.current.y
          const deltaX = targetX - myPos.x
          const deltaY = targetY - myPos.y
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
          
          // Only move if target is far enough away (avoid jitter)
          if (distance > 5) {
            // Normalize direction
            dx += deltaX / distance
            dy += deltaY / distance
          }
        }
      }

      if (dx !== 0 || dy !== 0) {
        // Normalize combined direction if both keyboard and touch are active
        const magnitude = Math.sqrt(dx * dx + dy * dy)
        if (magnitude > 1) {
          dx /= magnitude
          dy /= magnitude
        }
        movePlayer({ dx, dy })
      }
    }, 16) // ~60fps

    return () => clearInterval(interval)
  }, [gameState, movePlayer, currentProfile?.id])

  // Touch controls
  const handleTouchStart = useCallback((e) => {
    if (gameStateRef.current !== 'playing' || !currentProfile?.id) return
    
    const touch = e.touches[0]
    const rect = e.currentTarget.getBoundingClientRect()
    const touchX = touch.clientX - rect.left
    const touchY = touch.clientY - rect.top
    
    e.preventDefault()
    
    // Set touch target for movement
    touchTargetRef.current = { x: touchX, y: touchY }
    
    // Create bounce effect
    const bounceId = Date.now() + Math.random()
    setTouchBounces(prev => [...prev, { x: touchX, y: touchY, id: bounceId, timestamp: Date.now() }])
    
    // Remove bounce after animation completes
    setTimeout(() => {
      setTouchBounces(prev => prev.filter(b => b.id !== bounceId))
    }, 600) // Animation duration
  }, [currentProfile?.id])

  const handleTouchMove = useCallback((e) => {
    if (gameStateRef.current !== 'playing' || !currentProfile?.id) return
    
    const touch = e.touches[0]
    const rect = e.currentTarget.getBoundingClientRect()
    const touchX = touch.clientX - rect.left
    const touchY = touch.clientY - rect.top
    
    e.preventDefault()
    
    // Update touch target as finger moves
    touchTargetRef.current = { x: touchX, y: touchY }
  }, [currentProfile?.id])

  const handleTouchEnd = useCallback((e) => {
    e.preventDefault()
    
    // Clear touch target
    touchTargetRef.current = { x: null, y: null }
  }, [])

  // Sync refs with state
  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])

  // Animate touch bounce effects
  useEffect(() => {
    if (touchBounces.length === 0) return

    let animationFrame
    let isRunning = true
    
    const animateBounces = () => {
      if (!isRunning) return
      
      const now = Date.now()
      setTouchBounces(prev => {
        const filtered = prev.filter(bounce => {
          const age = now - bounce.timestamp
          return age < 600 // Keep bounces that are less than 600ms old
        })
        
        // Continue animation if there are still bounces
        if (filtered.length > 0 && isRunning) {
          animationFrame = requestAnimationFrame(animateBounces)
        }
        
        return filtered
      })
    }

    animationFrame = requestAnimationFrame(animateBounces)
    return () => {
      isRunning = false
      if (animationFrame) cancelAnimationFrame(animationFrame)
    }
  }, [touchBounces.length])

  // Animate explosion effects
  useEffect(() => {
    if (explosions.length === 0) return

    let animationFrame
    let isRunning = true
    
    const animateExplosions = () => {
      if (!isRunning) return
      
      const now = Date.now()
      setExplosions(prev => {
        const filtered = prev.filter(explosion => {
          const age = now - explosion.timestamp
          return age < 800 // Keep explosions that are less than 800ms old
        })
        
        // Continue animation if there are still explosions
        if (filtered.length > 0 && isRunning) {
          animationFrame = requestAnimationFrame(animateExplosions)
        }
        
        return filtered
      })
    }

    animationFrame = requestAnimationFrame(animateExplosions)
    return () => {
      isRunning = false
      if (animationFrame) cancelAnimationFrame(animationFrame)
    }
  }, [explosions.length])

  // Check if player is out of bounds
  const isOutOfBounds = useCallback((x, y) => {
    const centerX = GAME_WIDTH / 2
    const centerY = GAME_HEIGHT / 2
    const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2)
    return distance > ARENA_RADIUS
  }, [])

  // Game loop (host only)
  useEffect(() => {
    if (gameState !== 'playing' || !isHost) return

    const gameLoop = () => {
      if (gameStateRef.current !== 'playing') return

      const centerX = GAME_WIDTH / 2
      const centerY = GAME_HEIGHT / 2
      const positions = playerPositionsRef.current
      const velocities = playerVelocitiesRef.current
      const eliminated = eliminatedPlayersRef.current
      
      // Update physics for all active players
      // Create new position objects to ensure React detects changes
      const updatedPositions = new Map()
      const updatedVelocities = new Map()
      
      positions.forEach((pos, userProfileId) => {
        if (eliminated.has(userProfileId)) {
          // Keep eliminated players at their current position
          updatedPositions.set(userProfileId, { ...pos })
          return
        }
        
        let vel = velocities.get(userProfileId) || { vx: 0, vy: 0 }
        vel = { ...vel } // Create new velocity object
        
        // Check collisions with other players and bounce
        positions.forEach((otherPos, otherId) => {
          if (otherId === userProfileId || eliminated.has(otherId)) return
          // Only process collision once (when userProfileId < otherId to avoid double processing)
          if (userProfileId > otherId) return
          
          const dx = otherPos.x - pos.x
          const dy = otherPos.y - pos.y
          const distance = Math.sqrt(dx * dx + dy * dy)
          const minDistance = PLAYER_SIZE // Minimum distance between player centers
          
          // If players are colliding (too close)
          if (distance < minDistance && distance > 0.1) {
            // Get other player's velocity
            const otherVel = velocities.get(otherId) || { vx: 0, vy: 0 }
            const otherVelCopy = { ...otherVel } // Create copy for other player
            
            // Calculate collision normal (direction from this player to other)
            const normalX = dx / distance
            const normalY = dy / distance
            
            // Calculate relative velocity
            const relVelX = vel.vx - otherVel.vx
            const relVelY = vel.vy - otherVel.vy
            
            // Calculate relative velocity along collision normal
            const relVelDotNormal = relVelX * normalX + relVelY * normalY
            
            // Separate players to prevent overlap (strong separation)
            const overlap = minDistance - distance
            const separationStrength = 2.0 // Strong separation to prevent sticking
            const separationX = normalX * overlap * separationStrength * 0.5
            const separationY = normalY * overlap * separationStrength * 0.5
            
            // Apply strong continuous repulsion force when too close (prevents sticking)
            const repulsionForce = 3.0 / (distance + 0.1) // Strong repulsion that increases as distance decreases
            vel.vx -= normalX * repulsionForce
            vel.vy -= normalY * repulsionForce
            otherVelCopy.vx += normalX * repulsionForce
            otherVelCopy.vy += normalY * repulsionForce
            
            // Also apply bounce based on relative velocity
            if (relVelDotNormal < 0) {
              const bounceImpulse = Math.abs(relVelDotNormal) * COLLISION_BOUNCE
              vel.vx -= bounceImpulse * normalX
              vel.vy -= bounceImpulse * normalY
              otherVelCopy.vx += bounceImpulse * normalX
              otherVelCopy.vy += bounceImpulse * normalY
            }
            
            // Update other player's velocity
            updatedVelocities.set(otherId, otherVelCopy)
            
            // Update positions to separate (modify the position objects immediately)
            pos.x -= separationX
            pos.y -= separationY
            otherPos.x += separationX
            otherPos.y += separationY
          }
        })
        
        // Apply friction
        vel.vx *= FRICTION
        vel.vy *= FRICTION
        
        // Calculate new position
        let newX = pos.x + vel.vx
        let newY = pos.y + vel.vy
        
        // Check if eliminated (out of bounds) - players can leave the circle
        if (isOutOfBounds(newX, newY) && !eliminated.has(userProfileId)) {
          eliminated.add(userProfileId)
          soundManager.playCollision()
          
          // Create explosion effect at player's position
          const player = players.find(p => p.userProfileId && String(p.userProfileId) === String(userProfileId))
          const playerColor = player?.color || '#FFFFFF'
          const explosionId = Date.now() + Math.random()
          setExplosions(prev => [...prev, { 
            x: newX, 
            y: newY, 
            id: explosionId, 
            timestamp: Date.now(),
            color: playerColor
          }])
          
          // Remove explosion after animation completes
          setTimeout(() => {
            setExplosions(prev => prev.filter(e => e.id !== explosionId))
          }, 800) // Animation duration
        }
        
        // Create new position object (important for React to detect changes)
        const newPos = { x: newX, y: newY }
        updatedPositions.set(userProfileId, newPos)
        updatedVelocities.set(userProfileId, vel)
        
        // Update refs immediately for next frame calculations
        playerPositionsRef.current.set(userProfileId, newPos)
        playerVelocitiesRef.current.set(userProfileId, vel)
      })
      
      // Check for game over (only one player remaining)
      const activePlayers = Array.from(positions.keys()).filter(id => !eliminated.has(id))
      if (activePlayers.length <= 1 && positions.size >= MIN_PLAYERS) {
        gameStateRef.current = 'gameover'
        setGameState('gameover')
        const winner = activePlayers[0] || null
        setWinnerUserProfileId(winner)
        soundManager.playGameOver()
        
        // Record win if there's a winner
        if (winner) {
          const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
          const serverUrl = `${protocol}//${window.location.hostname}:8000`
          fetch(`${serverUrl}/api/wins/record`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userProfileId: winner,
              gameType: 'magnet-mayhem'
            })
          }).catch(err => console.error('[MagnetMayhem] Error recording win:', err))
        }
        
        // Broadcast gameover
        if (socketRef.current && roomId) {
          const playersData = Array.from(updatedPositions.entries()).map(([userProfileId, pos]) => {
            const vel = updatedVelocities.get(userProfileId) || { vx: 0, vy: 0 }
            return {
              userProfileId,
              x: pos.x,
              y: pos.y,
              vx: vel.vx,
              vy: vel.vy,
              eliminated: eliminated.has(userProfileId)
            }
          })
          
          emitGameState(roomId, {
            state: 'gameover',
            players: playersData,
            winner
          })
        }
      }
      
      // Update refs first (for next frame calculations)
      playerPositionsRef.current = updatedPositions
      playerVelocitiesRef.current = updatedVelocities
      
      // Update React state - create new Maps to ensure React detects changes
      // Increment render frame to force React to see this as a new update every frame
      frameCounterRef.current += 1
      setRenderFrame(frameCounterRef.current)
      setPlayerPositions(new Map(updatedPositions))
      setPlayerVelocities(new Map(updatedVelocities))
      setEliminatedPlayers(new Set(eliminated))
      
      // Broadcast game state (throttled to reduce network traffic)
      const now = Date.now()
      if (socketRef.current && roomId && (now - lastMoveEmitRef.current >= MOVE_EMIT_THROTTLE * 2)) {
        lastMoveEmitRef.current = now
        const playersData = Array.from(updatedPositions.entries()).map(([userProfileId, pos]) => {
          const vel = updatedVelocities.get(userProfileId) || { vx: 0, vy: 0 }
          return {
            userProfileId,
            x: pos.x,
            y: pos.y,
            vx: vel.vx,
            vy: vel.vy,
            eliminated: eliminated.has(userProfileId)
          }
        })
        
        emitGameState(roomId, {
          state: 'playing',
          players: playersData
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
  }, [gameState, isHost, roomId, isOutOfBounds, players])

  // Get player style
  const getPlayerStyle = useCallback((userProfileId) => {
    const player = players.find(p => p.userProfileId && String(p.userProfileId) === String(userProfileId))
    if (player) {
      return {
        emoji: player.emoji || '⚪',
        color: player.color || '#FFFFFF',
        name: player.name || 'Player'
      }
    }
    return { emoji: '⚪', color: '#FFFFFF', name: 'Player' }
  }, [players])

  // Calculate responsive scale for mobile
  const [gameScale, setGameScale] = useState(1)
  
  useEffect(() => {
    const calculateScale = () => {
      const availableHeight = window.innerHeight * 0.7
      const availableWidth = window.innerWidth
      
      const scaleByWidth = availableWidth / GAME_WIDTH
      const scaleByHeight = availableHeight / GAME_HEIGHT
      
      const scale = Math.min(scaleByWidth, scaleByHeight, 1)
      setGameScale(Math.max(scale, 0.3))
    }
    
    calculateScale()
    window.addEventListener('resize', calculateScale)
    return () => window.removeEventListener('resize', calculateScale)
  }, [])

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
      {/* Error Notification */}
      {error && (
        <div 
          className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 border rounded-xl px-6 py-4 text-white text-center max-w-md backdrop-blur-xl"
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
            className="mt-3 px-4 py-2 text-sm border rounded-lg hover:bg-white hover:text-red-600 transition-all duration-300 cursor-pointer font-medium"
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
          height: '70vh',
          transform: `${gameScale < 1 ? `scale(${gameScale})` : ''}`,
          transformOrigin: 'center center',
          overflow: 'visible',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {/* Game Arena */}
        <div
          className="relative rounded-xl bg-black overflow-hidden shadow-2xl"
          style={{ 
            width: GAME_WIDTH, 
            height: '100%',
            minHeight: GAME_HEIGHT,
            touchAction: 'none',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.1)',
            backgroundImage: `
              radial-gradient(circle at 2px 2px, rgba(255, 255, 255, 0.05) 1px, transparent 0),
              linear-gradient(to bottom, transparent 0%, rgba(255, 255, 255, 0.02) 50%, transparent 100%)
            `,
            backgroundSize: '40px 40px, 100% 100%'
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
        {/* Arena Circle */}
        <svg className="absolute inset-0 pointer-events-none z-0" width={GAME_WIDTH} height={GAME_HEIGHT}>
          {/* Danger Zone (inner warning circle) */}
          <circle
            cx={GAME_WIDTH / 2}
            cy={GAME_HEIGHT / 2}
            r={ARENA_RADIUS * 0.85}
            fill="none"
            stroke="rgba(255, 68, 68, 0.2)"
            strokeWidth="1"
            strokeDasharray="5,5"
          />
          {/* Outer Arena Boundary */}
          <circle
            cx={GAME_WIDTH / 2}
            cy={GAME_HEIGHT / 2}
            r={ARENA_RADIUS}
            fill="none"
            stroke="rgba(255, 255, 255, 0.3)"
            strokeWidth="2"
            strokeDasharray="10,5"
          />
        </svg>


        {/* Touch Bounce Effects */}
        {touchBounces.map((bounce) => {
          const age = Date.now() - bounce.timestamp
          const progress = Math.min(age / 600, 1) // 600ms animation
          // Bounce effect: start small, bounce up, then settle (ease-out-bounce)
          const bounceEase = progress < 0.6
            ? progress * (1 / 0.6) // First 60%: grow quickly
            : 1 - Math.pow((progress - 0.6) / 0.4, 2) // Last 40%: ease out
          const scale = 0.3 + bounceEase * 1.7 // Start at 0.3, grow to 2.0
          const opacity = 1 - progress // Fade out
          const size = 50
          
          return (
            <div
              key={bounce.id}
              className="absolute pointer-events-none z-20 rounded-full border-2"
              style={{
                left: bounce.x - size / 2,
                top: bounce.y - size / 2,
                width: size,
                height: size,
                borderColor: `rgba(255, 255, 255, ${opacity * 0.9})`,
                backgroundColor: `rgba(255, 255, 255, ${opacity * 0.15})`,
                boxShadow: `0 0 ${size * scale * 0.8}px rgba(255, 255, 255, ${opacity * 0.6})`,
                transform: `scale(${scale})`,
                transition: 'none',
                willChange: 'transform, opacity'
              }}
            />
          )
        })}

        {/* Explosion Effects */}
        {explosions.map((explosion) => {
          const age = Date.now() - explosion.timestamp
          const progress = Math.min(age / 800, 1) // 800ms animation
          // Explosion effect: quick expansion then fade
          const explosionEase = progress < 0.3
            ? progress * (1 / 0.3) // First 30%: explode quickly
            : 1 - Math.pow((progress - 0.3) / 0.7, 3) // Last 70%: fade out
          const scale = 0.5 + explosionEase * 3.5 // Start at 0.5, grow to 4.0
          const opacity = 1 - progress // Fade out
          const size = 60
          
          // Create multiple particle rings for explosion effect
          return (
            <div key={explosion.id} className="absolute pointer-events-none z-30" style={{ left: explosion.x, top: explosion.y }}>
              {/* Main explosion circle */}
              <div
                className="absolute rounded-full"
                style={{
                  left: -size / 2,
                  top: -size / 2,
                  width: size,
                  height: size,
                  backgroundColor: explosion.color,
                  opacity: opacity * 0.8,
                  boxShadow: `0 0 ${size * scale}px ${explosion.color}, 0 0 ${size * scale * 1.5}px ${explosion.color}80`,
                  transform: `scale(${scale})`,
                  transition: 'none',
                  willChange: 'transform, opacity'
                }}
              />
              {/* Outer explosion ring */}
              <div
                className="absolute rounded-full border-2"
                style={{
                  left: -size / 2,
                  top: -size / 2,
                  width: size,
                  height: size,
                  borderColor: explosion.color,
                  backgroundColor: 'transparent',
                  opacity: opacity * 0.6,
                  boxShadow: `0 0 ${size * scale * 0.8}px ${explosion.color}`,
                  transform: `scale(${scale * 1.2})`,
                  transition: 'none',
                  willChange: 'transform, opacity'
                }}
              />
              {/* Inner bright core */}
              <div
                className="absolute rounded-full"
                style={{
                  left: -size / 4,
                  top: -size / 4,
                  width: size / 2,
                  height: size / 2,
                  backgroundColor: '#FFFFFF',
                  opacity: opacity * 0.9,
                  boxShadow: `0 0 ${size * scale * 0.5}px #FFFFFF`,
                  transform: `scale(${scale * 0.5})`,
                  transition: 'none',
                  willChange: 'transform, opacity'
                }}
              />
            </div>
          )
        })}

        {/* Players */}
        {Array.from(playerPositions.entries()).map(([userProfileId, pos]) => {
          if (eliminatedPlayers.has(userProfileId)) return null
          
          const style = getPlayerStyle(userProfileId)
          const isMe = currentProfile?.id && String(userProfileId) === String(currentProfile.id)
          
          // Check if player is near edge (danger zone)
          const centerX = GAME_WIDTH / 2
          const centerY = GAME_HEIGHT / 2
          const distanceFromCenter = Math.sqrt((pos.x - centerX) ** 2 + (pos.y - centerY) ** 2)
          const dangerZone = ARENA_RADIUS * 0.85 // 85% of arena radius
          const isInDanger = distanceFromCenter > dangerZone
          
          return (
            <div key={userProfileId} className="absolute z-10" style={{ left: pos.x, top: pos.y }}>
              {/* Player Name Label */}
              <div
                className="absolute -top-8 left-1/2 transform -translate-x-1/2 whitespace-nowrap pointer-events-none"
                style={{
                  color: style.color,
                  textShadow: `0 0 8px ${style.color}80, 0 2px 4px rgba(0, 0, 0, 0.8)`,
                  fontSize: '11px',
                  fontWeight: 'bold',
                  opacity: isMe ? 1 : 0.7
                }}
              >
                {isMe ? 'YOU' : style.name}
              </div>
              
              {/* Danger Warning Indicator */}
              {isInDanger && (
                <div
                  className="absolute -top-12 left-1/2 transform -translate-x-1/2 pointer-events-none animate-pulse"
                  style={{
                    color: '#FF4444',
                    fontSize: '16px',
                    textShadow: '0 0 10px #FF4444'
                  }}
                >
                  ⚠️
                </div>
              )}
              
              {/* Player Circle */}
              <div
                className="absolute rounded-full border-2 flex items-center justify-center"
                style={{
                  left: -PLAYER_SIZE / 2,
                  top: -PLAYER_SIZE / 2,
                  width: PLAYER_SIZE,
                  height: PLAYER_SIZE,
                  borderColor: style.color,
                  backgroundColor: isMe ? style.color : `${style.color}80`,
                  opacity: isMe ? 1 : 0.8,
                  transform: `translate3d(0, 0, 0)`,
                  boxShadow: isInDanger
                    ? `0 0 20px ${style.color}80, 0 0 40px #FF444440, inset 0 0 10px #FF444420`
                    : `0 0 10px ${style.color}40, 0 0 20px ${style.color}20`,
                  willChange: 'transform',
                  transition: 'none',
                  animation: isInDanger ? 'dangerPulse 0.5s ease-in-out infinite' : 'none'
                }}
              >
                <span className="text-lg">{style.emoji}</span>
              </div>
            </div>
          )
        })}

        {/* Eliminated Players (ghosted) */}
        {Array.from(playerPositions.entries()).map(([userProfileId, pos]) => {
          if (!eliminatedPlayers.has(userProfileId)) return null
          
          const style = getPlayerStyle(userProfileId)
          
          return (
            <div
              key={`eliminated-${userProfileId}`}
              className="absolute rounded-full border-2 flex items-center justify-center opacity-30"
              style={{
                left: pos.x - PLAYER_SIZE / 2,
                top: pos.y - PLAYER_SIZE / 2,
                width: PLAYER_SIZE,
                height: PLAYER_SIZE,
                borderColor: style.color,
                backgroundColor: `${style.color}40`
              }}
            >
              <span className="text-lg">{style.emoji}</span>
            </div>
          )
        })}

        {/* Countdown */}
        {gameState === 'countdown' && countdown !== null && (
          <div 
            className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-sm z-40"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.85)'
            }}
          >
            <div
              className="text-8xl sm:text-9xl font-bold mb-4"
              style={{
                color: countdown === 'GO!' ? '#4ADE80' : '#FFFFFF',
                textShadow: countdown === 'GO!' 
                  ? '0 0 60px rgba(74, 222, 128, 0.9), 0 0 120px rgba(74, 222, 128, 0.5)'
                  : '0 0 40px rgba(255, 255, 255, 0.8), 0 0 80px rgba(255, 255, 255, 0.4)',
                animation: countdown === 'GO!' ? 'goPulse 0.5s ease-out' : 'countdownPulse 1s ease-out',
                transform: countdown === 'GO!' ? 'scale(1.2)' : 'scale(1)'
              }}
            >
              {countdown}
            </div>
            {countdown !== 'GO!' && (
              <p className="text-white/60 text-sm font-medium animate-pulse">
                Get ready!
              </p>
            )}
          </div>
        )}

        {/* Waiting Screen */}
        {gameState === 'waiting' && (
          <div 
            className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-sm"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              padding: '16px'
            }}
          >
            <h1 className="text-2xl sm:text-3xl font-bold mb-4 text-white">MAGNET MAYHEM</h1>
            
            {/* Player Display */}
            {players.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-4 mb-4">
                {players.map((player, idx) => {
                  const style = getPlayerStyle(player.userProfileId)
                  return (
                    <div key={player.userProfileId || idx} className="flex flex-col items-center gap-2">
                      <div className="text-4xl">{style.emoji}</div>
                      <div 
                        className="text-sm font-semibold"
                        style={{ color: style.color }}
                      >
                        {style.name}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            
            <p className="text-xs text-white/60 mb-4">
              {players.length}/{MIN_PLAYERS}+ players
            </p>
            
            {isHost && (
              <button
                onClick={startGame}
                disabled={players.length < MIN_PLAYERS}
                className="px-3 py-1.5 text-sm font-bold text-white border rounded-lg hover:bg-white hover:text-black transition-all duration-300 cursor-pointer hover:scale-105 hover:shadow-lg hover:shadow-white/10 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                style={{
                  borderColor: 'rgba(255, 255, 255, 0.3)',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
                }}
              >
                {players.length < MIN_PLAYERS ? `Need ${MIN_PLAYERS - players.length} more player(s)` : 'Start Game'}
              </button>
            )}
            {!isHost && (
              <p className="text-xs text-white/60">Waiting for host to start...</p>
            )}
            <p className="text-xs text-white/40 mt-4 px-4 text-center">
              Touch to move | Push others out of the arena!
            </p>
          </div>
        )}

        {/* Game Over Screen */}
        {gameState === 'gameover' && (
          <div 
            className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-md z-40"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.95)',
              animation: 'fadeIn 0.3s ease-out'
            }}
          >
            {winnerUserProfileId && (
              <div 
                className="text-6xl sm:text-8xl mb-6"
                style={{
                  animation: 'winnerBounce 0.6s ease-out',
                  filter: 'drop-shadow(0 0 20px rgba(255, 255, 255, 0.5))'
                }}
              >
                {getPlayerStyle(winnerUserProfileId).emoji}
              </div>
            )}
            <h2 
              className="text-3xl sm:text-4xl font-bold mb-2 text-white"
              style={{
                animation: 'slideDown 0.4s ease-out'
              }}
            >
              Game Over
            </h2>
            {winnerUserProfileId && (
              <p 
                className="text-xl sm:text-2xl mb-6 font-bold"
                style={{
                  animation: 'slideDown 0.5s ease-out',
                  color: getPlayerStyle(winnerUserProfileId).color,
                  textShadow: `0 0 30px ${getPlayerStyle(winnerUserProfileId).color}80, 0 0 60px ${getPlayerStyle(winnerUserProfileId).color}40`
                }}
              >
                {getPlayerStyle(winnerUserProfileId).name} Wins! 🎉
              </p>
            )}
            {!winnerUserProfileId && (
              <p className="text-lg mb-6 text-white/60">No winner this round</p>
            )}
            {isHost && (
              <button
                onClick={() => {
                  soundManager.playSelect()
                  gameStateRef.current = 'waiting'
                  setGameState('waiting')
                  setWinnerUserProfileId(null)
                  initializePositions()
                }}
                className="px-6 py-3 text-lg font-bold text-white border rounded-xl hover:bg-white hover:text-black transition-all duration-300 cursor-pointer hover:scale-105 hover:shadow-lg hover:shadow-white/10"
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

      {/* CSS Animations */}
      <style>{`
        @keyframes dangerPulse {
          0%, 100% { 
            box-shadow: 0 0 20px rgba(255, 68, 68, 0.5), 0 0 40px rgba(255, 68, 68, 0.3), inset 0 0 10px rgba(255, 68, 68, 0.2);
          }
          50% { 
            box-shadow: 0 0 30px rgba(255, 68, 68, 0.8), 0 0 60px rgba(255, 68, 68, 0.5), inset 0 0 15px rgba(255, 68, 68, 0.3);
          }
        }
        @keyframes countdownPulse {
          0% { 
            transform: scale(0.5);
            opacity: 0;
          }
          50% { 
            transform: scale(1.1);
          }
          100% { 
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes goPulse {
          0% { 
            transform: scale(0.8);
            opacity: 0;
          }
          50% { 
            transform: scale(1.3);
          }
          100% { 
            transform: scale(1.2);
            opacity: 1;
          }
        }
        @keyframes winnerBounce {
          0% { 
            transform: scale(0) rotate(-180deg);
            opacity: 0;
          }
          60% { 
            transform: scale(1.2) rotate(10deg);
          }
          80% { 
            transform: scale(0.9) rotate(-5deg);
          }
          100% { 
            transform: scale(1) rotate(0deg);
            opacity: 1;
          }
        }
        @keyframes slideDown {
          0% { 
            transform: translateY(-30px);
            opacity: 0;
          }
          100% { 
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes fadeIn {
          0% { 
            opacity: 0;
          }
          100% { 
            opacity: 1;
          }
        }
      `}</style>

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

export default MagnetMayhem

