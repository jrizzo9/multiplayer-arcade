import { useState, useEffect } from 'react'
import { getCurrentProfile } from '../../utils/profiles'
import { isCPUProfile, cpuMatchColors, getCPUDelay } from '../../utils/cpuPlayer'

const COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF']

function MatchColorsMicrogame({ onComplete, timeLimit }) {
  const [targetColor, setTargetColor] = useState(null)
  const [colorOptions, setColorOptions] = useState([])
  const [selectedColor, setSelectedColor] = useState(null)
  const [isCPU, setIsCPU] = useState(false)

  useEffect(() => {
    // Check if CPU profile
    const checkCPU = async () => {
      const profile = await getCurrentProfile()
      setIsCPU(isCPUProfile(profile))
    }
    checkCPU()
  }, [])

  useEffect(() => {
    // Pick a random target color
    const target = COLORS[Math.floor(Math.random() * COLORS.length)]
    setTargetColor(target)
    
    // Create options with the target and 2-3 wrong colors
    const wrongColors = COLORS.filter(c => c !== target)
      .sort(() => Math.random() - 0.5)
      .slice(0, 2)
    const options = [target, ...wrongColors].sort(() => Math.random() - 0.5)
    setColorOptions(options)
    setSelectedColor(null)
  }, [])

  // CPU auto-play - instant recognition
  useEffect(() => {
    if (isCPU && targetColor && colorOptions.length > 0 && selectedColor === null) {
      // Very fast recognition and selection
      setTimeout(() => {
        handleColorClick(targetColor)
      }, 50 + Math.random() * 30) // Fast but with slight variation
    }
  }, [isCPU, targetColor, colorOptions, selectedColor])

  const handleColorClick = (color) => {
    setSelectedColor(color)
    
    if (color === targetColor) {
      setTimeout(() => {
        onComplete(true)
      }, 300)
    } else {
      setTimeout(() => {
        onComplete(false)
      }, 300)
    }
  }

  return (
    <div className="w-full h-96 flex flex-col items-center justify-center relative border-2 border-white bg-black">
      <div className="text-white text-xl mb-4 text-center">
        Match the target color!
      </div>
      
      {/* Target Color */}
      <div className="mb-8">
        <div className="text-white text-sm mb-2">Target:</div>
        <div
          className="w-24 h-24 border-2 border-white"
          style={{ backgroundColor: targetColor }}
        />
      </div>
      
      {/* Color Options */}
      <div className="flex gap-2 md:gap-4">
        {colorOptions.map((color, index) => (
          <button
            key={index}
            onClick={() => handleColorClick(color)}
            onTouchStart={(e) => {
              e.preventDefault()
              if (selectedColor === null) {
                handleColorClick(color)
              }
            }}
            disabled={selectedColor !== null}
            className={`w-16 h-16 md:w-20 md:h-20 border-2 transition-all duration-200 cursor-pointer ${
              selectedColor === color
                ? 'border-white scale-110'
                : selectedColor !== null
                ? 'opacity-50 cursor-not-allowed'
                : 'border-white hover:scale-110 active:scale-110'
            }`}
            style={{ backgroundColor: color, touchAction: 'manipulation' }}
          />
        ))}
      </div>
    </div>
  )
}

export default MatchColorsMicrogame

