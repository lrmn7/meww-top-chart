import { prisma } from '../db';
import { scrapeKworbGlobalDailyTracks } from '../scraping/kworbTracks';
import { scrapeKworbIndonesiaDailyTracks } from '../scraping/kworbIndonesia';
import { scrapeKworbCountryDailyTracks, getCountriesToScrape } from '../scraping/kworbCountry';
import { resolveTrackMetadata } from '../spotify/metadata';
import { TrackStat } from '../types';

export interface SpotifyStatsProvider {
  refreshAllStats(): Promise<void>;
  getTopTracks(limit: number, country?: string): Promise<TrackStat[]>;
}

class SpotifyStatsProviderImpl implements SpotifyStatsProvider {
  /**
   * Refreshes all track stats by scraping kworb, storing snapshots, computing deltas, and enriching with Spotify metadata
   */
  async refreshAllStats(): Promise<void> {
    console.log('Starting stats refresh...');

    try {
      // Step 1: Scrape global kworb tracks
      console.log('Scraping global kworb tracks...');
      const trackRaws = await scrapeKworbGlobalDailyTracks();
      console.log(`Scraped ${trackRaws.length} global tracks`);

      // Step 2: Clean up invalid track entries
      await this.cleanupInvalidTracks('global');

      // Step 3: Store global snapshots
      await this.storeTrackSnapshots(trackRaws, 'global');

      // Step 4: Update global current stats with rank deltas
      await this.updateTrackCurrents(trackRaws, 'global');

      // Step 5: Scrape all configured countries
      const countries = getCountriesToScrape().filter(c => c !== 'global');
      for (const countryCode of countries) {
        console.log(`Scraping ${countryCode} tracks...`);
        let countryTrackRaws;

        if (countryCode === 'id') {
          countryTrackRaws = await scrapeKworbIndonesiaDailyTracks();
        } else {
          countryTrackRaws = await scrapeKworbCountryDailyTracks(countryCode);
        }

        console.log(`Scraped ${countryTrackRaws.length} ${countryCode} tracks`);

        await this.cleanupInvalidTracks(countryCode);
        await this.storeTrackSnapshots(countryTrackRaws, countryCode);
        await this.updateTrackCurrents(countryTrackRaws, countryCode);
      }

      console.log('Stats refresh completed successfully');
    } catch (error) {
      console.error('Error refreshing stats:', error);
      throw error;
    }
  }

  /**
   * Stores track snapshots in the database
   */
  private async storeTrackSnapshots(tracks: Array<{ trackName: string; artistName: string; rank: number; dailyStreams: number; totalStreams?: number }>, country: string = 'global'): Promise<void> {
    await prisma.trackSnapshot.createMany({
      data: tracks.map(t => ({
        trackName: t.trackName,
        artistName: t.artistName,
        country,
        rank: t.rank,
        dailyStreams: BigInt(t.dailyStreams),
        totalStreams: t.totalStreams ? BigInt(t.totalStreams) : null,
      })),
    });
  }

