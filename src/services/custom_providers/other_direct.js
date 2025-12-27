import cheerio from 'cheerio';

const OtherDirect = {
    name: 'OtherDirect',
    baseUrl: 'https://xxxclub.to',
    searchUrl: '/torrents/search/all/{query}',
    categories: {
        'All': 'all',
        'FullHD': 'fullhd',
        'HD': 'hd',
        'SD': 'sd',
        'UHD': 'uhd',
    },
    defaultCategory: 'All',

    /**
     * Build a magnet URI from an info hash and title
     */
    buildMagnetLink(infoHash, title) {
        const trackers = [
            'udp://tracker.opentrackr.org:1337/announce',
            'udp://open.stealth.si:80/announce',
            'udp://tracker.torrent.eu.org:451/announce',
            'udp://tracker.bittor.pw:1337/announce',
            'udp://public.popcorn-tracker.org:6969/announce',
            'udp://tracker.dler.org:6969/announce',
            'udp://exodus.desync.com:6969',
        ];

        const trackerParams = trackers.map(t => `tr=${encodeURIComponent(t)}`).join('&');
        return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}&${trackerParams}`;
    },

    /**
     * Parse size string to bytes
     */
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
    },

    /**
     * Search for torrents on OtherDirect
     */
    search: async function (query, cat, limit) {
        const url = `${this.baseUrl}/torrents/search/all/${encodeURIComponent(query)}`;

        const results = [];
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                }
            });

            if (!res.ok) {
                console.error(`OtherDirect fetch failed: ${res.status}`);
                return [];
            }

            const html = await res.text();
            const $ = cheerio.load(html);

            // Parse the list items - structure is ul.tsearch > li
            const rows = $('.browsetableinside ul.tsearch li');

            rows.each((i, elem) => {
                // Skip header row if it contains 'Category'
                if ($(elem).text().includes('Category') && i === 0) return;

                const row = $(elem);

                // Get the title link - carefully select the visible one with details link
                const titleLink = row.find('span:nth-child(2) a[href^="/torrents/details/"]');
                const title = titleLink.text().trim();
                const idAttr = titleLink.attr('id') || '';

                // Extract info hash from id attribute (format: #i{40-char-hash})
                const hashMatch = idAttr.match(/#i([a-f0-9]{40})/i);
                const infoHash = hashMatch ? hashMatch[1] : null;

                if (!title || !infoHash) return;

                // Get size (4th child/span)
                const size = row.find('span:nth-child(4)').text().trim();

                // Get seeders (5th child/span or .see)
                const seeders = parseInt(row.find('span:nth-child(5)').text().trim(), 10) || 0;

                // Get leechers (6th child/span or .lee)
                const leechers = parseInt(row.find('span:nth-child(6)').text().trim(), 10) || 0;

                // Get upload date (3rd child/span)
                const uploadDate = row.find('span:nth-child(3)').text().trim();

                results.push({
                    title: title,
                    desc: titleLink.attr('href') || '',
                    infoHash: infoHash,
                    seeds: seeders,
                    peers: leechers,
                    size: size,
                    time: uploadDate,
                    provider: 'OtherDirect'
                });
            });

            if (limit && limit > 0) {
                return results.slice(0, limit);
            }

        } catch (err) {
            console.error('OtherDirect Search Error:', err.message);
        }
        return results;
    },

    /**
     * Get magnet link for a torrent
     */
    getMagnet: async function (torrent) {
        // If we have the info hash, build the magnet directly
        if (torrent.infoHash) {
            return this.buildMagnetLink(torrent.infoHash, torrent.title);
        }

        // Fallback: fetch the details page
        if (!torrent.desc) return null;

        const url = torrent.desc.startsWith('http')
            ? torrent.desc
            : `${this.baseUrl}${torrent.desc}`;

        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            const html = await res.text();
            const $ = cheerio.load(html);
            const magnet = $('a[href^="magnet:"]').attr('href');
            return magnet || null;
        } catch (e) {
            console.error('OtherDirect getMagnet error:', e.message);
            return null;
        }
    }
};

export default OtherDirect;
