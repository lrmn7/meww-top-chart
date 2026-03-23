# Meww.me Top Chart

> JSON API for Spotify top daily tracks data, scraped from [Kworb.net](https://kworb.net) and enriched with Spotify metadata.

## Overview

Meww.me Top Chart is a **JSON-only API service** built with Next.js that scrapes Spotify daily track chart data from Kworb.net, enriches it with Spotify metadata (cover art, preview URL, Spotify link), and serves it through clean REST endpoints.

### Key Features

- 🎵 **Top Daily Tracks**  Scraped from Kworb.net for 20 countries + global
- 🎧 **Spotify Integration**  Automatic track matching with cover art, preview URLs, and Spotify links
- 📈 **Historical Data**  Daily snapshots with rank changes
- 🌍 **Multi-Country Support**  Global + 19 country-specific charts
- 🔄 **Auto-Refresh** Cron-based data refresh via Vercel or manual trigger

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | [Next.js 14](https://nextjs.org/) (App Router) |
| Language | TypeScript |
| Database | MySQL (production) / PostgreSQL / SQLite (development) |
| ORM | [Prisma](https://www.prisma.io/) |
| Scraping | [Cheerio](https://cheerio.js.org/) |
| API Source | Spotify Web API |
| Deployment | Vercel / Hostinger Node.js |

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- MySQL / PostgreSQL / SQLite database
- [Spotify Developer](https://developer.spotify.com/dashboard) app credentials

### Installation

```bash
# Clone the repository
git clone https://github.com/lrmn7/mewwme-top-chart.git
cd mewwme-top-chart

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
```

### Environment Variables

Edit `.env` with your credentials:

```env
# Required
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
DATABASE_URL="mysql://user:password@host:3306/database"

# Admin secret for triggering data refresh
ADMIN_SECRET=your_secret_here

# Countries to scrape (comma-separated)
SCRAPE_COUNTRIES=global,id,us,gb,jp,kr,de,fr,br,mx,in,au,es,it,ca,se,ph,tr,ar,nl

# Limits
TOP_TRACKS_LIMIT=25

# Optional: Rate limit rotation (add up to 3 Spotify client pairs)
# SPOTIFY_CLIENT_ID_2=second_client_id
# SPOTIFY_CLIENT_SECRET_2=second_client_secret

# Server port (for custom server)
PORT=3301
```

### Database Setup

Three schema variants are provided:
- `prisma/schema.prisma` — MySQL (default)
- `prisma/schema.postgresql.prisma` — PostgreSQL
- `prisma/schema.sqlite.prisma` — SQLite (local dev)

To switch database, copy the desired schema to `schema.prisma` and update `DATABASE_URL`.

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# (Optional) Open Prisma Studio to browse data
npx prisma studio
```

### Running

```bash
# Development
npm run dev

# Production build
npm run build
npm start
```

---

## API Endpoints

### Tracks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stats/tracks` | Top daily tracks with streams, rank, Spotify metadata |
| `GET` | `/api/stats/tracks/history` | Track stream/rank history |
| `GET` | `/api/stats/countries` | List of supported countries |
| `GET` | `/api/stats/last-updated` | Timestamp of last data refresh |

### Query Parameters

#### `/api/stats/tracks`
| Param | Default | Description |
|-------|---------|-------------|
| `country` | `global` | Country code (e.g., `id`, `us`, `gb`) |
| `limit` | `25` | Number of results |

#### `/api/stats/tracks/history`
| Param | Default | Description |
|-------|---------|-------------|
| `track` | — | Track name (required) |
| `artist` | — | Artist name (required) |
| `country` | `global` | Country code |
| `days` | `30` | Number of days of history |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/cron/refresh?secret=YOUR_SECRET` | Trigger data refresh |
| `POST` | `/api/cron/refresh` | Trigger data refresh (JSON body) |

### Example Response

```json
GET /api/stats/tracks?country=global&limit=2

{
  "tracks": [
    {
      "trackId": "2plbrEY59IikOBgBGLjaoe",
      "name": "Die With A Smile",
      "mainArtistName": "Lady Gaga, Bruno Mars",
      "rank": 1,
      "previousRank": 1,
      "rankDelta": 0,
      "dailyStreams": 8500000,
      "totalStreams": 3200000000,
      "imageUrl": "https://i.scdn.co/image/...",
      "previewUrl": "https://p.scdn.co/mp3-preview/...",
      "spotifyUrl": "https://open.spotify.com/track/..."
    }
  ]
}
```

---

## Architecture

```
src/
├── app/
│   └── api/
│       ├── cron/refresh/         # Data refresh endpoint
│       └── stats/
│           ├── tracks/           # Top tracks API
│           ├── countries/        # Supported countries
│           └── last-updated/     # Last refresh timestamp
├── lib/
│   ├── db.ts                     # Prisma client singleton
│   ├── types.ts                  # TypeScript interfaces
│   ├── spotify/
│   │   ├── auth.ts               # Multi-client Spotify auth with rotation
│   │   └── metadata.ts           # Spotify metadata enrichment
│   ├── services/
│   │   └── statsProvider.ts      # Core data aggregation service
│   └── scraping/
│       ├── kworbTracks.ts        # Global top tracks scraper
│       ├── kworbCountry.ts       # Multi-country chart scraper
│       ├── kworbIndonesia.ts     # Indonesia-specific scraper
│       └── kworbScraper.ts       # Base Kworb scraping utilities
├── prisma/
│   ├── schema.prisma             # MySQL schema (primary)
│   ├── schema.mysql.prisma       # MySQL variant
│   ├── schema.postgresql.prisma  # PostgreSQL variant
│   └── schema.sqlite.prisma     # SQLite variant
└── server.js                     # Custom server (Hostinger compatible)
```

---

## Data Flow

```
Kworb.net  ──scrape──▶  Raw Track Chart Data
                              │
                              ▼
                        Spotify API
                      (cover art, URLs)
                              │
                              ▼
                     statsProvider.ts
                     (merge & enrich)
                              │
                              ▼
                    Prisma / Database
                              │
                              ▼
                      JSON API Routes
```

1. **Scrape**  Kworb.net is scraped for top daily tracks (by daily streams) across 20 countries
2. **Enrich**  Each track is enriched with Spotify ID, cover art, preview URL, and Spotify link
3. **Store**  Data is persisted to the database with daily snapshots for historical tracking
4. **Serve**  Clean JSON APIs expose the data with filtering and country support

---

## Data Refresh

Data is refreshed via the `/api/cron/refresh` endpoint:

- **Vercel Cron**  Automatically runs at 00:00 and 12:00 UTC daily (configured in `vercel.json`)
- **Manual**  Call `GET /api/cron/refresh?secret=YOUR_ADMIN_SECRET`
- **Script**  Run `node refresh-data.js` directly

---

## Supported Countries

| Code | Country | Code | Country |
|------|---------|------|---------|
| `global` | 🌍 Global | `kr` | 🇰🇷 South Korea |
| `us` | 🇺🇸 United States | `in` | 🇮🇳 India |
| `gb` | 🇬🇧 United Kingdom | `au` | 🇦🇺 Australia |
| `id` | 🇮🇩 Indonesia | `es` | 🇪🇸 Spain |
| `jp` | 🇯🇵 Japan | `it` | 🇮🇹 Italy |
| `de` | 🇩🇪 Germany | `ca` | 🇨🇦 Canada |
| `fr` | 🇫🇷 France | `se` | 🇸🇪 Sweden |
| `br` | 🇧🇷 Brazil | `ph` | 🇵🇭 Philippines |
| `mx` | 🇲🇽 Mexico | `tr` | 🇹🇷 Turkey |
| `nl` | 🇳🇱 Netherlands | `ar` | 🇦🇷 Argentina |

---

## Deployment

### Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

Set environment variables in Vercel dashboard. Cron jobs are configured in `vercel.json`.

### Hostinger / Custom Node.js

```bash
npm run build
node server.js
```

The custom `server.js` includes `.htaccess` self-healing for Apache-based hosting (LiteSpeed/Hostinger).

---

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run db:push` | Push Prisma schema to database |
| `npm run db:studio` | Open Prisma Studio |
| `node refresh-data.js` | Manual data refresh |
| `node check-data.js` | Check data counts in database |

---

## License

This project is for personal/educational use.
