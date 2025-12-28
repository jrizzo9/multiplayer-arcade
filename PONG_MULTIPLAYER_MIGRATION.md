# Pong Multiplayer Migration Guide

## Overview

This guide explains how to migrate Pong's multiplayer system from Socket.IO to the REST API + polling approach used by Mancala. Mancala's system is simpler, more reliable, and easier to debug.

## Key Differences

### Current Pong System (Socket.IO)
- Real-time bidirectional communication
- Host runs physics and broadcasts state
- Complex connection management
- Requires persistent WebSocket connections
- More prone to connection issues

### Mancala System (REST API + Polling)
- Simple HTTP GET/POST requests
- Stateless API design
- Polling every 100ms for updates
- Move sequence tracking prevents stale states
- Falls back to URL-based sharing if API unavailable
- Works on both localhost and Vercel

## Architecture Comparison

### Mancala's Architecture

```
Frontend (React)
  ↓
OnlineGameManager (polling every 100ms)
  ↓
REST API (/api/game-state)
  ↓
In-memory storage (Map) or Database
```

### Pong's Current Architecture

```
Frontend (React)
  ↓
Socket.IO Client
  ↓
Socket.IO Server
  ↓
In-memory rooms (Map) + SQLite Database
```

## Step-by-Step Migration

### Step 1: Create API Endpoints

Create a new file `server/api/game-state.js` (or add to existing server):

```javascript
// server/api/game-state.js
import express from 'express';
import cors from 'cors';

const router = express.Router();
router.use(cors());
router.use(express.json());

// In-memory storage for game states
const games = new Map();

// Clean up old games (older than 1 hour)
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [id, game] of games.entries()) {
    if (game.lastUpdated < oneHourAgo) {
      games.delete(id);
      console.log(`Cleaned up old game room: ${id}`);
    }
  }
}, 5 * 60 * 1000); // Run cleanup every 5 minutes

// GET: Retrieve game state
router.get('/game-state', (req, res) => {
  const { roomId } = req.query;

  if (!roomId) {
    return res.status(400).json({ error: 'roomId is required' });
  }

  const game = games.get(roomId);
  if (!game) {
    return res.status(404).json({ error: 'Room not found' });
  }

  res.json({
    gameState: game.gameState,
    player1Ready: game.player1Ready || false,
    player2Ready: game.player2Ready || false,
    player2Connected: game.player2Connected || false,
    player1Connected: game.player1Connected || false,
    lastUpdated: game.lastUpdated
  });
});

// POST: Update game state
router.post('/game-state', (req, res) => {
  const { roomId } = req.query;
  const { gameState, player1Ready, player2Ready, player2Connected, player1Connected } = req.body;

  if (!roomId) {
    return res.status(400).json({ error: 'roomId is required' });
  }

  const existing = games.get(roomId) || {};
  
  // Only update gameState if the new one has a higher move sequence (or is initial state)
  let finalGameState = existing.gameState;
  if (gameState !== undefined) {
    const existingSequence = existing.gameState?.moveSequence || 0;
    const newSequence = gameState.moveSequence || 0;
    
    // Accept new state if it has a higher sequence, or if sequences are equal but new one is more recent
    if (newSequence > existingSequence || 
        (newSequence === existingSequence && gameState.lastMoveTimestamp && 
         gameState.lastMoveTimestamp > (existing.gameState?.lastMoveTimestamp || 0))) {
      finalGameState = gameState;
    } else if (newSequence === 0 && existingSequence === 0) {
      // Both are initial states - accept the new one (for rematch scenarios)
      finalGameState = gameState;
    } else {
      // Keep existing state if new one is older
      finalGameState = existing.gameState;
    }
  }
  
  games.set(roomId, {
    gameState: finalGameState,
    player1Ready: player1Ready !== undefined ? player1Ready : existing.player1Ready,
    player2Ready: player2Ready !== undefined ? player2Ready : existing.player2Ready,
    player2Connected: player2Connected !== undefined ? player2Connected : existing.player2Connected,
    player1Connected: player1Connected !== undefined ? player1Connected : existing.player1Connected,
    lastUpdated: Date.now()
  });

  res.json({ success: true });
});

export default router;
```

