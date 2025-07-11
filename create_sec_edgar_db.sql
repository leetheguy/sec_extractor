-- SEC EDGAR Database Creation Script
-- This script creates the database and schema for the SEC EDGAR data extraction tool
-- It is designed to be idempotent, meaning it can be run multiple times without error.

-- Optional: Create database (uncomment if you manage the database creation)
-- CREATE DATABASE sec_edgar_db;

-- Optional: Connect to the database (uncomment if running from psql or similar)
-- \c sec_edgar_db;

-- Drop tables in reverse order of dependencies to avoid foreign key issues
DROP TABLE IF EXISTS financial_facts CASCADE; -- CASCADE drops dependent objects like foreign key constraints
DROP TABLE IF EXISTS financial_periods;
DROP TABLE IF EXISTS taxonomy_terms CASCADE; -- CASCADE handles self-referencing foreign keys
DROP TABLE IF EXISTS companies;
DROP TABLE IF EXISTS cik_ticker_mapping;

-- Create tables

-- 1. companies table
CREATE TABLE companies (
    cik INTEGER PRIMARY KEY,
    entity_name TEXT NOT NULL,
    ticker TEXT UNIQUE,
    title TEXT
);

-- 2. taxonomy_terms table
CREATE TABLE taxonomy_terms (
    taxonomy_id SERIAL PRIMARY KEY,
    term_name TEXT NOT NULL UNIQUE,
    description TEXT,
    -- Self-referencing foreign keys for parent and broad categories
    parent_taxonomy_id INTEGER REFERENCES taxonomy_terms(taxonomy_id) ON DELETE SET NULL,
    broad_category_taxonomy_id INTEGER REFERENCES taxonomy_terms(taxonomy_id) ON DELETE SET NULL,
    is_broad_category BOOLEAN NOT NULL DEFAULT FALSE,
    taxonomy_source TEXT NOT NULL
);

-- 3. financial_periods table
CREATE TABLE financial_periods (
    period_id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    quarter INTEGER, -- NULL for annual periods
    period_end_date DATE NOT NULL,
    is_annual BOOLEAN NOT NULL,
    UNIQUE(year, quarter, period_end_date, is_annual) -- Ensures unique periods
);

-- 4. financial_facts table
CREATE TABLE financial_facts (
    fact_id BIGSERIAL PRIMARY KEY,
    cik INTEGER NOT NULL REFERENCES companies(cik) ON DELETE CASCADE,
    taxonomy_id INTEGER NOT NULL REFERENCES taxonomy_terms(taxonomy_id) ON DELETE RESTRICT,
    period_id INTEGER NOT NULL REFERENCES financial_periods(period_id) ON DELETE RESTRICT,
    value NUMERIC,
    unit TEXT NOT NULL,
    form_type TEXT NOT NULL,
    filing_date DATE NOT NULL,
    frame TEXT, -- XBRL frame information, can be NULL
    source_json_path TEXT -- Path in the source JSON for debugging/auditing
);

-- 5. cik_ticker_mapping table
CREATE TABLE cik_ticker_mapping (
    mapping_id SERIAL PRIMARY KEY,
    cik_str TEXT NOT NULL UNIQUE,
    ticker TEXT NOT NULL,
    title TEXT NOT NULL
);

-- Create indexes
-- Indexes are dropped implicitly with CASCADE on tables, but explicitly dropping them
-- ensures a clean slate if tables are not dropped (e.g., if you only run index part)
DROP INDEX IF EXISTS idx_taxonomy_terms_parent;
DROP INDEX IF EXISTS idx_taxonomy_terms_broad_category;
DROP INDEX IF EXISTS idx_taxonomy_terms_source;
DROP INDEX IF EXISTS idx_financial_periods_year_quarter;
DROP INDEX IF EXISTS idx_financial_periods_end_date;
DROP INDEX IF EXISTS idx_financial_facts_cik;
DROP INDEX IF EXISTS idx_financial_facts_taxonomy_id;
DROP INDEX IF EXISTS idx_financial_facts_period_id;
DROP INDEX IF EXISTS idx_financial_facts_filing_date;
DROP INDEX IF EXISTS idx_financial_facts_composite; -- This is the UNIQUE index

DROP INDEX IF EXISTS idx_cik_ticker_mapping_ticker;


-- Indexes for taxonomy_terms
CREATE INDEX idx_taxonomy_terms_parent ON taxonomy_terms(parent_taxonomy_id);
CREATE INDEX idx_taxonomy_terms_broad_category ON taxonomy_terms(broad_category_taxonomy_id);
CREATE INDEX idx_taxonomy_terms_source ON taxonomy_terms(taxonomy_source);

-- Indexes for financial_periods
CREATE INDEX idx_financial_periods_year_quarter ON financial_periods(year, quarter);
CREATE INDEX idx_financial_periods_end_date ON financial_periods(period_end_date);

-- Indexes for financial_facts
CREATE INDEX idx_financial_facts_cik ON financial_facts(cik);
CREATE INDEX idx_financial_facts_taxonomy_id ON financial_facts(taxonomy_id);
CREATE INDEX idx_financial_facts_period_id ON financial_facts(period_id);
CREATE INDEX idx_financial_facts_filing_date ON financial_facts(filing_date);
-- IMPORTANT: This must be a UNIQUE index for ON CONFLICT to work on financial_facts
CREATE UNIQUE INDEX idx_financial_facts_composite ON financial_facts(cik, taxonomy_id, period_id, form_type, unit);

-- Indexes for cik_ticker_mapping
CREATE INDEX idx_cik_ticker_mapping_ticker ON cik_ticker_mapping(ticker);

-- Insert predefined broad category terms (idempotent using ON CONFLICT)
INSERT INTO taxonomy_terms (term_name, description, parent_taxonomy_id, broad_category_taxonomy_id, is_broad_category, taxonomy_source)
VALUES
('Assets', 'Total assets of the entity.', NULL, NULL, TRUE, 'SYSTEM_DEFINED'),
('Liabilities', 'Total liabilities of the entity.', NULL, NULL, TRUE, 'SYSTEM_DEFINED'),
('Equity', 'Total equity of the entity.', NULL, NULL, TRUE, 'SYSTEM_DEFINED'),
('Revenues', 'Total revenues of the entity.', NULL, NULL, TRUE, 'SYSTEM_DEFINED'),
('Expenses', 'Total expenses of the entity.', NULL, NULL, TRUE, 'SYSTEM_DEFINED'),
('CashFlow', 'Cash flow related items.', NULL, NULL, TRUE, 'SYSTEM_DEFINED'),
('Other', 'Other financial items not categorized elsewhere.', NULL, NULL, TRUE, 'SYSTEM_DEFINED')
ON CONFLICT (term_name) DO NOTHING; -- Ensures these are only inserted once

-- Optional: Grant privileges (uncomment if you manage user privileges)
-- GRANT ALL PRIVILEGES ON DATABASE sec_edgar_db TO postgres;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;

-- Optional: Notify completion (uncomment if running as a single script)
-- SELECT 'SEC EDGAR database and schema created successfully.' AS result;
