import { useState, useEffect } from 'react'
import Notification from './Notification'
import ConfirmationDialog from './ConfirmationDialog'

const getApiUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  return `http://${window.location.hostname}:8000`
}

function ActiveProfilesManager({ onClose }) {
  const [activeProfiles, setActiveProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notification, setNotification] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [cleaningUp, setCleaningUp] = useState(false)

  useEffect(() => {
    loadActiveProfiles()
    // Poll every 3 seconds to keep data fresh
    const interval = setInterval(loadActiveProfiles, 3000)
    return () => clearInterval(interval)
  }, [])

  const loadActiveProfiles = async () => {
    try {
      setError(null)
      const response = await fetch(`${getApiUrl()}/api/user-profiles/active`)
      if (!response.ok) {
        throw new Error('Failed to load active profiles')
      }
      const data = await response.json()
      setActiveProfiles(data.profiles || [])
    } catch (err) {
      console.error('Error loading active profiles:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleForceLogout = (profile) => {
    console.log('Force logout clicked for profile:', profile)
    setConfirmDialog({
      title: 'Force Logout',
      message: `Are you sure you want to force logout "${profile.profileName}"? This will remove their active session and mark all their players as left.`,
      onConfirm: async () => {
        try {
          console.log('Confirming force logout for:', profile.profileId)
          const apiUrl = `${getApiUrl()}/api/user-profiles/${profile.profileId}/force-logout`
          console.log('Calling API:', apiUrl)
          
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ markPlayersLeft: true })
          })
          
          console.log('Response status:', response.status)
          
          if (!response.ok) {
            const errorText = await response.text()
            console.error('API error response:', errorText)
            throw new Error(`Failed to logout profile: ${response.status} ${response.statusText}`)
          }
          
          const result = await response.json()
          console.log('Logout result:', result)
          
          setNotification({
            type: 'success',
            message: `Logged out ${profile.profileName}. ${result.playersMarkedLeft} player(s) marked as left.`
          })
          await loadActiveProfiles()
        } catch (err) {
          console.error('Error logging out profile:', err)
          setNotification({
            type: 'error',
            message: `Failed to logout profile: ${err.message}`
          })
        }
        setConfirmDialog(null)
      },
      onCancel: () => {
        console.log('Force logout cancelled')
        setConfirmDialog(null)
      }
    })
  }

  const handleCleanupStale = () => {
    setConfirmDialog({
      title: 'Cleanup Stale Players',
      message: 'This will mark all players inactive for 10+ minutes as left. Continue?',
      onConfirm: async () => {
        try {
          setCleaningUp(true)
          const response = await fetch(`${getApiUrl()}/api/admin/cleanup-stale`, {
            method: 'POST'
          })
          
          if (!response.ok) {
            throw new Error('Failed to cleanup stale players')
          }
          
          const result = await response.json()
          setNotification({
            type: 'success',
            message: `Cleaned up ${result.playersCleaned} stale player(s). ${result.profilesAffected} profile(s) affected.`
          })
          await loadActiveProfiles()
        } catch (err) {
          console.error('Error cleaning up stale players:', err)
          setNotification({
            type: 'error',
            message: `Failed to cleanup: ${err.message}`
          })
        } finally {
          setCleaningUp(false)
          setConfirmDialog(null)
          }
      },
      onCancel: () => setConfirmDialog(null)
    })
  }

  const getReasonLabel = (reasons) => {
    if (reasons.includes('session') && reasons.includes('in_room')) {
      return 'Session + In Room'
    } else if (reasons.includes('session')) {
      return 'Active Session'
    } else if (reasons.includes('in_room')) {
      return 'In Room'
    }
    return 'Unknown'
  }

  if (loading && activeProfiles.length === 0) {
    return (
      <div className="w-full h-screen bg-black flex items-center justify-center">
        <div className="text-white text-xl">Loading active profiles...</div>
      </div>
    )
  }

  return (
    <div className="w-full min-h-screen bg-black flex flex-col items-center px-4 py-8 pt-20 sm:pt-24">
      {/* Header */}
      <div className="w-full max-w-4xl mb-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl sm:text-4xl font-bold text-white">ACTIVE PROFILES</h1>
          <button
            onClick={onClose}
            className="px-2 py-1 text-xs font-bold text-white border border-white/30 rounded hover:bg-white hover:text-black active:bg-white active:text-black transition-all duration-200 cursor-pointer touch-manipulation"
            style={{ 
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(8px)'
            }}
          >
            ✕ Close
          </button>
        </div>
        
        {/* Actions */}
        <div className="flex gap-3 mb-4">
          <button
            onClick={handleCleanupStale}
            disabled={cleaningUp}
            className="px-2 py-1 text-xs font-bold text-white border border-white/30 rounded hover:bg-white hover:text-black active:bg-white active:text-black transition-all duration-200 cursor-pointer touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ 
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(8px)'
            }}
          >
            {cleaningUp ? 'Cleaning...' : 'Cleanup Stale Players'}
          </button>
          <button
            onClick={loadActiveProfiles}
            className="px-2 py-1 text-xs font-bold text-white border border-white/30 rounded hover:bg-white hover:text-black active:bg-white active:text-black transition-all duration-200 cursor-pointer touch-manipulation"
            style={{ 
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(8px)'
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="w-full max-w-4xl mb-4 px-4 py-2 bg-red-900 border-2 border-red-500 text-white rounded">
          Error: {error}
        </div>
      )}

      {/* Active Profiles List */}
      <div className="w-full max-w-4xl">
        {activeProfiles.length === 0 ? (
          <div className="text-white text-center py-8">
            <p className="text-xl mb-2">No active profiles</p>
            <p className="text-sm opacity-75">All profiles are logged out</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeProfiles.map((profile) => (
              <div
                key={profile.profileId}
                className="border-2 border-white rounded-lg p-4 bg-black"
              >
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-xl font-bold text-white">{profile.profileName}</h3>
                      <span className="px-2 py-1 text-xs font-semibold text-white border border-white rounded">
                        {getReasonLabel(profile.activeReasons)}
                      </span>
                    </div>
                    
                    <div className="space-y-1 text-sm text-white opacity-75">
                      {profile.activeReasons.includes('session') && (
                        <div>Session created: {new Date(profile.sessionCreatedAt).toLocaleString()}</div>
                      )}
                      {profile.activeReasons.includes('in_room') && (
                        <>
                          <div>Players in rooms: {profile.playerCount}</div>
                          <div>Rooms: {profile.roomIds.join(', ') || 'None'}</div>
                          {profile.firstJoined && (
                            <div>First joined: {new Date(profile.firstJoined).toLocaleString()}</div>
                          )}
                          {profile.lastActivity && (
                            <div>Last activity: {new Date(profile.lastActivity).toLocaleString()}</div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  
                  <button
                    onClick={() => handleForceLogout(profile)}
                    className="px-2 py-1 text-xs font-bold text-white border border-white/30 rounded hover:bg-white hover:text-black active:bg-white active:text-black transition-all duration-200 cursor-pointer touch-manipulation whitespace-nowrap"
                    style={{ 
                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      backdropFilter: 'blur(8px)'
                    }}
                  >
                    Force Logout
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notification */}
      {notification && (
        <Notification
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <ConfirmationDialog
          isOpen={true}
          title={confirmDialog.title}
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={confirmDialog.onCancel}
        />
      )}
    </div>
  )
}

export default ActiveProfilesManager