  /**
   * Gets the daily baseline snapshot for tracks
   */
  private async getDailyBaselineTrackSnapshot(trackName: string, artistName: string, country: string): Promise<{ rank: number } | null> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    const previousDaySnapshot = await prisma.trackSnapshot.findFirst({
      where: {
        trackName,
        artistName,
        country,
        createdAt: {
          lt: todayStart,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return previousDaySnapshot ? { rank: previousDaySnapshot.rank } : null;
  }

  /**
   * Updates track current stats, computing rank deltas and enriching with Spotify metadata
   */
  private async updateTrackCurrents(tracks: Array<{ trackName: string; artistName: string; rank: number; dailyStreams: number; totalStreams?: number }>, country: string = 'global'): Promise<void> {
    const startTime = new Date();
    for (const track of tracks) {
      const dailyBaseline = await this.getDailyBaselineTrackSnapshot(track.trackName, track.artistName, country);
      const previousRank = dailyBaseline?.rank ?? null;
      const rankDelta = previousRank !== null ? track.rank - previousRank : null;

      // Get existing current record to check if we need to enrich metadata
      const existing = await prisma.trackCurrent.findUnique({
        where: {
          trackName_artistName_country: {
            trackName: track.trackName,
            artistName: track.artistName,
            country,
          },
        },
      });

      let trackId = existing?.trackId ?? null;
      let imageUrl = existing?.imageUrl ?? null;
      let previewUrl = existing?.previewUrl ?? null;
      let spotifyUrl = existing?.spotifyUrl ?? null;

      // Enrich with Spotify metadata if not already done
      if (!trackId) {
        console.log(`Enriching metadata for track: ${track.trackName} by ${track.artistName}`);
        const metadata = await resolveTrackMetadata(track.trackName, track.artistName);
        if (metadata) {
          trackId = metadata.spotifyId;
          imageUrl = metadata.imageUrl ?? null;
          previewUrl = metadata.previewUrl ?? null;
          spotifyUrl = metadata.url ?? null;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Upsert current record
      await prisma.trackCurrent.upsert({
        where: {
          trackName_artistName_country: {
            trackName: track.trackName,
            artistName: track.artistName,
            country,
          },
        },
        update: {
          rank: track.rank,
          previousRank,
          rankDelta,
          dailyStreams: BigInt(track.dailyStreams),
          totalStreams: track.totalStreams ? BigInt(track.totalStreams) : null,
          trackId: trackId ?? undefined,
          imageUrl: imageUrl ?? undefined,
          previewUrl: previewUrl,
          spotifyUrl: spotifyUrl ?? undefined,
          lastUpdated: new Date(),
        },
        create: {
          trackName: track.trackName,
          artistName: track.artistName,
          country,
          rank: track.rank,
          previousRank,
          rankDelta,
          dailyStreams: BigInt(track.dailyStreams),
          totalStreams: track.totalStreams ? BigInt(track.totalStreams) : null,
          trackId: trackId ?? null,
          imageUrl: imageUrl ?? null,
          previewUrl: previewUrl ?? null,
          spotifyUrl: spotifyUrl ?? null,
        },
      });
    }

    // CLEANUP: Remove stale tracks
    console.log(`Cleaning up stale tracks for ${country}...`);
    const cleanupResult = await prisma.trackCurrent.deleteMany({
      where: {
        country,
        lastUpdated: {
          lt: startTime,
        },
      },
    });
    console.log(`Deleted ${cleanupResult.count} stale tracks in ${country}`);
  }

  /**
   * Cleans up invalid track entries from the database
   */
  private async cleanupInvalidTracks(country: string = 'global'): Promise<void> {
    console.log(`Cleaning up invalid tracks for ${country}...`);

    const invalidTracks = await prisma.trackCurrent.findMany({
      where: {
        country,
        dailyStreams: {
          lt: BigInt(100000),
        },
      },
    });

    if (invalidTracks.length > 0) {
      console.log(`Found ${invalidTracks.length} tracks with suspiciously small daily streams`);

      await prisma.trackCurrent.deleteMany({
        where: {
          country,
          dailyStreams: {
            lt: BigInt(100000),
          },
        },
      });

      for (const track of invalidTracks) {
        await prisma.trackSnapshot.deleteMany({
          where: {
            trackName: track.trackName,
            artistName: track.artistName,
            country,
          },
        });
      }
    }

    const allTracks = await prisma.trackCurrent.findMany({
      where: { country },
    });

    const tracksToDelete = allTracks.filter(track => {
      const trackName = track.trackName.trim();
      return (
        trackName.length < 2 ||
        /^[=\+\-\s]+$/.test(trackName) ||
        /^[\d\s\-=]+$/.test(trackName) ||
        !/[a-zA-Z]/.test(trackName)
      );
    });

    if (tracksToDelete.length > 0) {
      console.log(`Found ${tracksToDelete.length} tracks with invalid names`);

      for (const track of tracksToDelete) {
        await prisma.trackCurrent.deleteMany({
          where: {
            trackName: track.trackName,
            artistName: track.artistName,
            country,
          },
        });

        await prisma.trackSnapshot.deleteMany({
          where: {
            trackName: track.trackName,
            artistName: track.artistName,
            country,
          },
        });
      }
    }

    console.log(`Cleanup completed for ${country}`);
  }

  /**
   * Gets top tracks from the database
   */
  async getTopTracks(limit: number = parseInt(process.env.TOP_TRACKS_LIMIT || '25', 10), country: string = 'global'): Promise<TrackStat[]> {
    const tracks = await prisma.trackCurrent.findMany({
      where: { country },
      orderBy: { rank: 'asc' },
      take: limit,
    });

    return tracks.map(t => ({
      trackId: t.trackId,
      name: t.trackName,
      mainArtistName: t.artistName,
      rank: t.rank,
      previousRank: t.previousRank,
      rankDelta: t.rankDelta,
      dailyStreams: Number(t.dailyStreams),
      totalStreams: t.totalStreams ? Number(t.totalStreams) : undefined,
      imageUrl: t.imageUrl ?? undefined,
      previewUrl: t.previewUrl ?? undefined,
      spotifyUrl: t.spotifyUrl ?? undefined,
      lastUpdated: t.lastUpdated,
    }));
  }
}

export const statsProvider: SpotifyStatsProvider = new SpotifyStatsProviderImpl();
