// data_processor.js

const fs = require('fs').promises; // Using promises for async file operations
const path = require('path');
const dbOperations = require('./data_operations'); // Our database operations module
const config = require('./config'); // For paths like JSON storage

// --- Helper Functions for JSON Traversal and Data Extraction ---

/**
 * Extracts the CIK from the company facts JSON.
 * @param {Object} companyFactsJson - Parsed JSON object of company facts.
 * @returns {number} - The CIK.
 */
function getCikFromJson(companyFactsJson) {
    return parseInt(companyFactsJson.cik, 10);
}

/**
 * Extracts company information from the JSON.
 * @param {Object} companyFactsJson - Parsed JSON object of company facts.
 * @param {string} ticker - The ticker symbol associated with this CIK (might be passed in).
 * @returns {Object} - A Company object.
 */
function extractCompanyData(companyFactsJson, ticker) {
    return {
        cik: getCikFromJson(companyFactsJson),
        entity_name: companyFactsJson.entityName,
        ticker: ticker, // This will need to be passed in or looked up
        title: companyFactsJson.sicDescription || companyFactsJson.entityName // Prefer SIC description if available
    };
}

/**
 * Internal helper to process terms for a specific taxonomy type (e.g., 'us-gaap', 'dei').
 * @param {Object} factsSection - The 'facts' section of the companyFactsJson.
 * @param {string} taxonomyType - The type of taxonomy to process (e.g., 'us-gaap', 'dei').
 * @param {Map<string, Object>} termsMap - The map to store unique TaxonomyTerm objects.
 */
function _processTaxonomyType(factsSection, taxonomyType, termsMap) {
    if (factsSection && factsSection[taxonomyType]) {
        for (const termName in factsSection[taxonomyType]) {
            const termData = factsSection[taxonomyType][termName];
            if (!termsMap.has(termName)) {
                termsMap.set(termName, {
                    term_name: termName,
                    description: termData.label,
                    parent_taxonomy_id: null, // To be determined by a separate mapping or logic
                    broad_category_taxonomy_id: null, // To be determined by a separate mapping or logic
                    is_broad_category: false, // Default to false, can be updated later
                    taxonomy_source: taxonomyType.toUpperCase() // Use uppercase for consistency
                });
            }
        }
    }
}

/**
 * Extracts unique taxonomy terms from the JSON.
 * @param {Object} companyFactsJson - Parsed JSON object of company facts.
 * @returns {Array<Object>} - An array of unique TaxonomyTerm objects.
 */
function extractTaxonomyTerms(companyFactsJson) {
    const terms = new Map(); // Use a Map to ensure uniqueness by term_name

    // Process US-GAAP terms
    _processTaxonomyType(companyFactsJson.facts, 'us-gaap', terms);

    // Process DEI terms
    _processTaxonomyType(companyFactsJson.facts, 'dei', terms);

    // TODO: Implement logic here or in a separate utility to assign parent_taxonomy_id and broad_category_taxonomy_id
    // This might involve a predefined mapping or a more sophisticated taxonomy parsing.
    // For now, they are null, and will be handled by the initial_setup.js for broad categories,
    // and potentially a future enhancement for finer-grained parent relationships.

    return Array.from(terms.values());
}

/**
 * Extracts unique financial periods from the JSON.
 * @param {Object} companyFactsJson - Parsed JSON object of company facts.
 * @returns {Array<Object>} - An array of unique FinancialPeriod objects.
 */
