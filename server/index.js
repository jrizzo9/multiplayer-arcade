import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import os from 'os'
import gameStateRouter from './api/game-state.js'
import debugLogsRouter, { addServerEventLog } from './api/debug-logs.js'
import { forwardLogToVercel } from './utils/render-log-forwarder.js'
import { getLeaderboard, getWinCount, getWinsForPlayers, getAllMatches, getAllProfiles, getProfile, saveProfile, updateProfile, deleteProfile } from './services/nocode-backend.js'

// Debug logging flag - set to true for verbose debugging
const DEBUG_LOGGING = process.env.DEBUG_LOGGING === 'true' || false

// Wrap console methods to forward logs to Vercel
const originalConsoleLog = console.log
const originalConsoleError = console.error
const originalConsoleWarn = console.warn

console.log = function(...args) {
  originalConsoleLog.apply(console, args)
  if (process.env.VERCEL_LOG_ENDPOINT) {
    forwardLogToVercel('info', args.join(' '), { args: args.length > 1 ? args.slice(1) : [] })
  }
}

console.error = function(...args) {
  originalConsoleError.apply(console, args)
  if (process.env.VERCEL_LOG_ENDPOINT) {
    forwardLogToVercel('error', args.join(' '), { args: args.length > 1 ? args.slice(1) : [] })
  }
}

console.warn = function(...args) {
  originalConsoleWarn.apply(console, args)
  if (process.env.VERCEL_LOG_ENDPOINT) {
    forwardLogToVercel('warn', args.join(' '), { args: args.length > 1 ? args.slice(1) : [] })
  }
}

const app = express()
const httpServer = createServer(app)
// CORS configuration - allow localhost and local network IPs for development
// Production: Add CLIENT_URL environment variable (e.g., https://yourdomain.vercel.app)
const allowedOrigins = [
  /^http:\/\/localhost:3000$/,
  /^http:\/\/127\.0\.0\.1:3000$/,
  /^http:\/\/192\.168\.\d+\.\d+:3000$/, // 192.168.x.x
  /^http:\/\/10\.\d+\.\d+\.\d+:3000$/,  // 10.x.x.x
  /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:3000$/, // 172.16-31.x.x
  /^https:\/\/.*\.vercel\.app$/, // Vercel deployments
  /^https:\/\/.*\.vercel\.app\/.*$/ // Vercel deployments with paths
]

// Add production client URL from environment variable if provided
if (process.env.CLIENT_URL) {
  // If CLIENT_URL is a string, add it as a regex pattern
  if (typeof process.env.CLIENT_URL === 'string') {
    // Escape special regex characters and create a pattern
    const escaped = process.env.CLIENT_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    allowedOrigins.push(new RegExp(`^${escaped}$`))
  } else {
    allowedOrigins.push(process.env.CLIENT_URL)
  }
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
// Only returns 192.168.x.x addresses (for localhost development)
// Returns null if no 192.168.x.x address is found
function getLocalNetworkIP() {
  const interfaces = os.networkInterfaces()
  
  // Only look for 192.168.x.x addresses
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Only return 192.168.x.x addresses
        if (/^192\.168\./.test(iface.address)) {
          return iface.address
        }
      }
    }
  }
  
  return null
}

// Health check endpoint - returns server uptime and system status
const serverStartTime = Date.now()
app.get('/health', async (req, res) => {
  const uptime = Date.now() - serverStartTime
  const uptimeSeconds = Math.floor(uptime / 1000)
  const uptimeMinutes = Math.floor(uptimeSeconds / 60)
  const uptimeHours = Math.floor(uptimeMinutes / 60)
  const uptimeDays = Math.floor(uptimeHours / 24)
  
  // Get stats from in-memory state (no database needed)
  let activeRooms = 0
  let activePlayers = 0
  
  // Count active rooms and players from in-memory rooms
  for (const room of rooms.values()) {
    if (room.players.size > 0) {
      activeRooms++
      activePlayers += room.players.size
    }
  }
  
  // Get socket connection stats
  const socketStats = {
    totalConnections: io.sockets.sockets.size,
    activeRooms: rooms.size
  }
  
  // Get Render service info (if available)
  const renderInfo = {
    serviceName: process.env.RENDER_SERVICE_NAME || 'multiplayer-arcade-server',
    environment: process.env.NODE_ENV || 'production',
    region: process.env.RENDER_REGION || 'unknown'
  }
  
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
    timestamp: new Date().toISOString(),
    rooms: {
      activeRooms,
      activePlayers,
      totalRooms: rooms.size
    },
    sockets: socketStats,
    render: renderInfo,
    environment: {
      nodeVersion: process.version,
      platform: process.platform
    }
  })
})

// API routes for Pong game state
app.use('/api', gameStateRouter)
// API routes for debug logs
app.use('/api/debug', debugLogsRouter)

// API endpoint to get server connection info
app.get('/api/connection-info', (req, res) => {
  try {
    const networkIP = getLocalNetworkIP() // Only returns 192.168.x.x or null
    const frontendPort = 3000 // Frontend port (where users connect)
    res.json({
      hostname: networkIP || null, // Only 192.168.x.x, no localhost fallback
      port: frontendPort,
      url: networkIP ? `${networkIP}:${frontendPort}` : null
    })
  } catch (error) {
    console.error('[API] Error getting connection info:', error)
    res.status(500).json({ error: error.message })
  }
})

// Store active game rooms (in-memory for real-time state)
const rooms = new Map()

