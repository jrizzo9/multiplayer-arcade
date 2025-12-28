// Game configuration - defines which games are available and their properties

export const GAMES = {
  pong: {
    id: 'pong',
    name: 'PONG',
    multiplayer: true,
    minPlayers: 2,
    maxPlayers: 4, // Allow up to 4 players (2 play, others wait in queue)
    component: 'Pong',
    icon: '🏓',
    color: '#3B82F6', // Blue
    gradient: 'linear-gradient(135deg, #3B82F6 0%, #1E40AF 100%)',
    borderColor: 'rgba(59, 130, 246, 0.5)',
    bgColor: 'rgba(59, 130, 246, 0.1)'
  },
  'magnet-mayhem': {
    id: 'magnet-mayhem',
    name: 'MAGNET MAYHEM',
    multiplayer: true,
    minPlayers: 3,
    maxPlayers: 8, // Allow up to 8 players
    component: 'MagnetMayhem',
    hidden: true, // Hidden for now
    icon: '🧲',
    color: '#EF4444', // Red
    gradient: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)',
    borderColor: 'rgba(239, 68, 68, 0.5)',
    bgColor: 'rgba(239, 68, 68, 0.1)'
  },
  memory: {
    id: 'memory',
    name: 'MEMORY',
    multiplayer: true,
    minPlayers: 2,
    maxPlayers: 4,
    component: 'MemoryGame',
    icon: '🧠',
    color: '#8B5CF6', // Purple
    gradient: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
    borderColor: 'rgba(139, 92, 246, 0.5)',
    bgColor: 'rgba(139, 92, 246, 0.1)'
  }
}

// Get all multiplayer games
export function getMultiplayerGames() {
  return Object.values(GAMES).filter(game => game.multiplayer && !game.hidden)
}

// Get all single-player games
export function getSinglePlayerGames() {
  return Object.values(GAMES).filter(game => !game.multiplayer)
}

// Get game by ID
export function getGame(gameId) {
  return GAMES[gameId] || null
}

// Check if a game supports multiplayer
export function isMultiplayerGame(gameId) {
  const game = GAMES[gameId]
  return game ? game.multiplayer : false
}

