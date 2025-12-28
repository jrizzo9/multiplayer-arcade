// Multiplayer room state provider and hook
// Provides room-snapshot as single source of truth for room state and presence
// Manages socket connection lifecycle - keeps connection alive across navigation

import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react'
import { getSocket } from '../utils/socket'
import { createRoom, joinRoom, leaveRoom } from './roomLifecycle'

const RoomContext = createContext(null)

export function RoomProvider({ children }) {
  const [snapshots, setSnapshots] = useState(new Map()) // roomId -> snapshot
  const [activeRoomId, setActiveRoomId] = useState(null) // Currently connected room ID
  
  // Keep ref in sync with state
  useEffect(() => {
    activeRoomIdRef.current = activeRoomId
  }, [activeRoomId])
  const [socketConnected, setSocketConnected] = useState(false)
  const [isJoining, setIsJoining] = useState(false)
  const socketRef = useRef(null)
  const listenersInitializedRef = useRef(false)
  const roomJoinedRef = useRef(false)
  const currentProfileRef = useRef(null)
  const recentPlayerLeftRef = useRef(new Map()) // roomId -> timestamp of last player-left event
  const activeRoomIdRef = useRef(null) // Track activeRoomId in ref to avoid stale closures

  // Initialize socket connection and track connection status
  useEffect(() => {
    // Wait a bit for server to be ready if it's waking up
    const initSocket = async () => {
      // Check server health first
      const { checkServerHealth, waitForServer } = await import('../utils/serverHealth')
      const healthStatus = await checkServerHealth()
      
      // If server is offline or waking, wait for it
      if (healthStatus.status === 'offline' || healthStatus.status === 'waking') {
        console.log('[RoomProvider] Server is offline or waking, waiting...')
        const serverReady = await waitForServer(30000) // Wait up to 30 seconds
        if (!serverReady) {
          console.warn('[RoomProvider] Server did not wake up in time, connecting anyway...')
        }
      }
      
      const socket = getSocket()
      socketRef.current = socket

      // Set initial connection status
      setSocketConnected(socket.connected)

      console.log('[DIAG] [ROOM-PROVIDER] useEffect running', {
        listenersInitialized: listenersInitializedRef.current,
        socketId: socket.id,
        socketConnected: socket.connected,
        timestamp: Date.now()
      })

      // Socket connection event handlers
      socket.on('connect', () => {
        console.log('[RoomProvider] Socket connected:', socket.id)
        setSocketConnected(true)
      })

      socket.on('disconnect', (reason) => {
        console.log('[RoomProvider] Socket disconnected:', reason)
        setSocketConnected(false)
        // Reset room connection state on disconnect
        roomJoinedRef.current = false
        setActiveRoomId(null)
      })

      socket.on('connect_error', (error) => {
        console.error('[RoomProvider] Socket connection error:', error)
        setSocketConnected(false)
      })

      if (!listenersInitializedRef.current) {
      // Count listeners before registering (if method exists)
      const listenerCountBefore = typeof socket.listenerCount === 'function' 
        ? socket.listenerCount('room-snapshot')
        : 'N/A (method not available)'
      console.log('[DIAG] [ROOM-PROVIDER] room-snapshot listener count before:', listenerCountBefore)
      
      // Subscribe to room-snapshot events
      // CRITICAL: Use functional update to avoid stale closure issues
      // The snapshot payload is the source of truth - replace entire snapshot without depending on prev state
      socket.on('room-snapshot', (snapshot) => {
        const normalizedRoomId = String(snapshot?.roomId)
        
        // CRITICAL: If player has left this room (activeRoomId is null or doesn't match), ignore snapshots
        // This prevents snapshots from re-creating room state after player leaves
        // Use ref to get current value (avoids stale closure)
        const currentActiveRoomId = activeRoomIdRef.current ? String(activeRoomIdRef.current) : null
        if (normalizedRoomId && !currentActiveRoomId) {
          // Player has left (activeRoomId is null) - ignore all snapshots
          console.log(`[DEBUG] [ROOM-PROVIDER] Ignoring room-snapshot for room ${normalizedRoomId} - player has left (activeRoomId is null)`)
          return
        }
        if (normalizedRoomId && currentActiveRoomId && currentActiveRoomId !== normalizedRoomId) {
          // Player is in a different room - ignore snapshots for other rooms
          console.log(`[DEBUG] [ROOM-PROVIDER] Ignoring room-snapshot for room ${normalizedRoomId} - player is in different room ${currentActiveRoomId}`)
          return
        }
        
        const currentSnapshot = snapshots.get(normalizedRoomId) || snapshots.get(snapshot?.roomId)
        const currentPlayerCount = currentSnapshot?.players?.length || 0
        const newPlayerCount = snapshot?.players?.length || 0
        
        console.log('[DEBUG] [ROOM-PROVIDER] Received room-snapshot event:', {
          fullSnapshot: snapshot,
          roomId: snapshot?.roomId,
          roomIdType: typeof snapshot?.roomId,
          playersCount: newPlayerCount,
          currentPlayerCount: currentPlayerCount,
          activeRoomId: currentActiveRoomId,
          matchesActiveRoom: currentActiveRoomId === normalizedRoomId,
          players: snapshot?.players?.map(p => ({ userProfileId: p.userProfileId, name: p.name, socketId: p.socketId })),
          socketId: socket.id,
          socketConnected: socket.connected,
          timestamp: Date.now()
        })
        
        // Check if we recently received a player-left event for this room
        // If so, and the snapshot has MORE players than current, it's likely stale
        // normalizedRoomId already set above
        const lastPlayerLeftTime = recentPlayerLeftRef.current.get(normalizedRoomId)
        const timeSincePlayerLeft = lastPlayerLeftTime ? Date.now() - lastPlayerLeftTime : Infinity
        
        // If we received player-left recently (< 1 second) and snapshot has MORE players, it's likely stale
        const isStaleSnapshot = timeSincePlayerLeft < 1000 && 
                                currentPlayerCount > 0 && 
                                newPlayerCount > currentPlayerCount
        
        if (isStaleSnapshot) {
          console.warn(`[DEBUG] [ROOM-PROVIDER] ⚠️ IGNORING STALE SNAPSHOT: Received snapshot with ${newPlayerCount} players but current snapshot has ${currentPlayerCount} players. Player-left was ${timeSincePlayerLeft}ms ago. This is likely a stale snapshot from before player-left. Ignoring to prevent UI glitch.`)
          // Don't update - keep the current (correct) snapshot
          return
        }
        
        // Clear the player-left tracking after 2 seconds (snapshots should be correct by then)
        if (lastPlayerLeftTime && timeSincePlayerLeft > 2000) {
          recentPlayerLeftRef.current.delete(normalizedRoomId)
        }
        
        console.log('[RoomProvider] Received room-snapshot:', snapshot.roomId, 'with', snapshot.players?.length || 0, 'players:', snapshot.players?.map(p => `${p.name} (${p.userProfileId})`))
        
        // CRITICAL FIX: Use functional update but replace the entire snapshot from payload
        // This ensures we always use the latest data from server, avoiding stale closure issues
        setSnapshots(prev => {
          console.log('[DIAG] [ROOM-PROVIDER] Map state before update', {
            mapSize: prev.size,
            mapKeys: Array.from(prev.keys()),
            mapKeysTypes: Array.from(prev.keys()).map(k => typeof k),
            timestamp: Date.now()
          })
          
          // Create new Map to ensure immutability
          const next = new Map(prev)
          
          // Normalize roomId to string for consistent lookup
          const normalizedRoomId = String(snapshot.roomId)
          
          // Get old snapshot for comparison only
          const oldSnapshot = prev.get(normalizedRoomId) || prev.get(snapshot.roomId)
          const oldPlayerCount = oldSnapshot?.players?.length || 0
          
          // DOUBLE-CHECK: If we're receiving a snapshot with MORE players than current, and we recently received player-left,
          // this is likely stale - ignore it (but only if we have a player-left event tracked)
          // This is a secondary check in case the first check didn't catch it
          const lastPlayerLeftTime = recentPlayerLeftRef.current.get(normalizedRoomId)
          const timeSincePlayerLeft = lastPlayerLeftTime ? Date.now() - lastPlayerLeftTime : Infinity
          
          if (oldPlayerCount > 0 && newPlayerCount > oldPlayerCount && timeSincePlayerLeft < 1000) {
            // We have a player-left event AND snapshot has more players - definitely stale
            console.warn(`[DEBUG] [ROOM-PROVIDER] ⚠️ IGNORING POTENTIALLY STALE SNAPSHOT: ${newPlayerCount} players vs current ${oldPlayerCount} (player-left was ${timeSincePlayerLeft}ms ago). Likely stale snapshot.`)
            return prev // Don't update
          }
          
          // If snapshot has FEWER or EQUAL players, or no recent player-left event, accept it
          // This ensures correct snapshots (with fewer players after leave) are always accepted
          
          // CRITICAL: Replace entire snapshot from server payload (don't merge with prev state)
          // This ensures we always have the latest player list from the server
          // Create a NEW array reference to ensure React detects the change
          const newPlayers = Array.isArray(snapshot.players) ? [...snapshot.players] : []
          
          console.log('[DEBUG] [ROOM-PROVIDER] Updating snapshot in Map:', {
            normalizedRoomId,
            oldPlayerCount,
            newPlayerCount: newPlayers.length,
            oldPlayers: oldSnapshot?.players?.map(p => ({ userProfileId: p.userProfileId, name: p.name })) || [],
            newPlayers: newPlayers.map(p => ({ userProfileId: p.userProfileId, name: p.name })),
            timestamp: Date.now()
          })
          
          next.set(normalizedRoomId, {
            roomId: normalizedRoomId,
            hostUserProfileId: snapshot.hostUserProfileId,
            status: snapshot.status,
            selectedGame: snapshot.selectedGame,
            // Use players array directly from snapshot - this is the source of truth
            // Create new array reference to ensure React detects changes
            players: newPlayers,
            _lastUpdated: Date.now() // Track when this snapshot was updated for stale detection
          })
          
          // Log the update to help debug
          if (newPlayers.length !== oldPlayerCount) {
            console.log(`[DEBUG] [ROOM-PROVIDER] Player count changed for room ${snapshot.roomId}: ${oldPlayerCount} -> ${newPlayers.length}`, {
              oldPlayers: oldSnapshot?.players?.map(p => p.name) || [],
              newPlayers: newPlayers.map(p => p.name),
              oldSnapshotExists: !!oldSnapshot,
              timestamp: Date.now()
            })
          } else {
            console.log(`[DEBUG] [ROOM-PROVIDER] Player count unchanged for room ${snapshot.roomId}: ${newPlayers.length}`, {
              players: newPlayers.map(p => p.name),
              timestamp: Date.now()
            })
          }
          
          // Also remove any entry with the non-normalized key if it exists
          if (String(snapshot.roomId) !== snapshot.roomId && prev.has(snapshot.roomId)) {
            next.delete(snapshot.roomId)
          }
          
          console.log('[DIAG] [ROOM-PROVIDER] Step 5: Storing snapshot in Map', {
            roomId: snapshot.roomId,
            roomIdType: typeof snapshot.roomId,
            mapKeysBefore: Array.from(prev.keys()),
            mapKeysAfter: Array.from(next.keys()),
            snapshotStored: next.has(normalizedRoomId),
            playersCount: snapshot.players?.length || 0,
            timestamp: Date.now()
          })
          
          console.log('[DIAG] [ROOM-PROVIDER] Map state after update', {
            mapSize: next.size,
            mapKeys: Array.from(next.keys()),
            mapKeysTypes: Array.from(next.keys()).map(k => typeof k),
            snapshotRoomId: snapshot.roomId,
            snapshotRoomIdType: typeof snapshot.roomId,
            snapshotFound: next.has(normalizedRoomId),
            storedPlayersCount: next.get(normalizedRoomId)?.players?.length || 0,
            timestamp: Date.now()
          })
          
          return next
        })
      })
      
      // Count listeners after registering (if method exists)
      const listenerCountAfter = typeof socket.listenerCount === 'function'
        ? socket.listenerCount('room-snapshot')
        : 'N/A (method not available)'
      console.log('[DIAG] [ROOM-PROVIDER] room-snapshot listener count after:', listenerCountAfter, {
        duplicateDetected: typeof listenerCountAfter === 'number' && listenerCountAfter > 1,
        timestamp: Date.now()
      })

      // Also listen to room-created for initial snapshot
      socket.on('room-created', ({ roomId, players, hostUserProfileId }) => {
        console.log('[DIAG] [ROOM-PROVIDER] Received room-created event', {
          roomId: roomId,
          roomIdType: typeof roomId,
          playersCount: players?.length || 0,
          hostUserProfileId: hostUserProfileId,
          timestamp: Date.now()
        })
        console.log('[RoomProvider] Received room-created, waiting for snapshot:', roomId)
        // Snapshot should arrive shortly, but we can create a minimal one if needed
        setSnapshots(prev => {
          const next = new Map(prev)
          if (!next.has(roomId)) {
            next.set(roomId, {
              roomId,
              hostUserProfileId,
              status: 'waiting',
              selectedGame: null,
              players: players || []
            })
            console.log('[DIAG] [ROOM-PROVIDER] Created minimal snapshot from room-created', {
              roomId: roomId,
              roomIdType: typeof roomId,
              timestamp: Date.now()
            })
          }
          return next
        })
      })

      // Listen for room-left confirmation (sent to the leaving player)
      // This triggers UI update to go back to title screen
      socket.on('room-left', ({ roomId: leftRoomId, success, message }) => {
        console.log('[DEBUG] [ROOM-PROVIDER] Received room-left confirmation:', {
          roomId: leftRoomId,
          success,
          message,
          currentActiveRoomId: activeRoomId,
          timestamp: Date.now()
        })
        
        // Only process if this is the active room
        if (leftRoomId && (activeRoomId === leftRoomId || String(activeRoomId) === String(leftRoomId))) {
          console.log('[RoomProvider] Player successfully left room:', leftRoomId)
          
          // Clear active room ID
          setActiveRoomId(null)
          roomJoinedRef.current = false
          
          // Clear snapshot for this room
          setSnapshots(prev => {
            const next = new Map(prev)
            const normalizedRoomId = String(leftRoomId)
            if (next.has(normalizedRoomId)) {
              next.delete(normalizedRoomId)
              console.log('[RoomProvider] Deleted snapshot for left room:', normalizedRoomId)
            }
            if (normalizedRoomId !== leftRoomId && next.has(leftRoomId)) {
              next.delete(leftRoomId)
            }
            return next
          })
          
          // Clear URL room parameter
          const url = new URL(window.location.href)
          url.searchParams.delete('room')
          window.history.replaceState({}, '', url.pathname + url.search)
        }
      })

      // Listen for player-left events and optimistically update state
      // This ensures UI updates immediately when a player is kicked or leaves
      // Uses the same pattern as player-joined: update immediately, then room-snapshot confirms
      socket.on('player-left', (payload) => {
        console.log('[DEBUG] [ROOM-PROVIDER] Received player-left event:', {
          fullPayload: payload,
          userProfileId: payload?.userProfileId,
          remainingPlayersCount: payload?.players?.length,
          roomId: payload?.roomId,
          roomIdType: typeof payload?.roomId,
          socketId: socket.id,
          socketConnected: socket.connected,
          timestamp: Date.now()
        })
        
        const { userProfileId, players: remainingPlayers, roomId: eventRoomId } = payload || {}
        
        // Optimistically update the snapshot immediately (same pattern as join flow)
        setSnapshots(prev => {
          const next = new Map(prev)
          
          // Normalize roomId to string for consistent lookup (same as room-snapshot handler)
          const normalizedRoomId = eventRoomId ? String(eventRoomId) : null
          
          if (normalizedRoomId) {
            // Try to find snapshot with normalized roomId first, then original
            const snapshot = next.get(normalizedRoomId) || next.get(eventRoomId)
            
            if (snapshot) {
              // If remainingPlayers array is provided, use it directly (same as player-joined pattern)
              if (remainingPlayers && Array.isArray(remainingPlayers)) {
                // Create new array reference to ensure React detects the change
                const newPlayers = [...remainingPlayers]
                next.set(normalizedRoomId, {
                  ...snapshot,
                  roomId: normalizedRoomId,
                  players: newPlayers,
                  _lastUpdated: Date.now() // Track when updated for stale detection
                })
                // Also remove any entry with the non-normalized key if it exists
                if (String(eventRoomId) !== eventRoomId && next.has(eventRoomId)) {
                  next.delete(eventRoomId)
                }
                console.log(`[RoomProvider] Optimistically updated room ${normalizedRoomId} with ${newPlayers.length} players after player-left`, {
                  oldCount: snapshot.players?.length || 0,
                  newCount: newPlayers.length,
                  timestamp: Date.now()
                })
                
                // Track that we just received a player-left event for this room
                // This helps us detect stale snapshots that arrive after player-left
                recentPlayerLeftRef.current.set(normalizedRoomId, Date.now())
              } else if (userProfileId) {
                // Fallback: filter out the leaving player if remainingPlayers not provided
                const updatedPlayers = (snapshot.players || []).filter(
                  p => String(p.userProfileId) !== String(userProfileId)
                )
                next.set(normalizedRoomId, {
                  ...snapshot,
                  roomId: normalizedRoomId,
                  players: updatedPlayers
                })
                if (String(eventRoomId) !== eventRoomId && next.has(eventRoomId)) {
                  next.delete(eventRoomId)
                }
                console.log(`[RoomProvider] Optimistically removed player ${userProfileId} from room ${normalizedRoomId}`, {
                  oldCount: snapshot.players?.length || 0,
                  newCount: updatedPlayers.length,
                  timestamp: Date.now()
                })
              }
            } else {
              // Only warn if we're still in this room (activeRoomId matches)
              // If activeRoomId is null or different, we've already left, so no snapshot is expected
              const currentActiveRoomId = activeRoomIdRef.current ? String(activeRoomIdRef.current) : null
              if (currentActiveRoomId === normalizedRoomId) {
                console.warn(`[RoomProvider] Received player-left for room ${normalizedRoomId} but no snapshot found (unexpected - we're still in this room)`)
              } else {
                console.log(`[RoomProvider] Received player-left for room ${normalizedRoomId} but no snapshot found (expected - we're not in this room anymore)`)
              }
            }
          } else {
            // If no roomId provided, check all snapshots (fallback for backwards compatibility)
            console.warn('[RoomProvider] Received player-left without roomId, checking all snapshots')
            for (const targetRoomId of Array.from(next.keys())) {
              const snapshot = next.get(targetRoomId)
              if (snapshot && userProfileId) {
                const updatedPlayers = (snapshot.players || []).filter(
                  p => String(p.userProfileId) !== String(userProfileId)
                )
                next.set(targetRoomId, {
                  ...snapshot,
                  players: updatedPlayers
                })
                console.log(`[RoomProvider] Optimistically removed player ${userProfileId} from room ${targetRoomId} (no roomId in event)`)
              }
            }
          }
          
          return next
        })
      })

      // Listen for room-closed events to clear snapshots
      socket.on('room-closed', ({ reason, message, roomId: closedRoomId }) => {
        console.log('[RoomProvider] Received room-closed event:', { reason, message, closedRoomId })
        
        // Clear the snapshot for the closed room
        setSnapshots(prev => {
          const next = new Map(prev)
          if (closedRoomId) {
            const normalizedRoomId = String(closedRoomId)
            if (next.has(normalizedRoomId)) {
              next.delete(normalizedRoomId)
              console.log('[RoomProvider] Deleted snapshot for closed room:', normalizedRoomId)
            }
            // Also try deleting with original roomId if different
            if (normalizedRoomId !== closedRoomId && next.has(closedRoomId)) {
              next.delete(closedRoomId)
              console.log('[RoomProvider] Deleted snapshot for closed room (original):', closedRoomId)
            }
          } else {
            // If no roomId provided, clear all snapshots (shouldn't happen, but be safe)
            console.warn('[RoomProvider] room-closed event without roomId, clearing all snapshots')
            next.clear()
          }
          return next
        })
        
        // Clear activeRoomId if it matches (using functional update to access current value)
        setActiveRoomId(prevActiveRoomId => {
          if (closedRoomId && prevActiveRoomId === closedRoomId) {
            roomJoinedRef.current = false
            return null
          }
          return prevActiveRoomId
        })
      })

        listenersInitializedRef.current = true
      }
    }

    // Call the async initialization
    initSocket().catch(error => {
      console.error('[RoomProvider] Error initializing socket:', error)
      // Still try to get socket even if health check fails
      const socket = getSocket()
      socketRef.current = socket
      setSocketConnected(socket.connected)
    })

    return () => {
      // Don't remove listeners - socket is shared and other components may need them
      // The RoomProvider should stay mounted for the app lifetime
    }
  }, [])
  
  // Log when RoomProvider re-renders - use snapshots.size to avoid infinite loops
  useEffect(() => {
    console.log('[DIAG] [ROOM-PROVIDER] Component re-rendered', {
      snapshotsSize: snapshots.size,
      timestamp: Date.now()
    })
  }, [snapshots.size])

  // Connection management methods
  const connectToRoom = useCallback(async (roomId, profile) => {
    if (!socketRef.current?.connected) {
      console.warn('[RoomProvider] Cannot connect to room: socket not connected')
      return { success: false, error: 'Socket not connected' }
    }

    if (roomJoinedRef.current && activeRoomId === roomId) {
      console.log('[RoomProvider] Already connected to room:', roomId)
      return { success: true, roomId }
    }

    if (isJoining) {
      console.log('[RoomProvider] Already joining a room, please wait')
      return { success: false, error: 'Already joining a room' }
    }

    setIsJoining(true)
    currentProfileRef.current = profile

    try {
      console.log('[RoomProvider] Joining room:', roomId)
      await joinRoom(roomId, {
        playerName: profile.name,
        userProfileId: profile.id,
        colorId: profile.colorId
      })
      
      roomJoinedRef.current = true
      setActiveRoomId(roomId)
      
      // Update URL with roomId
      window.history.pushState({}, '', `?room=${roomId}`)
      
      console.log('[RoomProvider] Successfully joined room:', roomId)
      return { success: true, roomId }
    } catch (error) {
      console.error('[RoomProvider] Error joining room:', error)
      roomJoinedRef.current = false
      return { success: false, error: error.message || 'Failed to join room' }
    } finally {
      setIsJoining(false)
    }
  }, [activeRoomId, isJoining])

  const createNewRoom = useCallback(async (profile) => {
    if (!socketRef.current?.connected) {
      console.warn('[RoomProvider] Cannot create room: socket not connected')
      return { success: false, error: 'Socket not connected' }
    }

    if (isJoining) {
      console.log('[RoomProvider] Already joining a room, please wait')
      return { success: false, error: 'Already joining a room' }
    }

    setIsJoining(true)
    currentProfileRef.current = profile

    try {
      console.log('[RoomProvider] Creating room with profile:', profile)
      const result = await createRoom({
        playerName: profile.name,
        userProfileId: profile.id,
        colorId: profile.colorId
      })
      
      if (result.roomId) {
        roomJoinedRef.current = true
        setActiveRoomId(result.roomId)
        
        // Update URL with roomId
        window.history.pushState({}, '', `?room=${result.roomId}`)
        
        console.log('[RoomProvider] Successfully created room:', result.roomId)
        return { success: true, roomId: result.roomId }
      } else {
        throw new Error('Room creation failed: no roomId returned')
      }
    } catch (error) {
      console.error('[RoomProvider] Error creating room:', error)
      roomJoinedRef.current = false
      return { success: false, error: error.message || 'Failed to create room' }
    } finally {
      setIsJoining(false)
    }
  }, [isJoining])

  const disconnectFromRoom = useCallback(async (roomId, profile) => {
    if (!roomId) {
      console.log('[RoomProvider] No roomId provided, nothing to disconnect')
      // Still clear activeRoomId if it exists
      if (roomJoinedRef.current) {
        roomJoinedRef.current = false
        setActiveRoomId(null)
      }
      return { success: true }
    }

    try {
      console.log('[DEBUG] [ROOM-PROVIDER] disconnectFromRoom called:', {
        roomId,
        currentActiveRoomId: activeRoomId,
        roomJoinedRef: roomJoinedRef.current,
        profileId: profile?.id,
        snapshotsKeys: Array.from(snapshots.keys()),
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n'),
        timestamp: Date.now()
      })
      
      // Only actually leave if this is the active room or we're joined to it
      const isActiveRoom = activeRoomId === roomId || roomJoinedRef.current
      
      if (isActiveRoom) {
        await leaveRoom(roomId, { userProfileId: profile?.id })
        roomJoinedRef.current = false
        setActiveRoomId(null)
      } else {
        console.log('[RoomProvider] Not leaving room - not active room. Active:', activeRoomId, 'Requested:', roomId)
      }
      
      // Clear snapshot from Map ONLY if we're actually leaving (not just receiving player-left events)
      // This prevents deleting snapshot when other players leave
      if (isActiveRoom) {
        setSnapshots(prev => {
          const next = new Map(prev)
          const normalizedRoomId = String(roomId)
          if (next.has(normalizedRoomId)) {
            next.delete(normalizedRoomId)
            console.log('[RoomProvider] Deleted snapshot for room:', normalizedRoomId)
          }
          // Also try deleting with original roomId if different
          if (normalizedRoomId !== roomId && next.has(roomId)) {
            next.delete(roomId)
            console.log('[RoomProvider] Deleted snapshot for room (original):', roomId)
          }
          return next
        })
      } else {
        console.log('[RoomProvider] NOT deleting snapshot - room is not active, likely another player left')
      }
      
      // Clear URL room parameter
      const url = new URL(window.location.href)
      url.searchParams.delete('room')
      window.history.replaceState({}, '', url.pathname + url.search)
      
      console.log('[RoomProvider] Successfully left room:', roomId)
      return { success: true }
    } catch (error) {
      console.error('[RoomProvider] Error leaving room:', error)
      // Still clear local state even if server call fails
      roomJoinedRef.current = false
      setActiveRoomId(null)
      
      // Still clear snapshot even if server call fails
      setSnapshots(prev => {
        const next = new Map(prev)
        const normalizedRoomId = String(roomId)
        if (next.has(normalizedRoomId)) {
          next.delete(normalizedRoomId)
        }
        if (normalizedRoomId !== roomId && next.has(roomId)) {
          next.delete(roomId)
        }
        return next
      })
      
      return { success: false, error: error.message || 'Failed to leave room' }
    }
  }, [])

  // Keep connection alive - don't disconnect on navigation
  const keepConnectionAlive = useCallback(() => {
    // This is a no-op - connection stays alive
    // Only disconnectFromRoom will actually disconnect
    console.log('[RoomProvider] Keeping connection alive (navigation occurred)')
  }, [])

  // Create a version counter that increments when snapshots change
  // This ensures components re-render even when Map size doesn't change (e.g., updating existing room)
  const [snapshotVersion, setSnapshotVersion] = useState(0)
  
  // Increment version when snapshots change (used for triggering re-renders)
  useEffect(() => {
    setSnapshotVersion(prev => prev + 1)
  }, [snapshots])

  const value = {
    snapshots,
    snapshotVersion, // Include version so components can depend on it for re-renders
    getSnapshot: (roomId) => {
      if (!roomId) return null
      // Try normalized string first, then original
      const normalized = String(roomId)
      return snapshots.get(normalized) || snapshots.get(roomId) || null
    },
    // Connection state
    activeRoomId,
    socketConnected,
    isJoining,
    // Connection methods
    connectToRoom,
    createNewRoom,
    disconnectFromRoom,
    keepConnectionAlive,
    // Socket reference for components that need it
    socket: socketRef.current || getSocket() // Fallback to get socket if ref is null
  }

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>
}

