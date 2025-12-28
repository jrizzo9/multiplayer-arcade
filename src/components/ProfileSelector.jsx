import { useState, useEffect } from 'react'
import { getAllProfiles, createProfile, setCurrentProfile, getCurrentProfile, getProfileStats, deleteProfile } from '../utils/profiles'
import { isCPUProfile } from '../utils/cpuPlayer'
import { getProfileAnimal } from '../utils/playerColors'
import Notification from './Notification'
import ConfirmationDialog from './ConfirmationDialog'
import ActiveProfilesManager from './ActiveProfilesManager'
import soundManager from '../utils/sounds'
import Button from './Button'

function ProfileSelector({ onProfileSelected, onExit }) {
  const [profiles, setProfiles] = useState([])
  const [selectedProfileId, setSelectedProfileId] = useState(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newProfileName, setNewProfileName] = useState('')
  const [error, setError] = useState('')
  const [notification, setNotification] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [showActiveProfilesManager, setShowActiveProfilesManager] = useState(false)

  useEffect(() => {
    loadProfiles()
    
    // Check for stale active sessions on load
    checkAndClearStaleSessions()
    
    // Poll for profile status updates every 2 seconds to check for logged-in profiles
    const interval = setInterval(() => {
      loadProfiles()
    }, 2000)
    
    return () => clearInterval(interval)
  }, [])

  const checkAndClearStaleSessions = async () => {
    try {
      // Check if there's a current profile in memory
      const current = await getCurrentProfile()
      if (!current) {
        // No profile is selected in memory, but database might have stale active sessions
        // Clear all active_sessions entries - profiles will still show as active if they're
        // actually in multiplayer games (the backend checks both active_sessions AND active players)
        const allProfiles = await getAllProfiles()
        const activeProfiles = allProfiles.filter(p => p.isActive)
        
        // Clear active sessions for all profiles
        // The backend will re-mark them as active if they're in multiplayer games
        for (const profile of activeProfiles) {
          try {
            const apiUrl = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8000`
            const response = await fetch(`${apiUrl}/api/user-profiles/${profile.id}/deactivate`, {
              method: 'POST'
            })
            if (response.ok) {
              console.log(`Cleared session for profile: ${profile.name}`)
            }
          } catch (error) {
            console.error(`Error clearing session for ${profile.name}:`, error)
          }
        }
      }
    } catch (error) {
      console.error('Error checking stale sessions:', error)
    }
  }

  const loadProfiles = async () => {
    try {
      console.log('[ProfileSelector] Loading profiles...')
      const allProfiles = await getAllProfiles()
      console.log('[ProfileSelector] Loaded profiles:', allProfiles.length, 'profiles')
      console.log('[ProfileSelector] Profile details:', allProfiles.map(p => ({ id: p.id, name: p.name, isActive: p.isActive })))
      
      if (allProfiles.length === 0) {
        // Check if this is because of an error or just no profiles exist
        const apiUrl = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8000`
        try {
          // Try to ping the backend to see if it's reachable
          const testResponse = await fetch(`${apiUrl}/api/user-profiles`, { method: 'HEAD' })
          if (!testResponse.ok && testResponse.status !== 405) {
            setError(`Backend server error (${testResponse.status}). Is the server running on port 8000?`)
          } else {
            // Server is reachable, just no profiles exist
            setError('')
          }
        } catch (fetchError) {
          console.error('[ProfileSelector] Cannot reach backend server:', fetchError)
          setError(`Cannot connect to backend server at ${apiUrl}. Is the server running on port 8000?`)
        }
      } else {
        setError('')
      }
      
      setProfiles(allProfiles)
      
      // Check if there's a current profile
      const current = await getCurrentProfile()
      if (current) {
        setSelectedProfileId(current.id)
      }
    } catch (error) {
      console.error('[ProfileSelector] Error loading profiles:', error)
      setError(`Failed to load profiles: ${error.message}`)
    }
  }

  // Separate CPU and regular profiles
  const cpuProfiles = profiles.filter(p => isCPUProfile(p))
  const regularProfiles = profiles.filter(p => !isCPUProfile(p))

  const handleSelectProfile = (profileId) => {
    setSelectedProfileId(profileId)
    setError('')
  }

  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) {
      setError('Please enter a name')
      soundManager.playError()
      return
    }

    // Check if name already exists
    if (profiles.some(p => p.name.toLowerCase() === newProfileName.trim().toLowerCase())) {
      setError('A profile with this name already exists')
      soundManager.playError()
      return
    }

    try {
      const newProfile = await createProfile(newProfileName.trim())
      await loadProfiles() // Reload from backend
      setSelectedProfileId(newProfile.id)
      setNewProfileName('')
      setIsCreating(false)
      setError('')
      soundManager.playSuccess()
      setNotification({ message: 'Profile created successfully', type: 'success' })
    } catch (error) {
      console.error('Error creating profile:', error)
      soundManager.playError()
      setNotification({ message: error.message || 'Failed to create profile. Please try again.', type: 'error' })
    }
  }

  const handleDeleteProfile = async (profileId, e) => {
    e.stopPropagation()
    const profile = profiles.find(p => p.id === profileId)
    if (!profile) return
    
    soundManager.playClick()
    setConfirmDialog({
      title: 'Delete Profile',
      message: `Are you sure you want to delete "${profile.name}"? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmDialog(null)
        try {
          await deleteProfile(profileId)
          await loadProfiles()
          if (selectedProfileId === profileId) {
            setSelectedProfileId(null)
          }
          soundManager.playSuccess()
          setNotification({ message: 'Profile deleted successfully', type: 'success' })
        } catch (error) {
          console.error('Error deleting profile:', error)
          soundManager.playError()
          setNotification({ message: error.message || 'Failed to delete profile', type: 'error' })
        }
      },
      onCancel: () => {
        soundManager.playNavigate()
        setConfirmDialog(null)
      }
    })
  }

  const handleContinue = async () => {
    if (!selectedProfileId) {
      setError('Please select or create a profile')
      soundManager.playError()
      return
    }

    const profile = profiles.find(p => p.id === selectedProfileId)
    if (!profile) {
      setError('Profile not found')
      soundManager.playError()
      return
    }

    soundManager.playSelect()
    await setCurrentProfile(profile.name) // Store by name and mark as active
    onProfileSelected(profile)
  }

  const handleProfileClick = async (profileId) => {
    soundManager.playSelect()
    handleSelectProfile(profileId)
    // Auto-continue after a short delay for better UX
    setTimeout(async () => {
      const profile = profiles.find(p => p.id === profileId)
      if (profile) {
        await setCurrentProfile(profile.name) // Store by name and mark as active
        onProfileSelected(profile)
      }
    }, 300)
  }

  const handleCancelCreate = () => {
    soundManager.playNavigate()
    setIsCreating(false)
    setNewProfileName('')
    setError('')
  }

  const handleExit = () => {
    soundManager.playNavigate()
    if (onExit) {
      onExit()
    }
  }

  // If showing active profiles manager, render it
  if (showActiveProfilesManager) {
    return (
      <ActiveProfilesManager
        onClose={() => setShowActiveProfilesManager(false)}
      />
    )
  }

  return (
    <div className="w-full h-screen bg-black flex flex-col relative px-medium overflow-hidden">
      {/* Exit/Back Button */}
      {onExit && (
        <button
          onClick={handleExit}
          className="absolute top-16 sm:top-20 left-4 z-50 flex items-center gap-1.5 px-2 py-1 text-xs border border-white/30 rounded hover:bg-white hover:text-black transition-all duration-200 cursor-pointer touch-manipulation"
          style={{ 
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(8px)'
          }}
        >
          <span className="text-xs">←</span>
          <span className="text-xs">Back</span>
        </button>
      )}
      
      {/* Force Logout / Active Profiles Manager Button */}
      <button
        onClick={() => {
          soundManager.playClick()
          setShowActiveProfilesManager(true)
        }}
        className="absolute top-16 sm:top-20 right-4 z-50 flex items-center gap-1.5 px-2 py-1 text-xs border border-white/30 rounded hover:bg-white hover:text-black transition-all duration-200 cursor-pointer touch-manipulation"
        style={{ 
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(8px)'
        }}
      >
        <span className="text-xs">Force Logout</span>
      </button>
      
      <div className="w-full h-full flex flex-col items-center justify-center overflow-y-auto pt-large pb-medium">
        <div className="w-full max-w-5xl mx-auto flex flex-col items-center pt-16 sm:pt-20 pb-12">
        <div className="flex flex-col items-center w-full mb-10 sm:mb-12 md:mb-16 relative px-4">
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold text-white text-center tracking-tight leading-tight">
            <span className="inline-block animate-fade-in">WHO'S</span>
            <br />
            <span className="inline-block animate-fade-in" style={{ animationDelay: '0.1s' }}>PLAYING?</span>
          </h1>
        </div>

        <div className="w-full flex flex-col items-center">
          {/* CPU Profiles Section - Separate and smaller */}
          {cpuProfiles.length > 0 && (
            <div className="w-full mb-8">
              <div className="text-xs sm:text-sm text-white/60 uppercase tracking-wider mb-3 text-center">CPU Players</div>
              <div className="w-full flex justify-center gap-2 sm:gap-3">
                {cpuProfiles.map((profile) => {
                  const isSelected = selectedProfileId === profile.id
                  const isDisabled = profile.isActive && !isSelected
                  
                  const animalStyle = profile.animal && profile.color 
                    ? { emoji: profile.animal, color: profile.color }
                    : { emoji: '🤖', color: '#808080' }
                  
                  return (
                    <div
                      key={profile.id}
                      className="flex flex-col items-center relative"
                    >
                      <div
                        onClick={() => {
                          if (!isDisabled) {
                            handleProfileClick(profile.id)
                          }
                        }}
                        onTouchStart={(e) => {
                          if (!isSelected && !isDisabled) {
                            e.currentTarget.style.transform = 'scale(1.05)'
                          }
                        }}
                        onTouchEnd={(e) => {
                          if (!isSelected && !isDisabled) {
                            e.currentTarget.style.transform = ''
                          }
                        }}
                        className={`w-16 h-16 sm:w-20 sm:h-20 flex flex-col items-center justify-center border rounded-lg transition-all duration-300 touch-manipulation relative overflow-hidden ${
                          isDisabled
                            ? 'opacity-40 cursor-not-allowed'
                            : isSelected
                            ? 'border-white bg-white scale-110 cursor-pointer shadow-lg shadow-white/20'
                            : 'border-white/60 hover:scale-105 hover:border-opacity-100 active:scale-105 cursor-pointer hover:shadow-lg hover:shadow-white/10'
                        }`}
                        style={{ 
                          borderColor: isSelected ? 'white' : (isDisabled ? '#666' : animalStyle.color),
                          backgroundColor: isSelected ? 'white' : (isDisabled ? '#333' : `${animalStyle.color}80`),
                          WebkitTapHighlightColor: 'transparent',
                          borderOpacity: isSelected ? 1 : (isDisabled ? 0.5 : 0.6),
                          backdropFilter: isSelected ? 'none' : 'blur(20px) saturate(180%)',
                          boxShadow: isSelected ? '0 10px 25px rgba(255, 255, 255, 0.2)' : '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2), inset 0 -1px 1px rgba(0, 0, 0, 0.1)'
                        }}
                      >
                        {/* Emoji */}
                        <span className="text-2xl sm:text-3xl leading-none relative z-10 transition-transform duration-300 flex items-center justify-center" style={{ lineHeight: 1 }}>
                          {animalStyle.emoji}
                        </span>
                        
                        {isDisabled && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70 rounded-lg backdrop-blur-sm z-20">
                            <span className="text-[8px] text-white font-bold tracking-wider">IN USE</span>
                          </div>
                        )}
                        {isSelected && (
                          <div className="absolute top-0.5 left-0.5 w-1.5 h-1.5 bg-black rounded-full border-2 border-white animate-pulse z-20" />
                        )}
                      </div>
                      
                      {/* Name below profile card */}
                      <div className={`font-bold text-[10px] sm:text-xs text-center mt-1 truncate w-16 sm:w-20 ${
                        isSelected ? 'text-white' : (isDisabled ? 'text-gray-500' : 'text-white')
                      }`}>
                        {profile.name}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Regular Profile Grid with Add Profile integrated */}
          <div className="w-full grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3 sm:gap-4 md:gap-5 mb-8">
            {regularProfiles.map((profile, index) => {
              const isSelected = selectedProfileId === profile.id
              const isDisabled = profile.isActive && !isSelected
              
              if (profile.isActive) {
                console.log(`Profile ${profile.name} is active, disabled: ${isDisabled}, selected: ${isSelected}`)
              }
              
              const animalStyle = profile.animal && profile.color 
                ? { emoji: profile.animal, color: profile.color }
                : getProfileAnimal(index)
              
              return (
                <div
                  key={profile.id}
                  className="flex flex-col items-center relative group"
                >
                  <div
                    onClick={() => {
                      if (!isDisabled) {
                        handleProfileClick(profile.id)
                      }
                    }}
                    onTouchStart={(e) => {
                      if (!isSelected && !isDisabled) {
                        e.currentTarget.style.transform = 'scale(1.05)'
                      }
                    }}
                    onTouchEnd={(e) => {
                      if (!isSelected && !isDisabled) {
                        e.currentTarget.style.transform = ''
                      }
                    }}
                    className={`w-full aspect-square flex flex-col items-center justify-center border rounded-lg sm:rounded-xl transition-all duration-300 touch-manipulation relative overflow-hidden ${
                      isDisabled
                        ? 'opacity-40 cursor-not-allowed'
                        : isSelected
                        ? 'border-white bg-white scale-105 sm:scale-110 cursor-pointer shadow-lg shadow-white/20'
                        : 'border-white hover:scale-105 hover:border-opacity-100 active:scale-105 cursor-pointer hover:shadow-lg hover:shadow-white/10'
                    }`}
                    style={{ 
                      containerType: 'size',
                      borderColor: isSelected ? 'white' : (isDisabled ? '#666' : animalStyle.color),
                      backgroundColor: isSelected ? 'white' : (isDisabled ? '#333' : `${animalStyle.color}80`),
                      WebkitTapHighlightColor: 'transparent',
                      borderOpacity: isSelected ? 1 : (isDisabled ? 0.5 : 0.6),
                      backdropFilter: isSelected ? 'none' : 'blur(20px) saturate(180%)',
                      boxShadow: isSelected ? '0 10px 25px rgba(255, 255, 255, 0.2)' : '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2), inset 0 -1px 1px rgba(0, 0, 0, 0.1)'
                    }}
                  >
                    {/* Darkening gradient overlay */}
                    {!isSelected && !isDisabled && (
                      <div 
                        className="absolute inset-0 rounded-lg sm:rounded-xl pointer-events-none z-0"
                        style={{
                          background: 'radial-gradient(circle at center, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.2) 70%, rgba(0, 0, 0, 0.4) 100%)'
                        }}
                      />
                    )}
                    
                    {/* Glass-like overlay effect - multiple layers for depth */}
                    {!isSelected && !isDisabled && (
                      <>
                        {/* Top highlight */}
                        <div 
                          className="absolute inset-0 rounded-lg sm:rounded-xl pointer-events-none z-0"
                          style={{
                            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.25) 0%, rgba(255, 255, 255, 0.1) 30%, rgba(255, 255, 255, 0) 60%)',
                            backdropFilter: 'blur(0.5px)'
                          }}
                        />
                        {/* Bottom shadow */}
                        <div 
                          className="absolute inset-0 rounded-lg sm:rounded-xl pointer-events-none z-0"
                          style={{
                            background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0) 60%, rgba(0, 0, 0, 0.15) 100%)',
                            backdropFilter: 'blur(0.5px)'
                          }}
                        />
                        {/* Edge highlight */}
                        <div 
                          className="absolute inset-0 rounded-lg sm:rounded-xl pointer-events-none z-0"
                          style={{
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.3), inset 0 -1px 1px rgba(0, 0, 0, 0.2)'
                          }}
                        />
                      </>
                    )}
                    {/* Delete button - inside profile card (only for regular profiles, not CPU) */}
                    {!isCPUProfile(profile) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!isDisabled) {
                            handleDeleteProfile(profile.id, e)
                          }
                        }}
                      onTouchStart={(e) => {
                        e.stopPropagation()
                        if (!isDisabled) {
                          e.currentTarget.style.backgroundColor = 'white'
                          e.currentTarget.style.color = 'black'
                        }
                      }}
                      onTouchEnd={(e) => {
                        e.stopPropagation()
                        if (!isDisabled) {
                          e.currentTarget.style.backgroundColor = ''
                          e.currentTarget.style.color = ''
                        }
                      }}
                      disabled={isDisabled}
                      className={`absolute top-1.5 right-1.5 sm:top-2 sm:right-2 w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center border border-white text-white hover:bg-white hover:text-black active:bg-white active:text-black transition-all duration-300 touch-manipulation rounded-full z-30 ${
                        isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:scale-110'
                      }`}
                      style={{ 
                        minWidth: '20px',
                        minHeight: '20px',
                        WebkitTapHighlightColor: 'transparent',
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        backdropFilter: 'blur(4px)'
                      }}
                        aria-label="Delete profile"
                      >
                        <svg 
                          className="w-2.5 h-2.5 sm:w-3 sm:h-3" 
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                    
                    {/* Emoji - 80% of card size */}
                    <span className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl leading-none relative z-10 transition-transform duration-300 group-hover:scale-110 flex items-center justify-center" style={{ lineHeight: 1 }}>
                      {animalStyle.emoji}
                    </span>
                    
                    {isDisabled && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70 rounded-lg sm:rounded-xl backdrop-blur-sm z-20">
                        <span className="text-[10px] sm:text-xs text-white font-bold tracking-wider">IN USE</span>
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute top-1 left-1 w-2 h-2 sm:w-2.5 sm:h-2.5 bg-black rounded-full border-2 border-white animate-pulse z-20" />
                    )}
                  </div>
                  
                  {/* Name below profile card */}
                  <div className={`font-bold text-xs sm:text-sm md:text-base text-center mt-2 truncate w-full ${
                    isSelected ? 'text-white' : (isDisabled ? 'text-gray-500' : 'text-white')
                  }`}>
                    {profile.name}
                  </div>
                </div>
              )
            })}

            {/* Add Profile Button - Integrated into grid */}
            {!isCreating && (
              <div className="flex flex-col items-center">
                <div
                  onClick={() => {
                    soundManager.playClick()
                    setIsCreating(true)
                  }}
                  onTouchStart={(e) => {
                    e.currentTarget.style.backgroundColor = 'white'
                    e.currentTarget.style.color = 'black'
                  }}
                  onTouchEnd={(e) => {
                    e.currentTarget.style.backgroundColor = ''
                    e.currentTarget.style.color = ''
                  }}
                  className="w-full aspect-square flex flex-col items-center justify-center border-2 border-white border-dashed rounded-lg cursor-pointer hover:bg-white hover:text-black hover:border-solid active:bg-white active:text-black transition-all duration-300 touch-manipulation group relative overflow-hidden hover:scale-105 hover:shadow-lg hover:shadow-white/10"
                  style={{ 
                    WebkitTapHighlightColor: 'transparent',
                    borderOpacity: 0.6
                  }}
                >
                  <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-5 transition-opacity duration-300 rounded-lg" />
                  <span className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl mb-1 sm:mb-1.5 relative z-10 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-90">+</span>
                  <div className="text-white text-[9px] sm:text-[10px] md:text-xs font-semibold relative z-10 text-center px-1">Add</div>
                </div>
              </div>
            )}
          </div>

          {/* Create Profile Form */}
          {isCreating && (
            <div className="w-full max-w-md flex flex-col gap-6 items-center mt-8">
              <div className="flex flex-col items-center gap-3">
                <div className="text-6xl sm:text-7xl">{getProfileAnimal(profiles.length).emoji}</div>
                <div className="text-sm text-gray-400 text-center" style={{ color: getProfileAnimal(profiles.length).color }}>
                  Your new profile will have this animal
                </div>
              </div>
              <input
                type="text"
                value={newProfileName}
                onChange={(e) => {
                  setNewProfileName(e.target.value)
                  setError('')
                }}
                placeholder="Enter profile name"
                className="w-full px-medium py-small text-white bg-transparent border-2 border-white rounded-lg focus:outline-none focus:bg-white focus:text-black transition-all duration-200 text-center text-lg touch-manipulation"
                style={{ 
                  fontSize: '16px',
                  WebkitTapHighlightColor: 'transparent'
                }}
                maxLength={20}
                autoFocus
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateProfile()
                  }
                }}
              />
              <div className="flex gap-4 w-full">
                <Button
                  onClick={handleCreateProfile}
                  variant="secondary"
                  size="small"
                  className="flex-1"
                >
                  Create
                </Button>
                <Button
                  onClick={handleCancelCreate}
                  variant="secondary"
                  size="small"
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-red-400 text-sm text-center mt-4 max-w-md">{error}</p>
          )}
        </div>
        </div>
      </div>
      
      {/* Notification */}
      {notification && (
        <Notification
          message={notification.message}
          type={notification.type}
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
          confirmText="Delete"
          cancelText="Cancel"
        />
      )}
    </div>
  )
}

export default ProfileSelector

