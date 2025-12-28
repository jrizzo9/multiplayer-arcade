import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import os from 'os'
import { dbHelpers } from './db.js'
import db from './db.js'
import gameStateRouter from './api/game-state.js'
import debugLogsRouter, { addServerEventLog } from './api/debug-logs.js'

const app = express()
const httpServer = createServer(app)
// CORS configuration - allow localhost and local network IPs for development
// Production: Add CLIENT_URL environment variable (e.g., https://yourdomain.vercel.app)
const allowedOrigins = [
  /^http:\/\/localhost:3000$/,
  /^http:\/\/127\.0\.0\.1:3000$/,
  /^http:\/\/192\.168\.\d+\.\d+:3000$/, // 192.168.x.x
  /^http:\/\/10\.\d+\.\d+\.\d+:3000$/,  // 10.x.x.x
  /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:3000$/ // 172.16-31.x.x
]

// Add production client URL from environment variable if provided
if (process.env.CLIENT_URL) {
  allowedOrigins.push(process.env.CLIENT_URL)
}

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
})

// CORS middleware - allow localhost and local network IPs
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}))
app.use(express.json({ limit: '10mb' })) // Increase limit for client logs

// Helper function to get local network IP address
function getLocalNetworkIP() {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return null
}

// Health check endpoint - returns server uptime
const serverStartTime = Date.now()
app.get('/health', (req, res) => {
  const uptime = Date.now() - serverStartTime
  const uptimeSeconds = Math.floor(uptime / 1000)
  const uptimeMinutes = Math.floor(uptimeSeconds / 60)
  const uptimeHours = Math.floor(uptimeMinutes / 60)
  const uptimeDays = Math.floor(uptimeHours / 24)
  
  res.status(200).json({
    status: 'ok',
    uptime: {
      milliseconds: uptime,
      seconds: uptimeSeconds,
      minutes: uptimeMinutes,
      hours: uptimeHours,
      days: uptimeDays,
      formatted: `${uptimeDays}d ${uptimeHours % 24}h ${uptimeMinutes % 60}m ${uptimeSeconds % 60}s`
    },
    timestamp: new Date().toISOString()
  })
})

// API routes for Pong game state
app.use('/api', gameStateRouter)
// API routes for debug logs
app.use('/api/debug', debugLogsRouter)

// API endpoint to get server connection info
app.get('/api/connection-info', (req, res) => {
  try {
    const networkIP = getLocalNetworkIP()
    const frontendPort = 3000 // Frontend port (where users connect)
    res.json({
      hostname: networkIP || 'localhost',
      port: frontendPort,
      url: networkIP ? `${networkIP}:${frontendPort}` : `localhost:${frontendPort}`
    })
  } catch (error) {
    console.error('[API] Error getting connection info:', error)
    res.status(500).json({ error: error.message })
  }
})

// Store active game rooms (in-memory for real-time state)
const rooms = new Map()

// Cache for ended room IDs to avoid querying database on every request
let endedRoomIdsCache = new Set()
let endedRoomIdsCacheTime = 0
const ENDED_ROOMS_CACHE_TTL = 30 * 1000 // 30 seconds

// Helper function to invalidate ended rooms cache (adds room ID immediately and forces refresh)
function invalidateEndedRoomsCache(roomId = null) {
  if (roomId) {
    // Immediately add to cache
    endedRoomIdsCache.add(roomId)
  }
  // Force cache refresh on next request
  endedRoomIdsCacheTime = 0
}

// Generate unique room ID (numbers only, 6 digits)
function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// Helper function to find userProfileId by socketId in a room
function findUserProfileIdBySocket(room, socketId) {
  for (const [userProfileId, socketIdInRoom] of room.socketIds.entries()) {
    if (socketIdInRoom === socketId) {
      return userProfileId
    }
  }
  return null
}

// Helper function to emit room snapshot (canonical room state event)
function emitRoomSnapshot(room) {
  if (!room) {
    console.log('[DEBUG] [EMIT-SNAPSHOT] Room is null/undefined, cannot emit')
    return
  }
  
  const players = Array.from(room.players.values())
  const snapshot = {
    roomId: room.id,
    hostUserProfileId: room.hostUserProfileId,
    status: room.gameState?.state || 'waiting',
    selectedGame: room.gameState?.selectedGame || null,
    players: players.map(p => ({
      userProfileId: p.userProfileId,
      socketId: p.socketId,
      name: p.name,
      score: p.score || 0,
      ready: p.ready || false,
      color: p.color,
      emoji: p.emoji,
      colorId: p.colorId,
      profileName: p.profileName,
      profileCreatedAt: p.profileCreatedAt,
      profileLastSeen: p.profileLastSeen
    }))
  }
  
  console.log('[DIAG] [SERVER] [EMIT-SNAPSHOT] Emitting room-snapshot', {
    roomId: room.id,
    roomIdType: typeof room.id,
    playersCount: players.length,
    snapshotRoomId: snapshot.roomId,
    snapshotRoomIdType: typeof snapshot.roomId,
    timestamp: Date.now()
  })
  
  // DEBUG: Check which sockets are in the room before emitting snapshot
  const roomAdapter = io.sockets.adapter.rooms.get(room.id)
  const socketsInRoom = roomAdapter ? Array.from(roomAdapter) : []
  console.log(`[DEBUG] [EMIT-SNAPSHOT] Sockets in room ${room.id} before snapshot emit:`, {
    roomId: room.id,
    socketCount: socketsInRoom.length,
    socketIds: socketsInRoom,
    playersInSnapshot: snapshot.players.map(p => ({ userProfileId: p.userProfileId, name: p.name, socketId: p.socketId })),
    timestamp: Date.now()
  })
  
  // CRITICAL: Use io.to() NOT socket.to() - this broadcasts to ALL sockets in the room
  // socket.to() would exclude the sender, but we want EVERYONE in the room to receive updates
  // This ensures the host and all other players see player list changes in real-time
  console.log(`[DEBUG] [EMIT-SNAPSHOT] About to emit to io.to('${room.id}')`)
  io.to(room.id).emit('room-snapshot', snapshot)
  console.log(`[DEBUG] [EMIT-SNAPSHOT] room-snapshot emitted to room ${room.id}`)
  console.log(`[SOCKET] Emitted room-snapshot for room ${room.id} with ${players.length} players:`, players.map(p => `${p.name} (${p.userProfileId})`))
}

// Helper function to broadcast full room list to LOBBY channel
function broadcastRoomList() {
  try {
    // Get active rooms from in-memory Map (real-time data)
    const memoryRooms = Array.from(rooms.entries())
      .filter(([roomId, room]) => {
        // Filter out ended rooms
        if (endedRoomIdsCache.has(roomId)) {
          return false
        }
        const gameState = room.gameState?.state || 'waiting'
        return (gameState === 'waiting' || gameState === 'playing') && room.players.size < 4
      })
      .map(([roomId, room]) => {
        // Find host player name and emoji
        let hostName = 'Unknown'
        let hostEmoji = '👤'
        if (room.hostUserProfileId) {
          const hostPlayer = room.players.get(room.hostUserProfileId)
          if (hostPlayer) {
            hostName = hostPlayer.name || hostPlayer.profileName || 'Unknown'
            hostEmoji = hostPlayer.emoji || '👤'
          } else {
            // Host not in memory, try database
            const dbHost = db.prepare(`
              SELECT up.name, pc.emoji
              FROM user_profiles up
              LEFT JOIN player_colors pc ON up.color_id = pc.id
              WHERE up.id = ?
            `).get(room.hostUserProfileId)
            if (dbHost) {
              hostName = dbHost.name
              hostEmoji = dbHost.emoji || '👤'
            }
          }
        }
        
        return {
          id: roomId,
          hostName: hostName,
          hostEmoji: hostEmoji,
          playerCount: room.players.size,
          maxPlayers: 4,
          status: room.gameState?.state || 'waiting'
        }
      })
    
    // Also get active rooms from database (rooms with active players but not in memory)
    let dbRooms = []
    if (memoryRooms.length > 0) {
      dbRooms = db.prepare(`
        SELECT 
          r.id,
          r.state,
          r.host_user_profile_id,
          COUNT(p.id) as player_count
        FROM rooms r
        LEFT JOIN players p ON r.id = p.room_id AND p.left_at IS NULL
        WHERE r.state IN ('waiting', 'playing')
          AND r.id NOT IN (${memoryRooms.map(() => '?').join(',')})
        GROUP BY r.id
        HAVING player_count > 0 AND player_count < 4
      `).all(...memoryRooms.map(r => r.id))
    } else {
      // No memory rooms, get all active rooms from database
      dbRooms = db.prepare(`
        SELECT 
          r.id,
          r.state,
          r.host_user_profile_id,
          COUNT(p.id) as player_count
        FROM rooms r
        LEFT JOIN players p ON r.id = p.room_id AND p.left_at IS NULL
        WHERE r.state IN ('waiting', 'playing')
        GROUP BY r.id
        HAVING player_count > 0 AND player_count < 4
      `).all()
    }
    
    const dbRoomsFormatted = dbRooms.map(room => {
      // Get host name and emoji from database
      let hostName = 'Unknown'
      let hostEmoji = '👤'
      if (room.host_user_profile_id) {
        const dbHost = db.prepare(`
          SELECT up.name, pc.emoji
          FROM user_profiles up
          LEFT JOIN player_colors pc ON up.color_id = pc.id
          WHERE up.id = ?
        `).get(room.host_user_profile_id)
        if (dbHost) {
          hostName = dbHost.name
          hostEmoji = dbHost.emoji || '👤'
        }
      }
      
      return {
        id: room.id,
        hostName: hostName,
        hostEmoji: hostEmoji,
        playerCount: room.player_count || 0,
        maxPlayers: 4,
        status: room.state || 'waiting'
      }
    })
    
    // Combine both sources
    const allRooms = [...memoryRooms, ...dbRoomsFormatted]
      .sort((a, b) => b.playerCount - a.playerCount) // Sort by player count (most players first)
    
    // Emit to LOBBY channel
    io.to('LOBBY').emit('room-list', allRooms)
    // Also emit to all connected sockets (players in rooms have left LOBBY)
    io.emit('room-list', allRooms)
    console.log(`[SOCKET] Broadcasted room list to LOBBY and all sockets: ${allRooms.length} active rooms`)
  } catch (error) {
    console.error('[SOCKET] Error broadcasting room list:', error)
  }
}

// Clean up empty rooms periodically
setInterval(() => {
  for (const [roomId, room] of rooms.entries()) {
    if (room.players.size === 0) {
      rooms.delete(roomId)
    }
  }
}, 60000) // Clean up every minute

// Clean up stale players (players who haven't had activity for a while)
// This removes players from database who are marked as active but haven't been seen recently
const STALE_PLAYER_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
setInterval(() => {
  try {
    const now = new Date()
    const staleThreshold = new Date(now.getTime() - STALE_PLAYER_TIMEOUT_MS)
    
    // Find all active players (left_at IS NULL) in the database
    const activePlayers = db.prepare(`
      SELECT p.id, p.socket_id, p.room_id, p.joined_at, p.user_profile_id, r.last_activity
      FROM players p
      LEFT JOIN rooms r ON p.room_id = r.id
      WHERE p.left_at IS NULL
    `).all()
    
    let cleanedCount = 0
    for (const player of activePlayers) {
      // Check if player is stale based on room's last activity or player's join time
      const lastActivity = player.last_activity ? new Date(player.last_activity) : new Date(player.joined_at)
      
      if (lastActivity < staleThreshold) {
        // Player is stale - mark as left
        db.prepare('UPDATE players SET left_at = CURRENT_TIMESTAMP WHERE id = ?').run(player.id)
        
        // Also check if they're in an in-memory room and remove them
        // CRITICAL FIX: room.players is keyed by userProfileId, not socket_id
        const room = rooms.get(player.room_id)
        if (room && player.user_profile_id && room.players.has(player.user_profile_id)) {
          room.players.delete(player.user_profile_id)
          room.socketIds.delete(player.user_profile_id)
          console.log(`[CLEANUP] Removed stale player ${player.user_profile_id} (socket: ${player.socket_id}) from room ${player.room_id}`)
          
          // Notify remaining players if room still exists
          if (room.players.size > 0) {
            io.to(player.room_id).emit('player-left', {
              playerId: player.socket_id,
              players: Array.from(room.players.values())
            })
          }
          
          // Clean up room if empty
          if (room.players.size === 0) {
            rooms.delete(player.room_id)
            dbHelpers.updateRoomState(player.room_id, 'ended')
            invalidateEndedRoomsCache(player.room_id)
            console.log(`[CLEANUP] Room ${player.room_id} deleted (empty after cleanup)`)
          }
        }
        
        // Log the cleanup
        dbHelpers.addGameEvent(player.room_id, player.id, 'player_left_stale', { reason: 'inactivity_timeout' })
        cleanedCount++
        console.log(`[CLEANUP] Marked stale player ${player.socket_id} (profile: ${player.user_profile_id}) as left`)
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`[CLEANUP] Cleaned up ${cleanedCount} stale player(s)`)
    }
  } catch (error) {
    console.error('[CLEANUP] Error cleaning up stale players:', error)
  }
}, 5 * 60 * 1000) // Run every 5 minutes

// Refresh ended room IDs cache periodically
setInterval(() => {
  try {
    const endedRoomsQuery = db.prepare(`SELECT id FROM rooms WHERE state = 'ended'`).all()
    endedRoomIdsCache = new Set(endedRoomsQuery.map(r => r.id))
    endedRoomIdsCacheTime = Date.now()
    if (endedRoomIdsCache.size > 0) {
      console.log(`[CACHE] Refreshed ended rooms cache: ${endedRoomIdsCache.size} ended rooms`)
    }
  } catch (error) {
    console.error('[CACHE] Error refreshing ended rooms cache:', error)
  }
}, ENDED_ROOMS_CACHE_TTL)

