import { useState, useEffect, useRef } from 'react'
import Menu from './components/Menu'
import RoomManager from './components/RoomManager'
import Pong from './components/Pong'
import MagnetMayhem from './components/MagnetMayhem'
import MemoryGame from './components/MemoryGame'
import Snake from './components/Snake'
import MobileController from './components/MobileController'
import ProfileSelector from './components/ProfileSelector'
import ErrorLogger from './components/ErrorLogger'
import SocketTest from './components/SocketTest'
import AppHUD from './components/AppHUD'
import ServerStatus from './components/ServerStatus'
import PlayerProfile from './components/PlayerProfile'
import GameHUB from './components/GameHUB'
import { RoomProvider, useRoomConnection, useRoom } from './multiplayer/RoomProvider'
import { getCurrentProfile, clearLocalStorageProfiles, clearCurrentProfile, setCurrentProfile } from './utils/profiles'
import { saveRoomState, loadRoomState, clearRoomState } from './utils/roomState'
import { getGame, isMultiplayerGame } from './utils/games'
import { leaveRoom, selectGame } from './multiplayer/roomLifecycle'
import { getSocket } from './utils/socket'
import soundManager from './utils/sounds'

// Helper function to get roomId from URL (single source of truth)
function getRoomIdFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('room')
}

// Helper function to check if mobile controller mode
function isMobileController() {
  const params = new URLSearchParams(window.location.search)
  return params.get('mobile') === 'true'
}

