import { useEffect } from 'react'
import soundManager from '../utils/sounds'

function Notification({ message, type = 'info', onClose, duration = 3000 }) {
  useEffect(() => {
    // Play sound based on notification type
    if (type === 'success') {
      soundManager.playSuccess()
    } else if (type === 'error') {
      soundManager.playError()
    } else {
      soundManager.playClick()
    }
  }, [type])

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        if (onClose) {
          onClose()
        }
      }, duration)
      return () => clearTimeout(timer)
    }
  }, [duration, onClose])

  // Determine colors and icon based on type
  const getStyles = () => {
    switch (type) {
      case 'success':
        return {
          bgColor: 'rgba(34, 197, 94, 0.15)',
          borderColor: 'rgba(34, 197, 94, 0.4)',
          textColor: '#4ade80',
          icon: '✓'
        }
      case 'error':
        return {
          bgColor: 'rgba(239, 68, 68, 0.15)',
          borderColor: 'rgba(239, 68, 68, 0.4)',
          textColor: '#f87171',
          icon: '✕'
        }
      default:
        return {
          bgColor: 'rgba(59, 130, 246, 0.15)',
          borderColor: 'rgba(59, 130, 246, 0.4)',
          textColor: '#60a5fa',
          icon: 'ℹ'
        }
    }
  }

  const styles = getStyles()

  return (
    <div 
      className="fixed bottom-8 right-8 z-50 px-5 py-3 text-center max-w-xs rounded-xl shadow-2xl backdrop-blur-md animate-slideIn"
      style={{
        backgroundColor: styles.bgColor,
        border: `2px solid ${styles.borderColor}`,
        boxShadow: `0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)`,
        animation: 'slideIn 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
      }}
    >
      <div className="flex items-center justify-start gap-3">
        <span 
          className="text-xl font-bold flex-shrink-0"
          style={{ color: styles.textColor }}
        >
          {styles.icon}
        </span>
        <div 
          className="font-semibold text-base text-left"
          style={{ color: styles.textColor }}
        >
          {message}
        </div>
      </div>
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  )
}

export default Notification

