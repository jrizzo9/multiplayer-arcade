import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Helper function to get current time in Central Time
function getCentralTime() {
  const now = new Date()
  // Format date in Central Time (America/Chicago timezone)
  // This automatically handles CST (UTC-6) and CDT (UTC-5) based on daylight saving time
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
  
  const parts = formatter.formatToParts(now)
  const year = parts.find(p => p.type === 'year').value
  const month = parts.find(p => p.type === 'month').value
  const day = parts.find(p => p.type === 'day').value
  const hour = parts.find(p => p.type === 'hour').value
  const minute = parts.find(p => p.type === 'minute').value
  const second = parts.find(p => p.type === 'second').value
  
  // Format as SQLite datetime string (YYYY-MM-DD HH:MM:SS)
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

// Initialize database
const db = new Database(join(__dirname, 'multiplayer-arcade.db'))

// Enable foreign keys
db.pragma('foreign_keys = ON')

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    state TEXT DEFAULT 'waiting',
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    host_user_profile_id TEXT,
    FOREIGN KEY (host_user_profile_id) REFERENCES user_profiles(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS user_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (color_id) REFERENCES player_colors(id)
  );

  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    socket_id TEXT NOT NULL,
    name TEXT NOT NULL,
    user_profile_id TEXT,
    color_id INTEGER,
    score INTEGER DEFAULT 0,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    left_at DATETIME,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE SET NULL,
    FOREIGN KEY (color_id) REFERENCES player_colors(id)
  );

  CREATE TABLE IF NOT EXISTS game_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    player_id TEXT,
    event_type TEXT NOT NULL,
    event_data TEXT,
    score INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS player_colors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    color TEXT NOT NULL,
    emoji TEXT NOT NULL,
    name TEXT,
    display_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS active_sessions (
    user_profile_id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS game_wins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_profile_id TEXT NOT NULL,
    game_type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_players_room_id ON players(room_id);
  CREATE INDEX IF NOT EXISTS idx_players_user_profile_id ON players(user_profile_id);
  CREATE INDEX IF NOT EXISTS idx_players_name ON players(name);
  CREATE INDEX IF NOT EXISTS idx_user_profiles_name ON user_profiles(name);
  CREATE INDEX IF NOT EXISTS idx_game_history_room_id ON game_history(room_id);
  CREATE INDEX IF NOT EXISTS idx_game_history_player_id ON game_history(player_id);
  CREATE INDEX IF NOT EXISTS idx_game_history_created_at ON game_history(created_at);
  CREATE INDEX IF NOT EXISTS idx_player_colors_display_order ON player_colors(display_order);
  CREATE INDEX IF NOT EXISTS idx_game_wins_user_profile_id ON game_wins(user_profile_id);
  CREATE INDEX IF NOT EXISTS idx_game_wins_game_type ON game_wins(game_type);
`)

// Migrate existing database schema
try {
  // Check if user_profiles table exists
  const userProfilesExists = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='user_profiles'
  `).get()
  
  if (!userProfilesExists) {
    // Create user_profiles table
    db.exec(`
      CREATE TABLE user_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (color_id) REFERENCES player_colors(id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_profiles_name ON user_profiles(name);
    `)
    console.log('Created user_profiles table')
  }
  
  // Check if players table has new columns
  const playersInfo = db.prepare('PRAGMA table_info(players)').all()
  const hasUserProfileId = playersInfo.some(col => col.name === 'user_profile_id')
  const hasColorId = playersInfo.some(col => col.name === 'color_id')
  
  if (!hasUserProfileId) {
    db.exec('ALTER TABLE players ADD COLUMN user_profile_id TEXT')
    db.exec('CREATE INDEX IF NOT EXISTS idx_players_user_profile_id ON players(user_profile_id)')
    console.log('Added user_profile_id column to players table')
  }
  
  if (!hasColorId) {
    db.exec('ALTER TABLE players ADD COLUMN color_id INTEGER')
    console.log('Added color_id column to players table')
  }
  
  // Check if rooms table has host_user_profile_id column
  const roomsInfo = db.prepare('PRAGMA table_info(rooms)').all()
  const hasHostUserProfileId = roomsInfo.some(col => col.name === 'host_user_profile_id')
  
  if (!hasHostUserProfileId) {
    db.exec('ALTER TABLE rooms ADD COLUMN host_user_profile_id TEXT')
    db.exec('CREATE INDEX IF NOT EXISTS idx_rooms_host_user_profile_id ON rooms(host_user_profile_id)')
    console.log('Added host_user_profile_id column to rooms table')
    
    // Migrate existing rooms: set host to first player who joined
    db.exec(`
      UPDATE rooms 
      SET host_user_profile_id = (
        SELECT p.user_profile_id 
        FROM players p 
        WHERE p.room_id = rooms.id 
        AND p.left_at IS NULL 
        ORDER BY p.joined_at ASC 
        LIMIT 1
      )
      WHERE host_user_profile_id IS NULL
    `)
    console.log('Migrated existing rooms to set host_user_profile_id')
  }
  
  // Update getPlayersByRoom query to include color info
  // This is handled in the prepared statement, so no migration needed
} catch (error) {
  console.error('Migration error:', error.message)
}

