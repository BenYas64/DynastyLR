export const PLAYER_HEADSHOT_FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="#555"/>
    <circle cx="50" cy="38" r="18" fill="#999"/>
    <path d="M18 92 Q18 62 50 62 Q82 62 82 92 Z" fill="#999"/>
  </svg>`
)

export function headshotUrl(playerId) {
  return `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`
}

export function onHeadshotError(e) {
  e.target.onerror = null
  e.target.src = PLAYER_HEADSHOT_FALLBACK
}