function extractFinancialPeriods(companyFactsJson) {
    const periods = new Map(); // Use a Map to ensure uniqueness by a composite key

    const addPeriod = (fy, fp, end, form) => {
        if (!fy || !end) return;

        const isAnnual = form && form.includes('10-K');

        let quarterValue = null; // Initialize to null
        if (!isAnnual && fp) {
            // Attempt to parse quarter from fp
            const fpString = String(fp); // Ensure fp is treated as a string for matching
            const quarterMatch = fpString.match(/Q(\d)/); // Matches "Q1", "Q2", etc.
            if (quarterMatch && quarterMatch[1]) {
                quarterValue = parseInt(quarterMatch[1], 10); // Extract the number (1-4)
            } else if (!isNaN(parseInt(fpString, 10))) { // Check if fp is already a number string (e.g., "1", "2")
                quarterValue = parseInt(fpString, 10);
            }
            // If it's not annual, and fp is not a valid "Qx" string or a number string,
            // quarterValue remains null, which is acceptable for the INTEGER column.
        }

        // Create a unique key for the map
        const periodKey = `${fy}-${quarterValue || 'null'}-${end}-${isAnnual}`;

        if (!periods.has(periodKey)) {
            periods.set(periodKey, {
                year: fy,
                quarter: quarterValue, // Use the correctly parsed integer or null
                period_end_date: new Date(end),
                is_annual: isAnnual
            });
        }
    };

    if (companyFactsJson.facts) {
        for (const taxonomyType in companyFactsJson.facts) { // e.g., 'us-gaap', 'dei'
            for (const termName in companyFactsJson.facts[taxonomyType]) {
                const termData = companyFactsJson.facts[taxonomyType][termName];
                if (termData.units) {
                    for (const unitType in termData.units) { // e.g., 'USD', 'shares'
                        for (const fact of termData.units[unitType]) {
                            addPeriod(fact.fy, fact.fp, fact.end, fact.form);
                        }
                    }
                }
            }
        }
    }

    return Array.from(periods.values());
}

/**
 * Extracts financial facts from the JSON.
 * This function requires the taxonomyTermMap and financialPeriodMap to link facts to their IDs.
 * @param {Object} companyFactsJson - Parsed JSON object of company facts.
 * @param {Map<string, number>} taxonomyTermMap - Map of term_name to taxonomy_id.
 * @param {Map<string, number>} financialPeriodMap - Map of periodKey to period_id.
 * @returns {Array<Object>} - An array of FinancialFact objects.
 */
function extractFinancialFacts(companyFactsJson, taxonomyTermMap, financialPeriodMap) {
    const facts = [];
    const cik = getCikFromJson(companyFactsJson);

    if (companyFactsJson.facts) {
        for (const taxonomyType in companyFactsJson.facts) { // e.g., 'us-gaap', 'dei'
            for (const termName in companyFactsJson.facts[taxonomyType]) {
                const termData = companyFactsJson.facts[taxonomyType][termName];
                const taxonomyId = taxonomyTermMap.get(termName); // Get the ID for this term

                if (!taxonomyId) {
                    console.warn(`Taxonomy term '${termName}' not found in map. Skipping facts for this term.`);
                    continue;
                }

                if (termData.units) {
                    for (const unitType in termData.units) { // e.g., 'USD', 'shares'
                        for (let i = 0; i < termData.units[unitType].length; i++) {
                            const fact = termData.units[unitType][i];

                            // --- IMPORTANT FIX START ---
                            // Skip facts if fiscal year or period end date are missing,
                            // as these periods would not have been added to the map in extractFinancialPeriods.
                            if (!fact.fy || !fact.end) {
                                console.warn(`Fact for term '${termName}' missing fiscal year or period end date. Skipping fact.`);
                                continue;
                            }
                            // --- IMPORTANT FIX END ---

                            const isAnnualFact = fact.form && fact.form.includes('10-K');
                            let quarterValueFact = null;

                            // Apply the same quarter parsing logic as in extractFinancialPeriods
                            if (!isAnnualFact && fact.fp) {
                                const fpStringFact = String(fact.fp);
                                const quarterMatchFact = fpStringFact.match(/Q(\d)/);
                                if (quarterMatchFact && quarterMatchFact[1]) {
                                    quarterValueFact = parseInt(quarterMatchFact[1], 10);
                                } else if (!isNaN(parseInt(fpStringFact, 10))) {
                                    quarterValueFact = parseInt(fpStringFact, 10);
                                }
                            }

                            // periodEndDateFormatted is already YYYY-MM-DD from JSON
                            const periodEndDateFormatted = fact.end;

                            const periodKey = `${fact.fy}-${quarterValueFact || 'null'}-${periodEndDateFormatted}-${isAnnualFact}`;
                            const periodId = financialPeriodMap.get(periodKey);

                            if (!periodId) {
                                console.warn(`Financial period '${periodKey}' not found in map. Skipping fact.`);
                                continue;
                            }

                            facts.push({
                                cik: cik,
                                taxonomy_id: taxonomyId,
                                period_id: periodId,
                                value: fact.val,
                                unit: unitType,
                                form_type: fact.form,
                                filing_date: new Date(fact.filed),
                                frame: fact.frame || null,
                                source_json_path: `${taxonomyType}.${termName}.units.${unitType}[${i}]`
                            });
                        }
                    }
                }
            }
        }
    }
    return facts;
}

