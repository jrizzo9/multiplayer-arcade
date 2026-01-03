import { useRoom } from '../multiplayer/RoomProvider'
import { getCurrentProfile } from '../utils/profiles'
import { useState, useEffect } from 'react'

// Helper function to get roomId from URL (single source of truth)
function getRoomIdFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('room')
}

function RoomHUD({ onShowRoom }) {
  const roomId = getRoomIdFromUrl()
  const roomState = useRoom(roomId)
  const [currentProfile, setCurrentProfile] = useState(null)
  
  useEffect(() => {
    getCurrentProfile().then(setCurrentProfile)
  }, [])
  
  // Only render if we have a roomId
  if (!roomId) {
    return null
  }
  
  const players = roomState.players || []
  const playerCount = players.length
  const maxPlayers = 4
  const isHost = currentProfile && roomState.isHost(currentProfile.id)
  
  const handleClick = () => {
    if (onShowRoom) {
      onShowRoom()
    } else {
      // Fallback: dispatch custom event
      window.dispatchEvent(new CustomEvent('show-room-manager'))
    }
  }
  
  return (
    <div className="fixed top-4 sm:top-6 left-4 sm:left-6 z-[1000]">
      <button
        onClick={handleClick}
        className="border rounded-xl px-4 sm:px-5 py-2.5 sm:py-3 relative overflow-hidden backdrop-blur-xl cursor-pointer transition-all duration-300 hover:scale-105 hover:bg-white/10"
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
        
        <div className="flex items-center gap-3 relative z-10">
          <div className="text-sm sm:text-base font-bold text-white">
            {roomId}
          </div>
          {isHost && (
            <span className="px-2 py-0.5 text-[10px] font-bold text-black bg-white rounded-full">
              HOST
            </span>
          )}
          <div className="flex items-center gap-1.5">
            {players.map((player, index) => {
              // CRITICAL: For current player, always use profile emoji from NoCodeBackend as source of truth
              // For other players, use emoji from room state (which should match their NoCodeBackend profile)
              const isCurrentPlayer = currentProfile && player.userProfileId && 
                String(player.userProfileId) === String(currentProfile.id)
              const playerEmoji = isCurrentPlayer && currentProfile?.emoji
                ? currentProfile.emoji
                : player.emoji || '⚪'
              const playerColor = isCurrentPlayer && currentProfile?.color
                ? currentProfile.color
                : player.color || '#FFFFFF'
              const playerName = player.name || 'Unknown Player'
              
              return (
                <div
                  key={player.userProfileId || player.id || index}
                  className="relative w-6 h-6 sm:w-7 sm:h-7 rounded-full border flex items-center justify-center text-sm sm:text-base"
                  style={{ 
                    borderColor: playerColor,
                    backgroundColor: `${playerColor}20`,
                    marginLeft: index > 0 ? '-4px' : '0',
                    zIndex: players.length - index
                  }}
                  title={playerName}
                >
                  {playerEmoji}
                </div>
              )
            })}
          </div>
          <span className="text-xs text-white/60">
            {playerCount}/{maxPlayers}
          </span>
        </div>
      </button>
    </div>
  )
}

export default RoomHUD

