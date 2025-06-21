// db_operations.js

const dbManager = require('./db_manager'); // Import the core DB manager
const BATCH_SIZE = 1000; // Configurable batch size

// --- Reusable Helper Functions for Batching (Moved from db_manager) ---

/**
 * Generates the VALUES clause for a batched INSERT statement.
 * @param {number} numRows - Number of rows to insert.
 * @param {number} numCols - Number of columns per row.
 * @param {number} startIndex - The starting index for parameter placeholders ($1, $2, ...).
 * @returns {string} - The VALUES clause string.
 * Example: generateValuesClause(2, 3, 1) => '($1, $2, $3), ($4, $5, $6)'
 */
function generateValuesClause(numRows, numCols, startIndex = 1) {
    const rows = [];
    for (let i = 0; i < numRows; i++) {
        const cols = [];
        for (let j = 0; j < numCols; j++) {
            cols.push(`$${startIndex++}`);
        }
        rows.push(`(${cols.join(', ')})`);
    }
    return rows.join(', ');
}

/**
 * Extracts all parameter values from an array of objects for a batched insert.
 * @param {Array<Object>} data - Array of objects, each representing a row.
 * @param {Array<string>} columns - Array of column names in the desired order.
 * @returns {Array<any>} - Flat array of all parameter values.
 */
function extractBatchValues(data, columns) {
    const values = [];
    for (const row of data) {
        for (const col of columns) {
            values.push(row[col]);
        }
    }
    return values;
}

// --- Atomic Insertion/Upsertion Functions (Internal, used by batchers) ---
// These are kept here because they are specific implementations used by the batch functions.

/**
 * Inserts or updates a single taxonomy term record.
 * @param {pg.Client} client - The database client (for transaction).
 * @param {Object} term - Taxonomy term data.
 * @returns {Promise<number>} - The taxonomy_id of the inserted/existing term.
 */
async function upsertTaxonomyTerm(client, term) {
    const sql = `
        INSERT INTO taxonomy_terms (term_name, description, parent_taxonomy_id, broad_category_taxonomy_id, is_broad_category, taxonomy_source)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (term_name) DO UPDATE SET
            description = EXCLUDED.description,
            parent_taxonomy_id = EXCLUDED.parent_taxonomy_id,
            broad_category_taxonomy_id = EXCLUDED.broad_category_taxonomy_id,
            is_broad_category = EXCLUDED.is_broad_category,
            taxonomy_source = EXCLUDED.taxonomy_source
        RETURNING taxonomy_id;
    `;
    const result = await client.query(sql, [
        term.term_name,
        term.description,
        term.parent_taxonomy_id,
        term.broad_category_taxonomy_id,
        term.is_broad_category,
        term.taxonomy_source
    ]);
    return result.rows[0].taxonomy_id;
}

/**
 * Inserts or retrieves a single financial period record.
 * @param {pg.Client} client - The database client (for transaction).
 * @param {Object} period - Financial period data.
 * @returns {Promise<number>} - The period_id of the inserted/existing period.
 */
async function upsertFinancialPeriod(client, period) {
    const sql = `
        INSERT INTO financial_periods (year, quarter, period_end_date, is_annual)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (year, quarter, period_end_date, is_annual) DO NOTHING
        RETURNING period_id;
    `;
    const result = await client.query(sql, [
        period.year,
        period.quarter,
        period.period_end_date,
        period.is_annual
    ]);

    if (result.rows.length > 0) {
        return result.rows[0].period_id; // Newly inserted
    } else {
        // Already exists, retrieve its ID
        const selectSql = `
            SELECT period_id FROM financial_periods
            WHERE year = $1 AND quarter = $2 AND period_end_date = $3 AND is_annual = $4;
        `;
        const selectResult = await client.query(selectSql, [
            period.year,
            period.quarter,
            period.period_end_date,
            period.is_annual
        ]);
        return selectResult.rows[0].period_id;
    }
}

// --- Batch Insertion Functions (Public Interface for db_operations) ---

/**
 * Batches and upserts company records.
 * @param {Array<Object>} companies - Array of company objects.
 */
async function batchUpsertCompanies(companies) {
    if (companies.length === 0) return;

    const client = await dbManager.beginTransaction();
    try {
        for (let i = 0; i < companies.length; i += BATCH_SIZE) {
            const batch = companies.slice(i, i + BATCH_SIZE);
            const columns = ['cik', 'entity_name', 'ticker', 'title'];
            const valuesClause = generateValuesClause(batch.length, columns.length);
            const allValues = extractBatchValues(batch, columns);

            const sql = `
                INSERT INTO companies (cik, entity_name, ticker, title)
                VALUES ${valuesClause}
                ON CONFLICT (cik) DO UPDATE SET
                    entity_name = EXCLUDED.entity_name,
                    ticker = EXCLUDED.ticker,
                    title = EXCLUDED.title;
            `;
            await client.query(sql, allValues);
        }
        await dbManager.commitTransaction(client);
        console.log(`Successfully upserted ${companies.length} company records.`);
    } catch (error) {
        await dbManager.rollbackTransaction(client);
        console.error('Error batch upserting companies:', error);
        throw error;
    }
}

/**
 * Batches and upserts taxonomy term records.
 * Returns a map of term_name to taxonomy_id for newly inserted/retrieved terms.
 * @param {Array<Object>} terms - Array of taxonomy term objects.
 * @returns {Promise<Map<string, number>>} - Map of term_name to taxonomy_id.
 */
