import { useEffect, useState } from 'react'
import { useAccount } from '../AccountContext.jsx'

const API = 'https://api.dynastylr.site'
const CURRENT_SEASON = 2026

const PPR_OPTIONS = [
  [0, 'Standard (0 PPR)'],
  [0.5, 'Half-PPR (0.5 PPR)'],
  [1, 'Full PPR (1 PPR)'],
]
const TEP_OPTIONS = [
  [0, 'No TEP'],
  [0.5, 'TEP+'],
  [1, 'TEP++'],
]
const LEAGUE_TYPE_OPTIONS = [
  ['redraft', 'Redraft'],
  ['dynasty', 'Dynasty'],
]

export default function ValueSettings() {
  const { user, selectedLeagueId } = useAccount()
  const [league, setLeague] = useState(null)
  const [isCommish, setIsCommish] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [valuePpr, setValuePpr] = useState(0.5)
  const [valueTep, setValueTep] = useState(0)
  const [leagueType, setLeagueType] = useState('redraft')
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
        setValuePpr(data.value_ppr ?? 0.5)
        setValueTep(data.value_tep ?? 0)
        setLeagueType(data.league_type ?? 'redraft')
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
      Sign in and select a league on the Account page to view its value settings.
    </p>
  )
  if (loading) return <p style={{ padding: '20px' }}>Loading value settings...</p>
  if (error) return <p style={{ padding: '20px', color: 'red' }}>Error: {error}</p>
  // league is still null on the very first render, before the fetch above
  // has had a chance to even start (loading defaults to false, not true) -
  // without this, league.season below throws and crashes the whole app,
  // since nothing here has an error boundary.
  if (!league) return <p style={{ padding: '20px' }}>Loading value settings...</p>

  const canEdit = isCommish && league.season === CURRENT_SEASON

  const handleSave = () => {
    setSaving(true)
    setSaveMessage(null)
    fetch(`${API}/league/${selectedLeagueId}/value-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.user_id, value_ppr: valuePpr, value_tep: valueTep, league_type: leagueType }),
    })
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || 'Failed to save') })
        return r.json()
      })
      .then(() => {
        setSaveMessage({ type: 'success', text: 'Value settings saved.' })
        setSaving(false)
      })
      .catch(err => {
        setSaveMessage({ type: 'error', text: err.message })
        setSaving(false)
      })
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Value Settings</h2>
      <p style={{ color: '#666', margin: '0 0 20px' }}>{league.name}</p>
      <p style={{ color: '#666', maxWidth: '500px' }}>
        Controls which trade value (from FantasyCalc) players are shown with
        throughout the app - pick whichever PPR and tight-end-premium level actually
        matches this league's scoring, independent of the real scoring settings used
        for games. Redraft value always shows; dynasty value shows too if this league
        is a dynasty league.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '300px', marginTop: '20px' }}>
        <label>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>League Type</div>
          <select
            value={leagueType}
            onChange={e => setLeagueType(e.target.value)}
            disabled={!canEdit}
            style={{ width: '100%', padding: '8px', fontSize: '16px' }}
          >
            {LEAGUE_TYPE_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>

        <label>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>PPR</div>
          <select
            value={valuePpr}
            onChange={e => setValuePpr(Number(e.target.value))}
            disabled={!canEdit}
            style={{ width: '100%', padding: '8px', fontSize: '16px' }}
          >
            {PPR_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>

        <label>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Tight End Premium</div>
          <select
            value={valueTep}
            onChange={e => setValueTep(Number(e.target.value))}
            disabled={!canEdit}
            style={{ width: '100%', padding: '8px', fontSize: '16px' }}
          >
            {TEP_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
      </div>

      {isCommish && (
        <div style={{ marginTop: '20px' }}>
          <button
            onClick={handleSave}
            disabled={saving || !canEdit}
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
        <p style={{ color: '#666', marginTop: '12px' }}>Value settings for past seasons cannot be edited.</p>
      )}
    </div>
  )
}
