import { useEffect, useState } from 'react'
import { useAccount } from '../AccountContext.jsx'

const API = 'https://api.dynastylr.site'
const MAX_FUTURE_DRAFT_SEASONS = 10

export default function DraftPickSettings() {
  const { user, selectedLeagueId } = useAccount()
  const [league, setLeague] = useState(null)
  const [isCommish, setIsCommish] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [futureDraftSeasons, setFutureDraftSeasons] = useState('3')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState(null)

  useEffect(() => {
    if (!selectedLeagueId) return
    setLoading(true)
    setError(null)
    fetch(`${API}/league/${selectedLeagueId}`)
      .then(r => r.json())
      .then(data => {
        setLeague(data)
        setFutureDraftSeasons(String(data.future_draft_seasons ?? 3))
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [selectedLeagueId])

  useEffect(() => {
    if (!selectedLeagueId || !user) {
      setIsCommish(false)
      return
    }
    fetch(`${API}/league/${selectedLeagueId}/users`)
      .then(r => r.json())
      .then(users => {
        const me = users.find(u => u.user_id === user.user_id)
        setIsCommish(!!me?.commish)
      })
      .catch(() => setIsCommish(false))
  }, [selectedLeagueId, user])

  if (!selectedLeagueId) return (
    <p style={{ padding: '20px' }}>
      Sign in and select a league on the Account page to view its draft pick settings.
    </p>
  )
  if (loading) return <p style={{ padding: '20px' }}>Loading draft pick settings...</p>
  if (error) return <p style={{ padding: '20px', color: 'red' }}>Error: {error}</p>
  if (!league) return <p style={{ padding: '20px' }}>Loading draft pick settings...</p>

  const canEdit = isCommish && league.is_current_season
  const parsed = parseInt(futureDraftSeasons, 10)
  const isValid = Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_FUTURE_DRAFT_SEASONS

  const handleSave = () => {
    if (!isValid) return
    setSaving(true)
    setSaveMessage(null)
    fetch(`${API}/league/${selectedLeagueId}/future-picks-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.user_id, future_draft_seasons: parsed }),
    })
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || 'Failed to save') })
        return r.json()
      })
      .then(() => {
        setSaveMessage({ type: 'success', text: 'Draft pick settings saved.' })
        setSaving(false)
      })
      .catch(err => {
        setSaveMessage({ type: 'error', text: err.message })
        setSaving(false)
      })
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Draft Pick Settings</h2>
      <p style={{ color: '#666', margin: '0 0 20px' }}>{league.name}</p>
      <p style={{ color: '#666', maxWidth: '500px' }}>
        Controls how many upcoming draft classes show on each team's roster
        page (e.g. 3 shows next season's picks plus the two after that).
        Defaults to 3 for a dynasty league, 0 for redraft.
      </p>

      <div style={{ maxWidth: '300px', marginTop: '20px' }}>
        <label>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Future Draft Classes Shown</div>
          <input
            type="number"
            min="0"
            max={MAX_FUTURE_DRAFT_SEASONS}
            step="1"
            value={futureDraftSeasons}
            onChange={e => setFutureDraftSeasons(e.target.value)}
            disabled={!canEdit}
            style={{ width: '100%', padding: '8px', fontSize: '16px' }}
          />
        </label>
        {!isValid && (
          <p style={{ color: 'red', fontSize: '13px', marginTop: '4px' }}>
            Must be a whole number between 0 and {MAX_FUTURE_DRAFT_SEASONS}.
          </p>
        )}
      </div>

      {isCommish && (
        <div style={{ marginTop: '20px' }}>
          <button
            onClick={handleSave}
            disabled={saving || !canEdit || !isValid}
            style={{
              padding: '10px 24px',
              fontSize: '16px',
              background: '#1a1a2e',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {saveMessage && (
            <p style={{ color: saveMessage.type === 'error' ? 'red' : 'green', marginTop: '8px' }}>
              {saveMessage.text}
            </p>
          )}
        </div>
      )}
      {!canEdit && isCommish && (
        <p style={{ color: '#666', marginTop: '12px' }}>Draft pick settings for past seasons cannot be edited.</p>
      )}
    </div>
  )
}
