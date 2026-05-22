'use client'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface Penitenza {
  label: string
  category: 'soft' | 'party' | 'wild'
  enabled: boolean
}

interface RouletteWheelProps {
  penitenze: Penitenza[]
  selectedIndex: number
  onComplete?: () => void
  onClose?: () => void
  showClose?: boolean
}

const COLORS = {
  soft: '#E8B7C8',
  party: '#F4D9A6',
  wild: '#8F1D2C',
}

export function RouletteWheel({ penitenze, selectedIndex, onComplete, onClose, showClose = false }: RouletteWheelProps) {
  const [rotation, setRotation] = useState(0)
  const [isSpinning, setIsSpinning] = useState(false)
  const [showResult, setShowResult] = useState(false)

  useEffect(() => {
    const startDelay = setTimeout(() => {
      setIsSpinning(true)
      const degreesPerSlice = 360 / penitenze.length
      // Formula corretta: rotazione negativa per portare la penitenza in alto
      const targetAngle = -(selectedIndex + 0.5) * degreesPerSlice
      const spins = 15
      const finalRotation = (360 * spins) + targetAngle
      setRotation(finalRotation)
    }, 200)

    const completeDelay = setTimeout(() => {
      setIsSpinning(false)
      // Mostra il popup risultato
      console.log('🎯 Showing result popup for:', penitenze[selectedIndex]?.label)
      setShowResult(true)

      // Nascondi popup dopo 5 secondi
      setTimeout(() => {
        console.log('❌ Hiding result popup')
        setShowResult(false)
        onComplete?.()
      }, 5000)
    }, 12000)

    return () => {
      clearTimeout(startDelay)
      clearTimeout(completeDelay)
    }
  }, [selectedIndex, penitenze.length, onComplete])

  const degreesPerSlice = 360 / penitenze.length
  const radius = 280
  const center = 300

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm">
      {/* Popup risultato a schermo intero */}
      {showResult && (
        <div className="absolute inset-0 z-[10000] flex items-center justify-center" style={{
          background: 'linear-gradient(135deg, #8F1D2C 0%, #2B2424 50%, #8F1D2C 100%)',
          animation: 'fadeIn 0.5s ease-in'
        }}>
          <div className="text-center px-8 max-w-4xl">
            <div className="mb-8">
              <p className="text-8xl mb-4">🎊</p>
              <p className="text-7xl font-black uppercase tracking-wider drop-shadow-2xl" style={{ color: '#FFD700' }}>
                PENITENZA!
              </p>
            </div>
            <div className="rounded-3xl p-12 shadow-2xl" style={{
              background: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(10px)',
              border: '4px solid #FFD700'
            }}>
              <p className="text-6xl font-wedding text-white leading-tight">
                {penitenze[selectedIndex]?.label}
              </p>
            </div>
            <div className="mt-8">
              <p className="text-8xl">🎉</p>
            </div>
          </div>
        </div>
      )}

      {/* Roulette - nascosta quando mostra risultato */}
      {!showResult && (
        <div className="relative w-full h-full flex items-center justify-center p-4">
          {showClose && onClose && (
            <button onClick={onClose} className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition text-white">
              <X className="h-6 w-6" />
            </button>
          )}

          <div className="relative">
          {/* Indicatore fisso */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
            <div className="w-0 h-0 border-l-[24px] border-r-[24px] border-t-[48px] border-l-transparent border-r-transparent border-t-[#FFD700]"
                 style={{ filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.5))' }} />
          </div>

          {/* Ruota */}
          <svg
            width={center * 2}
            height={center * 2}
            className="drop-shadow-2xl"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: isSpinning ? 'transform 12s cubic-bezier(0.33, 1, 0.68, 1)' : 'none',
            }}
          >
            <circle cx={center} cy={center} r={radius} fill="#1a1a1a" />

            {penitenze.map((penitenza, i) => {
              const startAngle = (i * degreesPerSlice - 90) * (Math.PI / 180)
              const endAngle = ((i + 1) * degreesPerSlice - 90) * (Math.PI / 180)

              const x1 = center + radius * Math.cos(startAngle)
              const y1 = center + radius * Math.sin(startAngle)
              const x2 = center + radius * Math.cos(endAngle)
              const y2 = center + radius * Math.sin(endAngle)

              const largeArcFlag = degreesPerSlice > 180 ? 1 : 0
              const path = `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`

              // Posizione del testo - più verso l'esterno per più spazio
              const sliceAngle = i * degreesPerSlice + degreesPerSlice / 2
              const textAngle = (sliceAngle - 90) * (Math.PI / 180)
              const textRadius = radius * 0.72
              const textX = center + textRadius * Math.cos(textAngle)
              const textY = center + textRadius * Math.sin(textAngle)

              // Split testo - max 8 caratteri per riga, sempre 2 righe
              const label = penitenza.label
              const words = label.split(' ')
              const lines: string[] = []
              let currentLine = ''

              for (const word of words) {
                const testLine = currentLine ? `${currentLine} ${word}` : word
                // Max 8 caratteri per riga
                if (testLine.length > 8 && currentLine) {
                  lines.push(currentLine)
                  currentLine = word
                } else {
                  currentLine = testLine
                }
              }
              if (currentLine) lines.push(currentLine)

              // Forza sempre 2 righe se possibile
              let displayLines = lines.slice(0, 2)
              if (lines.length > 2) {
                displayLines[1] = displayLines[1].substring(0, 6) + '..'
              }
              // Se c'è solo 1 riga lunga, spezzala
              if (displayLines.length === 1 && displayLines[0].length > 10) {
                const mid = Math.floor(displayLines[0].length / 2)
                const space = displayLines[0].lastIndexOf(' ', mid)
                if (space > 0) {
                  displayLines = [
                    displayLines[0].substring(0, space),
                    displayLines[0].substring(space + 1)
                  ]
                }
              }

              return (
                <g key={i}>
                  <path d={path} fill={COLORS[penitenza.category]} stroke="#fff" strokeWidth="4" />

                  {/* Testo VERTICALE - molto più spazio tra righe */}
                  <g transform={`translate(${textX}, ${textY}) rotate(${sliceAngle + 90})`}>
                    {displayLines.map((line, idx) => (
                      <text
                        key={idx}
                        x={(idx - (displayLines.length - 1) / 2) * 48}
                        y={0}
                        fill="#1a1a1a"
                        fontSize="18"
                        fontWeight="900"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{
                          pointerEvents: 'none',
                          textShadow: '0 2px 6px rgba(255,255,255,0.8), 0 0 3px rgba(255,255,255,0.5)',
                          letterSpacing: '0.8px'
                        }}
                      >
                        {line}
                      </text>
                    ))}
                  </g>
                </g>
              )
            })}

            {/* Bordo esterno */}
            <circle cx={center} cy={center} r={radius + 18} fill="none" stroke="#FFD700" strokeWidth="10" />
            <circle cx={center} cy={center} r={radius + 30} fill="none" stroke="#1a1a1a" strokeWidth="6" />

            {/* Centro */}
            <circle cx={center} cy={center} r="55" fill="#FFD700" stroke="#1a1a1a" strokeWidth="5" />
            <text x={center} y={center} fill="#1a1a1a" fontSize="28" fontWeight="900" textAnchor="middle" dominantBaseline="middle">
              {isSpinning ? '🎰' : '🎉'}
            </text>
          </svg>
          </div>
        </div>
      )}
    </div>
  )
}