// Seed player colors if table is empty
const colorCount = db.prepare('SELECT COUNT(*) as count FROM player_colors').get()
if (colorCount.count === 0) {
  const colors = [
    { color: '#FF6B6B', emoji: '🦁', name: 'Lion' },
    { color: '#4ECDC4', emoji: '🐘', name: 'Elephant' },
    { color: '#FFE66D', emoji: '🐼', name: 'Panda' },
    { color: '#95E1D3', emoji: '🦊', name: 'Fox' },
    { color: '#FF9F43', emoji: '🐯', name: 'Tiger' },
    { color: '#A29BFE', emoji: '🐻', name: 'Bear' },
    { color: '#00D2D3', emoji: '🐬', name: 'Dolphin' },
    { color: '#FF6348', emoji: '🦄', name: 'Unicorn' },
    { color: '#FDCB6E', emoji: '🐨', name: 'Koala' },
    { color: '#6C5CE7', emoji: '🐸', name: 'Frog' },
    { color: '#00B894', emoji: '🐢', name: 'Turtle' },
    { color: '#E17055', emoji: '🐺', name: 'Wolf' },
    { color: '#74B9FF', emoji: '🐧', name: 'Penguin' },
    { color: '#FDCB6E', emoji: '🦉', name: 'Owl' },
    { color: '#A29BFE', emoji: '🦅', name: 'Eagle' },
    { color: '#00D2D3', emoji: '🦆', name: 'Duck' },
    { color: '#FF6348', emoji: '🐿️', name: 'Squirrel' },
    { color: '#6C5CE7', emoji: '🐰', name: 'Rabbit' },
    { color: '#00B894', emoji: '🐹', name: 'Hamster' },
    { color: '#E17055', emoji: '🐭', name: 'Mouse' },
    { color: '#74B9FF', emoji: '🐶', name: 'Dog' },
    { color: '#FDCB6E', emoji: '🐱', name: 'Cat' },
    { color: '#A29BFE', emoji: '🐴', name: 'Horse' },
    { color: '#00D2D3', emoji: '🦓', name: 'Zebra' },
    { color: '#FF6348', emoji: '🦒', name: 'Giraffe' },
    { color: '#6C5CE7', emoji: '🐪', name: 'Camel' },
    { color: '#00B894', emoji: '🦘', name: 'Kangaroo' },
    { color: '#E17055', emoji: '🐷', name: 'Pig' },
    { color: '#74B9FF', emoji: '🐮', name: 'Cow' },
    { color: '#FDCB6E', emoji: '🐔', name: 'Chicken' },
    { color: '#A29BFE', emoji: '🦃', name: 'Turkey' },
    { color: '#00D2D3', emoji: '🐝', name: 'Bee' },
    { color: '#FF6348', emoji: '🦋', name: 'Butterfly' },
    { color: '#6C5CE7', emoji: '🐛', name: 'Bug' },
    { color: '#00B894', emoji: '🦗', name: 'Cricket' },
    { color: '#E17055', emoji: '🦂', name: 'Scorpion' },
    { color: '#74B9FF', emoji: '🦀', name: 'Crab' },
    { color: '#FDCB6E', emoji: '🦞', name: 'Lobster' },
    { color: '#A29BFE', emoji: '🦐', name: 'Shrimp' },
    { color: '#00D2D3', emoji: '🐙', name: 'Octopus' },
    { color: '#FF6348', emoji: '🦑', name: 'Squid' },
    { color: '#6C5CE7', emoji: '🐟', name: 'Fish' },
    { color: '#00B894', emoji: '🐠', name: 'Tropical Fish' },
    { color: '#E17055', emoji: '🦈', name: 'Shark' },
    { color: '#74B9FF', emoji: '🐳', name: 'Whale' },
    { color: '#FDCB6E', emoji: '🐋', name: 'Whale' },
    { color: '#A29BFE', emoji: '🦭', name: 'Seal' },
  ]
  
  const insertColor = db.prepare('INSERT INTO player_colors (color, emoji, name, display_order) VALUES (?, ?, ?, ?)')
  const insertMany = db.transaction((colors) => {
    for (let i = 0; i < colors.length; i++) {
      insertColor.run(colors[i].color, colors[i].emoji, colors[i].name, i)
    }
  })
  insertMany(colors)
  console.log(`Seeded ${colors.length} player colors`)
}

