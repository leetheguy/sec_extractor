// src/taxonomy_importer.js
require('dotenv').config();

const presentationFiles = [
    'us-gaap-2025/stm/us-gaap-stm-com-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-scf-dbo-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-scf-dir-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-scf-indira-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-scf-indir-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-scf-inv-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-scf-re-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-scf-sbo-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-scf-sd-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-sfp-clreo-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-sfp-cls-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-sfp-dbo-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-sfp-ibo-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-sfp-sbo-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-sfp-ucreo-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-sheci-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-soc-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-soi-egm-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-soi-indira-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-soi-ins-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-soi-int-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-soi-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-soi-reit-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-soi-re-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-soi-sbi-pre-2025.xml',
    'us-gaap-2025/stm/us-gaap-stm-spc-pre-2025.xml'
];

const fs = require('fs').promises;
const path = require('path');
const { Parser } = require('xml2js');
const dbManager = require('./db_manager');
const util = require('util');


// Define paths to the taxonomy files
const basePath = path.join(__dirname, '..', 'us-gaap-2025');
const schemaFilePath = path.join(basePath, 'entire', 'us-gaap-entryPoint-all-2025.xsd');
const presentationFilePath = path.join(basePath, 'elts', 'us-gaap-depcon-pre-2025.xml');

/**
 * Recursively finds all files in a directory that end with a specific suffix.
 * @param {string} dirPath - The directory to start searching from.
 * @param {string} suffix - The file suffix to match (e.g., '_pre.xml').
 * @returns {Promise<string[]>} A flattened array of full file paths.
 */
async function findFilesBySuffix(dirPath, suffix) {
    const dirents = await fs.readdir(dirPath, { withFileTypes: true });
    const filePromises = dirents.map((dirent) => {
        const res = path.resolve(dirPath, dirent.name);
        if (dirent.isDirectory()) {
            return findFilesBySuffix(res, suffix);
        } else {
            return res.endsWith(suffix) ? res : null;
        }
    });
    const nestedFiles = await Promise.all(filePromises);
    // Flatten the array and remove nulls
    return nestedFiles.flat().filter(file => file);
}

/**
 * Main function to import the US-GAAP taxonomy into the database.
 */
async function importTaxonomy() {
    console.log('Starting US-GAAP Taxonomy Import...');

    try {
        await dbManager.connect();
        console.log('Database connection established.');

        const parser = new Parser();
        console.log('XML parser initialized.');

        const terms = await processAllSchemas(parser, schemaFilePath);

        const allLocators = [];
        const allArcs = [];
        console.log(`Found ${presentationFiles.length} presentation files to process...`);

        for (const presFile of presentationFiles) {
            const presPath = path.join(__dirname, '..', presFile);
            const presentationFileContent = await fs.readFile(presPath, 'utf8');
            const parsedPresentation = await parser.parseStringPromise(presentationFileContent);
            
            // THE ONLY CHANGE IS ON THIS LINE: Using the correct root key.
            const presentationLinks = parsedPresentation?.['link:linkbase']?.['link:presentationLink'] || [];

            for (const link of presentationLinks) {
                if (link['link:loc']) {
                    allLocators.push(...link['link:loc']);
                }
                if (link['link:presentationArc']) {
                    allArcs.push(...link['link:presentationArc']);
                }
            }
        }

        buildHierarchy(allLocators, allArcs, terms);

        await populateDatabase(terms);

        console.log('Taxonomy import completed successfully!');

    } catch (error) {
        console.error('An error occurred during the taxonomy import:', error);
    } finally {
        await dbManager.disconnect();
        console.log('Database connection closed.');
    }
}

/**
 * Kicks off the recursive parsing of all schema files starting from the entry point.
 * @param {object} parser - The xml2js parser instance.
 * @param {string} entryPointPath - The full path to the main entry point .xsd file.
 * @returns {Promise<Map<string, object>>} A map of all extracted terms.
 */
async function processAllSchemas(parser, entryPointPath) {
    const termsMap = new Map();
    const processedFiles = new Set(); // Tracks processed files to prevent infinite loops

    await recursiveSchemaParse(parser, entryPointPath, termsMap, processedFiles);
    
    console.log(`Extracted ${termsMap.size} terms from all schema files.`);
    return termsMap;
}

/**
 * Recursively parses schema files, extracts term definitions, and follows imports.
 * @param {object} parser - The xml2js parser instance.
 * @param {string} currentFilePath - The full path of the schema file to process.
 * @param {Map<string, object>} termsMap - The main map to add found terms to.
 * @param {Set<string>} processedFiles - A set of file paths that have already been processed.
 */
async function recursiveSchemaParse(parser, currentFilePath, termsMap, processedFiles) {
    // If we've already processed this file, stop to avoid circular loops.
    if (processedFiles.has(currentFilePath)) {
        return;
    }
    processedFiles.add(currentFilePath);

    try {
        const fileContent = await fs.readFile(currentFilePath, 'utf8');
        const parsedFile = await parser.parseStringPromise(fileContent);

        // Extract elements from the current file
        const elements = parsedFile['xs:schema']?.['xs:element'];
        if (elements && Array.isArray(elements)) {
            for (const element of elements) {
                const termName = element.$.id;
                if (termName && !termsMap.has(termName)) {
                    let description = '';
                    if (element['xs:annotation']?.[0]?.['xs:documentation']?.[0]) {
                        description = element['xs:annotation'][0]['xs:documentation'][0];
                    }
                    
                    // NEW: Extract the source from the term's prefix
                    const taxonomySource = termName.split('_')[0]?.toUpperCase() || 'UNKNOWN';

                    termsMap.set(termName, {
                        description: description,
                        parent: null,
                        source: taxonomySource // Store the source
                    });
                }
            }
        }

        // Find any new imports in this file and parse them recursively
        const importInstructions = parsedFile['xs:schema']?.['xs:import'];
        if (importInstructions && Array.isArray(importInstructions)) {
            for (const instruction of importInstructions) {
                const schemaLocation = instruction.$.schemaLocation;
                // Ignore web addresses and process local files
                if (schemaLocation && !schemaLocation.startsWith('http')) {
                    // Resolve the next file's path relative to the CURRENT file's directory
                    const nextPath = path.resolve(path.dirname(currentFilePath), schemaLocation);
                    await recursiveSchemaParse(parser, nextPath, termsMap, processedFiles);
                }
            }
        }
    } catch (err) {
        console.warn(`Could not read or parse schema: ${currentFilePath}. Skipping.`);
    }
}

