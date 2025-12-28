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
const CARD_PAIRS = TOTAL_CARDS / 2

// Card symbols/emojis for matching
const CARD_SYMBOLS = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠', '⚫', '⚪', '🔶', '🔷', '🔸', '🔹', '🔺', '🔻', '💎', '⭐']

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

  // Initialize game cards
  const initializeCards = useCallback(() => {
    // Create pairs of symbols
    const symbols = CARD_SYMBOLS.slice(0, CARD_PAIRS)
    const cardPairs = []
    symbols.forEach((symbol, index) => {
      cardPairs.push({ id: index * 2, symbol, pairId: index })
      cardPairs.push({ id: index * 2 + 1, symbol, pairId: index })
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
  }, [])

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
        
        // Clear match animation after a moment
        setTimeout(() => {
          setMatchAnimation(null)
        }, 800)
        
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
            const serverUrl = `http://${window.location.hostname}:8000`
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
        }, 1000) // Wait 1 second before flipping back
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

  // Calculate card size
  const cardWidth = (GAME_WIDTH - 20) / CARD_COLS - 10
  const cardHeight = (GAME_HEIGHT - 100) / CARD_ROWS - 10

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
            left: `calc(50% - ${GAME_WIDTH / 2 + 5}px)`,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
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
                className="flex flex-col items-center gap-1"
                style={{
                  opacity: isCurrentPlayer ? 1 : 0.7
                }}
              >
                <span className="text-lg">{style.emoji}</span>
                <span 
                  className={isCurrentPlayer ? 'font-bold text-2xl sm:text-3xl' : 'text-2xl sm:text-3xl'} 
                  style={{ 
                    color: style.color,
                    textShadow: '0 2px 8px rgba(0, 0, 0, 0.9)'
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
            borderColor: 'rgba(255, 255, 255, 0.4)',
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.15), 0 0 60px rgba(255, 255, 255, 0.05)',
            backgroundImage: `
              radial-gradient(circle at 3px 3px, rgba(255, 255, 255, 0.06) 1.5px, transparent 0),
              linear-gradient(to bottom, transparent 0%, rgba(255, 255, 255, 0.03) 50%, transparent 100%),
              radial-gradient(ellipse at center top, rgba(255, 255, 255, 0.05) 0%, transparent 50%)
            `,
            backgroundSize: '50px 50px, 100% 100%, 100% 200px',
            pointerEvents: 'auto',
            touchAction: 'manipulation'
          }}
        >
        {/* Turn Indicator - Shows during gameplay */}
        {gameState === 'playing' && currentTurn && (
          <div 
            className="absolute top-2 left-1/2 transform -translate-x-1/2 z-30 px-4 py-2 rounded-lg border-2 backdrop-blur-md"
            style={{
              backgroundColor: isMyTurn ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.5)',
              borderColor: isMyTurn ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.3)',
              boxShadow: isMyTurn 
                ? '0 4px 12px rgba(255, 255, 255, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.1)' 
                : '0 2px 8px rgba(0, 0, 0, 0.3)',
              transition: 'all 0.3s ease',
              animation: isMyTurn ? 'pulseGlow 2s ease-in-out infinite' : 'none'
            }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              {(() => {
                const currentPlayer = players.find(p => p.userProfileId === currentTurn)
                const currentPlayerIndex = currentPlayer ? players.indexOf(currentPlayer) : -1
                const style = currentPlayerIndex >= 0 ? getPlayerStyle(currentPlayerIndex) : { emoji: '⚪', color: '#FFFFFF', name: 'Player' }
                return (
                  <>
                    <span className="text-lg">{style.emoji}</span>
                    <span style={{ color: style.color }}>
                      {isMyTurn ? 'Your Turn' : `${currentPlayer?.name || 'Player'}'s Turn`}
                    </span>
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
              gridTemplateColumns: `repeat(${CARD_COLS}, 1fr)`,
              gridTemplateRows: `repeat(${CARD_ROWS}, 1fr)`,
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
                className={`border-2 rounded-xl transition-all duration-300 flex items-center justify-center text-4xl ${
                  isClickable ? 'hover:scale-105 cursor-pointer active:scale-95' : 'cursor-not-allowed'
                } ${card.matched ? 'opacity-60' : ''} ${!isClickable && !isFlipped ? 'opacity-60' : ''}`}
                style={{
                  width: cardWidth,
                  height: cardHeight,
                  backgroundColor: isFlipped 
                    ? (card.matched 
                      ? 'rgba(255, 255, 255, 0.85)' 
                      : 'rgba(255, 255, 255, 0.98)')
                    : 'rgba(255, 255, 255, 0.12)',
                  borderColor: isFlipped 
                    ? (card.matched 
                      ? 'rgba(255, 255, 255, 0.4)' 
                      : isSelected 
                        ? 'rgba(255, 255, 255, 0.9)' 
                        : 'rgba(255, 255, 255, 0.6)')
                    : isClickable 
                      ? 'rgba(255, 255, 255, 0.4)' 
                      : 'rgba(255, 255, 255, 0.2)',
                  transform: `${isFlipped ? 'rotateY(0deg)' : 'rotateY(180deg)'} ${isMatchAnimating ? 'scale(1.15)' : isMismatchAnimating ? 'scale(0.95)' : 'scale(1)'}`,
                  transformStyle: 'preserve-3d',
                  perspective: '1000px',
                  backfaceVisibility: 'visible',
                  boxShadow: isFlipped 
                    ? (card.matched 
                      ? '0 2px 8px rgba(255, 255, 255, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.1)' 
                      : isSelected 
                        ? '0 6px 20px rgba(255, 255, 255, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.3)' 
                        : '0 4px 14px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)')
                    : '0 3px 10px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.15)',
                  transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease, border-color 0.3s ease, background-color 0.3s ease',
                  touchAction: 'manipulation',
                  pointerEvents: 'auto',
                  position: 'relative',
                  zIndex: isMatchAnimating || isMismatchAnimating ? 200 : 100,
                  WebkitTapHighlightColor: 'transparent',
                  userSelect: 'none',
                  WebkitTransform: `${isFlipped ? 'rotateY(0deg)' : 'rotateY(180deg)'} ${isMatchAnimating ? 'scale(1.15)' : isMismatchAnimating ? 'scale(0.95)' : 'scale(1)'}`,
                  willChange: 'transform',
                  filter: isMatchAnimating ? 'brightness(1.3) drop-shadow(0 0 8px rgba(255, 255, 255, 0.6))' : isMismatchAnimating ? 'brightness(0.7)' : 'none'
                }}
              >
                {isFlipped && (
                  <span 
                    style={{ 
                      color: card.matched ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.95)',
                      transform: 'rotateY(0deg)',
                      textShadow: card.matched ? '0 1px 2px rgba(0, 0, 0, 0.1)' : '0 2px 4px rgba(0, 0, 0, 0.15)',
                      pointerEvents: 'none',
                      fontSize: '2.5rem',
                      transition: 'all 0.3s ease',
                      filter: isMatchAnimating ? 'drop-shadow(0 0 4px rgba(255, 255, 255, 0.8))' : 'none'
                    }}
                  >
                    {card.symbol}
                  </span>
                )}
                {!isFlipped && (
                  <div 
                    style={{ 
                      transform: 'rotateY(180deg)',
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundImage: `
                        repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.12) 0px, rgba(255, 255, 255, 0.12) 2px, transparent 2px, transparent 10px),
                        repeating-linear-gradient(-45deg, rgba(255, 255, 255, 0.12) 0px, rgba(255, 255, 255, 0.12) 2px, transparent 2px, transparent 10px),
                        radial-gradient(circle at center, rgba(255, 255, 255, 0.18) 0%, transparent 75%)
                      `,
                      backgroundSize: '100% 100%, 100% 100%, 100% 100%',
                      position: 'relative',
                      pointerEvents: 'none',
                      borderRadius: '10px'
                    }}
                  >
                    <div style={{
                      width: '55%',
                      height: '55%',
                      border: '2px solid rgba(255, 255, 255, 0.4)',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.02) 100%)',
                      boxShadow: 'inset 0 2px 6px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(255, 255, 255, 0.1)',
                      pointerEvents: 'none',
                      transition: 'all 0.3s ease'
                    }}>
                      <span style={{ 
                        color: 'rgba(255, 255, 255, 0.8)',
                        fontSize: '2.8rem',
                        fontWeight: 'bold',
                        textShadow: '0 2px 6px rgba(0, 0, 0, 0.4), 0 0 8px rgba(255, 255, 255, 0.1)',
                        pointerEvents: 'none',
                        fontFamily: 'system-ui, -apple-system, sans-serif'
                      }}>
                        ?
                      </span>
                    </div>
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
              backgroundColor: 'rgba(0, 0, 0, 0.85)',
              padding: '24px',
              zIndex: 20,
              pointerEvents: 'auto'
            }}
          >
            <div className="text-center mb-8">
              <h1 className="text-4xl sm:text-5xl font-bold mb-3 text-white tracking-wider" style={{
                textShadow: '0 2px 8px rgba(255, 255, 255, 0.3), 0 0 20px rgba(255, 255, 255, 0.1)',
                letterSpacing: '0.1em'
              }}>
                MEMORY
              </h1>
              <div className="w-24 h-1 mx-auto mb-4" style={{
                background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent)'
              }}></div>
              <p className="text-lg sm:text-xl mb-2 text-white/90 font-medium">Match pairs of cards</p>
              <p className="text-sm text-white/60 mb-6">
                {players.length > 1 ? `${players.length} players ready` : 'Waiting for players...'}
              </p>
            </div>
            {isHost && (
              <button
                onClick={startGame}
                disabled={players.length < 2}
                className="px-6 py-3 text-base font-bold text-white border-2 rounded-xl hover:bg-white hover:text-black transition-all duration-300 cursor-pointer hover:scale-105 hover:shadow-xl hover:shadow-white/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-transparent disabled:hover:text-white"
                style={{
                  borderColor: 'rgba(255, 255, 255, 0.4)',
                  backgroundColor: players.length >= 2 ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
                  minWidth: '180px'
                }}
              >
                {players.length < 2 ? 'Waiting for Player 2...' : 'Start Game'}
              </button>
            )}
            {!isHost && (
              <div className="text-center">
                <p className="text-sm text-white/70 mb-2">Waiting for host to start...</p>
                <div className="flex justify-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-white/40 animate-pulse" style={{ animationDelay: '0s' }}></div>
                  <div className="w-2 h-2 rounded-full bg-white/40 animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-2 h-2 rounded-full bg-white/40 animate-pulse" style={{ animationDelay: '0.4s' }}></div>
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
              backgroundColor: 'rgba(0, 0, 0, 0.92)',
              pointerEvents: 'auto'
            }}
          >
            <div className="text-center mb-8">
              <h2 className="text-4xl sm:text-5xl font-bold mb-3 text-white tracking-wider" style={{
                textShadow: '0 2px 8px rgba(255, 255, 255, 0.3), 0 0 20px rgba(255, 255, 255, 0.1)',
                letterSpacing: '0.1em'
              }}>
                Game Over
              </h2>
              <div className="w-24 h-1 mx-auto mb-6" style={{
                background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent)'
              }}></div>
            </div>
            <div className="mb-8 w-full max-w-md">
              <h3 className="text-lg sm:text-xl font-semibold mb-4 text-white/90 text-center">Final Scores</h3>
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
                        className="text-lg sm:text-xl mb-2 flex items-center justify-between px-4 py-3 rounded-lg border transition-all duration-300"
                        style={{
                          backgroundColor: isWinner ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                          borderColor: isWinner ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.2)',
                          boxShadow: isWinner ? '0 4px 12px rgba(255, 255, 255, 0.1)' : 'none',
                          transform: isWinner ? 'scale(1.02)' : 'scale(1)',
                          animation: isWinner ? 'fadeInUp 0.5s ease-out' : 'fadeInUp 0.5s ease-out',
                          animationDelay: `${idx * 0.1}s`
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{idx === 0 ? '🏆' : `${idx + 1}.`}</span>
                          <span className="text-2xl">{style.emoji}</span>
                          <span className="text-white font-medium">{player?.name || 'Player'}</span>
                        </div>
                        <span className="text-white font-bold" style={{ color: style.color, fontSize: '1.3em' }}>
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
                className="px-8 py-4 text-lg font-bold text-white border-2 rounded-xl hover:bg-white hover:text-black transition-all duration-300 cursor-pointer hover:scale-105 hover:shadow-xl hover:shadow-white/20"
                style={{
                  borderColor: 'rgba(255, 255, 255, 0.4)',
                  backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
                  minWidth: '180px'
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

