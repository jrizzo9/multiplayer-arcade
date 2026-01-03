import { useState, useEffect, useRef } from 'react'
import { getProfileAnimal } from '../utils/playerColors'
import RoomManager from './RoomManager'
import { getMultiplayerGames } from '../utils/games'
import soundManager from '../utils/sounds'
import { getSocket } from '../utils/socket'
import { useRoom, useRoomConnection } from '../multiplayer/RoomProvider'
import { setReady, selectGame } from '../multiplayer/roomLifecycle'
import { isCPUProfile } from '../utils/cpuPlayer'
import Button from './Button'

// Helper function to get roomId from URL (single source of truth)
function getRoomIdFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('room')
}

function Menu({ onSelectGame, currentProfile, onSwitchProfile, onLogout, roomState, onRoomStateChange }) {
  const [showRoomManager, setShowRoomManager] = useState(false)
  const [availableRooms, setAvailableRooms] = useState([])
  const profileAnimal = currentProfile?.emoji && currentProfile?.color
    ? { emoji: currentProfile.emoji, color: currentProfile.color }
    : getProfileAnimal(0)

  // Get real-time room data from RoomProvider (single source of truth)
  const roomId = getRoomIdFromUrl()
  const realTimeRoomState = useRoom(roomId)
  const { createNewRoom, socketConnected, connectionError } = useRoomConnection()
  
  // Use real-time player data if available, fallback to prop roomState
  const actualPlayers = realTimeRoomState.players?.length > 0 
    ? realTimeRoomState.players 
    : roomState?.players || []
  const actualPlayerCount = actualPlayers.length
  
  // Get selected game from real-time room state
  const selectedGame = realTimeRoomState.selectedGame || roomState?.selectedGame || null
  
  // Get room status (waiting, playing, etc.) from real-time room state
  const roomStatus = realTimeRoomState.status || roomState?.status || 'waiting'
  const isGamePlaying = roomStatus === 'playing'
  
  // Debug logging for status updates
  useEffect(() => {
    if (roomId && selectedGame) {
      console.log('[Menu] Status check:', {
        roomId,
        roomStatus,
        isGamePlaying,
        realTimeStatus: realTimeRoomState.status,
        roomStateStatus: roomState?.status,
        hasSnapshot: !!realTimeRoomState.snapshot
      })
    }
  }, [roomId, roomStatus, isGamePlaying, selectedGame, realTimeRoomState.status, roomState?.status])
  
  // Debug logging for selectedGame updates
  useEffect(() => {
    if (roomId) {
      console.log('[Menu] selectedGame state:', {
        roomId,
        realTimeSelectedGame: realTimeRoomState.selectedGame,
        roomStateSelectedGame: roomState?.selectedGame,
        finalSelectedGame: selectedGame,
        hasSnapshot: !!realTimeRoomState.snapshot
      })
    }
  }, [roomId, realTimeRoomState.selectedGame, roomState?.selectedGame, selectedGame])
  
  // Determine if current user is host from real-time room state (single source of truth)
  const isHost = currentProfile?.id 
    ? realTimeRoomState.isHost(currentProfile.id) 
    : roomState?.isHost || false
  
  // Check if all players are ready
  const allPlayersReady = actualPlayers.length >= 2 && actualPlayers.every(player => player.ready)

  // Listen for room list updates from server
  useEffect(() => {
    const socket = getSocket()
    
    const handleRoomList = (rooms) => {
      console.log('[Menu] Received room list:', rooms)
      setAvailableRooms(rooms || [])
    }
    
    const handleRoomError = ({ message }) => {
      console.error('[Menu] Room error:', message)
      // Don't show alert - let the active game component handle the notification
      // This prevents duplicate notifications when multiple components are mounted
      // Only log the error, don't show UI notification here
    }
    
    // Listen for game-start event to update status locally (fallback if snapshot is delayed)
    const handleGameStart = ({ game }) => {
      console.log('[Menu] Received game-start event, game:', game)
      // The room snapshot should update automatically, but this ensures we know the game started
      // Request a fresh snapshot to ensure we have the latest status
      const currentRoomId = getRoomIdFromUrl()
      if (currentRoomId) {
        socket.emit('request-room-snapshot', { roomId: currentRoomId })
      }
    }
    
    socket.on('room-list', handleRoomList)
    socket.on('game-start', handleGameStart)
    // Only listen to room-error if we're not in a game (to avoid duplicate notifications)
    // Game components will handle room-error notifications
    if (!selectedGame) {
      socket.on('room-error', handleRoomError)
    }
    
    return () => {
      socket.off('room-list', handleRoomList)
      socket.off('game-start', handleGameStart)
      socket.off('room-error', handleRoomError)
    }
  }, [selectedGame])
  
  // Debug logging for ready status
  useEffect(() => {
    if (selectedGame && actualPlayers.length > 0) {
      console.log('[Menu] Ready status check:', {
        actualPlayersCount: actualPlayers.length,
        readyPlayers: actualPlayers.filter(p => p.ready).length,
        allReady: actualPlayers.every(p => p.ready),
        allPlayersReady,
        players: actualPlayers.map(p => ({ name: p.name, ready: p.ready }))
      })
    }
  }, [selectedGame, actualPlayers, allPlayersReady])

  // Auto-ready for CPU players (also handles game changes)
  const previousSelectedGameRef = useRef(selectedGame)
  useEffect(() => {
    if (!roomId || !currentProfile) return
    
    const isCPU = isCPUProfile(currentProfile)
    if (!isCPU) {
      previousSelectedGameRef.current = selectedGame
      return
    }
    
    // Check if game changed (host selected a new game)
    const gameChanged = previousSelectedGameRef.current !== selectedGame
    if (gameChanged) {
      console.log('[Menu] AutoBot detected game change:', previousSelectedGameRef.current, '->', selectedGame)
      previousSelectedGameRef.current = selectedGame
    }
    
    // Only auto-ready if a game is selected
    if (!selectedGame) return
    
    const currentPlayer = realTimeRoomState.getPlayer(currentProfile?.id)
    if (!currentPlayer || currentPlayer.ready) return
    
    // Auto-ready after a short delay (feels more natural)
    // Shorter delay if game just changed (faster response)
    const delay = gameChanged ? 300 + Math.random() * 200 : 500 + Math.random() * 500
    const autoReadyTimer = setTimeout(() => {
      console.log('[Menu] AutoBot auto-readying up', gameChanged ? '(game changed)' : '')
      setReady(roomId, true)
    }, delay)
    
    return () => clearTimeout(autoReadyTimer)
  }, [roomId, currentProfile, selectedGame, realTimeRoomState])

  // Show room manager only if explicitly requested (showRoomManager flag)
  // Don't auto-show on load - default to title screen
  useEffect(() => {
    const roomId = getRoomIdFromUrl()
    if (roomState?.showRoomManager === true) {
      // Explicitly requested to show room manager
      setShowRoomManager(true)
    } else if (roomState?.showRoomManager === false) {
      // Explicitly requested to hide room manager
      setShowRoomManager(false)
    } else if (roomState?.inRoom && roomId) {
      // Already in a room but showRoomManager not explicitly set - stay on title screen
      // Don't change showRoomManager state here - let user clicks control it
    } else if (roomState === null) {
      // Room state was cleared (user left room) - hide room manager
      setShowRoomManager(false)
    }
    // If showRoomManager is undefined, don't change the state (preserve user's current view)
  }, [roomState])

  // If showing room manager, render it
  if (showRoomManager) {
    return (
      <RoomManager
        onJoinRoom={(roomId) => {
          if (onRoomStateChange) {
            onRoomStateChange({ action: 'join', roomId })
          }
        }}
        onCreateRoom={() => {
          if (onRoomStateChange) {
            onRoomStateChange({ action: 'create' })
          }
        }}
        onExit={() => {
          console.log('[Menu] RoomManager onExit called, hiding RoomManager and clearing room state')
          // Hide the room manager immediately - this will unmount RoomManager and prevent re-joining
          setShowRoomManager(false)
          // Clear room state after hiding to ensure clean state
          // Use a small delay to ensure RoomManager unmounts first
          setTimeout(() => {
            if (onRoomStateChange) {
              onRoomStateChange({ action: 'leave' })
            }
          }, 10)
        }}
        onBackToTitle={() => {
          console.log('[Menu] RoomManager onBackToTitle called, hiding RoomManager but keeping room state')
          // Just hide the room manager without clearing room state
          // This allows the user to see the room status bar on the title screen
          setShowRoomManager(false)
        }}
        profile={currentProfile}
        roomId={getRoomIdFromUrl()}
        isHost={roomState?.isHost || false}
        roomPlayers={roomState?.players || null}
        onRoomCreated={(roomId) => {
          // Don't call onRoomStateChange here - RoomManager already handles it
          // This prevents double-firing and state resets
          console.log('[Menu] onRoomCreated called for room:', roomId, '- not calling onRoomStateChange to prevent state reset')
        }}
        onRoomStateChange={onRoomStateChange}
      />
    )
  }

  // Scroll to top when component mounts or when room state changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [selectedGame, roomState?.inRoom, actualPlayerCount])

  return (
    <div 
      className={`w-full h-full bg-black flex flex-col items-center overflow-y-auto self-start ${
        selectedGame 
          ? 'justify-center' 
          : 'justify-start pt-large px-small'
      }`}
      style={selectedGame ? {
        minHeight: '100vh',
        paddingTop: 'calc(1.25rem + 4.5rem)', // Account for AppHUD (average of top-4/6 + ~4.5rem for HUD height)
        paddingBottom: 'calc(1.25rem + 4.5rem)',
        paddingLeft: '0.5rem',
        paddingRight: '0.5rem'
      } : {
        minHeight: '100vh'
      }}
    >
      
      {!selectedGame && (
        <div className="flex flex-col items-center mb-6 sm:mb-8 mt-16 sm:mt-20">
          <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold text-white mb-4 sm:mb-6 tracking-tight text-center px-medium">
            <span className="inline-block animate-fade-in">MULTIPLAYER</span>
            <br />
            <span className="inline-block animate-fade-in" style={{ animationDelay: '0.1s' }}>ARCADE</span>
          </h1>
          {!currentProfile && (
            <p className="text-white text-base sm:text-lg md:text-xl text-center mt-4 sm:mt-6 opacity-80 max-w-md px-medium animate-fade-in" style={{ animationDelay: '0.3s' }}>
              Select a profile to begin
            </p>
          )}
        </div>
      )}
      
      
      {/* Multiplayer Section */}
      <div className="w-full max-w-4xl px-small p-medium mb-8 sm:mb-12">
        <div className="flex flex-col items-center gap-4 w-full max-w-md mx-auto">
          {currentProfile && !roomState?.inRoom && !getRoomIdFromUrl() && actualPlayers.length === 0 && (
            <>
              <p className="text-white text-xs sm:text-sm text-center max-w-md opacity-75">
                Join a room to play multiplayer games
              </p>
              
              {/* Available Rooms List */}
              {availableRooms.length > 0 && (
                <div className="w-full mb-4">
                  <h3 className="text-lg sm:text-xl font-bold text-white mb-3 text-center">Available Rooms</h3>
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    {availableRooms.map((room) => (
                      <div
                        key={room.id}
                        className="flex items-center justify-between px-4 py-3 border rounded-xl transition-all duration-300 cursor-pointer hover:scale-[1.02] hover:shadow-lg"
                        style={{
                          borderColor: room.status === 'playing' 
                            ? 'rgba(234, 179, 8, 0.5)' 
                            : 'rgba(34, 197, 94, 0.5)',
                          backgroundColor: room.status === 'playing'
                            ? 'rgba(234, 179, 8, 0.1)'
                            : 'rgba(34, 197, 94, 0.1)',
                          backdropFilter: 'blur(12px)',
                          boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.1)'
                        }}
                        onClick={() => {
                          if (onRoomStateChange) {
                            onRoomStateChange({ action: 'join', roomId: room.id })
                          }
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-white font-bold text-base sm:text-lg">
                              {room.status === 'playing' ? '🎮' : '⏳'} Room {room.id}
                            </span>
                            <span 
                              className="px-2.5 py-1 text-xs font-bold rounded-full"
                              style={{
                                backgroundColor: room.status === 'playing' 
                                  ? 'rgba(234, 179, 8, 0.9)' 
                                  : 'rgba(34, 197, 94, 0.9)',
                                color: '#000',
                                boxShadow: `0 0 10px ${room.status === 'playing' ? 'rgba(234, 179, 8, 0.5)' : 'rgba(34, 197, 94, 0.5)'}`
                              }}
                            >
                              {room.status === 'playing' ? 'PLAYING' : 'WAITING'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs sm:text-sm text-white/80">
                            <span className="flex items-center gap-1">
                              <span className="opacity-60">{room.hostEmoji || '👤'}</span>
                              <span className="font-medium">{room.hostName}</span>
                            </span>
                            <span className="opacity-40">•</span>
                            <span>{room.playerCount}/{room.maxPlayers} players</span>
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (onRoomStateChange) {
                              onRoomStateChange({ action: 'join', roomId: room.id })
                            }
                          }}
                          className="ml-4 px-4 py-2 text-sm font-bold text-white border rounded-lg hover:bg-white hover:text-black transition-all duration-300 whitespace-nowrap"
                          style={{
                            borderColor: 'rgba(255, 255, 255, 0.3)',
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            backdropFilter: 'blur(12px)',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
                          }}
                        >
                          Join →
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
            {/* Connection Status Indicator */}
            <div className="w-full max-w-md mb-2">
              {!socketConnected ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg border" style={{
                    borderColor: connectionError ? 'rgba(239, 68, 68, 0.5)' : 'rgba(234, 179, 8, 0.5)',
                    backgroundColor: connectionError ? 'rgba(239, 68, 68, 0.1)' : 'rgba(234, 179, 8, 0.1)',
                    backdropFilter: 'blur(12px)'
                  }}>
                    <div className={`w-2 h-2 rounded-full ${connectionError ? 'bg-red-400' : 'bg-yellow-400 animate-pulse'}`}></div>
                    <p className={`text-xs sm:text-sm font-medium ${connectionError ? 'text-red-300' : 'text-yellow-300'}`}>
                      {connectionError ? 'Connection Failed' : 'Connecting to server...'}
                    </p>
                  </div>
                  {connectionError && (
                    <div className="px-4 py-2 rounded-lg border border-red-500/50 bg-red-900/20">
                      <p className="text-xs text-red-300">{connectionError}</p>
                      <button
                        onClick={() => window.location.reload()}
                        className="mt-2 px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
                      >
                        Refresh Page
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg border" style={{
                  borderColor: 'rgba(34, 197, 94, 0.5)',
                  backgroundColor: 'rgba(34, 197, 94, 0.1)',
                  backdropFilter: 'blur(12px)'
                }}>
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  <p className="text-xs sm:text-sm text-green-300 font-medium">
                    Connected to server
                  </p>
                </div>
              )}
            </div>

            <Button
              onClick={async () => {
                console.log('[Menu] Create Room button clicked')
                if (!currentProfile) {
                  // Should not happen due to conditional rendering, but safety check
                  return
                }
                
                if (!socketConnected) {
                  console.warn('[Menu] Cannot create room: socket not connected')
                  return
                }
                
                try {
                  soundManager.playSelect()
                  const result = await createNewRoom(currentProfile)
                  if (result.success && result.roomId) {
                    // Room created successfully - URL is updated by RoomProvider
                    // The room state will update automatically via RoomProvider
                    console.log('[Menu] Room created successfully:', result.roomId)
                  } else {
                    console.error('[Menu] Failed to create room:', result.error)
                  }
                } catch (error) {
                  console.error('[Menu] Error creating room:', error)
                }
              }}
              size="large"
              variant="secondary"
              className="w-full min-h-[48px]"
              disabled={!socketConnected}
            >
              CREATE NEW ROOM
            </Button>
            </>
          )}
          {currentProfile && (roomState?.inRoom || getRoomIdFromUrl() || actualPlayers.length > 0) && (
            <>
              {!selectedGame && (getRoomIdFromUrl() || realTimeRoomState.roomId || roomState?.roomId) && (
                <p className="text-white text-sm text-center max-w-md opacity-75 mb-4">
                  You're in room: {getRoomIdFromUrl() || realTimeRoomState.roomId || roomState?.roomId || 'Unknown'}
                </p>
              )}
              
              {/* HOST SCREEN - Game Selection */}
              {isHost && !selectedGame && (
                <div className="w-full max-w-2xl mx-auto">
                  <p className="text-white text-sm text-center mb-6 opacity-75">
                    Select a game to play
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                    {getMultiplayerGames().map((game) => {
                      // Check if we have enough players for this game
                      // Use real-time player count from RoomProvider
                      const playerCount = actualPlayerCount
                      const canPlay = playerCount >= game.minPlayers && playerCount <= game.maxPlayers
                      
                      return (
                        <button
                          key={game.id}
                          onClick={() => {
                            if (canPlay) {
                              soundManager.playSelect()
                              onSelectGame(game.id)
                            }
                          }}
                          disabled={!canPlay}
                          className="relative overflow-hidden rounded-xl border-2 transition-all duration-300 cursor-pointer group min-h-[120px] sm:min-h-[140px] flex flex-col items-center justify-center p-6"
                          style={{
                            borderColor: canPlay ? game.borderColor || 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                            backgroundColor: canPlay ? game.bgColor || 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.3)',
                            backdropFilter: 'blur(12px)',
                            boxShadow: canPlay 
                              ? '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.1)' 
                              : '0 2px 8px rgba(0, 0, 0, 0.2)',
                            opacity: canPlay ? 1 : 0.5,
                            transform: canPlay ? 'scale(1)' : 'scale(0.98)'
                          }}
                          onMouseEnter={(e) => {
                            if (canPlay) {
                              e.currentTarget.style.transform = 'scale(1.02)'
                              e.currentTarget.style.boxShadow = `0 8px 25px rgba(0, 0, 0, 0.4), 0 0 20px ${game.color}40`
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (canPlay) {
                              e.currentTarget.style.transform = 'scale(1)'
                              e.currentTarget.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.1)'
                            }
                          }}
                        >
                          {/* Gradient overlay */}
                          <div 
                            className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity duration-300"
                            style={{
                              background: game.gradient || 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 100%)'
                            }}
                          />
                          
                          {/* Glass overlay */}
                          <div 
                            className="absolute inset-0 pointer-events-none"
                            style={{
                              background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 50%)'
                            }}
                          />
                          
                          <div className="relative z-10 flex flex-col items-center gap-3 w-full">
                            {/* Game Icon */}
                            <div 
                              className="text-5xl sm:text-6xl transition-transform duration-300 group-hover:scale-110"
                              style={{
                                filter: canPlay ? 'drop-shadow(0 0 10px ' + game.color + '80)' : 'grayscale(100%)'
                              }}
                            >
                              {game.icon || '🎮'}
                            </div>
                            
                            {/* Game Name */}
                            <div className="text-center">
                              <h3 
                                className="text-lg sm:text-xl font-bold mb-1"
                                style={{
                                  color: canPlay ? '#FFFFFF' : 'rgba(255, 255, 255, 0.5)'
                                }}
                              >
                                {game.name}
                              </h3>
                              
                              {/* Player Count */}
                              <p 
                                className="text-xs sm:text-sm"
                                style={{
                                  color: canPlay ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.4)'
                                }}
                              >
                                {canPlay ? (
                                  <span>{playerCount}/{game.minPlayers}-{game.maxPlayers} players</span>
                                ) : (
                                  <span className="text-red-400">
                                    Need {game.minPlayers}-{game.maxPlayers} players
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              
              {/* HOST SCREEN - Ready Screen (when game selected) */}
              {isHost && selectedGame && (
                <div 
                  className="w-full max-w-md mx-auto p-large border rounded-xl relative overflow-hidden"
                  style={{
                    borderColor: 'rgba(255, 255, 255, 0.3)',
                    backgroundColor: 'rgba(0, 0, 0, 0.6)',
                    backdropFilter: 'blur(20px)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
                  }}
                >
                  {/* Glass overlay effects */}
                  <div 
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{
                      background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 50%, rgba(0, 0, 0, 0.1) 100%)'
                    }}
                  />
                  <div 
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.25)'
                    }}
                  />
                  
                  <div className="relative z-10">
                    <div className="mb-6 text-center">
                      <p className="text-xs text-white/60 uppercase tracking-wider mb-2">Selected Game</p>
                      <p className="text-2xl sm:text-3xl font-bold text-white">
                        {selectedGame.toUpperCase()}
                      </p>
                    </div>
                    
                    {/* Ready status for all players */}
                    <div className="mb-6">
                      <p className="text-xs text-white/60 uppercase tracking-wider mb-3 font-semibold">Ready Status</p>
                      <div className="space-y-2">
                        {actualPlayers.map((player) => {
                          const isCurrentPlayer = player.userProfileId && currentProfile?.id && 
                            String(player.userProfileId) === String(currentProfile.id)
                          return (
                            <div 
                              key={player.userProfileId || player.id} 
                              className="flex items-center justify-between p-3 rounded-lg"
                              style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)'
                              }}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-base sm:text-lg">{player.emoji || '⚪'}</span>
                                <span className="text-sm sm:text-base font-medium text-white">
                                  {player.name || 'Unknown Player'}
                                  {isCurrentPlayer && <span className="text-white/50 ml-1 text-xs">(You)</span>}
                                </span>
                              </div>
                              <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                isGamePlaying
                                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                  : player.ready 
                                    ? 'bg-green-500/20 text-green-300 border border-green-500/30' 
                                    : 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                              }`}>
                                {isGamePlaying ? '🎮 Playing' : player.ready ? '✓ Ready' : '⏳ Not Ready'}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    
                    {/* Show message and rejoin button when game is playing */}
                    {isGamePlaying && selectedGame && (
                      <>
                        <div className="mb-4 p-3 rounded-lg border" style={{
                          borderColor: 'rgba(59, 130, 246, 0.3)',
                          backgroundColor: 'rgba(59, 130, 246, 0.1)'
                        }}>
                          <p className="text-xs text-blue-300 text-center mb-3">
                            Game in progress. Rejoin to continue playing.
                          </p>
                          <Button
                            onClick={() => {
                              soundManager.playSelect()
                              if (onSelectGame && selectedGame) {
                                onSelectGame(selectedGame)
                              } else if (onRoomStateChange) {
                                const roomId = getRoomIdFromUrl()
                                onRoomStateChange({ action: 'game-start', game: selectedGame, roomId })
                              }
                            }}
                            variant="primary"
                            size="large"
                            className="w-full"
                          >
                            Rejoin Game
                          </Button>
                        </div>
                      </>
                    )}
                    
                    {/* Ready button for host (only show if game is not playing) */}
                    {!isGamePlaying && (
                      <Button
                        onClick={() => {
                          const currentPlayer = realTimeRoomState.getPlayer(currentProfile?.id)
                          const roomId = getRoomIdFromUrl()
                          if (roomId) {
                            setReady(roomId, !currentPlayer?.ready)
                          }
                        }}
                        variant="secondary"
                        size="large"
                        className="w-full mb-4"
                      >
                        {realTimeRoomState.getPlayer(currentProfile?.id)?.ready ? 'Unready' : 'Ready'}
                      </Button>
                    )}
                    
                    {/* Start Game button for host (only when all players ready and game not playing) */}
                    {allPlayersReady && !isGamePlaying && (
                      <Button
                        onClick={() => {
                          const socket = getSocket()
                          const roomId = getRoomIdFromUrl()
                          console.log('[Menu] Start Game clicked:', { socket: !!socket, roomId, socketConnected: socket?.connected })
                          if (socket && roomId) {
                            socket.emit('start-game', { roomId })
                          } else {
                            console.error('[Menu] Cannot start game:', { hasSocket: !!socket, hasRoomId: !!roomId, socketConnected: socket?.connected })
                          }
                        }}
                        variant="primary"
                        size="large"
                        className="w-full mb-3"
                      >
                        Start Game
                      </Button>
                    )}
                    {/* Debug info - show why button might not be showing */}
                    {selectedGame && !allPlayersReady && isHost && (
                      <p className="text-xs text-white/50 text-center mb-3">
                        Waiting for all players to ready up ({actualPlayers.filter(p => p.ready).length}/{actualPlayers.length})
                      </p>
                    )}
                    
                    {/* Back to Game Selection button for host */}
                    <Button
                      onClick={() => {
                        const roomId = getRoomIdFromUrl()
                        if (roomId && isHost) {
                          // Emit socket event to clear game selection - this will broadcast to all players
                          console.log('[Menu] Clearing game selection, emitting game-selected with null')
                          selectGame(roomId, null)
                          // Also update local state
                          if (onRoomStateChange) {
                            onRoomStateChange({ action: 'game-selected', game: null, roomId })
                          }
                        }
                      }}
                      variant="secondary"
                      size="medium"
                      className="w-full"
                    >
                      ← Back to Game Selection
                    </Button>
                  </div>
                </div>
              )}
              
              {/* NON-HOST SCREEN - Waiting for host */}
              {!isHost && !selectedGame && (
                <div 
                  className="w-full max-w-md mx-auto p-small border rounded-xl relative overflow-hidden"
                  style={{
                    borderColor: 'rgba(255, 255, 255, 0.3)',
                    backgroundColor: 'rgba(0, 0, 0, 0.6)',
                    backdropFilter: 'blur(20px)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
                  }}
                >
                  {/* Glass overlay effects */}
                  <div 
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{
                      background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 50%, rgba(0, 0, 0, 0.1) 100%)'
                    }}
                  />
                  <div 
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.25)'
                    }}
                  />
                  
                  <div className="relative z-10 flex flex-col items-center gap-2">
                    <div className="text-2xl animate-pulse">⏳</div>
                    <p className="text-white text-sm text-center font-medium">
                      Waiting for host to select a game...
                    </p>
                    <p className="text-white/50 text-xs text-center">
                      {actualPlayerCount} player{actualPlayerCount !== 1 ? 's' : ''} in room
                    </p>
                  </div>
                </div>
              )}
              
              {/* NON-HOST SCREEN - Ready Screen (when game selected) */}
              {!isHost && selectedGame && (
                <div 
                  className="w-full max-w-md mx-auto p-large border rounded-xl relative overflow-hidden"
                  style={{
                    borderColor: 'rgba(255, 255, 255, 0.3)',
                    backgroundColor: 'rgba(0, 0, 0, 0.6)',
                    backdropFilter: 'blur(20px)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
                  }}
                >
                  {/* Glass overlay effects */}
                  <div 
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{
                      background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 50%, rgba(0, 0, 0, 0.1) 100%)'
                    }}
                  />
                  <div 
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.25)'
                    }}
                  />
                  
                  <div className="relative z-10">
                    <div className="mb-6 text-center">
                      <p className="text-xs text-white/60 uppercase tracking-wider mb-2">Selected Game</p>
                      <p className="text-2xl sm:text-3xl font-bold text-white">
                        {selectedGame.toUpperCase()}
                      </p>
                    </div>
                    
                    {/* Ready status for all players */}
                    <div className="mb-6">
                      <p className="text-xs text-white/60 uppercase tracking-wider mb-3 font-semibold">Ready Status</p>
                      <div className="space-y-2">
                        {actualPlayers.map((player) => {
                          const isCurrentPlayer = player.userProfileId && currentProfile?.id && 
                            String(player.userProfileId) === String(currentProfile.id)
                          return (
                            <div 
                              key={player.userProfileId || player.id} 
                              className="flex items-center justify-between p-3 rounded-lg"
                              style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)'
                              }}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-base sm:text-lg">{player.emoji || '⚪'}</span>
                                <span className="text-sm sm:text-base font-medium text-white">
                                  {player.name || 'Unknown Player'}
                                  {isCurrentPlayer && <span className="text-white/50 ml-1 text-xs">(You)</span>}
                                </span>
                              </div>
                              <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                isGamePlaying
                                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                  : player.ready 
                                    ? 'bg-green-500/20 text-green-300 border border-green-500/30' 
                                    : 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                              }`}>
                                {isGamePlaying ? '🎮 Playing' : player.ready ? '✓ Ready' : '⏳ Not Ready'}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    
                    {/* Show message and rejoin button when game is playing */}
                    {isGamePlaying && selectedGame && (
                      <>
                        <div className="mb-4 p-3 rounded-lg border" style={{
                          borderColor: 'rgba(59, 130, 246, 0.3)',
                          backgroundColor: 'rgba(59, 130, 246, 0.1)'
                        }}>
                          <p className="text-xs text-blue-300 text-center mb-3">
                            Game in progress. Rejoin to continue playing.
                          </p>
                          <Button
                            onClick={() => {
                              soundManager.playSelect()
                              if (onSelectGame && selectedGame) {
                                onSelectGame(selectedGame)
                              } else if (onRoomStateChange) {
                                const roomId = getRoomIdFromUrl()
                                onRoomStateChange({ action: 'game-start', game: selectedGame, roomId })
                              }
                            }}
                            variant="primary"
                            size="large"
                            className="w-full"
                          >
                            Rejoin Game
                          </Button>
                        </div>
                      </>
                    )}
                    
                    {/* Ready button for non-host (only show if game is not playing) */}
                    {!isGamePlaying && (
                      <Button
                        onClick={() => {
                          const currentPlayer = realTimeRoomState.getPlayer(currentProfile?.id)
                          const roomId = getRoomIdFromUrl()
                          if (roomId) {
                            setReady(roomId, !currentPlayer?.ready)
                          }
                        }}
                        variant="secondary"
                        size="large"
                        className="w-full mb-3"
                      >
                        {realTimeRoomState.getPlayer(currentProfile?.id)?.ready ? 'Unready' : 'Ready'}
                      </Button>
                    )}
                    
                    {/* Waiting message when all players ready */}
                    {allPlayersReady && !isGamePlaying && (
                      <p className="text-sm text-white/60 mb-3 text-center">
                        Waiting for host to start the game...
                      </p>
                    )}
                    
                    {/* Note: Non-host players can't go back to game selection - only host can change the game */}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

    </div>
  )
}

export default Menu

