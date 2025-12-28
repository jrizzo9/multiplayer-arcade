import soundManager from '../utils/sounds'

function Button({ 
  children, 
  onClick, 
  variant = 'primary', 
  size = 'medium',
  className = '',
  disabled = false,
  type = 'button',
  ...props 
}) {
  const handleClick = (e) => {
    if (!disabled && onClick) {
      soundManager.playClick()
      onClick(e)
    }
  }

  const baseClasses = 'border rounded-xl relative overflow-hidden backdrop-blur-xl cursor-pointer transition-all duration-300 touch-manipulation'
  
  const sizeClasses = {
    small: 'px-small py-small text-xs sm:text-sm',
    medium: 'px-medium py-small text-sm sm:text-base',
    large: 'px-large py-medium text-base sm:text-lg'
  }

  const variantStyles = {
    primary: {
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
      borderColor: 'rgba(255, 255, 255, 0.3)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
      hoverClass: 'hover:scale-105 hover:bg-white/10'
    },
    secondary: {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      borderColor: 'rgba(255, 255, 255, 0.3)',
      boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
      hoverClass: 'hover:scale-105 hover:bg-white hover:text-black'
    },
    danger: {
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      borderColor: 'rgba(239, 68, 68, 0.5)',
      boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
      hoverClass: 'hover:scale-105 hover:bg-red-500 hover:text-white'
    },
    success: {
      backgroundColor: 'rgba(34, 197, 94, 0.1)',
      borderColor: 'rgba(34, 197, 94, 0.5)',
      boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
      hoverClass: 'hover:scale-105 hover:bg-green-500 hover:text-white'
    }
  }

  const variantStyle = variantStyles[variant] || variantStyles.primary
  const sizeClass = sizeClasses[size] || sizeClasses.medium

  return (
    <button
      type={type}
      onClick={handleClick}
      disabled={disabled}
      className={`${baseClasses} ${sizeClass} ${variantStyle.hoverClass} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      style={{
        backgroundColor: variantStyle.backgroundColor,
        borderColor: variantStyle.borderColor,
        boxShadow: variantStyle.boxShadow,
        ...props.style
      }}
      {...props}
    >
      {/* Glass overlay */}
      {!disabled && (
        <div 
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 50%)'
          }}
        />
      )}
      
      <span className="font-bold text-white relative z-10">
        {children}
      </span>
    </button>
  )
}

export default Button

