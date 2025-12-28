import { useRoom } from '../multiplayer/RoomProvider'
import { getCurrentProfile } from '../utils/profiles'
import { useState, useEffect } from 'react'
import soundManager from '../utils/sounds'

// Helper function to get server URL
function getServerUrl() {
  return `http://${window.location.hostname}:8000`
}

// Helper function to get roomId from URL
function getRoomIdFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('room')
}

function GameHUB({ onBack, currentGame, gameScore, scorePulse }) {
  const roomId = getRoomIdFromUrl()
  const roomState = useRoom(roomId)
  const [currentProfile, setCurrentProfile] = useState(null)
  const [wins, setWins] = useState({}) // { userProfileId: winCount }
  
  useEffect(() => {
    getCurrentProfile().then(setCurrentProfile)
  }, [])
  
  const players = roomState.players || []
  
  // Fetch wins for current game
  useEffect(() => {
    if (!currentGame || !roomId) return
    
    const fetchWins = async () => {
      try {
        const response = await fetch(`${getServerUrl()}/api/wins/room/${roomId}/${currentGame}`)
        if (response.ok) {
          const data = await response.json()
          const winsMap = {}
          data.wins.forEach(({ userProfileId, wins: winCount }) => {
            winsMap[userProfileId] = winCount
          })
          setWins(winsMap)
        }
      } catch (error) {
        console.error('[GameHUB] Error fetching wins:', error)
      }
    }
    
    fetchWins()
    
    // Refresh wins periodically
    const interval = setInterval(fetchWins, 5000)
    return () => clearInterval(interval)
  }, [currentGame, roomId, players])
  
  if (!currentGame) return null
  
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[1000] px-4 py-3"
      style={{
        height: '10vh',
        background: 'linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, rgba(0, 0, 0, 0.4) 70%, transparent 100%)',
        backdropFilter: 'blur(20px)'
      }}
    >
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 relative">
        {/* Left side - Game info */}
        <div className="flex items-center gap-4">
          <div className="text-white/80 text-sm font-semibold uppercase tracking-wider">
            {currentGame.toUpperCase()}
          </div>
        </div>
        
        {/* Center - Win tracking display */}
        {players.length > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 border rounded absolute left-1/2 transform -translate-x-1/2"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              borderColor: 'rgba(255, 255, 255, 0.2)',
              backdropFilter: 'blur(8px)'
            }}
          >
            {players.map((player, idx) => {
              const winCount = wins[player.userProfileId] || 0
              return (
                <div key={player.userProfileId || idx} className="flex items-center gap-1">
                  <span className="text-xs">{player.emoji || '⚪'}</span>
                  <span 
                    className="text-xs font-bold"
                    style={{ color: player.color || '#FFFFFF' }}
                  >
                    {winCount}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        
        {/* Right side - Back button */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              soundManager.playClick()
              if (onBack) {
                onBack()
              }
            }}
            className="px-4 py-2 text-sm text-white border rounded-lg hover:bg-white hover:text-black transition-all duration-300 cursor-pointer font-medium hover:scale-105"
            style={{
              borderColor: 'rgba(255, 255, 255, 0.3)',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(12px)'
            }}
          >
            ← Back
          </button>
        </div>
      </div>
    </div>
  )
}

export default GameHUB

