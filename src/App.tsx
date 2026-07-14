import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { supabase } from './supabase'

type PredictionChoice = 'home' | 'draw' | 'away'
type MatchFilter = 'all' | 'upcoming' | 'completed'

type FixtureRecord = {
  fixtureId: number
  date: string
  round: string
  group: string | null
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
    homePenalty?: number | null
    awayPenalty?: number | null
  }
}

type PredictionsByFixture = Record<string, Record<string, PredictionChoice>>

type StageTab = 'group-stage' | 'round-of-32-16' | 'knockouts'

function getStageTab(group: string | null): StageTab {
  if (!group) return 'group-stage'
  const g = group.toUpperCase()
  if (/^[A-L]$/.test(g)) return 'group-stage'
  if (g === 'R32' || g === 'R16') return 'round-of-32-16'
  if (['QF', 'SF', '3RD', 'FINAL'].includes(g)) return 'knockouts'
  return 'group-stage'
}



const USERS_STORAGE_KEY = 'wc26.users'
const PREDICTIONS_STORAGE_KEY = 'wc26.predictions'
const FIXTURES_SYNC_STORAGE_KEY = 'wc26.fixtures.synced'

type WorldCupApiGame = {
  id: string | number
  local_date?: string
  type?: string
  group?: string
  matchday?: string | number
  stadium_id?: string | number
  home_team_name_en?: string
  home_team_label?: string
  away_team_name_en?: string
  away_team_label?: string
  home_team_id?: string | number
  away_team_id?: string | number
  home_score?: string | number
  away_score?: string | number
  home_penalty_score?: string | number
  away_penalty_score?: string | number
  finished?: string
  time_elapsed?: string
}

type WorldCupApiStadium = {
  id: string | number
  name_en?: string
  fifa_name?: string
  city_en?: string
}

type WorldCupGamesResponse = {
  games?: WorldCupApiGame[]
}

