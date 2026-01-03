/**
 * PlayerAvatar - Consistent player profile display component
 * Ensures all player profiles are displayed uniformly across the app
 */

import { normalizePlayerData } from '../utils/playerColors'

function PlayerAvatar({ 
  player, 
  size = 'medium', // 'small', 'medium', 'large'
  showName = false,
  showNameBelow = false,
  className = '',
  style = {}
}) {
  // Normalize player data to ensure consistent properties
  const normalized = normalizePlayerData(player)
  // Only use emoji from NoCodeBackend, no fallback to animal
  const emoji = normalized.emoji || '⚪'
  const { color, name } = normalized
  
  const sizeClasses = {
    small: {
      container: 'w-6 h-6 sm:w-7 sm:h-7',
      emoji: 'text-sm sm:text-base',
      name: 'text-xs'
    },
    medium: {
      container: 'w-8 h-8 sm:w-10 sm:h-10',
      emoji: 'text-base sm:text-lg',
      name: 'text-sm'
    },
    large: {
      container: 'w-12 h-12 sm:w-16 sm:h-16',
      emoji: 'text-xl sm:text-2xl',
      name: 'text-base'
    }
  }
  
  const sizeConfig = sizeClasses[size] || sizeClasses.medium
  
  return (
    <div className={`flex items-center gap-2 ${className}`} style={style}>
      <div
        className={`${sizeConfig.container} rounded-full border flex items-center justify-center ${sizeConfig.emoji}`}
        style={{ 
          borderColor: color,
          backgroundColor: `${color}20`,
          color: color
        }}
        title={name}
      >
        {emoji}
      </div>
      {showName && (
        <span 
          className={`${sizeConfig.name} font-semibold truncate`}
          style={{ color: color }}
        >
          {name}
        </span>
      )}
      {showNameBelow && (
        <div className="flex flex-col items-center">
          <div
            className={`${sizeConfig.container} rounded-full border flex items-center justify-center ${sizeConfig.emoji} mb-1`}
            style={{ 
              borderColor: color,
              backgroundColor: `${color}20`,
              color: color
            }}
            title={name}
          >
            {emoji}
          </div>
          <span 
            className={`${sizeConfig.name} font-semibold text-center truncate max-w-[80px]`}
            style={{ color: color }}
          >
            {name}
          </span>
        </div>
      )}
    </div>
  )
}

export default PlayerAvatar

