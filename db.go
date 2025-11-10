package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

var (
	eventDB       *sql.DB
	dbMutex       sync.RWMutex
	dbInitialized bool
)

// InitEventDatabase initializes the SQLite database for event archiving
func InitEventDatabase(dbPath string) error {
	dbMutex.Lock()
	defer dbMutex.Unlock()

	// Close existing connection if any
	if eventDB != nil {
		eventDB.Close()
	}

	var err error
	eventDB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("failed to open database: %v", err)
	}

	// Create events table with all fields from Event struct
	createTableSQL := `
	CREATE TABLE IF NOT EXISTS events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		hash TEXT NOT NULL UNIQUE,
		event_timestamp TEXT NOT NULL,
		created_at TEXT NOT NULL,
		formatted_time TEXT,
		event_type TEXT NOT NULL,
		feature_name TEXT,
		feature_value TEXT,
		device_id TEXT,
		model_id TEXT,
		gateway_serial TEXT,
		error_code TEXT,
		error_description TEXT,
		human_readable TEXT,
		code_category TEXT,
		severity TEXT,
		active INTEGER,
		body TEXT,
		raw TEXT,
		installation_id TEXT,
		account_id TEXT,
		account_name TEXT,
		indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_event_timestamp ON events(event_timestamp);
	CREATE INDEX IF NOT EXISTS idx_event_type ON events(event_type);
	CREATE INDEX IF NOT EXISTS idx_installation_id ON events(installation_id);
	CREATE INDEX IF NOT EXISTS idx_account_id ON events(account_id);
	CREATE INDEX IF NOT EXISTS idx_device_id ON events(device_id);
	CREATE INDEX IF NOT EXISTS idx_hash ON events(hash);
	CREATE INDEX IF NOT EXISTS idx_indexed_at ON events(indexed_at);
	`

	_, err = eventDB.Exec(createTableSQL)
	if err != nil {
		return fmt.Errorf("failed to create events table: %v", err)
	}

	dbInitialized = true
	log.Printf("Event database initialized at: %s", dbPath)
	return nil
}

// CloseEventDatabase closes the database connection
func CloseEventDatabase() error {
	dbMutex.Lock()
	defer dbMutex.Unlock()

	if eventDB != nil {
		dbInitialized = false
		return eventDB.Close()
	}
	return nil
}

// ComputeEventHash generates a unique hash for an event to enable deduplication
// Uses: EventTimestamp, EventType, DeviceID, InstallationID, ErrorCode, FeatureName, FeatureValue
func ComputeEventHash(event *Event) string {
	h := sha256.New()

	// Write critical fields to hash
	h.Write([]byte(event.EventTimestamp))
	h.Write([]byte(event.EventType))
	h.Write([]byte(event.DeviceID))
	h.Write([]byte(event.InstallationID))
	h.Write([]byte(event.ErrorCode))
	h.Write([]byte(event.FeatureName))
	h.Write([]byte(event.FeatureValue))
	h.Write([]byte(event.GatewaySerial))
	h.Write([]byte(event.AccountID))

	return fmt.Sprintf("%x", h.Sum(nil))
}