### Step 2: Integrate API Router into Server

Update `server/index.js` to include the API routes:

```javascript
// Add at the top
import gameStateRouter from './api/game-state.js';

// Add before other routes
app.use('/api', gameStateRouter);
```

### Step 3: Create OnlineGameManager for Pong

Create `src/utils/pongOnlineGame.js`:

```javascript
// Online game synchronization using API (for localhost/Vercel) with URL fallback
// Adapted from Mancala's OnlineGameManager

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

export class PongOnlineGameManager {
  constructor(roomId, playerNumber, onStateUpdate) {
    this.roomId = roomId;
    this.playerNumber = playerNumber;
    this.onStateUpdate = onStateUpdate;
    this.checkInterval = null;
    this.lastStateHash = null;
    this.useAPI = this.detectAPI();
    this.lastGameState = null;
    this.apiErrorLogged = false;
    this.lastMoveSequence = 0;
    this.pendingMoveSequence = null;
    this.init();
  }

  detectAPI() {
    const hostname = window.location.hostname;
    const isVercel = hostname.includes('vercel.app') || hostname.includes('vercel.com');
    const isLocalNetwork = hostname === 'localhost' ||
                           hostname === '127.0.0.1' ||
                           /^192\.168\./.test(hostname) ||
                           /^10\./.test(hostname) ||
                           /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
    const useAPI = isVercel || 
                   isLocalNetwork ||
                   import.meta.env.VITE_USE_API === 'true';
    return useAPI;
  }

  init() {
    if (this.useAPI) {
      // Poll API every 100ms for near-instant response
      this.checkInterval = setInterval(() => {
        this.checkForUpdatesAPI();
      }, 100);
    } else {
      // Fallback to URL-based sharing
      window.addEventListener('popstate', this.handleURLChange.bind(this));
      this.checkInterval = setInterval(() => {
        this.checkForUpdates();
      }, 300);
    }
  }

  handleURLChange() {
    this.checkForUpdates();
  }

  // API-based methods
  async checkForUpdatesAPI() {
    try {
      const response = await fetch(`${API_BASE}/game-state?roomId=${this.roomId}`);
      if (!response.ok) {
        if (response.status === 404) {
          // Room not created yet - this is normal
          return;
        }
        if (response.status === 500 || response.status >= 502) {
          console.log('API server error, falling back to URL-based sharing');
          this.useAPI = false;
          this.init();
        }
        return;
      }

      const data = await response.json();
      if (data.gameState) {
        const stateHash = JSON.stringify(data.gameState);
        const syncedMoveSequence = data.gameState.moveSequence || 0;
        
        // Only update if state has changed
        if (stateHash !== this.lastStateHash) {
          // Use move sequence to determine if this is a newer or older state
          if (syncedMoveSequence < this.lastMoveSequence && syncedMoveSequence !== 0) {
            // This is an older state - ignore it
            return;
          }
          
          // If we have a pending move, check if this is that move being reflected back
          if (this.pendingMoveSequence !== null && syncedMoveSequence === this.pendingMoveSequence) {
            // This is our own move being reflected back - just update tracking
            this.lastStateHash = stateHash;
            this.lastGameState = data.gameState;
            this.lastMoveSequence = syncedMoveSequence;
            this.pendingMoveSequence = null;
            return;
          }
          
          // Check if this is different from our last known state
          if (!this.lastGameState) {
            // No previous state - this is initial sync, accept it
            this.lastStateHash = stateHash;
            this.lastMoveSequence = syncedMoveSequence;
            this.onStateUpdate(data.gameState);
            this.lastGameState = data.gameState;
            return;
          }
          
          // Compare states to see if this is a new move
          const gameStateChanged = JSON.stringify(this.lastGameState) !== JSON.stringify(data.gameState);
          
          if (gameStateChanged) {
            // Check if this is the opponent's move
            const opponentPlayer = this.playerNumber === 1 ? 2 : 1;
            const isOpponentMove = data.gameState.lastMoveBy === opponentPlayer;
            
            if (isOpponentMove) {
              // This is a new state from opponent - update it
              this.onStateUpdate(data.gameState);
              this.lastGameState = data.gameState;
              this.lastStateHash = stateHash;
              this.lastMoveSequence = Math.max(this.lastMoveSequence || 0, syncedMoveSequence);
            } else if (data.gameState.lastMoveBy === this.playerNumber) {
              // This is our own move being reflected back - just update tracking
              this.lastGameState = data.gameState;
              this.lastStateHash = stateHash;
              this.lastMoveSequence = Math.max(this.lastMoveSequence || 0, syncedMoveSequence);
            } else {
              // Edge case: accept if sequence is higher
              if (syncedMoveSequence > this.lastMoveSequence) {
                this.onStateUpdate(data.gameState);
                this.lastGameState = data.gameState;
                this.lastStateHash = stateHash;
                this.lastMoveSequence = syncedMoveSequence;
              }
            }
          } else {
            // No meaningful change - just update tracking
            this.lastGameState = data.gameState;
            this.lastMoveSequence = Math.max(this.lastMoveSequence || 0, syncedMoveSequence);
          }
        }
      }
    } catch (error) {
      if (this.useAPI && !this.apiErrorLogged) {
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
          console.log('Network error - API server may not be accessible');
          console.log('Falling back to URL-based sharing');
          this.apiErrorLogged = true;
          this.useAPI = false;
          this.init();
        }
      }
    }
  }

  async sendMoveAPI(gameState) {
    if (!this.useAPI) return;
    
    try {
      const moveSequence = gameState.moveSequence || ((this.lastMoveSequence || 0) + 1);
      const gameStateWithSequence = {
        ...gameState,
        moveSequence,
        lastMoveBy: gameState.lastMoveBy || this.playerNumber,
        lastMoveTimestamp: gameState.lastMoveTimestamp || Date.now()
      };
      
      this.pendingMoveSequence = moveSequence;
      
      await fetch(`${API_BASE}/game-state?roomId=${this.roomId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gameState: gameStateWithSequence,
          [`player${this.playerNumber}Ready`]: true
        })
      });
      
      this.lastMoveSequence = moveSequence;
    } catch (error) {
      console.error('Failed to send move:', error);
      this.pendingMoveSequence = null;
    }
  }

  // Encode game state to URL-safe string (fallback method)
  encodeState(gameState) {
    if (!gameState) return null;
    
    const state = {
      leftPaddleY: gameState.leftPaddleY,
      rightPaddleY: gameState.rightPaddleY,
      ballX: gameState.ballX,
      ballY: gameState.ballY,
      ballVelX: gameState.ballVelX,
      ballVelY: gameState.ballVelY,
      leftScore: gameState.leftScore,
      rightScore: gameState.rightScore,
      state: gameState.state,
      moveSequence: gameState.moveSequence || 0
    };
    return btoa(JSON.stringify(state));
  }

  // Decode game state from URL-safe string
  decodeState(encoded) {
    try {
      return JSON.parse(atob(encoded));
    } catch (e) {
      console.error('Failed to decode state:', e);
      return null;
    }
  }

  // Update URL with current game state (fallback method)
  updateURL(gameState) {
    if (this.useAPI) {
      this.sendMoveAPI(gameState);
      return;
    }
    
    const state = this.encodeState(gameState);
    if (!state) return;
    
    const url = new URL(window.location);
    url.searchParams.set('room', this.roomId);
    url.searchParams.set('player', this.playerNumber);
    url.searchParams.set('state', state);
    
    window.history.pushState({}, '', url);
    this.lastStateHash = state;
  }

  // Get state from URL
  getStateFromURL() {
    const params = new URLSearchParams(window.location.search);
    const encodedState = params.get('state');
    if (encodedState) {
      const decoded = this.decodeState(encodedState);
      if (decoded && encodedState !== this.lastStateHash) {
        this.lastStateHash = encodedState;
        return decoded;
      }
    }
    return null;
  }

  // Check for opponent's move updates (URL fallback)
  checkForUpdates() {
    const state = this.getStateFromURL();
    if (state && this.onStateUpdate) {
      const params = new URLSearchParams(window.location.search);
      const lastMoveBy = params.get('lastMove');
      
      if (lastMoveBy && parseInt(lastMoveBy) !== this.playerNumber) {
        // Opponent's move
        this.onStateUpdate(state);
      } else if (!lastMoveBy) {
        // Initial state
        this.onStateUpdate(state);
      }
    }
  }

  // Send move to opponent
  sendMove(gameState) {
    if (this.useAPI) {
      this.sendMoveAPI(gameState);
    } else {
      this.updateURL(gameState);
      
      const url = new URL(window.location);
      url.searchParams.set('lastMove', this.playerNumber);
      window.history.replaceState({}, '', url);
    }
  }
  
  // Update lobby state (ready status, connection status)
  async updateLobbyState(player1Ready, player2Ready, player2Connected, player1Connected) {
    if (!this.useAPI) return;
    
    try {
      const body = {};
      if (player1Ready !== undefined) body.player1Ready = player1Ready;
      if (player2Ready !== undefined) body.player2Ready = player2Ready;
      if (player2Connected !== undefined) body.player2Connected = player2Connected;
      if (player1Connected !== undefined) body.player1Connected = player1Connected;
      
      await fetch(`${API_BASE}/game-state?roomId=${this.roomId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      console.error('Failed to update lobby state:', error);
    }
  }
  
  // Get lobby state
  async getLobbyState() {
    if (!this.useAPI) return null;
    
    try {
      const response = await fetch(`${API_BASE}/game-state?roomId=${this.roomId}`);
      if (response.status === 404) return null;
      if (!response.ok) return null;
      
      const data = await response.json();
      return {
        player1Ready: data.player1Ready || false,
        player2Ready: data.player2Ready || false,
        player2Connected: data.player2Connected || false,
        player1Connected: data.player1Connected || false
      };
    } catch (error) {
      return null;
    }
  }

  // Cleanup when leaving online game
  cleanup() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    window.removeEventListener('popstate', this.handleURLChange.bind(this));
  }

  // Generate a random room ID
  static generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  // Create shareable link for player 2
  static createShareableLink(roomId, initialState = null) {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('room', roomId);
    url.searchParams.set('player', '2');
    if (initialState) {
      url.searchParams.set('state', initialState);
    }
    return url.toString();
  }

  // Get room info from URL
  static getRoomFromURL() {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');
    const player = params.get('player');
    return {
      roomId,
      playerNumber: player ? parseInt(player) : null
    };
  }
}
```

### Step 4: Update Pong Component

Modify `src/components/Pong.jsx` to use the new system:

```javascript
import { useState, useEffect, useRef, useCallback } from 'react'
import { PongOnlineGameManager } from '../utils/pongOnlineGame'
import Notification from './Notification'

// ... constants ...

function Pong({ roomId, isHost, onLeave, onRoomCreated, playerName, players: roomPlayers }) {
  // ... existing state ...
  
  const onlineManagerRef = useRef(null)
  const playerNumberRef = useRef(isHost ? 1 : 2)
  const moveSequenceRef = useRef(0)

  // Initialize online manager
  useEffect(() => {
    if (!roomId) return

    // Determine player number
    const playerNumber = isHost ? 1 : 2
    playerNumberRef.current = playerNumber

    // Initialize online manager
    const manager = new PongOnlineGameManager(
      roomId,
      playerNumber,
      (syncedState) => {
        // Update game state when opponent makes a move
        if (!isHost) {
          // Non-host receives state updates
          setLeftPaddleY(syncedState.leftPaddleY || leftPaddleYRef.current)
          setRightPaddleY(syncedState.rightPaddleY || rightPaddleYRef.current)
          setBallX(syncedState.ballX || ballXRef.current)
          setBallY(syncedState.ballY || ballYRef.current)
          setBallVelX(syncedState.ballVelX || ballVelXRef.current)
          setBallVelY(syncedState.ballVelY || ballVelYRef.current)
          setLeftScore(syncedState.leftScore || leftScoreRef.current)
          setRightScore(syncedState.rightScore || rightScoreRef.current)
          
          // Update refs
          leftPaddleYRef.current = syncedState.leftPaddleY || leftPaddleYRef.current
          rightPaddleYRef.current = syncedState.rightPaddleY || rightPaddleYRef.current
          ballXRef.current = syncedState.ballX || ballXRef.current
          ballYRef.current = syncedState.ballY || ballYRef.current
          ballVelXRef.current = syncedState.ballVelX || ballVelXRef.current
          ballVelYRef.current = syncedState.ballVelY || ballVelYRef.current
          leftScoreRef.current = syncedState.leftScore || leftScoreRef.current
          rightScoreRef.current = syncedState.rightScore || rightScoreRef.current
          
          if (syncedState.state !== gameStateRef.current) {
            setGameState(syncedState.state)
            gameStateRef.current = syncedState.state
          }
        }
      }
    )
    
    onlineManagerRef.current = manager

    // Mark player as connected
    manager.updateLobbyState(
      playerNumber === 1 ? true : undefined,
      playerNumber === 2 ? true : undefined,
      playerNumber === 2 ? true : undefined,
      playerNumber === 1 ? true : undefined
    )

    return () => {
      manager.cleanup()
    }
  }, [roomId, isHost])

  // Handle paddle movement
  const movePaddle = useCallback((direction) => {
    if (gameStateRef.current !== 'playing') return
    
    const isLeft = playerNumberRef.current === 1
    const currentY = isLeft ? leftPaddleYRef.current : rightPaddleYRef.current
    let newY = currentY + (direction * PADDLE_SPEED)
    
    newY = Math.max(0, Math.min(GAME_HEIGHT - PADDLE_HEIGHT, newY))
    
    if (isLeft) {
      setLeftPaddleY(newY)
      leftPaddleYRef.current = newY
    } else {
      setRightPaddleY(newY)
      rightPaddleYRef.current = newY
    }
    
    // Send paddle position update
    if (onlineManagerRef.current) {
      const gameState = {
        leftPaddleY: leftPaddleYRef.current,
        rightPaddleY: rightPaddleYRef.current,
        ballX: ballXRef.current,
        ballY: ballYRef.current,
        ballVelX: ballVelXRef.current,
        ballVelY: ballVelYRef.current,
        leftScore: leftScoreRef.current,
        rightScore: rightScoreRef.current,
        state: gameStateRef.current,
        moveSequence: moveSequenceRef.current + 1,
        lastMoveBy: playerNumberRef.current,
        lastMoveTimestamp: Date.now()
      }
      moveSequenceRef.current = gameState.moveSequence
      onlineManagerRef.current.sendMove(gameState)
    }
  }, [])

  // Start game when host clicks
  const startGame = useCallback(() => {
    if (gameStateRef.current !== 'waiting' || !isHost) return
    
    gameStateRef.current = 'playing'
    setGameState('playing')
    
    // Reset game state
    const centerY = GAME_HEIGHT / 2 - PADDLE_HEIGHT / 2
    setLeftPaddleY(centerY)
    setRightPaddleY(centerY)
    setBallX(GAME_WIDTH / 2)
    setBallY(GAME_HEIGHT / 2)
    setBallVelX(BALL_SPEED * (Math.random() > 0.5 ? 1 : -1))
    setBallVelY((Math.random() - 0.5) * 2)
    setLeftScore(0)
    setRightScore(0)
    
    leftPaddleYRef.current = centerY
    rightPaddleYRef.current = centerY
    ballXRef.current = GAME_WIDTH / 2
    ballYRef.current = GAME_HEIGHT / 2
    ballVelXRef.current = BALL_SPEED * (Math.random() > 0.5 ? 1 : -1)
    ballVelYRef.current = (Math.random() - 0.5) * 2
    leftScoreRef.current = 0
    rightScoreRef.current = 0
    moveSequenceRef.current = 0
    
    // Send initial game state
    if (onlineManagerRef.current) {
      const gameState = {
        state: 'playing',
        leftPaddleY: centerY,
        rightPaddleY: centerY,
        ballX: GAME_WIDTH / 2,
        ballY: GAME_HEIGHT / 2,
        ballVelX: ballVelXRef.current,
        ballVelY: ballVelYRef.current,
        leftScore: 0,
        rightScore: 0,
        moveSequence: 0,
        lastMoveBy: 1,
        lastMoveTimestamp: Date.now()
      }
      onlineManagerRef.current.sendMove(gameState)
    }
  }, [isHost])

  // Game loop (only host runs physics)
  useEffect(() => {
    if (gameState !== 'playing' || !isHost) return

    const gameLoop = () => {
      if (gameStateRef.current !== 'playing') return

      // Update ball position
      ballXRef.current += ballVelXRef.current
      ballYRef.current += ballVelYRef.current

      // Ball collision with top/bottom walls
      if (ballYRef.current <= 0 || ballYRef.current >= GAME_HEIGHT - BALL_SIZE) {
        ballVelYRef.current = -ballVelYRef.current
        ballYRef.current = Math.max(0, Math.min(GAME_HEIGHT - BALL_SIZE, ballYRef.current))
      }

      // Ball collision with paddles
      // ... collision logic ...

      // Ball out of bounds - score
      if (ballXRef.current < 0) {
        rightScoreRef.current += 1
        setRightScore(rightScoreRef.current)
        
        if (rightScoreRef.current >= WIN_SCORE) {
          gameStateRef.current = 'gameover'
          setGameState('gameover')
        } else {
          // Reset ball
          ballXRef.current = GAME_WIDTH / 2
          ballYRef.current = GAME_HEIGHT / 2
          ballVelXRef.current = BALL_SPEED
          ballVelYRef.current = (Math.random() - 0.5) * 2
        }
      } else if (ballXRef.current > GAME_WIDTH) {
        leftScoreRef.current += 1
        setLeftScore(leftScoreRef.current)
        
        if (leftScoreRef.current >= WIN_SCORE) {
          gameStateRef.current = 'gameover'
          setGameState('gameover')
        } else {
          // Reset ball
          ballXRef.current = GAME_WIDTH / 2
          ballYRef.current = GAME_HEIGHT / 2
          ballVelXRef.current = -BALL_SPEED
          ballVelYRef.current = (Math.random() - 0.5) * 2
        }
      }

      setBallX(ballXRef.current)
      setBallY(ballYRef.current)
      setBallVelX(ballVelXRef.current)
      setBallVelY(ballVelYRef.current)

      // Broadcast game state to other players (every frame for smooth gameplay)
      if (onlineManagerRef.current) {
        const gameState = {
          state: 'playing',
          leftPaddleY: leftPaddleYRef.current,
          rightPaddleY: rightPaddleYRef.current,
          ballX: ballXRef.current,
          ballY: ballYRef.current,
          ballVelX: ballVelXRef.current,
          ballVelY: ballVelYRef.current,
          leftScore: leftScoreRef.current,
          rightScore: rightScoreRef.current,
          moveSequence: moveSequenceRef.current + 1,
          lastMoveBy: 1,
          lastMoveTimestamp: Date.now()
        }
        moveSequenceRef.current = gameState.moveSequence
        onlineManagerRef.current.sendMove(gameState)
      }

      gameLoopRef.current = requestAnimationFrame(gameLoop)
    }

    gameLoopRef.current = requestAnimationFrame(gameLoop)

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current)
      }
    }
  }, [gameState, isHost])

  // ... rest of component ...
}
```

### Step 5: Update Room Creation/Joining

You'll need to modify how rooms are created. Instead of Socket.IO events, use the REST API or URL-based approach:

```javascript
// In your room management component
const createRoom = () => {
  const roomId = PongOnlineGameManager.generateRoomId()
  const shareableLink = PongOnlineGameManager.createShareableLink(roomId)
  
  // Update URL
  window.history.pushState({}, '', `?room=${roomId}&player=1`)
  
  // Call onRoomCreated callback
  if (onRoomCreated) {
    onRoomCreated(roomId)
  }
  
  // Copy link to clipboard
  navigator.clipboard.writeText(shareableLink)
}

const joinRoom = (roomId) => {
  // Update URL
  window.history.pushState({}, '', `?room=${roomId}&player=2`)
  
  // Room will be initialized when Pong component mounts
}
```

### Step 6: Remove Socket.IO Dependencies

1. Remove `socket.io-client` from `package.json`:
```bash
npm uninstall socket.io-client
```

2. Remove all Socket.IO imports and usage from `Pong.jsx`

3. Update `server/index.js` to remove Socket.IO server setup (or keep it for other games)

## Key Implementation Details

### Move Sequence Tracking

The system uses move sequences to prevent stale states:
- Each game state update increments the sequence
- Only states with higher sequences are accepted
- Prevents race conditions and out-of-order updates

### Polling Frequency

- **100ms polling**: Fast enough for real-time gameplay
- **Deduplication**: Only processes actual state changes
- **Efficient**: Only updates when opponent's state changes

### Host Authority

- Host runs physics simulation
- Host sends state updates via API
- Non-host players receive updates and render accordingly
- Non-host players send paddle movements to host

### Fallback System

- **Primary**: REST API (localhost or Vercel)
- **Fallback**: URL-based state encoding
- Automatic detection and switching

## Testing

### Local Testing

1. Start the server:
```bash
cd server
npm start
```

2. Start the frontend:
```bash
npm run dev
```

3. Open two browser windows:
   - Window 1: Create room (Player 1)
   - Window 2: Join room using the link (Player 2)

### Network Testing

1. Find your local IP: `ifconfig` (Mac/Linux) or `ipconfig` (Windows)
2. Access from another device: `http://YOUR_IP:3000`
3. Create room on one device, join on another

## Advantages of This Approach

1. **Simplicity**: No WebSocket connection management
2. **Reliability**: HTTP requests are more reliable than WebSockets
3. **Debugging**: Easy to inspect API calls in browser DevTools
4. **Scalability**: Stateless API can be easily scaled
5. **Fallback**: URL-based sharing works even without server
6. **Vercel Ready**: Works automatically on Vercel with serverless functions

## Migration Checklist

- [ ] Create API endpoints (`/api/game-state`)
- [ ] Create `PongOnlineGameManager` class
- [ ] Update `Pong.jsx` to use new manager
- [ ] Remove Socket.IO dependencies
- [ ] Update room creation/joining logic
- [ ] Test local multiplayer
- [ ] Test network multiplayer
- [ ] Test fallback URL-based sharing
- [ ] Deploy and test on production

## Troubleshooting

### API not working
- Check server is running on port 8000
- Verify CORS is enabled
- Check browser console for errors

### State not syncing
- Verify move sequences are incrementing
- Check API responses in Network tab
- Ensure `onStateUpdate` callback is working

### High latency
- Reduce polling frequency (but may cause lag)
- Optimize game state size
- Consider using WebSockets for paddle movements only

## Next Steps

After migration:
1. Add lobby system (ready states, player connection status)
2. Add reconnection handling
3. Add game history/replay
4. Optimize for mobile devices
5. Add spectator mode

