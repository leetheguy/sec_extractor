// db_manager.js

const { Pool } = require('pg');
const config = require('./config'); // For database connection details

let pool; // PostgreSQL connection pool

/**
 * Initializes the database connection pool.
 */
async function connect() {
    if (!pool) {
        pool = new Pool(config.db);
        pool.on('error', (err) => {
            console.error('Unexpected error on idle client', err);
            // In a production app, consider more robust error handling,
            // e.g., graceful shutdown, logging, or retry mechanisms.
            process.exit(-1); // Exit process if unrecoverable error
        });
        console.log('Database connection pool initialized.');
    }
}

/**
 * Closes the database connection pool.
 */
async function disconnect() {
    if (pool) {
        await pool.end();
        pool = null;
        console.log('Database connection pool closed.');
    }
}

/**
 * Executes a single SQL query using a client from the pool.
 * This function is suitable for general queries outside of a transaction.
 * For queries within a transaction, use the client returned by beginTransaction().
 * @param {string} sql - The SQL query string.
 * @param {Array} [params=[]] - An array of parameters for the query.
 * @returns {Promise<pg.QueryResult>} - The result of the query.
 */
async function query(sql, params = []) {
    if (!pool) {
        throw new Error('Database pool not initialized. Call connect() first.');
    }
    return pool.query(sql, params);
}

/**
 * Starts a new database transaction and returns a client.
 * The client must be used for all queries within this transaction.
 * Remember to call commitTransaction() or rollbackTransaction() and release the client.
 * @returns {Promise<pg.Client>} - A client object for the transaction.
 */
async function beginTransaction() {
    if (!pool) {
        throw new Error('Database pool not initialized. Call connect() first.');
    }
    const client = await pool.connect();
    await client.query('BEGIN');
    return client;
}

/**
 * Commits an ongoing transaction and releases the client back to the pool.
 * @param {pg.Client} client - The client object associated with the transaction.
 */
async function commitTransaction(client) {
    try {
        await client.query('COMMIT');
    } finally {
        client.release();
    }
}

/**
 * Rolls back an ongoing transaction and releases the client back to the pool.
 * @param {pg.Client} client - The client object associated with the transaction.
 */
async function rollbackTransaction(client) {
    try {
        await client.query('ROLLBACK');
    } finally {
        client.release();
    }
}

module.exports = {
    connect,
    disconnect,
    query,
    beginTransaction,
    commitTransaction,
    rollbackTransaction,
};