type WorldCupStadiumsResponse = {
  stadiums?: WorldCupApiStadium[]
}

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

  const homePenalty = match.goals.homePenalty
  const awayPenalty = match.goals.awayPenalty

  if (homePenalty == null || awayPenalty == null) {
    return 'draw'
  }

  if (homePenalty > awayPenalty) {
    return 'home'
  }
  if (awayPenalty > homePenalty) {
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

function parseLocalDate(value: string | undefined) {
  if (!value || typeof value !== 'string') {
    return null
  }
  const [datePart, timePart] = value.split(' ')
  if (!datePart || !timePart) {
    return null
  }
  const [month, day, year] = datePart.split('/').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  if ([month, day, year, hour, minute].some((entry) => Number.isNaN(entry))) {
    return null
  }

  return new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString()
}

function toNumberOrNull(value: string | number | undefined) {
  if (value == null) {
    return null
  }
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function toStatus(game: WorldCupApiGame) {
  const finished = String(game.finished || '').toUpperCase() === 'TRUE'
  if (finished) {
    return {
      short: 'FT',
      long: 'Match Finished',
    }
  }

  const elapsed = String(game.time_elapsed || '').toLowerCase()
  if (
    elapsed &&
    elapsed !== 'notstarted' &&
    elapsed !== 'scheduled' &&
    elapsed !== '0'
  ) {
    return {
      short: 'LIVE',
      long: `Live (${game.time_elapsed})`,
    }
  }

  return {
    short: 'NS',
    long: 'Not Started',
  }
}

function toRound(game: WorldCupApiGame) {
  if (game.type === 'group') {
    return `Group ${game.group} - ${game.matchday}`
  }

  const map: Record<string, string> = {
    r32: 'Round of 32',
    r16: 'Round of 16',
    qf: 'Quarter-finals',
    sf: 'Semi-finals',
    third: 'Third Place Play-off',
    final: 'Final',
  }

  return map[game.type || ''] || game.group || game.type || 'Knockout Stage'
}

function mapApiFixture(game: WorldCupApiGame, stadiumById: Map<string, WorldCupApiStadium>) {
  const status = toStatus(game)
  const stadium = stadiumById.get(String(game.stadium_id))
  const homeName = game.home_team_name_en || game.home_team_label || 'TBD'
  const awayName = game.away_team_name_en || game.away_team_label || 'TBD'

  return {
    fixture_id: Number(game.id),
    date: parseLocalDate(game.local_date) ?? new Date().toISOString(),
    round: toRound(game),
    group: game.group || null,
    status_short: status.short,
    status_long: status.long,
    venue_name: stadium?.name_en ?? stadium?.fifa_name ?? null,
    venue_city: stadium?.city_en ?? null,
    home_team_id: toNumberOrNull(game.home_team_id) ?? 0,
    home_team_name: homeName,
    away_team_id: toNumberOrNull(game.away_team_id) ?? 0,
    away_team_name: awayName,
    home_score: toNumberOrNull(game.home_score),
    away_score: toNumberOrNull(game.away_score),
    home_penalty_score: toNumberOrNull(game.home_penalty_score),
    away_penalty_score: toNumberOrNull(game.away_penalty_score),
    updated_at: new Date().toISOString(),
  }
}

function toFixtureRecord(fixture: ReturnType<typeof mapApiFixture>): FixtureRecord {
  return {
    fixtureId: fixture.fixture_id,
    date: fixture.date,
    round: fixture.round,
    group: fixture.group || null,
    statusShort: fixture.status_short,
    statusLong: fixture.status_long,
    venueName: fixture.venue_name,
    venueCity: fixture.venue_city,
    homeTeam: {
      id: fixture.home_team_id,
      name: fixture.home_team_name,
      logo: null,
    },
    awayTeam: {
      id: fixture.away_team_id,
      name: fixture.away_team_name,
      logo: null,
    },
    goals: {
      home: fixture.home_score,
      away: fixture.away_score,
      homePenalty: fixture.home_penalty_score,
      awayPenalty: fixture.away_penalty_score,
    },
  }
}


async function fetchLiveFixtures(signal?: AbortSignal) {
  const [gamesResponse, stadiumsResponse] = await Promise.all([
    fetch('https://worldcup26.ir/get/games', signal ? { signal } : undefined),
    fetch('https://worldcup26.ir/get/stadiums', signal ? { signal } : undefined),
  ])

  if (!gamesResponse.ok || !stadiumsResponse.ok) {
    throw new Error(
      `Failed to load live fixtures: ${gamesResponse.status}/${stadiumsResponse.status}`,
    )
  }

  const gamesData = (await gamesResponse.json()) as WorldCupGamesResponse
  const stadiumsData = (await stadiumsResponse.json()) as WorldCupStadiumsResponse

  const stadiumById = new Map(
    (stadiumsData.stadiums || []).map((stadium) => [String(stadium.id), stadium]),
  )
  const liveFixtures = (gamesData.games || []).map((game) =>
    mapApiFixture(game, stadiumById),
  )

  return liveFixtures.sort((a, b) => +new Date(a.date) - +new Date(b.date))
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
  const [filter, setFilter] = useState<MatchFilter>('upcoming')
  const [activeTab, setActiveTab] = useState<StageTab>('knockouts')
  const [userToRemove, setUserToRemove] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return

    const loadUsers = async () => {
      try {
        const { data: dbUsers } = await supabase!.from('users').select('id, name')
        if (dbUsers && dbUsers.length > 0) {
          const names = dbUsers.map((u: any) => u.name)
          const ids: Record<string, string> = {}
          for (const user of dbUsers) {
            ids[user.name] = user.id
          }
          setUsers(names)
          setUserIdByName(ids)
        }
      } catch (err) {
        console.error('Failed to load users from Supabase:', err)
      }
    }
    void loadUsers()
  }, [])

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
    if (!supabase || Object.keys(userIdByName).length === 0) return

    const loadPredictions = async () => {
      try {
        const { data: dbPredictions } = await supabase!
          .from('predictions')
          .select('fixture_id, user_id, choice')
        if (dbPredictions && dbPredictions.length > 0) {
          const predictionsFromDb: PredictionsByFixture = {}
          for (const pred of dbPredictions) {
            const fixtureId = String(pred.fixture_id)
            if (!predictionsFromDb[fixtureId]) {
              predictionsFromDb[fixtureId] = {}
            }
            const userName = Object.entries(userIdByName).find(
              ([, id]) => id === pred.user_id,
            )?.[0]
            if (userName) {
              predictionsFromDb[fixtureId][userName] = pred.choice
            }
          }
          // Merge instead of replacing to avoid wiping a fresh local pick while DB load is still in-flight.
          setPredictions((prev) => {
            const merged: PredictionsByFixture = { ...predictionsFromDb }
            for (const [fixtureId, userChoices] of Object.entries(prev)) {
              merged[fixtureId] = {
                ...(merged[fixtureId] ?? {}),
                ...userChoices,
              }
            }
            return merged
          })
        }
      } catch (err) {
        console.error('Failed to load predictions from Supabase:', err)
      }
    }
    void loadPredictions()
  }, [userIdByName])

  useEffect(() => {
    localStorage.setItem(PREDICTIONS_STORAGE_KEY, JSON.stringify(predictions))
  }, [predictions])

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const liveFixtures = await fetchLiveFixtures(controller.signal)
        setMatches(liveFixtures.map(toFixtureRecord))

        if (supabase) {
          setSyncingToDb(true)
          try {
            const fixturesForDb = liveFixtures.map(
              ({ home_penalty_score, away_penalty_score, ...fixture }) => fixture,
            )

            await supabase.from('fixtures').upsert(fixturesForDb, {
              onConflict: 'fixture_id',
            })
            localStorage.setItem(FIXTURES_SYNC_STORAGE_KEY, 'done')
          } catch (err) {
            console.warn('Could not sync latest fixtures to Supabase:', err)
          } finally {
            setSyncingToDb(false)
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          try {
            const response = await fetch('./data/fixtures.json', {
              signal: controller.signal,
            })
            if (!response.ok) {
              throw new Error(`Failed to load fixtures: ${response.status}`)
            }
            const data = (await response.json()) as FixtureRecord[]
            setMatches(data.sort((a, b) => +new Date(a.date) - +new Date(b.date)))
          } catch (fallbackError) {
            setError(
              fallbackError instanceof Error
                ? fallbackError.message
                : err instanceof Error
                  ? err.message
                  : 'Could not load fixture data.',
            )
          }
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
      if (getStageTab(m.group) !== activeTab) {
        return false
      }
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
  }, [matches, selectedRound, filter, activeTab])

  const stageMatches = useMemo(() => {
    return matches.filter((m) => getStageTab(m.group) === activeTab)
  }, [matches, activeTab])

  const leaderboard = useMemo(() => {
    return users
      .map((user) => {
        let correct = 0
        let attempts = 0
        for (const match of stageMatches) {
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
  }, [users, predictions, stageMatches])

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

  const confirmRemoveUser = async (user: string) => {
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
    const match = matches.find((m) => m.fixtureId === fixtureId)
    if (match && matchOutcome(match)) {
      return
    }

    if (supabase) {
      const db = supabase
      const userId = userIdByName[user]
      if (userId) {
        setSyncingToDb(true)
        const syncPrediction = async () => {
          try {
            const { error: upsertError } = await db.from('predictions').upsert(
              {
                user_id: userId,
                fixture_id: fixtureId,
                choice,
              },
              { onConflict: 'user_id,fixture_id' },
            )

            if (upsertError) {
              // Fallback for environments where upsert conflict target is not available.
              const { data: existing, error: selectError } = await db
                .from('predictions')
                .select('id')
                .eq('user_id', userId)
                .eq('fixture_id', fixtureId)
                .maybeSingle()

              if (selectError) {
                throw selectError
              }

              if (existing?.id) {
                const { error: updateError } = await db
                  .from('predictions')
                  .update({ choice })
                  .eq('id', existing.id)
                if (updateError) {
                  throw updateError
                }
              } else {
                const { error: insertError } = await db.from('predictions').insert({
                  user_id: userId,
                  fixture_id: fixtureId,
                  choice,
                })
                if (insertError) {
                  throw insertError
                }
              }
            }
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
        <h1>2026 Aarrass World Cup</h1>
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
          <p>Upcoming Matches</p>
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
              <button onClick={() => setUserToRemove(user)} aria-label={`Remove ${user}`}>
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
              className={activeTab === 'group-stage' ? 'active' : ''}
              onClick={() => setActiveTab('group-stage')}
            >
              Group Stage
            </button>
            <button
              className={activeTab === 'round-of-32-16' ? 'active' : ''}
              onClick={() => setActiveTab('round-of-32-16')}
            >
              R32 & R16
            </button>
            <button
              className={activeTab === 'knockouts' ? 'active' : ''}
              onClick={() => setActiveTab('knockouts')}
            >
              Finals
            </button>
          </div>
        </div>
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
            const goalsScore =
              match.goals.home == null || match.goals.away == null
                ? 'vs'
                : `${match.goals.home} - ${match.goals.away}`
            const penaltiesScore =
              match.goals.homePenalty == null || match.goals.awayPenalty == null
                ? null
                : `${match.goals.homePenalty} - ${match.goals.awayPenalty}`

            return (
              <article className="match-card" key={match.fixtureId}>
                <div className="match-top">
                  <p className="round">{match.round}</p>
                  <p className="date">{toDateLabel(match.date)}</p>
                </div>
                <div className="teams">
                  <span>{match.homeTeam.name}</span>
                  <div className="score-stack">
                    <strong>{`Goals: ${goalsScore}`}</strong>
                    {penaltiesScore ? (
                      <span className="penalty-score">Penalties: {penaltiesScore}</span>
                    ) : null}
                  </div>
                  <span>{match.awayTeam.name}</span>
                </div>
                <p className="status">
                  {match.statusLong}
                  {match.venueName ? ` • ${match.venueName}` : ''}
                </p>
                {outcome ? (
                  <p className="result-pill">
                    Result:{' '}
                    {outcome === 'home'
                      ? match.homeTeam.name
                      : outcome === 'away'
                        ? match.awayTeam.name
                        : 'Draw'}
                  </p>
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
                                    disabled={Boolean(outcome)}
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

      {userToRemove && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Remove Player?</h3>
            <p>Are you sure you want to remove <strong>{userToRemove}</strong>? This will delete all their predictions.</p>
            <div className="modal-actions">
              <button onClick={() => setUserToRemove(null)} className="cancel-btn">Cancel</button>
              <button onClick={() => {
                confirmRemoveUser(userToRemove)
                setUserToRemove(null)
              }} className="confirm-btn">Remove</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
