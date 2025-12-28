import { useState, useEffect, useRef, useCallback } from 'react'
import { getSocket } from '../utils/socket'
import { getCurrentProfile } from '../utils/profiles'
import { isCPUProfile, cpuShouldSucceed, getCPUDelay, resetCPUMemory, cpuMemoryGame, updateCPUMemory, clearCPUMemoryForPair } from '../utils/cpuPlayer'
import { useRoom } from '../multiplayer/RoomProvider'
import { emitCardFlip, emitGameStart, emitGameState, subscribeToMemoryEvents } from '../games/memory/network'
import soundManager from '../utils/sounds'
import Notification from './Notification'

const GAME_WIDTH = 400
const GAME_HEIGHT = 600
const CARD_ROWS = 4
const CARD_COLS = 4
const TOTAL_CARDS = CARD_ROWS * CARD_COLS
const BASE_CARD_PAIRS = TOTAL_CARDS / 2 // 8 pairs for first game

// Card symbols - geometric patterns
const CARD_SYMBOLS = [
  'circle', 'square', 'triangle', 'diamond', 
  'hexagon', 'star', 'cross', 'plus',
  'wave', 'grid', 'dots', 'lines',
  'spiral', 'arrow', 'chevron', 'zigzag'
]

// Color palette for symbols
const SYMBOL_COLORS = [
  '#3B82F6', // blue
  '#EF4444', // red
  '#10B981', // green
  '#F59E0B', // amber
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
  '#6366F1', // indigo
  '#14B8A6', // teal
  '#F43F5E', // rose
  '#84CC16', // lime
  '#A855F7', // violet
  '#22C55E', // emerald
  '#0EA5E9', // sky
  '#FB7185'  // pink-400
]

