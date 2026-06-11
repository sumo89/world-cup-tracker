import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { supabase } from './supabase'

type PredictionChoice = 'home' | 'draw' | 'away'
type MatchFilter = 'all' | 'upcoming' | 'completed'

type FixtureRecord = {
  fixtureId: number
  date: string
  round: string
  statusShort: string
  statusLong: string
  venueName: string | null
  venueCity: string | null
  homeTeam: {
    id: number
    name: string
    logo: string | null
  }
  awayTeam: {
    id: number
    name: string
    logo: string | null
  }
  goals: {
    home: number | null
    away: number | null
  }
}

type PredictionsByFixture = Record<string, Record<string, PredictionChoice>>



const USERS_STORAGE_KEY = 'wc26.users'
const PREDICTIONS_STORAGE_KEY = 'wc26.predictions'

function toDateLabel(utcDate: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(utcDate))
}

function isCompleted(statusShort: string) {
  return ['FT', 'AET', 'PEN'].includes(statusShort)
}

function matchOutcome(match: FixtureRecord): PredictionChoice | null {
  const home = match.goals.home
  const away = match.goals.away
  if (!isCompleted(match.statusShort) || home == null || away == null) {
    return null
  }
  if (home > away) {
    return 'home'
  }
  if (away > home) {
    return 'away'
  }
  return 'draw'
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback
  }
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function App() {
  const [matches, setMatches] = useState<FixtureRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncingToDb, setSyncingToDb] = useState(false)
  const [userIdByName, setUserIdByName] = useState<Record<string, string>>({})
  const [users, setUsers] = useState<string[]>(() =>
    safeJsonParse<string[]>(localStorage.getItem(USERS_STORAGE_KEY), []),
  )
  const [predictions, setPredictions] = useState<PredictionsByFixture>(() =>
    safeJsonParse<PredictionsByFixture>(
      localStorage.getItem(PREDICTIONS_STORAGE_KEY),
      {},
    ),
  )
  const [newUser, setNewUser] = useState('')
  const [selectedRound, setSelectedRound] = useState('all')
  const [filter, setFilter] = useState<MatchFilter>('all')

  useEffect(() => {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users))
    if (!supabase || users.length === 0) return

    setSyncingToDb(true)
    const syncUsers = async () => {
      try {
        const { data: existing } = await supabase!
          .from('users')
          .select('id, name')
        const existingNames = new Set((existing || []).map((u: any) => u.name))
        const toInsert = users.filter((name) => !existingNames.has(name))

        if (toInsert.length > 0) {
          await supabase!.from('users').insert(toInsert.map((name) => ({ name })))
        }

        const { data: refreshedUsers } = await supabase!
          .from('users')
          .select('id, name')
        if (refreshedUsers) {
          const ids: Record<string, string> = {}
          for (const user of refreshedUsers) {
            ids[user.name] = user.id
          }
          setUserIdByName(ids)
        }
      } catch (err) {
        console.error('Failed to sync users to Supabase:', err)
      } finally {
        setSyncingToDb(false)
      }
    }
    void syncUsers()
  }, [users])

  useEffect(() => {
    localStorage.setItem(PREDICTIONS_STORAGE_KEY, JSON.stringify(predictions))
  }, [predictions])

  useEffect(() => {
    const loadFromSupabase = async () => {
      if (!supabase) return

      try {
        const [{ data: dbUsers }, { data: dbPredictions }] = await Promise.all([
          supabase.from('users').select('*'),
          supabase.from('predictions').select('*, users(name)'),
        ])

        if (dbUsers && dbUsers.length > 0) {
          setUsers(dbUsers.map((u: any) => u.name))
          const ids: Record<string, string> = {}
          for (const user of dbUsers) {
            ids[user.name] = user.id
          }
          setUserIdByName(ids)
        }

        if (dbPredictions && dbPredictions.length > 0) {
          const preds: PredictionsByFixture = {}
          for (const pred of dbPredictions) {
            const fId = String(pred.fixture_id)
            const userName = (pred.users as any)?.name || pred.user_id
            if (!preds[fId]) preds[fId] = {}
            preds[fId][userName] = pred.choice
          }
          setPredictions(preds)
        }
      } catch (err) {
        console.warn('Could not load data from Supabase:', err)
      }
    }

    void loadFromSupabase()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('./data/fixtures.json', {
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(`Failed to load fixtures: ${response.status}`)
        }
        const data = (await response.json()) as FixtureRecord[]
        setMatches(data.sort((a, b) => +new Date(a.date) - +new Date(b.date)))
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : 'Could not load fixture data from local JSON.',
          )
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => controller.abort()
  }, [])

  const rounds = useMemo(() => {
    const set = new Set(matches.map((m) => m.round).filter(Boolean))
    return Array.from(set)
  }, [matches])

  const visibleMatches = useMemo(() => {
    return matches.filter((m) => {
      if (selectedRound !== 'all' && m.round !== selectedRound) {
        return false
      }
      if (filter === 'completed') {
        return isCompleted(m.statusShort)
      }
      if (filter === 'upcoming') {
        return !isCompleted(m.statusShort)
      }
      return true
    })
  }, [matches, selectedRound, filter])

  const leaderboard = useMemo(() => {
    return users
      .map((user) => {
        let correct = 0
        let attempts = 0
        for (const match of matches) {
          const outcome = matchOutcome(match)
          if (!outcome) {
            continue
          }
          const pick = predictions[String(match.fixtureId)]?.[user]
          if (!pick) {
            continue
          }
          attempts += 1
          if (pick === outcome) {
            correct += 1
          }
        }
        return {
          user,
          correct,
          attempts,
          accuracy: attempts === 0 ? 0 : Math.round((correct / attempts) * 100),
        }
      })
      .sort((a, b) => b.correct - a.correct || b.accuracy - a.accuracy)
  }, [users, predictions, matches])

  const completedCount = useMemo(
    () => matches.filter((m) => isCompleted(m.statusShort)).length,
    [matches],
  )

  const addUser = async () => {
    const candidate = newUser.trim()
    if (!candidate || users.includes(candidate)) {
      return
    }
    if (supabase) {
      setSyncingToDb(true)
      try {
        const { data } = await supabase
          .from('users')
          .insert({ name: candidate })
          .select('id, name')
          .single()
        if (data) {
          setUserIdByName((prev) => ({ ...prev, [data.name]: data.id }))
        }
      } catch (err) {
        console.error('Failed to add user to Supabase:', err)
      } finally {
        setSyncingToDb(false)
      }
    }
    setUsers((prev) => [...prev, candidate])
    setNewUser('')
  }

  const removeUser = async (user: string) => {
    if (supabase) {
      setSyncingToDb(true)
      try {
        const userId = userIdByName[user]
        if (userId) {
          await supabase.from('predictions').delete().eq('user_id', userId)
          await supabase.from('users').delete().eq('id', userId)
        }
      } catch (err) {
        console.error('Failed to remove user from Supabase:', err)
      } finally {
        setSyncingToDb(false)
      }
    }
    setUserIdByName((prev) => {
      const next = { ...prev }
      delete next[user]
      return next
    })
    setUsers((prev) => prev.filter((u) => u !== user))
    setPredictions((prev) => {
      const next: PredictionsByFixture = {}
      for (const [fixtureId, picks] of Object.entries(prev)) {
        const { [user]: _, ...rest } = picks
        next[fixtureId] = rest
      }
      return next
    })
  }

  const setPrediction = (
    fixtureId: number,
    user: string,
    choice: PredictionChoice,
  ) => {
    if (supabase) {
      const db = supabase
      const userId = userIdByName[user]
      if (userId) {
        setSyncingToDb(true)
        const syncPrediction = async () => {
          try {
            await db.from('predictions').upsert(
              {
                user_id: userId,
                fixture_id: fixtureId,
                choice,
              },
              { onConflict: 'user_id,fixture_id' },
            )
          } catch (err) {
            console.error('Failed to sync prediction to Supabase:', err)
          } finally {
            setSyncingToDb(false)
          }
        }
        void syncPrediction()
      }
    }

    setPredictions((prev) => ({
      ...prev,
      [fixtureId]: {
        ...(prev[String(fixtureId)] ?? {}),
        [user]: choice,
      },
    }))
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="hero-kicker">2026 World Cup Prediction Board</p>
        <h1>Track Every Match. Beat Every Friend.</h1>
        <p>
          Live schedule and results from worldcup26.ir, predictions backed by cloud
          database, and an automatic leaderboard.
        </p>
        {syncingToDb && <p className="syncing-indicator">Syncing to database...</p>}
      </header>

      <section className="stats-grid">
        <article>
          <h2>{matches.length}</h2>
          <p>Total Matches</p>
        </article>
        <article>
          <h2>{completedCount}</h2>
          <p>Completed</p>
        </article>
        <article>
          <h2>{matches.length - completedCount}</h2>
          <p>Upcoming / Live</p>
        </article>
        <article>
          <h2>{users.length}</h2>
          <p>Players</p>
        </article>
      </section>

      <section className="panel users-panel">
        <h2>Players</h2>
        <div className="row">
          <input
            value={newUser}
            onChange={(e) => setNewUser(e.target.value)}
            placeholder="Add friend name"
          />
          <button onClick={addUser}>Add</button>
        </div>
        <div className="chips">
          {users.length === 0 ? <p>No players yet.</p> : null}
          {users.map((user) => (
            <div className="chip" key={user}>
              <span>{user}</span>
              <button onClick={() => removeUser(user)} aria-label={`Remove ${user}`}>
                x
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel leaderboard-panel">
        <h2>Leaderboard</h2>
        <div className="leaderboard">
          {leaderboard.length === 0 ? <p>Add players to start scoring.</p> : null}
          {leaderboard.map((entry, idx) => (
            <div className="leaderboard-row" key={entry.user}>
              <strong>
                #{idx + 1} {entry.user}
              </strong>
              <span>
                {entry.correct} correct / {entry.attempts} picks ({entry.accuracy}%)
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel controls-panel">
        <h2>Match Filters</h2>
        <div className="row wrap">
          <div className="segmented">
            <button
              className={filter === 'all' ? 'active' : ''}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            <button
              className={filter === 'upcoming' ? 'active' : ''}
              onClick={() => setFilter('upcoming')}
            >
              Upcoming / Live
            </button>
            <button
              className={filter === 'completed' ? 'active' : ''}
              onClick={() => setFilter('completed')}
            >
              Completed
            </button>
          </div>
          <select
            value={selectedRound}
            onChange={(e) => setSelectedRound(e.target.value)}
          >
            <option value="all">All rounds</option>
            {rounds.map((round) => (
              <option key={round} value={round}>
                {round}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel matches-panel">
        <h2>Matches</h2>
        {loading ? <p>Loading fixtures...</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {!loading && !error && visibleMatches.length === 0 ? (
          <p>No matches found for this filter.</p>
        ) : null}

        <div className="match-list">
          {visibleMatches.map((match) => {
            const outcome = matchOutcome(match)
            const score =
              match.goals.home == null || match.goals.away == null
                ? 'vs'
                : `${match.goals.home} - ${match.goals.away}`

            return (
              <article className="match-card" key={match.fixtureId}>
                <div className="match-top">
                  <p className="round">{match.round}</p>
                  <p className="date">{toDateLabel(match.date)}</p>
                </div>
                <div className="teams">
                  <span>{match.homeTeam.name}</span>
                  <strong>{score}</strong>
                  <span>{match.awayTeam.name}</span>
                </div>
                <p className="status">
                  {match.statusLong}
                  {match.venueName ? ` • ${match.venueName}` : ''}
                </p>
                {outcome ? (
                  <p className="result-pill">Result: {outcome.toUpperCase()}</p>
                ) : null}

                {users.length > 0 ? (
                  <div className="prediction-grid">
                    {users.map((user) => {
                      const currentPick =
                        predictions[String(match.fixtureId)]?.[user] ?? null
                      const isCorrect =
                        outcome && currentPick ? outcome === currentPick : false
                      return (
                        <div className="prediction-row" key={`${match.fixtureId}-${user}`}>
                          <span>{user}</span>
                          <div className="pick-buttons">
                            {(['home', 'draw', 'away'] as PredictionChoice[]).map(
                              (choice) => {
                                const label =
                                  choice === 'home'
                                    ? match.homeTeam.name
                                    : choice === 'away'
                                      ? match.awayTeam.name
                                      : 'Draw'
                                return (
                                  <button
                                    key={choice}
                                    className={
                                      currentPick === choice
                                        ? `pick active ${
                                            outcome && currentPick === outcome
                                              ? 'correct'
                                              : ''
                                          }`
                                        : 'pick'
                                    }
                                    onClick={() =>
                                      setPrediction(match.fixtureId, user, choice)
                                    }
                                    title={label}
                                  >
                                    {label.length > 12
                                      ? label.substring(0, 12) + '…'
                                      : label}
                                  </button>
                                )
                              },
                            )}
                          </div>
                          <span className={isCorrect ? 'pick-state ok' : 'pick-state'}>
                            {outcome ? (isCorrect ? 'Correct' : 'Wrong') : 'Pending'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="hint">Add at least one player to record predictions.</p>
                )}
              </article>
            )
          })}
        </div>
      </section>
    </main>
  )
}

export default App
