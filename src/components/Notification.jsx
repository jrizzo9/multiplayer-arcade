import { useEffect } from 'react'
import soundManager from '../utils/sounds'
import Button from './Button'

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

  const bgColor = type === 'error' ? 'bg-red-600' : type === 'success' ? 'bg-green-600' : 'bg-blue-600'

  return (
    <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 ${bgColor} border-2 border-white px-large py-medium text-white text-center max-w-md rounded-lg shadow-lg`}>
      <div className="font-bold mb-1">{type === 'error' ? 'Error' : type === 'success' ? 'Success' : 'Info'}</div>
      <div>{message}</div>
      {onClose && (
        <Button
          onClick={onClose}
          variant="secondary"
          size="small"
          className="mt-3"
        >
          Close
        </Button>
      )}
    </div>
  )
}

export default Notification

