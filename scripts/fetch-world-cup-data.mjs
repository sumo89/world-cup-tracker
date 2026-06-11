const API_BASE = 'https://worldcup26.ir'

async function apiGet(path) {
  const url = new URL(`${API_BASE}${path}`)

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`API error ${response.status} for ${url.pathname}`)
    }
    return await response.json()
  } catch (error) {
    const certError =
      error instanceof Error &&
      String(error.cause?.code || '').includes('SELF_SIGNED_CERT_IN_CHAIN')

    if (!certError) {
      throw error
    }

    const { execFileSync } = await import('node:child_process')
    const stdout = execFileSync('curl', ['--silent', '--show-error', '--insecure', url.href], {
      encoding: 'utf8',
    })

    return JSON.parse(stdout)
  }
}

function parseLocalDate(value) {
  if (!value || typeof value !== 'string') {
    return null
  }
  const [datePart, timePart] = value.split(' ')
  if (!datePart || !timePart) {
    return null
  }
  const [month, day, year] = datePart.split('/').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  if ([month, day, year, hour, minute].some((v) => Number.isNaN(v))) {
    return null
  }

  return new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString()
}

function toNumberOrNull(value) {
  if (value == null) {
    return null
  }
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function toStatus(game) {
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

function toRound(game) {
  if (game.type === 'group') {
    return `Group ${game.group} - ${game.matchday}`
  }

  const map = {
    r32: 'Round of 32',
    r16: 'Round of 16',
    qf: 'Quarter-finals',
    sf: 'Semi-finals',
    third: 'Third Place Play-off',
    final: 'Final',
  }

  return map[game.type] || game.group || game.type || 'Knockout Stage'
}

function mapFixture(game, stadiumById) {
  const status = toStatus(game)
  const stadium = stadiumById.get(String(game.stadium_id))
  const homeName = game.home_team_name_en || game.home_team_label || 'TBD'
  const awayName = game.away_team_name_en || game.away_team_label || 'TBD'

  return {
    fixtureId: Number(game.id),
    date: parseLocalDate(game.local_date) ?? new Date().toISOString(),
    round: toRound(game),
    statusShort: status.short,
    statusLong: status.long,
    venueName: stadium?.name_en ?? stadium?.fifa_name ?? null,
    venueCity: stadium?.city_en ?? null,
    homeTeam: {
      id: toNumberOrNull(game.home_team_id) ?? 0,
      name: homeName,
      logo: null,
    },
    awayTeam: {
      id: toNumberOrNull(game.away_team_id) ?? 0,
      name: awayName,
      logo: null,
    },
    goals: {
      home: toNumberOrNull(game.home_score),
      away: toNumberOrNull(game.away_score),
    },
  }
}

async function getAllFixtures() {
  const [gamesResponse, stadiumsResponse] = await Promise.all([
    apiGet('/get/games'),
    apiGet('/get/stadiums'),
  ])

  const games = gamesResponse.games || []
  const stadiums = stadiumsResponse.stadiums || []
  const stadiumById = new Map(stadiums.map((stadium) => [String(stadium.id), stadium]))

  const fixtures = games.map((game) => mapFixture(game, stadiumById))
  fixtures.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  return fixtures
}

async function main() {
  const fixtures = await getAllFixtures()

  const outputDir = new URL('../public/data/', import.meta.url)
  const fixturesUrl = new URL('fixtures.json', outputDir)
  const metadataUrl = new URL('last-updated.json', outputDir)

  await import('node:fs/promises').then(async ({ mkdir, writeFile }) => {
    await mkdir(outputDir, { recursive: true })
    await writeFile(fixturesUrl, `${JSON.stringify(fixtures, null, 2)}\n`, 'utf8')
    await writeFile(
      metadataUrl,
      `${JSON.stringify(
        {
          updatedAtUtc: new Date().toISOString(),
          source: 'worldcup26.ir',
          fixtureCount: fixtures.length,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
  })

  console.log(`Wrote ${fixtures.length} fixtures to public/data/fixtures.json`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
