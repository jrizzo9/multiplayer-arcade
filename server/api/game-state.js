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