// SaveEventToDB inserts an event into the database (with deduplication)
func SaveEventToDB(event *Event) error {
	if !dbInitialized || eventDB == nil {
		return fmt.Errorf("database not initialized")
	}

	dbMutex.Lock()
	defer dbMutex.Unlock()

	// Compute hash for deduplication
	hash := ComputeEventHash(event)

	// Check if event already exists
	var exists bool
	err := eventDB.QueryRow("SELECT EXISTS(SELECT 1 FROM events WHERE hash = ?)", hash).Scan(&exists)
	if err != nil {
		return fmt.Errorf("failed to check event existence: %v", err)
	}

	if exists {
		// Event already exists, skip insert
		return nil
	}

	// Convert body map to JSON string
	bodyJSON, err := json.Marshal(event.Body)
	if err != nil {
		bodyJSON = []byte("{}")
	}

	// Convert Active bool pointer to nullable int
	var activeInt *int
	if event.Active != nil {
		val := 0
		if *event.Active {
			val = 1
		}
		activeInt = &val
	}

	insertSQL := `
		INSERT INTO events (
			hash, event_timestamp, created_at, formatted_time, event_type,
			feature_name, feature_value, device_id, model_id, gateway_serial,
			error_code, error_description, human_readable, code_category, severity,
			active, body, raw, installation_id, account_id, account_name
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	_, err = eventDB.Exec(insertSQL,
		hash,
		event.EventTimestamp,
		event.CreatedAt,
		event.FormattedTime,
		event.EventType,
		event.FeatureName,
		event.FeatureValue,
		event.DeviceID,
		event.ModelID,
		event.GatewaySerial,
		event.ErrorCode,
		event.ErrorDescription,
		event.HumanReadable,
		event.CodeCategory,
		event.Severity,
		activeInt,
		string(bodyJSON),
		event.Raw,
		event.InstallationID,
		event.AccountID,
		event.AccountName,
	)

	if err != nil {
		return fmt.Errorf("failed to insert event: %v", err)
	}

	return nil
}

// SaveEventsToDB batch inserts events into the database
func SaveEventsToDB(events []Event) error {
	if !dbInitialized || eventDB == nil {
		return fmt.Errorf("database not initialized")
	}

	for i := range events {
		err := SaveEventToDB(&events[i])
		if err != nil {
			log.Printf("Warning: failed to save event to DB: %v", err)
		}
	}

	return nil
}

// GetEventsFromDB retrieves events from the database with optional filters
func GetEventsFromDB(startTime, endTime time.Time, limit int) ([]Event, error) {
	if !dbInitialized || eventDB == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	dbMutex.RLock()
	defer dbMutex.RUnlock()

	query := `
		SELECT
			event_timestamp, created_at, formatted_time, event_type,
			feature_name, feature_value, device_id, model_id, gateway_serial,
			error_code, error_description, human_readable, code_category, severity,
			active, body, raw, installation_id, account_id, account_name
		FROM events
		WHERE event_timestamp >= ? AND event_timestamp <= ?
		ORDER BY event_timestamp DESC
	`

	if limit > 0 {
		query += fmt.Sprintf(" LIMIT %d", limit)
	}

	rows, err := eventDB.Query(query, startTime.Format(time.RFC3339), endTime.Format(time.RFC3339))
	if err != nil {
		return nil, fmt.Errorf("failed to query events: %v", err)
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var event Event
		var bodyJSON string
		var activeInt *int

		err := rows.Scan(
			&event.EventTimestamp,
			&event.CreatedAt,
			&event.FormattedTime,
			&event.EventType,
			&event.FeatureName,
			&event.FeatureValue,
			&event.DeviceID,
			&event.ModelID,
			&event.GatewaySerial,
			&event.ErrorCode,
			&event.ErrorDescription,
			&event.HumanReadable,
			&event.CodeCategory,
			&event.Severity,
			&activeInt,
			&bodyJSON,
			&event.Raw,
			&event.InstallationID,
			&event.AccountID,
			&event.AccountName,
		)

		if err != nil {
			log.Printf("Warning: failed to scan event row: %v", err)
			continue
		}

		// Convert active int back to bool pointer
		if activeInt != nil {
			val := *activeInt == 1
			event.Active = &val
		}

		// Parse body JSON
		if bodyJSON != "" {
			var body map[string]interface{}
			if err := json.Unmarshal([]byte(bodyJSON), &body); err == nil {
				event.Body = body
			}
		}

		events = append(events, event)
	}

	return events, nil
}

// CleanupOldEvents removes events older than the retention period
func CleanupOldEvents(retentionDays int) error {
	if !dbInitialized || eventDB == nil {
		return fmt.Errorf("database not initialized")
	}

	dbMutex.Lock()
	defer dbMutex.Unlock()

	cutoffTime := time.Now().AddDate(0, 0, -retentionDays)

	result, err := eventDB.Exec("DELETE FROM events WHERE event_timestamp < ?", cutoffTime.Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("failed to cleanup old events: %v", err)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected > 0 {
		log.Printf("Cleaned up %d old events (retention: %d days)", rowsAffected, retentionDays)
	}

	return nil
}

// GetEventCount returns the total number of events in the database
func GetEventCount() (int64, error) {
	if !dbInitialized || eventDB == nil {
		return 0, fmt.Errorf("database not initialized")
	}

	dbMutex.RLock()
	defer dbMutex.RUnlock()

	var count int64
	err := eventDB.QueryRow("SELECT COUNT(*) FROM events").Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count events: %v", err)
	}

	return count, nil
}

// GetOldestEventTimestamp returns the timestamp of the oldest event in the database
func GetOldestEventTimestamp() (string, error) {
	if !dbInitialized || eventDB == nil {
		return "", fmt.Errorf("database not initialized")
	}

	dbMutex.RLock()
	defer dbMutex.RUnlock()

	var timestamp string
	err := eventDB.QueryRow("SELECT event_timestamp FROM events ORDER BY event_timestamp ASC LIMIT 1").Scan(&timestamp)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("failed to get oldest event: %v", err)
	}

	return timestamp, nil
}
