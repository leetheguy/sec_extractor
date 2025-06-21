// api_fetcher.js

const fs = require('fs').promises;
const path = require('path');
const config = require('./config');

// --- Internal Helper Functions ---

/**
 * Implements a simple delay.
 * @param {number} ms - The delay in milliseconds.
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Makes an HTTP GET request to the SEC EDGAR API.
 * Includes User-Agent header and basic error handling.
 * @param {string} url - The URL to fetch.
 * @param {number} [requestDelayMs=config.api.requestDelayMs || 100] - The delay in milliseconds before making the request.
 * @returns {Promise<Object>} - The parsed JSON response.
 * @throws {Error} If the network request fails or the response is not OK.
 */
async function _fetchData(url, requestDelayMs = config.api.requestDelayMs || 100) {
    const headers = {
        'User-Agent': config.api.userAgent // e.g., 'YourAppName/1.0 (your.email@example.com)'
    };

    try {
        // Implement a small delay before each request to respect rate limits
        await delay(requestDelayMs);

        // Use the native global fetch function
        const response = await fetch(url, { headers });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status}, URL: ${url}, Response: ${errorText}`);
        }

        return await response.json();
    } catch (error) {
        console.error(`Failed to fetch data from ${url}:`, error.message);
        throw error; // Re-throw to allow calling function to handle
    }
}

/**
 * Saves JSON data to a file.
 * @param {string} filename - The name of the file (e.g., 'company_tickers.json', '320193.json').
 * @param {Object} data - The JSON object to save.
 */
async function _saveJsonToFile(filename, data) {
    const filePath = path.join(config.paths.json, filename);
    try {
        await fs.mkdir(config.paths.json, { recursive: true }); // Ensure directory exists
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
        console.log(`Saved ${filename} to ${config.paths.json}`);
    } catch (error) {
        console.error(`Failed to save ${filename} to ${filePath}:`, error.message);
        throw error;
    }
}

// --- Public API Fetcher Functions ---

/**
 * Fetches the company_tickers.json file from SEC EDGAR.
 * Saves it locally and returns the parsed JSON.
 * @returns {Promise<Object>} - Parsed JSON content of company_tickers.json.
 */
async function fetchCompanyTickers() {
    const url = config.api.companyTickersUrl;
    const filename = 'company_tickers.json';
    console.log(`Fetching company tickers from: ${url}`);

    try {
        const data = await _fetchData(url); // Uses default delay
        await _saveJsonToFile(filename, data); // Still save the tickers file
        return data;
    } catch (error) {
        console.error(`Error fetching company tickers:`, error);
        throw error;
    }
}

/**
 * Fetches company facts data for a given CIK from SEC EDGAR.
 * Saves it locally and returns the parsed JSON.
 * @param {string|number} cik - The Central Index Key of the company.
 * @returns {Promise<Object>} - Parsed JSON content of the company facts.
 */
async function fetchCompanyFacts(cik) {
    const cikStr = String(cik).padStart(10, '0'); // Ensure CIK is 10 digits padded with leading zeros
    const url = config.api.companyFactsUrl.replace('{cik}', cikStr);
    const filename = `${cikStr}.json`;
    console.log(`Fetching company facts for CIK ${cik} from: ${url}`);

    try {
        const data = await _fetchData(url); // Uses default delay
        await _saveJsonToFile(filename, data);
        return data;
    } catch (error) {
        console.error(`Error fetching company facts for CIK ${cik}:`, error);
        throw error;
    }
}

module.exports = {
    fetchCompanyTickers,
    fetchCompanyFacts,
};
