import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'

/**
 * QRCode Component - Generates a QR code from a URL
 * @param {string} url - The URL to encode in the QR code
 * @param {number} size - Size of the QR code in pixels (default: 200)
 * @param {string} level - Error correction level: 'L', 'M', 'Q', 'H' (default: 'M')
 * @param {boolean} showUrl - Whether to display the URL below the QR code (default: false)
 * @param {boolean} horizontal - Whether to use horizontal layout (default: false)
 * @param {string} className - Additional CSS classes
 */
function QRCode({ 
  url, 
  size = 200, 
  level = 'M',
  showUrl = false,
  horizontal = false,
  className = ''
}) {
  const [copied, setCopied] = useState(false)

  if (!url) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
        <p className="text-white/60 text-sm">No URL provided</p>
      </div>
    )
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy URL:', error)
    }
  }

  return (
    <div className={`flex ${horizontal ? 'flex-col md:flex-row md:items-center' : 'flex-col items-center'} gap-3 ${className}`}>
      <div 
        className="p-4 border rounded-xl relative overflow-hidden flex-shrink-0"
        style={{
          borderColor: 'rgba(255, 255, 255, 0.3)',
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.1)'
        }}
      >
        {/* Glass overlay */}
        <div 
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 50%)'
          }}
        />
        
        <div className="relative z-10 bg-white p-2 rounded-lg">
          <QRCodeSVG
            value={url}
            size={size - 32}
            level={level}
            includeMargin={false}
          />
        </div>
      </div>
      
      {showUrl && (
        <div className={`flex flex-col ${horizontal ? 'items-center md:items-start' : 'items-center'} gap-2 ${horizontal ? 'md:max-w-xs' : 'w-full max-w-xs'}`}>
          <p 
            className={`text-xs text-white/70 break-all ${horizontal ? 'text-center md:text-left' : 'text-center'} px-2 cursor-pointer hover:text-white transition-colors`}
            onClick={handleCopy}
            title="Click to copy"
          >
            {url}
          </p>
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 text-xs border rounded-lg text-white border-white/30 hover:bg-white hover:text-black transition-all duration-200 cursor-pointer"
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(8px)'
            }}
          >
            {copied ? 'Copied!' : 'Copy URL'}
          </button>
        </div>
      )}
    </div>
  )
}

export default QRCode

