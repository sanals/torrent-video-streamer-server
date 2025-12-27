import TorrentSearchApi from 'torrent-search-api';
import TorrentDownloads from './custom_providers/torrentdownloads.js';

import OtherDirect from './custom_providers/other_direct.js';
import JackettSearchService from './jackettSearchService.js';
import config from '../config/index.js';

/**
 * Alternative search service that tries multiple providers
 * to avoid Cloudflare blocks
 */
class AlternativeSearchService {
    constructor() {
        this.lastRequest = 0;
        this.requestDelay = 1000;

        // Providers to try in order (ones less likely to have Cloudflare first)
        this.providerPriority = [
            'Jackett',          // Jackett (handles 500+ providers)
            'TorrentDownloads', // Custom provider (reliable)
            'ThePirateBay',    // May work
            'YTS',             // High reliability for movies
        ];

        // Load custom providers
        try {
            TorrentSearchApi.loadProvider(TorrentDownloads);
        } catch (e) {
            console.error('Failed to load TorrentDownloads provider:', e);
        }
    }

    async waitForRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequest;

        if (timeSinceLastRequest < this.requestDelay) {
            const waitTime = this.requestDelay - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        this.lastRequest = Date.now();
    }

    mapCategory(category) {
        const categoryMap = {
            'movies': 'Movies',
            'tv': 'TV',
            'music': 'Music',
            'games': 'Games',
            'software': 'Applications',
            'ebook': 'Books',
            'other': 'Other',
        };
        return categoryMap[category] || 'All';
    }

    parseSize(sizeString) {
        if (!sizeString || typeof sizeString !== 'string') return 0;

        const units = {
            'B': 1,
            'KB': 1024,
            'MB': 1024 * 1024,
            'GB': 1024 * 1024 * 1024,
            'TB': 1024 * 1024 * 1024 * 1024,
        };

        const match = sizeString.match(/^([\d.]+)\s*([KMGT]?B)$/i);
        if (!match) return 0;

        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        return Math.floor(value * (units[unit] || 1));
    }

    detectCategory(title) {
        if (!title) return 'Other';
        const lower = title.toLowerCase();

        if (lower.includes('season') || lower.includes('s0') || lower.includes('episode') || lower.includes('e0')) {
            return 'TV Shows';
        }
        if (lower.match(/\b(1080p|720p|480p|4k|bluray|dvdrip|webrip|web-dl)\b/)) {
            return 'Movies';
        }
        if (lower.match(/\b(mp3|flac|album|single)\b/)) {
            return 'Music';
        }
        if (lower.match(/\b(game|iso|repack|crack)\b/)) {
            return 'Games';
        }
        if (lower.match(/\b(software|app|program)\b/)) {
            return 'Software';
        }

        return 'Other';
    }

