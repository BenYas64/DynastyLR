import { createContext, useContext, useState, useEffect } from 'react'

const AccountContext = createContext(null)
const STORAGE_KEY = 'dynastylr:account'

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { user: null, leagues: [], selectedLeagueId: null }
    const parsed = JSON.parse(raw)
    return {
      user: parsed.user ?? null,
      leagues: parsed.leagues ?? [],
      selectedLeagueId: parsed.selectedLeagueId ?? null,
    }
  } catch {
    return { user: null, leagues: [], selectedLeagueId: null }
  }
}

export function AccountProvider({ children }) {
  const stored = loadStored()
  const [user, setUser] = useState(stored.user)
  const [leagues, setLeagues] = useState(stored.leagues)
  const [selectedLeagueId, setSelectedLeagueId] = useState(stored.selectedLeagueId)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, leagues, selectedLeagueId }))
  }, [user, leagues, selectedLeagueId])

  const signOut = () => {
    setUser(null)
    setLeagues([])
    setSelectedLeagueId(null)
    localStorage.removeItem(STORAGE_KEY)
  }

  return (
    <AccountContext.Provider value={{
      user, setUser,
      leagues, setLeagues,
      selectedLeagueId, setSelectedLeagueId,
      signOut,
    }}>
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount() {
  return useContext(AccountContext)
}
