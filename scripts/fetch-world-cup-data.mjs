const API_BASE = 'https://v3.football.api-sports.io'
const LEAGUE = 1
const SEASON = 2026

const apiKey = process.env.API_FOOTBALL_KEY
if (!apiKey) {
  console.error('Missing API_FOOTBALL_KEY environment variable.')
  process.exit(1)
}

async function apiGet(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value))
  }

  const response = await fetch(url, {
    headers: {
      'x-apisports-key': apiKey,
    },
  })

  if (!response.ok) {
    throw new Error(`API error ${response.status} for ${url.pathname}`)
  }

  const data = await response.json()
  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(`API returned errors: ${JSON.stringify(data.errors)}`)
  }

  return data
}

function mapFixture(item) {
  return {
    fixtureId: item.fixture.id,
    date: item.fixture.date,
    round: item.league.round || '',
    statusShort: item.fixture.status.short,
    statusLong: item.fixture.status.long,
    venueName: item.fixture.venue?.name ?? null,
    venueCity: item.fixture.venue?.city ?? null,
    homeTeam: {
      id: item.teams.home.id,
      name: item.teams.home.name,
      logo: item.teams.home.logo ?? null,
    },
    awayTeam: {
      id: item.teams.away.id,
      name: item.teams.away.name,
      logo: item.teams.away.logo ?? null,
    },
    goals: {
      home: item.goals.home,
      away: item.goals.away,
    },
  }
}

async function getAllFixtures() {
  const fixtures = []
  let page = 1

  while (true) {
    const data = await apiGet('/fixtures', {
      league: LEAGUE,
      season: SEASON,
      page,
    })

    const responseItems = data.response || []
    fixtures.push(...responseItems.map(mapFixture))

    const paging = data.paging || {}
    if (!paging.total || page >= paging.total) {
      break
    }
    page += 1
  }

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
          league: LEAGUE,
          season: SEASON,
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
