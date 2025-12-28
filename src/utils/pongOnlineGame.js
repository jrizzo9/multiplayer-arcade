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

