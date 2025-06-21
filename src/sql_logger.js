// sql_logger.js

const fs = require('fs').promises;
const path = require('path');
const config = require('./config');

let logFilePath = null;
let logBuffer = [];
const BUFFER_THRESHOLD = 100; // Write to file after 100 statements
let writePromise = Promise.resolve(); // To chain async writes

/**
 * Initializes the SQL logger, creating a new timestamped log file.
 * @param {string} identifier - An identifier for the log file (e.g., CIK or 'setup').
 */
async function init(identifier) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); // YYYY-MM-DDTHH-MM-SS-mmmZ
    const filename = `sql_log_${identifier}_${timestamp}.sql`;
    logFilePath = path.join(config.paths.sql, filename);

    try {
        await fs.mkdir(config.paths.sql, { recursive: true }); // Ensure directory exists
        // Optionally write a header to the file
        await fs.writeFile(logFilePath, `-- SQL Log for ${identifier} - ${new Date().toISOString()}\n\n`, 'utf8');
        console.log(`SQL logging initialized to: ${logFilePath}`);
    } catch (error) {
        console.error(`Failed to initialize SQL logger at ${logFilePath}:`, error.message);
        logFilePath = null; // Disable logging if init fails
    }
}

/**
 * Writes the current buffer to the log file.
 * This function is designed to be chained to ensure writes happen in order.
 */
async function _flushBuffer() {
    if (logBuffer.length === 0 || !logFilePath) {
        return;
    }

    const statementsToFlush = logBuffer.join('\n\n') + '\n\n'; // Add newlines between statements
    logBuffer = []; // Clear buffer

    try {
        await fs.appendFile(logFilePath, statementsToFlush, 'utf8');
    } catch (error) {
        console.error(`Failed to write to SQL log file ${logFilePath}:`, error.message);
        // Decide how to handle: re-throw, disable logging, etc. For now, just log.
    }
}

/**
 * Logs an SQL statement to the buffer. Flushes to file if buffer threshold is reached.
 * @param {string} sqlStatement - The SQL statement to log.
 */
function log(sqlStatement) {
    if (!logFilePath) {
        // console.warn('SQL logger not initialized. Statement not logged.');
        return;
    }

    logBuffer.push(sqlStatement.trim()); // Trim whitespace

    if (logBuffer.length >= BUFFER_THRESHOLD) {
        // Chain the write promise to ensure sequential writes
        writePromise = writePromise.then(() => _flushBuffer());
    }
}

/**
 * Ensures all remaining buffered SQL statements are written to the log file.
 * Should be called at the end of the application's execution.
 */
async function finalize() {
    if (!logFilePath) {
        return;
    }
    // Wait for any pending writes to complete, then flush the remaining buffer
    await writePromise;
    await _flushBuffer();
    console.log(`SQL logging finalized. Log saved to: ${logFilePath}`);
    logFilePath = null; // Reset for next run
}

module.exports = {
    init,
    log,
    finalize,
};