/**
 * Builds the hierarchy by processing the complete list of locators and arcs.
 * @param {Array} allLocators - An array of all locator objects from all presentation files.
 * @param {Array} allArcs - An array of all arc objects from all presentation files.
 * @param {Map<string, Object>} termsMap - The map of terms to be updated.
 */
function buildHierarchy(allLocators, allArcs, termsMap) {
    const locatorMap = new Map();
    // -- DEBUG --
    console.log(`[DIAGNOSTIC] Terms extracted (from .xsd files): ${termsMap.size}`);

    // First, create a single map of all locator labels to their real term names.
    for (const loc of allLocators) {
        const label = loc.$['xlink:label'];
        const termName = loc.$['xlink:href'].split('#')[1];
        if (label && termName) {
            locatorMap.set(label, termName);
        }
    }
    // -- DEBUG --
    console.log(`[DIAGNOSTIC] Locator labels mapped (from _pre.xml files): ${locatorMap.size}`);
    
    let successfulUpdates = 0;

    // Next, process all the arcs using the complete locator map.
    for (const arc of allArcs) {
        const parentLabel = arc.$['xlink:from'];
        const childLabel = arc.$['xlink:to'];

        const parentTermName = locatorMap.get(parentLabel);
        const childTermName = locatorMap.get(childLabel);

        // Check if the term from the hierarchy exists in our master list of terms
        if (termsMap.has(childTermName)) {
            const childTermData = termsMap.get(childTermName);
            childTermData.parent = parentTermName;
            successfulUpdates++;
        }
    }

    // -- DEBUG -- This is the most important log.
    console.log(`[DIAGNOSTIC] Total relationships found: ${allArcs.length}. Successful parent links created: ${successfulUpdates}`);
    console.log('Hierarchy relationships have been built from all files.');
}

/**
 * Wipes and populates the taxonomy_terms table using batch inserts and updates.
 * @param {Map<string, Object>} termsMap - The final map of terms with parent relationships.
 */
async function populateDatabase(termsMap) {
    const client = await dbManager.beginTransaction();
    console.log('Database transaction started.');

    try {
        // Step 1: Wipe the table
        console.log('Truncating taxonomy_terms table...');
        await client.query('TRUNCATE TABLE taxonomy_terms RESTART IDENTITY CASCADE;');

        // Step 2: Batch Insert all terms
        console.log('Performing first pass: Inserting all terms in batches...');
        const BATCH_SIZE = 500;
        const allTerms = Array.from(termsMap.entries());
        for (let i = 0; i < allTerms.length; i += BATCH_SIZE) {
            const batch = allTerms.slice(i, i + BATCH_SIZE);
            const values = [];
            const placeholders = batch.map((_, index) => {
                const base = index * 3;
                const [termName, termData] = batch[index];
                values.push(termName, termData.description, termData.source);
                return `($${base + 1}, $${base + 2}, $${base + 3})`;
            }).join(',');

            const sql = `INSERT INTO taxonomy_terms (term_name, description, taxonomy_source) VALUES ${placeholders};`;
            await client.query(sql, values);
        }

        // Step 3: Fetch new IDs
        console.log('Fetching new taxonomy IDs...');
        const idResult = await client.query('SELECT taxonomy_id, term_name FROM taxonomy_terms;');
        const termIdMap = new Map(idResult.rows.map(row => [row.term_name, row.taxonomy_id]));

        // Step 4: Batch Update parent relationships
        console.log('Performing second pass: Updating parent relationships in batches...');
        const updates = [];
        for (const [termName, termData] of termsMap.entries()) {
            if (termData.parent) {
                const childId = termIdMap.get(termName);
                const parentId = termIdMap.get(termData.parent);
                if (childId && parentId) {
                    updates.push([childId, parentId]);
                }
            }
        }

        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
            const batch = updates.slice(i, i + BATCH_SIZE);
            const values = [];
            const valueClauses = batch.map((update, index) => {
                const base = index * 2;
                values.push(update[0], update[1]); // childId, parentId
                return `($${base + 1}::integer, $${base + 2}::integer)`;
            }).join(',');

            const sql = `
                UPDATE taxonomy_terms AS t
                SET parent_taxonomy_id = v.parent_id
                FROM (VALUES ${valueClauses}) AS v(child_id, parent_id)
                WHERE t.taxonomy_id = v.child_id;
            `;
            await client.query(sql, values);
        }

        await dbManager.commitTransaction(client);
        console.log('Database transaction committed successfully.');
    } catch (error) {
        await dbManager.rollbackTransaction(client);
        console.error('Database population failed. Transaction rolled back.', error);
        throw error;
    }
}

// Execute the import process
importTaxonomy();
