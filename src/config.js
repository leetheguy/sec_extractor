// config.js

const path = require('path');

module.exports = {
    db: {
        user: process.env.DB_USER,// || 'postgres',
        host: process.env.DB_HOST,// || 'localhost',
        database: process.env.DB_NAME,// || 'sec_edgar_db',
        password: process.env.DB_PASSWORD,// || 'postgres',
        port: process.env.DB_PORT,// || 5432,
        ssl: {
            rejectUnauthorized: false // This allows self-signed certificates for development
        }
    },
    api: {
        // IMPORTANT: Replace with your actual app name and email
        // SEC EDGAR API requires a descriptive User-Agent header.
        // Format: YourAppName/Version (your.email@example.com)
        userAgent: 'SECEdgarExtractor/1.0 (lee@cetechsystems.com)',
        companyTickersUrl: 'https://www.sec.gov/files/company_tickers.json',
        companyFactsUrl: 'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json',
        requestDelayMs: 100 // Delay between API requests in milliseconds (100ms = 10 requests/sec )
    },
    paths: {
        // Using path.join(__dirname, '..', 'data', 'json') ensures cross-platform compatibility
        // and correctly points to the 'data/json' directory relative to the 'src' directory.
        json: path.join(__dirname, '..', 'data', 'json'),
        sql: path.join(__dirname, '..', 'data', 'sql'),
    },
    // Add other configuration settings here as needed
};