function MemoryGame({ roomId, isHost: propIsHost, onLeave, onRoomCreated, playerName, onScoreUpdate }) {
  // Get room state from multiplayer foundation
  const roomState = useRoom(roomId)
  const [currentProfile, setCurrentProfile] = useState(null)
  
  // Derive values from room state
  const players = roomState.players || []
  const hostUserProfileId = roomState.hostUserProfileId
  const isHost = currentProfile?.id ? roomState.isHost(currentProfile.id) : propIsHost || false
  
  const [gameState, setGameState] = useState('waiting') // waiting, playing, gameover
  const [cards, setCards] = useState([]) // Array of {id, symbol, flipped, matched}
  const [flippedCards, setFlippedCards] = useState([]) // Indices of currently flipped cards (max 2)
  const [currentTurn, setCurrentTurn] = useState(null) // userProfileId of current player
  const [scores, setScores] = useState(new Map()) // Map<userProfileId, score>
  const [error, setError] = useState(null)
  const [notification, setNotification] = useState(null)
  const [matchAnimation, setMatchAnimation] = useState(null) // {card1, card2} indices
  const [difficultyLevel, setDifficultyLevel] = useState(0) // 0-3, increases after each game completion
  
  const socketRef = useRef(null)
  const gameStateRef = useRef('waiting')
  const cardsRef = useRef([])
  const flippedCardsRef = useRef([])
  const currentTurnRef = useRef(null)
  const scoresRef = useRef(new Map())
  const socketInitializedRef = useRef(false)
  const isProcessingMatchRef = useRef(false)
  
  const [isCPU, setIsCPU] = useState(false)

  // Load current profile
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const profile = await getCurrentProfile()
        setCurrentProfile(profile)
        setIsCPU(isCPUProfile(profile))
      } catch (err) {
        console.error('[MemoryGame] Error loading profile:', err)
      }
    }
    loadProfile()
  }, [])

  // Initialize socket connection
  useEffect(() => {
    if (!roomId || socketInitializedRef.current) return

    const socket = getSocket()
    socketRef.current = socket
    socketInitializedRef.current = true

    // Subscribe to Memory game events
    const cleanup = subscribeToMemoryEvents({
      onGameStart: ({ gameState: startGameState }) => {
        // All players (including host) should receive and sync the game start state
        console.log('[MemoryGame] Received game start event', { isHost, hasCards: !!startGameState?.cards, cardCount: startGameState?.cards?.length })
        if (startGameState) {
          setGameState('playing')
          gameStateRef.current = 'playing'
          if (startGameState.cards && startGameState.cards.length > 0) {
            setCards(startGameState.cards)
            cardsRef.current = startGameState.cards
            console.log('[MemoryGame] Set cards:', startGameState.cards.length)
          }
          setFlippedCards(startGameState.flippedCards || [])
          flippedCardsRef.current = startGameState.flippedCards || []
          setCurrentTurn(startGameState.currentTurn || null)
          currentTurnRef.current = startGameState.currentTurn || null
          if (startGameState.scores) {
            const scoresMap = new Map(Object.entries(startGameState.scores))
            setScores(scoresMap)
            scoresRef.current = scoresMap
          }
        }
      },
      onGameState: (gameState) => {
        // Update cards state for all players to keep in sync
        // Host broadcasts, but all players should see the same state
        console.log('[MemoryGame] Received game state update', { isHost, hasCards: !!gameState?.cards, cardCount: gameState?.cards?.length, gameState: gameState?.state })
        if (gameState.cards && gameState.cards.length > 0) {
          setCards(gameState.cards)
          cardsRef.current = gameState.cards
          console.log('[MemoryGame] Updated cards from game state:', gameState.cards.length)
        }
        if (gameState.flippedCards !== undefined) {
          setFlippedCards(gameState.flippedCards)
          flippedCardsRef.current = gameState.flippedCards
        }
        if (gameState.currentTurn !== undefined) {
          setCurrentTurn(gameState.currentTurn)
          currentTurnRef.current = gameState.currentTurn
        }
        if (gameState.scores) {
          const scoresMap = new Map(Object.entries(gameState.scores))
          setScores(scoresMap)
          scoresRef.current = scoresMap
        }
        if (gameState.state && gameState.state !== gameStateRef.current) {
          setGameState(gameState.state)
          gameStateRef.current = gameState.state
          if (gameState.state === 'gameover') {
            soundManager.playGameOver()
          }
        }
      },
      onCardFlip: ({ userProfileId, cardIndex }) => {
        // Any player flipped a card - update visual state for all players
        // Skip if this is our own flip (we already processed it locally)
        if (userProfileId === currentProfile?.id) {
          return
        }
        
        // Update card state if not already flipped
        setCards(prevCards => {
          const card = prevCards[cardIndex]
          if (!card || card.flipped || card.matched) {
            return prevCards // Already flipped or matched
          }
          
          // Flip the card
          const newCards = [...prevCards]
          newCards[cardIndex] = { ...newCards[cardIndex], flipped: true }
          cardsRef.current = newCards // Update ref immediately
          return newCards
        })
        
        // Update flipped cards list - IMPORTANT: Host needs this to process matches
        setFlippedCards(prev => {
          if (prev.includes(cardIndex)) {
            return prev // Already in list
          }
          const newFlipped = [...prev, cardIndex]
          flippedCardsRef.current = newFlipped // Update ref immediately
          return newFlipped
        })
        
        // Note: CPU does NOT learn from other players' flips - only remembers what it sees itself
        // This makes the game fair - CPU only knows what it has personally flipped
        
        // Play sound for visual feedback
        soundManager.playCardFlip()
      }
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
  }, [roomId, isHost, currentProfile?.id])

  // Calculate card pairs based on difficulty level
  const getCardPairsCount = useCallback(() => {
    // Level 0: 8 pairs (4x4 grid)
    // Level 1: 10 pairs (4x5 grid, but we'll use 4x4 with some cards removed or adjust)
    // Level 2: 12 pairs (4x6 grid, but we'll use 4x4 with all cards)
    // Level 3: 14 pairs (4x7 grid, but we'll use 4x4 with all cards)
    // Actually, let's increase to 5x4, 6x4, etc. or keep 4x4 and use more pairs
    // For simplicity, let's use: 8, 10, 12, 14 pairs (max 16 for 4x4 grid)
    const pairsByLevel = [8, 10, 12, 14]
    return pairsByLevel[Math.min(difficultyLevel, 3)]
  }, [difficultyLevel])

  // Initialize game cards
  const initializeCards = useCallback(() => {
    const cardPairsCount = getCardPairsCount()
    // Create pairs of symbols with colors
    const symbols = CARD_SYMBOLS.slice(0, cardPairsCount)
    const cardPairs = []
    symbols.forEach((symbol, index) => {
      const color = SYMBOL_COLORS[index % SYMBOL_COLORS.length]
      cardPairs.push({ id: index * 2, symbol, pairId: index, color })
      cardPairs.push({ id: index * 2 + 1, symbol, pairId: index, color })
    })
    
    // Shuffle cards
    const shuffled = [...cardPairs].sort(() => Math.random() - 0.5)
    
    // Create card objects with game state - all cards start face-down
    const newCards = shuffled.map((card, index) => ({
      ...card,
      index,
      flipped: false, // All cards start face-down
      matched: false
    }))
    
    return newCards
  }, [getCardPairsCount])

  // Start game
  const startGame = useCallback(() => {
    if (gameStateRef.current !== 'waiting' || !isHost) return
    
    soundManager.playCardShuffle()
    
    const newCards = initializeCards()
    
    // Reset CPU memory for all CPU players
    resetCPUMemory()
    
    // Initialize scores
    const initialScores = new Map()
    players.forEach(player => {
      if (player.userProfileId) {
        initialScores.set(player.userProfileId, 0)
      }
    })
    
    // Set first player's turn (first player in array)
    const firstPlayerId = players[0]?.userProfileId || null
    
    // Prepare game start state
    const gameStartState = {
      state: 'playing',
      cards: newCards,
      flippedCards: [],
      currentTurn: firstPlayerId,
      scores: Object.fromEntries(initialScores)
    }
    
    // Update local state first
    setCards(newCards)
    cardsRef.current = newCards
    setFlippedCards([])
    flippedCardsRef.current = []
    setScores(initialScores)
    scoresRef.current = initialScores
    setCurrentTurn(firstPlayerId)
    currentTurnRef.current = firstPlayerId
    setGameState('playing')
    gameStateRef.current = 'playing'
    
    // Broadcast game start to all players (including host for synchronization)
    // This ensures all players receive the cards
    if (roomId) {
      console.log('[MemoryGame] Host broadcasting game start with', newCards.length, 'cards')
      emitGameStart(roomId, gameStartState)
      // Also send immediate game state update to ensure cards are synced
      setTimeout(() => {
        emitGameState(roomId, gameStartState)
      }, 100)
    }
  }, [isHost, roomId, players, initializeCards])

  // Restart game (host only)
  const restartGame = useCallback(() => {
    if (!isHost) return
    
    soundManager.playCardShuffle()
    
    // Reset all game state
    const newCards = initializeCards()
    
    // Reset CPU memory for all CPU players
    resetCPUMemory()
    
    // Initialize scores
    const initialScores = new Map()
    players.forEach(player => {
      if (player.userProfileId) {
        initialScores.set(player.userProfileId, 0)
      }
    })
    
    // Set first player's turn
    const firstPlayerId = players[0]?.userProfileId || null
    
    // Prepare restart state
    const restartState = {
      state: 'playing',
      cards: newCards,
      flippedCards: [],
      currentTurn: firstPlayerId,
      scores: Object.fromEntries(initialScores)
    }
    
    // Update local state
    setCards(newCards)
    cardsRef.current = newCards
    setFlippedCards([])
    flippedCardsRef.current = []
    setCurrentTurn(firstPlayerId)
    currentTurnRef.current = firstPlayerId
    setScores(initialScores)
    scoresRef.current = initialScores
    setGameState('playing')
    gameStateRef.current = 'playing'
    isProcessingMatchRef.current = false // Reset processing flag
    
    // Broadcast restart to all players
    if (roomId) {
      emitGameStart(roomId, restartState)
      emitGameState(roomId, restartState)
    }
  }, [isHost, roomId, players, initializeCards])


  // Check if it's current player's turn
  const isMyTurn = currentProfile?.id && currentTurn && String(currentTurn) === String(currentProfile.id)
  

  // Handle card flip
  const handleCardFlip = useCallback((cardIndex) => {
    if (gameStateRef.current !== 'playing') {
      return
    }
    if (!isMyTurn) {
      return
    }
    if (isProcessingMatchRef.current) {
      return
    }
    if (flippedCardsRef.current.length >= 2) {
      return
    }
    
    const card = cardsRef.current[cardIndex]
    if (!card || card.flipped || card.matched) {
      return
    }
    
    // Flip the card locally for immediate visual feedback
    const newCards = [...cardsRef.current]
    newCards[cardIndex] = { ...newCards[cardIndex], flipped: true }
    setCards(newCards)
    cardsRef.current = newCards
    
    const newFlippedCards = [...flippedCardsRef.current, cardIndex]
    setFlippedCards(newFlippedCards)
    flippedCardsRef.current = newFlippedCards
    
    soundManager.playCardFlip()
    
    // Update CPU memory when a card is flipped
    if (isCPU) {
      updateCPUMemory(cardIndex, newCards[cardIndex])
    }
    
    // Emit card flip to server - this will broadcast to all players
    if (roomId && currentProfile?.id) {
      emitCardFlip(roomId, currentProfile.id, cardIndex)
    }
    
    // Host will broadcast full game state after processing match logic (handled in useEffect)
  }, [isMyTurn, isHost, roomId, currentProfile?.id, isCPU])

  // Process card flip when 2 cards are flipped (host only)
  useEffect(() => {
    if (!isHost || gameState !== 'playing') return
    if (flippedCards.length !== 2) return
    if (isProcessingMatchRef.current) return
    
    const [index1, index2] = flippedCards
    const card1 = cardsRef.current[index1]
    const card2 = cardsRef.current[index2]
    
    // Validate cards exist
    if (!card1 || !card2) {
      console.warn('[MemoryGame] Invalid cards for match processing', { index1, index2, card1: !!card1, card2: !!card2 })
      // Reset flipped cards if invalid
      setFlippedCards([])
      flippedCardsRef.current = []
      return
    }
    
    isProcessingMatchRef.current = true
    
    // Safety timeout - if processing takes too long, reset
    let safetyTimeout = setTimeout(() => {
      if (isProcessingMatchRef.current) {
        console.warn('[MemoryGame] Match processing timed out, resetting')
        isProcessingMatchRef.current = false
        setFlippedCards([])
        flippedCardsRef.current = []
      }
    }, 5000) // 5 second safety timeout
    
    // Wait a moment to show both cards before checking match
    const matchTimeout = setTimeout(() => {
      console.log('[MemoryGame] Processing match check', { index1, index2, pairId1: card1.pairId, pairId2: card2.pairId })
      if (card1.pairId === card2.pairId) {
        // Match found!
        soundManager.playCardMatch()
        
        // Set match animation
        setMatchAnimation({ card1: index1, card2: index2, isMatch: true })
        
        // Mark cards as matched
        const newCards = [...cardsRef.current]
        newCards[index1] = { ...newCards[index1], matched: true, flipped: true }
        newCards[index2] = { ...newCards[index2], matched: true, flipped: true }
        setCards(newCards)
        cardsRef.current = newCards
        
        // Clear CPU memory for this matched pair
        if (card1.symbol) {
          clearCPUMemoryForPair(card1.symbol)
        }
        
        // Clear match animation after animation completes
        setTimeout(() => {
          setMatchAnimation(null)
        }, 1000)
        
        // Award points to current player
        const newScores = new Map(scoresRef.current)
        const currentScore = newScores.get(currentTurnRef.current) || 0
        newScores.set(currentTurnRef.current, currentScore + 1)
        setScores(newScores)
        scoresRef.current = newScores
        
        // Clear flipped cards
        setFlippedCards([])
        flippedCardsRef.current = []
        isProcessingMatchRef.current = false
        clearTimeout(safetyTimeout)
        clearTimeout(matchTimeout)
        
        // Check if game is over
        const allMatched = newCards.every(card => card.matched)
        if (allMatched) {
          setGameState('gameover')
          gameStateRef.current = 'gameover'
          soundManager.playGameOver()
          
          // Increase difficulty level (up to 3)
          if (difficultyLevel < 3) {
            setDifficultyLevel(prev => Math.min(prev + 1, 3))
          }
          
          // Determine winner (player with highest score)
          let maxScore = -1
          let winnerUserProfileId = null
          for (const [userProfileId, score] of newScores.entries()) {
            if (score > maxScore) {
              maxScore = score
              winnerUserProfileId = userProfileId
            }
          }
          
          // Record win if there's a winner
          if (winnerUserProfileId) {
            const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
            const serverUrl = `${protocol}//${window.location.hostname}:8000`
            fetch(`${serverUrl}/api/wins/record`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userProfileId: winnerUserProfileId,
                gameType: 'memory'
              })
            }).catch(err => console.error('[MemoryGame] Error recording win:', err))
          }
          
          // Broadcast gameover
          if (roomId) {
            emitGameState(roomId, {
              state: 'gameover',
              cards: newCards,
              flippedCards: [],
              currentTurn: currentTurnRef.current,
              scores: Object.fromEntries(newScores)
            })
          }
        } else {
          // Player continues turn (don't change turn)
          // Broadcast updated state
          if (roomId) {
            emitGameState(roomId, {
              state: 'playing',
              cards: newCards,
              flippedCards: [],
              currentTurn: currentTurnRef.current,
              scores: Object.fromEntries(newScores)
            })
          }
        }
      } else {
        // No match - flip cards back and switch turn
        soundManager.playCardMismatch()
        
        // Set mismatch animation
        setMatchAnimation({ card1: index1, card2: index2, isMatch: false })
        
        setTimeout(() => {
          // Clear mismatch animation
          setMatchAnimation(null)
          // Flip cards back face-down when no match
          const newCards = [...cardsRef.current]
          newCards[index1] = { ...newCards[index1], flipped: false }
          newCards[index2] = { ...newCards[index2], flipped: false }
          setCards(newCards)
          cardsRef.current = newCards
          
          // Clear flipped cards
          setFlippedCards([])
          flippedCardsRef.current = []
          isProcessingMatchRef.current = false
          clearTimeout(safetyTimeout)
          clearTimeout(matchTimeout)
          
          // Switch to next player
          const currentPlayerIndex = players.findIndex(p => p.userProfileId === currentTurnRef.current)
          const nextPlayerIndex = (currentPlayerIndex + 1) % players.length
          const nextPlayerId = players[nextPlayerIndex]?.userProfileId || null
          setCurrentTurn(nextPlayerId)
          currentTurnRef.current = nextPlayerId
          
          // Broadcast updated state
          if (roomId) {
            emitGameState(roomId, {
              state: 'playing',
              cards: newCards,
              flippedCards: [],
              currentTurn: nextPlayerId,
              scores: Object.fromEntries(scoresRef.current)
            })
          }
        }, 1200) // Wait 1.2 seconds before flipping back to show mismatch animation
      }
    }, 500) // Small delay to show both cards
    
    // Cleanup function
    return () => {
      clearTimeout(safetyTimeout)
      clearTimeout(matchTimeout)
    }
  }, [flippedCards, isHost, gameState, roomId, players, currentTurn])

  // CPU auto-play - intelligent memory game strategy
  useEffect(() => {
    if (!isCPU || gameState !== 'playing' || !isMyTurn) return
    
    const cpuInterval = setInterval(() => {
      if (gameStateRef.current !== 'playing' || !isMyTurn || isProcessingMatchRef.current) return
      if (flippedCardsRef.current.length >= 2) return
      
      // Use intelligent CPU logic for memory game
      cpuMemoryGame(cardsRef.current, flippedCardsRef.current, handleCardFlip)
    }, 800) // Check every 800ms for more responsive gameplay
    
    return () => clearInterval(cpuInterval)
  }, [isCPU, gameState, isMyTurn, handleCardFlip])

  // Sync refs with state
  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])

  useEffect(() => {
    cardsRef.current = cards
  }, [cards])

  useEffect(() => {
    flippedCardsRef.current = flippedCards
  }, [flippedCards])

  useEffect(() => {
    currentTurnRef.current = currentTurn
  }, [currentTurn])

  useEffect(() => {
    scoresRef.current = scores
  }, [scores])

  // Get player style
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

  // Render geometric card symbol - distinct patterns for each type with colors
  const renderCardSymbol = (symbolType, isMatched, color) => {
    if (!symbolType) return null
    
    const baseOpacity = isMatched ? 0.3 : 0.85
    const strokeOpacity = isMatched ? 0.4 : 0.95
    const symbolColor = color || '#000000'
    
    const svgStyle = {
      width: '70%',
      height: '70%',
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)'
    }
    
    // Helper to convert hex to rgba
    const hexToRgba = (hex, opacity) => {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return `rgba(${r}, ${g}, ${b}, ${opacity})`
    }
    
    switch (symbolType) {
      case 'circle':
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <circle cx="50" cy="50" r="40" fill={hexToRgba(symbolColor, baseOpacity)} stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="2" />
          </svg>
        )
      case 'square':
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <rect x="18" y="18" width="64" height="64" fill="none" stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="5" />
          </svg>
        )
      case 'triangle':
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <polygon points="50,15 88,80 12,80" fill={hexToRgba(symbolColor, baseOpacity * 0.6)} stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="3" />
            <line x1="50" y1="15" x2="50" y2="80" stroke={hexToRgba(symbolColor, strokeOpacity * 0.5)} strokeWidth="1.5" />
            <line x1="31" y1="47.5" x2="69" y2="47.5" stroke={hexToRgba(symbolColor, strokeOpacity * 0.5)} strokeWidth="1.5" />
          </svg>
        )
      case 'diamond':
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <polygon points="50,18 82,50 50,82 18,50" fill="none" stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="4" />
            <circle cx="50" cy="50" r="4" fill={hexToRgba(symbolColor, strokeOpacity)} />
            <circle cx="35" cy="35" r="2.5" fill={hexToRgba(symbolColor, strokeOpacity)} />
            <circle cx="65" cy="35" r="2.5" fill={hexToRgba(symbolColor, strokeOpacity)} />
            <circle cx="35" cy="65" r="2.5" fill={hexToRgba(symbolColor, strokeOpacity)} />
            <circle cx="65" cy="65" r="2.5" fill={hexToRgba(symbolColor, strokeOpacity)} />
          </svg>
        )
      case 'hexagon':
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <polygon points="50,12 88,25 88,65 50,88 12,65 12,25" fill={hexToRgba(symbolColor, baseOpacity)} stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="2" />
          </svg>
        )
      case 'star':
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <path d="M50,10 L58,38 L88,38 L64,58 L72,88 L50,68 L28,88 L36,58 L12,38 L42,38 Z" fill={hexToRgba(symbolColor, baseOpacity * 0.7)} stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="2.5" />
          </svg>
        )
      case 'cross':
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <rect x="40" y="15" width="20" height="70" fill={hexToRgba(symbolColor, baseOpacity)} />
            <rect x="15" y="40" width="70" height="20" fill={hexToRgba(symbolColor, baseOpacity)} />
          </svg>
        )
      case 'plus':
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <line x1="50" y1="20" x2="50" y2="80" stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="6" strokeLinecap="round" />
            <line x1="20" y1="50" x2="80" y2="50" stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="6" strokeLinecap="round" />
          </svg>
        )
      case 'wave':
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <path d="M8,50 Q28,30 48,50 T88,50" fill="none" stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="4.5" strokeLinecap="round" />
          </svg>
        )
      case 'grid':
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <rect x="30" y="15" width="8" height="70" fill={hexToRgba(symbolColor, baseOpacity * 0.5)} stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="1" />
            <rect x="62" y="15" width="8" height="70" fill={hexToRgba(symbolColor, baseOpacity * 0.5)} stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="1" />
            <rect x="15" y="30" width="70" height="8" fill={hexToRgba(symbolColor, baseOpacity * 0.5)} stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="1" />
            <rect x="15" y="62" width="70" height="8" fill={hexToRgba(symbolColor, baseOpacity * 0.5)} stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="1" />
          </svg>
        )
      case 'dots':
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <circle cx="30" cy="30" r="6" fill={hexToRgba(symbolColor, baseOpacity)} />
            <circle cx="50" cy="30" r="6" fill={hexToRgba(symbolColor, baseOpacity)} />
            <circle cx="70" cy="30" r="6" fill={hexToRgba(symbolColor, baseOpacity)} />
            <circle cx="30" cy="50" r="6" fill={hexToRgba(symbolColor, baseOpacity)} />
            <circle cx="50" cy="50" r="6" fill={hexToRgba(symbolColor, baseOpacity)} />
            <circle cx="70" cy="50" r="6" fill={hexToRgba(symbolColor, baseOpacity)} />
            <circle cx="30" cy="70" r="6" fill={hexToRgba(symbolColor, baseOpacity)} />
            <circle cx="50" cy="70" r="6" fill={hexToRgba(symbolColor, baseOpacity)} />
            <circle cx="70" cy="70" r="6" fill={hexToRgba(symbolColor, baseOpacity)} />
          </svg>
        )
      case 'lines':
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <rect x="15" y="22" width="70" height="6" fill={hexToRgba(symbolColor, baseOpacity)} />
            <rect x="15" y="47" width="70" height="6" fill={hexToRgba(symbolColor, baseOpacity)} />
            <rect x="15" y="72" width="70" height="6" fill={hexToRgba(symbolColor, baseOpacity)} />
          </svg>
        )
      case 'spiral':
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <path d="M50,50 Q50,30 70,30 Q90,30 90,50 Q90,70 70,70 Q50,70 50,50" fill="none" stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="4" strokeLinecap="round" />
          </svg>
        )
      case 'arrow':
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <rect x="18" y="45" width="47" height="10" fill={hexToRgba(symbolColor, baseOpacity)} />
            <polygon points="55,35 65,50 55,65" fill={hexToRgba(symbolColor, baseOpacity)} stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="2" />
          </svg>
        )
      case 'chevron':
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <path d="M20,50 L35,30 L35,50 L35,70 M60,30 L80,50 L60,70" fill="none" stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      case 'zigzag':
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <path d="M8,50 L28,30 L48,50 L68,30 L92,50" fill="none" stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      default:
        return (
          <svg viewBox="0 0 100 100" style={svgStyle}>
            <circle cx="50" cy="50" r="40" fill={hexToRgba(symbolColor, baseOpacity)} stroke={hexToRgba(symbolColor, strokeOpacity)} strokeWidth="2" />
          </svg>
        )
    }
  }

  // Update parent component with score/turn info when it changes
  useEffect(() => {
    if (onScoreUpdate && gameState === 'playing') {
      const playerScores = players.map((player, idx) => {
        const style = getPlayerStyle(idx)
        const playerScore = scores.get(player.userProfileId) || 0
        const isCurrentPlayer = player.userProfileId === currentTurn
        return {
          userProfileId: player.userProfileId,
          name: player.name || `Player ${idx + 1}`,
          score: playerScore,
          emoji: style.emoji,
          color: style.color,
          isCurrentTurn: isCurrentPlayer
        }
      })
      
      const currentPlayer = players.find(p => p.userProfileId === currentTurn)
      const currentPlayerIndex = currentPlayer ? players.indexOf(currentPlayer) : -1
      const currentPlayerStyle = currentPlayerIndex >= 0 ? getPlayerStyle(currentPlayerIndex) : null
      
      onScoreUpdate({
        gameType: 'memory',
        currentTurn: currentTurn,
        currentPlayerName: currentPlayer?.name || 'Player',
        currentPlayerStyle: currentPlayerStyle,
        isMyTurn: currentProfile?.id && currentTurn === currentProfile.id,
        playerScores: playerScores
      })
    } else if (onScoreUpdate && gameState !== 'playing') {
      // Clear score display when not playing
      onScoreUpdate(null)
    }
  }, [scores, currentTurn, gameState, players, currentProfile?.id, onScoreUpdate])

  // Calculate grid dimensions based on card count
  const getGridDimensions = useCallback(() => {
    const cardPairsCount = getCardPairsCount()
    const totalCards = cardPairsCount * 2
    
    // Calculate optimal grid: try to keep it roughly square
    let cols = CARD_COLS
    let rows = CARD_ROWS
    
    if (totalCards <= 16) {
      cols = 4
      rows = 4
    } else if (totalCards <= 20) {
      cols = 5
      rows = 4
    } else if (totalCards <= 24) {
      cols = 6
      rows = 4
    } else if (totalCards <= 28) {
      cols = 7
      rows = 4
    } else {
      cols = 8
      rows = 4
    }
    
    return { cols, rows, totalCards }
  }, [getCardPairsCount])

  const gridDimensions = getGridDimensions()
  
  // Calculate card size
  const cardWidth = (GAME_WIDTH - 20) / gridDimensions.cols - 10
  const cardHeight = (GAME_HEIGHT - 100) / gridDimensions.rows - 10

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
      position: 'fixed', 
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
      justifyContent: 'center',
      zIndex: 1,
      pointerEvents: 'auto'
    }}>
      {/* Score Display - Left side of board, outside, stacked top to bottom */}
      {gameState === 'playing' && players.length > 0 && (
        <div 
          className="fixed z-30"
          style={{
            left: `calc(50% - ${GAME_WIDTH / 2 + 10}px)`,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            alignItems: 'center'
          }}
        >
          {players.map((player, idx) => {
            const style = getPlayerStyle(idx)
            const playerScore = scores.get(player.userProfileId) || 0
            const isCurrentPlayer = player.userProfileId === currentTurn
            return (
              <div 
                key={player.userProfileId || idx}
                className="flex flex-col items-center gap-2 px-3 py-2 rounded-lg border backdrop-blur-sm"
                style={{
                  opacity: isCurrentPlayer ? 1 : 0.6,
                  backgroundColor: isCurrentPlayer ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.4)',
                  borderColor: isCurrentPlayer ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.15)',
                  boxShadow: isCurrentPlayer 
                    ? '0 4px 12px rgba(255, 255, 255, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.1)' 
                    : '0 2px 8px rgba(0, 0, 0, 0.3)',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: isCurrentPlayer ? 'scale(1.05)' : 'scale(1)'
                }}
              >
                <span className="text-xl" style={{
                  filter: isCurrentPlayer ? 'drop-shadow(0 0 4px rgba(255, 255, 255, 0.4))' : 'none',
                  transition: 'all 0.3s ease'
                }}>{style.emoji}</span>
                <span 
                  className={isCurrentPlayer ? 'font-bold text-2xl sm:text-3xl' : 'font-semibold text-xl sm:text-2xl'} 
                  style={{ 
                    color: style.color,
                    textShadow: isCurrentPlayer 
                      ? '0 2px 8px rgba(0, 0, 0, 0.9), 0 0 12px rgba(255, 255, 255, 0.2)' 
                      : '0 2px 6px rgba(0, 0, 0, 0.8)',
                    transition: 'all 0.3s ease'
                  }}
                >
                  {playerScore}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {/* Error Notification */}
      {error && (
        <div 
          className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 border rounded-xl px-large py-medium text-white text-center max-w-md backdrop-blur-xl"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.8)',
            borderColor: 'rgba(255, 255, 255, 0.3)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            pointerEvents: 'auto'
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
          height: '70vh',
          transform: `${gameScale < 1 ? `scale(${gameScale})` : ''}`,
          transformOrigin: 'center center',
          overflow: 'visible',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'auto',
          touchAction: 'manipulation'
        }}
      >
        {/* Game Board */}
        <div
          className="relative border-2 rounded-2xl bg-black overflow-hidden shadow-2xl"
          style={{ 
            width: GAME_WIDTH, 
            height: '100%',
            minHeight: GAME_HEIGHT,
            borderColor: 'rgba(255, 255, 255, 0.35)',
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.7), inset 0 1px 3px rgba(255, 255, 255, 0.12), 0 0 80px rgba(255, 255, 255, 0.03)',
            backgroundImage: `
              radial-gradient(circle at 4px 4px, rgba(255, 255, 255, 0.04) 1px, transparent 0),
              linear-gradient(to bottom, transparent 0%, rgba(255, 255, 255, 0.02) 50%, transparent 100%),
              radial-gradient(ellipse at center top, rgba(255, 255, 255, 0.03) 0%, transparent 60%)
            `,
            backgroundSize: '40px 40px, 100% 100%, 100% 180px',
            pointerEvents: 'auto',
            touchAction: 'manipulation'
          }}
        >
        {/* Turn Indicator - Shows during gameplay */}
        {gameState === 'playing' && currentTurn && (
          <div 
            className="absolute top-3 left-1/2 transform -translate-x-1/2 z-30 px-5 py-2.5 rounded-xl border-2 backdrop-blur-md"
            style={{
              backgroundColor: isMyTurn ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.6)',
              borderColor: isMyTurn ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.25)',
              boxShadow: isMyTurn 
                ? '0 6px 20px rgba(255, 255, 255, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.1)' 
                : '0 3px 12px rgba(0, 0, 0, 0.4)',
              transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
              animation: isMyTurn ? 'pulseGlow 2.5s ease-in-out infinite' : 'none',
              transform: isMyTurn ? 'translateX(-50%) scale(1.05)' : 'translateX(-50%) scale(1)'
            }}
          >
            <div className="flex items-center gap-3 text-sm font-semibold text-white">
              {(() => {
                const currentPlayer = players.find(p => p.userProfileId === currentTurn)
                const currentPlayerIndex = currentPlayer ? players.indexOf(currentPlayer) : -1
                const style = currentPlayerIndex >= 0 ? getPlayerStyle(currentPlayerIndex) : { emoji: '⚪', color: '#FFFFFF', name: 'Player' }
                return (
                  <>
                    <span className="text-xl" style={{ 
                      filter: isMyTurn ? 'drop-shadow(0 0 4px rgba(255, 255, 255, 0.5))' : 'none',
                      transition: 'all 0.3s ease'
                    }}>{style.emoji}</span>
                    <span style={{ 
                      color: style.color,
                      textShadow: isMyTurn ? '0 0 8px rgba(255, 255, 255, 0.3)' : 'none',
                      transition: 'all 0.3s ease'
                    }}>
                      {isMyTurn ? 'Your Turn' : `${currentPlayer?.name || 'Player'}'s Turn`}
                    </span>
                    {difficultyLevel > 0 && (
                      <span className="text-xs opacity-70 ml-2">
                        Level {difficultyLevel + 1}
                      </span>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
        )}
        {/* Cards Grid - Always visible when game is playing */}
        {gameState === 'playing' && (
          <div 
            className="grid gap-2 p-4" 
            style={{ 
              gridTemplateColumns: `repeat(${gridDimensions.cols}, 1fr)`,
              gridTemplateRows: `repeat(${gridDimensions.rows}, 1fr)`,
              height: '100%',
              paddingTop: '60px',
              paddingBottom: '20px',
              position: 'relative',
              zIndex: 10,
              pointerEvents: 'auto',
              touchAction: 'manipulation'
            }}
            onClick={(e) => {
              // Event delegation - find the card element
              const cardElement = e.target.closest('[data-card-index]')
              if (cardElement && isMyTurn) {
                const cardIndex = parseInt(cardElement.getAttribute('data-card-index'))
                e.preventDefault()
                e.stopPropagation()
                handleCardFlip(cardIndex)
              }
            }}
            onTouchStart={(e) => {
              // Event delegation - find the card element
              const cardElement = e.target.closest('[data-card-index]')
              if (cardElement && isMyTurn) {
                const cardIndex = parseInt(cardElement.getAttribute('data-card-index'))
                e.preventDefault()
                e.stopPropagation()
                handleCardFlip(cardIndex)
              }
            }}
          >
            {cards.length > 0 ? cards.map((card, index) => {
              const isFlipped = card.flipped || card.matched
              const isSelected = flippedCards.includes(index)
              const isClickable = isMyTurn && !isFlipped && flippedCards.length < 2 && !isProcessingMatchRef.current
              const isMatchAnimating = matchAnimation && (matchAnimation.card1 === index || matchAnimation.card2 === index) && matchAnimation.isMatch
              const isMismatchAnimating = matchAnimation && (matchAnimation.card1 === index || matchAnimation.card2 === index) && !matchAnimation.isMatch
              
              return (
              <div
                key={card.id}
                data-card-index={index}
                className={`border rounded-lg transition-all duration-300 flex items-center justify-center ${
                  isClickable ? 'hover:scale-105 cursor-pointer active:scale-95' : 'cursor-not-allowed'
                } ${card.matched ? 'opacity-40' : ''} ${!isClickable && !isFlipped ? 'opacity-40' : ''}`}
                style={{
                  width: cardWidth,
                  height: cardHeight,
                  backgroundColor: isFlipped 
                    ? (card.matched 
                      ? 'rgba(255, 255, 255, 0.95)' 
                      : 'rgba(255, 255, 255, 1)')
                    : 'rgba(255, 255, 255, 0.1)',
                  borderColor: isFlipped 
                    ? (card.matched 
                      ? 'rgba(0, 0, 0, 0.2)' 
                      : isSelected 
                        ? 'rgba(0, 0, 0, 0.4)' 
                        : 'rgba(0, 0, 0, 0.3)')
                    : isClickable 
                      ? 'rgba(255, 255, 255, 0.3)' 
                      : 'rgba(255, 255, 255, 0.15)',
                  borderWidth: '1px',
                  transform: `${isFlipped ? 'rotateY(0deg)' : 'rotateY(180deg)'} ${isMatchAnimating ? 'scale(1.15)' : isMismatchAnimating ? 'scale(0.92)' : 'scale(1)'}`,
                  transformStyle: 'preserve-3d',
                  perspective: '1000px',
                  backfaceVisibility: 'visible',
                  boxShadow: isFlipped 
                    ? (card.matched 
                      ? '0 1px 3px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(0, 0, 0, 0.05)' 
                      : isSelected 
                        ? '0 4px 12px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(0, 0, 0, 0.1)' 
                        : '0 2px 6px rgba(0, 0, 0, 0.25), inset 0 0 0 1px rgba(0, 0, 0, 0.05)')
                    : isClickable
                      ? '0 2px 4px rgba(0, 0, 0, 0.2), inset 0 1px 2px rgba(255, 255, 255, 0.1)'
                      : '0 1px 3px rgba(0, 0, 0, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.05)',
                  transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease, border-color 0.3s ease, background-color 0.3s ease',
                  touchAction: 'manipulation',
                  pointerEvents: 'auto',
                  position: 'relative',
                  zIndex: isMatchAnimating || isMismatchAnimating ? 200 : (isSelected ? 150 : 100),
                  WebkitTapHighlightColor: 'transparent',
                  userSelect: 'none',
                  WebkitTransform: `${isFlipped ? 'rotateY(0deg)' : 'rotateY(180deg)'} ${isMatchAnimating ? 'scale(1.15)' : isMismatchAnimating ? 'scale(0.92)' : 'scale(1)'}`,
                  willChange: 'transform',
                  filter: isMatchAnimating ? 'brightness(1.1) drop-shadow(0 0 8px rgba(0, 0, 0, 0.3))' : isMismatchAnimating ? 'brightness(0.8) contrast(0.95)' : 'none'
                }}
              >
                {isFlipped && (
                  <div 
                    style={{ 
                      transform: 'rotateY(0deg)',
                      pointerEvents: 'none',
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.3s ease',
                      filter: isMatchAnimating ? 'drop-shadow(0 0 4px rgba(255, 255, 255, 0.8))' : 'none',
                      position: 'relative'
                    }}
                  >
                    {renderCardSymbol(card.symbol, card.matched, card.color)}
                  </div>
                )}
                {!isFlipped && (
                  <div 
                    style={{ 
                      transform: 'rotateY(180deg)',
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundImage: `
                        repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.05) 0px, rgba(255, 255, 255, 0.05) 1px, transparent 1px, transparent 6px),
                        repeating-linear-gradient(-45deg, rgba(255, 255, 255, 0.05) 0px, rgba(255, 255, 255, 0.05) 1px, transparent 1px, transparent 6px)
                      `,
                      backgroundSize: '100% 100%, 100% 100%',
                      position: 'relative',
                      pointerEvents: 'none',
                      borderRadius: '8px'
                    }}
                  >
                    <svg width="40%" height="40%" viewBox="0 0 100 100" style={{ opacity: 0.4 }}>
                      <rect x="20" y="20" width="60" height="60" fill="none" stroke="rgba(255, 255, 255, 0.6)" strokeWidth="2" strokeLinecap="round" />
                      <line x1="30" y1="30" x2="70" y2="70" stroke="rgba(255, 255, 255, 0.6)" strokeWidth="2" strokeLinecap="round" />
                      <line x1="70" y1="30" x2="30" y2="70" stroke="rgba(255, 255, 255, 0.6)" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </div>
                )}
              </div>
              )
            }) : (
            // Show placeholder if cards haven't loaded yet
            <div className="col-span-full row-span-full flex items-center justify-center text-white/40 text-sm">
              Loading cards... (cards: {cards.length})
            </div>
          )}
          </div>
        )}

        {/* Restart Button - Host only, visible during playing or gameover */}
        {isHost && (gameState === 'playing' || gameState === 'gameover') && (
          <button
            onClick={restartGame}
            className="absolute top-4 right-4 z-50 px-3 py-2 text-sm text-white border rounded-lg hover:bg-white hover:text-black transition-all duration-300 cursor-pointer font-medium hover:scale-105"
            style={{
              borderColor: 'rgba(255, 255, 255, 0.3)',
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 4px 15px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
            }}
          >
            Restart
          </button>
        )}

        {/* Waiting Screen */}
        {gameState === 'waiting' && (
          <div 
            className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-md"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.88)',
              padding: '24px',
              zIndex: 20,
              pointerEvents: 'auto'
            }}
          >
            <div className="text-center mb-10">
              <h1 className="text-5xl sm:text-6xl font-bold mb-4 text-white tracking-wider" style={{
                textShadow: '0 4px 12px rgba(255, 255, 255, 0.2), 0 0 24px rgba(255, 255, 255, 0.08)',
                letterSpacing: '0.15em',
                fontWeight: 700
              }}>
                MEMORY
              </h1>
              <div className="w-32 h-0.5 mx-auto mb-6" style={{
                background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.4), transparent)',
                boxShadow: '0 0 8px rgba(255, 255, 255, 0.2)'
              }}></div>
              <p className="text-lg sm:text-xl mb-3 text-white/85 font-medium tracking-wide">Match pairs of cards</p>
              <p className="text-sm text-white/50 mb-8 font-light">
                {players.length > 1 ? `${players.length} players ready` : 'Waiting for players...'}
              </p>
            </div>
            {isHost && (
              <button
                onClick={startGame}
                disabled={players.length < 2}
                className="px-8 py-4 text-base font-semibold text-white border-2 rounded-xl hover:bg-white hover:text-black transition-all duration-300 cursor-pointer hover:scale-105 hover:shadow-xl hover:shadow-white/25 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-transparent disabled:hover:text-white"
                style={{
                  borderColor: players.length >= 2 ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.25)',
                  backgroundColor: players.length >= 2 ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                  backdropFilter: 'blur(16px)',
                  boxShadow: players.length >= 2 
                    ? '0 8px 24px rgba(0, 0, 0, 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.15)' 
                    : '0 4px 12px rgba(0, 0, 0, 0.3)',
                  minWidth: '200px',
                  letterSpacing: '0.05em'
                }}
              >
                {players.length < 2 ? 'Waiting for Player 2...' : 'Start Game'}
              </button>
            )}
            {!isHost && (
              <div className="text-center">
                <p className="text-sm text-white/60 mb-3 font-light">Waiting for host to start...</p>
                <div className="flex justify-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-white/30 animate-pulse" style={{ animationDelay: '0s' }}></div>
                  <div className="w-2 h-2 rounded-full bg-white/30 animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-2 h-2 rounded-full bg-white/30 animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Game Over Screen */}
        {gameState === 'gameover' && (
          <div 
            className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-md z-40 animate-fade-in"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.94)',
              pointerEvents: 'auto'
            }}
          >
            <div className="text-center mb-10">
              <h2 className="text-5xl sm:text-6xl font-bold mb-4 text-white tracking-wider" style={{
                textShadow: '0 4px 12px rgba(255, 255, 255, 0.2), 0 0 24px rgba(255, 255, 255, 0.08)',
                letterSpacing: '0.15em',
                fontWeight: 700
              }}>
                Game Over
              </h2>
              <div className="w-32 h-0.5 mx-auto mb-4" style={{
                background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.4), transparent)',
                boxShadow: '0 0 8px rgba(255, 255, 255, 0.2)'
              }}></div>
              {difficultyLevel < 3 && (
                <p className="text-sm text-white/60 mb-2">
                  Next game: Level {difficultyLevel + 2} ({[8, 10, 12, 14][difficultyLevel + 1]} pairs)
                </p>
              )}
              {difficultyLevel >= 3 && (
                <p className="text-sm text-white/60 mb-2">
                  Maximum difficulty reached!
                </p>
              )}
            </div>
            <div className="mb-10 w-full max-w-md">
              <h3 className="text-lg sm:text-xl font-semibold mb-6 text-white/80 text-center tracking-wide">Final Scores</h3>
              <div className="space-y-3">
                {Array.from(scores.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([userProfileId, score], idx) => {
                    const player = players.find(p => p.userProfileId === userProfileId)
                    const playerIndex = players.findIndex(p => p.userProfileId === userProfileId)
                    const style = getPlayerStyle(playerIndex)
                    const isWinner = idx === 0
                    return (
                      <div 
                        key={userProfileId} 
                        className="text-lg sm:text-xl mb-2 flex items-center justify-between px-5 py-3.5 rounded-xl border-2 backdrop-blur-sm transition-all duration-300"
                        style={{
                          backgroundColor: isWinner ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                          borderColor: isWinner ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.2)',
                          boxShadow: isWinner 
                            ? '0 6px 16px rgba(255, 255, 255, 0.12), inset 0 1px 2px rgba(255, 255, 255, 0.1)' 
                            : '0 2px 8px rgba(0, 0, 0, 0.3)',
                          transform: isWinner ? 'scale(1.03)' : 'scale(1)',
                          animation: 'fadeInUp 0.5s ease-out',
                          animationDelay: `${idx * 0.08}s`,
                          animationFillMode: 'both'
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xl font-bold" style={{ 
                            color: isWinner ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.5)',
                            minWidth: '24px'
                          }}>{idx === 0 ? '1' : `${idx + 1}`}</span>
                          <span className="text-2xl" style={{
                            filter: isWinner ? 'drop-shadow(0 0 4px rgba(255, 255, 255, 0.3))' : 'none'
                          }}>{style.emoji}</span>
                          <span className="text-white font-medium" style={{
                            color: isWinner ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.7)'
                          }}>{player?.name || 'Player'}</span>
                        </div>
                        <span className="text-white font-bold" style={{ 
                          color: style.color, 
                          fontSize: '1.4em',
                          textShadow: isWinner ? '0 0 8px rgba(255, 255, 255, 0.3)' : 'none'
                        }}>
                          {score}
                        </span>
                      </div>
                    )
                  })}
              </div>
            </div>
            {isHost && (
              <button
                onClick={() => {
                  setGameState('waiting')
                  gameStateRef.current = 'waiting'
                  setCards([])
                  cardsRef.current = []
                  setFlippedCards([])
                  flippedCardsRef.current = []
                  setCurrentTurn(null)
                  currentTurnRef.current = null
                  setScores(new Map())
                  scoresRef.current = new Map()
                }}
                className="px-8 py-4 text-lg font-semibold text-white border-2 rounded-xl hover:bg-white hover:text-black transition-all duration-300 cursor-pointer hover:scale-105 hover:shadow-xl hover:shadow-white/25"
                style={{
                  borderColor: 'rgba(255, 255, 255, 0.5)',
                  backgroundColor: 'rgba(255, 255, 255, 0.12)',
                  backdropFilter: 'blur(16px)',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.15)',
                  minWidth: '200px',
                  letterSpacing: '0.05em'
                }}
              >
                Play Again
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

export default MemoryGame

