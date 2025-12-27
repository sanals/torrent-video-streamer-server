
import TorrentSearchApi from 'torrent-search-api';
// Import custom providers
import TorrentDownloads from './src/services/custom_providers/torrentdownloads.js';

// Configuration
const PROVIDERS = ['ThePirateBay', 'YTS', 'TorrentDownloads'];
const QUERY = 'Stranger Things';

async function verifyProviders() {
    console.log('--- Provider Verification Tool ---');

    // Register custom providers
    try {
        TorrentSearchApi.loadProvider(TorrentDownloads);
        console.log('✅ Loaded TorrentDownloads custom provider');
    } catch (e) {
        console.error('❌ Failed to load TorrentDownloads:', e.message);
    }

    for (const provider of PROVIDERS) {
        console.log(`\nTesting ${provider}...`);

        try {
            // Disable all others to isolate test
            TorrentSearchApi.disableAllProviders();
            TorrentSearchApi.enableProvider(provider);

            // Search
            const results = await TorrentSearchApi.search(QUERY, 'All', 5);

            if (results && results.length > 0) {
                console.log(`✅ ${provider}: Found ${results.length} results.`);
                console.log(`   Sample: ${results[0].title}`);

                // Test Magnet (if supported/needed)
                if (provider === 'TorrentDownloads') {
                    // TD needs explicit magnet fetch test since search results don't have it
                    console.log('   Fetching magnet for sample...');
                    const magnet = await TorrentSearchApi.getMagnet(results[0]);
                    if (magnet && magnet.startsWith('magnet:')) {
                        console.log('   ✅ Magnet fetch successful');
                    } else {
                        console.log('   ❌ Magnet fetch failed or empty');
                    }
                }
            } else {
                console.log(`⚠️  ${provider}: No results found (could be 0 matches or blocked).`);
            }
        } catch (e) {
            console.log(`❌ ${provider}: Error - ${e.message}`);
            if (e.message.includes('cloudflare') || e.message.includes('Just a moment')) {
                console.log('   (Likely Cloudflare blocked)');
            }
        }
    }
}

verifyProviders();
