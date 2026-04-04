export type SwedishPlaceKind = 'settlement' | 'lake' | 'water' | 'island' | 'mountain'

export type SwedishPlace = {
  name: string
  lat: number
  lon: number
  kind: SwedishPlaceKind
  importance: number
}