    /**
     * Search using alternative providers (tries multiple to avoid Cloudflare)
     */
    async searchTorrents(query, options = {}) {
        const category = options.category ? this.mapCategory(options.category) : 'All';
        const limit = Math.min(options.limit || 50, 100);

        // Use specific provider if requested, otherwise use priority list
        const providersToTry = options.provider
            ? [options.provider]
            : this.providerPriority;

        // Try each provider in priority order
        for (const provider of providersToTry) {
            try {
                await this.waitForRateLimit();

                console.log(`🔍 Trying ${provider} for: "${query}"`);

                if (provider === 'Jackett') {
                    if (!config.jackett.enabled) {
                        console.log('ℹ️  Jackett not enabled, skipping...');
                        continue;
                    }
                    const results = await JackettSearchService.searchTorrents(query, options);
                    if (results && results.length > 0) {
                        console.log(`✅ Found ${results.length} torrents from ${provider}`);
                        return results;
                    }
                    console.log(`ℹ️  No results from ${provider}, trying next...`);
                    continue;
                }

                // Disable all, enable only this provider
                TorrentSearchApi.disableAllProviders();
                TorrentSearchApi.enableProvider(provider);

                const results = await TorrentSearchApi.search(query, category, limit);

                if (!results || results.length === 0) {
                    console.log(`ℹ️  No results from ${provider}, trying next...`);
                    continue;
                }

                // Transform results
                const transformedResults = (await Promise.all(results.map(async torrent => {
                    let magnetURI = torrent.magnet || torrent.magnetLink || '';

                    // If magnet is missing (e.g. TorrentDownloads), try to fetch it
                    if (!magnetURI && provider === 'TorrentDownloads' && torrent.desc) {
                        try {
                            // Limit magnet fetching to avoid rate limits? 
                            // For now, try fetching. concurrency might be an issue.
                            magnetURI = await TorrentSearchApi.getMagnet(torrent);
                        } catch (e) {
                            console.warn(`Failed to fetch magnet for ${torrent.title}:`, e.message);
                        }
                    }

                    return {
                        name: torrent.title || torrent.name || 'Unknown',
                        magnetURI: magnetURI,
                        size: this.parseSize(torrent.size) || 0,
                        seeders: parseInt(torrent.seeds || torrent.seeder || 0),
                        leechers: parseInt(torrent.peers || torrent.leech || 0),
                        category: this.detectCategory(torrent.title || torrent.name),
                        uploadDate: torrent.time || torrent.date || new Date().toISOString(),
                        source: provider,
                        infoPage: torrent.desc || torrent.url || null,
                    };
                }))).filter(result => result.magnetURI);

                console.log(`✅ Found ${transformedResults.length} torrents from ${provider}`);
                return transformedResults;

            } catch (error) {
                const errorStr = JSON.stringify(error).toLowerCase();
                const isCloudflare = errorStr.includes('cloudflare') ||
                    errorStr.includes('just a moment') ||
                    errorStr.includes('challenge-platform') ||
                    error.status === 403;

                if (isCloudflare) {
                    console.log(`⚠️  ${provider} blocked by Cloudflare, trying next provider...`);
                    continue;
                }

                console.log(`⚠️  ${provider} failed: ${error.message}, trying next...`);
                continue;
            }
        }

        // If no results found, return empty array instead of throwing
        return [];
    }

    /**
     * Search for other content via Jackett (other category) and OtherDirect
     * This is the JACKETTX source for the secret other mode
     */
    async searchOtherTorrents(query, options = {}) {
        const limit = Math.min(options.limit || 50, 100);
        let allResults = [];

        try {
            await this.waitForRateLimit();

            const promises = [];

            // 1. Jackett Task
            if (config.jackett.enabled) {
                promises.push((async () => {
                    console.log(`🔍 Trying Jackett (Other) for: "${query}"`);
                    const results = await JackettSearchService.searchTorrents(query, {
                        ...options,
                        category: 'other'
                    });
                    if (results && results.length > 0) {
                        console.log(`✅ Found ${results.length} other torrents from Jackett`);
                        return results;
                    }
                    return [];
                })());
            }

            // 2. OtherDirect Task
            promises.push((async () => {
                console.log(`🔍 Trying OtherDirect for: "${query}"`);
                const otherResults = await OtherDirect.search(query, null, limit);

                if (otherResults && otherResults.length > 0) {
                    // Transform OtherDirect results
                    const transformedOther = await Promise.all(otherResults.map(async torrent => {
                        let magnetURI = '';
                        if (torrent.infoHash) {
                            magnetURI = OtherDirect.buildMagnetLink(torrent.infoHash, torrent.title);
                        } else {
                            magnetURI = await OtherDirect.getMagnet(torrent);
                        }
                        return {
                            name: torrent.title || 'Unknown',
                            magnetURI: magnetURI,
                            size: OtherDirect.parseSize(torrent.size) || 0,
                            seeders: torrent.seeds || 0,
                            leechers: torrent.peers || 0,
                            category: 'Other',
                            uploadDate: torrent.time || new Date().toISOString(),
                            source: 'OtherDirect',
                            infoPage: torrent.desc || null,
                        };
                    }));

                    const validOther = transformedOther.filter(r => r.magnetURI);
                    console.log(`✅ Found ${validOther.length} torrents from OtherDirect`);
                    return validOther;
                }
                return [];
            })());

            // Run in parallel and wait for all to settle
            const results = await Promise.allSettled(promises);

            // Combine results from successful promises
            results.forEach(result => {
                if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                    allResults = allResults.concat(result.value);
                } else if (result.status === 'rejected') {
                    console.error('Other search provider failed:', result.reason?.message || result.reason);
                }
            });

        } catch (error) {
            console.error('Other search error:', error.message);
        }

        // Sort by seeders and return
        return allResults
            .sort((a, b) => (b.seeders || 0) - (a.seeders || 0))
            .slice(0, limit);
    }
}

export default new AlternativeSearchService();
