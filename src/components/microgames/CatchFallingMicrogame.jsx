import { useState, useEffect, useRef } from 'react'
import { getCurrentProfile } from '../../utils/profiles'
import { isCPUProfile, cpuCatchFalling } from '../../utils/cpuPlayer'

function CatchFallingMicrogame({ onComplete, timeLimit }) {
  const [basketX, setBasketX] = useState(50) // Percentage
  const [fallingObject, setFallingObject] = useState({ x: 50, y: 0, caught: false })
  const [caught, setCaught] = useState(0)
  const targetCaught = 3
  const animationRef = useRef(null)
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
    // Start with a new falling object
    setFallingObject({ x: Math.random() * 80 + 10, y: 0, caught: false })
    setCaught(0)
  }, [])

  // CPU auto-play - move basket towards falling object (competitive)
  useEffect(() => {
    if (isCPU && !fallingObject.caught && fallingObject.y < 85) {
      const interval = setInterval(() => {
        setBasketX(prev => {
          const targetX = Math.max(10, Math.min(90, fallingObject.x))
          const diff = targetX - prev
          // Move faster and more directly for competitive play
          const moveAmount = Math.sign(diff) * Math.min(Math.abs(diff), 8)
          return Math.max(10, Math.min(90, prev + moveAmount))
        })
      }, 16) // Update every frame for smooth, fast movement
      return () => clearInterval(interval)
    }
  }, [isCPU, fallingObject])

  useEffect(() => {
    if (fallingObject.caught) {
      return
    }

    const animate = () => {
      setFallingObject(prev => {
        if (prev.caught) return prev
        
        const newY = prev.y + 2
        const basketLeft = basketX - 5
        const basketRight = basketX + 5
        
        // Check if caught
        if (prev.x >= basketLeft && prev.x <= basketRight && newY >= 85 && newY <= 95) {
          setCaught(currentCaught => {
            const newCaught = currentCaught + 1
            if (newCaught >= targetCaught) {
              onComplete(true)
            } else {
              // Spawn new object after a delay
              setTimeout(() => {
                setFallingObject({ x: Math.random() * 80 + 10, y: 0, caught: false })
              }, 200)
            }
            return newCaught
          })
          return { ...prev, caught: true }
        }
        
        // Check if missed (fell past basket)
        if (newY > 100) {
          // Spawn new object after a delay
          setTimeout(() => {
            setFallingObject({ x: Math.random() * 80 + 10, y: 0, caught: false })
          }, 200)
          return { ...prev, caught: true, y: newY }
        }
        
        return { ...prev, y: newY }
      })
      
      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [fallingObject, basketX, onComplete])

  const handleKeyPress = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      setBasketX(prev => Math.max(10, prev - 5))
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      setBasketX(prev => Math.min(90, prev + 5))
    }
  }

  const handleTouchMove = (e) => {
    e.preventDefault()
    const touch = e.touches[0]
    const rect = e.currentTarget.getBoundingClientRect()
    const xPercent = ((touch.clientX - rect.left) / rect.width) * 100
    setBasketX(Math.max(10, Math.min(90, xPercent)))
  }

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [])

  return (
    <div className="w-full h-96 flex flex-col items-center justify-center relative border-2 border-white bg-black">
      <div className="text-white text-xl mb-4 text-center">
        Catch {targetCaught} falling objects!
      </div>
      <div className="text-white text-lg mb-8">
        Caught: {caught} / {targetCaught}
      </div>
      <div className="text-white text-sm mb-4">
        Use ← → or A/D to move
      </div>
      
      {/* Game Area */}
      <div 
        className="relative w-full h-64 border border-white"
        onTouchMove={handleTouchMove}
        onTouchStart={handleTouchMove}
        style={{ touchAction: 'none' }}
      >
        {/* Falling Object */}
        {!fallingObject.caught && (
          <div
            className="absolute w-8 h-8 bg-white rounded-full"
            style={{
              left: `${fallingObject.x}%`,
              top: `${fallingObject.y}%`,
              transform: 'translate(-50%, 0)'
            }}
          />
        )}
        
        {/* Basket */}
        <div
          className="absolute bottom-0 w-20 h-8 border-2 border-white bg-transparent"
          style={{
            left: `${basketX}%`,
            transform: 'translate(-50%, 0)'
          }}
        >
          <div className="absolute bottom-0 left-0 right-0 h-2 bg-white" />
        </div>
      </div>
    </div>
  )
}

export default CatchFallingMicrogame

