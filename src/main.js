// main.js

// Load environment variables from .env file
require('dotenv').config();

const yargs = require('yargs');
const dbManager = require('./db_manager');
const dbOperations = require('./data_operations');
const apiFetcher = require('./api_fetcher');
const dataProcessor = require('./data_processor');
const initialSetup = require('./initial_setup');
const config = require('./config');
const sqlLogger = require('./sql_logger');

// Define command-line arguments
// Store the yargs builder instance
const yargsBuilder = yargs()
    .option('ticker', {
        alias: 't',
        description: 'Stock ticker symbol of the company to process (e.g., AAPL)',
        type: 'string',
    })
    .option('setup', {
        alias: 's',
        description: 'Perform initial setup tasks (e.g., populate CIK-ticker mapping)',
        type: 'boolean',
        default: false,
    })
    .help()
    .alias('h', 'help');

// Explicitly parse process.argv.slice(2)
const argv = yargsBuilder.parse(process.argv.slice(2));

// console.log('Parsed arguments:', argv);

/**
 * Main function to run the SEC EDGAR data extraction process.
 */
async function main() {
    let dbConnected = false;
    try {
        // Initialize SQL logger based on whether it's a setup or ticker run
        const logIdentifier = argv.setup ? 'setup' : (argv.ticker ? argv.ticker.toUpperCase() : 'general');
        await sqlLogger.init(logIdentifier);

        // 1. Connect to the database
        await dbManager.connect();
        dbConnected = true;
        console.log('Database connection established.');

        // 2. Perform initial setup if requested
        if (argv.setup) {
            console.log('Starting initial setup...');
            await initialSetup.run();
            console.log('Initial setup completed.');
            // If only setup was requested, exit after setup
            if (!argv.ticker) {
                console.log('Setup complete. Exiting.');
                return;
            }
        }

        // 3. Process data for a specific ticker if provided
        if (argv.ticker) {
            const ticker = argv.ticker.toUpperCase();
            console.log(`Processing data for ticker: ${ticker}`);

            // Get CIK from the database
            const cik = await dbOperations.getCikByTicker(ticker);
            if (!cik) {
                console.error(`Error: CIK not found for ticker "${ticker}". Please ensure initial setup has been run or the ticker exists.`);
                return;
            }
            console.log(`Found CIK ${cik} for ticker ${ticker}.`);

            // Fetch company facts JSON
            const companyFactsJson = await apiFetcher.fetchCompanyFacts(cik);
            if (!companyFactsJson) {
                console.error(`Error: Could not fetch company facts for CIK ${cik}.`);
                return;
            }
            console.log(`Fetched company facts for CIK ${cik}.`);

            // Process and insert data into the database
            await dataProcessor.processCompanyFactsData(cik, ticker, companyFactsJson);
            console.log(`Data processing and insertion complete for ticker: ${ticker}.`);

        } else if (!argv.setup) {
            // If no ticker and no setup flag, show usage
            console.log('No ticker provided. Use --ticker <SYMBOL> to process data or --setup for initial setup.');
            yargsBuilder.showHelp();
        }

    } catch (error) {
        console.error('An unhandled error occurred during the process:', error);
    } finally {
        // 4. Disconnect from the database
        if (dbConnected) {
            await dbManager.disconnect();
            console.log('Database connection closed.');
        }
        // Finalize SQL logger
        await sqlLogger.finalize();
    }
}

// Execute the main function
main();
