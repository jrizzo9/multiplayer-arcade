import { useEffect } from 'react'
import soundManager from '../utils/sounds'
import Button from './Button'

function ErrorModal({ isOpen, title = 'Error', message, onClose }) {
  // Play error sound when modal opens
  useEffect(() => {
    if (isOpen) {
      soundManager.playError()
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 px-medium" onClick={onClose}>
      <div 
        className="bg-black border-2 border-red-500 rounded-lg p-large max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-2xl font-bold text-white mb-4">{title}</h2>
        <p className="text-white mb-6">{message}</p>
        <div className="flex justify-end">
          <Button
            onClick={() => {
              soundManager.playNavigate()
              onClose()
            }}
            variant="secondary"
            size="medium"
            style={{ 
              minWidth: '44px',
              minHeight: '44px'
            }}
          >
            OK
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ErrorModal

