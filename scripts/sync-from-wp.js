const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const CONFIG = {
    // Default to localhost for testing if env not set
    WP_API_BASE: process.env.WP_API_URL || 'http://localhost/wp-json/viethoa/v1',
    WP_API_KEY: process.env.WP_API_KEY || 'test_key',
    OUTPUT_DIR: path.join(__dirname, '../api'),
};

console.log(`[Sync] Configured for: ${CONFIG.WP_API_BASE}`);

/**
 * Fetch JSON from URL
 */
async function fetchJSON(endpoint) {
    return new Promise((resolve, reject) => {
        const url = `${CONFIG.WP_API_BASE}${endpoint}`;
        console.log(`[Sync] Fetching: ${url}`);

        const options = {
            headers: {
                'Authorization': `Bearer ${CONFIG.WP_API_KEY}`,
                'User-Agent': 'MVH-Sync/1.0'
            },
            rejectUnauthorized: false // Allow self-signed certs for localhost testing
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    return reject(new Error(`API Error ${res.statusCode}: ${data}`));
                }
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    console.error(`[Sync] Invalid JSON: ${data.substring(0, 100)}...`);
                    reject(new Error(`Invalid JSON from ${endpoint}`));
                }
            });
        }).on('error', (err) => {
            console.error(`[Sync] Network Error: ${err.message}`);
            reject(err);
        });
    });
}

async function main() {
    console.log('[Sync] Starting...');

    // Ensure output directories exist
    if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
        fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
    }
    const appsDir = path.join(CONFIG.OUTPUT_DIR, 'apps');
    if (!fs.existsSync(appsDir)) {
        fs.mkdirSync(appsDir, { recursive: true });
    }

    try {
        // 1. Fetch all apps from WP
        console.log('[Sync] Requesting /apps...');
        const apps = await fetchJSON('/apps');

        if (!Array.isArray(apps)) {
            throw new Error('Response from /apps is not an array');
        }

        // 2. Generate index.json
        const index = {
            $schema: 'index',
            version: '1.0.0',
            generated_at: new Date().toISOString(),
            total_apps: apps.length,
            apps: apps.map(a => ({
                id: a.app_id,
                name: a.name,
                updated: a.updated_at
            }))
        };

        fs.writeFileSync(
            path.join(CONFIG.OUTPUT_DIR, 'index.json'),
            JSON.stringify(index, null, 2)
        );
        console.log(`[Sync] Written index.json (${apps.length} apps)`);

        // 3. Generate per-app JSON
        for (const app of apps) {
            console.log(`[Sync] Processing App ${app.app_id} (${app.name})...`);

            try {
                // Delay slightly to avoid hammering the server locally
                await new Promise(r => setTimeout(r, 100));

                const detail = await fetchJSON(`/apps/${app.app_id}`);

                const appJson = {
                    $schema: 'app',
                    id: detail.app_id,
                    name: detail.name,
                    vietnamese_name: detail.vietnamese_name,
                    status: detail.status || 'unknown',
                    version: detail.version || '1.0.0',
                    updated_at: detail.updated_at,
                    download: {
                        url: detail.download_url || '',
                        size_bytes: detail.file_size || 0,
                        sha256: detail.file_hash || '',
                        mirrors: detail.mirrors || []
                    },
                    compatibility: detail.compatibility || {},
                    metadata: {
                        translator: detail.translator || 'MVH',
                        progress_percent: detail.progress || 0,
                        word_count: detail.word_count || 0
                    }
                };

                fs.writeFileSync(
                    path.join(appsDir, `${app.app_id}.json`),
                    JSON.stringify(appJson, null, 2)
                );
            } catch (err) {
                console.error(`[Sync] Failed to sync App ${app.app_id}:`, err.message);
                // Continue to next app
            }
        }

        console.log('[Sync] Complete!');
    } catch (err) {
        console.error('[Sync] Fatal Error:', err);
        process.exit(1);
    }
}

main();
