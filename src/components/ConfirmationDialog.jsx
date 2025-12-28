import soundManager from '../utils/sounds'
import Button from './Button'

function ConfirmationDialog({ isOpen, title, message, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel' }) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 px-medium" onClick={onCancel}>
      <div 
        className="bg-black border-2 border-white rounded-lg p-large max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-2xl font-bold text-white mb-4">{title}</h2>
        <p className="text-white mb-6">{message}</p>
        <div className="flex gap-4 justify-end">
          <Button
            onClick={() => {
              soundManager.playNavigate()
              onCancel()
            }}
            variant="secondary"
            size="medium"
            style={{ 
              minWidth: '44px',
              minHeight: '44px'
            }}
          >
            {cancelText}
          </Button>
          <Button
            onClick={() => {
              soundManager.playSelect()
              onConfirm()
            }}
            variant="danger"
            size="medium"
            style={{ 
              minWidth: '44px',
              minHeight: '44px'
            }}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmationDialog

