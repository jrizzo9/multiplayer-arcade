import { useState, useEffect, useRef } from 'react'
import { getCurrentProfile } from '../../utils/profiles'
import { isCPUProfile, cpuAvoidObstacles } from '../../utils/cpuPlayer'

function AvoidObstaclesMicrogame({ onComplete, timeLimit }) {
  const [playerX, setPlayerX] = useState(50) // Percentage
  const [obstacles, setObstacles] = useState([])
  const [survived, setSurvived] = useState(0)
  const targetSurvived = 5
  const animationRef = useRef(null)
  const obstacleIdRef = useRef(0)
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
    // Spawn obstacles periodically
    const spawnInterval = setInterval(() => {
      setObstacles(prev => [
        ...prev,
        {
          id: obstacleIdRef.current++,
          x: Math.random() * 80 + 10,
          y: 0
        }
      ])
    }, 800)

    return () => clearInterval(spawnInterval)
  }, [])

  // CPU auto-play - move player to avoid obstacles (competitive)
  useEffect(() => {
    if (isCPU && obstacles.length > 0) {
      const interval = setInterval(() => {
        setPlayerX(prev => {
          // Find closest obstacle that's approaching
          const closestObstacle = obstacles
            .filter(obs => obs.y >= 0 && obs.y <= 85)
            .sort((a, b) => a.y - b.y)[0]
          
          if (closestObstacle) {
            const obstacleX = closestObstacle.x
            const safeDistance = 12 // Larger safety margin
            
            // If obstacle is close or approaching, move away proactively
            if (Math.abs(obstacleX - prev) < safeDistance) {
              const newX = obstacleX > prev 
                ? Math.max(10, prev - 15) // Move left more aggressively
                : Math.min(90, prev + 15) // Move right more aggressively
              const diff = newX - prev
              // Move faster for competitive play
              const moveAmount = Math.sign(diff) * Math.min(Math.abs(diff), 8)
              return Math.max(10, Math.min(90, prev + moveAmount))
            }
          }
          return prev
        })
      }, 16) // Update every frame for smooth, fast movement
      return () => clearInterval(interval)
    }
  }, [isCPU, obstacles])

  useEffect(() => {
    let collisionDetected = false
    
    const animate = () => {
      if (collisionDetected) return
      
      setObstacles(prev => {
        const newObstacles = prev
          .map(obs => ({
            ...obs,
            y: obs.y + 3
          }))
          .filter(obs => {
            // Check collision with player (player is at bottom, ~85-100% from top)
            if (obs.y >= 85 && obs.y <= 100) {
              const playerLeft = playerX - 3
              const playerRight = playerX + 3
              const obsLeft = obs.x - 2
              const obsRight = obs.x + 2
              
              // Check if obstacle overlaps with player
              if (!(obsRight < playerLeft || obsLeft > playerRight)) {
                // Collision!
                collisionDetected = true
                onComplete(false)
                return false
              }
            }
            
            // Check if passed safely (fell past player)
            if (obs.y > 100) {
              setSurvived(currentSurvived => {
                const newSurvived = currentSurvived + 1
                if (newSurvived >= targetSurvived) {
                  onComplete(true)
                }
                return newSurvived
              })
              return false
            }
            
            return true
          })
        
        return newObstacles
      })
      
      if (!collisionDetected) {
        animationRef.current = requestAnimationFrame(animate)
      }
    }

    animationRef.current = requestAnimationFrame(animate)
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [playerX, onComplete])

  const handleKeyPress = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      setPlayerX(prev => Math.max(10, prev - 5))
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      setPlayerX(prev => Math.min(90, prev + 5))
    }
  }

  const handleTouchMove = (e) => {
    e.preventDefault()
    const touch = e.touches[0]
    const rect = e.currentTarget.getBoundingClientRect()
    const xPercent = ((touch.clientX - rect.left) / rect.width) * 100
    setPlayerX(Math.max(10, Math.min(90, xPercent)))
  }

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [])

  return (
    <div className="w-full h-96 flex flex-col items-center justify-center relative border-2 border-white bg-black">
      <div className="text-white text-xl mb-4 text-center">
        Avoid {targetSurvived} obstacles!
      </div>
      <div className="text-white text-lg mb-8">
        Survived: {survived} / {targetSurvived}
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
        {/* Player */}
        <div
          className="absolute bottom-4 w-6 h-6 bg-white"
          style={{
            left: `${playerX}%`,
            transform: 'translate(-50%, 0)'
          }}
        />
        
        {/* Obstacles */}
        {obstacles.map(obs => (
          <div
            key={obs.id}
            className="absolute w-4 h-4 bg-white"
            style={{
              left: `${obs.x}%`,
              top: `${obs.y}%`,
              transform: 'translate(-50%, 0)'
            }}
          />
        ))}
      </div>
    </div>
  )
}

export default AvoidObstaclesMicrogame

