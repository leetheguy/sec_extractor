// src/initial_setup.js

const apiFetcher = require('./api_fetcher');
const dbOperations = require('./data_operations');
const config = require('./config'); // For paths if needed

/**
 * Populates the cik_ticker_mapping table from the SEC's company_tickers.json.
 */
async function populateCikTickerMapping() {
    console.log('Populating CIK-ticker mapping...');
    try {
        const tickersData = await apiFetcher.fetchCompanyTickers();
        const mappings = [];
        // The company_tickers.json is an object where keys are CIKs (e.g., "CIK0000320193")
        // and values are objects like { "cik_str": "320193", "ticker": "AAPL", "title": "Apple Inc." }
        for (const cikKey in tickersData) {
            const data = tickersData[cikKey];
            mappings.push({
                cik_str: data.cik_str,
                ticker: data.ticker,
                title: data.title
            });
        }
        await dbOperations.batchUpsertCikTickerMappings(mappings);
        console.log(`Successfully populated ${mappings.length} CIK-ticker mappings.`);
    } catch (error) {
        console.error('Error populating CIK-ticker mapping:', error);
        throw error;
    }
}

/**
 * Inserts predefined broad category terms into the taxonomy_terms table.
 * These are the ones already in your create_sec_edgar_db.sql.
 */
async function populateBroadCategories() {
    console.log('Populating broad taxonomy categories...');
    const broadCategories = [
        { term_name: 'Assets', description: 'Total assets of the entity.', parent_taxonomy_id: null, broad_category_taxonomy_id: null, is_broad_category: true, taxonomy_source: 'SYSTEM_DEFINED' },
        { term_name: 'Liabilities', description: 'Total liabilities of the entity.', parent_taxonomy_id: null, broad_category_taxonomy_id: null, is_broad_category: true, taxonomy_source: 'SYSTEM_DEFINED' },
        { term_name: 'Equity', description: 'Total equity of the entity.', parent_taxonomy_id: null, broad_category_taxonomy_id: null, is_broad_category: true, taxonomy_source: 'SYSTEM_DEFINED' },
        { term_name: 'Revenues', description: 'Total revenues of the entity.', parent_taxonomy_id: null, broad_category_taxonomy_id: null, is_broad_category: true, taxonomy_source: 'SYSTEM_DEFINED' },
        { term_name: 'Expenses', description: 'Total expenses of the entity.', parent_taxonomy_id: null, broad_category_taxonomy_id: null, is_broad_category: true, taxonomy_source: 'SYSTEM_DEFINED' },
        { term_name: 'CashFlow', description: 'Cash flow related items.', parent_taxonomy_id: null, broad_category_taxonomy_id: null, is_broad_category: true, taxonomy_source: 'SYSTEM_DEFINED' },
        { term_name: 'Other', description: 'Other financial items not categorized elsewhere.', parent_taxonomy_id: null, broad_category_taxonomy_id: null, is_broad_category: true, taxonomy_source: 'SYSTEM_DEFINED' },
    ];
    try {
        await dbOperations.batchUpsertTaxonomyTerms(broadCategories);
        console.log(`Successfully populated ${broadCategories.length} broad taxonomy categories.`);
    } catch (error) {
        console.error('Error populating broad categories:', error);
        throw error;
    }
}

/**
 * Runs all initial setup tasks.
 */
async function run() {
    await populateCikTickerMapping();
    await populateBroadCategories();
    // Add any other initial setup tasks here
}

module.exports = {
    run,
    populateCikTickerMapping, // Export for potential individual use/testing
    populateBroadCategories,  // Export for potential individual use/testing
};
