// CPU Player utility - handles automatic gameplay for CPU profiles
import { isCPUProfile } from './profiles'

// CPU reaction time (ms) - competitive settings
const CPU_REACTION_MIN = 10
const CPU_REACTION_MAX = 50

// CPU accuracy (0-1) - competitive accuracy
const CPU_ACCURACY = 0.95

// Get a random delay for CPU actions (much faster for competitive play)
export function getCPUDelay() {
  return Math.random() * (CPU_REACTION_MAX - CPU_REACTION_MIN) + CPU_REACTION_MIN
}

// Check if CPU should succeed (based on accuracy)
export function cpuShouldSucceed() {
  return Math.random() < CPU_ACCURACY
}

// CPU logic for ClickButtonMicrogame
export function cpuClickButton(setClicks, clicks, targetClicks, setButtonPosition, onComplete) {
  if (clicks >= targetClicks) return
  
  setTimeout(() => {
    setClicks(prev => {
      const newClicks = prev + 1
      if (newClicks >= targetClicks) {
        onComplete(true)
      } else {
        // Move button to new random position
        setButtonPosition({
          x: Math.random() * 60 + 20,
          y: Math.random() * 60 + 20
        })
      }
      return newClicks
    })
  }, getCPUDelay())
}

// CPU logic for TapFastMicrogame
export function cpuTapFast(setTaps, taps, targetTaps, onComplete) {
  if (taps >= targetTaps) return
  
  setTimeout(() => {
    setTaps(prev => {
      const newTaps = prev + 1
      if (newTaps >= targetTaps) {
        onComplete(true)
      }
      return newTaps
    })
    // Continue tapping - very fast for competitive play
    cpuTapFast(setTaps, newTaps, targetTaps, onComplete)
  }, 30 + Math.random() * 20) // Very fast tapping (30-50ms)
}

// CPU logic for CatchFallingMicrogame
export function cpuCatchFalling(setBasketX, fallingObjectX, currentBasketX = 50) {
  // Move basket towards falling object with fast, precise movement
  const targetX = Math.max(10, Math.min(90, fallingObjectX))
  const diff = targetX - currentBasketX
  // Move faster and more directly for competitive play
  const moveAmount = Math.sign(diff) * Math.min(Math.abs(diff), 8) // Move up to 8% per frame
  setBasketX(prev => {
    const newX = prev + moveAmount
    return Math.max(10, Math.min(90, newX))
  })
}

// CPU logic for AvoidObstaclesMicrogame
export function cpuAvoidObstacles(setPlayerX, obstacles, currentPlayerX = 50) {
  // Find closest obstacle that's approaching
  const closestObstacle = obstacles
    .filter(obs => obs.y >= 0 && obs.y <= 85)
    .sort((a, b) => a.y - b.y)[0]
  
  if (closestObstacle) {
    // Move away from obstacle with better prediction
    const obstacleX = closestObstacle.x
    const safeDistance = 12 // Larger safety margin for competitive play
    let newX = currentPlayerX
    
    // If obstacle is close or approaching, move away proactively
    if (Math.abs(obstacleX - currentPlayerX) < safeDistance) {
      newX = obstacleX > currentPlayerX 
        ? Math.max(10, currentPlayerX - 15) // Move left more aggressively
        : Math.min(90, currentPlayerX + 15) // Move right more aggressively
    } else {
      // Otherwise, stay in a safe position
      newX = currentPlayerX
    }
    
    setPlayerX(prev => {
      const diff = newX - prev
      // Move faster for competitive play
      const moveAmount = Math.sign(diff) * Math.min(Math.abs(diff), 8)
      return Math.max(10, Math.min(90, prev + moveAmount))
    })
  }
}

// CPU logic for CountNumbersMicrogame
export function cpuCountNumbers(numbers, targetCount, handleNumberClick) {
  // Click the first targetCount numbers
  let clicked = 0
  numbers.forEach((num, index) => {
    if (clicked < targetCount) {
      setTimeout(() => {
        handleNumberClick(index)
        clicked++
      }, getCPUDelay() * clicked)
    }
  })
}

// CPU logic for MatchColorsMicrogame
export function cpuMatchColors(targetColor, colorOptions, handleColorClick) {
  // Find and click the target color
  const targetIndex = colorOptions.findIndex(c => c === targetColor)
  if (targetIndex >= 0) {
    setTimeout(() => {
      handleColorClick(targetColor)
    }, getCPUDelay())
  }
}

