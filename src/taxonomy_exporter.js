// src/taxonomy_exporter.js
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const dbManager = require('./db_manager');

/**
 * Converts a flat array of terms into a nested tree structure based on parent-child relationships.
 * @param {Array<Object>} terms - The flat list of term objects from the database.
 * @returns {Array<Object>} An array of top-level term objects, each with a 'children' array.
 */
function buildTree(terms) {
    const termMap = new Map();
    const tree = [];

    // First pass: create a map for easy lookup and initialize a children array for each term
    terms.forEach(term => {
        term.children = [];
        termMap.set(term.taxonomy_id, term);
    });

    // Second pass: link each term to its parent
    terms.forEach(term => {
        if (term.parent_taxonomy_id !== null) {
            // This is a child term, find its parent in the map
            const parent = termMap.get(term.parent_taxonomy_id);
            if (parent) {
                // Add the current term to its parent's children array
                parent.children.push(term);
            }
        } else {
            // This is a top-level (root) term
            tree.push(term);
        }
    });

    return tree;
}

/**
 * Recursively simplifies a tree of terms to include only id, name, and children.
 * @param {Array<Object>} nodes - An array of term nodes from the full tree.
 * @returns {Array<Object>} A new array of simplified nodes.
 */
function simplifyTree(nodes) {
    // Use map to transform each node in the array
    return nodes.map(node => {
        // Create the new simplified object
        const simplifiedNode = {
            id: node.taxonomy_id,
            name: node.term_name
        };

        // If the original node has children, recursively simplify them too
        if (node.children && node.children.length > 0) {
            simplifiedNode.children = simplifyTree(node.children);
        }

        return simplifiedNode;
    });
}

/**
 * Fetches all data from the taxonomy_terms table and saves it to a JSON file.
 */
async function exportTaxonomyToJson() {
    console.log('Starting taxonomy export to JSON...');

    try {
        await dbManager.connect();
        console.log('Database connection established.');

        const result = await dbManager.query('SELECT * FROM taxonomy_terms ORDER BY taxonomy_id;');
        const terms = result.rows;
        console.log(`Fetched ${terms.length} terms from the database.`);

        // --- Create and save the FULL nested tree ---
        console.log('Building full nested JSON tree...');
        const nestedTerms = buildTree(terms);
        const fullOutputPath = path.join(__dirname, '..', 'data', 'json', 'taxonomy_hierarchy_full.json');
        await fs.mkdir(path.dirname(fullOutputPath), { recursive: true });
        const fullJsonContent = JSON.stringify(nestedTerms, null, 2);
        await fs.writeFile(fullOutputPath, fullJsonContent, 'utf8');
        console.log(`Successfully exported full taxonomy to: ${fullOutputPath}`);

        // --- Create and save the SIMPLIFIED nested tree ---
        console.log('Building simplified nested JSON tree...');
        const simplifiedTerms = simplifyTree(nestedTerms);
        const simpleOutputPath = path.join(__dirname, '..', 'data', 'json', 'taxonomy_hierarchy_simple.json');
        const simpleJsonContent = JSON.stringify(simplifiedTerms, null, 2);
        await fs.writeFile(simpleOutputPath, simpleJsonContent, 'utf8');
        console.log(`Successfully exported simplified taxonomy to: ${simpleOutputPath}`);

    } catch (error) {
        console.error('An error occurred during the export:', error);
    } finally {
        await dbManager.disconnect();
        console.log('Database connection closed.');
    }
}

exportTaxonomyToJson();