// function extractFinancialFacts(companyFactsJson, taxonomyTermMap, financialPeriodMap) {
//     const facts = [];
//     const cik = getCikFromJson(companyFactsJson);

//     if (companyFactsJson.facts) {
//         for (const taxonomyType in companyFactsJson.facts) { // e.g., 'us-gaap', 'dei'
//             for (const termName in companyFactsJson.facts[taxonomyType]) {
//                 const termData = companyFactsJson.facts[taxonomyType][termName];
//                 const taxonomyId = taxonomyTermMap.get(termName); // Get the ID for this term

//                 if (!taxonomyId) {
//                     console.warn(`Taxonomy term '${termName}' not found in map. Skipping facts for this term.`);
//                     continue;
//                 }

//                 if (termData.units) {
//                     for (const unitType in termData.units) { // e.g., 'USD', 'shares'
//                         for (let i = 0; i < termData.units[unitType].length; i++) {
//                             const fact = termData.units[unitType][i];

//                             const isAnnualFact = fact.form && fact.form.includes('10-K'); // Renamed for clarity
//                             let quarterValueFact = null; // Initialize for this fact

//                             // Apply the same quarter parsing logic as in extractFinancialPeriods
//                             if (!isAnnualFact && fact.fp) {
//                                 const fpStringFact = String(fact.fp);
//                                 const quarterMatchFact = fpStringFact.match(/Q(\d)/);
//                                 if (quarterMatchFact && quarterMatchFact[1]) {
//                                     quarterValueFact = parseInt(quarterMatchFact[1], 10);
//                                 } else if (!isNaN(parseInt(fpStringFact, 10))) {
//                                     quarterValueFact = parseInt(fpStringFact, 10);
//                                 }
//                             }

//                             // Ensure period_end_date is consistently formatted as YYYY-MM-DD
//                             // fact.end from SEC JSON is typically already YYYY-MM-DD
//                             const periodEndDateFormatted = fact.end;

//                             const periodKey = `${fact.fy}-${quarterValueFact || 'null'}-${periodEndDateFormatted}-${isAnnualFact}`;
//                             const periodId = financialPeriodMap.get(periodKey); // Get the ID for this period

//                             if (!periodId) {
//                                 console.warn(`Financial period '${periodKey}' not found in map. Skipping fact.`);
//                                 continue;
//                             }

//                             facts.push({
//                                 cik: cik,
//                                 taxonomy_id: taxonomyId,
//                                 period_id: periodId,
//                                 value: fact.val,
//                                 unit: unitType,
//                                 form_type: fact.form,
//                                 filing_date: new Date(fact.filed),
//                                 frame: fact.frame || null, // Frame is optional
//                                 source_json_path: `${taxonomyType}.${termName}.units.${unitType}[${i}]` // For auditing
//                             });
//                         }
//                     }
//                 }
//             }
//         }
//     }
//     return facts;
// }

// function extractFinancialFacts(companyFactsJson, taxonomyTermMap, financialPeriodMap) {
//     const facts = [];
//     const cik = getCikFromJson(companyFactsJson);

