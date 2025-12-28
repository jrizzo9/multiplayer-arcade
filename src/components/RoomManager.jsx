import { useState, useEffect, useRef, useCallback } from 'react'
import { useRoom, useRoomConnection } from '../multiplayer/RoomProvider'
import { setReady, selectGame, leaveRoom } from '../multiplayer/roomLifecycle'
import { clearRoomState } from '../utils/roomState'
import { isCPUProfile } from '../utils/cpuPlayer'
import Button from './Button'
import ConfirmationDialog from './ConfirmationDialog'
import ErrorModal from './ErrorModal'
import QRCode from './QRCode'

// Helper function to get roomId from URL (single source of truth)
function getRoomIdFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('room')
}

// Module-level fetch guard to prevent multiple instances from fetching simultaneously
let globalIsFetching = false
let globalLastFetchTime = 0

function RoomManager({
  onJoinRoom,
  onCreateRoom,
  onExit,
  onBackToTitle,
  profile,
  roomId: propRoomId,
  isHost: propIsHost,
  roomPlayers: propRoomPlayers,
  onRoomCreated,
  onRoomStateChange,
  backgroundMode = false,
  selectedGame: propSelectedGame
}) {
  // Get room state from multiplayer foundation (room-snapshot is source of truth)
  // Also track roomId from successful create/join operations
  const [localRoomId, setLocalRoomId] = useState(null)
  // Determine the actual roomId to use for lookup
  const actualRoomId = propRoomId || localRoomId || null
  // Get room state using the actual roomId
  const roomState = useRoom(actualRoomId)
  // Final roomId - prefer propRoomId, then localRoomId, then roomState.roomId from snapshot
  const roomId = propRoomId || localRoomId || roomState.roomId || null
  // Check if room actually exists and has players
  const hasValidRoom = roomId && roomState && roomState.players && roomState.players.length > 0
  
  // Get connection state and methods from RoomProvider
  let connectionState
  try {
    connectionState = useRoomConnection()
  } catch (error) {
    console.error('[RoomManager] Error getting room connection:', error)
    return (
      <div className="w-full h-screen bg-black flex items-center justify-center text-white pt-large">
        <div className="text-center">
          <p className="text-red-500">Error: Room connection not available</p>
          <p className="text-sm mt-2">{error.message}</p>
        </div>
      </div>
    )
  }

  const {
    activeRoomId: providerRoomId,
    socketConnected,
    isJoining,
    connectToRoom,
    createNewRoom,
    disconnectFromRoom,
    keepConnectionAlive,
    socket: providerSocket
  } = connectionState

  // Local UI state (not room state)
  const [error, setError] = useState(null)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [countdown, setCountdown] = useState(null)
  const [availableRooms, setAvailableRooms] = useState([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [showRoomView, setShowRoomView] = useState(false) // Control whether to show individual room view
  const [showCloseRoomDialog, setShowCloseRoomDialog] = useState(false)
  const [connectionUrl, setConnectionUrl] = useState(null)
  const [urlCopied, setUrlCopied] = useState(false)

  const socketRef = useRef(providerSocket)
  const previousSelectedGameRef = useRef(propSelectedGame)
  const lastFetchTimeRef = useRef(0)
  const fetchTimeoutRef = useRef(null)
  const previousRoomCountRef = useRef(0)
  const hasFetchedOnConnectionRef = useRef(false)
  const isFetchingRef = useRef(false)
  const previousRoomIdRef = useRef(null)

  // Update socket ref when provider socket changes
  useEffect(() => {
    if (providerSocket) {
      socketRef.current = providerSocket
    } else {
      // Fallback: try to get socket directly if provider socket is null
      try {
        const { getSocket } = require('../utils/socket')
        socketRef.current = getSocket()
      } catch (error) {
        console.warn('[RoomManager] Could not get socket:', error)
      }
    }
  }, [providerSocket])

  // Derive values from room state
  const players = roomState.players || []
  const hostUserProfileId = roomState.hostUserProfileId
  const selectedGame = roomState.selectedGame || propSelectedGame || null
  const status = roomState.status || 'waiting'
  const isHost = roomState.isHost(profile?.id) || propIsHost || false
  
  // DEBUG: Track players array changes
  const playersRef = useRef(players)
  useEffect(() => {
    const prevPlayers = playersRef.current
    const playersChanged = prevPlayers.length !== players.length || 
      prevPlayers.some((p, i) => p?.userProfileId !== players[i]?.userProfileId)
    
    if (playersChanged) {
      console.log('[DEBUG] [ROOM-MANAGER] Players array changed in RoomManager:', {
        roomId,
        prevCount: prevPlayers.length,
        newCount: players.length,
        prevPlayers: prevPlayers.map(p => ({ userProfileId: p?.userProfileId, name: p?.name })),
        newPlayers: players.map(p => ({ userProfileId: p?.userProfileId, name: p?.name })),
        timestamp: Date.now()
      })
      playersRef.current = players
    }
  }, [players, roomId])
  
  // Diagnostic logging for useRoom
  useEffect(() => {
    console.log('[DIAG] [ROOM-MANAGER] Step 8: useRoom called with actualRoomId', {
      actualRoomId: actualRoomId,
      actualRoomIdType: typeof actualRoomId,
      roomStateRoomId: roomState.roomId,
      roomStateRoomIdType: typeof roomState.roomId,
      playersCount: roomState.players?.length || 0,
      hasSnapshot: !!roomState.snapshot,
      timestamp: Date.now()
    })
  }, [actualRoomId, roomState.roomId, roomState.players?.length])
  
  // Diagnostic logging for localRoomId updates
  useEffect(() => {
    console.log('[DIAG] [ROOM-MANAGER] Step 7: localRoomId updated', {
      localRoomId: localRoomId,
      localRoomIdType: typeof localRoomId,
      timestamp: Date.now()
    })
  }, [localRoomId])
  
  // Debug logging - only log when key state changes, not on every render
  const prevStateRef = useRef({ roomId: null, socketConnected: false, playersCount: 0 })
  useEffect(() => {
    const prevState = prevStateRef.current
    const hasChanged = 
      prevState.roomId !== roomId ||
      prevState.socketConnected !== socketConnected ||
      prevState.playersCount !== players.length
    
    // Only log when meaningful state changes occur
    if (hasChanged) {
      console.log('[RoomManager] State changed:', {
        roomId,
        socketConnected,
        playersCount: players.length,
        hasSnapshot: !!roomState.snapshot
      })
      prevStateRef.current = { roomId, socketConnected, playersCount: players.length }
    }
  }, [roomId, socketConnected, players.length, roomState.snapshot])

  // Auto-show room view when we're in a room and RoomManager is displayed
  // This happens when user clicks the room button in AppHUD
  useEffect(() => {
    if (hasValidRoom && !showRoomView && !backgroundMode) {
      // We're in a room with players, but showRoomView is false
      // This likely means RoomManager was just opened - show the room view
      console.log('[RoomManager] Auto-showing room view - in room with players')
      setShowRoomView(true)
    } else if (!hasValidRoom && showRoomView) {
      // Room no longer exists, hide room view
      console.log('[RoomManager] Room no longer valid, hiding room view')
      setShowRoomView(false)
    }
  }, [hasValidRoom, showRoomView, backgroundMode])

  // Update selectedGame when prop changes (host only)
  useEffect(() => {
    if (propSelectedGame !== previousSelectedGameRef.current && propSelectedGame) {
      previousSelectedGameRef.current = propSelectedGame
      
      // If host and we have a roomId, emit game-selected event
      if (isHost && roomId && socketConnected) {
        console.log('[RoomManager] Host selected game:', propSelectedGame)
        selectGame(roomId, propSelectedGame)
      }
    }
  }, [propSelectedGame, isHost, roomId])

  // Fetch available rooms with debouncing and change detection
  // Define this BEFORE the useEffect that uses it to avoid hoisting issues
  const fetchAvailableRooms = useCallback(async (force = false) => {
    // Skip if in background mode
    if (backgroundMode) {
      return
    }
    
    // Prevent concurrent fetches across all instances
    if (globalIsFetching) {
      return
    }
    
    const now = Date.now()
    const timeSinceLastFetch = now - globalLastFetchTime
    
    // Debounce: don't fetch if called within last 2 seconds (unless forced)
    if (!force && timeSinceLastFetch < 2000) {
      return
    }
    
    // Clear any pending fetch
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current)
      fetchTimeoutRef.current = null
    }
    
    // Mark as fetching to prevent concurrent calls across all instances
    globalIsFetching = true
    isFetchingRef.current = true
    
    try {
      setLoadingRooms(true)
      const serverUrl = `http://${window.location.hostname}:8000`
      const response = await fetch(`${serverUrl}/api/rooms/active`)
      if (response.ok) {
        const rooms = await response.json()
        const previousCount = previousRoomCountRef.current
        setAvailableRooms(rooms)
        globalLastFetchTime = now
        lastFetchTimeRef.current = now
        previousRoomCountRef.current = rooms.length
        
        // Only log if room count actually changed (not just 0 to 0)
        if (rooms.length !== previousCount) {
          console.log('[RoomManager] Fetched available rooms:', rooms.length, 'rooms:', rooms.map(r => `${r.id} (${r.playerCount} players)`))
        }
      } else {
        console.error('[RoomManager] Failed to fetch rooms:', response.statusText)
      }
    } catch (error) {
      console.error('[RoomManager] Error fetching rooms:', error)
    } finally {
      setLoadingRooms(false)
      globalIsFetching = false
      isFetchingRef.current = false
    }
  }, [backgroundMode])

  // Initialize socket event listeners (for UI-specific events like countdown)
  useEffect(() => {
    // Wait for socket to be available
    if (!providerSocket) {
      // Socket not ready yet, wait a bit and try again
      const timeout = setTimeout(() => {
        if (providerSocket) {
          socketRef.current = providerSocket
        }
      }, 100)
      return () => clearTimeout(timeout)
    }
    
    const socket = providerSocket
    socketRef.current = socket
    if (!socket) return

    // Listen for room-created event (for UI callbacks)
    socket.on('room-created', ({ roomId: newRoomId, players: roomPlayers, hostUserProfileId: roomHostUserProfileId }) => {
      console.log('[RoomManager] Room created event received:', newRoomId)
      
      // Only call onRoomCreated on first room creation (not on reconnects)
      if (onRoomCreated) {
        console.log('[RoomManager] Calling onRoomCreated for new room:', newRoomId)
        onRoomCreated(newRoomId)
      }
      
      // Only emit 'created' action on first room creation
      if (onRoomStateChange) {
        console.log('[RoomManager] Emitting created action for new room:', newRoomId)
        onRoomStateChange({
          action: 'created',
          roomId: newRoomId,
          players: roomPlayers || [],
          playerCount: roomPlayers?.length || 1,
          isHost: true,
          socketId: socket.id,
          socketConnected: true
        })
      }
    })

    socket.on('game-selected', ({ game, players: gamePlayers, hostUserProfileId: gameHostUserProfileId }) => {
      console.log('[RoomManager] Game selected event received:', game, 'current roomId:', roomId, 'providerRoomId:', providerRoomId)
      
      // Get roomId from URL (single source of truth) or current state
      const urlRoomId = getRoomIdFromUrl()
      const currentRoomId = propRoomId || localRoomId || providerRoomId || roomId || urlRoomId
      console.log('[RoomManager] Using roomId for game-selected:', currentRoomId, 'sources:', {
        propRoomId,
        localRoomId,
        providerRoomId,
        roomId,
        urlRoomId
      })
      
      if (onRoomStateChange && currentRoomId) {
        onRoomStateChange({
          action: 'game-selected',
          game,
          roomId: currentRoomId,
          players: gamePlayers || players,
          playerCount: (gamePlayers || players).length,
          isHost: isHost
        })
      } else {
        console.warn('[RoomManager] Cannot handle game-selected: missing roomId or onRoomStateChange', {
          hasRoomId: !!currentRoomId,
          hasOnRoomStateChange: !!onRoomStateChange,
          currentRoomId,
          propRoomId,
          localRoomId,
          providerRoomId,
          roomId,
          urlRoomId
        })
      }
    })

    socket.on('game-start', ({ game }) => {
      console.log('[RoomManager] Game starting:', game)
      
      if (onRoomStateChange) {
        onRoomStateChange({
          action: 'game-start',
          game,
          roomId,
          players,
          playerCount: players.length,
          isHost
        })
      }
    })

    socket.on('player-kicked', ({ message }) => {
      console.log('[RoomManager] Player kicked:', message)
      setError(message || 'You have been kicked from the room')
      
      if (onRoomStateChange) {
        onRoomStateChange({ action: 'leave' })
      }
    })

    socket.on('room-closed', ({ reason, message }) => {
      console.log('[RoomManager] Room closed:', reason, message)
      setError(message || 'Room closed')
      
      // Get current roomId from multiple sources
      const urlRoomId = getRoomIdFromUrl()
      const currentRoomId = propRoomId || localRoomId || providerRoomId || urlRoomId
      
      // Clear local state
      setShowRoomView(false)
      setLocalRoomId(null)
      clearRoomState()
      
      // Disconnect from room using RoomProvider
      if (profile && currentRoomId) {
        disconnectFromRoom(currentRoomId, profile).catch(err => {
          console.error('[RoomManager] Error disconnecting from room:', err)
        })
      }
      
      // Clear URL parameters
      window.history.replaceState({}, '', window.location.pathname)
      
      // Notify parent
      if (onRoomStateChange) {
        onRoomStateChange({ action: 'leave' })
      }
    })

    socket.on('host-disconnected', ({ message }) => {
      console.log('[RoomManager] Host disconnected:', message)
      setError(message || 'Host disconnected')
    })

    socket.on('host-reconnected', ({ message }) => {
      console.log('[RoomManager] Host reconnected:', message)
      setError(null)
    })

    // Listen for room list updates
    socket.on('room-list-updated', ({ roomId: updatedRoomId, action, room }) => {
      console.log('[RoomManager] Room list updated:', updatedRoomId, action, room)
      // Only refresh room list if not in background mode
      if (!backgroundMode) {
        // Debounce with a small delay to ensure server has processed the change
        if (fetchTimeoutRef.current) {
          clearTimeout(fetchTimeoutRef.current)
        }
        fetchTimeoutRef.current = setTimeout(() => {
          fetchAvailableRooms(true) // Force fetch on room list update
          fetchTimeoutRef.current = null
        }, 500)
      }
    })

    return () => {
      // Clean up listeners on unmount
      socket.off('room-created')
      socket.off('game-selected')
      socket.off('game-start')
      socket.off('player-kicked')
      socket.off('room-closed')
      socket.off('host-disconnected')
      socket.off('host-reconnected')
      socket.off('room-list-updated')
    }
  }, [roomId, propRoomId, localRoomId, providerRoomId, players, isHost, onRoomStateChange, onRoomCreated, backgroundMode, fetchAvailableRooms, profile, disconnectFromRoom])

  // Connect to room when propRoomId is provided and we're not already connected
  // This happens when user opts in to join via URL
  useEffect(() => {
    if (propRoomId && propRoomId !== providerRoomId && socketConnected && profile && !isJoining) {
      // Only connect if we have a propRoomId (user explicitly wants to join)
      // Don't auto-connect for users just viewing the room list
      console.log('[RoomManager] Connecting to room from prop (opt-in join):', propRoomId)
      connectToRoom(propRoomId, profile).then(result => {
        if (!result.success) {
          const errorMessage = result.error || 'Failed to join room'
          // Use modal for room not found errors
          if (errorMessage.toLowerCase().includes('room not found')) {
            setError(errorMessage)
            setShowErrorModal(true)
          } else {
            setError(errorMessage)
          }
        }
      })
    }
  }, [propRoomId, providerRoomId, socketConnected, profile, isJoining, connectToRoom])

  // Fetch connection info (network IP) when hostname is localhost
  useEffect(() => {
    const hostname = window.location.hostname
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1'
    
    if (isLocalhost) {
      // Fetch network IP from server - use same hostname as current page
      const serverUrl = `http://${hostname}:8000`
      
      fetch(`${serverUrl}/api/connection-info`)
        .then(res => res.json())
        .then(data => {
          if (data.url) {
            // Extract just the hostname:port (remove http://)
            const url = data.url.replace(/^https?:\/\//, '')
            setConnectionUrl(url)
          } else {
            setConnectionUrl(window.location.host)
          }
        })
        .catch(error => {
          console.error('[RoomManager] Error fetching connection info:', error)
          setConnectionUrl(window.location.host)
        })
    } else {
      // Use current hostname (already the network IP or domain)
      setConnectionUrl(window.location.host)
    }
  }, [])

  // Fetch rooms when socket connects (even when in a room, so users can see other available rooms)
  // Skip fetching in background mode (background instances just maintain socket connections)
  useEffect(() => {
    if (backgroundMode) {
      return // Don't fetch rooms in background mode
    }
    
    if (!socketConnected) {
      return // Wait for socket connection
    }
    
    // Fetch on initial connection
    if (!hasFetchedOnConnectionRef.current) {
      hasFetchedOnConnectionRef.current = true
      fetchAvailableRooms(true) // Force fetch on connection
      previousRoomIdRef.current = roomId
      return
    }
    
    // When roomId changes (joining or leaving), fetch again after a delay to get updated list
    if (previousRoomIdRef.current !== roomId) {
      previousRoomIdRef.current = roomId
      const timeout = setTimeout(() => {
        fetchAvailableRooms(true)
      }, 500)
      return () => clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socketConnected, roomId, backgroundMode, fetchAvailableRooms]) // Include fetchAvailableRooms in deps

  const handleJoinRoom = async (targetRoomId) => {
    if (!socketConnected || !profile) {
      console.warn('[RoomManager] Cannot join room: socket not connected or no profile')
      setError('Socket not connected or no profile selected')
      return
    }

    if (!connectToRoom) {
      console.error('[RoomManager] connectToRoom method not available')
      setError('Connection method not available')
      return
    }

    console.log('[RoomManager] Joining room:', targetRoomId)
    try {
      const result = await connectToRoom(targetRoomId, profile)
      
      if (result && result.success) {
        setLocalRoomId(result.roomId)
        // Don't automatically show room view - stay on create/join screen
        setShowRoomView(false)
        if (onJoinRoom) {
          onJoinRoom(result.roomId)
        }
      } else {
        const errorMessage = result?.error || 'Failed to join room'
        // Use modal for room not found errors
        if (errorMessage.toLowerCase().includes('room not found')) {
          setError(errorMessage)
          setShowErrorModal(true)
        } else {
          setError(errorMessage)
        }
      }
    } catch (error) {
      console.error('[RoomManager] Error in handleJoinRoom:', error)
      const errorMessage = error.message || 'Failed to join room'
      // Use modal for room not found errors
      if (errorMessage.toLowerCase().includes('room not found')) {
        setError(errorMessage)
        setShowErrorModal(true)
      } else {
        setError(errorMessage)
      }
    }
  }

  const handleCreateRoom = async () => {
    if (!socketConnected || !profile) {
      console.warn('[RoomManager] Cannot create room: socket not connected or no profile', {
        socketConnected,
        hasProfile: !!profile
      })
      setError('Socket not connected or no profile selected')
      return
    }

    if (!createNewRoom) {
      console.error('[RoomManager] createNewRoom method not available')
      setError('Connection method not available')
      return
    }

    console.log('[RoomManager] Creating room with profile:', profile)
    try {
      const result = await createNewRoom(profile)
      
      if (result && result.success) {
        setLocalRoomId(result.roomId)
        // Don't automatically show room view - stay on create/join screen
        setShowRoomView(false)
        if (onCreateRoom) {
          onCreateRoom(result.roomId)
        }
      } else {
        const errorMessage = result?.error || 'Failed to create room'
        // Use modal for room not found errors
        if (errorMessage.toLowerCase().includes('room not found')) {
          setError(errorMessage)
          setShowErrorModal(true)
        } else {
          setError(errorMessage)
        }
      }
    } catch (error) {
      console.error('[RoomManager] Error in handleCreateRoom:', error)
      const errorMessage = error.message || 'Failed to create room'
      // Use modal for room not found errors
      if (errorMessage.toLowerCase().includes('room not found')) {
        setError(errorMessage)
        setShowErrorModal(true)
      } else {
        setError(errorMessage)
      }
    }
  }

  const handleReady = (ready) => {
    if (!socketConnected || !roomId) return
    
    setReady(roomId, ready)
  }

  // Auto-ready for CPU players (also handles game changes)
  const cpuPreviousSelectedGameRef = useRef(selectedGame)
  useEffect(() => {
    if (!roomId || !profile || !socketConnected) return
    
    const isCPU = isCPUProfile(profile)
    if (!isCPU) {
      cpuPreviousSelectedGameRef.current = selectedGame
      return
    }
    
    // Check if game changed (host selected a new game)
    const gameChanged = cpuPreviousSelectedGameRef.current !== selectedGame
    if (gameChanged) {
      console.log('[RoomManager] AutoBot detected game change:', cpuPreviousSelectedGameRef.current, '->', selectedGame)
      cpuPreviousSelectedGameRef.current = selectedGame
    }
    
    // Only auto-ready if a game is selected
    if (!selectedGame) return
    
    const currentPlayer = roomState.getPlayer(profile?.id)
    if (!currentPlayer || currentPlayer.ready) return
    
    // Auto-ready after a short delay (feels more natural)
    // Shorter delay if game just changed (faster response)
    const delay = gameChanged ? 300 + Math.random() * 200 : 500 + Math.random() * 500
    const autoReadyTimer = setTimeout(() => {
      console.log('[RoomManager] AutoBot auto-readying up', gameChanged ? '(game changed)' : '')
      setReady(roomId, true)
    }, delay)
    
    return () => clearTimeout(autoReadyTimer)
  }, [roomId, profile, selectedGame, socketConnected, roomState])

  const handleCloseRoom = () => {
    if (!isHost || !roomId) return
    setShowCloseRoomDialog(true)
  }

  const confirmCloseRoom = async () => {
    if (!isHost || !roomId) return
    
    setShowCloseRoomDialog(false)

    try {
      const serverUrl = `http://${window.location.hostname}:8000`
      const response = await fetch(`${serverUrl}/api/admin/close-room/${roomId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userProfileId: profile?.id })
      })
      
      if (response.ok) {
        console.log('[RoomManager] Room closed successfully')
        
        // Disconnect from room using RoomProvider to clear snapshots
        if (profile) {
          await disconnectFromRoom(roomId, profile)
        }
        
        // Also emit leave-room socket event for cleanup
        if (profile?.id) {
          leaveRoom(roomId, { userProfileId: profile.id })
        }
        
        // Clear URL parameters
        window.history.replaceState({}, '', window.location.pathname)
        
        // Clear localStorage room state
        clearRoomState()
        
        // Clear local room state and notify parent
        if (onRoomStateChange) {
          onRoomStateChange({ action: 'leave' })
        }
        
        // Exit room view and go back to create/join screen
        setShowRoomView(false)
        setLocalRoomId(null)
        setError(null) // Clear any errors
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Failed to close room')
      }
    } catch (error) {
      console.error('[RoomManager] Error closing room:', error)
      setError('Failed to close room')
    }
  }

  const handleKickPlayer = async (userProfileId) => {
    if (!isHost || !roomId || !socketConnected || !socketRef.current) {
      console.warn('[RoomManager] Cannot kick player: missing requirements', { isHost, roomId, socketConnected, hasSocket: !!socketRef.current })
      return
    }
    
    if (!confirm(`Are you sure you want to kick this player?`)) {
      return
    }
    
    console.log('[RoomManager] Kick player requested:', userProfileId, 'from room:', roomId)
    
    // Emit kick-player event - server will emit room-snapshot which will update UI via RoomProvider
    socketRef.current.emit('kick-player', { roomId, userProfileId })
    console.log('[RoomManager] Kick event emitted, waiting for room-snapshot update from server')
  }

  // If in background mode, don't render UI - just maintain socket connection
  if (backgroundMode) {
    return null
  }

  // If no profile, show error
  if (!profile) {
    return (
      <div className="w-full h-screen bg-black flex items-center justify-center text-white pt-large">
        <div className="text-center">
          <p>No profile selected</p>
        </div>
      </div>
    )
  }

  // Show loading state if socket is not connected yet
  if (!socketConnected && !socketRef.current) {
    return (
      <div className="w-full h-screen bg-black flex items-center justify-center text-white pt-large">
        <div className="text-center">
          <p>Connecting to server...</p>
        </div>
      </div>
    )
  }

  // Timeout for join room (moved outside conditional return)
  useEffect(() => {
    if (roomId && roomId !== providerRoomId && socketConnected && isJoining) {
      const timeout = setTimeout(() => {
        if (isJoining) {
          console.warn('[RoomManager] Join room timeout, resetting')
          const errorMessage = 'Failed to join room: timeout. Please try again.'
          setError(errorMessage)
          // Use modal for timeout errors (could be room not found)
          setShowErrorModal(true)
          setLocalRoomId(null) // Clear local roomId on timeout
        }
      }, 15000) // 15 second timeout
      return () => clearTimeout(timeout)
    }
  }, [roomId, providerRoomId, socketConnected, isJoining])

  // If we have a roomId but haven't joined yet, show loading
  if (roomId && roomId !== providerRoomId && socketConnected && isJoining) {
    return (
      <div className="w-full h-screen bg-black flex items-center justify-center text-white pt-large">
        <div className="text-center">
          <p>Joining room {roomId}...</p>
          {error && (
            <div className="mt-4">
              <p className="text-red-500 mb-2">{error}</p>
              <button
                onClick={() => {
                  setError(null)
                  setLocalRoomId(null)
                  window.history.replaceState({}, '', window.location.pathname)
                }}
                className="px-4 py-2 border border-white hover:bg-white hover:text-black transition-all duration-200 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Room management UI
  return (
    <div 
      className="w-full h-screen bg-black flex flex-col items-center justify-start text-white px-medium py-small overflow-y-auto relative"
      style={{ paddingTop: '10vh' }}
    >
      {/* Back to Title Button */}
      {(onBackToTitle || onRoomStateChange) && (!hasValidRoom || !showRoomView) && (
        <button
          onClick={() => {
            // CRITICAL: Keep connection alive when navigating away from lobby
            // Only disconnect if explicitly leaving the room
            console.log('[RoomManager] Back to Title clicked from create/join screen - keeping connection alive')
            keepConnectionAlive()
            
            if (onBackToTitle) {
              onBackToTitle()
            } else if (onRoomStateChange) {
              onRoomStateChange({ action: 'hide' })
            }
          }}
          className="absolute top-20 left-4 px-4 py-2 text-sm font-medium text-white border rounded-lg hover:bg-white hover:text-black transition-all duration-300 cursor-pointer"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.3)',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
            zIndex: 50
          }}
        >
          ← Back to Title
        </button>
      )}

      {!hasValidRoom || !showRoomView ? (
        // Show create/join screen when no roomId or showRoomView is false
        <div className="flex flex-col items-center gap-4 w-full max-w-2xl pt-20">
          <h2 className="text-2xl sm:text-3xl font-bold mb-1">Create or Join Room</h2>
          
          {/* Show current room info if actually connected to a room */}
          {roomId && providerRoomId === roomId && players.length > 0 && (
            <div className="w-full max-w-md p-small border rounded-lg mb-3" style={{
              borderColor: 'rgba(34, 197, 94, 0.5)',
              backgroundColor: 'rgba(34, 197, 94, 0.1)',
              backdropFilter: 'blur(12px)'
            }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-white/80 mb-0.5">You're in room:</p>
                  <p className="text-lg font-bold text-white">{roomId}</p>
                </div>
                <button
                  onClick={() => setShowRoomView(true)}
                  className="px-2 py-1 text-xs border border-white/30 rounded hover:bg-white hover:text-black transition-all duration-200 cursor-pointer touch-manipulation"
                  style={{ 
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(8px)'
                  }}
                >
                  View Room →
                </button>
              </div>
            </div>
          )}
          
          <Button
            onClick={handleCreateRoom}
            variant="secondary"
            size="large"
            className="w-full max-w-md"
            disabled={!socketConnected}
          >
            Create Room
          </Button>

          <div className="w-full max-w-md">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold">Available Rooms</h3>
              <Button
                onClick={() => fetchAvailableRooms(true)}
                variant="secondary"
                size="small"
                style={{
                  borderColor: 'rgba(255, 255, 255, 0.3)',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(12px)'
                }}
                disabled={loadingRooms}
              >
                {loadingRooms ? 'Loading...' : 'Refresh'}
              </Button>
            </div>
            {loadingRooms ? (
              <p className="text-center text-gray-400">Loading rooms...</p>
            ) : (() => {
              // Filter out the current room from available rooms list (handle both string and number IDs)
              const filteredRooms = availableRooms.filter(r => String(r.id) !== String(roomId))
              return filteredRooms.length === 0 ? (
                <p className="text-center text-gray-400">
                  {roomId ? "No other rooms available. Create one to get started!" : "No rooms available. Create one to get started!"}
                </p>
              ) : (
                <div className="space-y-2">
                  {filteredRooms.map((room) => (
                  <button
                    key={room.id}
                    onClick={() => {
                      if (onJoinRoom) {
                        onJoinRoom(room.id)
                      } else {
                        handleJoinRoom(room.id)
                      }
                    }}
                    className="w-full p-small border rounded-lg hover:bg-white hover:text-black transition-all duration-300 cursor-pointer text-left relative overflow-hidden group"
                    style={{
                      borderColor: room.playerCount >= room.maxPlayers ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.3)',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      backdropFilter: 'blur(12px)',
                      boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.1)',
                      opacity: room.playerCount >= room.maxPlayers ? 0.6 : 1
                    }}
                    disabled={!socketConnected || room.playerCount >= room.maxPlayers}
                  >
                    {/* Glass overlay */}
                    <div 
                      className="absolute inset-0 rounded-lg pointer-events-none"
                      style={{
                        background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 50%)',
                        opacity: 0
                      }}
                    />
                    
                    <div className="flex items-center justify-between relative z-10">
                      <div className="flex items-center gap-2">
                        <span className="text-lg sm:text-xl font-mono font-bold">{room.id}</span>
                        <span className="text-xs text-white/70">
                          {room.playerCount}/{room.maxPlayers} players
                        </span>
                        {room.state === 'playing' && (
                          <span className="text-xs px-2 py-1 bg-yellow-500/20 text-yellow-300 rounded-full border border-yellow-500/30">
                            Playing
                          </span>
                        )}
                      </div>
                      {room.playerCount >= room.maxPlayers ? (
                        <span className="text-xs text-white/50">Full</span>
                      ) : (
                        <span className="text-xs font-semibold">Join →</span>
                      )}
                    </div>
                    </button>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>
      ) : hasValidRoom && showRoomView ? (
        // Show room UI when we have a roomId and showRoomView is true
        <div className="flex flex-col items-center gap-4 w-full max-w-2xl pt-medium">
          <div className="w-full flex items-center justify-between">
            <h2 className="text-2xl sm:text-3xl font-bold">Room {roomId}</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  // Request room snapshot refresh from server
                  if (socketRef.current && roomId) {
                    console.log('[RoomManager] Requesting room snapshot refresh for room:', roomId)
                    socketRef.current.emit('request-room-snapshot', { roomId })
                  }
                }}
                className="px-2 py-1 text-xs border border-white/30 rounded hover:bg-white hover:text-black transition-all duration-200 cursor-pointer touch-manipulation"
                style={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(8px)'
                }}
                title="Refresh room data"
                disabled={!socketConnected}
              >
                ↻ Refresh
              </button>
              <button
                onClick={() => {
                  setShowRoomView(false)
                }}
                className="px-2 py-1 text-xs border border-white/30 rounded hover:bg-white hover:text-black transition-all duration-200 cursor-pointer touch-manipulation"
                style={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(8px)'
                }}
                title="Back to create/join screen"
              >
                ← Back
              </button>
              <button
                onClick={() => {
                  // CRITICAL: Keep connection alive - just navigate away WITHOUT disconnecting socket
                  // This allows user to navigate to arcade/game select while staying in the room
                  console.log('[RoomManager] Back to Title clicked - keeping socket connection alive')
                  keepConnectionAlive()
                  
                  // Hide room manager UI but keep socket connected
                  if (onBackToTitle) {
                    onBackToTitle()
                  } else if (onRoomStateChange) {
                    // Fallback: just hide room manager via onRoomStateChange
                    onRoomStateChange({ action: 'hide' })
                  }
                  
                  // DO NOT call disconnectFromRoom - socket should stay connected
                }}
                className="px-2 py-1 text-xs border border-white/30 rounded hover:bg-white hover:text-black transition-all duration-200 cursor-pointer touch-manipulation"
                style={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(8px)'
                }}
                title="Back to title screen (stay in room, keep connection)"
              >
                ← Title
              </button>
            </div>
          </div>
          
          {/* Host Tools Section */}
          {isHost && (
            <div 
              className="w-full p-small border rounded-xl relative overflow-hidden"
              style={{
                borderColor: 'rgba(255, 255, 255, 0.3)',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.1)'
              }}
            >
              {/* Glass overlay */}
              <div 
                className="absolute inset-0 rounded-xl pointer-events-none"
                style={{
                  background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 50%)'
                }}
              />
              
              <h3 className="text-base mb-2 font-bold relative z-10">Host Tools</h3>
              <div className="flex flex-col gap-2 relative z-10">
                <button
                  onClick={handleCloseRoom}
                  className="px-3 py-2 border rounded-lg text-red-400 border-red-500/50 hover:bg-red-500 hover:text-white transition-all duration-300 cursor-pointer font-medium text-sm hover:scale-105"
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    backdropFilter: 'blur(8px)'
                  }}
                  disabled={!socketConnected}
                >
                  Close Room
                </button>
              </div>
            </div>
          )}

          {/* QR Code Section - Share Room URL */}
          {roomId && (() => {
            const fullUrl = `http://${connectionUrl || window.location.host}${window.location.pathname}?room=${roomId}`
            
            const handleCopy = async () => {
              try {
                await navigator.clipboard.writeText(fullUrl)
                setUrlCopied(true)
                setTimeout(() => setUrlCopied(false), 2000)
              } catch (error) {
                console.error('Failed to copy URL:', error)
              }
            }
            
            const handleShare = async () => {
              const shareData = {
                title: 'Join Multiplayer Arcade Room',
                text: `Join me in room ${roomId}!`,
                url: fullUrl
              }
              
              if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
                try {
                  await navigator.share(shareData)
                } catch (error) {
                  if (error.name !== 'AbortError') {
                    console.error('Error sharing:', error)
                    handleCopy()
                  }
                }
              } else {
                handleCopy()
              }
            }
            
            return (
              <div 
                className="w-full p-small border rounded-xl relative overflow-hidden"
                style={{
                  borderColor: 'rgba(255, 255, 255, 0.3)',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.1)'
                }}
              >
                {/* Glass overlay */}
                <div 
                  className="absolute inset-0 rounded-xl pointer-events-none"
                  style={{
                    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 50%)'
                  }}
                />
                
                <div className="flex flex-row items-center gap-4 md:gap-6 relative z-10">
                  {/* Left side - QR Code */}
                  <div className="flex-shrink-0">
                    <QRCode
                      url={fullUrl}
                      size={160}
                      level="M"
                      showUrl={false}
                    />
                  </div>
                  
                  {/* Right side - Title, URL and sharing options */}
                  <div className="flex flex-col items-start gap-3 flex-1 min-w-0">
                    <div className="w-full">
                      <h3 className="text-base font-bold mb-1 text-center md:text-left">Share Room</h3>
                      <p 
                        className="text-xs sm:text-sm font-mono font-bold text-white break-all px-2 mb-3 cursor-pointer hover:text-white/80 transition-colors"
                        onClick={handleCopy}
                        title="Click to copy"
                      >
                        {fullUrl}
                      </p>
                    </div>
                    
                    {/* Sharing Options */}
                    <div className="flex flex-col sm:flex-row gap-2 w-full">
                      <button
                        onClick={handleCopy}
                        className="flex-1 px-3 py-2 text-xs sm:text-sm border rounded-lg text-white border-white/30 hover:bg-white hover:text-black transition-all duration-200 cursor-pointer"
                        style={{
                          backgroundColor: 'rgba(255, 255, 255, 0.1)',
                          backdropFilter: 'blur(8px)'
                        }}
                      >
                        {urlCopied ? '✓ Copied!' : 'Copy Link'}
                      </button>
                      
                      <button
                        onClick={handleShare}
                        className="flex-1 px-3 py-2 text-xs sm:text-sm border rounded-lg text-white border-white/30 hover:bg-white hover:text-black transition-all duration-200 cursor-pointer"
                        style={{
                          backgroundColor: 'rgba(255, 255, 255, 0.1)',
                          backdropFilter: 'blur(8px)'
                        }}
                      >
                        Share
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}

          <div className="w-full">
            <h3 className="text-lg font-bold mb-3">Players ({players.length}/4)</h3>
            <div className="space-y-2">
              {players.map((player) => {
                // Use userProfileId for all player identification
                const isCurrentPlayer = player.userProfileId && profile?.id && 
                  String(player.userProfileId) === String(profile.id)
                const isPlayerHost = hostUserProfileId && player.userProfileId && 
                  String(player.userProfileId) === String(hostUserProfileId)
                
                return (
                  <div 
                    key={player.userProfileId || player.id} 
                    className="p-small border rounded-lg relative overflow-hidden"
                    style={{
                      borderColor: isCurrentPlayer ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.3)',
                      backgroundColor: isCurrentPlayer ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                      backdropFilter: 'blur(12px)',
                      boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.1)'
                    }}
                  >
                    {/* Glass overlay */}
                    <div 
                      className="absolute inset-0 rounded-lg pointer-events-none"
                      style={{
                        background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 50%)'
                      }}
                    />
                    
                    <div className="flex items-center justify-between relative z-10">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{player.emoji || '⚪'}</span>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{player.name || 'Unknown Player'}</span>
                          {isPlayerHost && (
                            <span className="text-xs px-2 py-0.5 text-black bg-white rounded-full font-bold">Host</span>
                          )}
                          {isCurrentPlayer && !isPlayerHost && (
                            <span className="text-xs text-white/60">(You)</span>
                          )}
                          {player.ready && (
                            <span className="text-xs px-2 py-0.5 text-green-300 bg-green-500/20 rounded-full border border-green-500/30">
                              Ready
                            </span>
                          )}
                        </div>
                      </div>
                      {isHost && !isPlayerHost && (
                        <button
                          onClick={() => handleKickPlayer(player.userProfileId || player.id)}
                          className="text-xs px-3 py-1.5 border rounded-lg text-red-400 border-red-500/50 hover:bg-red-500 hover:text-white transition-all duration-300 cursor-pointer font-medium"
                          style={{
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            backdropFilter: 'blur(8px)'
                          }}
                          title="Kick player"
                        >
                          Kick
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>


          <div className="flex gap-3 w-full">
            {onExit && (
              <button
                onClick={async () => {
                  // Actually disconnect from room
                  if (roomId && profile) {
                    await disconnectFromRoom(roomId, profile)
                  }
                  if (onExit) {
                    onExit()
                  }
                }}
                className="flex-1 px-4 py-2.5 border rounded-lg text-red-400 border-red-500/50 hover:bg-red-500 hover:text-white transition-all duration-300 cursor-pointer font-semibold text-sm hover:scale-105"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  backdropFilter: 'blur(12px)'
                }}
              >
                Leave Room
              </button>
            )}
          </div>
        </div>
      ) : (
        // Fallback: should not reach here, but show error if we do
        <div className="flex flex-col items-center gap-4 w-full max-w-md">
          <p className="text-red-500">Error: Invalid room state. roomId: {roomId}, providerRoomId: {providerRoomId}</p>
          <button
            onClick={() => {
              setLocalRoomId(null)
              window.history.replaceState({}, '', window.location.pathname)
            }}
            className="px-4 py-2 border border-white hover:bg-white hover:text-black transition-all duration-200 cursor-pointer"
          >
            Reset
          </button>
        </div>
      )}

      <ConfirmationDialog
        isOpen={showCloseRoomDialog}
        title="Close Room"
        message="Are you sure you want to close this room? All players will be disconnected."
        onConfirm={confirmCloseRoom}
        onCancel={() => setShowCloseRoomDialog(false)}
        confirmText="Close Room"
        cancelText="Cancel"
      />

      <ErrorModal
        isOpen={showErrorModal}
        title="Room Error"
        message={error || 'An error occurred'}
        onClose={() => {
          setShowErrorModal(false)
          setError(null)
        }}
      />
    </div>
  )
}

export default RoomManager