export function useRoom(roomId) {
  const context = useContext(RoomContext)
  if (!context) {
    throw new Error('useRoom must be used within RoomProvider')
  }

  // If roomId is provided, get that specific room's snapshot
  // Otherwise, get the first available snapshot (for backwards compatibility)
  // Normalize roomId to string for consistent lookup (room IDs can be strings or numbers)
  const normalizedRoomId = roomId ? String(roomId) : null
  const snapshot = normalizedRoomId 
    ? context.getSnapshot(normalizedRoomId) || context.getSnapshot(roomId) // Try both string and original
    : (context.snapshots.size > 0 ? Array.from(context.snapshots.values())[0] : null)
  
  // Diagnostic logging - use snapshotVersion to detect any snapshot changes (not just size)
  useEffect(() => {
    console.log('[DIAG] [USE-ROOM] Hook called', {
      roomId: roomId,
      roomIdType: typeof roomId,
      roomIdDefined: roomId !== undefined && roomId !== null,
      allSnapshotKeys: Array.from(context.snapshots.keys()),
      allSnapshotKeyTypes: Array.from(context.snapshots.keys()).map(k => typeof k),
      snapshotVersion: context.snapshotVersion,
      playersCount: snapshot?.players?.length || 0,
      timestamp: Date.now()
    })
  }, [roomId, context.snapshotVersion, context.snapshots, snapshot])
  
  // Debug logging - COMMENTED OUT to reduce noise from frequent polling
  // if (roomId) {
  //   const allRoomIds = Array.from(context.snapshots.keys())
  //   console.log('[DIAG] [USE-ROOM] Returning snapshot', {
  //     requestedRoomId: roomId,
  //     requestedRoomIdType: typeof roomId,
  //     snapshotFound: !!snapshot,
  //     snapshotRoomId: snapshot?.roomId,
  //     snapshotRoomIdType: typeof snapshot?.roomId,
  //     playersCount: snapshot?.players?.length || 0,
  //     timestamp: Date.now()
  //   })
  //   console.log('[useRoom] Getting snapshot for roomId:', roomId, 'found:', !!snapshot, 'players:', snapshot?.players?.length || 0, 'all snapshots:', allRoomIds)
  //   if (!snapshot && allRoomIds.length > 0) {
  //     console.warn('[useRoom] Snapshot not found for roomId:', roomId, 'but snapshots exist for:', allRoomIds)
  //   }
  // }

  // Derived helpers
  const roomId_value = snapshot?.roomId || null
  const players = snapshot?.players || []
  const hostUserProfileId = snapshot?.hostUserProfileId || null
  const selectedGame = snapshot?.selectedGame || null
  const status = snapshot?.status || null
  
  // DEBUG: Log when players array changes
  const playersRef = useRef(players)
  useEffect(() => {
    const prevPlayers = playersRef.current
    const playersChanged = prevPlayers.length !== players.length || 
      prevPlayers.some((p, i) => p.userProfileId !== players[i]?.userProfileId)
    
    if (playersChanged) {
      console.log('[DEBUG] [USE-ROOM] Players array changed:', {
        roomId: roomId_value,
        prevCount: prevPlayers.length,
        newCount: players.length,
        prevPlayers: prevPlayers.map(p => ({ userProfileId: p.userProfileId, name: p.name })),
        newPlayers: players.map(p => ({ userProfileId: p.userProfileId, name: p.name })),
        timestamp: Date.now()
      })
      playersRef.current = players
    }
  }, [players, roomId_value])

  // Helper: Check if a userProfileId is the host
  const isHost = useCallback((userProfileId) => {
    if (!userProfileId || !hostUserProfileId) return false
    return String(userProfileId) === String(hostUserProfileId)
  }, [hostUserProfileId])

  // Helper: Get player by userProfileId
  const getPlayer = useCallback((userProfileId) => {
    if (!userProfileId) return null
    return players.find(p => String(p.userProfileId) === String(userProfileId)) || null
  }, [players])

  return {
    roomId: roomId_value,
    players,
    hostUserProfileId,
    selectedGame,
    status,
    isHost,
    getPlayer,
    snapshot // Full snapshot for advanced use cases
  }
}

// Hook to access room connection methods and state
export function useRoomConnection() {
  const context = useContext(RoomContext)
  if (!context) {
    throw new Error('useRoomConnection must be used within RoomProvider')
  }

  return {
    activeRoomId: context.activeRoomId,
    socketConnected: context.socketConnected,
    isJoining: context.isJoining,
    snapshotVersion: context.snapshotVersion, // Include snapshotVersion to trigger re-renders
    connectToRoom: context.connectToRoom,
    createNewRoom: context.createNewRoom,
    disconnectFromRoom: context.disconnectFromRoom,
    keepConnectionAlive: context.keepConnectionAlive,
    socket: context.socket
  }
}