//     if (companyFactsJson.facts) {
//         for (const taxonomyType in companyFactsJson.facts) { // e.g., 'us-gaap', 'dei'
//             for (const termName in companyFactsJson.facts[taxonomyType]) {
//                 const termData = companyFactsJson.facts[taxonomyType][termName];
//                 const taxonomyId = taxonomyTermMap.get(termName); // Get the ID for this term

//                 if (!taxonomyId) {
//                     console.warn(`Taxonomy term '${termName}' not found in map. Skipping facts for this term.`);
//                     continue;
//                 }

//                 if (termData.units) {
//                     for (const unitType in termData.units) { // e.g., 'USD', 'shares'
//                         for (let i = 0; i < termData.units[unitType].length; i++) {
//                             const fact = termData.units[unitType][i];

//                             const isAnnual = fact.form && fact.form.includes('10-K');
//                             const quarter = isAnnual ? null : fact.fp;
//                             const periodKey = `${fact.fy}-${quarter || 'null'}-${fact.end}-${isAnnual}`;
//                             const periodId = financialPeriodMap.get(periodKey); // Get the ID for this period

//                             if (!periodId) {
//                                 console.warn(`Financial period '${periodKey}' not found in map. Skipping fact.`);
//                                 continue;
//                             }

//                             facts.push({
//                                 cik: cik,
//                                 taxonomy_id: taxonomyId,
//                                 period_id: periodId,
//                                 value: fact.val,
//                                 unit: unitType,
//                                 form_type: fact.form,
//                                 filing_date: new Date(fact.filed),
//                                 frame: fact.frame || null, // Frame is optional
//                                 source_json_path: `${taxonomyType}.${termName}.units.${unitType}[${i}]` // For auditing
//                             });
//                         }
//                     }
//                 }
//             }
//         }
//     }
//     return facts;
// }

// --- Main Processing Function ---

/**
 * Processes a company's facts JSON data, extracts relevant information,
 * and orchestrates the batch insertion into the database.
 * @param {string} cik - The Central Index Key of the company.
 * @param {string} ticker - The ticker symbol of the company.
 * @param {Object} companyFactsJson - The parsed JSON object of the company's facts.
 */
async function processCompanyFactsData(cik, ticker, companyFactsJson) {
    console.log(`Starting data processing for CIK: ${cik}, Ticker: ${ticker}`);

    try {
        // 1. Extract and upsert Company data
        const companyData = extractCompanyData(companyFactsJson, ticker);
        await dbOperations.batchUpsertCompanies([companyData]);

        // 2. Extract and upsert Taxonomy Terms
        const rawTaxonomyTerms = extractTaxonomyTerms(companyFactsJson);
        // This step returns a map of term_name to taxonomy_id, which is crucial for facts
        const taxonomyTermMap = await dbOperations.batchUpsertTaxonomyTerms(rawTaxonomyTerms);

        // 3. Extract and upsert Financial Periods
        const rawFinancialPeriods = extractFinancialPeriods(companyFactsJson);
        // This step returns a map of periodKey to period_id, crucial for facts
        const financialPeriodMap = await dbOperations.batchUpsertFinancialPeriods(rawFinancialPeriods);

        // 4. Extract and insert Financial Facts
        // This step depends on the IDs obtained from the previous two steps
        const financialFacts = extractFinancialFacts(companyFactsJson, taxonomyTermMap, financialPeriodMap);
        await dbOperations.batchInsertFinancialFacts(financialFacts);

        console.log(`Successfully processed and inserted data for CIK: ${cik}, Ticker: ${ticker}`);

    } catch (error) {
        console.error(`Error processing data for CIK ${cik}, Ticker ${ticker}:`, error);
        throw error; // Re-throw to allow main.js to handle
    }
}

module.exports = {
    processCompanyFactsData,
    // Export helper functions for testing if needed, but not strictly part of public API
    // getCikFromJson,
    // extractCompanyData,
    // extractTaxonomyTerms,
    // extractFinancialPeriods,
    // extractFinancialFacts,
};
