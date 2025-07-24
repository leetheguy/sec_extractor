#!/bin/bash

# Define the path to your CSV file
CSV_FILE="finviz(1).csv"

# Check if the CSV file exists
if [ ! -f "$CSV_FILE" ]; then
    echo "Error: CSV file '$CSV_FILE' not found."
    exit 1
fi

echo "Processing tickers from $CSV_FILE..."

# Read the CSV file line by line
# -r prevents backslash escapes from being interpreted
# IFS=, sets the Internal Field Separator to a comma for CSV parsing
# tail -n +2 skips the first line (header)
tail -n +2 "$CSV_FILE" | while IFS=, read -r dummy_column_1 ticker_column_2 rest_of_line
do
    # Extract the ticker from the first column
    # Trim any whitespace from the ticker
    TICKER=$(echo "$ticker_column_2" | xargs)

    # Check if the ticker is not empty
    if [ -n "$TICKER" ]; then
        echo "Running command for ticker: $TICKER"
        # Execute the node command
        node src/main.js --ticker "$TICKER"
        # You can add a small delay here if needed, e.g., sleep 0.1
    else
        echo "Skipping empty line or line with no ticker in the first column."
    fi
done

echo "Script finished."
