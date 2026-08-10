export function teamName(roster, user) {
  return roster?.team_name || user?.display_name || 'Unknown'
}

export function teamAvatarUrl(roster, user) {
  const avatar = roster?.team_avatar || user?.avatar
  if (!avatar) return null
  return avatar.startsWith('http') ? avatar : `https://sleepercdn.com/avatars/thumbs/${avatar}`
}