async function batchUpsertTaxonomyTerms(terms) {
    if (terms.length === 0) return new Map();

    const termIdMap = new Map();
    const client = await dbManager.beginTransaction();
    try {
        // For taxonomy terms, we need the returned ID for each, so a simple batch INSERT...VALUES
        // with ON CONFLICT DO UPDATE RETURNING is complex.
        // Individual upserts within a transaction are reasonable for this table.
        for (const term of terms) {
            const taxonomyId = await upsertTaxonomyTerm(client, term);
            termIdMap.set(term.term_name, taxonomyId);
        }
        await dbManager.commitTransaction(client);
        console.log(`Successfully upserted ${terms.length} taxonomy term records.`);
        return termIdMap;
    } catch (error) {
        await dbManager.rollbackTransaction(client);
        console.error('Error batch upserting taxonomy terms:', error);
        throw error;
    }
}

/**
 * Batches and upserts financial period records.
 * Returns a map of a period key (e.g., '2023-Q1-2023-03-31-false') to period_id.
 * @param {Array<Object>} periods - Array of financial period objects.
 * @returns {Promise<Map<string, number>>} - Map of period key to period_id.
 */
async function batchUpsertFinancialPeriods(periods) {
    if (periods.length === 0) return new Map();

    const periodIdMap = new Map();
    const client = await dbManager.beginTransaction();
    try {
        for (const period of periods) {
            const periodId = await upsertFinancialPeriod(client, period);
            // Create a unique key for the map to retrieve period_id later
            const periodKey = `${period.year}-${period.quarter || 'null'}-${period.period_end_date.toISOString().split('T')[0]}-${period.is_annual}`;
            periodIdMap.set(periodKey, periodId);
        }
        await dbManager.commitTransaction(client);
        console.log(`Successfully upserted ${periods.length} financial period records.`);
        return periodIdMap;
    } catch (error) {
        await dbManager.rollbackTransaction(client);
        console.error('Error batch upserting financial periods:', error);
        throw error;
    }
}

/**
 * Batches and inserts financial fact records.
 * Uses ON CONFLICT DO NOTHING to avoid duplicates.
 * @param {Array<Object>} facts - Array of financial fact objects.
 */
async function batchInsertFinancialFacts(facts) {
    if (facts.length === 0) return;

    const client = await dbManager.beginTransaction();
    try {
        for (let i = 0; i < facts.length; i += BATCH_SIZE) {
            const batch = facts.slice(i, i + BATCH_SIZE);
            const columns = [
                'cik', 'taxonomy_id', 'period_id', 'value', 'unit',
                'form_type', 'filing_date', 'frame', 'source_json_path'
            ];
            const valuesClause = generateValuesClause(batch.length, columns.length);
            const allValues = extractBatchValues(batch, columns);

            const sql = `
                INSERT INTO financial_facts (cik, taxonomy_id, period_id, value, unit, form_type, filing_date, frame, source_json_path)
                VALUES ${valuesClause}
                ON CONFLICT (cik, taxonomy_id, period_id, form_type, unit) DO NOTHING;
            `;
            await client.query(sql, allValues);
        }
        await dbManager.commitTransaction(client);
        console.log(`Successfully inserted ${facts.length} financial fact records.`);
    } catch (error) {
        await dbManager.rollbackTransaction(client);
        console.error('Error batch inserting financial facts:', error);
        throw error;
    }
}

/**
 * Batches and upserts CIK-ticker mapping records.
 * @param {Array<Object>} mappings - Array of CIK-ticker mapping objects.
 */
async function batchUpsertCikTickerMappings(mappings) {
    if (mappings.length === 0) return;

    const client = await dbManager.beginTransaction();
    try {
        for (let i = 0; i < mappings.length; i += BATCH_SIZE) {
            const batch = mappings.slice(i, i + BATCH_SIZE);
            const columns = ['cik_str', 'ticker', 'title'];
            const valuesClause = generateValuesClause(batch.length, columns.length);
            const allValues = extractBatchValues(batch, columns);

            const sql = `
                INSERT INTO cik_ticker_mapping (cik_str, ticker, title)
                VALUES ${valuesClause}
                ON CONFLICT (cik_str) DO UPDATE SET
                    ticker = EXCLUDED.ticker,
                    title = EXCLUDED.title;
            `;
            await client.query(sql, allValues);
        }
        await dbManager.commitTransaction(client);
        console.log(`Successfully upserted ${mappings.length} CIK-ticker mapping records.`);
    } catch (error) {
        await dbManager.rollbackTransaction(client);
        console.error('Error batch upserting CIK-ticker mappings:', error);
        throw error;
    }
}

/**
 * Retrieves CIK by ticker from the database.
 * @param {string} ticker - The stock ticker symbol.
 * @returns {Promise<number|null>} - The CIK as a number, or null if not found.
 */
async function getCikByTicker(ticker) {
    const result = await dbManager.query('SELECT cik_str FROM cik_ticker_mapping WHERE ticker = $1', [ticker]);
    return result.rows.length > 0 ? parseInt(result.rows[0].cik_str, 10) : null;
}

module.exports = {
    batchUpsertCompanies,
    batchUpsertTaxonomyTerms,
    batchUpsertFinancialPeriods,
    batchInsertFinancialFacts,
    batchUpsertCikTickerMappings,
    getCikByTicker,
};