// Clean up very old ended rooms from database (older than 7 days)
const OLD_ROOM_CLEANUP_DAYS = 7
setInterval(() => {
  try {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - OLD_ROOM_CLEANUP_DAYS)
    
    // Get count of old ended rooms before deletion
    const oldRooms = db.prepare(`
      SELECT COUNT(*) as count 
      FROM rooms 
      WHERE state = 'ended' AND last_activity < ?
    `).get(cutoffDate.toISOString())
    
    if (oldRooms && oldRooms.count > 0) {
      // Delete old ended rooms (cascade will handle related players and events)
      const result = db.prepare(`
        DELETE FROM rooms 
        WHERE state = 'ended' AND last_activity < ?
      `).run(cutoffDate.toISOString())
      
      console.log(`[CLEANUP] Deleted ${result.changes} old ended rooms (older than ${OLD_ROOM_CLEANUP_DAYS} days)`)
      
      // Refresh cache after cleanup
      const endedRoomsQuery = db.prepare(`SELECT id FROM rooms WHERE state = 'ended'`).all()
      endedRoomIdsCache = new Set(endedRoomsQuery.map(r => r.id))
      endedRoomIdsCacheTime = Date.now()
    }
  } catch (error) {
    console.error('[CLEANUP] Error cleaning up old ended rooms:', error)
  }
}, 24 * 60 * 60 * 1000) // Run once per day

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id)
  addServerEventLog(`Player connected: ${socket.id}`, 'info', { socketId: socket.id })
  
  // Join LOBBY namespace by default (for room list updates)
  socket.join('LOBBY')
  
  // Send initial room list to newly connected socket
  setImmediate(() => {
    broadcastRoomList()
  })
  
  // Send user count update to all sockets when someone connects
  // Use setImmediate to ensure socket is fully registered
  setImmediate(() => {
    const count = io.sockets.sockets.size
    io.emit('user-count-update', { count })
    console.log(`[SOCKET] User count updated: ${count} total users`)
    addServerEventLog(`User count updated: ${count} total users`, 'info', { count, event: 'user-count-update' })
  })

  // Handle request for user count (from SocketTest component)
  socket.on('request-user-count', () => {
    const count = io.sockets.sockets.size
    socket.emit('user-count-update', { count })
    console.log(`[SOCKET] User count requested by ${socket.id}: ${count} total users`)
    addServerEventLog(`User count requested by ${socket.id}: ${count} total users`, 'info', { socketId: socket.id, count })
  })

  // Create a new room
  socket.on('create-room', ({ playerName, userProfileId, colorId }) => {
    try {
      console.log('[DIAG] [SERVER] [CREATE-ROOM] Step A: Received create-room', {
        socketId: socket.id,
        playerName: playerName,
        userProfileId: userProfileId,
        timestamp: Date.now()
      })
      
      const roomId = generateRoomId()
      
      console.log(`[SOCKET] Creating room ${roomId} for player ${socket.id} (${playerName})`)
    
    const name = playerName?.trim() || `Player ${Math.floor(Math.random() * 1000)}`
    
    // Get or create user profile and assign emoji
    const userProfile = dbHelpers.getOrCreateUserProfile(name, userProfileId, colorId)
    const colorInfo = dbHelpers.getPlayerColorById(userProfile.color_id)
    
    // Create room in database with host user profile ID
    dbHelpers.createRoom(roomId, 'waiting', userProfile.id)
    dbHelpers.addGameEvent(roomId, null, 'room_created', { roomId })
    
    const room = {
      id: roomId,
      players: new Map(), // Keyed by userProfileId (stable identity)
      socketIds: new Map(), // Map userProfileId -> socketId (ephemeral)
      hostUserProfileId: userProfile.id, // Track host by profile ID (persistent)
      hostSocketId: socket.id, // Current host socket (may change on reconnect)
      readyPlayers: new Set(), // Track which userProfileIds are ready
      countdownInterval: null, // Countdown timer interval
      countdownSeconds: null, // Current countdown value
      gameState: {
        state: 'waiting', // 'waiting', 'playing', 'gameover'
        kiwiPositions: new Map(), // Keyed by userProfileId
        pipes: [],
        score: 0,
        lastPipeX: 400
      },
      createdAt: new Date(),
      lastActivity: new Date().toISOString()
    }
    
    const playerData = {
      userProfileId: userProfile.id, // Primary identifier
      socketId: socket.id, // Ephemeral connection ID
      name: name,
      score: 0,
      ready: false, // Ready status for game start
      color: colorInfo?.color || '#FFFFFF',
      emoji: colorInfo?.emoji || '⚪',
      colorId: userProfile.color_id,
      profileName: userProfile.name,
      profileCreatedAt: userProfile.created_at,
      profileLastSeen: userProfile.last_seen
    }
    room.players.set(userProfile.id, playerData)
    room.socketIds.set(userProfile.id, socket.id)
    
    // Add player to database with user profile and color
    // Use userProfileId as player ID in database (stable identifier)
    const playerId = userProfile.id
    
    // Check if player already exists in database (from a previous room)
    // If so, delete the old record first to avoid UNIQUE constraint violation
    const existingPlayerRecord = dbHelpers.getPlayer(playerId)
    if (existingPlayerRecord) {
      console.log(`[SOCKET] Player ${playerId} already exists in database (room: ${existingPlayerRecord.room_id}), removing old record before creating new room`)
      // Delete the old player record
      dbHelpers.removePlayerById(playerId)
    }
    
    dbHelpers.addPlayer(playerId, roomId, socket.id, name, userProfile.id, userProfile.color_id, 0)
    dbHelpers.addGameEvent(roomId, playerId, 'player_joined', { playerName: name, emoji: colorInfo?.emoji })
    dbHelpers.updateRoomActivity(roomId)
    
    rooms.set(roomId, room)
    socket.join(roomId)
    socket.leave('LOBBY')
    
    console.log(`[SOCKET] Room ${roomId} created by ${socket.id} (${name}, profile: ${userProfile.id}) with emoji ${colorInfo?.emoji}. Total rooms in memory: ${rooms.size}`)
    console.log(`[SOCKET] Room ${roomId} gameState:`, room.gameState.state)
    console.log(`[SOCKET] Room ${roomId} playerCount:`, room.players.size)
    
    console.log('[DIAG] [SERVER] [CREATE-ROOM] Step B: Room created in memory', {
      roomId: roomId,
      roomIdType: typeof roomId,
      playersCount: room.players.size,
      hostUserProfileId: room.hostUserProfileId,
      timestamp: Date.now()
    })
    
    console.log('[DIAG] [SERVER] [CREATE-ROOM] Step C: About to emit room-created', {
      roomId: roomId,
      roomIdType: typeof roomId,
      playersCount: room.players.size,
      timestamp: Date.now()
    })
    
    socket.emit('room-created', { 
      roomId, 
      players: Array.from(room.players.values()),
      hostUserProfileId: room.hostUserProfileId // Include host profile ID
    })
    
    // Emit canonical room snapshot
    console.log('[DIAG] [SERVER] [CREATE-ROOM] Step D: About to emit room-snapshot', {
      roomId: room.id,
      roomIdType: typeof room.id,
      playersCount: room.players.size,
      snapshotPayload: {
        roomId: room.id,
        hostUserProfileId: room.hostUserProfileId,
        playersCount: Array.from(room.players.values()).length
      },
      timestamp: Date.now()
    })
    
    emitRoomSnapshot(room)
    
    // Broadcast new room to LOBBY (clients on room-join screen)
    io.to('LOBBY').emit('room-list-updated', {
      roomId,
      action: 'created',
      room: {
        id: roomId,
        playerCount: room.players.size,
        maxPlayers: 4,
        state: room.gameState.state,
        lastActivity: room.lastActivity
      }
    })
    
    // Broadcast updated room list to LOBBY
    broadcastRoomList()
    } catch (error) {
      console.error(`[SOCKET] Error in create-room handler:`, error)
      console.error(`[SOCKET] Error stack:`, error.stack)
      socket.emit('room-error', { message: `Failed to create room: ${error.message}` })
    }
  })

  // Join an existing room
  socket.on('join-room', ({ roomId, playerName, userProfileId, colorId }) => {
    try {
      console.log('[DIAG] [SERVER] [JOIN-ROOM] Step A: Received join-room', {
        socketId: socket.id,
        roomId: roomId,
        roomIdType: typeof roomId,
        userProfileId: userProfileId,
        timestamp: Date.now()
      })
      
      console.log(`[SOCKET] Join room request: roomId=${roomId}, playerName=${playerName}, userProfileId=${userProfileId}, colorId=${colorId}`)
      addServerEventLog(`Join room request from ${socket.id}: roomId=${roomId}, playerName=${playerName || 'none'}, userProfileId=${userProfileId || 'none'}`, 'info', { socketId: socket.id, roomId, playerName, userProfileId, colorId })
      
      // Check database first
      const dbRoom = dbHelpers.getRoom(roomId)
      if (!dbRoom) {
        console.log(`[SOCKET] Room ${roomId} not found in database`)
        socket.emit('room-error', { message: 'Room not found' })
        return
      }
    
    // Get or create in-memory room
    let room = rooms.get(roomId)
    if (!room) {
      console.log(`[SOCKET] Room ${roomId} not in memory, loading from database`)
      // Load room from database if not in memory
      const dbPlayers = dbHelpers.getPlayersByRoom(roomId)
      // Get the first player (room creator/host) by sorting players by joined_at timestamp
      // The first player to join is the host
      const activeDbPlayers = dbPlayers.filter(p => !p.left_at)
      console.log(`[DIAG] [SERVER] Loading room from DB: ${activeDbPlayers.length} active players found`, {
        activePlayers: activeDbPlayers.map(p => ({ userProfileId: p.user_profile_id, name: p.name, socketId: p.socket_id })),
        timestamp: Date.now()
      })
      const firstPlayer = activeDbPlayers.length > 0 
        ? activeDbPlayers.sort((a, b) => 
            new Date(a.joined_at || 0) - new Date(b.joined_at || 0)
          )[0]
        : null
      // Check if the first player's socket is still connected
      let firstPlayerSocketId = firstPlayer?.socket_id || (dbPlayers.length > 0 ? dbPlayers[0].socket_id : null)
      if (firstPlayerSocketId) {
        const hostSocket = io.sockets.sockets.get(firstPlayerSocketId)
        if (!hostSocket || !hostSocket.connected) {
          // Host socket is not connected - set to null, will be restored when host rejoins
          console.log(`[SOCKET] Host socket ${firstPlayerSocketId} not connected, will be restored on rejoin`)
          firstPlayerSocketId = null
        }
      }
      
      // Find current host socket if host is connected
      let currentHostSocketId = null
      if (dbRoom.host_user_profile_id) {
        for (const dbPlayer of activeDbPlayers) {
          if (dbPlayer.user_profile_id && String(dbPlayer.user_profile_id) === String(dbRoom.host_user_profile_id)) {
            const hostSocket = io.sockets.sockets.get(dbPlayer.socket_id)
            if (hostSocket && hostSocket.connected) {
              currentHostSocketId = dbPlayer.socket_id
              break
            }
          }
        }
      }
      
      room = {
        id: roomId,
        players: new Map(), // Keyed by userProfileId
        socketIds: new Map(), // Map userProfileId -> socketId
        hostUserProfileId: dbRoom.host_user_profile_id, // Host is tracked by profile ID (persistent)
        hostSocketId: currentHostSocketId, // Current host socket (may be null if disconnected)
        readyPlayers: new Set(), // Track which userProfileIds are ready
        countdownInterval: null, // Countdown timer interval
        countdownSeconds: null, // Current countdown value
        gameState: {
          state: dbRoom.state,
          kiwiPositions: new Map(), // Keyed by userProfileId
          pipes: [],
          score: 0,
          lastPipeX: 400
        },
        lastActivity: dbRoom.last_activity || new Date().toISOString()
      }
      // Load existing players from database (keyed by userProfileId)
      // CRITICAL: Only load ACTIVE players (left_at IS NULL), not all players
      // Only load players with valid userProfileId (skip anonymous players for now)
      for (const dbPlayer of activeDbPlayers) {
        if (dbPlayer.user_profile_id) {
          // Check if socket is still connected
          const isConnected = dbPlayer.socket_id && io.sockets.sockets.get(dbPlayer.socket_id)?.connected
          room.players.set(dbPlayer.user_profile_id, {
            userProfileId: dbPlayer.user_profile_id,
            socketId: isConnected ? dbPlayer.socket_id : null,
            name: dbPlayer.name,
            score: dbPlayer.score || 0,
            ready: false, // Ready status for game start
            color: dbPlayer.color || '#FFFFFF',
            emoji: dbPlayer.emoji || '⚪',
            colorId: dbPlayer.color_id,
            profileName: dbPlayer.profile_name,
            profileCreatedAt: dbPlayer.profile_created_at,
            profileLastSeen: dbPlayer.profile_last_seen
          })
          if (isConnected) {
            room.socketIds.set(dbPlayer.user_profile_id, dbPlayer.socket_id)
          }
        }
      }
      rooms.set(roomId, room)
      console.log(`[SOCKET] Loaded room ${roomId} from database with ${room.players.size} existing players, host: ${room.hostSocketId}`)
      console.log(`[DIAG] [SERVER] Room loaded from DB - players in Map:`, {
        roomId: roomId,
        playersCount: room.players.size,
        playerKeys: Array.from(room.players.keys()),
        players: Array.from(room.players.values()).map(p => ({ userProfileId: p.userProfileId, name: p.name })),
        timestamp: Date.now()
      })
    } else {
      // Room exists in memory - log current state
      console.log(`[DIAG] [SERVER] Room exists in memory - current state:`, {
        roomId: roomId,
        playersCount: room.players.size,
        playerKeys: Array.from(room.players.keys()),
        players: Array.from(room.players.values()).map(p => ({ userProfileId: p.userProfileId, name: p.name })),
        timestamp: Date.now()
      })
    }
    
    if (room.players.size >= 4) {
      console.log(`[SOCKET] Room ${roomId} is full (${room.players.size}/4)`)
      socket.emit('room-error', { message: 'Room is full' })
      return
    }
    
    const name = playerName?.trim() || `Player ${room.players.size + 1}`
    
    // Get or create user profile and assign emoji (use provided userProfileId and colorId if available)
    const userProfile = dbHelpers.getOrCreateUserProfile(name, userProfileId, colorId)
    const colorInfo = dbHelpers.getPlayerColorById(userProfile.color_id)
    
    // Require userProfileId for room membership (stable identity)
    if (!userProfile.id) {
      console.log(`[SOCKET] Cannot join room without userProfileId`)
      socket.emit('room-error', { message: 'User profile required to join room' })
      return
    }
    
    // Check if this user profile is already in the room (reconnect scenario)
    const existingPlayer = room.players.get(userProfile.id)
    if (existingPlayer) {
      console.log(`[SOCKET] Player with userProfileId ${userProfile.id} reconnecting (old socket: ${existingPlayer.socketId}, new socket: ${socket.id})`)
      // Update socket ID for this player
      const oldSocketId = existingPlayer.socketId
      if (oldSocketId && oldSocketId !== socket.id) {
        // Mark old socket's player record as left in database
        dbHelpers.removePlayer(oldSocketId)
      }
      // Update socket mapping
      existingPlayer.socketId = socket.id
      room.socketIds.set(userProfile.id, socket.id)
    } else {
      // New player joining
      const playerData = {
        userProfileId: userProfile.id,
        socketId: socket.id,
        name: name,
        score: 0,
        ready: false,
        color: colorInfo?.color || '#FFFFFF',
        emoji: colorInfo?.emoji || '⚪',
        colorId: userProfile.color_id,
        profileName: userProfile.name,
        profileCreatedAt: userProfile.created_at,
        profileLastSeen: userProfile.last_seen
      }
      room.players.set(userProfile.id, playerData)
      room.socketIds.set(userProfile.id, socket.id)
      console.log(`[DIAG] [SERVER] New player added to room.players Map:`, {
        userProfileId: userProfile.id,
        name: name,
        roomPlayersCount: room.players.size,
        allPlayerKeys: Array.from(room.players.keys()),
        allPlayers: Array.from(room.players.values()).map(p => ({ userProfileId: p.userProfileId, name: p.name })),
        timestamp: Date.now()
      })
    }
    
    console.log('[DIAG] [SERVER] [JOIN-ROOM] Step B: Player added to room', {
      roomId: roomId,
      roomIdType: typeof roomId,
      playersCount: room.players.size,
      joiningUserProfileId: userProfile.id,
      allPlayerKeys: Array.from(room.players.keys()),
      allPlayers: Array.from(room.players.values()).map(p => ({ userProfileId: p.userProfileId, name: p.name })),
      timestamp: Date.now()
    })
    
    // Check if this is the host reconnecting (by profile ID)
    const isHostReconnecting = room.hostUserProfileId && 
      userProfile.id && 
      String(room.hostUserProfileId) === String(userProfile.id) &&
      (!room.hostSocketId || !io.sockets.sockets.get(room.hostSocketId)?.connected)
    
    if (isHostReconnecting) {
      console.log(`[SOCKET] Host reconnecting to room ${roomId} with new socket ${socket.id}`)
      // Clear any reconnect timeout
      if (room.hostReconnectTimeout) {
        clearTimeout(room.hostReconnectTimeout)
        room.hostReconnectTimeout = null
        console.log(`[SOCKET] Cleared host reconnect timeout for room ${roomId}`)
        addServerEventLog(`Host reconnected, cleared timeout for room ${roomId}`, 'info', { roomId, socketId: socket.id })
      }
      // Restore host socket ID
      room.hostSocketId = socket.id
      // Notify other players that host reconnected
      io.to(roomId).emit('host-reconnected', {
        message: 'Host has reconnected'
      })
      
      // Emit canonical room snapshot after host reconnect
      emitRoomSnapshot(room)
    }
    
    // Add/update player in database (use userProfileId as player ID)
    const playerId = userProfile.id
    
    // Always check if player record exists in database first (including players who left)
    const existingPlayerRecord = dbHelpers.getPlayer(playerId)
    
    // Also check if player left this room but is trying to rejoin
    const leftPlayerRecord = db.prepare('SELECT * FROM players WHERE id = ? AND room_id = ? AND left_at IS NOT NULL').get(playerId, roomId)
    
    if (existingPlayerRecord) {
      // Player record exists in database
      if (existingPlayerRecord.room_id === roomId) {
        // Player is already in this room - just update socket_id and clear left_at (rejoin scenario)
        console.log(`[SOCKET] Player ${playerId} already in room ${roomId} in database, updating socket_id and clearing left_at`)
        db.prepare('UPDATE players SET socket_id = ?, left_at = NULL WHERE id = ? AND room_id = ?').run(socket.id, playerId, roomId)
      } else {
        // Player is in a different room - delete old record and add to new room
        console.log(`[SOCKET] Player ${playerId} exists in different room (${existingPlayerRecord.room_id}), removing and adding to room ${roomId}`)
        dbHelpers.removePlayerById(playerId)
        dbHelpers.addPlayer(playerId, roomId, socket.id, name, userProfile.id, userProfile.color_id, 0)
      }
    } else if (leftPlayerRecord) {
      // Player left this room but is trying to rejoin - clear left_at and update socket_id
      console.log(`[SOCKET] Player ${playerId} left room ${roomId} but is rejoining, clearing left_at and updating socket_id`)
      db.prepare('UPDATE players SET socket_id = ?, left_at = NULL WHERE id = ? AND room_id = ?').run(socket.id, playerId, roomId)
      
      // Add player back to in-memory room if not already there
      if (!existingPlayer) {
        const playerData = {
          userProfileId: userProfile.id,
          socketId: socket.id,
          name: name,
          score: leftPlayerRecord.score || 0,
          ready: false, // Reset ready status on rejoin
          color: colorInfo?.color || '#FFFFFF',
          emoji: colorInfo?.emoji || '⚪',
          colorId: userProfile.color_id,
          profileName: userProfile.name,
          profileCreatedAt: userProfile.created_at,
          profileLastSeen: userProfile.last_seen
        }
        room.players.set(userProfile.id, playerData)
        room.socketIds.set(userProfile.id, socket.id)
        console.log(`[SOCKET] Re-added player ${playerId} to in-memory room ${roomId} after rejoin`)
      }
    } else {
      // No existing record - add new player
      if (!existingPlayer) {
        // New player joining (not a reconnect in memory)
        console.log(`[SOCKET] Adding new player ${playerId} to room ${roomId} in database`)
        dbHelpers.addPlayer(playerId, roomId, socket.id, name, userProfile.id, userProfile.color_id, 0)
      } else {
        // Reconnecting player but no DB record - add them
        console.log(`[SOCKET] Reconnecting player ${playerId} has no DB record, adding to room ${roomId}`)
        dbHelpers.addPlayer(playerId, roomId, socket.id, name, userProfile.id, userProfile.color_id, 0)
      }
    }
    dbHelpers.addGameEvent(roomId, playerId, 'player_joined', { playerName: name, emoji: colorInfo?.emoji })
    dbHelpers.updateRoomActivity(roomId)
    
    // Cancel countdown if one is running (new player joined, so not all players are ready)
    if (room.countdownInterval) {
      clearInterval(room.countdownInterval)
      room.countdownInterval = null
      room.countdownSeconds = null
      io.to(roomId).emit('countdown-cancelled', {})
      console.log(`[SOCKET] Cancelled countdown in room ${roomId} due to new player joining`)
    }
    
    socket.join(roomId)
    socket.leave('LOBBY')
    
    // Clean up any stale sockets in this room that aren't associated with active players
    // Use in-memory room state as source of truth
    const activeSocketIds = new Set(Array.from(room.socketIds.values()))
    const roomSockets = Array.from(io.sockets.adapter.rooms.get(roomId) || [])
    for (const socketIdInRoom of roomSockets) {
      if (!activeSocketIds.has(socketIdInRoom)) {
        const staleSocket = io.sockets.sockets.get(socketIdInRoom)
        if (staleSocket) {
          console.log(`[SOCKET] Removing stale socket ${socketIdInRoom} from room ${roomId} (not in active socketIds)`)
          addServerEventLog(`Removing stale socket ${socketIdInRoom} from room ${roomId}`, 'info', { socketId: socketIdInRoom, roomId })
          staleSocket.leave(roomId)
        } else {
          // Socket doesn't exist anymore, just clean up the adapter
          io.sockets.adapter.rooms.get(roomId)?.delete(socketIdInRoom)
          console.log(`[SOCKET] Cleaned up non-existent socket ${socketIdInRoom} from room ${roomId} adapter`)
        }
      }
    }
    
    // Notify all players in the room
    const playersArray = Array.from(room.players.values())
    // Determine if the joining player is the host
    const joiningPlayerIsHost = room.hostUserProfileId && 
      userProfile.id && 
      String(room.hostUserProfileId) === String(userProfile.id)
    
    console.log(`[DIAG] [SERVER] Creating playersArray for emit:`, {
      roomPlayersMapSize: room.players.size,
      playersArrayLength: playersArray.length,
      playersArray: playersArray.map(p => ({ userProfileId: p.userProfileId, name: p.name, socketId: p.socketId })),
      roomPlayerKeys: Array.from(room.players.keys()),
      timestamp: Date.now()
    })
    
    console.log(`[SOCKET] Emitting player-joined to room ${roomId}`, {
      playerCount: playersArray.length,
      players: playersArray.map(p => ({ userProfileId: p.userProfileId, name: p.name, socketId: p.socketId })),
      roomPlayerCount: room.players.size,
      joiningPlayerIsHost,
      hostUserProfileId: room.hostUserProfileId,
      joiningUserProfileId: userProfile.id
    })
    
    console.log('[DIAG] [SERVER] [JOIN-ROOM] Step C: About to emit player-joined', {
      roomId: roomId,
      playersCount: playersArray.length,
      timestamp: Date.now()
    })
    
    // Emit player-joined event to ALL sockets in the room (including host and joining player)
    // This ensures the host sees the new player immediately
    const playerJoinedData = {
      players: playersArray,
      gameState: room.gameState,
      isHost: joiningPlayerIsHost, // Include host status for the joining player
      hostUserProfileId: room.hostUserProfileId, // Include host profile ID so all clients know who the host is
      selectedGame: room.gameState?.selectedGame || null
    }
    // Emit to all sockets in the room (including host) so host sees new player immediately
    io.to(roomId).emit('player-joined', playerJoinedData)
    console.log(`[SOCKET] Broadcasted player-joined to all players in room ${roomId} (including host)`)
    
    // Emit canonical room snapshot after any join
    console.log('[DIAG] [SERVER] [JOIN-ROOM] Step D: About to emit room-snapshot', {
      roomId: room.id,
      roomIdType: typeof room.id,
      playersCount: room.players.size,
      snapshotPayload: {
        roomId: room.id,
        hostUserProfileId: room.hostUserProfileId,
        playersCount: Array.from(room.players.values()).length
      },
      timestamp: Date.now()
    })
    
    emitRoomSnapshot(room)
    
    // Broadcast room update to LOBBY (clients on room-join screen)
    io.to('LOBBY').emit('room-list-updated', {
      roomId,
      action: 'updated',
      room: {
        id: roomId,
        playerCount: room.players.size,
        maxPlayers: 4,
        state: room.gameState.state,
        lastActivity: room.lastActivity || new Date().toISOString()
      }
    })
    
    // Broadcast updated room list to LOBBY
    broadcastRoomList()
    
      console.log(`Player ${socket.id} (${name}) joined room ${roomId} with emoji ${colorInfo?.emoji}`)
    } catch (error) {
      console.error(`[SOCKET] Error in join-room handler:`, error)
      console.error(`[SOCKET] Error stack:`, error.stack)
      socket.emit('room-error', { message: `Failed to join room: ${error.message}` })
    }
  })

  // Handle player name updates
  socket.on('update-player-name', ({ roomId, playerName }) => {
    const room = rooms.get(roomId)
    if (!room) return
    
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!userProfileId) return
    
    const player = room.players.get(userProfileId)
    if (player) {
      const name = playerName?.trim() || `Player ${room.players.size}`
      player.name = name
      
      // Update in database
      db.prepare('UPDATE players SET name = ? WHERE id = ?').run(name, userProfileId)
      dbHelpers.addGameEvent(roomId, userProfileId, 'player_name_updated', { playerName: name })
      dbHelpers.updateRoomActivity(roomId)
      
      // Broadcast updated player list to all players in the room
      io.to(roomId).emit('player-name-updated', {
        userProfileId: userProfileId,
        playerName: name,
        players: Array.from(room.players.values())
      })
      
      console.log(`Player ${userProfileId} (socket ${socket.id}) updated name to ${name} in room ${roomId}`)
    }
  })

  // Handle player actions (jump)
  socket.on('player-action', ({ roomId, action }) => {
    const room = rooms.get(roomId)
    if (!room) return
    
    // Log action to database
    dbHelpers.addGameEvent(roomId, socket.id, 'player_action', { action })
    dbHelpers.updateRoomActivity(roomId)
    
    // Broadcast action to all players in the room
    socket.to(roomId).emit('player-action', {
      playerId: socket.id,
      action
    })
  })

  // WarioWare game events
  socket.on('microgame-start', ({ roomId, gameType, round, gameData }) => {
    const room = rooms.get(roomId)
    if (!room) {
      socket.emit('room-error', { message: 'Room not found' })
      return
    }
    
    // Validate that only the host can start games (check by profile ID)
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!userProfileId) {
      socket.emit('room-error', { message: 'You are not in this room' })
      return
    }
    
    const player = room.players.get(userProfileId)
    if (!player) {
      socket.emit('room-error', { message: 'You are not in this room' })
      return
    }
    
    const isHost = room.hostUserProfileId && 
      String(player.userProfileId) === String(room.hostUserProfileId)
    
    if (!isHost) {
      console.log(`[SOCKET] Non-host player ${socket.id} attempted to start game in room ${roomId}`)
      socket.emit('room-error', { message: 'Only the host can start games' })
      return
    }
    
    // Log to database
    dbHelpers.addGameEvent(roomId, userProfileId, 'microgame_start', { gameType, round, gameData })
    dbHelpers.updateRoomActivity(roomId)
    
    // Broadcast to all players in the room
    io.to(roomId).emit('microgame-start', {
      gameType,
      round,
      gameData
    })
  })

  socket.on('microgame-playing', ({ roomId }) => {
    const room = rooms.get(roomId)
    if (!room) return
    
    dbHelpers.updateRoomActivity(roomId)
    io.to(roomId).emit('microgame-playing', {})
  })

  socket.on('microgame-end', ({ roomId, scores }) => {
    const room = rooms.get(roomId)
    if (!room) return
    
    // Update player scores (scores are round scores, add to total)
    // scores object keys are userProfileIds
    for (const [userProfileId, roundScore] of Object.entries(scores)) {
      const player = room.players.get(userProfileId)
      if (player) {
        player.score = (player.score || 0) + (roundScore || 0)
        // Update in database
        db.prepare('UPDATE players SET score = ? WHERE id = ?').run(player.score, userProfileId)
        dbHelpers.addGameEvent(roomId, userProfileId, 'microgame_end', { roundScore }, player.score)
      }
    }
    
    dbHelpers.updateRoomActivity(roomId)
    
    // Broadcast end event with round scores and total scores
    const totalScores = Object.fromEntries(
      Array.from(room.players.entries()).map(([id, p]) => [id, p.score || 0])
    )
    
    io.to(roomId).emit('microgame-end', {
      scores: scores, // Round scores
      totalScores: totalScores // Total scores
    })
  })

  socket.on('game-action', ({ roomId, action, data }) => {
    const room = rooms.get(roomId)
    if (!room) return
    
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!userProfileId) return
    
    // Log to database
    dbHelpers.addGameEvent(roomId, userProfileId, 'game_action', { action, data })
    dbHelpers.updateRoomActivity(roomId)
    
    // Broadcast action to all players
    socket.to(roomId).emit('game-action', {
      userProfileId: userProfileId,
      action,
      data
    })
  })

  // Handle Pong game events
  socket.on('pong-game-start', ({ roomId, gameState }) => {
    console.log(`[SOCKET] Received pong-game-start from ${socket.id} for room ${roomId}`)
    addServerEventLog(`Received pong-game-start from ${socket.id}`, 'info', { roomId, socketId: socket.id })
    
    const room = rooms.get(roomId)
    if (!room) {
      console.log(`[SOCKET] Room ${roomId} not found for pong-game-start`)
      addServerEventLog(`Room ${roomId} not found for pong-game-start`, 'warn', { roomId, socketId: socket.id })
      return
    }
    
    // Verify player is in room by finding userProfileId
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (userProfileId) {
      const player = room.players.get(userProfileId)
      if (player) {
        // Only host can start the game
        const isHost = room.hostUserProfileId && 
          String(player.userProfileId) === String(room.hostUserProfileId)
        
        if (!isHost) {
          console.log(`[SOCKET] Non-host player ${userProfileId} (socket ${socket.id}) attempted to start Pong game in room ${roomId}`)
          addServerEventLog(`Non-host attempted to start game`, 'warn', { roomId, socketId: socket.id, userProfileId })
          return
        }
      }
    }
    
    // Broadcast game start to all players in room (including sender)
    io.to(roomId).emit('pong-game-start', { gameState })
    console.log(`[SOCKET] Pong game started in room ${roomId}, broadcasted to room`)
    addServerEventLog(`Pong game started in room ${roomId}`, 'info', { roomId, socketId: socket.id })
  })

  socket.on('pong-paddle-move', ({ roomId, playerNumber, paddleX }) => {
    const room = rooms.get(roomId)
    if (!room) {
      console.log(`[SOCKET] Room ${roomId} not found for pong-paddle-move`)
      return
    }
    
    // Verify player is in room (but don't block if not in map - socket might be in Socket.IO room)
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!userProfileId) {
      console.log(`[SOCKET] Socket ${socket.id} not in room.players map for paddle move, but allowing broadcast`)
    }
    
    // Broadcast paddle movement to other players (including the sender so host can see it)
    io.to(roomId).emit('pong-paddle-move', { playerNumber, paddleX })
    console.log(`[SOCKET] Broadcasted paddle move from player ${playerNumber} in room ${roomId}`)
  })

  socket.on('pong-game-state', ({ roomId, gameState }) => {
    const room = rooms.get(roomId)
    if (!room) {
      console.log(`[SOCKET] Room ${roomId} not found for pong-game-state`)
      return
    }
    
    // Verify player is in room (but don't block if not in map)
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    let isHost = false
    
    if (userProfileId) {
      const player = room.players.get(userProfileId)
      if (player) {
        isHost = room.hostUserProfileId && 
          String(player.userProfileId) === String(room.hostUserProfileId)
      }
    } else {
      // If player not in map, check if socket is the current host socket
      isHost = room.hostSocketId === socket.id
    }
    
    if (isHost) {
      // Broadcast game state to other players
      socket.to(roomId).emit('pong-game-state', gameState)
    } else {
      console.log(`[SOCKET] Non-host socket ${socket.id} attempted to broadcast game state`)
    }
  })

  // Handle Memory game events
  socket.on('memory-game-start', ({ roomId, gameState }) => {
    console.log(`[SOCKET] Received memory-game-start from ${socket.id} for room ${roomId}`)
    addServerEventLog(`Received memory-game-start from ${socket.id}`, 'info', { roomId, socketId: socket.id })
    
    const room = rooms.get(roomId)
    if (!room) {
      console.log(`[SOCKET] Room ${roomId} not found for memory-game-start`)
      addServerEventLog(`Room ${roomId} not found for memory-game-start`, 'warn', { roomId, socketId: socket.id })
      return
    }
    
    // Verify player is in room by finding userProfileId
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (userProfileId) {
      const player = room.players.get(userProfileId)
      if (player) {
        // Only host can start the game
        const isHost = room.hostUserProfileId && 
          String(player.userProfileId) === String(room.hostUserProfileId)
        
        if (!isHost) {
          console.log(`[SOCKET] Non-host player ${userProfileId} (socket ${socket.id}) attempted to start Memory game in room ${roomId}`)
          addServerEventLog(`Non-host attempted to start game`, 'warn', { roomId, socketId: socket.id, userProfileId })
          return
        }
      }
    }
    
    // Broadcast game start to all players in room (including sender)
    io.to(roomId).emit('memory-game-start', { gameState })
    console.log(`[SOCKET] Memory game started in room ${roomId}, broadcasted to room`)
    addServerEventLog(`Memory game started in room ${roomId}`, 'info', { roomId, socketId: socket.id })
  })

  socket.on('memory-card-flip', ({ roomId, userProfileId, cardIndex }) => {
    const room = rooms.get(roomId)
    if (!room) {
      console.log(`[SOCKET] Room ${roomId} not found for memory-card-flip`)
      return
    }
    
    // Verify player is in room
    const socketUserProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!socketUserProfileId || String(socketUserProfileId) !== String(userProfileId)) {
      console.log(`[SOCKET] Socket ${socket.id} userProfileId mismatch for card flip`)
      return
    }
    
    // Broadcast card flip to other players (including the sender so host can see it)
    io.to(roomId).emit('memory-card-flip', { userProfileId, cardIndex })
    console.log(`[SOCKET] Broadcasted card flip from player ${userProfileId} in room ${roomId}`)
  })

  socket.on('memory-game-state', ({ roomId, gameState }) => {
    const room = rooms.get(roomId)
    if (!room) {
      console.log(`[SOCKET] Room ${roomId} not found for memory-game-state`)
      return
    }
    
    // Verify player is in room (but don't block if not in map)
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    let isHost = false
    
    if (userProfileId) {
      const player = room.players.get(userProfileId)
      if (player) {
        isHost = room.hostUserProfileId && 
          String(player.userProfileId) === String(room.hostUserProfileId)
      }
    } else {
      // If player not in map, check if socket is the current host socket
      isHost = room.hostSocketId === socket.id
    }
    
    if (isHost) {
      // Broadcast game state to all players (including sender) so everyone sees the same state
      io.to(roomId).emit('memory-game-state', gameState)
    } else {
      console.log(`[SOCKET] Non-host socket ${socket.id} attempted to broadcast game state`)
    }
  })

  // Handle Snake game events
  socket.on('snake-game-start', ({ roomId, gameState }) => {
    console.log(`[SOCKET] Received snake-game-start from ${socket.id} for room ${roomId}`)
    addServerEventLog(`Received snake-game-start from ${socket.id}`, 'info', { roomId, socketId: socket.id })
    
    const room = rooms.get(roomId)
    if (!room) {
      console.log(`[SOCKET] Room ${roomId} not found for snake-game-start`)
      addServerEventLog(`Room ${roomId} not found for snake-game-start`, 'warn', { roomId, socketId: socket.id })
      return
    }
    
    // Verify player is in room by finding userProfileId
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (userProfileId) {
      const player = room.players.get(userProfileId)
      if (player) {
        // Only host can start the game
        const isHost = room.hostUserProfileId && 
          String(player.userProfileId) === String(room.hostUserProfileId)
        
        if (!isHost) {
          console.log(`[SOCKET] Non-host player ${userProfileId} (socket ${socket.id}) attempted to start Snake game in room ${roomId}`)
          addServerEventLog(`Non-host attempted to start game`, 'warn', { roomId, socketId: socket.id, userProfileId })
          return
        }
      }
    }
    
    // Broadcast game start to all players in room (including sender)
    io.to(roomId).emit('snake-game-start', { gameState })
    console.log(`[SOCKET] Snake game started in room ${roomId}, broadcasted to room`)
    addServerEventLog(`Snake game started in room ${roomId}`, 'info', { roomId, socketId: socket.id })
  })

  socket.on('snake-direction-change', ({ roomId, playerNumber, direction }) => {
    const room = rooms.get(roomId)
    if (!room) {
      console.log(`[SOCKET] Room ${roomId} not found for snake-direction-change`)
      return
    }
    
    // Verify player is in room (but don't block if not in map - socket might be in Socket.IO room)
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!userProfileId) {
      console.log(`[SOCKET] Socket ${socket.id} not in room.players map for direction change, but allowing broadcast`)
    }
    
    // Broadcast direction change to all players in room (including the sender so host can see it)
    io.to(roomId).emit('snake-direction-change', { playerNumber, direction })
    console.log(`[SOCKET] Broadcasted direction change from player ${playerNumber} in room ${roomId}`)
  })

  socket.on('snake-game-state', ({ roomId, gameState }) => {
    const room = rooms.get(roomId)
    if (!room) {
      console.log(`[SOCKET] Room ${roomId} not found for snake-game-state`)
      return
    }
    
    // Verify player is in room (but don't block if not in map)
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    let isHost = false
    
    if (userProfileId) {
      const player = room.players.get(userProfileId)
      if (player) {
        isHost = room.hostUserProfileId && 
          String(player.userProfileId) === String(room.hostUserProfileId)
      }
    } else {
      // If player not in map, check if socket is the current host socket
      isHost = room.hostSocketId === socket.id
    }
    
    if (isHost) {
      // Broadcast game state to other players
      socket.to(roomId).emit('snake-game-state', gameState)
    } else {
      console.log(`[SOCKET] Non-host socket ${socket.id} attempted to broadcast game state`)
    }
  })

  // Handle Magnet Mayhem game events
  socket.on('magnet-game-start', ({ roomId, gameState }) => {
    console.log(`[SOCKET] Received magnet-game-start from ${socket.id} for room ${roomId}`)
    addServerEventLog(`Received magnet-game-start from ${socket.id}`, 'info', { roomId, socketId: socket.id })
    
    const room = rooms.get(roomId)
    if (!room) {
      console.log(`[SOCKET] Room ${roomId} not found for magnet-game-start`)
      addServerEventLog(`Room ${roomId} not found for magnet-game-start`, 'warn', { roomId, socketId: socket.id })
      return
    }
    
    // Verify player is in room by finding userProfileId
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (userProfileId) {
      const player = room.players.get(userProfileId)
      if (player) {
        // Only host can start the game
        const isHost = room.hostUserProfileId && 
          String(player.userProfileId) === String(room.hostUserProfileId)
        
        if (!isHost) {
          console.log(`[SOCKET] Non-host player ${userProfileId} (socket ${socket.id}) attempted to start Magnet Mayhem game in room ${roomId}`)
          addServerEventLog(`Non-host attempted to start game`, 'warn', { roomId, socketId: socket.id, userProfileId })
          return
        }
      }
    }
    
    // Broadcast game start to all players in room (including sender)
    io.to(roomId).emit('magnet-game-start', { gameState })
    console.log(`[SOCKET] Magnet Mayhem game started in room ${roomId}, broadcasted to room`)
    addServerEventLog(`Magnet Mayhem game started in room ${roomId}`, 'info', { roomId, socketId: socket.id })
  })

  socket.on('magnet-player-move', ({ roomId, userProfileId, x, y, vx, vy }) => {
    const room = rooms.get(roomId)
    if (!room) {
      console.log(`[SOCKET] Room ${roomId} not found for magnet-player-move`)
      return
    }
    
    // Verify player is in room (but don't block if not in map)
    const senderUserProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!senderUserProfileId) {
      console.log(`[SOCKET] Socket ${socket.id} not in room.players map for player move, but allowing broadcast`)
    }
    
    // Broadcast player movement to other players (including the sender so host can see it)
    io.to(roomId).emit('magnet-player-move', { userProfileId, x, y, vx, vy })
    console.log(`[SOCKET] Broadcasted player move from ${userProfileId} in room ${roomId}`)
  })

  socket.on('magnet-pole-flip', ({ roomId, userProfileId, pole }) => {
    const room = rooms.get(roomId)
    if (!room) {
      console.log(`[SOCKET] Room ${roomId} not found for magnet-pole-flip`)
      return
    }
    
    // Verify player is in room (but don't block if not in map)
    const senderUserProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!senderUserProfileId) {
      console.log(`[SOCKET] Socket ${socket.id} not in room.players map for pole flip, but allowing broadcast`)
    }
    
    // Broadcast pole flip to all players in room (including the sender so host can see it)
    io.to(roomId).emit('magnet-pole-flip', { userProfileId, pole })
    console.log(`[SOCKET] Broadcasted pole flip from ${userProfileId} in room ${roomId}`)
  })

  socket.on('magnet-game-state', ({ roomId, gameState }) => {
    const room = rooms.get(roomId)
    if (!room) {
      console.log(`[SOCKET] Room ${roomId} not found for magnet-game-state`)
      return
    }
    
    // Verify player is in room (but don't block if not in map)
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    let isHost = false
    
    if (userProfileId) {
      const player = room.players.get(userProfileId)
      if (player) {
        isHost = room.hostUserProfileId && 
          String(player.userProfileId) === String(room.hostUserProfileId)
      }
    } else {
      // If player not in map, check if socket is the current host socket
      isHost = room.hostSocketId === socket.id
    }
    
    if (isHost) {
      // Broadcast game state to other players
      socket.to(roomId).emit('magnet-game-state', { roomId, gameState })
    } else {
      console.log(`[SOCKET] Non-host socket ${socket.id} attempted to broadcast game state`)
    }
  })

  // Handle test messages (for socket testing/debugging)
  socket.on('test-message', (data) => {
    console.log(`[SOCKET] Test message received from ${socket.id}:`, data)
    addServerEventLog(`Test message received from ${socket.id}`, 'info', { socketId: socket.id, data })
    
    const otherUserCount = io.sockets.sockets.size - 1
    console.log(`[SOCKET] Broadcasting to ${otherUserCount} other users`)
    addServerEventLog(`Broadcasting to ${otherUserCount} other users`, 'info', { otherUserCount, totalUsers: io.sockets.sockets.size })
    
    // Broadcast to all other connected sockets
    const broadcastData = {
      ...data,
      fromSocketId: socket.id,
      // Preserve 'from' field if it exists, otherwise use socket.id
      from: data.from || socket.id,
      timestamp: Date.now()
    }
    
    if (otherUserCount > 0) {
      socket.broadcast.emit('test-message', broadcastData)
      console.log(`[SOCKET] Successfully broadcasted test message`)
      addServerEventLog(`Successfully broadcasted test message`, 'info', { broadcastData })
    } else {
      console.log(`[SOCKET] No other users to broadcast to`)
      addServerEventLog(`No other users to broadcast to`, 'warn', { totalUsers: io.sockets.sockets.size })
    }
  })

  // Handle game state updates from host
  socket.on('game-state-update', ({ roomId, gameState }) => {
    const room = rooms.get(roomId)
    if (!room) {
      socket.emit('room-error', { message: 'Room not found' })
      return
    }
    
    // Validate that only the host can update game state (check by profile ID)
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!userProfileId) {
      socket.emit('room-error', { message: 'You are not in this room' })
      return
    }
    
    const player = room.players.get(userProfileId)
    if (!player) {
      socket.emit('room-error', { message: 'You are not in this room' })
      return
    }
    
    const isHost = room.hostUserProfileId && 
      String(player.userProfileId) === String(room.hostUserProfileId)
    
    if (!isHost) {
      console.log(`[SOCKET] Non-host player ${socket.id} attempted to update game state in room ${roomId}`)
      socket.emit('room-error', { message: 'Only the host can update game state' })
      return
    }
    
    // Update room's game state
    room.gameState = gameState
    
    // Update database
    if (gameState.state) {
      dbHelpers.updateRoomState(roomId, gameState.state)
    }
    dbHelpers.addGameEvent(roomId, userProfileId, 'game_state_update', { state: gameState.state })
    dbHelpers.updateRoomActivity(roomId)
    
    // Broadcast to all other players
    socket.to(roomId).emit('game-state-update', gameState)
  })

  // Handle game selection from host
  socket.on('game-selected', ({ roomId, game }) => {
    console.log(`[SOCKET] Received game-selected event:`, { roomId, game, socketId: socket.id })
    
    // Try both string and number roomId
    let room = rooms.get(roomId)
    if (!room && roomId) {
      // Try string version if roomId is a number, or number version if it's a string
      const altRoomId = typeof roomId === 'string' ? parseInt(roomId, 10) : String(roomId)
      room = rooms.get(altRoomId)
      if (room) {
        console.log(`[SOCKET] Found room with alternate roomId format: ${altRoomId}`)
      }
    }
    
    if (!room) {
      console.error(`[SOCKET] Room not found for game-selected:`, { roomId, availableRooms: Array.from(rooms.keys()) })
      socket.emit('room-error', { message: 'Room not found' })
      return
    }
    
    // Validate that only the host can select games
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!userProfileId) {
      socket.emit('room-error', { message: 'You are not in this room' })
      return
    }
    
    const player = room.players.get(userProfileId)
    if (!player) {
      socket.emit('room-error', { message: 'You are not in this room' })
      return
    }
    
    const isHost = room.hostUserProfileId && 
      String(player.userProfileId) === String(room.hostUserProfileId)
    
    if (!isHost) {
      console.log(`[SOCKET] Non-host player ${socket.id} attempted to select game in room ${roomId}`)
      socket.emit('room-error', { message: 'Only the host can select games' })
      return
    }
    
    // Update room's selected game
    if (!room.gameState) {
      room.gameState = {}
    }
    room.gameState.selectedGame = game
    
    // Reset all ready status when game is selected
    room.readyPlayers.clear()
    for (const [userProfileId, playerData] of room.players.entries()) {
      playerData.ready = false
    }
    
    // Clear any existing countdown
    if (room.countdownInterval) {
      clearInterval(room.countdownInterval)
      room.countdownInterval = null
      room.countdownSeconds = null
    }
    
    // Log the game selection
    dbHelpers.addGameEvent(roomId, userProfileId, 'game_selected', { game })
    dbHelpers.updateRoomActivity(roomId)
    
    // Broadcast to all other players with ready status reset
    // Use room.id instead of roomId parameter to ensure correct room format
    io.to(room.id).emit('game-selected', { 
      game,
      players: Array.from(room.players.values()).map(p => ({
        ...p,
        ready: false
      })),
      hostUserProfileId: room.hostUserProfileId // Include host profile ID
    })
    console.log(`[SOCKET] Host selected game: ${game} in room ${room.id}`)
    
    // Emit canonical room snapshot after game selection
    emitRoomSnapshot(room)
  })

  // Handle player ready/unready
  // Handle request for room snapshot refresh
  socket.on('request-room-snapshot', ({ roomId }) => {
    const room = rooms.get(roomId)
    if (!room) {
      socket.emit('room-error', { message: 'Room not found' })
      return
    }
    
    // Verify user is in the room
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!userProfileId) {
      socket.emit('room-error', { message: 'You are not in this room' })
      return
    }
    
    // Emit room snapshot to refresh client state
    console.log(`[SOCKET] Room snapshot refresh requested for room ${roomId} by ${socket.id}`)
    emitRoomSnapshot(room)
  })

  socket.on('player-ready', ({ roomId, ready }) => {
    const room = rooms.get(roomId)
    if (!room) {
      socket.emit('room-error', { message: 'Room not found' })
      return
    }
    
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!userProfileId) {
      socket.emit('room-error', { message: 'You are not in this room' })
      return
    }
    
    const player = room.players.get(userProfileId)
    if (!player) {
      socket.emit('room-error', { message: 'You are not in this room' })
      return
    }
    
    // Update player ready status
    player.ready = ready === true
    
    if (ready) {
      // Ensure readyPlayers Set exists before adding
      if (!room.readyPlayers) {
        room.readyPlayers = new Set()
      }
      room.readyPlayers.add(userProfileId)
      dbHelpers.addGameEvent(roomId, userProfileId, 'player_ready', {})
    } else {
      // Use optional chaining to safely delete
      room.readyPlayers?.delete(userProfileId)
      dbHelpers.addGameEvent(roomId, userProfileId, 'player_unready', {})
      
      // Cancel countdown if player unreadies
      if (room.countdownInterval) {
        clearInterval(room.countdownInterval)
        room.countdownInterval = null
        room.countdownSeconds = null
        io.to(roomId).emit('countdown-cancelled', {})
      }
    }
    
    dbHelpers.updateRoomActivity(roomId)
    
    // Broadcast updated ready status to all players
    const playersArray = Array.from(room.players.values())
    io.to(roomId).emit('players-ready-updated', {
      players: playersArray,
      allReady: room.readyPlayers.size === room.players.size && room.players.size >= 2,
      hostUserProfileId: room.hostUserProfileId // Include host profile ID
    })
    
    // Emit canonical room snapshot after ready status change
    emitRoomSnapshot(room)
    
    console.log(`[SOCKET] Player ${socket.id} ${ready ? 'readied' : 'unreadied'} in room ${roomId}. Ready: ${room.readyPlayers.size}/${room.players.size}`)
    
    // Don't automatically start countdown - host will manually start the game
  })

  // Handle host manually starting the game
  socket.on('start-game', ({ roomId }) => {
    const room = rooms.get(roomId)
    if (!room) {
      socket.emit('room-error', { message: 'Room not found' })
      return
    }
    
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!userProfileId) {
      socket.emit('room-error', { message: 'You are not in this room' })
      return
    }
    
    const player = room.players.get(userProfileId)
    if (!player) {
      socket.emit('room-error', { message: 'You are not in this room' })
      return
    }
    
    // Verify this is the host
    const isHost = room.hostUserProfileId && 
      String(player.userProfileId) === String(room.hostUserProfileId)
    
    if (!isHost) {
      console.log(`[SOCKET] Non-host player ${socket.id} attempted to start game in room ${roomId}`)
      socket.emit('room-error', { message: 'Only the host can start the game' })
      return
    }
    
    // Verify all players are ready and we have at least 2 players
    if (room.readyPlayers.size !== room.players.size || room.players.size < 2) {
      socket.emit('room-error', { message: 'All players must be ready to start the game' })
      return
    }
    
    // Verify a game is selected
    const selectedGame = room.gameState?.selectedGame
    if (!selectedGame) {
      socket.emit('room-error', { message: 'No game selected' })
      return
    }
    
    // Cancel any existing countdown
    if (room.countdownInterval) {
      clearInterval(room.countdownInterval)
      room.countdownInterval = null
      room.countdownSeconds = null
    }
    
    // Reset ready status for next round
    room.readyPlayers.clear()
    for (const [userProfileId, playerData] of room.players.entries()) {
      playerData.ready = false
    }
    
    // Start the game for all players
    dbHelpers.addGameEvent(roomId, null, 'game_started', { game: selectedGame })
    dbHelpers.updateRoomState(roomId, 'playing')
    
    // Update in-memory room gameState to 'playing'
    if (!room.gameState) {
      room.gameState = {}
    }
    room.gameState.state = 'playing'
    
    // Emit room snapshot with updated status
    emitRoomSnapshot(room)
    
    io.to(roomId).emit('game-start', { game: selectedGame })
    console.log(`[SOCKET] Game ${selectedGame} started in room ${roomId} by host`)
  })

  // Handle player rotation for winner-stays mode (Pong)
  socket.on('rotate-players', ({ roomId, winnerUserProfileId, loserUserProfileId }) => {
    const room = rooms.get(roomId)
    if (!room) {
      socket.emit('room-error', { message: 'Room not found' })
      return
    }
    
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!userProfileId) {
      socket.emit('room-error', { message: 'You are not in this room' })
      return
    }
    
    const player = room.players.get(userProfileId)
    if (!player) {
      socket.emit('room-error', { message: 'You are not in this room' })
      return
    }
    
    // Verify this is the host
    const isHost = room.hostUserProfileId && 
      String(player.userProfileId) === String(room.hostUserProfileId)
    
    if (!isHost) {
      console.log(`[SOCKET] Non-host player ${socket.id} attempted to rotate players in room ${roomId}`)
      socket.emit('room-error', { message: 'Only the host can rotate players' })
      return
    }
    
    // Verify we have at least 2 players
    if (room.players.size < 2) {
      socket.emit('room-error', { message: 'Need at least 2 players to rotate' })
      return
    }
    
    // Convert Map to array to preserve insertion order
    const playersArray = Array.from(room.players.entries())
    
    // Find winner and loser indices
    const winnerIndex = playersArray.findIndex(([id]) => String(id) === String(winnerUserProfileId))
    const loserIndex = playersArray.findIndex(([id]) => String(id) === String(loserUserProfileId))
    
    if (winnerIndex === -1 || loserIndex === -1) {
      socket.emit('room-error', { message: 'Winner or loser not found in room' })
      return
    }
    
    // Only rotate if there are 3+ players (otherwise just keep same order)
    if (playersArray.length >= 3) {
      // Create new array with rotation:
      // 1. Winner stays in their position (index 0 or 1)
      // 2. Loser moves to end
      // 3. Next waiting player (index 2) moves to loser's position
      // 4. If there's a 4th player (index 3), they stay in their relative position
      
      const newPlayersArray = []
      
      if (winnerIndex === 0 && loserIndex === 1) {
        // Winner at 0, loser at 1
        newPlayersArray.push(playersArray[0]) // Winner stays at 0
        if (playersArray.length > 2) {
          newPlayersArray.push(playersArray[2]) // 3rd player moves to position 1
        }
        if (playersArray.length > 3) {
          newPlayersArray.push(playersArray[3]) // 4th player stays in relative position
        }
        newPlayersArray.push(playersArray[1]) // Loser moves to end
      } else if (winnerIndex === 1 && loserIndex === 0) {
        // Winner at 1, loser at 0
        if (playersArray.length > 2) {
          newPlayersArray.push(playersArray[2]) // 3rd player moves to position 0
        }
        newPlayersArray.push(playersArray[1]) // Winner stays at 1
        if (playersArray.length > 3) {
          newPlayersArray.push(playersArray[3]) // 4th player stays in relative position
        }
        newPlayersArray.push(playersArray[0]) // Loser moves to end
      } else {
        // Edge case: winner/loser not at positions 0/1, just move loser to end
        for (let i = 0; i < playersArray.length; i++) {
          if (i !== loserIndex) {
            newPlayersArray.push(playersArray[i])
          }
        }
        newPlayersArray.push(playersArray[loserIndex]) // Loser at end
      }
      
      // Rebuild the Map with new order
      const newPlayersMap = new Map()
      for (const [id, playerData] of newPlayersArray) {
        newPlayersMap.set(id, playerData)
      }
      
      // Replace room's players Map
      room.players = newPlayersMap
      
      // Reset ready status for all players
      room.readyPlayers.clear()
      for (const [id, playerData] of room.players.entries()) {
        playerData.ready = false
      }
      
      console.log(`[SOCKET] Rotated players in room ${roomId}: winner ${winnerUserProfileId} stays, loser ${loserUserProfileId} moved to end`)
      console.log(`[SOCKET] New player order:`, Array.from(room.players.keys()).map((id, idx) => `${idx}: ${id}`).join(', '))
      
      // Emit updated room snapshot
      emitRoomSnapshot(room)
      
      // Notify all players of rotation
      io.to(roomId).emit('players-rotated', {
        winnerUserProfileId,
        loserUserProfileId,
        players: Array.from(room.players.values())
      })
    } else {
      // Only 2 players - just reset ready status, no rotation needed
      room.readyPlayers.clear()
      for (const [id, playerData] of room.players.entries()) {
        playerData.ready = false
      }
      
      emitRoomSnapshot(room)
    }
  })

  // Handle player position updates
  socket.on('player-position', ({ roomId, kiwiY, kiwiVelocity }) => {
    const room = rooms.get(roomId)
    if (!room) return
    
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!userProfileId) return
    
    // Update this player's position in room state (keyed by userProfileId)
    if (!room.gameState.kiwiPositions) {
      room.gameState.kiwiPositions = new Map()
    }
    room.gameState.kiwiPositions.set(userProfileId, { kiwiY, kiwiVelocity })
    
    // Note: Position updates are too frequent to log every one
    // Only update activity timestamp periodically
    dbHelpers.updateRoomActivity(roomId)
    
    // Broadcast to all other players
    socket.to(roomId).emit('player-position', {
      userProfileId: userProfileId,
      kiwiY,
      kiwiVelocity
    })
  })

  // Handle score updates
  socket.on('score-update', ({ roomId, score }) => {
    const room = rooms.get(roomId)
    if (!room) return
    
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!userProfileId) return
    
    const player = room.players.get(userProfileId)
    if (player) {
      player.score = score
      // Update in database
      db.prepare('UPDATE players SET score = ? WHERE id = ?').run(score, userProfileId)
      dbHelpers.addGameEvent(roomId, userProfileId, 'score_update', null, score)
    }
    
    dbHelpers.updateRoomActivity(roomId)
    
    // Broadcast to all players
    io.to(roomId).emit('score-update', {
      userProfileId: userProfileId,
      score
    })
  })

  // Shared function for handling player leave logic (reversed order: Broadcast → Socket.IO → Database → Map)
  const handlePlayerLeave = (socket, roomId, reason = 'explicit_leave', isDisconnected = false) => {
    const room = rooms.get(roomId)
    
    // If room not in memory, try to load it from database
    if (!room) {
      console.log(`[${reason.toUpperCase()}] Room ${roomId} not in memory, checking database`)
      const dbRoom = dbHelpers.getRoom(roomId)
      if (!dbRoom || dbRoom.state === 'ended') {
        console.log(`[${reason.toUpperCase()}] Room ${roomId} not found or already ended`)
        if (!isDisconnected && socket.connected) {
          socket.emit('room-error', { message: 'Room not found or already closed' })
        }
        return false
      }
      
      // Load room from database
      const dbPlayers = dbHelpers.getPlayersByRoom(roomId)
      const activePlayers = dbPlayers.filter(p => !p.left_at)
      
      if (activePlayers.length === 0) {
        console.log(`[SOCKET] Room ${roomId} has no active players`)
        dbHelpers.updateRoomState(roomId, 'ended')
        invalidateEndedRoomsCache(roomId)
        socket.emit('room-error', { message: 'Room has no active players' })
        return
      }
      
      // Find the first player (host) by joined_at timestamp
      const firstPlayer = activePlayers.sort((a, b) => 
        new Date(a.joined_at || 0) - new Date(b.joined_at || 0)
      )[0]
      
      // Check if the leaving player is the host
      const leavingPlayer = activePlayers.find(p => p.socket_id === socket.id)
      if (!leavingPlayer) {
        console.log(`[${reason.toUpperCase()}] Player ${socket.id} not found in room ${roomId}`)
        if (!isDisconnected && socket.connected) {
          socket.emit('room-error', { message: 'You are not in this room' })
        }
        return false
      }
      
      const isHost = leavingPlayer.socket_id === firstPlayer.socket_id
      
      if (isHost) {
        console.log(`[${reason.toUpperCase()}] Host ${socket.id} is leaving room ${roomId} - closing room (loaded from DB)`)
        
        // Get all socket IDs from database
        const allSocketIds = new Set(activePlayers.map(p => p.socket_id).filter(Boolean))
        console.log(`[${reason.toUpperCase()}] Emitting room-closed to room ${roomId} (${allSocketIds.size} players from DB)`)
        
        // First, emit to the room
        io.to(roomId).emit('room-closed', {
          reason: 'host_left',
          message: 'Room closed by host'
        })
        
        // Also emit directly to each socket ID from database
        for (const socketId of allSocketIds) {
          if (socketId !== socket.id) {
            const targetSocket = io.sockets.sockets.get(socketId)
            if (targetSocket && targetSocket.connected) {
              console.log(`[${reason.toUpperCase()}] Emitting room-closed to socket ${socketId} from DB`)
              targetSocket.emit('room-closed', {
                reason: 'host_left',
                message: 'Room closed by host'
              })
            }
          }
        }
        
        // Mark all players as left
        const result = dbHelpers.removeAllPlayersFromRoom(roomId)
        console.log(`[${reason.toUpperCase()}] Marked ${result.changes} player(s) as left in room ${roomId}`)
        
        // Update room state
        dbHelpers.updateRoomState(roomId, 'ended')
        invalidateEndedRoomsCache(roomId)
        
        // Broadcast room deletion to LOBBY and all connected sockets
        // (players in rooms have left LOBBY, so we need to broadcast to everyone)
        const roomListUpdate = {
          roomId,
          action: 'deleted'
        }
        io.to('LOBBY').emit('room-list-updated', roomListUpdate)
        io.emit('room-list-updated', roomListUpdate) // Also broadcast to all sockets
        // Also broadcast updated room list to all sockets (for Menu.jsx which listens for 'room-list')
        broadcastRoomList()
        
        if (!isDisconnected) {
          socket.leave(roomId)
          // Rejoin LOBBY to receive room list updates
          socket.join('LOBBY')
        }
        return true
      } else {
        // Regular player leaving - just mark as left
        dbHelpers.removePlayer(socket.id)
        dbHelpers.addGameEvent(roomId, socket.id, 'player_left', null)
        dbHelpers.updateRoomActivity(roomId)
        
        // Get remaining players for broadcast
        const remainingPlayers = activePlayers.filter(p => p.socket_id !== socket.id)
        
        // Broadcast player-left event to remaining players in the room
        io.to(roomId).emit('player-left', {
          userProfileId: leavingPlayer.user_profile_id,
          players: remainingPlayers.map(p => ({
            userProfileId: p.user_profile_id,
            socketId: p.socket_id,
            name: p.name || 'Unknown',
            score: 0,
            ready: false,
            color: p.color || '#FFFFFF',
            emoji: p.emoji || '👤',
            colorId: p.color_id || 0
          })),
          roomId: roomId
        })
        
        // CRITICAL: Emit room-snapshot to update UI for remaining players
        // Load room into memory temporarily to emit snapshot, or construct snapshot from DB data
        const snapshot = {
          roomId: roomId,
          hostUserProfileId: firstPlayer.user_profile_id,
          status: dbRoom.state || 'waiting',
          selectedGame: null,
          players: remainingPlayers.map(p => ({
            userProfileId: p.user_profile_id,
            socketId: p.socket_id,
            name: p.name || 'Unknown',
            score: 0,
            ready: false,
            color: p.color || '#FFFFFF',
            emoji: p.emoji || '👤',
            colorId: p.color_id || 0,
            profileName: p.name || 'Unknown',
            profileCreatedAt: p.joined_at || new Date().toISOString(),
            profileLastSeen: p.last_activity || new Date().toISOString()
          }))
        }
        io.to(roomId).emit('room-snapshot', snapshot)
        console.log(`[${reason.toUpperCase()}] Emitted room-snapshot for room ${roomId} loaded from DB (non-host leave)`)
        addServerEventLog(`Emitted room-snapshot for room ${roomId} loaded from DB after player leave`, 'info', { roomId, remainingPlayerCount: remainingPlayers.length, leavingUserProfileId: leavingPlayer.user_profile_id, reason })
        
        if (!isDisconnected) {
          socket.leave(roomId)
          // Rejoin LOBBY to receive room list updates
          socket.join('LOBBY')
        }
        
        // Broadcast room update to LOBBY
        io.to('LOBBY').emit('room-list-updated', {
          roomId,
          action: 'updated',
          room: {
            id: roomId,
            playerCount: remainingPlayers.length,
            maxPlayers: 4,
            state: dbRoom.state || 'waiting',
            lastActivity: dbRoom.last_activity || new Date().toISOString()
          }
        })
        return true
      }
    }
    
    // Room is in memory - find player by socket ID
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!userProfileId || !room.players.has(userProfileId)) {
      console.log(`[${reason.toUpperCase()}] Player ${socket.id} not in room ${roomId} players map`)
      return false
    }
    
    const leavingPlayer = room.players.get(userProfileId)
    // Check if player is host by profile ID (persistent)
    const isHost = leavingPlayer && room.hostUserProfileId && 
      String(leavingPlayer.userProfileId) === String(room.hostUserProfileId)
    
    console.log(`[${reason.toUpperCase()}] Player ${socket.id} leaving room ${roomId}`, {
      isHost,
      hostUserProfileId: room.hostUserProfileId,
      leavingPlayerProfileId: leavingPlayer?.userProfileId
    })
    addServerEventLog(`Player ${socket.id} leaving room ${roomId} (${reason})`, 'info', { socketId: socket.id, roomId, isHost, reason })
    
    // If host is leaving, just remove them - room stays open
    if (isHost) {
      console.log(`[${reason.toUpperCase()}] Host ${socket.id} is leaving room ${roomId} - removing from room but keeping it open`)
      
      // Get remaining players BEFORE removing from Map
      const remainingPlayers = Array.from(room.players.values()).filter(p => p.userProfileId !== userProfileId)
      
      // Remove from Map FIRST (so snapshot doesn't include leaving host)
      room.players.delete(userProfileId)
      room.socketIds.delete(userProfileId)
      room.hostSocketId = null // Clear host socket, but keep hostUserProfileId
      
      // Broadcast player-left event (include roomId like player-joined does)
      io.to(roomId).emit('player-left', {
        userProfileId: userProfileId,
        players: remainingPlayers,
        roomId: roomId // Include roomId so frontend can update the correct room
      })
      
      // Emit canonical room snapshot AFTER removing player from Map (so snapshot is correct)
      emitRoomSnapshot(room)
      
      // Remove from Socket.IO room namespace
      if (!isDisconnected) {
        socket.leave(roomId)
        // Rejoin LOBBY to receive room list updates
        socket.join('LOBBY')
      }
      
      // Update database (mark player as left by userProfileId)
      db.prepare('UPDATE players SET left_at = CURRENT_TIMESTAMP WHERE id = ? AND room_id = ?').run(userProfileId, roomId)
      dbHelpers.addGameEvent(roomId, userProfileId, 'player_left', { reason: 'host_left_but_room_stays_open' })
      dbHelpers.updateRoomActivity(roomId)
      
      // Broadcast room update to LOBBY
      io.to('LOBBY').emit('room-list-updated', {
        roomId,
        action: 'updated',
        room: {
          id: roomId,
          playerCount: room.players.size,
          maxPlayers: 4,
          state: room.gameState?.state || 'waiting',
          lastActivity: room.lastActivity || new Date().toISOString()
        }
      })
      
      return true
    }
    
    // Regular player leaving (not host) - REVERSED ORDER
    // Join: Map → Database → Socket.IO → Broadcast
    // Leave: Broadcast → Socket.IO → Database → Map
    
    // Step 1: Get remaining players BEFORE removing from Map (so we have correct list for broadcast)
    const remainingPlayers = Array.from(room.players.values()).filter(p => p.userProfileId !== userProfileId)
    
    // Step 2: Remove from Map FIRST (so snapshot doesn't include leaving player)
    // Safety check: room might have been deleted by another process
    if (room && room.players) {
      room.players.delete(userProfileId)
      room.socketIds.delete(userProfileId)
    }
    
    // CRITICAL: Verify player count matches after removal
    const actualPlayerCount = room.players.size
    const expectedPlayerCount = remainingPlayers.length
    if (actualPlayerCount !== expectedPlayerCount) {
      console.error(`[${reason.toUpperCase()}] PLAYER COUNT MISMATCH! Expected ${expectedPlayerCount} but room.players.size is ${actualPlayerCount}`)
      console.error(`[${reason.toUpperCase()}] Room players:`, Array.from(room.players.keys()))
      console.error(`[${reason.toUpperCase()}] Remaining players:`, remainingPlayers.map(p => p.userProfileId))
    }
    
    // Step 3: Broadcast player-left event (while socket is still in Socket.IO room, so it can receive if needed)
    // Include roomId in payload (same pattern as player-joined) so frontend can update immediately
    console.log(`[${reason.toUpperCase()}] Emitting player-left to room ${roomId} with ${remainingPlayers.length} remaining players (room.players.size: ${room.players.size})`)
    addServerEventLog(`Emitting player-left to room ${roomId} with ${remainingPlayers.length} remaining players`, 'info', { roomId, remainingPlayerCount: remainingPlayers.length, actualRoomPlayerCount: room.players.size, leavingSocketId: socket.id, leavingUserProfileId: userProfileId, reason })
    
    // DEBUG: Check which sockets are in the room before emitting
    const roomAdapter = io.sockets.adapter.rooms.get(roomId)
    const socketsInRoom = roomAdapter ? Array.from(roomAdapter) : []
    console.log(`[DEBUG] [${reason.toUpperCase()}] Sockets in room ${roomId} before player-left emit:`, {
      roomId,
      socketCount: socketsInRoom.length,
      socketIds: socketsInRoom,
      leavingSocketId: socket.id,
      roomPlayersCount: room.players.size,
      remainingPlayersCount: remainingPlayers.length,
      timestamp: Date.now()
    })
    
    const playerLeftPayload = {
      userProfileId: userProfileId,
      players: remainingPlayers,
      roomId: roomId // Include roomId so frontend can update the correct room (same pattern as player-joined)
    }
    console.log(`[DEBUG] [${reason.toUpperCase()}] player-left payload:`, JSON.stringify(playerLeftPayload, null, 2))
    io.to(roomId).emit('player-left', playerLeftPayload)
    console.log(`[DEBUG] [${reason.toUpperCase()}] player-left event emitted to room ${roomId}`)
    
    // Step 4: Emit canonical room snapshot AFTER removing player from Map (so snapshot is correct)
    // CRITICAL: Must emit BEFORE socket.leave() so all remaining players (including host) receive the update
    // emitRoomSnapshot uses io.to(roomId).emit() which broadcasts to ALL sockets in the room
    // DOUBLE-CHECK: Verify room state is correct before emitting
    const snapshotPlayerCount = room.players.size
    if (snapshotPlayerCount !== remainingPlayers.length) {
      console.error(`[${reason.toUpperCase()}] CRITICAL: Snapshot will have wrong player count! room.players.size=${snapshotPlayerCount}, remainingPlayers.length=${remainingPlayers.length}`)
    }
    console.log(`[DEBUG] [${reason.toUpperCase()}] About to emit room-snapshot for room ${roomId} with ${snapshotPlayerCount} players in room Map`)
    emitRoomSnapshot(room)
    console.log(`[${reason.toUpperCase()}] Emitted room-snapshot to room ${roomId} with ${room.players.size} remaining players`)
    addServerEventLog(`Emitted room-snapshot to room ${roomId} after player leave`, 'info', { roomId, remainingPlayerCount: room.players.size, leavingUserProfileId: userProfileId, reason })
    
    // DEBUG: Check which sockets are still in the room after emitting
    const roomAdapterAfter = io.sockets.adapter.rooms.get(roomId)
    const socketsInRoomAfter = roomAdapterAfter ? Array.from(roomAdapterAfter) : []
    console.log(`[DEBUG] [${reason.toUpperCase()}] Sockets in room ${roomId} after emits (before socket.leave):`, {
      roomId,
      socketCount: socketsInRoomAfter.length,
      socketIds: socketsInRoomAfter,
      timestamp: Date.now()
    })
    
    // Step 5: Send confirmation to leaving player BEFORE removing from Socket.IO room
    // This allows the leaving player to update their UI immediately
    if (!isDisconnected) {
      socket.emit('room-left', {
        roomId: roomId,
        success: true,
        message: 'You have left the room'
      })
      console.log(`[${reason.toUpperCase()}] Sent room-left confirmation to leaving player ${socket.id}`)
      addServerEventLog(`Sent room-left confirmation to leaving player ${socket.id}`, 'info', { socketId: socket.id, roomId, reason })
    }
    
    // Step 6: Remove from Socket.IO room namespace (reverse of socket.join)
    // This happens AFTER snapshot emission and confirmation to ensure the leaving socket can still receive events
    if (!isDisconnected) {
      socket.leave(roomId)
      // Rejoin LOBBY to receive room list updates
      socket.join('LOBBY')
      console.log(`[${reason.toUpperCase()}] Socket ${socket.id} left room ${roomId} and rejoined LOBBY`)
      addServerEventLog(`Socket ${socket.id} left room ${roomId} and rejoined LOBBY`, 'info', { socketId: socket.id, roomId, reason })
    } else {
      // Socket is already disconnected, but clean up the adapter
      if (io.sockets.adapter.rooms.has(roomId)) {
        io.sockets.adapter.rooms.get(roomId)?.delete(socket.id)
      }
    }
    
    // Step 6: Update database - mark player as left by userProfileId
    db.prepare('UPDATE players SET left_at = CURRENT_TIMESTAMP WHERE id = ? AND room_id = ?').run(userProfileId, roomId)
    dbHelpers.addGameEvent(roomId, userProfileId, 'player_left', null)
    dbHelpers.updateRoomActivity(roomId)
    console.log(`[${reason.toUpperCase()}] Marked player ${userProfileId} (socket ${socket.id}) as left in database for room ${roomId}`)
    addServerEventLog(`Marked player ${userProfileId} as left in database for room ${roomId}`, 'info', { socketId: socket.id, userProfileId, roomId, reason })
    
    // Clean up any other sockets in this room that aren't associated with active players
    // Use in-memory room state as source of truth
    const activeSocketIds = new Set(Array.from(room.socketIds.values()))
    const cleanupRoomAdapter = io.sockets.adapter.rooms.get(roomId)
    const roomSockets = Array.from(cleanupRoomAdapter || [])
    for (const socketIdInRoom of roomSockets) {
      if (!activeSocketIds.has(socketIdInRoom)) {
        const staleSocket = io.sockets.sockets.get(socketIdInRoom)
        if (staleSocket) {
          console.log(`[${reason.toUpperCase()}] Removing stale socket ${socketIdInRoom} from room ${roomId} (not in active socketIds)`)
          addServerEventLog(`Removing stale socket ${socketIdInRoom} from room ${roomId}`, 'info', { socketId: socketIdInRoom, roomId, reason })
          staleSocket.leave(roomId)
        } else {
          // Socket doesn't exist anymore, just clean up the adapter
          const staleRoomAdapter = io.sockets.adapter.rooms.get(roomId)
          if (staleRoomAdapter && typeof staleRoomAdapter.delete === 'function') {
            staleRoomAdapter.delete(socketIdInRoom)
            console.log(`[${reason.toUpperCase()}] Cleaned up non-existent socket ${socketIdInRoom} from room ${roomId} adapter`)
          }
        }
      }
    }
    
    // Broadcast room update or deletion to all connected clients
    if (room.players.size === 0) {
      rooms.delete(roomId)
      dbHelpers.updateRoomState(roomId, 'ended')
      invalidateEndedRoomsCache(roomId)
      console.log(`[${reason.toUpperCase()}] Room ${roomId} deleted (empty)`)
      
      // Broadcast room deletion to LOBBY and all connected sockets
      // (players in rooms have left LOBBY, so we need to broadcast to everyone)
      const roomListUpdate = {
        roomId,
        action: 'deleted'
      }
      io.to('LOBBY').emit('room-list-updated', roomListUpdate)
      io.emit('room-list-updated', roomListUpdate) // Also broadcast to all sockets
      // Also broadcast updated room list to all sockets (for Menu.jsx which listens for 'room-list')
      broadcastRoomList()
    } else {
      // Broadcast room update with new player count
      io.emit('room-list-updated', {
        roomId,
        action: 'updated',
        room: {
          id: roomId,
          playerCount: room.players.size,
          maxPlayers: 4,
          state: room.gameState?.state || 'waiting',
          lastActivity: room.lastActivity || new Date().toISOString()
        }
      })
    }
    
    return true
  }

  // Handle explicit leave room request
  // Handle kick player (host only)
  socket.on('kick-player', ({ roomId, userProfileId: targetUserProfileId }) => {
    try {
      const room = rooms.get(roomId)
      if (!room) {
        socket.emit('room-error', { message: 'Room not found' })
        return
      }
      
      // Verify requester is host
      const requesterUserProfileId = findUserProfileIdBySocket(room, socket.id)
      if (!requesterUserProfileId || String(requesterUserProfileId) !== String(room.hostUserProfileId)) {
        console.log(`[SOCKET] Non-host player ${socket.id} attempted to kick player in room ${roomId}`)
        socket.emit('room-error', { message: 'Only the host can kick players' })
        return
      }
      
      // Verify target player exists in room
      if (!targetUserProfileId || !room.players.has(targetUserProfileId)) {
        socket.emit('room-error', { message: 'Player not found in room' })
        return
      }
      
      // Cannot kick yourself
      if (String(targetUserProfileId) === String(requesterUserProfileId)) {
        socket.emit('room-error', { message: 'Cannot kick yourself' })
        return
      }
      
      const targetPlayer = room.players.get(targetUserProfileId)
      console.log(`[SOCKET] Host ${socket.id} kicking player ${targetUserProfileId} (${targetPlayer.name}) from room ${roomId}`)
      addServerEventLog(`Host ${socket.id} kicking player ${targetUserProfileId} from room ${roomId}`, 'info', { socketId: socket.id, roomId, targetUserProfileId, requesterUserProfileId })
      
      // Get target player's socket
      const targetSocketId = targetPlayer.socketId
      
      // Get remaining players BEFORE removing from Map
      const remainingPlayers = Array.from(room.players.values()).filter(p => p.userProfileId !== targetUserProfileId)
      
      // Remove from Map FIRST (so snapshot doesn't include kicked player)
      room.players.delete(targetUserProfileId)
      room.socketIds.delete(targetUserProfileId)
      
      // Emit kicked event to target player
      if (targetSocketId) {
        const targetSocket = io.sockets.sockets.get(targetSocketId)
        if (targetSocket && targetSocket.connected) {
          targetSocket.emit('player-kicked', {
            roomId,
            message: 'You have been kicked from the room by the host'
          })
          targetSocket.leave(roomId)
          // Rejoin LOBBY to receive room list updates
          targetSocket.join('LOBBY')
        }
      }
      
      // Broadcast player-left to room (remaining players) - include roomId like player-joined
      io.to(roomId).emit('player-left', {
        userProfileId: targetUserProfileId,
        players: remainingPlayers,
        roomId: roomId, // Include roomId so frontend can update the correct room
        reason: 'kicked'
      })
      
      // CRITICAL: Emit room-snapshot to all remaining players in the room
      // This ensures UI updates immediately
      emitRoomSnapshot(room)
      console.log(`[SOCKET] Emitted room-snapshot after kicking player ${targetUserProfileId} from room ${roomId}`)
      
      // Update database
      db.prepare('UPDATE players SET left_at = CURRENT_TIMESTAMP WHERE id = ? AND room_id = ?').run(targetUserProfileId, roomId)
      dbHelpers.addGameEvent(roomId, targetUserProfileId, 'player_kicked', { kickedBy: requesterUserProfileId })
      dbHelpers.updateRoomActivity(roomId)
      
      // Broadcast room update to LOBBY
      io.to('LOBBY').emit('room-list-updated', {
        roomId,
        action: 'updated',
        room: {
          id: roomId,
          playerCount: room.players.size,
          maxPlayers: 4,
          state: room.gameState?.state || 'waiting',
          lastActivity: room.lastActivity || new Date().toISOString()
        }
      })
      
      // Also broadcast updated room list
      broadcastRoomList()
      
      console.log(`[SOCKET] Player ${targetUserProfileId} kicked from room ${roomId} by host ${requesterUserProfileId}`)
    } catch (error) {
      console.error(`[SOCKET] Error in kick-player handler:`, error)
      socket.emit('room-error', { message: `Failed to kick player: ${error.message}` })
    }
  })

  socket.on('leave-room', ({ roomId, userProfileId: providedUserProfileId }) => {
    console.log(`[SOCKET] Player ${socket.id} leaving room ${roomId}`, providedUserProfileId ? `(userProfileId: ${providedUserProfileId})` : '')
    addServerEventLog(`Player ${socket.id} leaving room ${roomId}`, 'info', { socketId: socket.id, roomId, providedUserProfileId })
    
    const room = rooms.get(roomId)
    if (!room) {
      socket.emit('room-error', { message: 'Room not found' })
      return
    }
    
    // Find userProfileId - use provided one if available, otherwise find by socket
    let userProfileId = providedUserProfileId
    if (!userProfileId) {
      userProfileId = findUserProfileIdBySocket(room, socket.id)
    }
    
    if (!userProfileId || !room.players.has(userProfileId)) {
      console.log(`[SOCKET] Player not found in room ${roomId}`)
      socket.emit('room-error', { message: 'You are not in this room' })
      return
    }
    
    // Verify the socket matches the userProfileId (security check)
    const player = room.players.get(userProfileId)
    if (player.socketId !== socket.id) {
      console.log(`[SOCKET] Socket ${socket.id} does not match player ${userProfileId} socket ${player.socketId}`)
      socket.emit('room-error', { message: 'Socket mismatch' })
      return
    }
    
    // handlePlayerLeave will emit room-snapshot after removing the player
    const result = handlePlayerLeave(socket, roomId, 'explicit_leave', false)
    
    if (result) {
      console.log(`[SOCKET] Player ${userProfileId} successfully left room ${roomId}`)
      // Also broadcast updated room list to LOBBY
      broadcastRoomList()
    }
  })

  // Handle disconnect
  socket.on('disconnect', () => {
    try {
      console.log('Player disconnected:', socket.id)
      addServerEventLog(`Player disconnected: ${socket.id}`, 'info', { socketId: socket.id })
    
    // Update user count when someone disconnects
    // Use setImmediate to ensure socket is fully removed from the set
    setImmediate(() => {
      const count = io.sockets.sockets.size
      io.emit('user-count-update', { count })
      console.log(`[SOCKET] User count updated after disconnect: ${count} total users`)
      addServerEventLog(`User count updated after disconnect: ${count} total users`, 'info', { count })
    })
    
    // ALWAYS clean up database records for this socket, even if not in in-memory room
    // This handles cases where socket disconnected before properly joining, or race conditions
    // Find player by socket_id and mark as left
    const dbPlayer = db.prepare('SELECT * FROM players WHERE socket_id = ? AND left_at IS NULL').get(socket.id)
    if (dbPlayer) {
      console.log(`[DISCONNECT] Cleaning up database record for disconnected socket ${socket.id} in room ${dbPlayer.room_id}`)
      addServerEventLog(`Cleaning up database record for disconnected socket ${socket.id}`, 'info', { socketId: socket.id, roomId: dbPlayer.room_id })
      // Mark as left by player ID (userProfileId)
      db.prepare('UPDATE players SET left_at = CURRENT_TIMESTAMP WHERE id = ? AND room_id = ?').run(dbPlayer.id, dbPlayer.room_id)
      dbHelpers.addGameEvent(dbPlayer.room_id, dbPlayer.id, 'player_left', null)
      dbHelpers.updateRoomActivity(dbPlayer.room_id)
      
      // Also remove from Socket.IO room namespace if still there
      const roomId = dbPlayer.room_id
      if (io.sockets.adapter.rooms.has(roomId)) {
        const roomAdapter = io.sockets.adapter.rooms.get(roomId)
        if (roomAdapter) {
          const roomSockets = Array.from(roomAdapter)
          if (roomSockets.includes(socket.id)) {
            console.log(`[DISCONNECT] Removing disconnected socket ${socket.id} from Socket.IO room ${roomId}`)
            // Socket is already disconnected, but we can clean up the room adapter
            if (typeof roomAdapter.delete === 'function') {
              roomAdapter.delete(socket.id)
            }
          }
        }
      }
    }
    
    // Remove player from all rooms
    // First, find all rooms this socket is in (both in-memory and Socket.IO namespace)
    const socketRooms = []
    for (const [roomId, room] of rooms.entries()) {
      // Check if socket.id is in the socketIds map
      const userProfileId = findUserProfileIdBySocket(room, socket.id)
      if (userProfileId && room.players.has(userProfileId)) {
        socketRooms.push(roomId)
      }
    }
    
    // Also check Socket.IO adapter for rooms this socket might be in
    for (const [roomId, roomSockets] of io.sockets.adapter.rooms.entries()) {
      if (roomSockets.has(socket.id) && !socketRooms.includes(roomId)) {
        // Socket is in this room namespace but not in our in-memory room
        // This can happen if socket disconnected before properly joining
        console.log(`[DISCONNECT] Socket ${socket.id} found in Socket.IO room ${roomId} but not in in-memory room`)
        addServerEventLog(`Socket ${socket.id} found in Socket.IO room ${roomId} but not in in-memory room`, 'warn', { socketId: socket.id, roomId })
        socketRooms.push(roomId)
      }
    }
    
    console.log(`[DISCONNECT] Socket ${socket.id} is in ${socketRooms.length} room(s): ${socketRooms.join(', ')}`)
    addServerEventLog(`Socket ${socket.id} is in ${socketRooms.length} room(s)`, 'info', { socketId: socket.id, roomIds: socketRooms })
    
    // Process each room
    for (const roomId of socketRooms) {
      const room = rooms.get(roomId)
      const userProfileId = findUserProfileIdBySocket(room, socket.id)
      if (room && userProfileId && room.players && room.players.has(userProfileId)) {
        const leavingPlayer = room.players.get(userProfileId)
        const playerName = leavingPlayer?.name || 'Unknown'
        let isHost = room.hostSocketId === socket.id
        
        // Check if this player is the host by userProfileId
        if (!isHost && leavingPlayer) {
          isHost = room.hostUserProfileId && 
            String(leavingPlayer.userProfileId) === String(room.hostUserProfileId)
          if (isHost) {
            console.log(`[DISCONNECT] Host identified by userProfileId: ${leavingPlayer.userProfileId}`)
          }
        }
        
        console.log(`[DISCONNECT] Removing player ${userProfileId} (socket ${socket.id}, ${playerName}) from room ${roomId}, isHost: ${isHost}`)
        addServerEventLog(`Removing player ${userProfileId} from room ${roomId}, isHost: ${isHost}`, 'info', { socketId: socket.id, userProfileId, roomId, playerName, isHost })
        
        // Remove from ready players and cancel countdown if needed
        // Use optional chaining to safely handle cases where readyPlayers might be undefined
        room.readyPlayers?.delete(userProfileId)
        if (room.countdownInterval) {
          clearInterval(room.countdownInterval)
          room.countdownInterval = null
          room.countdownSeconds = null
          io.to(roomId).emit('countdown-cancelled', {})
          console.log(`[DISCONNECT] Cancelled countdown in room ${roomId} due to player disconnect`)
          addServerEventLog(`Cancelled countdown in room ${roomId} due to player disconnect`, 'info', { roomId })
        }
        
        // If host is disconnecting, just remove them - room stays open
        // Host can reconnect and will be restored as host
        if (isHost) {
          console.log(`[DISCONNECT] Host ${socket.id} disconnected from room ${roomId} - room stays open`)
          addServerEventLog(`Host ${socket.id} disconnected from room ${roomId} - room stays open`, 'info', { socketId: socket.id, roomId })
          
          // Get remaining players BEFORE removing from Map
          const remainingPlayers = Array.from(room.players.values()).filter(p => p.userProfileId !== userProfileId)
          
          // Remove host from in-memory room
          room.players.delete(userProfileId)
          room.socketIds.delete(userProfileId)
          
          // Clear hostSocketId temporarily (will be restored when host rejoins)
          room.hostSocketId = null
          
          // Broadcast player-left event to remaining players (include roomId like player-joined)
          io.to(roomId).emit('player-left', {
            userProfileId: userProfileId,
            players: remainingPlayers,
            roomId: roomId, // Include roomId so frontend can update the correct room
            reason: 'disconnect'
          })
          
          // CRITICAL: Emit room-snapshot to all remaining players in the room
          // This ensures UI updates immediately when host disconnects
          emitRoomSnapshot(room)
          console.log(`[DISCONNECT] Emitted room-snapshot after host ${userProfileId} disconnected from room ${roomId}`)
          
          // Mark player as left in DB by userProfileId (host will reconnect with new socket)
          db.prepare('UPDATE players SET left_at = CURRENT_TIMESTAMP WHERE id = ? AND room_id = ?').run(userProfileId, roomId)
          dbHelpers.addGameEvent(roomId, userProfileId, 'player_left', null)
          console.log(`[DISCONNECT] Marked host ${userProfileId} (socket ${socket.id}) as left in database`)
          addServerEventLog(`Marked host ${userProfileId} as left in database`, 'info', { socketId: socket.id, userProfileId, roomId })
          
          // Set grace period timeout (60 seconds)
          const HOST_RECONNECT_GRACE_PERIOD_MS = 60 * 1000 // 60 seconds
          room.hostReconnectTimeout = setTimeout(() => {
            // Check if host has reconnected
            const currentRoom = rooms.get(roomId)
            if (currentRoom && !currentRoom.hostSocketId) {
              // Host did not reconnect - close the room
              console.log(`[DISCONNECT] Host did not reconnect within grace period, closing room ${roomId}`)
              addServerEventLog(`Host did not reconnect, closing room ${roomId}`, 'warn', { roomId })
              
              // Notify players in room
              io.to(roomId).emit('room-closed', {
                reason: 'host_timeout',
                message: 'Room closed: Host did not reconnect within 60 seconds'
              })
              
              // Mark all players as left
              const result = dbHelpers.removeAllPlayersFromRoom(roomId)
              console.log(`[DISCONNECT] Marked ${result.changes} player(s) as left in room ${roomId}`)
              
              // Update room state
              dbHelpers.updateRoomState(roomId, 'ended')
              invalidateEndedRoomsCache(roomId)
              
              // Delete from memory
              rooms.delete(roomId)
              
              // Broadcast room deletion to LOBBY and all connected sockets
              // (players in rooms have left LOBBY, so we need to broadcast to everyone)
              const roomListUpdate = {
                roomId,
                action: 'deleted'
              }
              io.to('LOBBY').emit('room-list-updated', roomListUpdate)
              io.emit('room-list-updated', roomListUpdate) // Also broadcast to all sockets
              // Also broadcast updated room list to all sockets (for Menu.jsx which listens for 'room-list')
              broadcastRoomList()
            }
            // Clear timeout reference
            if (currentRoom) {
              currentRoom.hostReconnectTimeout = null
            }
          }, HOST_RECONNECT_GRACE_PERIOD_MS)
          
          // Notify other players that host disconnected (but room stays open)
          io.to(roomId).emit('host-disconnected', {
            message: 'Host disconnected. Room stays open - host can reconnect within 60 seconds.',
            reconnectTimeout: HOST_RECONNECT_GRACE_PERIOD_MS
          })
          
          // Broadcast room update to LOBBY
          io.to('LOBBY').emit('room-list-updated', {
            roomId,
            action: 'updated',
            room: {
              id: roomId,
              playerCount: room.players.size,
              maxPlayers: 4,
              state: room.gameState?.state || 'waiting',
              lastActivity: room.lastActivity || new Date().toISOString()
            }
          })
          
          // Also broadcast updated room list
          broadcastRoomList()
          
          break
        }
        
        // Regular player disconnecting (not host) - use shared leave function
        const leaveResult = handlePlayerLeave(socket, roomId, 'disconnect', true)
        
        // CRITICAL: Ensure room-snapshot is emitted even if handlePlayerLeave didn't (safety check)
        const roomAfterLeave = rooms.get(roomId)
        if (roomAfterLeave && roomAfterLeave.players.size > 0) {
          // Double-check that snapshot was emitted - if room still exists with players, emit snapshot
          emitRoomSnapshot(roomAfterLeave)
          console.log(`[DISCONNECT] Emitted room-snapshot after regular player disconnect (safety check)`)
        }
        
        // If room became empty, wait a bit before deleting from memory (to allow reconnection)
        if (leaveResult && room && room.players.size === 0) {
          setTimeout(() => {
            const stillEmpty = rooms.get(roomId)
            if (stillEmpty && stillEmpty.players.size === 0) {
              rooms.delete(roomId)
              console.log(`[DISCONNECT] Room ${roomId} deleted from memory (still empty after delay)`)
            }
          }, 5000)
        }
      }
    }
    
    // Broadcast updated room list if player was in a room
    if (socketRooms.length > 0) {
      broadcastRoomList()
    }
    } catch (error) {
      console.error(`[DISCONNECT] Error handling disconnect for socket ${socket.id}:`, error)
      console.error(`[DISCONNECT] Error stack:`, error.stack)
      addServerEventLog(`Error handling disconnect for socket ${socket.id}: ${error.message}`, 'error', { socketId: socket.id, error: error.message })
      // Don't rethrow - we want the server to keep running even if disconnect handling fails
    }
  })
})

