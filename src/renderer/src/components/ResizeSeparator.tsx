import { useRef } from 'react'

type ResizeSeparatorProps = {
  label: string
  orientation: 'vertical' | 'horizontal'
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  reverse?: boolean
  className?: string
}

export default function ResizeSeparator({
  label,
  orientation,
  value,
  min,
  max,
  onChange,
  reverse = false,
  className = ''
}: ResizeSeparatorProps): React.JSX.Element {
  const start = useRef<{
    coordinate: number
    value: number
    scale: number
  } | null>(null)
  const vertical = orientation === 'vertical'
  const clamp = (n: number): number =>
    Math.round(Math.max(min, Math.min(max, n)))
  const direction = reverse ? -1 : 1
  return (
    <div
      className={`layout-resizer ${vertical ? 'vertical' : 'horizontal'} ${className}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        const height = event.currentTarget.parentElement?.clientHeight || 1
        start.current = {
          coordinate: vertical ? event.clientX : event.clientY,
          value,
          scale: vertical ? 1 : 100 / height
        }
      }}
      onPointerMove={(event) => {
        if (!start.current) return
        const coordinate = vertical ? event.clientX : event.clientY
        onChange(
          clamp(
            start.current.value +
              direction *
                (coordinate - start.current.coordinate) *
                start.current.scale
          )
        )
      }}
      onPointerUp={() => {
        start.current = null
      }}
      onPointerCancel={() => {
        start.current = null
      }}
      onLostPointerCapture={() => {
        start.current = null
      }}
      onKeyDown={(event) => {
        const arrow = vertical
          ? event.key === 'ArrowRight'
            ? 1
            : event.key === 'ArrowLeft'
              ? -1
              : 0
          : event.key === 'ArrowDown'
            ? 1
            : event.key === 'ArrowUp'
              ? -1
              : 0
        const step = (vertical ? 10 : 1) * (event.shiftKey ? 4 : 1)
        if (arrow) {
          event.preventDefault()
          onChange(clamp(value + arrow * direction * step))
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault()
          onChange(event.key === 'Home' ? min : max)
        }
      }}
    />
  )
}
