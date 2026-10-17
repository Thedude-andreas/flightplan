/** Capture a deliberate click before map object/route handlers, while preserving pan gestures. */
export function captureBullseyeClick(element: HTMLElement, onClick: (event: MouseEvent) => void) {
  let down: { x: number; y: number } | null = null
  let moved = false
  const pointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; moved = false }
  const pointerMove = (event: PointerEvent) => {
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) moved = true
  }
  const click = (event: MouseEvent) => {
    if ((event.target as Element).closest('.leaflet-control, .mapboxgl-control-container')) return
    event.stopPropagation()
    event.preventDefault()
    if (!moved) onClick(event)
    down = null
  }
  element.addEventListener('pointerdown', pointerDown, true)
  element.addEventListener('pointermove', pointerMove, true)
  element.addEventListener('click', click, true)
  return () => {
    element.removeEventListener('pointerdown', pointerDown, true)
    element.removeEventListener('pointermove', pointerMove, true)
    element.removeEventListener('click', click, true)
  }
}