// Prepared statements for better performance
const stmts = {
  // Room operations
  createRoom: db.prepare(`
    INSERT INTO rooms (id, state, host_user_profile_id) VALUES (?, ?, ?)
  `),
  getRoom: db.prepare(`
    SELECT * FROM rooms WHERE id = ?
  `),
  updateRoomState: db.prepare(`
    UPDATE rooms SET state = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?
  `),
  updateRoomActivity: db.prepare(`
    UPDATE rooms SET last_activity = CURRENT_TIMESTAMP WHERE id = ?
  `),
  getAllRooms: db.prepare(`
    SELECT * FROM rooms ORDER BY created_at DESC
  `),
  deleteRoom: db.prepare(`
    DELETE FROM rooms WHERE id = ?
  `),
  
  // User profile operations
  getUserProfileByName: db.prepare(`
    SELECT * FROM user_profiles WHERE name = ?
  `),
  getUserProfileById: db.prepare(`
    SELECT * FROM user_profiles WHERE id = ?
  `),
  createUserProfile: db.prepare(`
    INSERT INTO user_profiles (id, name, color_id, created_at)
    VALUES (?, ?, ?, ?)
  `),
  updateUserProfileColor: db.prepare(`
    UPDATE user_profiles SET color_id = ? WHERE id = ?
  `),
  updateUserProfileLastSeen: db.prepare(`
    UPDATE user_profiles SET last_seen = ? WHERE id = ?
  `),
  getAssignedColorIds: db.prepare(`
    SELECT DISTINCT color_id FROM user_profiles WHERE color_id IS NOT NULL
  `),
  getNextAvailableColor: db.prepare(`
    SELECT id FROM player_colors
    WHERE id NOT IN (
      SELECT DISTINCT color_id FROM user_profiles WHERE color_id IS NOT NULL
    )
    ORDER BY display_order ASC
    LIMIT 1
  `),
  deleteUserProfile: db.prepare(`
    DELETE FROM user_profiles WHERE id = ?
  `),
  
  // Player operations
  addPlayer: db.prepare(`
    INSERT INTO players (id, room_id, socket_id, name, user_profile_id, color_id, score)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getPlayer: db.prepare(`
    SELECT * FROM players WHERE id = ? OR socket_id = ?
  `),
  getPlayersByRoom: db.prepare(`
    SELECT p.*, pc.color, pc.emoji, pc.name as color_name,
           up.id as user_profile_id, up.name as profile_name, up.created_at as profile_created_at, up.last_seen as profile_last_seen
    FROM players p
    LEFT JOIN player_colors pc ON p.color_id = pc.id
    LEFT JOIN user_profiles up ON p.user_profile_id = up.id
    WHERE p.room_id = ? AND p.left_at IS NULL
    ORDER BY p.joined_at ASC
  `),
  updatePlayerName: db.prepare(`
    UPDATE players SET name = ? WHERE id = ?
  `),
  updatePlayerScore: db.prepare(`
    UPDATE players SET score = ? WHERE id = ?
  `),
  removePlayer: db.prepare(`
    UPDATE players SET left_at = CURRENT_TIMESTAMP WHERE socket_id = ?
  `),
  removePlayerById: db.prepare(`
    DELETE FROM players WHERE id = ?
  `),
  removeAllPlayersFromRoom: db.prepare(`
    UPDATE players SET left_at = CURRENT_TIMESTAMP WHERE room_id = ? AND left_at IS NULL
  `),
  getPlayerBySocket: db.prepare(`
    SELECT * FROM players WHERE socket_id = ? AND left_at IS NULL
  `),
  
  // Game history operations
  addGameEvent: db.prepare(`
    INSERT INTO game_history (room_id, player_id, event_type, event_data, score)
    VALUES (?, ?, ?, ?, ?)
  `),
  getGameHistory: db.prepare(`
    SELECT gh.*, p.name as player_name
    FROM game_history gh
    LEFT JOIN players p ON gh.player_id = p.id
    WHERE gh.room_id = ?
    ORDER BY gh.created_at DESC
    LIMIT ?
  `),
  getAllGameHistory: db.prepare(`
    SELECT gh.*, p.name as player_name, r.id as room_id
    FROM game_history gh
    LEFT JOIN players p ON gh.player_id = p.id
    LEFT JOIN rooms r ON gh.room_id = r.id
    ORDER BY gh.created_at DESC
    LIMIT ?
  `),
  
  // Statistics queries
  getRoomStats: db.prepare(`
    SELECT 
      r.id,
      r.created_at,
      r.state,
      r.last_activity,
      COUNT(DISTINCT p.id) as player_count,
      MAX(p.score) as max_score,
      SUM(p.score) as total_score
    FROM rooms r
    LEFT JOIN players p ON r.id = p.room_id AND p.left_at IS NULL
    WHERE r.id = ?
    GROUP BY r.id
  `),
  getAllRoomStats: db.prepare(`
    SELECT 
      r.id,
      r.created_at,
      r.state,
      r.last_activity,
      COUNT(DISTINCT p.id) as player_count,
      MAX(p.score) as max_score,
      SUM(p.score) as total_score
    FROM rooms r
    LEFT JOIN players p ON r.id = p.room_id AND p.left_at IS NULL
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `),
  
  // Player colors operations
  getAllPlayerColors: db.prepare(`
    SELECT id, color, emoji, name, display_order
    FROM player_colors
    ORDER BY display_order ASC
  `),
  getPlayerColorById: db.prepare(`
    SELECT * FROM player_colors WHERE id = ?
  `),
  getPlayerColorByIndex: db.prepare(`
    SELECT * FROM player_colors
    ORDER BY display_order ASC
    LIMIT 1 OFFSET ?
  `),
  
  // Active session operations
  setActiveSession: db.prepare(`
    INSERT OR REPLACE INTO active_sessions (user_profile_id, created_at)
    VALUES (?, CURRENT_TIMESTAMP)
  `),
  clearActiveSession: db.prepare(`
    DELETE FROM active_sessions WHERE user_profile_id = ?
  `),
  getActiveSessions: db.prepare(`
    SELECT user_profile_id FROM active_sessions
  `),
  
  // Game wins operations
  recordWin: db.prepare(`
    INSERT INTO game_wins (user_profile_id, game_type, created_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `),
  getWinCount: db.prepare(`
    SELECT COUNT(*) as count FROM game_wins
    WHERE user_profile_id = ? AND game_type = ?
  `),
  getWinsByGameType: db.prepare(`
    SELECT user_profile_id, COUNT(*) as wins
    FROM game_wins
    WHERE game_type = ?
    GROUP BY user_profile_id
  `),
  getAllWins: db.prepare(`
    SELECT user_profile_id, game_type, COUNT(*) as wins
    FROM game_wins
    GROUP BY user_profile_id, game_type
  `),
  getPlayerWins: db.prepare(`
    SELECT game_type, COUNT(*) as wins
    FROM game_wins
    WHERE user_profile_id = ?
    GROUP BY game_type
  `)
}

// Helper functions
export const dbHelpers = {
  // Room helpers
  createRoom: (roomId, state = 'waiting', hostUserProfileId = null) => {
    return stmts.createRoom.run(roomId, state, hostUserProfileId)
  },
  
  getRoom: (roomId) => {
    return stmts.getRoom.get(roomId)
  },
  
  updateRoomState: (roomId, state) => {
    return stmts.updateRoomState.run(state, roomId)
  },
  
  updateRoomActivity: (roomId) => {
    return stmts.updateRoomActivity.run(roomId)
  },
  
  getAllRooms: () => {
    return stmts.getAllRooms.all()
  },
  
  deleteRoom: (roomId) => {
    return stmts.deleteRoom.run(roomId)
  },
  
  // User profile helpers
  getOrCreateUserProfile: (name, userProfileId = null, colorId = null) => {
    // If userProfileId is provided, try to get that specific profile first
    let profile = null
    if (userProfileId) {
      profile = stmts.getUserProfileById.get(userProfileId)
    }
    
    // If not found by ID, try by name
    if (!profile) {
      profile = stmts.getUserProfileByName.get(name)
    }
    
    if (!profile) {
      // Create new profile
      let profileId = userProfileId || (Date.now().toString() + Math.random().toString(36).substring(2, 9))
      let finalColorId = colorId
      
      // If colorId not provided, get next available color
      if (!finalColorId) {
        const availableColor = stmts.getNextAvailableColor.get()
        if (!availableColor) {
          // All colors are taken, assign first one (cycle)
          const allColors = stmts.getAllPlayerColors.all()
          const assignedColors = stmts.getAssignedColorIds.all().map(c => c.color_id)
          const unassigned = allColors.find(c => !assignedColors.includes(c.id))
          finalColorId = unassigned ? unassigned.id : allColors[0].id
        } else {
          finalColorId = availableColor.id
        }
      }
      
      const centralTime = getCentralTime()
      stmts.createUserProfile.run(profileId, name, finalColorId, centralTime)
      // Fetch the newly created profile to get all fields including timestamps
      profile = stmts.getUserProfileByName.get(name)
    } else {
      // Update last seen with Central Time
      const centralTime = getCentralTime()
      stmts.updateUserProfileLastSeen.run(centralTime, profile.id)
      // If colorId was provided and different, update it
      if (colorId && profile.color_id !== colorId) {
        stmts.updateUserProfileColor.run(colorId, profile.id)
        profile = stmts.getUserProfileById.get(profile.id) || stmts.getUserProfileByName.get(name)
      } else {
        // Fetch updated profile to get updated last_seen
        profile = stmts.getUserProfileByName.get(name)
      }
    }
    
    return profile
  },
  
  getUserProfile: (name) => {
    return stmts.getUserProfileByName.get(name)
  },
  
  deleteUserProfile: (profileId) => {
    return stmts.deleteUserProfile.run(profileId)
  },
  
  // Player helpers
  addPlayer: (playerId, roomId, socketId, name, userProfileId, colorId, score = 0) => {
    return stmts.addPlayer.run(playerId, roomId, socketId, name, userProfileId, colorId, score)
  },
  
  getPlayer: (playerId) => {
    return stmts.getPlayer.get(playerId, playerId)
  },
  
  getPlayersByRoom: (roomId) => {
    return stmts.getPlayersByRoom.all(roomId)
  },
  
  updatePlayerName: (playerId, name) => {
    return stmts.updatePlayerName.run(name, playerId)
  },
  
  updatePlayerScore: (playerId, score) => {
    return stmts.updatePlayerScore.run(score, playerId)
  },
  
  removePlayer: (socketId) => {
    return stmts.removePlayer.run(socketId)
  },
  
  removePlayerById: (playerId) => {
    return stmts.removePlayerById.run(playerId)
  },
  
  removeAllPlayersFromRoom: (roomId) => {
    return stmts.removeAllPlayersFromRoom.run(roomId)
  },
  
  getPlayerBySocket: (socketId) => {
    return stmts.getPlayerBySocket.get(socketId)
  },
  
  // Game history helpers
  addGameEvent: (roomId, playerId, eventType, eventData = null, score = null) => {
    const dataStr = eventData ? JSON.stringify(eventData) : null
    return stmts.addGameEvent.run(roomId, playerId, eventType, dataStr, score)
  },
  
  getGameHistory: (roomId, limit = 100) => {
    return stmts.getGameHistory.all(roomId, limit)
  },
  
  getAllGameHistory: (limit = 100) => {
    return stmts.getAllGameHistory.all(limit)
  },
  
  // Statistics helpers
  getRoomStats: (roomId) => {
    return stmts.getRoomStats.get(roomId)
  },
  
  getAllRoomStats: () => {
    return stmts.getAllRoomStats.all()
  },
  
  // Player colors helpers
  getAllPlayerColors: () => {
    return stmts.getAllPlayerColors.all()
  },
  
  getPlayerColorById: (id) => {
    return stmts.getPlayerColorById.get(id)
  },
  
  getPlayerColorByIndex: (index) => {
    return stmts.getPlayerColorByIndex.get(index)
  },
  
  // Game wins helpers
  recordWin: (userProfileId, gameType) => {
    return stmts.recordWin.run(userProfileId, gameType)
  },
  
  getWinCount: (userProfileId, gameType) => {
    const result = stmts.getWinCount.get(userProfileId, gameType)
    return result ? result.count : 0
  },
  
  getWinsByGameType: (gameType) => {
    return stmts.getWinsByGameType.all(gameType)
  },
  
  getAllWins: () => {
    return stmts.getAllWins.all()
  },
  
  getPlayerWins: (userProfileId) => {
    return stmts.getPlayerWins.all(userProfileId)
  }
}

// Close database connection on process exit
process.on('exit', () => {
  db.close()
})

process.on('SIGINT', () => {
  db.close()
  process.exit(0)
})

export default db

