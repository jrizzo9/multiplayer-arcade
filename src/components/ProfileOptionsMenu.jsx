import { useEffect, useRef } from 'react'
import soundManager from '../utils/sounds'

function ProfileOptionsMenu({ profile, onClose, onViewProfile, onSwitchProfile, onLogout, position }) {
  const menuRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose()
      }
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  if (!profile) return null

  const menuStyle = {
    position: 'fixed',
    top: position?.top ? `${position.top}px` : 'auto',
    bottom: position?.bottom ? `${position.bottom}px` : 'auto',
    right: position?.right ? `${position.right}px` : 'auto',
    left: position?.left ? `${position.left}px` : 'auto',
  }

  return (
    <div
      ref={menuRef}
      className="border rounded-xl p-small min-w-[200px] relative overflow-hidden z-[1001]"
      style={{
        ...menuStyle,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        borderColor: 'rgba(255, 255, 255, 0.3)',
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

      <div className="space-y-1 relative z-10">
        <button
          onClick={() => {
            soundManager.playClick()
            onViewProfile()
            onClose()
          }}
          className="w-full text-left px-4 py-3 text-white border rounded-lg hover:bg-white hover:text-black active:bg-white active:text-black transition-all duration-300 cursor-pointer font-medium hover:scale-[1.02]"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.2)',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            backdropFilter: 'blur(12px)'
          }}
        >
          View Profile
        </button>
        
        <button
          onClick={() => {
            soundManager.playClick()
            onSwitchProfile()
            onClose()
          }}
          className="w-full text-left px-4 py-3 text-white border rounded-lg hover:bg-white hover:text-black active:bg-white active:text-black transition-all duration-300 cursor-pointer font-medium hover:scale-[1.02]"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.2)',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            backdropFilter: 'blur(12px)'
          }}
        >
          Switch Profile
        </button>
        
        <button
          onClick={() => {
            soundManager.playClick()
            onLogout()
            onClose()
          }}
          className="w-full text-left px-4 py-3 text-white border rounded-lg hover:bg-white hover:text-black active:bg-white active:text-black transition-all duration-300 cursor-pointer font-medium hover:scale-[1.02]"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.2)',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            backdropFilter: 'blur(12px)'
          }}
        >
          Logout
        </button>
      </div>
    </div>
  )
}

export default ProfileOptionsMenu

