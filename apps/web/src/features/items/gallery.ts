// Product photo slider math.
//
// The slider is a CSS scroll-snap strip of full-width slides; these turn its
// scroll position into a slide and back, and pick which photos to load.

// A slide index within the strip.
export function clampSlide(index: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(Math.max(index, 0), count - 1)
}

// The slide a scroll position shows.
export function slideFromScroll(scrollLeft: number, width: number, count: number): number {
  if (width <= 0) return 0
  return clampSlide(Math.round(scrollLeft / width), count)
}

// Slides worth loading.
//
// The current one and its neighbours, wrapping, so a swipe either way shows
// a photo at once without fetching the whole gallery.
export function nearSlides(current: number, count: number): Set<number> {
  const out = new Set<number>()
  if (count <= 0) return out
  for (const step of [-1, 0, 1]) out.add((current + step + count) % count)
  return out
}

// Picked files the gallery has room for.
export function filesToAdd(
  files: File[],
  have: number,
  max: number,
): { take: File[]; skipped: number } {
  const room = Math.max(max - have, 0)
  const take = files.slice(0, room)
  return { take, skipped: files.length - take.length }
}
