import { useState, useEffect, useRef } from 'react'
import { useRoom, useRoomConnection } from '../multiplayer/RoomProvider'
import { getCurrentProfile } from '../utils/profiles'
import soundManager from '../utils/sounds'
import ProfileOptionsMenu from './ProfileOptionsMenu'
import Button from './Button'

// Helper function to get roomId from URL (single source of truth)
function getRoomIdFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('room')
}

function AppHUD({ onShowProfile, onSwitchProfile, onShowRoom, onLogout }) {
  const urlRoomId = getRoomIdFromUrl()
  const { activeRoomId, snapshotVersion } = useRoomConnection()
  // Try to get room state - use URL roomId first, then activeRoomId, then null to get first available
  const roomStateForLookup = urlRoomId || activeRoomId
  const roomState = useRoom(roomStateForLookup)
  // Get roomId from URL first, then activeRoomId, then roomState.roomId if we have players
  // Only show room if snapshot exists and has players
  // CRITICAL: If activeRoomId is null (player left), don't show room even if URL has roomId
  const roomId = (activeRoomId || urlRoomId || (roomState?.players?.length > 0 ? roomState.roomId : null))
  // CRITICAL: Only show room if we have an activeRoomId (player is actually in the room)
  // This ensures the UI updates immediately when player leaves (activeRoomId becomes null)
  const hasValidRoom = activeRoomId && roomId && roomState && roomState.players && roomState.players.length > 0
  const [currentProfile, setCurrentProfile] = useState(null)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const profileButtonRef = useRef(null)
  const [menuPosition, setMenuPosition] = useState(null)
  
  useEffect(() => {
    const loadProfile = async () => {
      const profile = await getCurrentProfile()
      setCurrentProfile(profile)
    }
    loadProfile()

    // Listen for storage changes (when profile is cleared on logout)
    const handleStorageChange = (e) => {
      if (e.key === 'multiplayer_arcade_current_profile_name') {
        // Profile was cleared or changed, re-fetch
        loadProfile()
      }
    }
    window.addEventListener('storage', handleStorageChange)

    // Also listen for custom events in case storage event doesn't fire (same window)
    const handleProfileCleared = () => {
      loadProfile()
    }
    const handleProfileSelected = () => {
      loadProfile()
    }
    window.addEventListener('profile-cleared', handleProfileCleared)
    window.addEventListener('profile-selected', handleProfileSelected)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('profile-cleared', handleProfileCleared)
      window.removeEventListener('profile-selected', handleProfileSelected)
    }
  }, [])
  
  useEffect(() => {
    if (showProfileMenu && profileButtonRef.current) {
      const rect = profileButtonRef.current.getBoundingClientRect()
      setMenuPosition({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right
      })
    }
  }, [showProfileMenu])
  
  const players = roomState.players || []
  const playerCount = players.length
  const maxPlayers = 4
  const isHost = currentProfile && roomState.isHost(currentProfile.id)
  
  // Force re-render when activeRoomId or snapshotVersion changes
  // This ensures UI updates immediately when player leaves (activeRoomId becomes null)
  useEffect(() => {
    console.log('[AppHUD] Room state changed:', {
      activeRoomId,
      urlRoomId,
      roomId,
      hasValidRoom,
      playersCount: players.length,
      snapshotVersion,
      timestamp: Date.now()
    })
  }, [activeRoomId, urlRoomId, roomId, hasValidRoom, players.length, snapshotVersion])
  
  // If current player is in the room, use their player data from room state (source of truth)
  // Room state player data comes from NoCodeBackend via server snapshots
  // Otherwise fall back to profile data from NoCodeBackend
  const currentPlayerInRoom = currentProfile && hasValidRoom 
    ? players.find(p => p.userProfileId && currentProfile.id && String(p.userProfileId) === String(currentProfile.id))
    : null
  
  // Profile emoji/color: When in a room, use room state emoji/color (source of truth from server)
  // This ensures consistency with room avatars which also use room state data
  // Otherwise use currentProfile from NoCodeBackend (database is source of truth)
  // Never use index-based fallbacks - always use database values
  const profileAnimal = currentProfile
    ? hasValidRoom && currentPlayerInRoom
      ? { 
          emoji: currentPlayerInRoom.emoji || '⚪', 
          color: currentPlayerInRoom.color || '#FFFFFF' 
        }
      : { 
          emoji: currentProfile.emoji || '⚪', 
          color: currentProfile.color || '#FFFFFF' 
        }
    : { emoji: '⚪', color: '#FFFFFF' }

  return (
    <>
      {/* Room HUD - Top Left - Only show if we have a profile and are in a room */}
      <div className="fixed top-4 sm:top-6 left-4 sm:left-6 z-[1000] flex items-center gap-2">
        {hasValidRoom && currentProfile ? (
          <>
            <button
              onClick={() => {
                if (onShowRoom) {
                  onShowRoom()
                } else {
                  window.dispatchEvent(new CustomEvent('show-room-manager'))
                }
              }}
              className="border rounded-xl px-small py-small relative overflow-hidden backdrop-blur-xl cursor-pointer transition-all duration-300 hover:scale-105 hover:bg-white/10"
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                borderColor: 'rgba(255, 255, 255, 0.3)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
              }}
            >
              {/* Glass overlay */}
              <div 
                className="absolute inset-0 rounded-xl pointer-events-none"
                style={{
                  background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 50%)'
                }}
              />
              
              <div className="flex items-center gap-2 relative z-10">
                <div className="text-xs sm:text-sm font-bold text-white">
                  {roomId}
                </div>
                <div className="flex items-center -space-x-2">
                  {players.map((player, index) => {
                    // CRITICAL: Always use room state emoji/color as source of truth when in a room
                    // Room state data comes from NoCodeBackend via server snapshots
                    // The server receives this data when players join and includes it in room-snapshot events
                    // This ensures consistency across all UI elements
                    const isCurrentPlayer = currentProfile && player.userProfileId && 
                      String(player.userProfileId) === String(currentProfile.id)
                    const playerEmoji = player.emoji || '⚪'
                    const playerColor = player.color || '#FFFFFF'
                    const playerName = player.name || 'Unknown Player'
                    
                    return (
                      <div
                        key={player.userProfileId || player.id || index}
                        className="relative w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 flex items-center justify-center text-xs sm:text-sm"
                        style={{ 
                          borderColor: playerColor,
                          backgroundColor: playerColor,
                          zIndex: players.length - index
                        }}
                        title={playerName}
                      >
                        {playerEmoji}
                      </div>
                    )
                  })}
                </div>
                <span className="text-[10px] sm:text-xs text-white/60">
                  {playerCount}/{maxPlayers}
                </span>
              </div>
            </button>
            {isHost && (
              <div
                className="px-2 py-1.5 text-[10px] font-bold text-black bg-white rounded-lg flex items-center"
                style={{
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.3)'
                }}
              >
                HOST
              </div>
            )}
          </>
        ) : (
          <button
            onClick={() => {
              if (onShowRoom) {
                onShowRoom()
              } else {
                window.dispatchEvent(new CustomEvent('show-room-manager'))
              }
            }}
            className="border rounded-xl px-small py-small relative overflow-hidden backdrop-blur-xl cursor-pointer transition-all duration-300 hover:scale-105 hover:bg-white/10"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.4)',
              borderColor: 'rgba(255, 255, 255, 0.2)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
            }}
          >
            {/* Glass overlay */}
            <div 
              className="absolute inset-0 rounded-xl pointer-events-none"
              style={{
                background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0) 50%)'
              }}
            />
            
            <div className="flex items-center gap-2 relative z-10">
              <span className="text-[10px] sm:text-xs text-white/60 font-medium">
                No Room
              </span>
            </div>
          </button>
        )}
      </div>
      
      {/* Profile Display - Top Right */}
      <div className="fixed top-4 sm:top-6 right-4 sm:right-6 flex flex-row items-center gap-3 sm:gap-4 z-[1000]">
        {currentProfile ? (
          <>
            <button
              ref={profileButtonRef}
              className="border rounded-xl px-small py-small relative overflow-hidden backdrop-blur-xl cursor-pointer transition-all duration-300 hover:scale-105 hover:bg-white/10"
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                borderColor: profileAnimal.color,
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
              }}
              onClick={() => {
                soundManager.playClick()
                setShowProfileMenu(!showProfileMenu)
              }}
            >
              {/* Glass overlay */}
              <div 
                className="absolute inset-0 rounded-xl pointer-events-none"
                style={{
                  background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 50%)'
                }}
              />
              
              <div className="flex items-center gap-2 relative z-10">
                <span className="text-base sm:text-lg">{profileAnimal.emoji}</span>
                <span className="text-white font-bold text-xs sm:text-sm">
                  {currentProfile.name}
                </span>
              </div>
            </button>
            {showProfileMenu && (
              <ProfileOptionsMenu
                profile={currentProfile}
                onClose={() => setShowProfileMenu(false)}
                onViewProfile={() => {
                  if (onShowProfile) {
                    onShowProfile()
                  }
                }}
                onSwitchProfile={() => {
                  if (onSwitchProfile) {
                    onSwitchProfile()
                  }
                }}
                onLogout={() => {
                  if (onLogout) {
                    onLogout()
                  }
                }}
                position={menuPosition}
              />
            )}
          </>
        ) : (
          <Button
            onClick={() => {
              if (onSwitchProfile) {
                onSwitchProfile()
              }
            }}
            size="medium"
          >
            SELECT PROFILE
          </Button>
        )}
      </div>
    </>
  )
}

export default AppHUD

