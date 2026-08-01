import { createContext, useContext, useState } from 'react'

const AccountContext = createContext(null)

export function AccountProvider({ children }) {
  const [user, setUser] = useState(null)
  const [leagues, setLeagues] = useState([])
  const [selectedLeagueId, setSelectedLeagueId] = useState(null)

  return (
    <AccountContext.Provider value={{
      user, setUser,
      leagues, setLeagues,
      selectedLeagueId, setSelectedLeagueId,
    }}>
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount() {
  return useContext(AccountContext)
}
