import { createContext, useContext, useState } from 'react'

const PlayerModalContext = createContext(null)

export function PlayerModalProvider({ children }) {
  const [playerId, setPlayerId] = useState(null)

  return (
    <PlayerModalContext.Provider value={{
      playerId,
      openPlayer: setPlayerId,
      closePlayer: () => setPlayerId(null),
    }}>
      {children}
    </PlayerModalContext.Provider>
  )
}

export function usePlayerModal() {
  return useContext(PlayerModalContext)
}
