export function teamName(user) {
  return user?.team_name || user?.display_name || 'Unknown'
}

export function teamAvatarUrl(user) {
  const avatar = user?.team_avatar || user?.avatar
  if (!avatar) return null
  return avatar.startsWith('http') ? avatar : `https://sleepercdn.com/avatars/thumbs/${avatar}`
}
