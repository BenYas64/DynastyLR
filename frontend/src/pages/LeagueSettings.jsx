import { useEffect, useState } from 'react'
import { useAccount } from '../AccountContext.jsx'

const API = 'https://api.dynastylr.site'

function humanizeKey(key) {
  return key
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export default function LeagueSettings() {
  const { user, selectedLeagueId } = useAccount()
  const [league, setLeague] = useState(null)
  const [isCommish, setIsCommish] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [editedValues, setEditedValues] = useState({})
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

  useEffect(() => {
    if (!league?.scoring_settings) return
    try {
      const parsed = JSON.parse(league.scoring_settings)
      const asStrings = {}
      Object.entries(parsed).forEach(([key, value]) => { asStrings[key] = String(value) })
      setEditedValues(asStrings)
    } catch {
      setEditedValues({})
    }
    setSaveMessage(null)
  }, [league])

  if (!selectedLeagueId) return (
    <p style={{ padding: '20px' }}>
      Sign in and select a league on the Account page to view its scoring settings.
    </p>
  )
  if (loading) return <p style={{ padding: '20px' }}>Loading league settings...</p>
  if (error) return <p style={{ padding: '20px', color: 'red' }}>Error: {error}</p>

  let scoringSettings = null
  try {
    scoringSettings = league.scoring_settings ? JSON.parse(league.scoring_settings) : null
  } catch {
    scoringSettings = null
  }

  if (!scoringSettings) return <p style={{ padding: '20px' }}>No scoring settings found for this league.</p>

  const entries = Object.keys(scoringSettings)
    .filter(key => {
      const q = search.toLowerCase()
      return key.toLowerCase().includes(q) || humanizeKey(key).toLowerCase().includes(q)
    })
    .sort((a, b) => a.localeCompare(b))

  const handleSave = () => {
    setSaving(true)
    setSaveMessage(null)
    const parsed = {}
    Object.entries(editedValues).forEach(([key, value]) => {
      const num = parseFloat(value)
      parsed[key] = Number.isFinite(num) ? num : 0
    })

    fetch(`${API}/league/${selectedLeagueId}/scoring-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.user_id, scoring_settings: parsed }),
    })
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || 'Failed to save') })
        return r.json()
      })
      .then(() => {
        setLeague(prev => ({ ...prev, scoring_settings: JSON.stringify(parsed) }))
        setSaveMessage({ type: 'success', text: 'Scoring settings saved.' })
        setSaving(false)
      })
      .catch(err => {
        setSaveMessage({ type: 'error', text: err.message })
        setSaving(false)
      })
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      {isCommish && (
        <p style={{ fontWeight: 'bold', color: '#1a1a2e', marginBottom: '4px' }}>Commissioner View</p>
      )}
      <h2>Scoring Settings</h2>
      <p style={{ color: '#666' }}>{league.name}</p>

      <input
        type="text"
        placeholder="Search settings..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ padding: '8px', width: '300px', fontSize: '16px', marginBottom: '20px' }}
      />

      <table style={{ width: '100%', borderCollapse: 'collapse', maxWidth: '600px' }}>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            <th style={{ padding: '8px', textAlign: 'left' }}>Setting</th>
            <th style={{ padding: '8px', textAlign: 'right' }}>Points</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(key => (
            <tr key={key} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '8px' }} title={key}>{humanizeKey(key)}</td>
              <td style={{ padding: '8px', textAlign: 'right' }}>
                {isCommish ? (
                  <input
                    type="number"
                    step="any"
                    value={editedValues[key] ?? ''}
                    onChange={e => setEditedValues(prev => ({ ...prev, [key]: e.target.value }))}
                    style={{ width: '90px', padding: '4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                  />
                ) : (
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{scoringSettings[key]}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && <p style={{ color: '#666' }}>No settings match your search.</p>}

      {isCommish && (
        <div style={{ marginTop: '20px' }}>
          <button
            onClick={handleSave}
            disabled={saving}
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
    </div>
  )
}