// Store active user profile sessions (in-memory)
const activeSessions = new Set()

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
// Refreshes player emoji/color from database to ensure latest values
async function emitRoomSnapshot(room) {
  if (!room) {
    if (DEBUG_LOGGING) {
      console.log('[DEBUG] [EMIT-SNAPSHOT] Room is null/undefined, cannot emit')
    }
    return
  }
  
  const players = Array.from(room.players.values())
  
  // Refresh player emoji/color from database (source of truth)
  // This ensures snapshots always have the latest values even if room was created with stale data
  // ALWAYS fetch from NoCodeBackend - NO FALLBACKS to in-memory data
  const playersWithFreshData = await Promise.all(players.map(async (p) => {
    try {
      const userProfile = await getProfile(p.userProfileId)
      if (userProfile) {
        // ALWAYS use NCB database values - NO FALLBACKS to in-memory values, NO INDEX-BASED LOOKUPS
        // Handle both camelCase and PascalCase field names from API
        // If NCB doesn't have the value, use default - NEVER use p.emoji, p.color, or color_id index
        const dbEmoji = (userProfile.emoji !== null && userProfile.emoji !== undefined && userProfile.emoji !== '') 
          ? userProfile.emoji 
          : ((userProfile.Emoji !== null && userProfile.Emoji !== undefined && userProfile.Emoji !== '')
            ? userProfile.Emoji
            : '⚪')
        const dbColor = (userProfile.color !== null && userProfile.color !== undefined && userProfile.color !== '')
          ? userProfile.color
          : ((userProfile.Color !== null && userProfile.Color !== undefined && userProfile.Color !== '')
            ? userProfile.Color
            : '#FFFFFF')
        
        // Log if values changed from in-memory
        if (p.emoji !== dbEmoji || p.color !== dbColor) {
          console.log(`[EMIT-SNAPSHOT] Refreshed player ${p.userProfileId} (${p.name}) from NCB - emoji: ${p.emoji} -> ${dbEmoji}, color: ${p.color} -> ${dbColor}`)
        }
        
        // Update in-memory player data with fresh database values
        p.emoji = dbEmoji
        p.color = dbColor
        
        return {
          userProfileId: p.userProfileId,
          socketId: p.socketId,
          name: p.name,
          score: p.score || 0,
          ready: p.ready || false,
          color: dbColor,
          emoji: dbEmoji,
          colorId: p.colorId,
          profileName: p.profileName,
          profileCreatedAt: p.profileCreatedAt,
          profileLastSeen: p.profileLastSeen
        }
      } else {
        // Profile not found in NCB - use defaults, NOT in-memory values
        console.warn(`[EMIT-SNAPSHOT] Profile ${p.userProfileId} not found in NCB, using defaults`)
        const defaultEmoji = '⚪'
        const defaultColor = '#FFFFFF'
        p.emoji = defaultEmoji
        p.color = defaultColor
        return {
          userProfileId: p.userProfileId,
          socketId: p.socketId,
          name: p.name,
          score: p.score || 0,
          ready: p.ready || false,
          color: defaultColor,
          emoji: defaultEmoji,
          colorId: p.colorId,
          profileName: p.profileName,
          profileCreatedAt: p.profileCreatedAt,
          profileLastSeen: p.profileLastSeen
        }
      }
    } catch (error) {
      // Error fetching from NCB - use defaults, NOT in-memory values
      console.error(`[EMIT-SNAPSHOT] Error refreshing profile ${p.userProfileId} from NCB:`, error)
      const defaultEmoji = '⚪'
      const defaultColor = '#FFFFFF'
      p.emoji = defaultEmoji
      p.color = defaultColor
      return {
        userProfileId: p.userProfileId,
        socketId: p.socketId,
        name: p.name,
        score: p.score || 0,
        ready: p.ready || false,
        color: defaultColor,
        emoji: defaultEmoji,
        colorId: p.colorId,
        profileName: p.profileName,
        profileCreatedAt: p.profileCreatedAt,
        profileLastSeen: p.profileLastSeen
      }
    }
  }))
  
  const snapshot = {
    roomId: room.id,
    hostUserProfileId: room.hostUserProfileId,
    status: room.gameState?.state || 'waiting',
    selectedGame: room.gameState?.selectedGame || null,
    players: playersWithFreshData
  }
  
  if (DEBUG_LOGGING) {
    console.log('[DIAG] [SERVER] [EMIT-SNAPSHOT] Emitting room-snapshot', {
      roomId: room.id,
      roomIdType: typeof room.id,
      playersCount: players.length,
      snapshotRoomId: snapshot.roomId,
      snapshotRoomIdType: typeof snapshot.roomId,
      timestamp: Date.now()
    })
    
    const roomAdapter = io.sockets.adapter.rooms.get(room.id)
    const socketsInRoom = roomAdapter ? Array.from(roomAdapter) : []
    console.log(`[DEBUG] [EMIT-SNAPSHOT] Sockets in room ${room.id} before snapshot emit:`, {
      roomId: room.id,
      socketCount: socketsInRoom.length,
      socketIds: socketsInRoom,
      playersInSnapshot: snapshot.players.map(p => ({ userProfileId: p.userProfileId, name: p.name, socketId: p.socketId })),
      timestamp: Date.now()
    })
  }
  
  // CRITICAL: Use io.to() NOT socket.to() - this broadcasts to ALL sockets in the room
  // socket.to() would exclude the sender, but we want EVERYONE in the room to receive updates
  // This ensures the host and all other players see player list changes in real-time
  io.to(room.id).emit('room-snapshot', snapshot)
  
  if (DEBUG_LOGGING) {
    console.log(`[DEBUG] [EMIT-SNAPSHOT] room-snapshot emitted to room ${room.id}`)
    console.log(`[SOCKET] Emitted room-snapshot for room ${room.id} with ${players.length} players:`, players.map(p => `${p.name} (${p.userProfileId})`))
  }
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
            // Host not in memory - use default values
            hostName = 'Unknown'
            hostEmoji = '👤'
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
    
    // Rooms are in-memory only - no database queries needed
    const allRooms = memoryRooms
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
    
    // Find all active players from in-memory rooms
    const activePlayers = []
    for (const [roomId, room] of rooms.entries()) {
      for (const [userProfileId, player] of room.players.entries()) {
        activePlayers.push({
          id: userProfileId,
          socket_id: player.socketId,
          room_id: roomId,
          user_profile_id: userProfileId,
          last_activity: room.lastActivity
        })
      }
    }
    
    let cleanedCount = 0
    for (const player of activePlayers) {
      // Check if player is stale based on room's last activity or player's join time
      const lastActivity = player.last_activity ? new Date(player.last_activity) : new Date(player.joined_at)
      
      if (lastActivity < staleThreshold) {
        // Player is stale - mark as left
        // Player data stored in-memory only (no database persistence)
        
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
            // Room state stored in-memory only (no database persistence)
            invalidateEndedRoomsCache(player.room_id)
            console.log(`[CLEANUP] Room ${player.room_id} deleted (empty after cleanup)`)
          }
        }
        
        // Log the cleanup
        // Game events no longer persisted (match results saved to NoCodeBackend)
      // dbHelpers.addGameEvent(player.room_id, player.id, 'player_left_stale', { reason: 'inactivity_timeout' })
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

// Refresh ended room IDs cache periodically (no longer needed - rooms are in-memory only)
// Cache is now maintained by invalidateEndedRoomsCache() when rooms end
setInterval(() => {
  try {
    // Ended rooms cache no longer needed (rooms are in-memory only)
    // Just clear the cache periodically since rooms are ephemeral
    endedRoomIdsCache.clear()
    endedRoomIdsCacheTime = Date.now()
  } catch (error) {
    console.error('[CACHE] Error refreshing ended rooms cache:', error)
  }
}, ENDED_ROOMS_CACHE_TTL)

// Clean up very old ended rooms (no longer needed - rooms are in-memory only and cleaned up immediately)
// Rooms are automatically cleaned up when empty, so no periodic cleanup needed
// Removed periodic cleanup interval - rooms are in-memory only and cleaned up immediately when empty

io.on('connection', (socket) => {
  if (DEBUG_LOGGING) {
    console.log('Player connected:', socket.id)
  }
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
  socket.on('create-room', async ({ playerName, userProfileId, colorId, emoji, color }) => {
    try {
      if (DEBUG_LOGGING) {
        console.log('[DIAG] [SERVER] [CREATE-ROOM] Step A: Received create-room', {
          socketId: socket.id,
          playerName: playerName,
          userProfileId: userProfileId,
          emoji: emoji,
          color: color,
          timestamp: Date.now()
        })
      }
      
      const roomId = generateRoomId()
    
    const name = playerName?.trim() || `Player ${Math.floor(Math.random() * 1000)}`
    
    // Get user profile from NoCodeBackend (profiles are created client-side)
    if (!userProfileId) {
      console.log(`[SOCKET] Cannot create room without userProfileId`)
      socket.emit('room-error', { message: 'User profile required to create room' })
      return
    }
    
    let userProfile = null
    try {
      userProfile = await getProfile(userProfileId)
    } catch (error) {
      console.error(`[SOCKET] Error fetching profile ${userProfileId}:`, error)
    }
    
    if (!userProfile) {
      console.log(`[SOCKET] Profile ${userProfileId} not found in NoCodeBackend`)
      socket.emit('room-error', { message: 'User profile not found. Please create a profile first.' })
      return
    }
    
    // ALWAYS use emoji and color from NoCodeBackend database - NO FALLBACKS, NO INDEX-BASED LOOKUPS
    // Ignore client-sent values completely - NEVER use color_id to look up emoji/color
    // Handle both camelCase and PascalCase field names from API
    const finalEmoji = (userProfile.emoji !== null && userProfile.emoji !== undefined && userProfile.emoji !== '')
      ? userProfile.emoji
      : ((userProfile.Emoji !== null && userProfile.Emoji !== undefined && userProfile.Emoji !== '')
        ? userProfile.Emoji
        : '⚪')
    const finalColor = (userProfile.color !== null && userProfile.color !== undefined && userProfile.color !== '')
      ? userProfile.color
      : ((userProfile.Color !== null && userProfile.Color !== undefined && userProfile.Color !== '')
        ? userProfile.Color
        : '#FFFFFF')
    console.log(`[CREATE-ROOM] Profile ${userProfile.id} from NCB - emoji: ${finalEmoji}, color: ${finalColor}, color_id: ${userProfile.color_id} (NOT using color_id)`)
      // Game events no longer persisted (rooms are in-memory only)
    
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
      color: finalColor, // Use NoCodeBackend color
      emoji: finalEmoji, // Use NoCodeBackend emoji
      colorId: userProfile.color_id,
      profileName: userProfile.name,
      profileCreatedAt: userProfile.created_at,
      profileLastSeen: userProfile.last_seen
    }
    room.players.set(userProfile.id, playerData)
    room.socketIds.set(userProfile.id, socket.id)
    
    // Room and player data stored in-memory only (no database persistence)
    
    rooms.set(roomId, room)
    socket.join(roomId)
    socket.leave('LOBBY')
    
    if (DEBUG_LOGGING) {
      console.log(`[SOCKET] Room ${roomId} created by ${socket.id} (${name}, profile: ${userProfile.id}) with emoji ${finalEmoji}. Total rooms in memory: ${rooms.size}`)
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
    }
    
    socket.emit('room-created', { 
      roomId, 
      players: Array.from(room.players.values()),
      hostUserProfileId: room.hostUserProfileId // Include host profile ID
    })
    
    // Emit canonical room snapshot
    if (DEBUG_LOGGING) {
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
    }
    
    emitRoomSnapshot(room).catch(err => console.error('[EMIT-SNAPSHOT] Error:', err))
    
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
  socket.on('join-room', async ({ roomId, playerName, userProfileId, colorId, emoji, color }) => {
    try {
      if (DEBUG_LOGGING) {
        console.log('[DIAG] [SERVER] [JOIN-ROOM] Step A: Received join-room', {
          socketId: socket.id,
          roomId: roomId,
          roomIdType: typeof roomId,
          userProfileId: userProfileId,
          emoji: emoji,
          color: color,
          timestamp: Date.now()
        })
      }
      addServerEventLog(`Join room request from ${socket.id}: roomId=${roomId}, playerName=${playerName || 'none'}, userProfileId=${userProfileId || 'none'}`, 'info', { socketId: socket.id, roomId, playerName, userProfileId, colorId, emoji, color })
      
      // Get in-memory room (rooms are ephemeral and only exist while players are connected)
      let room = rooms.get(roomId)
      if (!room) {
        console.log(`[SOCKET] Room ${roomId} not found (rooms are in-memory only)`)
        socket.emit('room-error', { message: 'Room not found. Rooms are only active while players are connected.' })
        return
      }
      
      // Log current state
      if (DEBUG_LOGGING) {
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
      
      // Get user profile from NoCodeBackend (profiles are created client-side)
      if (!userProfileId) {
        console.log(`[SOCKET] Cannot join room without userProfileId`)
        socket.emit('room-error', { message: 'User profile required to join room' })
        return
      }
      
      let userProfile = null
      try {
        userProfile = await getProfile(userProfileId)
        console.log(`[JOIN-ROOM] Raw profile from database for ${userProfileId}:`, JSON.stringify(userProfile, null, 2))
        console.log(`[JOIN-ROOM] Profile fields - emoji: ${userProfile.emoji}, Emoji: ${userProfile.Emoji}, color: ${userProfile.color}, Color: ${userProfile.Color}, color_id: ${userProfile.color_id}, colorId: ${userProfile.colorId}`)
      } catch (error) {
        console.error(`[SOCKET] Error fetching profile ${userProfileId}:`, error)
      }
      
      if (!userProfile) {
        console.log(`[SOCKET] Profile ${userProfileId} not found in NoCodeBackend`)
        socket.emit('room-error', { message: 'User profile not found. Please create a profile first.' })
        return
      }
      
      // ALWAYS use emoji and color from NoCodeBackend database - NO FALLBACKS, NO INDEX-BASED LOOKUPS
      // Handle both camelCase and PascalCase field names from API
      // If NCB doesn't have the value, use default - NEVER use in-memory, client-sent, or color_id index values
      const finalEmoji = (userProfile.emoji !== null && userProfile.emoji !== undefined && userProfile.emoji !== '') 
        ? userProfile.emoji 
        : ((userProfile.Emoji !== null && userProfile.Emoji !== undefined && userProfile.Emoji !== '')
          ? userProfile.Emoji
          : '⚪')
      const finalColor = (userProfile.color !== null && userProfile.color !== undefined && userProfile.color !== '')
        ? userProfile.color
        : ((userProfile.Color !== null && userProfile.Color !== undefined && userProfile.Color !== '')
          ? userProfile.Color
          : '#FFFFFF')
      console.log(`[JOIN-ROOM] Profile ${userProfile.id} (${userProfile.name || userProfile.Name}) from NCB - emoji: ${finalEmoji}, color: ${finalColor}`)
      console.log(`[JOIN-ROOM] Client sent - emoji: ${emoji}, color: ${color} (completely ignored, using NCB only)`)
      console.log(`[JOIN-ROOM] NOT using color_id (${userProfile.color_id || userProfile.colorId}) - using emoji/color fields directly`)
      
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
          // Player data stored in-memory only (no database persistence)
        }
        // Update socket mapping and emoji/color from NoCodeBackend database (source of truth)
        existingPlayer.socketId = socket.id
        existingPlayer.emoji = finalEmoji
        existingPlayer.color = finalColor
        room.socketIds.set(userProfile.id, socket.id)
        console.log(`[JOIN-ROOM] Updated existing player ${userProfile.id} (${userProfile.name}) with emoji: ${finalEmoji}, color: ${finalColor}`)
      } else {
        // New player joining
        console.log(`[SOCKET] Adding new player ${userProfile.id} to room ${roomId}`)
        const playerData = {
          userProfileId: userProfile.id,
          socketId: socket.id,
          name: name,
          score: 0,
          ready: false,
          color: finalColor,
          emoji: finalEmoji,
          profileName: userProfile.name,
          profileCreatedAt: userProfile.createdAt || userProfile.created_at || null,
          profileLastSeen: userProfile.lastSeen || userProfile.last_seen || null
        }
        room.players.set(userProfile.id, playerData)
        room.socketIds.set(userProfile.id, socket.id)
        if (DEBUG_LOGGING) {
          console.log(`[DIAG] [SERVER] New player added to room.players Map:`, {
            userProfileId: userProfile.id,
            name: name,
            roomPlayersCount: room.players.size,
            allPlayerKeys: Array.from(room.players.keys()),
            allPlayers: Array.from(room.players.values()).map(p => ({ userProfileId: p.userProfileId, name: p.name })),
            timestamp: Date.now()
          })
        }
      }
      
      if (DEBUG_LOGGING) {
        console.log('[DIAG] [SERVER] [JOIN-ROOM] Step B: Player added to room', {
          roomId: roomId,
          roomIdType: typeof roomId,
          playersCount: room.players.size,
          joiningUserProfileId: userProfile.id,
          allPlayerKeys: Array.from(room.players.keys()),
          allPlayers: Array.from(room.players.values()).map(p => ({ userProfileId: p.userProfileId, name: p.name })),
          timestamp: Date.now()
        })
      }
      
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
        emitRoomSnapshot(room).catch(err => console.error('[EMIT-SNAPSHOT] Error:', err))
      }
      // Game events no longer persisted (match results saved to NoCodeBackend)
      // dbHelpers.addGameEvent(roomId, playerId, 'player_joined', { playerName: name, emoji: finalEmoji })
      // Room activity no longer persisted (rooms are in-memory only)
      
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
      
      if (DEBUG_LOGGING) {
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
      }
      
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
      
      // Emit canonical room snapshot after any join
      if (DEBUG_LOGGING) {
      console.log(`[SOCKET] Broadcasted player-joined to all players in room ${roomId} (including host)`)
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
      }
      
      // Await snapshot to ensure database refresh completes before emitting
      await emitRoomSnapshot(room).catch(err => console.error('[EMIT-SNAPSHOT] Error:', err))
      
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
      
      console.log(`Player ${socket.id} (${name}) joined room ${roomId} with emoji ${finalEmoji}`)
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
      // Player data stored in-memory only (no database persistence)
      // Game events no longer persisted (match results saved to NoCodeBackend)
      // dbHelpers.addGameEvent(roomId, userProfileId, 'player_name_updated', { playerName: name })
      // Room activity no longer persisted (rooms are in-memory only)
      
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
    // Game events no longer persisted (match results saved to NoCodeBackend)
    
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
    // Game events no longer persisted (match results saved to NoCodeBackend)
    
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
    
    // Room activity no longer persisted (rooms are in-memory only)
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
        // Player data stored in-memory only (no database persistence)
        // Game events no longer persisted (match results saved to NoCodeBackend)
      // dbHelpers.addGameEvent(roomId, userProfileId, 'microgame_end', { roundScore }, player.score)
      }
    }
    
    // Room activity no longer persisted (rooms are in-memory only)
    
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
    // Game events no longer persisted (match results saved to NoCodeBackend)
    
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

  // Handle ping for latency measurement
  socket.on('pong-ping', ({ timestamp }) => {
    // Echo back the timestamp immediately for RTT calculation
    socket.emit('pong-pong', { timestamp })
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
      // Room state stored in-memory only (no database persistence)
    }
    // Game events no longer persisted (match results saved to NoCodeBackend)
    
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
    // Game events no longer persisted (match results saved to NoCodeBackend)
    
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
    emitRoomSnapshot(room).catch(err => console.error('[EMIT-SNAPSHOT] Error:', err))
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
    emitRoomSnapshot(room).catch(err => console.error('[EMIT-SNAPSHOT] Error:', err))
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
      // Game events no longer persisted (match results saved to NoCodeBackend)
      // dbHelpers.addGameEvent(roomId, userProfileId, 'player_ready', {})
    } else {
      // Use optional chaining to safely delete
      room.readyPlayers?.delete(userProfileId)
      // Game events no longer persisted (match results saved to NoCodeBackend)
      // dbHelpers.addGameEvent(roomId, userProfileId, 'player_unready', {})
      
      // Cancel countdown if player unreadies
      if (room.countdownInterval) {
        clearInterval(room.countdownInterval)
        room.countdownInterval = null
        room.countdownSeconds = null
        io.to(roomId).emit('countdown-cancelled', {})
      }
    }
    
    // Room activity no longer persisted (rooms are in-memory only)
    
    // Broadcast updated ready status to all players
    const playersArray = Array.from(room.players.values())
    io.to(roomId).emit('players-ready-updated', {
      players: playersArray,
      allReady: room.readyPlayers.size === room.players.size && room.players.size >= 2,
      hostUserProfileId: room.hostUserProfileId // Include host profile ID
    })
    
    // Emit canonical room snapshot after ready status change
    emitRoomSnapshot(room).catch(err => console.error('[EMIT-SNAPSHOT] Error:', err))
    
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
    // Game events no longer persisted (match results saved to NoCodeBackend)
    // Room state stored in-memory only (no database persistence)
    
    // Update in-memory room gameState to 'playing'
    if (!room.gameState) {
      room.gameState = {}
    }
    room.gameState.state = 'playing'
    
    // Emit room snapshot with updated status
    emitRoomSnapshot(room).catch(err => console.error('[EMIT-SNAPSHOT] Error:', err))
    
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
      emitRoomSnapshot(room).catch(err => console.error('[EMIT-SNAPSHOT] Error:', err))
      
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
      
      emitRoomSnapshot(room).catch(err => console.error('[EMIT-SNAPSHOT] Error:', err))
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
    // Room activity no longer persisted (rooms are in-memory only)
    
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
      // Player data stored in-memory only (no database persistence)
      // Game events no longer persisted (match results saved to NoCodeBackend)
      // dbHelpers.addGameEvent(roomId, userProfileId, 'score_update', null, score)
    }
    
    // Room activity no longer persisted (rooms are in-memory only)
    
    // Broadcast to all players
    io.to(roomId).emit('score-update', {
      userProfileId: userProfileId,
      score
    })
  })

  // Shared function for handling player leave logic (reversed order: Broadcast → Socket.IO → Database → Map)
  const handlePlayerLeave = (socket, roomId, reason = 'explicit_leave', isDisconnected = false) => {
    const room = rooms.get(roomId)
    
    // If room not in memory, it doesn't exist (rooms are ephemeral)
    if (!room) {
      console.log(`[${reason.toUpperCase()}] Room ${roomId} not found (rooms are in-memory only)`)
      if (!isDisconnected && socket.connected) {
        socket.emit('room-error', { message: 'Room not found. Rooms are only active while players are connected.' })
      }
      return false
    }
    
    // Room is in memory - find player by socket ID
    const userProfileId = findUserProfileIdBySocket(room, socket.id)
    if (!userProfileId || !room.players.has(userProfileId)) {
      console.log(`[${reason.toUpperCase()}] Player ${socket.id} not in room ${roomId} players map`)
      return false
    }
    
    const leavingPlayer = room.players.get(userProfileId)
    if (!leavingPlayer) {
      console.log(`[${reason.toUpperCase()}] Player ${socket.id} not found in room ${roomId}`)
      if (!isDisconnected && socket.connected) {
        socket.emit('room-error', { message: 'You are not in this room' })
      }
      return false
    }
    
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
      emitRoomSnapshot(room).catch(err => console.error('[EMIT-SNAPSHOT] Error:', err))
      
      // Remove from Socket.IO room namespace
      if (!isDisconnected) {
        socket.leave(roomId)
        // Rejoin LOBBY to receive room list updates
        socket.join('LOBBY')
      }
      
      // Update database (mark player as left by userProfileId)
      // Player data stored in-memory only (no database persistence)
      // Game events no longer persisted (match results saved to NoCodeBackend)
      // dbHelpers.addGameEvent(roomId, userProfileId, 'player_left', { reason: 'host_left_but_room_stays_open' })
      // Room activity no longer persisted (rooms are in-memory only)
      
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
    io.to(roomId).emit('player-left', playerLeftPayload)
    
    if (DEBUG_LOGGING) {
      console.log(`[DEBUG] [${reason.toUpperCase()}] player-left payload:`, JSON.stringify(playerLeftPayload, null, 2))
      console.log(`[DEBUG] [${reason.toUpperCase()}] player-left event emitted to room ${roomId}`)
    }
    
    // Step 4: Emit canonical room snapshot AFTER removing player from Map (so snapshot is correct)
    // CRITICAL: Must emit BEFORE socket.leave() so all remaining players (including host) receive the update
    // emitRoomSnapshot uses io.to(roomId).emit() which broadcasts to ALL sockets in the room
    // DOUBLE-CHECK: Verify room state is correct before emitting
    const snapshotPlayerCount = room.players.size
    if (snapshotPlayerCount !== remainingPlayers.length) {
      console.error(`[${reason.toUpperCase()}] CRITICAL: Snapshot will have wrong player count! room.players.size=${snapshotPlayerCount}, remainingPlayers.length=${remainingPlayers.length}`)
    }
    if (DEBUG_LOGGING) {
      console.log(`[DEBUG] [${reason.toUpperCase()}] About to emit room-snapshot for room ${roomId} with ${snapshotPlayerCount} players in room Map`)
    }
    emitRoomSnapshot(room).catch(err => console.error('[EMIT-SNAPSHOT] Error:', err))
    addServerEventLog(`Emitted room-snapshot to room ${roomId} after player leave`, 'info', { roomId, remainingPlayerCount: room.players.size, leavingUserProfileId: userProfileId, reason })
    
    // DEBUG: Check which sockets are still in the room after emitting
    const roomAdapterAfter = io.sockets.adapter.rooms.get(roomId)
    const socketsInRoomAfter = roomAdapterAfter ? Array.from(roomAdapterAfter) : []
    if (DEBUG_LOGGING) {
      console.log(`[DEBUG] [${reason.toUpperCase()}] Sockets in room ${roomId} after emits (before socket.leave):`, {
        roomId,
        socketCount: socketsInRoomAfter.length,
        socketIds: socketsInRoomAfter,
        timestamp: Date.now()
      })
    }
    
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
    // Player data stored in-memory only (no database persistence)
    // Game events no longer persisted (match results saved to NoCodeBackend)
    // Room activity no longer persisted (rooms are in-memory only)
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
      // Room state stored in-memory only (no database persistence)
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
      emitRoomSnapshot(room).catch(err => console.error('[EMIT-SNAPSHOT] Error:', err))
      console.log(`[SOCKET] Emitted room-snapshot after kicking player ${targetUserProfileId} from room ${roomId}`)
      
      // Update database
      // Player data stored in-memory only (no database persistence)
      // Game events no longer persisted (match results saved to NoCodeBackend)
      // dbHelpers.addGameEvent(roomId, targetUserProfileId, 'player_kicked', { kickedBy: requesterUserProfileId })
      // Room activity no longer persisted (rooms are in-memory only)
      
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
      if (DEBUG_LOGGING) {
        console.log('Player disconnected:', socket.id)
      }
      addServerEventLog(`Player disconnected: ${socket.id}`, 'info', { socketId: socket.id })
    
    // Update user count when someone disconnects
    // Use setImmediate to ensure socket is fully removed from the set
    setImmediate(() => {
      const count = io.sockets.sockets.size
      io.emit('user-count-update', { count })
      console.log(`[SOCKET] User count updated after disconnect: ${count} total users`)
      addServerEventLog(`User count updated after disconnect: ${count} total users`, 'info', { count })
    })
    
    // Clean up socket from any rooms it might be in (in-memory only)
    // Find which room this socket is in by checking all rooms
    let roomId = null
    for (const [rId, room] of rooms.entries()) {
      for (const [userProfileId, player] of room.players.entries()) {
        if (player.socketId === socket.id) {
          roomId = rId
          break
        }
      }
      if (roomId) break
    }
    
    if (roomId) {
      console.log(`[DISCONNECT] Cleaning up disconnected socket ${socket.id} from room ${roomId}`)
      addServerEventLog(`Cleaning up disconnected socket ${socket.id}`, 'info', { socketId: socket.id, roomId })
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
        // Ensure readyPlayers exists (safety check for rooms created before this was added)
        if (!room.readyPlayers) {
          room.readyPlayers = new Set()
        }
        room.readyPlayers.delete(userProfileId)
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
          emitRoomSnapshot(room).catch(err => console.error('[EMIT-SNAPSHOT] Error:', err))
          console.log(`[DISCONNECT] Emitted room-snapshot after host ${userProfileId} disconnected from room ${roomId}`)
          
          // Mark player as left in DB by userProfileId (host will reconnect with new socket)
          // Player data stored in-memory only (no database persistence)
          // Game events no longer persisted (match results saved to NoCodeBackend)
      // dbHelpers.addGameEvent(roomId, userProfileId, 'player_left', null)
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
              
              // Players removed from in-memory room (no database persistence)
              console.log(`[DISCONNECT] Removed all players from room ${roomId}`)
              
              // Room state stored in-memory only (no database persistence)
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
    // Get active rooms from in-memory Map (real-time data)
    // Get ended room IDs from cache (refresh if stale)
    // Rooms are in-memory only - filter active rooms directly
    const memoryRooms = Array.from(rooms.entries())
      .filter(([roomId, room]) => {
        // Filter out ended rooms (check cache)
        if (endedRoomIdsCache.has(roomId)) {
          if (DEBUG_LOGGING) {
            console.log(`[API] Filtering out ended room from memory: ${roomId}`)
          }
          // Also remove from in-memory Map if it's marked as ended
          rooms.delete(roomId)
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
    
    // Rooms are in-memory only - no database queries needed
    const allActiveRooms = memoryRooms
      .sort((a, b) => b.playerCount - a.playerCount) // Sort by player count (most players first)
    
    if (DEBUG_LOGGING) {
      console.log('[API] Returning', allActiveRooms.length, 'active rooms:', allActiveRooms.map(r => `${r.id} (${r.playerCount} players, ${r.state}, ${r.source})`))
    }
    res.json(allActiveRooms)
  } catch (error) {
    console.error('[API] Error fetching active rooms:', error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/rooms', (req, res) => {
  try {
    // Get all in-memory rooms
    const roomList = Array.from(rooms.values()).map(room => ({
      id: room.id,
      state: room.gameState?.state || 'waiting',
      playerCount: room.players.size,
      hostUserProfileId: room.hostUserProfileId,
      lastActivity: room.lastActivity
    }))
    res.json(roomList)
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
    // Get room from in-memory storage
    const room = rooms.get(roomId)
    if (!room) {
      return res.status(404).json({ error: 'Room not found' })
    }
    const players = Array.from(room.players.values())
    res.json({
      id: room.id,
      state: room.gameState?.state || 'waiting',
      playerCount: players.length,
      players
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/rooms/:roomId/players', (req, res) => {
  try {
    const { roomId } = req.params
    const room = rooms.get(roomId)
    if (!room) {
      return res.status(404).json({ error: 'Room not found' })
    }
    const players = Array.from(room.players.values())
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
    
    // Get user profile from NoCodeBackend
    if (!userProfileId) {
      return res.status(400).json({ error: 'userProfileId is required' })
    }
    
    let userProfile = null
    try {
      userProfile = await getProfile(userProfileId)
    } catch (error) {
      console.error(`[API] Error fetching profile ${userProfileId}:`, error)
    }
    
    if (!userProfile) {
      return res.status(404).json({ error: 'User profile not found. Please create a profile first.' })
    }
    
    // ALWAYS use emoji and color from NoCodeBackend database - NO FALLBACKS
    // Ignore client-sent values completely
    // Handle both camelCase and PascalCase field names from API
    const finalEmoji = (userProfile.emoji !== null && userProfile.emoji !== undefined)
      ? userProfile.emoji
      : ((userProfile.Emoji !== null && userProfile.Emoji !== undefined)
        ? userProfile.Emoji
        : '⚪')
    const finalColor = (userProfile.color !== null && userProfile.color !== undefined)
      ? userProfile.color
      : ((userProfile.Color !== null && userProfile.Color !== undefined)
        ? userProfile.Color
        : '#FFFFFF')
    
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
      color: finalColor,
      emoji: finalEmoji,
      message: 'Room created successfully. Connect via Socket.IO to join.'
    })
  } catch (error) {
    console.error(`[API] Error creating room via REST API:`, error)
    res.status(500).json({ error: error.message || 'Failed to create room' })
  }
})

app.get('/api/rooms/:roomId/history', (req, res) => {
  try {
    // Game history no longer persisted (match results saved to NoCodeBackend)
    res.json([])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/history', (req, res) => {
  try {
    // Game history no longer persisted (match results saved to NoCodeBackend)
    res.json([])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/stats', (req, res) => {
  try {
    // Get stats from in-memory rooms only
    const allRooms = Array.from(rooms.values())
    let totalPlayers = 0
    for (const room of allRooms) {
      totalPlayers += room.players.size
    }
    
    const stats = {
      totalRooms: allRooms.length,
      activeRooms: allRooms.length, // All in-memory rooms are active
      totalPlayers: totalPlayers,
      totalEvents: 0, // Game events no longer persisted
      eventTypes: {},
      recentRooms: allRooms.slice(0, 10).map(r => ({
        id: r.id,
        playerCount: r.players.size,
        state: r.gameState?.state || 'waiting'
      })),
      topScores: [] // Scores no longer persisted
    }
    
    // Event types no longer tracked (game events not persisted)
    
    res.json(stats)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/tables', (req, res) => {
  try {
    // Database tables no longer exist - using NoCodeBackend and in-memory storage
    res.json([])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/player-colors', (req, res) => {
  try {
    // Player colors are handled client-side (see src/utils/playerColors.js)
    // Return empty array - colors are assigned client-side from NoCodeBackend profiles
    res.json([])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/player-colors/:index', (req, res) => {
  try {
    // Player colors are handled client-side (see src/utils/playerColors.js)
    res.status(404).json({ error: 'Color not found. Colors are assigned client-side.' })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/players', (req, res) => {
  try {
    // Get all players from in-memory rooms
    const allPlayers = []
    
    for (const room of rooms.values()) {
      for (const player of room.players.values()) {
        allPlayers.push({
          id: player.userProfileId,
          name: player.name,
          roomId: room.id,
          roomState: room.gameState?.state || 'waiting',
          score: player.score || 0,
          emoji: player.emoji || '⚪',
          color: player.color || '#FFFFFF'
        })
      }
    }
    
    res.json({
      total: allPlayers.length,
      players: allPlayers
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Debug endpoint to see active_sessions (in-memory)
app.get('/api/debug/active-sessions', (req, res) => {
  try {
    // Get active sessions from in-memory storage
    const sessionArray = Array.from(activeSessions).map(profileId => ({
      user_profile_id: profileId
    }))
    
    res.json({
      count: sessionArray.length,
      sessions: sessionArray
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/user-profiles', async (req, res) => {
  try {
    // Get all profiles from NoCodeBackend
    const ncbProfiles = await getAllProfiles()
    
    // Get active profile IDs from in-memory rooms
    const activeProfileIdsFromRooms = new Set()
    for (const room of rooms.values()) {
      for (const player of room.players.values()) {
        if (player.userProfileId) {
          activeProfileIdsFromRooms.add(player.userProfileId)
        }
      }
    }
    
    // Combine with in-memory active sessions
    const activeProfileIds = [...new Set([...Array.from(activeSessions), ...Array.from(activeProfileIdsFromRooms)])]
    
    // Transform and mark as active
    const profilesWithStatus = ncbProfiles.map(p => ({
      id: p.id.toString(),
      name: p.name,
      color: p.color || null,
      emoji: p.emoji || null,
      createdAt: p.createdAt || p.created_at || null,
      lastSeen: p.lastSeen || p.last_seen || null,
      isActive: activeProfileIds.includes(p.id.toString())
    }))
    
    res.json({
      total: profilesWithStatus.length,
      profiles: profilesWithStatus,
      activeProfileIds: activeProfileIds
    })
  } catch (error) {
    console.error('[API] Error fetching profiles:', error)
    res.status(500).json({ error: error.message })
  }
})

// Get all active profiles with details about why they're active
// MUST come before /api/user-profiles/:profileId to avoid route conflicts
app.get('/api/user-profiles/active', async (req, res) => {
  try {
    // Get all profiles from NoCodeBackend to get names
    const allProfiles = await getAllProfiles()
    const profileMap = new Map(allProfiles.map(p => [p.id.toString(), p]))
    
    // Get active profiles from in-memory rooms
    const activeProfilesMap = new Map()
    
    // Add profiles from active sessions
    for (const profileId of activeSessions) {
      const profile = profileMap.get(profileId)
      if (profile) {
        activeProfilesMap.set(profileId, {
          profileId: profileId,
          profileName: profile.name,
          activeReasons: ['session'],
          playerCount: 0,
          roomIds: []
        })
      }
    }
    
    // Add or update profiles from in-memory rooms
    for (const [roomId, room] of rooms.entries()) {
      for (const player of room.players.values()) {
        if (player.userProfileId) {
          const profile = profileMap.get(player.userProfileId)
          if (profile) {
            const existing = activeProfilesMap.get(player.userProfileId)
            if (existing) {
              if (!existing.activeReasons.includes('in_room')) {
                existing.activeReasons.push('in_room')
              }
              existing.playerCount++
              if (!existing.roomIds.includes(roomId)) {
                existing.roomIds.push(roomId)
              }
            } else {
              activeProfilesMap.set(player.userProfileId, {
                profileId: player.userProfileId,
                profileName: profile.name,
                activeReasons: ['in_room'],
                playerCount: 1,
                roomIds: [roomId]
              })
            }
          }
        }
      }
    }
    
    const activeProfiles = Array.from(activeProfilesMap.values())
    
    res.json({
      total: activeProfiles.length,
      profiles: activeProfiles
    })
  } catch (error) {
    console.error('[API] Error fetching active profiles:', error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/user-profiles/:profileId', async (req, res) => {
  try {
    const { profileId } = req.params
    
    // Get profile from NoCodeBackend
    const profile = await getProfile(profileId)
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' })
    }
    
    // Get statistics from match history in NoCodeBackend
    const allMatches = await getAllMatches()
    const profileMatches = allMatches.filter(m => {
      const winnerId = m.WinnerID || m.winnerId
      const loserId = m.LoserID || m.loserId
      return winnerId === profileId || loserId === profileId
    })
    
    // Calculate stats
    const winsByGame = {}
    const roomsSet = new Set()
    let totalScore = 0
    let bestScore = 0
    
    profileMatches.forEach(match => {
      const gameType = match.GameType || match.gameType || 'unknown'
      const winnerId = match.WinnerID || match.winnerId
      const winnerScore = match.WinnerScore || match.winnerScore || 0
      const roomId = match.RoomID || match.roomId
      
      if (roomId) roomsSet.add(roomId)
      
      if (!winsByGame[gameType]) {
        winsByGame[gameType] = {
          wins: 0,
          losses: 0,
          totalScore: 0,
          bestScore: 0
        }
      }
      
      if (winnerId === profileId) {
        winsByGame[gameType].wins++
        winsByGame[gameType].totalScore += winnerScore
        winsByGame[gameType].bestScore = Math.max(winsByGame[gameType].bestScore, winnerScore)
        totalScore += winnerScore
        bestScore = Math.max(bestScore, winnerScore)
      } else {
        winsByGame[gameType].losses++
      }
    })
    
    // Transform to expected format
    const gameStats = {}
    Object.entries(winsByGame).forEach(([gameType, stats]) => {
      gameStats[gameType] = {
        gamesPlayed: stats.wins + stats.losses,
        wins: stats.wins,
        losses: stats.losses,
        bestScore: stats.bestScore,
        totalScore: stats.totalScore
      }
    })
    
    res.json({
      id: profile.id.toString(),
      name: profile.name,
      color: profile.color || null,
      emoji: profile.emoji || null,
      createdAt: profile.createdAt || profile.created_at || null,
      lastSeen: profile.lastSeen || profile.last_seen || null,
      stats: {
        overall: {
          totalRooms: roomsSet.size,
          totalMatches: profileMatches.length,
          totalWins: Object.values(winsByGame).reduce((sum, s) => sum + s.wins, 0),
          bestScore: bestScore,
          totalScore: totalScore
        },
        byGame: gameStats
      }
    })
  } catch (error) {
    console.error('[API] Error fetching profile:', error)
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/user-profiles', async (req, res) => {
  try {
    const { name, color, emoji } = req.body
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' })
    }
    
    // Create profile in NoCodeBackend
    // Color and emoji should be provided by client (handled in src/utils/profiles.js)
    const savedProfile = await saveProfile({
      name: name.trim(),
      color: color || null,
      emoji: emoji || null
    })
    
    res.json({
      id: savedProfile.id.toString(),
      name: savedProfile.name,
      color: savedProfile.color || null,
      emoji: savedProfile.emoji || null
    })
  } catch (error) {
    console.error('[API] Error creating profile:', error)
    res.status(500).json({ error: error.message })
  }
})

// Set active session (when profile is selected) - in-memory only
app.post('/api/user-profiles/:profileId/activate', (req, res) => {
  try {
    const { profileId } = req.params
    activeSessions.add(profileId)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Clear active session (when profile is deselected) - in-memory only
app.post('/api/user-profiles/:profileId/deactivate', (req, res) => {
  try {
    const { profileId } = req.params
    activeSessions.delete(profileId)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/user-profiles/:profileId', async (req, res) => {
  try {
    const { profileId } = req.params
    console.log(`[DELETE] Attempting to delete profile: ${profileId}`)
    
    // Check if profile exists in NoCodeBackend
    const profile = await getProfile(profileId)
    
    if (!profile) {
      console.log(`[DELETE] Profile not found: ${profileId}`)
      return res.status(404).json({ error: 'Profile not found' })
    }
    
    // Check if profile is currently in use in in-memory rooms
    let isInUse = false
    for (const room of rooms.values()) {
      for (const player of room.players.values()) {
        if (player.userProfileId === profileId) {
          isInUse = true
          break
        }
      }
      if (isInUse) break
    }
    
    if (isInUse) {
      console.log(`[DELETE] Profile is in use: ${profileId}`)
      return res.status(400).json({ error: 'Cannot delete profile that is currently in use' })
    }
    
    // Clear active session if exists (in-memory)
    activeSessions.delete(profileId)
    
    // Delete the profile from NoCodeBackend
    const success = await deleteProfile(profileId)
    if (!success) {
      throw new Error('Failed to delete profile from NoCodeBackend')
    }
    
    console.log(`[DELETE] Profile deleted successfully: ${profileId}`)
    res.json({ success: true, message: 'Profile deleted successfully' })
  } catch (error) {
    console.error(`[DELETE] Error deleting profile ${req.params.profileId}:`, error)
    res.status(500).json({ error: error.message || 'Failed to delete profile' })
  }
})


// Force logout a profile (remove from active_sessions and remove from rooms)
app.post('/api/user-profiles/:profileId/force-logout', async (req, res) => {
  try {
    const { profileId } = req.params
    const { markPlayersLeft = true } = req.body
    
    // Check if profile exists in NoCodeBackend
    const profile = await getProfile(profileId)
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' })
    }
    
    // Remove from active_sessions (in-memory)
    activeSessions.delete(profileId)
    
    let playersRemoved = 0
    if (markPlayersLeft) {
      // Remove all players with this profile from in-memory rooms
      for (const [roomId, room] of rooms.entries()) {
        if (room.players.has(profileId)) {
          room.players.delete(profileId)
          room.socketIds.delete(profileId)
          playersRemoved++
          
          // Notify other players
          const playerArray = Array.from(room.players.values())
          io.to(roomId).emit('player-left', {
            playerId: profileId,
            players: playerArray
          })
          
          // Clean up room if empty
          if (room.players.size === 0) {
            rooms.delete(roomId)
          }
        }
      }
      
      res.json({
        success: true,
        message: 'Profile force logged out',
        playersRemoved
      })
    } else {
      res.json({
        success: true,
        message: 'Profile force logged out (session cleared only)'
      })
    }
  } catch (error) {
    console.error(`[FORCE-LOGOUT] Error force logging out profile ${req.params.profileId}:`, error)
    res.status(500).json({ error: error.message || 'Failed to force logout profile' })
  }
})

// Admin endpoint to force close a room (for testing/debugging)
// Also used by host to close room via UI
app.post('/api/admin/close-room/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params
    const { userProfileId } = req.body
    console.log(`[ADMIN] Force closing room ${roomId}`, { userProfileId })
    
    // Get room from in-memory storage
    const room = rooms.get(roomId)
    if (!room) {
      return res.status(404).json({ error: 'Room not found' })
    }
    
    // If userProfileId is provided, verify they are the host
    // If not provided, allow it (for admin/testing purposes)
    if (userProfileId && room.hostUserProfileId) {
      if (String(userProfileId) !== String(room.hostUserProfileId)) {
        console.log(`[ADMIN] User ${userProfileId} attempted to close room ${roomId} but is not host (host: ${room.hostUserProfileId})`)
        return res.status(403).json({ error: 'Only the host can close the room' })
      }
      console.log(`[ADMIN] Host ${userProfileId} closing room ${roomId}`)
    } else if (!userProfileId) {
      console.log(`[ADMIN] Closing room ${roomId} without host verification (admin/test mode)`)
    }
    
    // Get all active players from in-memory room
    const allSocketIds = new Set(Array.from(room.socketIds.values()))
    
    console.log(`[ADMIN] Found ${room.players.size} active players in room`)
    console.log(`[ADMIN] Socket IDs: ${Array.from(allSocketIds)}`)
    
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
    
    // Method 4: Emit to all players in the room (room already retrieved above)
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
    
    // Remove all players from in-memory room
    const playerCount = room.players.size
    room.players.clear()
    room.socketIds.clear()
    console.log(`[ADMIN] Removed ${playerCount} player(s) from room ${roomId}`)
    
    // Room state stored in-memory only (no database persistence)
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
    
    // Get active players from in-memory rooms
    const activePlayers = []
    for (const [rId, room] of rooms.entries()) {
      if (roomId && rId !== roomId) continue
      for (const [userProfileId, player] of room.players.entries()) {
        activePlayers.push({
          id: userProfileId,
          socket_id: player.socketId,
          room_id: rId,
          user_profile_id: userProfileId,
          last_activity: room.lastActivity,
          joined_at: room.lastActivity
        })
      }
    }
    
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
        // Player data stored in-memory only (no database persistence)
        
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
            // Room state stored in-memory only (no database persistence)
            invalidateEndedRoomsCache(player.room_id)
            cleanedRooms.add(player.room_id)
          }
        }
        
        // Game events no longer persisted (match results saved to NoCodeBackend)
      // dbHelpers.addGameEvent(player.room_id, player.id, 'player_left_stale', { reason })
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
    
    // Get all players in this room from in-memory storage
    const room = rooms.get(roomId)
    if (!room) {
      return res.status(404).json({ error: 'Room not found' })
    }
    
    let cleanedCount = 0
    let disconnectedCount = 0
    
    for (const [userProfileId, player] of room.players.entries()) {
      const isSocketActive = activeSocketIds.has(player.socketId)
      
      if (force || !isSocketActive) {
        const reason = force ? 'force_cleanup' : 'socket_disconnected'
        
        // Remove from in-memory room
        room.players.delete(userProfileId)
        room.socketIds.delete(userProfileId)
        
        if (!isSocketActive) {
          disconnectedCount++
        }
        
        if (room.players.size > 0) {
          io.to(roomId).emit('player-left', {
            playerId: userProfileId,
            players: Array.from(room.players.values())
          })
        }
        
        if (room.players.size === 0) {
          rooms.delete(roomId)
          // Room state stored in-memory only (no database persistence)
          invalidateEndedRoomsCache(roomId)
        }
        
        // Game events no longer persisted (match results saved to NoCodeBackend)
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

// Win tracking API endpoints (using NoCodeBackend)
// Note: Wins are recorded via NoCodeBackend from the client (saveMatch function)
// These endpoints only read win data from NoCodeBackend

// Get wins for a specific game type
app.get('/api/wins/:gameType', async (req, res) => {
  try {
    const { gameType } = req.params
    const leaderboard = await getLeaderboard(gameType)
    
    res.json({ gameType, wins: leaderboard })
  } catch (error) {
    console.error('[API] Error fetching wins:', error)
    res.status(500).json({ error: error.message })
  }
})

// Get all wins for a specific player
app.get('/api/wins/player/:userProfileId', async (req, res) => {
  try {
    const { userProfileId } = req.params
    // Get wins for all game types
    const allMatches = await getAllMatches()
    
    const winsByGame = {}
    const gameTypes = new Set()
    
    // Collect all game types
    allMatches.forEach(match => {
      const gameType = match.GameType || match.gameType
      if (gameType) gameTypes.add(gameType)
    })
    
    // Count wins per game type for this player
    for (const gameType of gameTypes) {
      const count = await getWinCount(userProfileId, gameType)
      if (count > 0) {
        winsByGame[gameType] = count
      }
    }
    
    res.json({ userProfileId, wins: winsByGame })
  } catch (error) {
    console.error('[API] Error fetching player wins:', error)
    res.status(500).json({ error: error.message })
  }
})

// Get wins for players in a room for a specific game
app.get('/api/wins/room/:roomId/:gameType', async (req, res) => {
  try {
    const { roomId, gameType } = req.params
    
    // Get players from in-memory room
    const room = rooms.get(roomId)
    if (!room) {
      return res.json({ roomId, gameType, wins: [] })
    }
    
    // Extract user profile IDs from room players
    const userProfileIds = Array.from(room.players.values())
      .map(p => p.userProfileId)
      .filter(id => id) // Filter out undefined/null
    
    if (userProfileIds.length === 0) {
      return res.json({ roomId, gameType, wins: [] })
    }
    
    // Get wins for all players at once
    const winsMap = await getWinsForPlayers(userProfileIds, gameType)
    
    // Convert to array format
    const wins = Object.entries(winsMap).map(([userProfileId, wins]) => ({
      userProfileId,
      wins
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