// CPU logic for MultiplayerGame (auto-jump)
export function cpuMultiplayerJump(jump, gameState) {
  if (gameState === 'playing') {
    // Jump periodically, but not too frequently
    const jumpInterval = setInterval(() => {
      if (cpuShouldSucceed()) {
        jump()
      }
    }, 500 + Math.random() * 500) // Jump every 500-1000ms
    
    return () => clearInterval(jumpInterval)
  }
}

// CPU logic for Pong (auto-move paddle)
export function cpuPongMove(ballX, ballY, playerNumber, setPaddleX, movePaddle) {
  // For CPU, move paddle towards ball
  // This is a simplified version - in real Pong, you'd track ball position
  if (playerNumber === 1) {
    // Left paddle - move based on ball Y position
    // Would need ball position from game state
  } else if (playerNumber === 2) {
    // Right paddle - move based on ball Y position
    // Would need ball position from game state
  }
}

// CPU memory for Memory Game - stores seen cards
// This should be maintained per CPU instance
let cpuMemoryMap = new Map() // Map<symbol, Set<index>> - tracks which indices have this symbol

// Reset CPU memory (call when game starts/restarts)
export function resetCPUMemory() {
  cpuMemoryMap = new Map()
}

// CPU logic for Memory Game - intelligent card selection
export function cpuMemoryGame(cards, flippedCards, handleCardFlip) {
  // If we already have 2 cards flipped, wait
  if (flippedCards.length >= 2) {
    return
  }
  
  // Get available cards (unflipped, unmatched)
  const availableCards = cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !card.flipped && !card.matched)
  
  if (availableCards.length === 0) {
    return
  }
  
  // If we have one card flipped (by us), try to find its match
  if (flippedCards.length === 1) {
    const firstCardIndex = flippedCards[0]
    const firstCard = cards[firstCardIndex]
    
    if (firstCard) {
      // Only use memory - we can't search through unflipped cards to find matches
      // This makes it fair: CPU must remember cards it has seen, just like a human
      if (cpuMemoryMap.has(firstCard.symbol)) {
        const seenIndices = cpuMemoryMap.get(firstCard.symbol)
        // Find if any of the seen indices are still available (and not the current card)
        const knownMatch = availableCards.find(
          ({ index }) => seenIndices.has(index) && index !== firstCardIndex
        )
        if (knownMatch) {
          // We remember where the match is! Flip it
          setTimeout(() => {
            handleCardFlip(knownMatch.index)
          }, getCPUDelay())
          return
        }
      }
      
      // No memory of match - just flip a random card
      // CPU can't "cheat" by searching for matches in unflipped cards
      const randomCard = availableCards[Math.floor(Math.random() * availableCards.length)]
      if (randomCard) {
        setTimeout(() => {
          handleCardFlip(randomCard.index)
        }, getCPUDelay())
        return
      }
    }
  }
  
  // No card flipped yet, or no match found
  // Strategy: Try to find a pair we know about, or explore new cards
  
  // First, check if we know any pairs (two cards with same symbol in memory)
  for (const [symbol, indices] of cpuMemoryMap.entries()) {
    if (indices.size >= 2) {
      // We've seen both cards of this pair
      const knownPair = Array.from(indices)
        .map(index => availableCards.find(ac => ac.index === index))
        .filter(Boolean)
      
      if (knownPair.length >= 2) {
        // Flip the first known card of the pair
        setTimeout(() => {
          handleCardFlip(knownPair[0].index)
        }, getCPUDelay())
        return
      }
    }
  }
  
  // No known pairs - explore new cards
  // Prefer cards we haven't seen yet, but mix in some randomness
  const unseenCards = availableCards.filter(({ card }) => {
    const seen = cpuMemoryMap.get(card.symbol)
    return !seen || !seen.has(card.index)
  })
  
  const cardsToChooseFrom = unseenCards.length > 0 ? unseenCards : availableCards
  const randomCard = cardsToChooseFrom[Math.floor(Math.random() * cardsToChooseFrom.length)]
  
  // Flip the card - memory will be updated by handleCardFlip
  if (randomCard) {
    setTimeout(() => {
      handleCardFlip(randomCard.index)
    }, getCPUDelay())
  }
}

// Update CPU memory when a card is flipped (call from MemoryGame component)
export function updateCPUMemory(cardIndex, card) {
  if (card && card.flipped && card.symbol) {
    if (!cpuMemoryMap.has(card.symbol)) {
      cpuMemoryMap.set(card.symbol, new Set())
    }
    cpuMemoryMap.get(card.symbol).add(cardIndex)
  }
}

// Clear memory for matched cards (call when a pair is matched)
export function clearCPUMemoryForPair(symbol) {
  cpuMemoryMap.delete(symbol)
}

export { isCPUProfile }

