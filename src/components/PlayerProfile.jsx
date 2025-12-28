import { useState, useEffect } from 'react'
import { clearCurrentProfile } from '../utils/profiles'
import soundManager from '../utils/sounds'

const getApiUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  // Always use the same protocol as the current page to avoid mixed content errors
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
  return `${protocol}//${window.location.hostname}:8000`
}

function PlayerProfile({ player, isCurrentPlayer, onClose, onLogout }) {
  const [profileData, setProfileData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!player?.userProfileId) {
      setLoading(false)
      return
    }

    const fetchProfileData = async () => {
      try {
        setLoading(true)
        setError(null)
        const apiUrl = `${getApiUrl()}/api/user-profiles/${player.userProfileId}`
        console.log('Fetching profile data from:', apiUrl)
        
        const response = await fetch(apiUrl)
        
        if (!response.ok) {
          const errorText = await response.text()
          console.error('API Error Response:', response.status, errorText)
          throw new Error(`Failed to fetch profile data: ${response.status} ${response.statusText}`)
        }
        
        const data = await response.json()
        console.log('Profile data received:', data)
        setProfileData(data)
        setError(null)
      } catch (err) {
        console.error('Error fetching profile data:', err)
        console.error('Profile ID:', player.userProfileId)
        console.error('Player object:', player)
        setError(err.message || 'Failed to fetch profile data. Please check the browser console for details.')
      } finally {
        setLoading(false)
      }
    }

    fetchProfileData()
  }, [player?.userProfileId])

  if (!player) return null

  const handleLogout = async () => {
    if (isCurrentPlayer) {
      await clearCurrentProfile()
      onClose()
      if (onLogout) {
        onLogout()
      }
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'Never'
    try {
      // Parse the date string
      if (dateString.includes('T')) {
        // ISO format - parse and format in Central Time
        const date = new Date(dateString)
        return date.toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/Chicago'
        })
      } else {
        // SQLite format 'YYYY-MM-DD HH:MM:SS' - stored in Central Time (new records)
        // Parse the components
        const [datePart, timePart] = dateString.split(' ')
        const [year, month, day] = datePart.split('-').map(Number)
        const [hour, minute, second] = (timePart || '00:00:00').split(':').map(Number)
        
        // The stored time is in Central Time format
        // Create an ISO string with Central Time offset
        // Determine if DST applies (roughly March-November)
        const isDST = (month >= 3 && month <= 10) || 
                      (month === 2 && day >= 8) || 
                      (month === 11 && day <= 7)
        const offsetStr = isDST ? '-05:00' : '-06:00' // CDT is UTC-5, CST is UTC-6
        
        // Create ISO string treating the stored time as Central Time
        // Example: "2024-01-15 14:23:00" (2:23 PM Central) becomes "2024-01-15T14:23:00-06:00"
        const isoString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second || 0).padStart(2, '0')}${offsetStr}`
        const date = new Date(isoString)
        
        // Format in Central Time - this should display the same time that was stored
        return date.toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/Chicago'
        })
      }
    } catch (error) {
      console.error('Error formatting date:', dateString, error)
      return dateString
    }
  }

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[2000] px-medium"
      onClick={() => {
        soundManager.playNavigate()
        onClose()
      }}
    >
      <div 
        className="border rounded-xl p-large max-w-md w-full max-h-[90vh] overflow-y-auto relative overflow-hidden"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          borderColor: 'rgba(255, 255, 255, 0.3)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
        }}
        onClick={(e) => e.stopPropagation()}
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
        
        <div className="flex justify-between items-center mb-6 relative z-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">Profile</h2>
          <button
            onClick={() => {
              soundManager.playNavigate()
              onClose()
            }}
            className="w-8 h-8 flex items-center justify-center text-white hover:text-gray-300 transition-all duration-300 hover:scale-110 rounded-full hover:bg-white/10"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Player Info */}
        <div className="mb-8 relative z-10">
          <div className="flex items-center gap-4 mb-2">
            <span className="text-5xl sm:text-6xl">{player.emoji || '⚪'}</span>
            <div>
              <div className="text-2xl sm:text-3xl font-bold text-white" style={{ color: player.color || '#FFFFFF' }}>
                {player.name || 'Unknown Player'}
              </div>
              {isCurrentPlayer && (
                <div className="text-xs text-white/60 mt-1 font-medium">You</div>
              )}
            </div>
          </div>
        </div>

        {/* Profile Data */}
        {loading && (
          <div className="text-white text-center py-large relative z-10">Loading profile data...</div>
        )}

        {error && (
          <div className="text-red-400 text-center py-large relative z-10 border border-red-500/50 rounded-lg bg-red-500/10 p-medium">
            Error: {error}
          </div>
        )}

        {profileData && !loading && (
          <div className="space-y-6 relative z-10">
            <div className="border-t border-white/20 pt-4">
              <div className="text-xs text-white/60 uppercase tracking-wider mb-2">Profile Created</div>
              <div className="text-white font-medium">{formatDate(profileData.created_at)}</div>
            </div>

            <div className="border-t border-white/20 pt-4">
              <div className="text-xs text-white/60 uppercase tracking-wider mb-2">Last Seen</div>
              <div className="text-white font-medium">{formatDate(profileData.last_seen)}</div>
            </div>

            {profileData.stats && (
              <div className="border-t border-white/20 pt-4">
                <div className="text-sm text-white/80 font-semibold mb-4 uppercase tracking-wider">Overall Statistics</div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="p-small rounded-lg" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                    <div className="text-xs text-white/60 mb-1 uppercase tracking-wider">Rooms Joined</div>
                    <div className="text-white text-xl font-bold">{profileData.stats.overall?.totalRooms || 0}</div>
                  </div>
                  <div className="p-small rounded-lg" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                    <div className="text-xs text-white/60 mb-1 uppercase tracking-wider">Games Played</div>
                    <div className="text-white text-xl font-bold">{profileData.stats.overall?.gamesWithScore || 0}</div>
                  </div>
                  <div className="p-small rounded-lg" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                    <div className="text-xs text-white/60 mb-1 uppercase tracking-wider">Best Score</div>
                    <div className="text-white text-xl font-bold">{profileData.stats.overall?.bestScore || 0}</div>
                  </div>
                  <div className="p-small rounded-lg" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                    <div className="text-xs text-white/60 mb-1 uppercase tracking-wider">Total Score</div>
                    <div className="text-white text-xl font-bold">{profileData.stats.overall?.totalScore || 0}</div>
                  </div>
                </div>

                {profileData.stats.byGame && Object.keys(profileData.stats.byGame).length > 0 && (
                  <div className="border-t border-white/20 pt-4">
                    <div className="text-sm text-white/80 font-semibold mb-4 uppercase tracking-wider">By Game</div>
                    <div className="space-y-3">
                      {Object.entries(profileData.stats.byGame).map(([gameName, gameStat]) => (
                        <div 
                          key={gameName} 
                          className="rounded-lg p-4 border"
                          style={{ 
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            borderColor: 'rgba(255, 255, 255, 0.1)'
                          }}
                        >
                          <div className="text-xs text-white/80 mb-3 uppercase font-semibold tracking-wider">{gameName}</div>
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <div className="text-xs text-white/60 mb-1 uppercase tracking-wider">Games</div>
                              <div className="text-white font-bold text-base">{gameStat.gamesPlayed || 0}</div>
                            </div>
                            <div>
                              <div className="text-xs text-white/60 mb-1 uppercase tracking-wider">Best</div>
                              <div className="text-white font-bold text-base">{gameStat.bestScore || 0}</div>
                            </div>
                            <div>
                              <div className="text-xs text-white/60 mb-1 uppercase tracking-wider">Total</div>
                              <div className="text-white font-bold text-base">{gameStat.totalScore || 0}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-white/20 pt-4">
              <div className="text-xs text-white/60 uppercase tracking-wider mb-2">Color</div>
              <div className="flex items-center gap-3">
                <div 
                  className="w-8 h-8 rounded-full border-2"
                  style={{ 
                    backgroundColor: profileData.color || '#FFFFFF',
                    borderColor: 'rgba(255, 255, 255, 0.3)'
                  }}
                />
                <div className="text-white font-medium">{profileData.color_name || 'Unknown'}</div>
              </div>
            </div>

            {isCurrentPlayer && (
              <div className="border-t border-white/20 pt-6">
                <button
                  onClick={() => {
                    soundManager.playNavigate()
                    handleLogout()
                  }}
                  className="w-full px-6 py-3 text-white border rounded-lg hover:bg-white hover:text-black active:bg-white active:text-black transition-all duration-300 cursor-pointer font-semibold hover:scale-105"
                  style={{
                    borderColor: 'rgba(255, 255, 255, 0.3)',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(12px)'
                  }}
                >
                  LOG OUT
                </button>
              </div>
            )}
          </div>
        )}

        {!profileData && !loading && !error && (
          <div className="text-white/60 text-center py-8 relative z-10">
            No profile data available
          </div>
        )}
      </div>
    </div>
  )
}

export default PlayerProfile