function App() {
  const [currentGame, setCurrentGame] = useState(null)
  const [multiplayerMode, setMultiplayerMode] = useState(null) // null, 'room-manager', or { roomId, isHost, profile }
  const [createdRoomId, setCreatedRoomId] = useState(null)
  const [selectedProfile, setSelectedProfile] = useState(null)
  const [showProfileSelector, setShowProfileSelector] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [pendingRoomId, setPendingRoomId] = useState(null)
  // Persistent room state - persists across game selections
  // Note: roomId is NOT stored here - use getRoomIdFromUrl() or multiplayerMode.roomId instead
  const [roomState, setRoomState] = useState(null) // { isHost, players, playerCount, maxPlayers, inRoom, showRoomManager, selectedGame }
  const [gameScore, setGameScore] = useState(null) // { leftScore, rightScore, leftPlayerStyle, rightPlayerStyle } for Pong
  const [scorePulse, setScorePulse] = useState(false) // Animation state for score changes

  // Check for current profile and URL room parameter on mount
  useEffect(() => {
    // Clear old localStorage profile data on first load (but keep current profile name)
    clearLocalStorageProfiles()
    
    const loadProfile = async () => {
      // getCurrentProfile will load from localStorage if available
      const profile = await getCurrentProfile()
      const params = new URLSearchParams(window.location.search)
      const roomId = params.get('room')
      
      // Load saved room state from localStorage
      const savedRoomState = loadRoomState()
      
      if (profile) {
        setSelectedProfile(profile)
        // Re-activate profile session in database to ensure it's marked as active
        try {
          await setCurrentProfile(profile.name)
        } catch (error) {
          console.error('Error reactivating profile session:', error)
        }
        
        // Priority 1: If we have saved room state, try to restore it
        // Note: savedRoomState.roomId is for backward compatibility - we now get roomId from URL
        const savedRoomId = savedRoomState?.roomId || roomId
        if (savedRoomState && savedRoomId) {
          try {
            // Verify room still exists and user is still in it
            const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
            const apiUrl = `${protocol}//${window.location.hostname}:8000`
            const roomResponse = await fetch(`${apiUrl}/api/rooms/${savedRoomId}`)
            if (roomResponse.ok) {
              const roomData = await roomResponse.json()
              if (roomData.state !== 'ended') {
                // Check if this profile is in the room's players
                const playersResponse = await fetch(`${apiUrl}/api/rooms/${savedRoomId}/players`)
                if (playersResponse.ok) {
                  const players = await playersResponse.json()
                  const userInRoom = players.some(p => 
                    (String(p.user_profile_id) === String(profile.id) || p.user_profile_id === profile.id) && !p.left_at
                  )
                  
                  if (userInRoom) {
                    // User is still in the room - restore connection
                    
                    // Determine if user is host by checking if they're the first player (room creator)
                    // Sort players by joined_at to find the first player (host)
                    const activePlayers = players
                      .filter(p => !p.left_at)
                      .sort((a, b) => new Date(a.joined_at || 0) - new Date(b.joined_at || 0))
                    const userPlayer = activePlayers.find(p => 
                      (String(p.user_profile_id) === String(profile.id) || p.user_profile_id === profile.id)
                    )
                    // Check if this user was the first to join (host)
                    const isHost = savedRoomState.isHost || (userPlayer && activePlayers.indexOf(userPlayer) === 0)
                    
                    // Set room state to trigger rejoin (don't store roomId - get from URL)
                    setRoomState({ 
                      isHost: isHost,
                      inRoom: false, // Will be set to true when socket reconnects
                      showRoomManager: false,
                      players: savedRoomState.players || [],
                      playerCount: savedRoomState.playerCount || 0,
                      maxPlayers: savedRoomState.maxPlayers || 4,
                      selectedGame: savedRoomState.selectedGame || null
                    })
                    // Trigger rejoin by setting multiplayerMode
                    setMultiplayerMode({ 
                      roomId: savedRoomId, 
                      isHost: isHost,
                      profile 
                    })
                    // DON'T restore currentGame from saved state - only restore selectedGame
                    // The game should only start when game-start event is received
                    // This ensures players go through the ready-up process
                    // Update URL if needed (this is now the source of truth for roomId)
                    if (roomId !== savedRoomId) {
                      window.history.replaceState({}, '', `?room=${savedRoomId}`)
                    }
                    return // Exit early, we've restored from saved state
                  }
                }
              }
            }
            // Room doesn't exist or user not in it - clear saved state
            clearRoomState()
          } catch (error) {
            console.error('[App] Error verifying saved room state:', error)
            clearRoomState()
          }
        }
        
        // Priority 2: If there's a room in URL (but no saved state or saved state was invalid), check if user is already in that room
        if (roomId && (!savedRoomState || savedRoomState.roomId !== roomId)) {
          try {
            // Check if this profile is already in the room
            const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
            const apiUrl = `${protocol}//${window.location.hostname}:8000`
            const roomResponse = await fetch(`${apiUrl}/api/rooms/${roomId}`)
            if (roomResponse.ok) {
              const roomData = await roomResponse.json()
              // Check if this profile is in the room's players
              const playersResponse = await fetch(`${apiUrl}/api/rooms/${roomId}/players`)
              if (playersResponse.ok) {
                const players = await playersResponse.json()
                // Check if user is in room (handle both string and number ID comparisons)
                const userInRoom = players.some(p => 
                  (String(p.user_profile_id) === String(profile.id) || p.user_profile_id === profile.id) && !p.left_at
                )
                
                if (userInRoom && roomData.state !== 'ended') {
                  // User is already in the room - auto-rejoin
                  
                  // Determine if user is host by checking if they're the first player
                  // Sort players by joined_at to find the first player (host)
                  const activePlayers = players
                    .filter(p => !p.left_at)
                    .sort((a, b) => new Date(a.joined_at || 0) - new Date(b.joined_at || 0))
                  const userPlayer = activePlayers.find(p => 
                    (String(p.user_profile_id) === String(profile.id) || p.user_profile_id === profile.id)
                  )
                  const isHost = userPlayer && activePlayers.indexOf(userPlayer) === 0
                  
                  // Set room state to trigger rejoin (don't set players - let socket reconnect get them)
                  // Don't store roomId - get from URL
                  setRoomState({ 
                    isHost: isHost,
                    inRoom: false, // Will be set to true when socket reconnects
                    showRoomManager: false
                  })
                  // Trigger rejoin by setting multiplayerMode
                  setMultiplayerMode({ 
                    roomId: roomId, 
                    isHost: isHost,
                    profile 
                  })
                } else {
                  // User not in room or room ended - just set room state without joining
                  setRoomState({ 
                    roomId: roomId, 
                    isHost: false, 
                    inRoom: false,
                    showRoomManager: false
                  })
                }
              } else {
                // Room doesn't exist or error - just set room state (don't store roomId)
                setRoomState({ 
                  isHost: false, 
                  inRoom: false,
                  showRoomManager: false
                })
              }
            } else {
              // Room doesn't exist - just set room state (don't store roomId)
              setRoomState({ 
                isHost: false, 
                inRoom: false,
                showRoomManager: false
              })
            }
          } catch (error) {
            console.error('[App] Error checking room status on refresh:', error)
            // On error, just set room state without auto-joining (don't store roomId)
            setRoomState({ 
              isHost: false, 
              inRoom: false,
              showRoomManager: false
            })
          }
        }
      }
      // Store room ID if present, to join after profile selection
      if (roomId && !profile) {
        setPendingRoomId(roomId)
      }
    }
    
    loadProfile()
  }, [])

  // Track if there's a roomId in URL that user hasn't joined yet
  // This allows us to show an opt-in prompt instead of auto-joining
  const [pendingRoomJoin, setPendingRoomJoin] = useState(null)
  
  useEffect(() => {
    const roomId = getRoomIdFromUrl()
    if (roomId && selectedProfile && !multiplayerMode) {
      // Check if user is already in this room
      const checkRoomStatus = async () => {
        try {
          const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
          const apiUrl = `${protocol}//${window.location.hostname}:8000`
          const roomResponse = await fetch(`${apiUrl}/api/rooms/${roomId}`)
          if (roomResponse.ok) {
            const roomData = await roomResponse.json()
            if (roomData.state !== 'ended') {
              const playersResponse = await fetch(`${apiUrl}/api/rooms/${roomId}/players`)
              if (playersResponse.ok) {
                const players = await playersResponse.json()
                const userInRoom = players.some(p => 
                  (String(p.user_profile_id) === String(selectedProfile.id) || p.user_profile_id === selectedProfile.id) && !p.left_at
                )
                
                if (userInRoom) {
                  // User is already in room - auto-rejoin (existing behavior)
                  console.log('[App] User already in room, auto-rejoining:', roomId)
                  setMultiplayerMode({
                    roomId: roomId,
                    isHost: false, // Will be determined when joining
                    profile: selectedProfile
                  })
                  if (!roomState) {
                    setRoomState({
                      isHost: false,
                      inRoom: false,
                      showRoomManager: false
                    })
                  }
                } else {
                  // User not in room - show opt-in prompt
                  console.log('[App] Room ID in URL, showing opt-in prompt:', roomId)
                  setPendingRoomJoin({
                    roomId: roomId,
                    roomData: roomData,
                    playerCount: players.length,
                    maxPlayers: roomData.maxPlayers || 4
                  })
                }
              }
            }
          }
        } catch (error) {
          console.error('[App] Error checking room status:', error)
        }
      }
      
      checkRoomStatus()
    } else if (!roomId) {
      // Clear pending join if roomId is removed from URL
      setPendingRoomJoin(null)
    }
  }, [selectedProfile, multiplayerMode, roomState])

  const handleSelectGame = async (game) => {
    // Special handling for socket-test - always allow it regardless of room state
    if (game === 'socket-test') {
      console.log('[App] Socket Test selected - setting currentGame to socket-test')
      setCurrentGame('socket-test')
      return
    }
    
    // If host is in a room, update room state FIRST before setting currentGame
    // This ensures RoomManager is still mounted and can emit the socket event
    const roomId = getRoomIdFromUrl() || multiplayerMode?.roomId
    console.log('[App] handleSelectGame called:', { game, roomId, isHost: roomState?.isHost, currentRoomState: roomState })
    if (roomId && roomState?.isHost) {
      // Clear currentGame to ensure we show the ready screen, not the game
      setCurrentGame(null)
      // Update room state with selected game FIRST (before setCurrentGame)
      // RoomManager will detect the prop change and emit the socket event
      // DON'T set currentGame yet - wait for ready-up and game-start event
      setRoomState(prev => {
        const newState = { ...prev, selectedGame: game, inRoom: true }
        console.log('[App] Updating roomState.selectedGame to:', game, 'newState:', newState)
        saveRoomState(newState)
        return newState
      })
      // DON'T set currentGame here - wait for ready-up and game-start event
      // The game will start when game-start event is received (handled in handleRoomStateChange)
    } else {
      // Not in a room or not host - just set the game normally
      setCurrentGame(game)
      console.warn('[App] Cannot broadcast game selection:', { roomId, isHost: roomState?.isHost })
    }
  }

  const handleBackToMenu = () => {
    soundManager.playNavigate()
    setCurrentGame(null)
    // Resume music if it was enabled (will be handled by Menu component's useEffect)
    
    // If host is in a room, broadcast that we're going back to menu
    const roomId = getRoomIdFromUrl() || multiplayerMode?.roomId
    const isHost = roomState?.isHost || multiplayerMode?.isHost || false
    const inRoom = roomState?.inRoom || !!roomId
    
    console.log('[App] handleBackToMenu called:', { roomId, isHost, inRoom, roomState, multiplayerMode })
    
    if (inRoom && isHost && roomId) {
      console.log('[App] Host going back - broadcasting to other players')
      
      // Update room state to clear selected game
      setRoomState(prev => {
        const newState = prev ? { ...prev, selectedGame: null } : null
        if (newState) {
          saveRoomState(newState)
        }
        return newState
      })
      
      // Emit socket event to notify other players
      try {
        const socket = getSocket()
        if (socket && socket.connected) {
          console.log('[App] Emitting game-selected with null game to room:', roomId)
          selectGame(roomId, null)
        } else {
          console.warn('[App] Socket not connected, cannot broadcast game-selected')
        }
      } catch (error) {
        console.error('[App] Error emitting game-selected:', error)
      }
    }
    
    // Don't clear room state - it should persist
    // Only clear multiplayerMode if it was a specific game mode
    if (multiplayerMode && typeof multiplayerMode === 'object' && multiplayerMode.gameType) {
      setMultiplayerMode(null)
    }
    // Clear URL params but keep room if in one
    if (!inRoom) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }

  const handleProfileSelected = (profile) => {
    setSelectedProfile(profile)
    setShowProfileSelector(false)
    
    // If there was a pending room ID, set up room state but don't auto-join
    // User can manually join the room from the menu if they want
    if (pendingRoomId) {
      setRoomState({ 
        roomId: pendingRoomId, 
        isHost: false, 
        inRoom: false, // Don't auto-join, just store the room ID
        showRoomManager: false // Don't auto-show room manager
      })
      setPendingRoomId(null)
    }
    // Don't set multiplayerMode - let user choose what to do from the menu
  }

  const handleSwitchProfile = async () => {
    // Clear current profile session before switching
    await clearCurrentProfile()
    setShowProfileSelector(true)
  }

  const handleLogout = async () => {
    // First, leave the room if we're in one
    const roomId = getRoomIdFromUrl() || multiplayerMode?.roomId
    const profile = await getCurrentProfile()
    
    if (roomId && profile) {
      try {
        // Leave the room via socket
        await leaveRoom(roomId, { userProfileId: profile.id })
        console.log('[App] Left room during logout:', roomId)
      } catch (error) {
        console.error('[App] Error leaving room during logout:', error)
        // Continue with logout even if leaving room fails
      }
      
      // Clear room state
      handleRoomStateChange({ action: 'leave' })
    }
    
    // Clear current profile session and return to menu
    await clearCurrentProfile()
    setSelectedProfile(null)
    setCurrentGame(null) // Also clear any active game
  }

  const handleExitProfileSelector = () => {
    setShowProfileSelector(false)
    // If no profile is selected and we're not in a game, go back to menu
    if (!selectedProfile && !currentGame && !multiplayerMode) {
      // Already at menu, just close the selector
    }
  }

  const handleCreateRoom = async (roomId) => {
    const profile = await getCurrentProfile()
    if (!profile) {
      setShowProfileSelector(true)
      return
    }
    // If roomId is provided, update multiplayerMode with it
    // Otherwise set to creating mode (roomId will be set when room-created event fires)
    if (roomId) {
      setMultiplayerMode({ roomId, isHost: true, profile })
      window.history.pushState({}, '', `?room=${roomId}`)
    } else {
      setMultiplayerMode({ roomId: null, isHost: true, profile })
    }
  }

  const handleRoomStateChange = async ({ action, roomId, players, playerCount, isHost, game }) => {
    // Check for profile before allowing room operations
    // But allow 'show' action if user is already in a room (has roomId in URL)
    const profile = await getCurrentProfile()
    const currentRoomId = getRoomIdFromUrl()
    if (!profile && (action === 'create' || action === 'join' || (action === 'show' && !currentRoomId))) {
      setShowProfileSelector(true)
      return
    }
    
    if (action === 'create') {
      const newState = { 
        showRoomManager: true,
        inRoom: false,
        isHost: true // Set isHost to true when creating a room
      }
      setRoomState(newState)
      saveRoomState(newState)
    } else if (action === 'join') {
      // Update URL with roomId (single source of truth)
      if (roomId) {
        window.history.pushState({}, '', `?room=${roomId}`)
      }
      
      const newState = { 
        showRoomManager: true,
        inRoom: false,
        isHost: isHost || false // Include isHost if provided (for REST API created rooms)
      }
      setRoomState(newState)
      saveRoomState(newState)
      
      // Set multiplayerMode so RoomManager can join the room
      if (roomId) {
        getCurrentProfile().then(profile => {
          if (profile) {
            setMultiplayerMode({ 
              roomId, 
              isHost: isHost || false, 
              profile
            })
          }
        })
      }
    } else if (action === 'created') {
      console.log('[App] handleRoomStateChange created action - prev showRoomManager:', roomState?.showRoomManager)
      setRoomState(prev => {
        // IMPORTANT: Preserve showRoomManager if user explicitly hid it (clicked "← Title")
        // Only set showRoomManager to false on initial room creation, not on re-emits
        const shouldShowRoomManager = prev?.showRoomManager === false ? false : false
        const newState = { 
          ...prev, // Preserve all previous state
          isHost: true,
          inRoom: true,
          players: players || prev?.players || [],
          playerCount: playerCount || prev?.playerCount || 1,
          maxPlayers: 4,
          showRoomManager: shouldShowRoomManager, // Hide room manager and return to title screen
          socketId: action.socketId || prev?.socketId,
          socketConnected: action.socketConnected !== undefined ? action.socketConnected : prev?.socketConnected
        }
        console.log('[App] created action - new state:', { showRoomManager: newState.showRoomManager, inRoom: newState.inRoom, prevWasFalse: prev?.showRoomManager === false })
        saveRoomState(newState) // Save to localStorage with host status
        return newState
      })
      setCreatedRoomId(roomId)
      window.history.pushState({}, '', `?room=${roomId}`)
      // Keep multiplayerMode set so RoomManager stays mounted and socket stays connected
      if (multiplayerMode && multiplayerMode.roomId === roomId) {
        setMultiplayerMode(prev => prev ? { ...prev, players: players || [], isHost: true } : null)
      } else if (!multiplayerMode) {
        getCurrentProfile().then(profile => {
          if (profile) {
            setMultiplayerMode({ 
              roomId, 
              isHost: true, 
              profile,
              players: players || []
            })
          }
        })
      }
    } else if (action === 'joined') {
      // Clear pending join prompt since user has now joined
      setPendingRoomJoin(null)
      
      const newState = { 
        isHost: isHost || false,
        inRoom: true,
        players: players || [],
        playerCount: playerCount || 1,
        maxPlayers: 4,
        showRoomManager: false, // Hide room manager and return to title screen
        selectedGame: game || null, // Include selectedGame if provided
        socketId: action.socketId,
        socketConnected: action.socketConnected
      }
      setRoomState(newState)
      saveRoomState(newState) // Save to localStorage with host status
      window.history.pushState({}, '', `?room=${roomId}`)
      
      // DON'T automatically start the game when joining - wait for ready-up and game-start event
      // The game will start when game-start event is received (handled in game-start action)
      
      // Keep multiplayerMode set so RoomManager stays mounted and socket stays connected
      // Only update the profile if needed
      if (multiplayerMode && multiplayerMode.roomId === roomId) {
        // Already set, just update players if needed
        setMultiplayerMode(prev => prev ? { ...prev, players: players || [], isHost: isHost || false } : null)
      } else if (!multiplayerMode) {
        // Not set, but we need to keep RoomManager mounted - set it with current profile
        getCurrentProfile().then(profile => {
          if (profile) {
            setMultiplayerMode({ 
              roomId, 
              isHost: isHost || false, 
              profile,
              players: players || []
            })
          }
        })
      }
    } else if (action === 'players-updated') {
      console.log('[App] players-updated action received, players:', players, 'playerCount:', playerCount)
      setRoomState(prev => {
        const newState = {
          ...prev,
          players: players || prev?.players || [],
          playerCount: playerCount || prev?.playerCount || 0,
          socketId: action.socketId || prev?.socketId,
          socketConnected: action.socketConnected !== undefined ? action.socketConnected : prev?.socketConnected
        }
        console.log('[App] Updated roomState with players:', newState.players)
        saveRoomState(newState) // Save updated state
        return newState
      })
    } else if (action === 'show') {
      console.log('[App] handleRoomStateChange show action - setting showRoomManager to true')
      setRoomState(prev => {
        const newState = prev ? { 
          ...prev,
          showRoomManager: true
        } : { 
          showRoomManager: true,
          inRoom: false
        }
        console.log('[App] show action - new state:', { showRoomManager: newState.showRoomManager, inRoom: newState.inRoom })
        saveRoomState(newState)
        return newState
      })
    } else if (action === 'hide') {
      console.log('[App] handleRoomStateChange hide action - setting showRoomManager to false')
      setRoomState(prev => {
        if (!prev) return null
        const newState = { 
          ...prev, 
          showRoomManager: false,
          inRoom: true // Ensure inRoom is true so Menu shows with RoomManager in background
        }
        console.log('[App] hide action - new state:', { showRoomManager: newState.showRoomManager, inRoom: newState.inRoom })
        saveRoomState(newState)
        return newState
      })
    } else if (action === 'game-selected') {
      // Host selected a game - update room state but DON'T start the game yet
      // Players need to ready up first
      // game parameter comes from the action, roomId may also be provided
      console.log('[App] Handling game-selected action:', { game, roomId })
      if (game) {
        // Get roomId from action parameter, URL, or multiplayerMode
        const finalRoomId = roomId || getRoomIdFromUrl() || multiplayerMode?.roomId
        
        if (!finalRoomId) {
          console.error('[App] Cannot handle game-selected: no roomId available')
          return
        }
        
        // Update both states - React will batch these updates
        // If roomState is null, initialize it (but don't store roomId - get from URL)
        // IMPORTANT: Preserve isHost from prev state if it exists
        setRoomState(prev => {
          const newState = prev ? {
            ...prev, 
            selectedGame: game, 
            inRoom: true
          } : {
            isHost: false, // Non-hosts won't have isHost set initially
            inRoom: true,
            selectedGame: game,
            players: [],
            playerCount: 0,
            maxPlayers: 4,
            showRoomManager: false
          }
          const isHostValue = newState.isHost || false
          console.log('[App] handleRoomStateChange game-selected: updating roomState.selectedGame to:', game, 'newState:', newState)
          saveRoomState(newState)
          
          // Ensure multiplayerMode is set so RoomManager stays mounted
          // This is critical for non-hosts to maintain socket connection
          if (!multiplayerMode || (multiplayerMode && typeof multiplayerMode === 'object' && multiplayerMode.roomId !== finalRoomId)) {
            getCurrentProfile().then(profile => {
              if (profile) {
                setMultiplayerMode({ 
                  roomId: finalRoomId, 
                  isHost: isHostValue, 
                  profile
                })
              }
            })
          }
          
          return newState
        })
        
        // DON'T set currentGame yet - wait for ready-up and countdown
        // The game will start when game-start event is received
      } else {
        // Host went back to menu
        setCurrentGame(null)
        setRoomState(prev => {
          const newState = { ...prev, selectedGame: null }
          saveRoomState(newState)
          return newState
        })
      }
    } else if (action === 'game-start') {
      // Game start event received after countdown - now start the game for all players
      console.log('[App] Handling game-start action:', { game, roomId })
      if (game) {
        // Get roomId from action parameter, URL, or multiplayerMode
        const finalRoomId = roomId || getRoomIdFromUrl() || multiplayerMode?.roomId
        
        if (!finalRoomId) {
          console.error('[App] Cannot handle game-start: no roomId available')
          return
        }
        
        // Update room state
        setRoomState(prev => {
          const newState = prev ? {
            ...prev,
            selectedGame: game,
            inRoom: true
          } : {
            isHost: false,
            inRoom: true,
            selectedGame: game,
            players: [],
            playerCount: 0,
            maxPlayers: 4,
            showRoomManager: false
          }
          saveRoomState(newState)
          
          // Ensure multiplayerMode is set
          if (!multiplayerMode || (multiplayerMode && typeof multiplayerMode === 'object' && multiplayerMode.roomId !== finalRoomId)) {
            getCurrentProfile().then(profile => {
              if (profile) {
                setMultiplayerMode({ 
                  roomId: finalRoomId, 
                  isHost: newState.isHost || false, 
                  profile
                })
              }
            })
          }
          
          return newState
        })
        
        // Now start the game - this will trigger re-render and show the game
        setCurrentGame(game)
      }
    } else if (action === 'leave') {
      setRoomState(null)
      clearRoomState() // Clear from localStorage
      setCreatedRoomId(null)
      setMultiplayerMode(null) // Clear multiplayer mode when leaving room
      setCurrentGame(null) // Clear game when leaving room
      window.history.replaceState({}, '', window.location.pathname)
    }
  }

  // Listen for room-closed and room-left events directly in App.jsx to ensure all players are notified
  // This ensures immediate response even if RoomManager is not mounted
  useEffect(() => {
    const socket = getSocket()
    
    const handleRoomClosed = ({ reason, message, roomId: closedRoomId }) => {
      console.log('[App] Room closed event received:', { reason, message, closedRoomId })
      
      // Always clear state when room-closed is received
      // The server ensures only relevant players receive this event
      console.log('[App] Room closed - clearing state and returning to title')
      
      // Clear all room-related state directly (avoiding closure issues)
      setRoomState(null)
      clearRoomState() // Clear from localStorage
      setCreatedRoomId(null)
      setMultiplayerMode(null)
      setCurrentGame(null)
      window.history.replaceState({}, '', window.location.pathname)
    }
    
    const handleRoomClosedBroadcast = ({ roomId: closedRoomId, reason, message }) => {
      console.log('[App] Room closed broadcast received:', { closedRoomId, reason, message })
      // Check if this broadcast is for our room by checking URL (always fresh)
      const urlRoomId = getRoomIdFromUrl()
      if (closedRoomId && urlRoomId && String(closedRoomId) === String(urlRoomId)) {
        console.log('[App] Room closed broadcast matches our room - clearing state')
        setRoomState(null)
        clearRoomState()
        setCreatedRoomId(null)
        setMultiplayerMode(null)
        setCurrentGame(null)
        window.history.replaceState({}, '', window.location.pathname)
      }
    }
    
    // Listen for room-left confirmation (sent to the leaving player)
    // This triggers UI update to go back to title screen and refresh state
    const handleRoomLeft = ({ roomId: leftRoomId, success, message }) => {
      console.log('[App] Room-left confirmation received:', { roomId: leftRoomId, success, message })
      
      // Check if this is for our current room
      const urlRoomId = getRoomIdFromUrl()
      const matches = leftRoomId && (urlRoomId && String(leftRoomId) === String(urlRoomId) || !urlRoomId)
      
      if (matches) {
        console.log('[App] Room-left matches our room - clearing state and navigating to title')
        
        // CRITICAL: Clear state in the correct order to ensure render logic evaluates correctly
        // 1. Clear currentGame FIRST (this is checked last in render, but we want it cleared)
        setCurrentGame(null)
        
        // 2. Clear multiplayerMode (this is checked before currentGame in render logic)
        setMultiplayerMode(null)
        
        // 3. Clear roomState (this affects render conditions)
        setRoomState(null)
        clearRoomState() // Clear from localStorage
        
        // 4. Clear other state
        setCreatedRoomId(null)
        
        // 5. Clear URL (this affects getRoomIdFromUrl() checks in render)
        window.history.replaceState({}, '', window.location.pathname)
        
        // Force React to process all state updates by using a flush
        // This ensures the component re-renders with the new state
        setTimeout(() => {
          // Force a re-render by updating a state that triggers render
          // The state updates above should trigger re-render, but this ensures it
          console.log('[App] Room-left: State cleared, UI should now show Menu')
        }, 0)
      }
    }
    
    socket.on('room-closed', handleRoomClosed)
    socket.on('room-closed-broadcast', handleRoomClosedBroadcast)
    socket.on('room-left', handleRoomLeft)
    
    return () => {
      socket.off('room-closed', handleRoomClosed)
      socket.off('room-closed-broadcast', handleRoomClosedBroadcast)
      socket.off('room-left', handleRoomLeft)
    }
  }, []) // Empty deps - state setters are stable

  const handleRoomCreated = (roomId) => {
    // Only call handleRoomStateChange if we don't already have this roomId
    // This prevents resetting showRoomManager when user has clicked "← Title"
    const currentRoomId = getRoomIdFromUrl() || multiplayerMode?.roomId
    if (roomId !== currentRoomId) {
      console.log('[App] handleRoomCreated called for new room:', roomId, 'current room:', currentRoomId)
      handleRoomStateChange({ action: 'created', roomId })
    } else {
      console.log('[App] handleRoomCreated called for existing room:', roomId, '- skipping to prevent state reset')
    }
  }

  const handleJoinRoom = async (roomId) => {
    // Clear pending join prompt if user manually joins
    setPendingRoomJoin(null)
    const profile = await getCurrentProfile()
    if (!profile) {
      setShowProfileSelector(true)
      return
    }
    handleRoomStateChange({ action: 'join', roomId })
  }

  const handleLeaveRoom = () => {
    handleRoomStateChange({ action: 'leave' })
  }

  const handleBackToTitle = () => {
    // Hide room manager but keep room state (stay in room)
    // CRITICAL: Keep socket connection alive - don't disconnect when navigating
    console.log('[App] handleBackToTitle called, hiding RoomManager - keeping socket connection alive')
    
    // Get RoomProvider's keepConnectionAlive method if available
    try {
      const { useRoomConnection } = require('./multiplayer/RoomProvider')
      // We can't use hooks here, but RoomManager will call keepConnectionAlive
    } catch (e) {
      // RoomProvider not available, continue anyway
    }
    
    handleRoomStateChange({ action: 'hide' })
  }

  const handleExitMultiplayer = () => {
    setMultiplayerMode(null)
    setCreatedRoomId(null)
    // Clear URL params
    window.history.replaceState({}, '', window.location.pathname)
  }


  // Check if mobile controller mode
  const mobileMode = isMobileController()
  const mobileRoomId = mobileMode ? getRoomIdFromUrl() : null

  // Component to handle game rejoin when player refreshes during active game
  function RejoinGameHandler({ onGameStart, currentGame }) {
    const roomId = getRoomIdFromUrl()
    const roomSnapshot = useRoom(roomId)
    const hasRejoinedRef = useRef(false)
    
    useEffect(() => {
      // If room is playing and has a selected game, automatically start the game
      // Only do this once and only if we're not already in a game
      if (
        roomSnapshot && 
        roomSnapshot.status === 'playing' && 
        roomSnapshot.selectedGame &&
        !currentGame &&
        !hasRejoinedRef.current
      ) {
        console.log('[App] Detected active game on rejoin, restoring game:', roomSnapshot.selectedGame)
        hasRejoinedRef.current = true
        if (onGameStart) {
          onGameStart(roomSnapshot.selectedGame, roomId)
        }
      }
      
      // Reset the flag if we leave the room
      if (!roomId) {
        hasRejoinedRef.current = false
      }
    }, [roomSnapshot?.status, roomSnapshot?.selectedGame, roomId, currentGame, onGameStart])
    
    return null
  }

  // Component to handle opt-in room join (needs to be inside RoomProvider to access connectToRoom)
  function OptInRoomJoin({ pendingRoomJoin, selectedProfile, onJoin, onCancel }) {
    const { connectToRoom, socketConnected, activeRoomId } = useRoomConnection()
    const roomState = useRoom(pendingRoomJoin?.roomId)
    
    const handleJoin = async () => {
      if (!socketConnected || !selectedProfile) {
        console.warn('[OptInRoomJoin] Cannot join: socket not connected or no profile')
        return
      }
      
      try {
        const result = await connectToRoom(pendingRoomJoin.roomId, selectedProfile)
        if (result.success) {
          // Wait a moment for room-snapshot to arrive before calling onJoin
          // This ensures AppHUD has the room state when it re-renders
          setTimeout(() => {
            onJoin()
          }, 100)
        } else {
          console.error('[OptInRoomJoin] Failed to join room:', result.error)
          // Still call onJoin to clear the prompt, error will be shown by RoomManager
          onJoin()
        }
      } catch (error) {
        console.error('[OptInRoomJoin] Error joining room:', error)
        onJoin()
      }
    }
    
    // Auto-dismiss if we successfully joined (activeRoomId matches and we have players)
    useEffect(() => {
      if (pendingRoomJoin && activeRoomId === pendingRoomJoin.roomId && roomState?.players?.length > 0) {
        console.log('[OptInRoomJoin] Detected successful join, auto-dismissing prompt')
        onJoin()
      }
    }, [pendingRoomJoin, activeRoomId, roomState?.players?.length, onJoin])
    
    if (!pendingRoomJoin) return null
    
    return (
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        style={{ padding: 'var(--spacing-large)' }}
      >
        <div 
          className="w-full max-w-md p-large border rounded-xl relative overflow-hidden"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.3)',
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 4px 15px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.1)'
          }}
        >
          <div className="flex flex-col items-center gap-4">
            <h2 className="text-2xl font-bold text-white">Join Room?</h2>
            <div className="w-full text-center">
              <p className="text-white/80 mb-2">Room ID:</p>
              <p className="text-xl font-mono font-bold text-white mb-4">{pendingRoomJoin.roomId}</p>
              <p className="text-sm text-white/70">
                {pendingRoomJoin.playerCount}/{pendingRoomJoin.maxPlayers} players
              </p>
              {pendingRoomJoin.roomData?.state === 'playing' && (
                <p className="text-xs text-yellow-300 mt-2 px-2 py-1 bg-yellow-500/20 rounded-full border border-yellow-500/30 inline-block">
                  Game in progress
                </p>
              )}
            </div>
            <div className="flex gap-3 w-full">
              <button
                onClick={handleJoin}
                disabled={!socketConnected}
                className="flex-1 px-4 py-3 border rounded-lg text-white border-white/50 hover:bg-white hover:text-black transition-all duration-300 cursor-pointer font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(8px)'
                }}
              >
                {socketConnected ? 'Join Room' : 'Connecting...'}
              </button>
              <button
                onClick={onCancel}
                className="flex-1 px-4 py-3 border rounded-lg text-white/70 border-white/30 hover:bg-white/10 hover:text-white transition-all duration-300 cursor-pointer font-semibold text-sm"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  backdropFilter: 'blur(8px)'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <RoomProvider>
      <RejoinGameHandler 
        currentGame={currentGame}
        onGameStart={(game, roomId) => {
          console.log('[App] RejoinGameHandler: Starting game on rejoin:', game)
          handleRoomStateChange({ action: 'game-start', game, roomId })
        }} 
      />
      <div className="w-full h-full bg-black flex items-center justify-center overflow-hidden">
        <AppHUD 
          onShowProfile={() => setShowProfile(true)}
          onSwitchProfile={handleSwitchProfile}
          onShowRoom={() => handleRoomStateChange({ action: 'show' })}
          onLogout={handleLogout}
        />
        <ErrorLogger />
        <ServerStatus />
        
        {/* Opt-in join prompt when room ID is in URL but user hasn't joined */}
        <OptInRoomJoin
          pendingRoomJoin={pendingRoomJoin}
          selectedProfile={selectedProfile}
          onJoin={() => {
            // Set up multiplayerMode after successful join
            // This ensures RoomManager mounts and can receive room-snapshot events
            if (pendingRoomJoin) {
              const roomId = pendingRoomJoin.roomId
              setMultiplayerMode({
                roomId: roomId,
                isHost: false,
                profile: selectedProfile
              })
              // Set minimal room state so RoomManager can mount
              // The room-snapshot event will update this with full player data
              setRoomState({
                roomId: roomId,
                isHost: false,
                inRoom: true, // Mark as in room so AppHUD can show it
                showRoomManager: false,
                players: [], // Will be populated by room-snapshot
                playerCount: 0,
                maxPlayers: 4
              })
            }
            setPendingRoomJoin(null)
          }}
          onCancel={() => {
            // User doesn't want to join - clear URL and dismiss
            window.history.replaceState({}, '', window.location.pathname)
            setPendingRoomJoin(null)
          }}
        />
        
      {showProfile && selectedProfile ? (
        <PlayerProfile
          player={{
            userProfileId: selectedProfile.id,
            emoji: selectedProfile.animal || '⚪',
            color: selectedProfile.color || '#FFFFFF',
            name: selectedProfile.name
          }}
          isCurrentPlayer={true}
          onClose={() => setShowProfile(false)}
          onLogout={handleLogout}
        />
      ) : mobileMode && mobileRoomId ? (
        <MobileController
          roomId={mobileRoomId}
          playerName={selectedProfile?.name || 'Mobile Player'}
          profile={selectedProfile}
        />
      ) : showProfileSelector ? (
        <ProfileSelector
          onProfileSelected={handleProfileSelected}
          onExit={handleExitProfileSelector}
        />
      ) : currentGame === 'socket-test' ? (
        <div className="flex flex-col items-center">
          <button
            onClick={handleBackToMenu}
            className="mb-4 px-6 py-2 text-white border border-white hover:bg-white hover:text-black transition-all duration-200 cursor-pointer"
          >
            ← Back to Menu
          </button>
          <SocketTest />
        </div>
      ) : currentGame && isMultiplayerGame(currentGame) && (getRoomIdFromUrl() || multiplayerMode?.roomId) ? (
        // Render multiplayer games
        (() => {
          const game = getGame(currentGame)
          if (!game) return null
          
          // Get roomId from URL (single source of truth) or multiplayerMode fallback
          const gameRoomId = getRoomIdFromUrl() || multiplayerMode?.roomId
          
          const commonProps = {
            roomId: gameRoomId,
            isHost: roomState?.isHost || false,
            onLeave: handleLeaveRoom,
            onRoomCreated: handleRoomCreated,
            playerName: selectedProfile?.name || 'Player',
            players: roomState?.players || []
          }
          
          return (
            <>
              <GameHUB 
                onBack={handleBackToMenu}
                currentGame={currentGame}
                gameScore={gameScore}
                scorePulse={scorePulse}
              />
              {game.id === 'pong' && <Pong {...commonProps} onScoreUpdate={setGameScore} onScorePulse={setScorePulse} />}
              {game.id === 'magnet-mayhem' && <MagnetMayhem {...commonProps} />}
              {game.id === 'memory' && <MemoryGame {...commonProps} onScoreUpdate={setGameScore} />}
              {game.id === 'snake' && <Snake {...commonProps} onScoreUpdate={setGameScore} onScorePulse={setScorePulse} />}
              {/* Keep RoomManager mounted in background during gameplay to receive socket events */}
              {gameRoomId && selectedProfile && (
                <RoomManager 
                  onJoinRoom={handleJoinRoom} 
                  onCreateRoom={handleCreateRoom}
                  onExit={handleLeaveRoom}
                  onBackToTitle={handleBackToTitle}
                  profile={selectedProfile}
                  roomId={gameRoomId}
                  isHost={roomState?.isHost || multiplayerMode?.isHost || false}
                  onRoomCreated={handleRoomCreated}
                  onRoomStateChange={handleRoomStateChange}
                  roomPlayers={roomState?.players}
                  selectedGame={roomState?.selectedGame || currentGame}
                  backgroundMode={true}
                />
              )}
            </>
          )
        })()
      ) : multiplayerMode === 'room-manager' ? (
        !selectedProfile ? (
          <Menu
            onSelectGame={handleSelectGame}
            currentProfile={selectedProfile}
            onSwitchProfile={handleSwitchProfile}
            onLogout={handleLogout}
            roomState={roomState}
            onRoomStateChange={handleRoomStateChange}
          />
        ) : (
          <RoomManager 
            onJoinRoom={handleJoinRoom} 
            onCreateRoom={handleCreateRoom}
            onExit={handleExitMultiplayer}
            onBackToTitle={handleBackToTitle}
            profile={selectedProfile}
          />
        )
      ) : roomState?.showRoomManager === true ? (
        // User explicitly requested to show room manager (clicked RoomHUD)
        // Show RoomManager even if not in a room - it will show create/join screen
        (() => {
          const selectedGameProp = roomState?.selectedGame || currentGame
          // Get roomId from URL as fallback if multiplayerMode.roomId is not available
          const urlRoomId = getRoomIdFromUrl()
          const actualRoomId = (multiplayerMode && typeof multiplayerMode === 'object' && !multiplayerMode.gameType) 
            ? (multiplayerMode.roomId || urlRoomId || roomState?.roomId)
            : (urlRoomId || roomState?.roomId)
          const actualProfile = (multiplayerMode && typeof multiplayerMode === 'object' && !multiplayerMode.gameType)
            ? (multiplayerMode.profile || selectedProfile)
            : selectedProfile
          const actualIsHost = (multiplayerMode && typeof multiplayerMode === 'object' && !multiplayerMode.gameType)
            ? (multiplayerMode.isHost || roomState?.isHost || false)
            : (roomState?.isHost || false)
          
          console.log('[App] Rendering RoomManager (showRoomManager=true):', {
            roomId: actualRoomId,
            multiplayerModeRoomId: multiplayerMode?.roomId,
            urlRoomId,
            isHost: actualIsHost,
            selectedGameProp,
            hasProfile: !!actualProfile
          })
          
          if (!actualProfile) {
            // No profile selected - show Menu instead
            return (
              <Menu
                onSelectGame={handleSelectGame}
                currentProfile={selectedProfile}
                onSwitchProfile={handleSwitchProfile}
                onLogout={handleLogout}
                roomState={roomState}
                onRoomStateChange={handleRoomStateChange}
              />
            )
          }
          
          return (
            <RoomManager 
              onJoinRoom={handleJoinRoom} 
              onCreateRoom={handleCreateRoom}
              onExit={handleLeaveRoom}
              onBackToTitle={handleBackToTitle}
              profile={actualProfile}
              roomId={actualRoomId}
              isHost={actualIsHost}
              onRoomCreated={handleRoomCreated}
              onRoomStateChange={handleRoomStateChange}
              roomPlayers={roomState?.players}
              selectedGame={selectedGameProp}
            />
          )
        })()
      ) : multiplayerMode && typeof multiplayerMode === 'object' && !multiplayerMode.gameType ? (
        // Check if we have a roomId in URL - if not, player has left, show Menu
        !getRoomIdFromUrl() ? (
          <Menu
            onSelectGame={handleSelectGame}
            currentProfile={selectedProfile}
            onSwitchProfile={handleSwitchProfile}
            onLogout={handleLogout}
            roomState={roomState}
            onRoomStateChange={handleRoomStateChange}
          />
        ) :
        !multiplayerMode.profile ? (
          <Menu
            onSelectGame={handleSelectGame}
            currentProfile={selectedProfile}
            onSwitchProfile={handleSwitchProfile}
            onLogout={handleLogout}
            roomState={roomState}
            onRoomStateChange={handleRoomStateChange}
          />
        ) : (roomState?.inRoom || multiplayerMode?.roomId) && (getRoomIdFromUrl() || multiplayerMode?.roomId) && roomState?.showRoomManager === false ? (
          // In room but not showing room manager - show Menu with RoomManager in background
          <>
            <Menu
              onSelectGame={handleSelectGame}
              currentProfile={selectedProfile}
              onSwitchProfile={handleSwitchProfile}
              onLogout={handleLogout}
              roomState={roomState}
              onRoomStateChange={handleRoomStateChange}
            />
            <RoomManager 
              onJoinRoom={handleJoinRoom} 
              onCreateRoom={handleCreateRoom}
              onExit={handleLeaveRoom}
              onBackToTitle={handleBackToTitle}
              profile={multiplayerMode.profile}
              roomId={multiplayerMode.roomId}
              isHost={multiplayerMode.isHost}
              onRoomCreated={handleRoomCreated}
              onRoomStateChange={handleRoomStateChange}
              roomPlayers={roomState?.players}
              backgroundMode={true}
              selectedGame={roomState?.selectedGame || currentGame}
            />
          </>
        ) : (
          (() => {
            const selectedGameProp = roomState?.selectedGame || currentGame
            // Get roomId from URL as fallback if multiplayerMode.roomId is not available
            const urlRoomId = getRoomIdFromUrl()
            const actualRoomId = multiplayerMode.roomId || urlRoomId || roomState?.roomId
            console.log('[App] Rendering RoomManager (multiplayerMode):', {
              roomId: actualRoomId,
              multiplayerModeRoomId: multiplayerMode.roomId,
              urlRoomId,
              isHost: multiplayerMode.isHost,
              selectedGameProp,
              roomStateSelectedGame: roomState?.selectedGame,
              currentGame
            })
            return (
              <RoomManager 
                onJoinRoom={handleJoinRoom} 
                onCreateRoom={handleCreateRoom}
                onExit={handleLeaveRoom}
                onBackToTitle={handleBackToTitle}
                profile={multiplayerMode.profile || selectedProfile}
                roomId={actualRoomId}
                isHost={multiplayerMode.isHost || roomState?.isHost || false}
                onRoomCreated={handleRoomCreated}
                onRoomStateChange={handleRoomStateChange}
                roomPlayers={roomState?.players}
                selectedGame={selectedGameProp}
              />
            )
          })()
        )
      ) : currentGame === null ? (
        <>
          <Menu
            onSelectGame={handleSelectGame}
            currentProfile={selectedProfile}
            onSwitchProfile={handleSwitchProfile}
            onLogout={handleLogout}
            roomState={roomState}
            onRoomStateChange={handleRoomStateChange}
          />
          {/* Keep RoomManager mounted in background if in room to maintain socket connection */}
          {/* This is critical for non-host players to receive game-selected events */}
          {(() => {
            const roomIdFromUrl = getRoomIdFromUrl()
            // Mount RoomManager if:
            // 1. We have a roomId in URL AND a profile (Player 2 joining via URL)
            // 2. OR we're in a room (roomState.inRoom is true)
            // 3. AND we're not showing the RoomManager UI (background mode)
            // Always mount RoomManager in background if there's a roomId in URL and a profile
            // This ensures socket listeners (like player-left) are always active when in a room
            const shouldMount = (
              roomIdFromUrl && selectedProfile && !roomState?.showRoomManager
            ) || (
              roomState?.inRoom && (roomIdFromUrl || multiplayerMode?.roomId) && !roomState?.showRoomManager
            )
            
            if (roomIdFromUrl && selectedProfile) {
              console.log('[App] RoomManager mount check:', {
                shouldMount,
                roomIdFromUrl,
                inRoom: roomState?.inRoom,
                showRoomManager: roomState?.showRoomManager,
                hasProfile: !!selectedProfile,
                multiplayerModeRoomId: multiplayerMode?.roomId
              })
            }
            
            return shouldMount
          })() && (
            <RoomManager 
              onJoinRoom={handleJoinRoom} 
              onCreateRoom={handleCreateRoom}
              onExit={handleLeaveRoom}
              onBackToTitle={handleBackToTitle}
              profile={selectedProfile}
              roomId={getRoomIdFromUrl() || multiplayerMode?.roomId}
              isHost={roomState?.isHost || false}
              onRoomCreated={handleRoomCreated}
              onRoomStateChange={handleRoomStateChange}
              roomPlayers={roomState?.players}
              backgroundMode={true}
              selectedGame={roomState?.selectedGame || currentGame}
            />
          )}
        </>
      ) : null}
      </div>
    </RoomProvider>
  )
}

export default App