// API endpoints to explore the database
// IMPORTANT: /api/rooms/active must come BEFORE /api/rooms/:roomId to avoid route conflicts
// Debug endpoint to check rooms in memory
// Debug endpoint to check socket state
app.get('/api/debug/sockets', (req, res) => {
  const sockets = Array.from(io.sockets.sockets.values()).map(socket => ({
    id: socket.id,
    connected: socket.connected,
    rooms: Array.from(socket.rooms)
  }))
  
  res.json({
    totalSockets: io.sockets.sockets.size,
    sockets: sockets
  })
})

app.get('/api/debug/rooms', (req, res) => {
  try {
    const roomList = Array.from(rooms.entries()).map(([id, room]) => ({
      id,
      playerCount: room.players?.size || 0,
      state: room.gameState?.state || 'unknown'
    }))
    res.json({ count: rooms.size, rooms: roomList })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get active rooms (waiting or playing, not ended)
// MUST be defined before /api/rooms/:roomId to avoid route conflicts
app.get('/api/rooms/active', (req, res) => {
  try {
    console.log('[API] Fetching active rooms from in-memory Map and database')
    
    // Get active rooms from in-memory Map (real-time data)
    // Get ended room IDs from cache (refresh if stale)
    const now = Date.now()
    if (now - endedRoomIdsCacheTime > ENDED_ROOMS_CACHE_TTL || endedRoomIdsCache.size === 0) {
      const endedRoomsQuery = db.prepare(`SELECT id FROM rooms WHERE state = 'ended'`).all()
      endedRoomIdsCache = new Set(endedRoomsQuery.map(r => r.id))
      endedRoomIdsCacheTime = now
      if (endedRoomIdsCache.size > 0) {
        console.log(`[API] Refreshed ended rooms cache: ${endedRoomIdsCache.size} ended rooms`)
      }
    }
    
    // Only check ended status for rooms that are actually in memory
    // This avoids querying the database for every room
    const memoryRoomIds = Array.from(rooms.keys())
    const endedMemoryRoomIds = memoryRoomIds.length > 0 
      ? new Set(db.prepare(`SELECT id FROM rooms WHERE state = 'ended' AND id IN (${memoryRoomIds.map(() => '?').join(',')})`).all(...memoryRoomIds).map(r => r.id))
      : new Set()
    
    const memoryRooms = Array.from(rooms.entries())
      .filter(([roomId, room]) => {
        // Filter out ended rooms (check both cache and specific query for memory rooms)
        if (endedRoomIdsCache.has(roomId) || endedMemoryRoomIds.has(roomId)) {
          console.log(`[API] Filtering out ended room from memory: ${roomId}`)
          // Also remove from in-memory Map if it's marked as ended
          rooms.delete(roomId)
          // Update cache immediately
          endedRoomIdsCache.add(roomId)
          return false
        }
        const gameState = room.gameState?.state || 'waiting'
        return (gameState === 'waiting' || gameState === 'playing') && room.players.size < 4
      })
      .map(([roomId, room]) => ({
        id: roomId,
        playerCount: room.players ? room.players.size : 0,
        maxPlayers: 4,
        state: room.gameState?.state || 'waiting',
        lastActivity: room.lastActivity || new Date().toISOString(),
        source: 'memory'
      }))
    
    // Also get active rooms from database (rooms with active players)
    const dbRooms = db.prepare(`
      SELECT 
        r.id,
        r.state,
        r.last_activity,
        COUNT(p.id) as player_count
      FROM rooms r
      LEFT JOIN players p ON r.id = p.room_id AND p.left_at IS NULL
      WHERE r.state IN ('waiting', 'playing')
      GROUP BY r.id
      HAVING player_count > 0 AND player_count < 4
      ORDER BY player_count DESC, r.last_activity DESC
    `).all()
    
    const dbRoomsFormatted = dbRooms.map(room => ({
      id: room.id,
      playerCount: room.player_count || 0,
      maxPlayers: 4,
      state: room.state || 'waiting',
      lastActivity: room.last_activity || new Date().toISOString(),
      source: 'database'
    }))
    
    // Combine both sources, prioritizing memory rooms (they're more up-to-date)
    const memoryRoomIdsSet = new Set(memoryRooms.map(r => r.id))
    const uniqueDbRooms = dbRoomsFormatted.filter(r => !memoryRoomIdsSet.has(r.id))
    const allActiveRooms = [...memoryRooms, ...uniqueDbRooms]
      .sort((a, b) => b.playerCount - a.playerCount) // Sort by player count (most players first)
    
    console.log('[API] Returning', allActiveRooms.length, 'active rooms:', allActiveRooms.map(r => `${r.id} (${r.playerCount} players, ${r.state}, ${r.source})`))
    res.json(allActiveRooms)
  } catch (error) {
    console.error('[API] Error fetching active rooms:', error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/rooms', (req, res) => {
  try {
    const rooms = dbHelpers.getAllRoomStats()
    res.json(rooms)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/rooms/:roomId', (req, res) => {
  try {
    const { roomId } = req.params
    // Don't treat "active" as a roomId - this should never happen if routes are in correct order
    if (roomId === 'active') {
      console.error('[ERROR] /api/rooms/active was matched by /api/rooms/:roomId route! Route order is wrong!')
      return res.status(404).json({ error: 'Route conflict: /api/rooms/active should be handled by specific route' })
    }
    const room = dbHelpers.getRoomStats(roomId)
    if (!room) {
      return res.status(404).json({ error: 'Room not found' })
    }
    const players = dbHelpers.getPlayersByRoom(roomId)
    res.json({ ...room, players })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/rooms/:roomId/players', (req, res) => {
  try {
    const { roomId } = req.params
    const players = dbHelpers.getPlayersByRoom(roomId)
    res.json(players)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Create a new room via REST API
app.post('/api/rooms/create', async (req, res) => {
  try {
    const { playerName, userProfileId, colorId } = req.body
    
    if (!playerName && !userProfileId) {
      return res.status(400).json({ error: 'playerName or userProfileId is required' })
    }
    
    const roomId = generateRoomId()
    const name = playerName?.trim() || `Player ${Math.floor(Math.random() * 1000)}`
    
    console.log(`[API] Creating room ${roomId} for player (${name}) via REST API`)
    
    // Get or create user profile and assign emoji
    const userProfile = dbHelpers.getOrCreateUserProfile(name, userProfileId, colorId)
    const colorInfo = dbHelpers.getPlayerColorById(userProfile.color_id)
    
    // Create room in database with host user profile ID
    dbHelpers.createRoom(roomId, 'waiting', userProfile.id)
    dbHelpers.addGameEvent(roomId, null, 'room_created', { roomId })
    
    // Create in-memory room structure (but without socket connection yet)
    // The socket will connect later and join this room
    const room = {
      id: roomId,
      players: new Map(), // Will be populated when socket connects
      socketIds: new Map(), // Map userProfileId -> socketId
      hostUserProfileId: userProfile.id,
      hostSocketId: null, // Will be set when socket connects
      readyPlayers: new Set(), // Track which userProfileIds are ready
      gameState: {
        state: 'waiting',
        kiwiPositions: new Map(),
        pipes: [],
        score: 0,
        lastPipeX: 400
      },
      createdAt: new Date(),
      lastActivity: new Date().toISOString()
    }
    
    rooms.set(roomId, room)
    
    // Broadcast new room to LOBBY
    io.to('LOBBY').emit('room-list-updated', {
      roomId,
      action: 'created',
      room: {
        id: roomId,
        playerCount: 0, // No socket connection yet
        maxPlayers: 4,
        state: 'waiting',
        lastActivity: room.lastActivity
      }
    })
    
    console.log(`[API] Room ${roomId} created via REST API. Host profile: ${userProfile.id}`)
    
    res.json({
      success: true,
      roomId,
      hostUserProfileId: userProfile.id,
      playerName: name,
      color: colorInfo?.color || '#FFFFFF',
      emoji: colorInfo?.emoji || '⚪',
      message: 'Room created successfully. Connect via Socket.IO to join.'
    })
  } catch (error) {
    console.error(`[API] Error creating room via REST API:`, error)
    res.status(500).json({ error: error.message || 'Failed to create room' })
  }
})

app.get('/api/rooms/:roomId/history', (req, res) => {
  try {
    const { roomId } = req.params
    const limit = parseInt(req.query.limit) || 100
    const history = dbHelpers.getGameHistory(roomId, limit)
    res.json(history)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100
    const history = dbHelpers.getAllGameHistory(limit)
    res.json(history)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/stats', (req, res) => {
  try {
    const allRooms = dbHelpers.getAllRoomStats()
    const allHistory = dbHelpers.getAllGameHistory(1000)
    
    const stats = {
      totalRooms: allRooms.length,
      activeRooms: allRooms.filter(r => r.state !== 'ended').length,
      totalPlayers: allRooms.reduce((sum, r) => sum + (r.player_count || 0), 0),
      totalEvents: allHistory.length,
      eventTypes: {},
      recentRooms: allRooms.slice(0, 10),
      topScores: allRooms
        .filter(r => r.max_score > 0)
        .sort((a, b) => (b.max_score || 0) - (a.max_score || 0))
        .slice(0, 10)
    }
    
    // Count event types
    allHistory.forEach(event => {
      stats.eventTypes[event.event_type] = (stats.eventTypes[event.event_type] || 0) + 1
    })
    
    res.json(stats)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/tables', (req, res) => {
  try {
    const tables = db.prepare(`
      SELECT name, sql 
      FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all()
    
    const tableInfo = tables.map(table => {
      const columns = db.prepare(`PRAGMA table_info(${table.name})`).all()
      const rowCount = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get()
      return {
        name: table.name,
        sql: table.sql,
        columns: columns,
        rowCount: rowCount.count
      }
    })
    
    res.json(tableInfo)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/player-colors', (req, res) => {
  try {
    const colors = dbHelpers.getAllPlayerColors()
    res.json(colors)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/player-colors/:index', (req, res) => {
  try {
    const index = parseInt(req.params.index)
    if (isNaN(index) || index < 0) {
      return res.status(400).json({ error: 'Invalid index' })
    }
    const color = dbHelpers.getPlayerColorByIndex(index)
    if (!color) {
      return res.status(404).json({ error: 'Color not found' })
    }
    res.json(color)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/players', (req, res) => {
  try {
    const allRooms = dbHelpers.getAllRooms()
    const allPlayers = []
    
    for (const room of allRooms) {
      const players = dbHelpers.getPlayersByRoom(room.id)
      players.forEach((player) => {
        allPlayers.push({
          id: player.id,
          name: player.name,
          roomId: room.id,
          roomState: room.state,
          score: player.score,
          emoji: player.emoji || '⚪',
          color: player.color || '#FFFFFF',
          colorName: player.color_name || 'Unknown',
          joinedAt: player.joined_at
        })
      })
    }
    
    res.json({
      total: allPlayers.length,
      players: allPlayers
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Debug endpoint to see active_sessions table
app.get('/api/debug/active-sessions', (req, res) => {
  try {
    const activeSessions = db.prepare(`
      SELECT 
        as_table.user_profile_id,
        as_table.created_at,
        up.name as profile_name
      FROM active_sessions as_table
      LEFT JOIN user_profiles up ON as_table.user_profile_id = up.id
      ORDER BY as_table.created_at DESC
    `).all()
    
    res.json({
      count: activeSessions.length,
      sessions: activeSessions
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/user-profiles', (req, res) => {
  try {
    const profiles = db.prepare(`
      SELECT up.*, pc.color, pc.emoji, pc.name as color_name
      FROM user_profiles up
      LEFT JOIN player_colors pc ON up.color_id = pc.id
      ORDER BY up.created_at DESC
    `).all()
    
    // Get active profile IDs from two sources:
    // 1. Profiles currently in use by players in multiplayer games
    const activePlayers = db.prepare(`
      SELECT DISTINCT p.user_profile_id
      FROM players p
      WHERE p.left_at IS NULL AND p.user_profile_id IS NOT NULL
    `).all().map(p => p.user_profile_id)
    
    // 2. Profiles currently selected (active sessions)
    const activeSessions = db.prepare(`
      SELECT user_profile_id FROM active_sessions
    `).all().map(s => s.user_profile_id)
    
    // Combine both sources
    const activeProfileIds = [...new Set([...activePlayers, ...activeSessions])]
    
    // Mark profiles as active
    const profilesWithStatus = profiles.map(p => ({
      ...p,
      isActive: activeProfileIds.includes(p.id)
    }))
    
    res.json({
      total: profiles.length,
      profiles: profilesWithStatus,
      activeProfileIds: activeProfileIds
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get all active profiles with details about why they're active
// MUST come before /api/user-profiles/:profileId to avoid route conflicts
app.get('/api/user-profiles/active', (req, res) => {
  try {
    // Get profiles with active sessions
    const activeSessions = db.prepare(`
      SELECT 
        as_table.user_profile_id,
        as_table.created_at as session_created_at,
        up.name as profile_name,
        up.id as profile_id
      FROM active_sessions as_table
      LEFT JOIN user_profiles up ON as_table.user_profile_id = up.id
    `).all()
    
    // Get profiles with active players in rooms
    const activePlayers = db.prepare(`
      SELECT DISTINCT
        p.user_profile_id,
        up.name as profile_name,
        up.id as profile_id,
        COUNT(p.id) as player_count,
        GROUP_CONCAT(DISTINCT p.room_id) as room_ids,
        GROUP_CONCAT(DISTINCT r.state) as room_states,
        MIN(p.joined_at) as first_joined,
        MAX(r.last_activity) as last_activity
      FROM players p
      LEFT JOIN user_profiles up ON p.user_profile_id = up.id
      LEFT JOIN rooms r ON p.room_id = r.id
      WHERE p.left_at IS NULL AND p.user_profile_id IS NOT NULL
      GROUP BY p.user_profile_id
    `).all()
    
    // Combine and format
    const allActiveProfileIds = new Set()
    const activeProfiles = []
    
    // Add session-based active profiles
    for (const session of activeSessions) {
      if (session.profile_id && !allActiveProfileIds.has(session.profile_id)) {
        allActiveProfileIds.add(session.profile_id)
        activeProfiles.push({
          profileId: session.profile_id,
          profileName: session.profile_name,
          activeReasons: ['session'],
          sessionCreatedAt: session.session_created_at,
          playerCount: 0,
          roomIds: []
        })
      }
    }
    
    // Add or update player-based active profiles
    for (const player of activePlayers) {
      if (player.profile_id) {
        const existing = activeProfiles.find(p => p.profileId === player.profile_id)
        if (existing) {
          existing.activeReasons.push('in_room')
          existing.playerCount = player.player_count
          existing.roomIds = player.room_ids ? player.room_ids.split(',') : []
          existing.firstJoined = player.first_joined
          existing.lastActivity = player.last_activity
        } else {
          allActiveProfileIds.add(player.profile_id)
          activeProfiles.push({
            profileId: player.profile_id,
            profileName: player.profile_name,
            activeReasons: ['in_room'],
            playerCount: player.player_count,
            roomIds: player.room_ids ? player.room_ids.split(',') : [],
            firstJoined: player.first_joined,
            lastActivity: player.last_activity
          })
        }
      }
    }
    
    res.json({
      total: activeProfiles.length,
      profiles: activeProfiles
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/user-profiles/:profileId', (req, res) => {
  try {
    const { profileId } = req.params
    const { gameType } = req.query // Optional: filter by game type
    
    const profile = db.prepare(`
      SELECT up.*, pc.color, pc.emoji, pc.name as color_name
      FROM user_profiles up
      LEFT JOIN player_colors pc ON up.color_id = pc.id
      WHERE up.id = ?
    `).get(profileId)
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' })
    }
    
    // Get overall game statistics for this profile (all games)
    // Include all historical data, not just active players
    const overallStats = db.prepare(`
      SELECT 
        COUNT(DISTINCT gh.room_id) as total_rooms,
        COUNT(DISTINCT gh.id) as total_events,
        MAX(gh.score) as best_score,
        SUM(gh.score) as total_score,
        COUNT(DISTINCT CASE WHEN gh.score IS NOT NULL AND gh.score > 0 THEN gh.id END) as games_with_score
      FROM game_history gh
      INNER JOIN players p ON gh.player_id = p.id
      WHERE p.user_profile_id = ?
    `).get(profileId)
    
    // Get statistics by game type (parse from event_type or event_data)
    // Include all historical data, not just active players
    const statsByGameType = db.prepare(`
      SELECT 
        gh.event_type,
        COUNT(DISTINCT gh.room_id) as rooms,
        COUNT(DISTINCT gh.id) as events,
        MAX(gh.score) as best_score,
        SUM(gh.score) as total_score
      FROM game_history gh
      INNER JOIN players p ON gh.player_id = p.id
      WHERE p.user_profile_id = ? AND gh.score IS NOT NULL
      GROUP BY gh.event_type
    `).all(profileId)
    
    // Organize stats by game type
    const gameStats = {}
    statsByGameType.forEach(stat => {
      // Map event types to game names
      let gameName = 'other'
      if (stat.event_type.includes('microgame') || stat.event_type.includes('warioware')) {
        gameName = 'warioware'
      } else if (stat.event_type.includes('kiwi') || stat.event_type.includes('flappy')) {
        gameName = 'kiwi'
      } else if (stat.event_type.includes('pacman')) {
        gameName = 'pacman'
      } else if (stat.event_type.includes('crash')) {
        gameName = 'crash'
      } else if (stat.event_type.includes('pinball')) {
        gameName = 'pinball'
      } else if (stat.event_type.includes('gta')) {
        gameName = 'gta'
      } else if (stat.event_type.includes('collaboration')) {
        gameName = 'collaboration'
      }
      
      if (!gameStats[gameName]) {
        gameStats[gameName] = {
          gamesPlayed: 0,
          bestScore: 0,
          totalScore: 0,
          roomsJoined: 0
        }
      }
      
      gameStats[gameName].gamesPlayed += stat.events
      gameStats[gameName].bestScore = Math.max(gameStats[gameName].bestScore, stat.best_score || 0)
      gameStats[gameName].totalScore += (stat.total_score || 0)
      gameStats[gameName].roomsJoined += stat.rooms
    })
    
    res.json({
      ...profile,
      stats: {
        overall: {
          totalRooms: overallStats?.total_rooms || 0,
          totalEvents: overallStats?.total_events || 0,
          gamesWithScore: overallStats?.games_with_score || 0,
          bestScore: overallStats?.best_score || 0,
          totalScore: overallStats?.total_score || 0
        },
        byGame: gameStats
      }
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/user-profiles', (req, res) => {
  try {
    const { name } = req.body
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' })
    }
    
    // Get or create user profile (this will assign emoji)
    const userProfile = dbHelpers.getOrCreateUserProfile(name.trim())
    const colorInfo = dbHelpers.getPlayerColorById(userProfile.color_id)
    
    res.json({
      id: userProfile.id,
      name: userProfile.name,
      color: colorInfo?.color || '#FFFFFF',
      emoji: colorInfo?.emoji || '⚪',
      colorId: userProfile.color_id,
      colorName: colorInfo?.name || 'Unknown'
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Set active session (when profile is selected)
app.post('/api/user-profiles/:profileId/activate', (req, res) => {
  try {
    const { profileId } = req.params
    const stmt = db.prepare('INSERT OR REPLACE INTO active_sessions (user_profile_id, created_at) VALUES (?, CURRENT_TIMESTAMP)')
    stmt.run(profileId)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Clear active session (when profile is deselected)
app.post('/api/user-profiles/:profileId/deactivate', (req, res) => {
  try {
    const { profileId } = req.params
    const stmt = db.prepare('DELETE FROM active_sessions WHERE user_profile_id = ?')
    stmt.run(profileId)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/user-profiles/:profileId', (req, res) => {
  try {
    const { profileId } = req.params
    console.log(`[DELETE] Attempting to delete profile: ${profileId}`)
    
    // Check if profile exists
    const profile = db.prepare(`
      SELECT * FROM user_profiles WHERE id = ?
    `).get(profileId)
    
    if (!profile) {
      console.log(`[DELETE] Profile not found: ${profileId}`)
      return res.status(404).json({ error: 'Profile not found' })
    }
    
    // Check if profile is currently in use
    const activePlayer = db.prepare(`
      SELECT COUNT(*) as count FROM players 
      WHERE user_profile_id = ? AND left_at IS NULL
    `).get(profileId)
    
    if (activePlayer.count > 0) {
      console.log(`[DELETE] Profile is in use: ${profileId} (${activePlayer.count} active players)`)
      return res.status(400).json({ error: 'Cannot delete profile that is currently in use' })
    }
    
    // Clear active session if exists
    db.prepare('DELETE FROM active_sessions WHERE user_profile_id = ?').run(profileId)
    
    // Delete the profile
    const result = dbHelpers.deleteUserProfile(profileId)
    console.log(`[DELETE] Profile deleted successfully: ${profileId}`, result)
    
    res.json({ success: true, message: 'Profile deleted successfully' })
  } catch (error) {
    console.error(`[DELETE] Error deleting profile ${req.params.profileId}:`, error)
    res.status(500).json({ error: error.message || 'Failed to delete profile' })
  }
})


// Force logout a profile (remove from active_sessions and mark all players as left)
app.post('/api/user-profiles/:profileId/force-logout', (req, res) => {
  try {
    const { profileId } = req.params
    const { markPlayersLeft = true } = req.body
    
    // Check if profile exists
    const profile = db.prepare(`
      SELECT * FROM user_profiles WHERE id = ?
    `).get(profileId)
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' })
    }
    
    // Remove from active_sessions
    const sessionResult = db.prepare('DELETE FROM active_sessions WHERE user_profile_id = ?').run(profileId)
    
    let playersMarkedLeft = 0
    if (markPlayersLeft) {
      // Mark all active players with this profile as left
      const players = db.prepare(`
        SELECT id, socket_id, room_id FROM players 
        WHERE user_profile_id = ? AND left_at IS NULL
      `).all(profileId)
      
      for (const player of players) {
        db.prepare('UPDATE players SET left_at = CURRENT_TIMESTAMP WHERE id = ?').run(player.id)
        
        // Remove from in-memory rooms if they exist
        // CRITICAL FIX: room.players is keyed by userProfileId, not socket_id
        const room = rooms.get(player.room_id)
        if (room && player.user_profile_id && room.players.has(player.user_profile_id)) {
          room.players.delete(player.user_profile_id)
          room.socketIds.delete(player.user_profile_id)
          
          // Notify remaining players
          if (room.players.size > 0) {
            io.to(player.room_id).emit('player-left', {
              playerId: player.socket_id,
              players: Array.from(room.players.values())
            })
          }
          
          // Clean up empty rooms
          if (room.players.size === 0) {
            rooms.delete(player.room_id)
            dbHelpers.updateRoomState(player.room_id, 'ended')
            invalidateEndedRoomsCache(player.room_id)
          }
        }
        
        playersMarkedLeft++
      }
    }
    
    console.log(`[FORCE-LOGOUT] Profile ${profile.name} (${profileId}) logged out. Session removed: ${sessionResult.changes > 0}, Players marked left: ${playersMarkedLeft}`)
    
    res.json({
      success: true,
      message: 'Profile logged out successfully',
      sessionRemoved: sessionResult.changes > 0,
      playersMarkedLeft
    })
  } catch (error) {
    console.error(`[FORCE-LOGOUT] Error logging out profile ${req.params.profileId}:`, error)
    res.status(500).json({ error: error.message || 'Failed to logout profile' })
  }
})

// Admin endpoint to force close a room (for testing/debugging)
// Also used by host to close room via UI
app.post('/api/admin/close-room/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params
    const { userProfileId } = req.body
    console.log(`[ADMIN] Force closing room ${roomId}`, { userProfileId })
    
    // Verify the requester is the host (if userProfileId is provided)
    const dbRoom = dbHelpers.getRoom(roomId)
    if (!dbRoom) {
      return res.status(404).json({ error: 'Room not found' })
    }
    
    // If userProfileId is provided, verify they are the host
    // If not provided, allow it (for admin/testing purposes)
    if (userProfileId && dbRoom.host_user_profile_id) {
      if (String(userProfileId) !== String(dbRoom.host_user_profile_id)) {
        console.log(`[ADMIN] User ${userProfileId} attempted to close room ${roomId} but is not host (host: ${dbRoom.host_user_profile_id})`)
        return res.status(403).json({ error: 'Only the host can close the room' })
      }
      console.log(`[ADMIN] Host ${userProfileId} closing room ${roomId}`)
    } else if (!userProfileId) {
      console.log(`[ADMIN] Closing room ${roomId} without host verification (admin/test mode)`)
    }
    
    // Get all active players from database first
    const dbPlayers = dbHelpers.getPlayersByRoom(roomId)
    const activeDbPlayers = dbPlayers.filter(p => !p.left_at && p.socket_id)
    const allSocketIds = new Set(activeDbPlayers.map(p => p.socket_id))
    
    console.log(`[ADMIN] Found ${activeDbPlayers.length} active players in database`)
    console.log(`[ADMIN] Socket IDs from DB: ${Array.from(allSocketIds)}`)
    
    // Get all sockets that are actually in the socket.io room
    const roomSockets = await io.in(roomId).fetchSockets()
    console.log(`[ADMIN] Found ${roomSockets.length} sockets in socket.io room ${roomId}`)
    console.log(`[ADMIN] Socket IDs in room: ${roomSockets.map(s => s.id)}`)
    
    // Get all connected sockets by ID
    const connectedSockets = []
    for (const socketId of allSocketIds) {
      const socket = io.sockets.sockets.get(socketId)
      if (socket && socket.connected) {
        connectedSockets.push(socket)
        console.log(`[ADMIN] Found connected socket: ${socketId}`)
      } else {
        console.log(`[ADMIN] Socket ${socketId} not found or not connected`)
      }
    }
    
    console.log(`[ADMIN] Total connected sockets to notify: ${connectedSockets.length}`)
    
    // Emit room-closed event using multiple methods to ensure delivery
    const roomClosedEvent = {
      reason: 'admin_closed',
      message: 'Room closed by administrator'
    }
    
    // Method 1: Emit to the socket.io room (should reach all sockets in the room)
    io.to(roomId).emit('room-closed', roomClosedEvent)
    console.log(`[ADMIN] Emitted room-closed to socket.io room ${roomId}`)
    
    // Method 2: Emit directly to each socket found in the room
    for (const roomSocket of roomSockets) {
      if (roomSocket.connected) {
        roomSocket.emit('room-closed', roomClosedEvent)
        console.log(`[ADMIN] Emitted room-closed directly to socket in room: ${roomSocket.id}`)
      } else {
        console.log(`[ADMIN] Socket ${roomSocket.id} in room but not connected`)
      }
    }
    
    // Method 3: Emit directly to each connected socket from database (most reliable)
    // This ensures we reach sockets even if they're not in the socket.io room
    for (const socket of connectedSockets) {
      if (socket.connected) {
        socket.emit('room-closed', roomClosedEvent)
        console.log(`[ADMIN] Emitted room-closed directly to socket from DB: ${socket.id}`)
      } else {
        console.log(`[ADMIN] Socket ${socket.id} from DB but not connected`)
      }
    }
    
    // Method 4: Get room from memory if it exists and emit to all players
    const room = rooms.get(roomId)
    if (room) {
      console.log(`[ADMIN] Room found in memory with ${room.players.size} players`)
      for (const [playerSocketId, player] of room.players.entries()) {
        const playerSocket = io.sockets.sockets.get(playerSocketId)
        if (playerSocket && playerSocket.connected) {
          playerSocket.emit('room-closed', roomClosedEvent)
          console.log(`[ADMIN] Emitted room-closed to player in memory: ${playerSocketId}`)
        } else {
          console.log(`[ADMIN] Player socket ${playerSocketId} not found or not connected`)
        }
      }
    } else {
      console.log(`[ADMIN] Room not found in memory`)
    }
    
    // Method 5: Also emit to ALL connected sockets and let them filter (last resort)
    // This is a broadcast that all clients will receive, but only those in the room should act on it
    io.emit('room-closed-broadcast', { roomId, ...roomClosedEvent })
    console.log(`[ADMIN] Emitted room-closed-broadcast to all connected sockets`)
    
    // Wait a moment to ensure events are sent
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Mark all players as left
    const result = dbHelpers.removeAllPlayersFromRoom(roomId)
    console.log(`[ADMIN] Marked ${result.changes} player(s) as left in room ${roomId}`)
    
    // Update room state
    dbHelpers.updateRoomState(roomId, 'ended')
    invalidateEndedRoomsCache(roomId)
    
    // Clear in-memory room if it exists
    if (room) {
      room.players.clear()
      rooms.delete(roomId)
    }
    
    // Broadcast room deletion to LOBBY and all connected sockets
    // (players in rooms have left LOBBY, so we need to broadcast to everyone)
    const roomListUpdate = {
      roomId,
      action: 'deleted'
    }
    io.to('LOBBY').emit('room-list-updated', roomListUpdate)
    io.emit('room-list-updated', roomListUpdate) // Also broadcast to all sockets
    // Also broadcast updated room list to all sockets (for Menu.jsx which listens for 'room-list')
    broadcastRoomList()
    
    console.log(`[ADMIN] Room ${roomId} force closed successfully`)
    
    res.json({
      success: true,
      message: `Room ${roomId} closed`,
      playersMarkedLeft: result.changes,
      socketsInRoom: roomSockets.length,
      connectedSocketsNotified: connectedSockets.length,
      totalNotifications: roomSockets.length + connectedSockets.length
    })
  } catch (error) {
    console.error(`[ADMIN] Error force closing room ${req.params.roomId}:`, error)
    res.status(500).json({ error: error.message })
  }
})

// Force cleanup all stale players immediately
app.post('/api/admin/cleanup-stale', (req, res) => {
  try {
    const { force = false, roomId = null } = req.body
    const STALE_PLAYER_TIMEOUT_MS = force ? 0 : (10 * 60 * 1000) // 0 if force, else 10 minutes
    const now = new Date()
    const staleThreshold = new Date(now.getTime() - STALE_PLAYER_TIMEOUT_MS)
    
    // Get all active socket IDs
    const activeSocketIds = new Set(Array.from(io.sockets.sockets.keys()))
    
    // Find all active players
    let query = `
      SELECT p.id, p.socket_id, p.room_id, p.joined_at, p.user_profile_id, r.last_activity
      FROM players p
      LEFT JOIN rooms r ON p.room_id = r.id
      WHERE p.left_at IS NULL
    `
    const params = []
    
    if (roomId) {
      query += ' AND p.room_id = ?'
      params.push(roomId)
    }
    
    const activePlayers = db.prepare(query).all(...params)
    
    let cleanedCount = 0
    let disconnectedCount = 0
    const cleanedProfiles = new Set()
    const cleanedRooms = new Set()
    
    for (const player of activePlayers) {
      const isSocketActive = activeSocketIds.has(player.socket_id)
      const lastActivity = player.last_activity ? new Date(player.last_activity) : new Date(player.joined_at)
      const isStale = lastActivity < staleThreshold
      
      // Clean up if: force mode, socket is disconnected, or player is stale
      if (force || !isSocketActive || isStale) {
        const reason = force ? 'force_cleanup' : (!isSocketActive ? 'socket_disconnected' : 'stale_timeout')
        
        // Mark as left
        db.prepare('UPDATE players SET left_at = CURRENT_TIMESTAMP WHERE id = ?').run(player.id)
        
        if (!isSocketActive) {
          disconnectedCount++
        }
        
        // Remove from in-memory room
        // CRITICAL FIX: room.players is keyed by userProfileId, not socket_id
        const room = rooms.get(player.room_id)
        if (room && player.user_profile_id && room.players.has(player.user_profile_id)) {
          room.players.delete(player.user_profile_id)
          room.socketIds.delete(player.user_profile_id)
          
          if (room.players.size > 0) {
            io.to(player.room_id).emit('player-left', {
              playerId: player.user_profile_id,
              players: Array.from(room.players.values())
            })
          }
          
          if (room.players.size === 0) {
            rooms.delete(player.room_id)
            dbHelpers.updateRoomState(player.room_id, 'ended')
            invalidateEndedRoomsCache(player.room_id)
            cleanedRooms.add(player.room_id)
          }
        }
        
        dbHelpers.addGameEvent(player.room_id, player.id, 'player_left_stale', { reason })
        cleanedCount++
        cleanedRooms.add(player.room_id)
        if (player.user_profile_id) {
          cleanedProfiles.add(player.user_profile_id)
        }
      }
    }
    
    console.log(`[CLEANUP] Manual cleanup completed: ${cleanedCount} player(s) removed (${disconnectedCount} disconnected sockets), ${cleanedProfiles.size} profile(s) affected, ${cleanedRooms.size} room(s) affected`)
    addServerEventLog(`Manual cleanup completed: ${cleanedCount} player(s) removed`, 'info', { cleanedCount, disconnectedCount, profilesAffected: cleanedProfiles.size, roomsAffected: cleanedRooms.size })
    
    res.json({
      success: true,
      message: `Cleaned up ${cleanedCount} player(s)`,
      playersCleaned: cleanedCount,
      disconnectedSocketsCleaned: disconnectedCount,
      profilesAffected: cleanedProfiles.size,
      roomsAffected: cleanedRooms.size,
      profileIds: Array.from(cleanedProfiles),
      roomIds: Array.from(cleanedRooms)
    })
  } catch (error) {
    console.error('[CLEANUP] Error during manual cleanup:', error)
    res.status(500).json({ error: error.message })
  }
})

// Cleanup specific room
app.post('/api/admin/cleanup-room/:roomId', (req, res) => {
  try {
    const { roomId } = req.params
    const { force = false } = req.body
    
    // Get all active socket IDs
    const activeSocketIds = new Set(Array.from(io.sockets.sockets.keys()))
    
    // Get all players in this room
    const players = dbHelpers.getPlayersByRoom(roomId)
    const activePlayers = players.filter(p => !p.left_at)
    
    let cleanedCount = 0
    let disconnectedCount = 0
    
    for (const player of activePlayers) {
      const isSocketActive = activeSocketIds.has(player.socket_id)
      
      if (force || !isSocketActive) {
        const reason = force ? 'force_cleanup' : 'socket_disconnected'
        
        // Mark as left
        dbHelpers.removePlayer(player.socket_id)
        
        if (!isSocketActive) {
          disconnectedCount++
        }
        
        // Remove from in-memory room
        // CRITICAL FIX: room.players is keyed by userProfileId, not socket_id
        const room = rooms.get(roomId)
        if (room && player.user_profile_id && room.players.has(player.user_profile_id)) {
          room.players.delete(player.user_profile_id)
          room.socketIds.delete(player.user_profile_id)
          
          if (room.players.size > 0) {
            io.to(roomId).emit('player-left', {
              playerId: player.user_profile_id,
              players: Array.from(room.players.values())
            })
          }
          
          if (room.players.size === 0) {
            rooms.delete(roomId)
            dbHelpers.updateRoomState(roomId, 'ended')
            invalidateEndedRoomsCache(roomId)
          }
        }
        
        dbHelpers.addGameEvent(roomId, player.id, 'player_left_stale', { reason })
        cleanedCount++
      }
    }
    
    console.log(`[CLEANUP] Room ${roomId} cleanup completed: ${cleanedCount} player(s) removed (${disconnectedCount} disconnected sockets)`)
    addServerEventLog(`Room ${roomId} cleanup completed: ${cleanedCount} player(s) removed`, 'info', { roomId, cleanedCount, disconnectedCount })
    
    res.json({
      success: true,
      message: `Cleaned up ${cleanedCount} player(s) from room ${roomId}`,
      roomId,
      playersCleaned: cleanedCount,
      disconnectedSocketsCleaned: disconnectedCount
    })
  } catch (error) {
    console.error(`[CLEANUP] Error cleaning up room ${req.params.roomId}:`, error)
    res.status(500).json({ error: error.message })
  }
})

// Win tracking API endpoints
app.post('/api/wins/record', (req, res) => {
  try {
    const { userProfileId, gameType } = req.body
    
    if (!userProfileId || !gameType) {
      return res.status(400).json({ error: 'userProfileId and gameType are required' })
    }
    
    dbHelpers.recordWin(userProfileId, gameType)
    
    res.json({ success: true, message: 'Win recorded' })
  } catch (error) {
    console.error('[API] Error recording win:', error)
    res.status(500).json({ error: error.message })
  }
})

// Get wins for a specific game type
app.get('/api/wins/:gameType', (req, res) => {
  try {
    const { gameType } = req.params
    const wins = dbHelpers.getWinsByGameType(gameType)
    
    res.json({ gameType, wins })
  } catch (error) {
    console.error('[API] Error fetching wins:', error)
    res.status(500).json({ error: error.message })
  }
})

// Get all wins for a specific player
app.get('/api/wins/player/:userProfileId', (req, res) => {
  try {
    const { userProfileId } = req.params
    const wins = dbHelpers.getPlayerWins(userProfileId)
    
    // Convert to object format for easier access
    const winsByGame = {}
    wins.forEach(({ game_type, wins: winCount }) => {
      winsByGame[game_type] = winCount
    })
    
    res.json({ userProfileId, wins: winsByGame })
  } catch (error) {
    console.error('[API] Error fetching player wins:', error)
    res.status(500).json({ error: error.message })
  }
})

// Get wins for players in a room for a specific game
app.get('/api/wins/room/:roomId/:gameType', (req, res) => {
  try {
    const { roomId, gameType } = req.params
    const players = dbHelpers.getPlayersByRoom(roomId)
    
    const wins = players
      .filter(p => p.user_profile_id)
      .map(player => ({
        userProfileId: player.user_profile_id,
        wins: dbHelpers.getWinCount(player.user_profile_id, gameType)
      }))
    
    res.json({ roomId, gameType, wins })
  } catch (error) {
    console.error('[API] Error fetching room wins:', error)
    res.status(500).json({ error: error.message })
  }
})

const PORT = process.env.PORT || 8000
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`)
  console.log(`Access from local network: http://<your-ip>:${PORT}`)
})

