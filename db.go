package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
	"strconv"

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

	// If already initialized with the same path, reuse the connection
	if dbInitialized && eventDB != nil {
		log.Printf("Database already initialized, reusing connection")
		return nil
	}

	// Close existing connection if any (only if reinitializing with different path)
	if eventDB != nil {
		eventDB.Close()
	}

	// Ensure the database directory exists
	dbDir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		return fmt.Errorf("failed to create database directory: %v", err)
	}

	var err error
	eventDB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("failed to open database: %v", err)
	}

	// Enable WAL mode for better concurrency (allows simultaneous reads and writes)
	_, err = eventDB.Exec("PRAGMA journal_mode=WAL")
	if err != nil {
		return fmt.Errorf("failed to enable WAL mode: %v", err)
	}

	// Set busy timeout to 5 seconds to handle lock contention gracefully
	_, err = eventDB.Exec("PRAGMA busy_timeout=5000")
	if err != nil {
		return fmt.Errorf("failed to set busy timeout: %v", err)
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

	// Create temperature_snapshots table
	createTempTableSQL := `
	CREATE TABLE IF NOT EXISTS temperature_snapshots (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp TEXT NOT NULL,
		installation_id TEXT NOT NULL,
		gateway_id TEXT,
		device_id TEXT,
		account_id TEXT,
		account_name TEXT,
		outside_temp REAL,
		return_temp REAL,
		supply_temp REAL,
		primary_supply_temp REAL,
		secondary_supply_temp REAL,
		primary_return_temp REAL,
		secondary_return_temp REAL,
		dhw_temp REAL,
		dhw_cylinder_middle_temp REAL,
		boiler_temp REAL,
		buffer_temp REAL,
		buffer_temp_top REAL,
		calculated_outside_temp REAL,
		compressor_active INTEGER,
		compressor_speed REAL,
		compressor_current REAL,
		compressor_pressure REAL,
		compressor_oil_temp REAL,
		compressor_motor_temp REAL,
		compressor_inlet_temp REAL,
		compressor_outlet_temp REAL,
		compressor_hours REAL,
		compressor_power REAL,
		circulation_pump_active INTEGER,
		dhw_pump_active INTEGER,
		internal_pump_active INTEGER,
		volumetric_flow REAL,
		thermal_power REAL,
		cop REAL,
		four_way_valve TEXT,
		burner_modulation REAL,
		secondary_heat_generator_status TEXT
	);

	CREATE INDEX IF NOT EXISTS idx_temp_timestamp ON temperature_snapshots(timestamp);
	CREATE INDEX IF NOT EXISTS idx_temp_installation_id ON temperature_snapshots(installation_id);
	CREATE INDEX IF NOT EXISTS idx_temp_account_id ON temperature_snapshots(account_id);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_temp_unique ON temperature_snapshots(timestamp, installation_id, gateway_id, device_id);
	`

	_, err = eventDB.Exec(createTempTableSQL)
	if err != nil {
		return fmt.Errorf("failed to create temperature_snapshots table: %v", err)
	}

	// Create temperature_log_settings table
	createSettingsTableSQL := `
	CREATE TABLE IF NOT EXISTS temperature_log_settings (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		enabled INTEGER NOT NULL DEFAULT 0,
		sample_interval INTEGER NOT NULL DEFAULT 5,
		retention_days INTEGER NOT NULL DEFAULT 90,
		database_path TEXT NOT NULL
	);

	INSERT OR IGNORE INTO temperature_log_settings (id, enabled, sample_interval, retention_days, database_path)
	VALUES (1, 0, 5, 90, '');
	`

	_, err = eventDB.Exec(createSettingsTableSQL)
	if err != nil {
		return fmt.Errorf("failed to create temperature_log_settings table: %v", err)
	}

	// Create schema_migrations table to track applied migrations
	createMigrationsTableSQL := `
	CREATE TABLE IF NOT EXISTS schema_migrations (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL UNIQUE,
		description TEXT,
		applied_at TEXT NOT NULL
	);
	`

	_, err = eventDB.Exec(createMigrationsTableSQL)
	if err != nil {
		return fmt.Errorf("failed to create schema_migrations table: %v", err)
	}

	// Run schema migrations for existing databases
	err = runSchemaMigrations()
	if err != nil {
		return fmt.Errorf("failed to run schema migrations: %v", err)
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

// migrationApplied checks if a migration was already run
func migrationApplied(name string) bool {
	var count int
	err := eventDB.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE name = ?", name).Scan(&count)
	if err != nil {
		log.Printf("Warning: Could not check migration status for '%s': %v", name, err)
		return false
	}
	return count > 0
}

// recordMigration marks a migration as completed
func recordMigration(id int, name, description string) error {
	_, err := eventDB.Exec(
		"INSERT INTO schema_migrations (id, name, description, applied_at) VALUES (?, ?, ?, ?)",
		id, name, description, time.Now().UTC().Format(time.RFC3339),
	)
	return err
}

// runSchemaMigrations applies schema changes to existing databases
func runSchemaMigrations() error {
	// Migration 1: Add dhw_cylinder_middle_temp column (added 2025-12-12)
	if !migrationApplied("add_dhw_cylinder_middle_temp") {
		log.Println("Running migration 1: Adding dhw_cylinder_middle_temp column")

		if !columnExists("temperature_snapshots", "dhw_cylinder_middle_temp") {
			_, err := eventDB.Exec("ALTER TABLE temperature_snapshots ADD COLUMN dhw_cylinder_middle_temp REAL")
			if err != nil {
				return fmt.Errorf("migration 1 failed: %v", err)
			}
		}

		if err := recordMigration(1, "add_dhw_cylinder_middle_temp", "Add middle cylinder temperature sensor"); err != nil {
			return fmt.Errorf("failed to record migration 1: %v", err)
		}
		log.Println("Migration 1 completed successfully")
	}

	// Migration 2: Add sample_interval column with intelligent backfill (added 2025-12-18)
	// This fixes issue #118: incorrect energy calculations when sample interval changes
	if !migrationApplied("add_sample_interval_with_backfill") {
		log.Println("Running migration 2: Adding sample_interval with intelligent backfill")

		// Step 1: Add column if not exists
		if !columnExists("temperature_snapshots", "sample_interval") {
			_, err := eventDB.Exec("ALTER TABLE temperature_snapshots ADD COLUMN sample_interval INTEGER")
			if err != nil {
				return fmt.Errorf("migration 2 failed (add column): %v", err)
			}
		}

		// Step 2: Intelligent backfill - calculate from actual timestamp differences
		log.Println("Backfilling sample_interval from timestamp analysis...")
		backfillSQL := `
			WITH diffs AS (
			  SELECT
				id,
				timestamp,
				installation_id,
				gateway_id,
				device_id,
				LEAD(timestamp) OVER (
				  PARTITION BY installation_id, gateway_id, device_id
				  ORDER BY timestamp
				) AS next_ts
			  FROM temperature_snapshots
			  WHERE sample_interval IS NULL
			),
			calc AS (
			  SELECT
				id,
				CAST((strftime('%s', next_ts)/60 - strftime('%s', timestamp)/60) AS INTEGER) AS diff_minutes,
				LAG(
				  CAST((strftime('%s', next_ts)/60 - strftime('%s', timestamp)/60) AS INTEGER)
				) OVER (
				  PARTITION BY installation_id, gateway_id, device_id
				  ORDER BY timestamp
				) AS prev_diff
			  FROM diffs
			),
			rules AS (
			  SELECT
				id,
				CASE
				  WHEN diff_minutes IS NULL THEN prev_diff
				  WHEN diff_minutes > 15 THEN prev_diff
				  WHEN diff_minutes != prev_diff THEN prev_diff
				  ELSE diff_minutes
				END AS base_value
			  FROM calc
			),
			context AS (
			  SELECT
				r.id,
				r.base_value,
				CASE WHEN LAG(r.base_value) OVER (ORDER BY r.id) <= 15 THEN LAG(r.base_value) OVER (ORDER BY r.id) END AS prev_val,
				CASE WHEN LEAD(r.base_value) OVER (ORDER BY r.id) <= 15 THEN LEAD(r.base_value) OVER (ORDER BY r.id) END AS next_val
			  FROM rules r
			)
			UPDATE temperature_snapshots
			SET sample_interval = CASE
				WHEN context.base_value > 15 THEN COALESCE(context.prev_val, 5)
				WHEN context.base_value = 0 AND context.prev_val IS NOT NULL AND context.prev_val != 0 THEN context.prev_val
				WHEN context.base_value = 0 AND context.next_val IS NOT NULL AND context.next_val != 0 THEN context.next_val
				WHEN context.base_value IS NULL THEN COALESCE(context.next_val, context.prev_val, 5)
				ELSE context.base_value
			END
			FROM context
			WHERE temperature_snapshots.id = context.id
			  AND temperature_snapshots.sample_interval IS NULL
		`

		_, err := eventDB.Exec(backfillSQL)
		if err != nil {
			return fmt.Errorf("migration 2 failed (backfill): %v", err)
		}

		if err := recordMigration(2, "add_sample_interval_with_backfill", "Add sample_interval with intelligent backfill from timestamps (#118)"); err != nil {
			return fmt.Errorf("failed to record migration 2: %v", err)
		}
		log.Println("Migration 2 completed successfully")
	}

	// Migration 3: Intelligent re-backfill of sample_interval (added 2025-12-19)
	// This re-calculates sample_interval from timestamp differences for existing data
	// Fixes issue where old migration used fixed value instead of actual intervals
	if !migrationApplied("intelligent_sample_interval_rebackfill") {
		log.Println("Running migration 3: Re-backfilling sample_interval with intelligent algorithm")

		// Count how many records will be updated
		var totalRecords int
		err := eventDB.QueryRow("SELECT COUNT(*) FROM temperature_snapshots").Scan(&totalRecords)
		if err == nil {
			log.Printf("Analyzing %d temperature snapshots...", totalRecords)
		}

		// Step 1: Calculate mode (most common interval) per device for fallback
		log.Println("Step 1: Calculating mode (most common interval) per device...")
		modeTableSQL := `
			CREATE TEMP TABLE device_modes AS
			WITH interval_counts AS (
				SELECT
					installation_id,
					gateway_id,
					device_id,
					sample_interval,
					COUNT(*) as frequency,
					ROW_NUMBER() OVER (
						PARTITION BY installation_id, gateway_id, device_id
						ORDER BY COUNT(*) DESC, sample_interval DESC
					) as rn
				FROM temperature_snapshots
				WHERE sample_interval IS NOT NULL
				GROUP BY installation_id, gateway_id, device_id, sample_interval
			)
			SELECT
				installation_id,
				gateway_id,
				device_id,
				sample_interval as mode_interval,
				frequency
			FROM interval_counts
			WHERE rn = 1;
		`
		_, err = eventDB.Exec(modeTableSQL)
		if err != nil {
			return fmt.Errorf("migration 3 failed (create mode table): %v", err)
		}

		// Step 2: Intelligent re-backfill - calculate from actual timestamp differences
		log.Println("Step 2: Re-calculating intervals from timestamp differences...")
		rebackfillSQL := `
			WITH diffs AS (
			  SELECT
				id,
				timestamp,
				installation_id,
				gateway_id,
				device_id,
				LEAD(timestamp) OVER (
				  PARTITION BY installation_id, gateway_id, device_id
				  ORDER BY timestamp
				) AS next_ts
			  FROM temperature_snapshots
			),
			calc AS (
			  SELECT
				id,
				CAST((strftime('%s', next_ts)/60 - strftime('%s', timestamp)/60) AS INTEGER) AS diff_minutes,
				LAG(
				  CAST((strftime('%s', next_ts)/60 - strftime('%s', timestamp)/60) AS INTEGER)
				) OVER (
				  PARTITION BY installation_id, gateway_id, device_id
				  ORDER BY timestamp
				) AS prev_diff
			  FROM diffs
			),
			rules AS (
			  SELECT
				id,
				CASE
				  WHEN diff_minutes IS NULL THEN prev_diff
				  WHEN diff_minutes > 15 THEN prev_diff
				  WHEN diff_minutes != prev_diff THEN prev_diff
				  ELSE diff_minutes
				END AS base_value
			  FROM calc
			),
			context AS (
			  SELECT
				r.id,
				r.base_value,
				CASE WHEN LAG(r.base_value) OVER (ORDER BY r.id) <= 15 THEN LAG(r.base_value) OVER (ORDER BY r.id) END AS prev_val,
				CASE WHEN LEAD(r.base_value) OVER (ORDER BY r.id) <= 15 THEN LEAD(r.base_value) OVER (ORDER BY r.id) END AS next_val
			  FROM rules r
			),
			with_mode AS (
			  SELECT
				c.id,
				c.base_value,
				c.prev_val,
				c.next_val,
				d.id as ts_id,
				dm.mode_interval
			  FROM context c
			  JOIN diffs d ON c.id = d.id
			  LEFT JOIN device_modes dm
				ON d.installation_id = dm.installation_id
				AND d.gateway_id = dm.gateway_id
				AND d.device_id = dm.device_id
			)
			UPDATE temperature_snapshots
			SET sample_interval = CASE
				-- Use mode for problematic values (too large, too small, or NULL)
				WHEN with_mode.base_value IS NULL THEN COALESCE(with_mode.mode_interval, 15)
				WHEN with_mode.base_value > 15 THEN COALESCE(with_mode.mode_interval, with_mode.prev_val, 15)
				WHEN with_mode.base_value = 0 THEN COALESCE(with_mode.mode_interval, with_mode.prev_val, with_mode.next_val, 15)
				WHEN with_mode.base_value = 1 THEN COALESCE(with_mode.mode_interval, 15)
				-- Normal case: use calculated value
				ELSE with_mode.base_value
			END
			FROM with_mode
			WHERE temperature_snapshots.id = with_mode.id
		`

		_, err = eventDB.Exec(rebackfillSQL)
		if err != nil {
			return fmt.Errorf("migration 3 failed (re-backfill): %v", err)
		}

		// Step 3: Cleanup temp table
		eventDB.Exec("DROP TABLE IF EXISTS device_modes")

		// Report results
		type IntervalStats struct {
			Interval int
			Count    int
		}
		var stats []IntervalStats
		rows, err := eventDB.Query("SELECT sample_interval, COUNT(*) as count FROM temperature_snapshots GROUP BY sample_interval ORDER BY count DESC LIMIT 5")
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var s IntervalStats
				rows.Scan(&s.Interval, &s.Count)
				stats = append(stats, s)
			}
		}

		log.Println("Step 3: Re-backfill completed successfully")
		log.Printf("Top intervals: %v", stats)

		var uniqueCount int
		eventDB.QueryRow("SELECT COUNT(DISTINCT sample_interval) FROM temperature_snapshots").Scan(&uniqueCount)
		log.Printf("Found %d unique sample intervals across %d snapshots", uniqueCount, totalRecords)

		if err := recordMigration(3, "intelligent_sample_interval_rebackfill", "Re-calculate sample_interval from timestamps for existing data (#118)"); err != nil {
			return fmt.Errorf("failed to record migration 3: %v", err)
		}
		log.Println("Migration 3 completed successfully")
	}

	// Migration 4: Add separate circuit temperature fields (added 2026-01-02)
	// Fixes issue #151: API-aligned temperature fields with explicit circuit separation
	// Adds explicit hp_* fields for heat pump circuits and heating_circuit_* fields for heating circuits
	// to avoid confusion between different circuit types across different heat pump models.
	// NOTE: Only SUPPLY temperatures are added - return sensors don't exist per-circuit in the API.
	// All circuits share the single heating.sensors.temperature.return sensor.
	// Legacy fields (primary_supply_temp, etc.) are kept for backward compatibility.
	if !migrationApplied("add_separate_circuit_fields") {
		log.Println("Running migration 4: Adding API-aligned temperature fields")

		// Add heat pump circuit SUPPLY temperature fields (no return sensors exist in API)
		if !columnExists("temperature_snapshots", "hp_primary_circuit_supply_temp") {
			_, err := eventDB.Exec("ALTER TABLE temperature_snapshots ADD COLUMN hp_primary_circuit_supply_temp REAL")
			if err != nil {
				return fmt.Errorf("migration 4 failed (hp_primary_circuit_supply_temp): %v", err)
			}
		}
		if !columnExists("temperature_snapshots", "hp_secondary_circuit_supply_temp") {
			_, err := eventDB.Exec("ALTER TABLE temperature_snapshots ADD COLUMN hp_secondary_circuit_supply_temp REAL")
			if err != nil {
				return fmt.Errorf("migration 4 failed (hp_secondary_circuit_supply_temp): %v", err)
			}
		}

		// Add heating circuit 0-3 SUPPLY temperature fields (no return sensors exist in API)
		for i := 0; i <= 3; i++ {
			colName := fmt.Sprintf("heating_circuit_%d_supply_temp", i)
			if !columnExists("temperature_snapshots", colName) {
				_, err := eventDB.Exec(fmt.Sprintf("ALTER TABLE temperature_snapshots ADD COLUMN %s REAL", colName))
				if err != nil {
					return fmt.Errorf("migration 4 failed (%s): %v", colName, err)
				}
			}
		}

		if err := recordMigration(4, "add_separate_circuit_fields", "Add API-aligned temperature fields with explicit circuit separation (#151)"); err != nil {
			return fmt.Errorf("failed to record migration 4: %v", err)
		}
		log.Println("Migration 4 completed: Added hp_* and heating_circuit_* supply temperature fields")
	}

	// Migration 5: Add per-circuit deltaT fields (added 2026-01-03)
	// Adds heating_circuit_0-3_delta_t fields to track temperature spreads for each circuit
	// NOTE: All circuits share the same return sensor, so deltaT = circuit_supply - shared_return
	if !migrationApplied("add_per_circuit_delta_t") {
		log.Println("Running migration 5: Adding per-circuit deltaT fields")

		// Add heating circuit 0-3 deltaT fields
		for i := 0; i <= 3; i++ {
			colName := fmt.Sprintf("heating_circuit_%d_delta_t", i)
			if !columnExists("temperature_snapshots", colName) {
				_, err := eventDB.Exec(fmt.Sprintf("ALTER TABLE temperature_snapshots ADD COLUMN %s REAL", colName))
				if err != nil {
					return fmt.Errorf("migration 5 failed (%s): %v", colName, err)
				}
			}
		}

		if err := recordMigration(5, "add_per_circuit_delta_t", "Add per-circuit deltaT (temperature spread) fields"); err != nil {
			return fmt.Errorf("failed to record migration 5: %v", err)
		}
		log.Println("Migration 5 completed: Added heating_circuit_*_delta_t fields")
	}

	// Migration 6: Add compressor_starts field, remove unsused fields
	// Adds compressor_starts
	if !migrationApplied("add_compressor_starts") {
		log.Println("Running migration 6: Adding compressor_starts field")

		// Add compressor_starts field
		if !columnExists("temperature_snapshots","compressor_starts") {
			_, err := eventDB.Exec("ALTER TABLE temperature_snapshots ADD COLUMN compressor_starts REAL")
			if err != nil {
				return fmt.Errorf("migration 6 failed (compressor_starts): %v", err)
			}
		}

		if err := recordMigration(6, "add_compressor_starts", "Add compressor_starts field"); err != nil {
			return fmt.Errorf("failed to record migration 6: %v", err)
		}
		log.Println("Migration 6 completed: Added field  compressor_starts")
		
	}
	
	return nil
}

// columnExists checks if a column exists in a table
func columnExists(tableName, columnName string) bool {
	query := fmt.Sprintf("PRAGMA table_info(%s)", tableName)
	rows, err := eventDB.Query(query)
	if err != nil {
		log.Printf("Error checking if column exists: %v", err)
		return false
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var dataType string
		var notNull int
		var dfltValue interface{}
		var pk int

		err := rows.Scan(&cid, &name, &dataType, &notNull, &dfltValue, &pk)
		if err != nil {
			log.Printf("Error scanning column info: %v", err)
			continue
		}

		if name == columnName {
			return true
		}
	}

	return false
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

// SaveEventToDB inserts a single event into the database (with deduplication)
// DEPRECATED: Use SaveEventsToDB for batch operations instead
func SaveEventToDB(event *Event) error {
	// Just wrap in a slice and use batch function
	return SaveEventsToDB([]Event{*event})
}

// SaveEventsToDB batch inserts events into the database
func SaveEventsToDB(events []Event) error {
	if !dbInitialized || eventDB == nil {
		return fmt.Errorf("database not initialized")
	}

	// Use a single lock and transaction for better performance
	dbMutex.Lock()
	defer dbMutex.Unlock()

	tx, err := eventDB.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %v", err)
	}
	defer tx.Rollback() // Will be no-op if committed

	insertSQL := `
		INSERT INTO events (
			hash, event_timestamp, created_at, formatted_time, event_type,
			feature_name, feature_value, device_id, model_id, gateway_serial,
			error_code, error_description, human_readable, code_category, severity,
			active, body, raw, installation_id, account_id, account_name
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(hash) DO NOTHING
	`

	stmt, err := tx.Prepare(insertSQL)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %v", err)
	}
	defer stmt.Close()

	for i := range events {
		event := &events[i]
		hash := ComputeEventHash(event)

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

		_, err = stmt.Exec(
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
			log.Printf("Warning: failed to insert event: %v", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %v", err)
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

// SaveTemperatureSnapshot inserts a temperature snapshot into the database
func SaveTemperatureSnapshot(snapshot *TemperatureSnapshot) error {
	if !dbInitialized || eventDB == nil {
		return fmt.Errorf("database not initialized")
	}

	dbMutex.Lock()
	defer dbMutex.Unlock()

	// Convert bool pointers to nullable ints
	var compressorActiveInt, circulationPumpActiveInt, dhwPumpActiveInt, internalPumpActiveInt *int
	if snapshot.CompressorActive != nil {
		val := 0
		if *snapshot.CompressorActive {
			val = 1
		}
		compressorActiveInt = &val
	}
	if snapshot.CirculationPumpActive != nil {
		val := 0
		if *snapshot.CirculationPumpActive {
			val = 1
		}
		circulationPumpActiveInt = &val
	}
	if snapshot.DHWPumpActive != nil {
		val := 0
		if *snapshot.DHWPumpActive {
			val = 1
		}
		dhwPumpActiveInt = &val
	}
	if snapshot.InternalPumpActive != nil {
		val := 0
		if *snapshot.InternalPumpActive {
			val = 1
		}
		internalPumpActiveInt = &val
	}

	// Use INSERT OR REPLACE to avoid duplicates based on timestamp, installation, gateway, device
	insertSQL := `
		INSERT OR REPLACE INTO temperature_snapshots (
			timestamp, installation_id, gateway_id, device_id, account_id, account_name,
			sample_interval,
			outside_temp, return_temp, supply_temp, primary_supply_temp, secondary_supply_temp,
			primary_return_temp, secondary_return_temp, dhw_temp, dhw_cylinder_middle_temp, boiler_temp, buffer_temp,
			buffer_temp_top, calculated_outside_temp,
			hp_primary_circuit_supply_temp, hp_secondary_circuit_supply_temp,
			heating_circuit_0_supply_temp, heating_circuit_1_supply_temp, heating_circuit_2_supply_temp, heating_circuit_3_supply_temp,
			compressor_active, compressor_speed, compressor_current, compressor_pressure,
			compressor_oil_temp, compressor_motor_temp, compressor_inlet_temp, compressor_outlet_temp,
			compressor_hours, compressor_starts, compressor_power,
			circulation_pump_active, dhw_pump_active, internal_pump_active,
			volumetric_flow, thermal_power, cop,
			heating_circuit_0_delta_t, heating_circuit_1_delta_t, heating_circuit_2_delta_t, heating_circuit_3_delta_t,
			four_way_valve, burner_modulation, secondary_heat_generator_status
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	_, err := eventDB.Exec(insertSQL,
		snapshot.Timestamp.UTC().Format(time.RFC3339),
		snapshot.InstallationID,
		snapshot.GatewayID,
		snapshot.DeviceID,
		snapshot.AccountID,
		snapshot.AccountName,
		snapshot.SampleInterval,
		snapshot.OutsideTemp,
		snapshot.ReturnTemp,
		snapshot.SupplyTemp,
		snapshot.PrimarySupplyTemp,
		snapshot.SecondarySupplyTemp,
		snapshot.PrimaryReturnTemp,
		snapshot.SecondaryReturnTemp,
		snapshot.DHWTemp,
		snapshot.DHWCylinderMiddleTemp,
		snapshot.BoilerTemp,
		snapshot.BufferTemp,
		snapshot.BufferTempTop,
		snapshot.CalculatedOutsideTemp,
		snapshot.HPPrimaryCircuitSupplyTemp,
		snapshot.HPSecondaryCircuitSupplyTemp,
		snapshot.HeatingCircuit0SupplyTemp,
		snapshot.HeatingCircuit1SupplyTemp,
		snapshot.HeatingCircuit2SupplyTemp,
		snapshot.HeatingCircuit3SupplyTemp,
		compressorActiveInt,
		snapshot.CompressorSpeed,
		snapshot.CompressorCurrent,
		snapshot.CompressorPressure,
		snapshot.CompressorOilTemp,
		snapshot.CompressorMotorTemp,
		snapshot.CompressorInletTemp,
		snapshot.CompressorOutletTemp,
		snapshot.CompressorHours,
		snapshot.CompressorStarts,
		snapshot.CompressorPower,
		circulationPumpActiveInt,
		dhwPumpActiveInt,
		internalPumpActiveInt,
		snapshot.VolumetricFlow,
		snapshot.ThermalPower,
		snapshot.COP,
		snapshot.HeatingCircuit0DeltaT,
		snapshot.HeatingCircuit1DeltaT,
		snapshot.HeatingCircuit2DeltaT,
		snapshot.HeatingCircuit3DeltaT,
		snapshot.FourWayValve,
		snapshot.BurnerModulation,
		snapshot.SecondaryHeatGeneratorStatus,
	)

	if err != nil {
		return fmt.Errorf("failed to insert temperature snapshot: %v", err)
	}

	return nil
}

// GetTemperatureSnapshots retrieves temperature snapshots from the database with optional filters
func GetTemperatureSnapshots(installationID, gatewayID, deviceID string, startTime, endTime time.Time, limit int) ([]TemperatureSnapshot, error) {
	if !dbInitialized || eventDB == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	dbMutex.RLock()
	defer dbMutex.RUnlock()

	// Build query with optional filters
	query := `
		SELECT
			timestamp, installation_id, gateway_id, device_id, account_id, account_name,
			outside_temp, return_temp, supply_temp, primary_supply_temp, secondary_supply_temp,
			primary_return_temp, secondary_return_temp, dhw_temp, dhw_cylinder_middle_temp, boiler_temp, buffer_temp,
			buffer_temp_top, calculated_outside_temp,
			hp_primary_circuit_supply_temp, hp_secondary_circuit_supply_temp,
			heating_circuit_0_supply_temp, heating_circuit_1_supply_temp, heating_circuit_2_supply_temp, heating_circuit_3_supply_temp,
			compressor_active, compressor_speed, compressor_current, compressor_pressure,
			compressor_oil_temp, compressor_motor_temp, compressor_inlet_temp, compressor_outlet_temp,
			compressor_hours, compressor_starts, compressor_power,
			circulation_pump_active, dhw_pump_active, internal_pump_active,
			volumetric_flow, thermal_power, cop,
			heating_circuit_0_delta_t, heating_circuit_1_delta_t, heating_circuit_2_delta_t, heating_circuit_3_delta_t,
			four_way_valve, burner_modulation, secondary_heat_generator_status
		FROM temperature_snapshots
		WHERE installation_id = ? AND timestamp >= ? AND timestamp <= ?
	`

	args := []interface{}{installationID, startTime.UTC().Format(time.RFC3339), endTime.UTC().Format(time.RFC3339)}

	// Add optional gateway filter
	if gatewayID != "" {
		query += " AND gateway_id = ?"
		args = append(args, gatewayID)
	}

	// Add optional device filter
	if deviceID != "" {
		query += " AND device_id = ?"
		args = append(args, deviceID)
	}

	query += " ORDER BY timestamp ASC"

	if limit > 0 {
		query += fmt.Sprintf(" LIMIT %d", limit)
	}

	rows, err := eventDB.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query temperature snapshots: %v", err)
	}
	defer rows.Close()

	var snapshots []TemperatureSnapshot
	for rows.Next() {
		var snapshot TemperatureSnapshot
		var timestampStr string
		var compressorActiveInt, circulationPumpActiveInt, dhwPumpActiveInt, internalPumpActiveInt *int

		err := rows.Scan(
			&timestampStr,
			&snapshot.InstallationID,
			&snapshot.GatewayID,
			&snapshot.DeviceID,
			&snapshot.AccountID,
			&snapshot.AccountName,
			&snapshot.OutsideTemp,
			&snapshot.ReturnTemp,
			&snapshot.SupplyTemp,
			&snapshot.PrimarySupplyTemp,
			&snapshot.SecondarySupplyTemp,
			&snapshot.PrimaryReturnTemp,
			&snapshot.SecondaryReturnTemp,
			&snapshot.DHWTemp,
			&snapshot.DHWCylinderMiddleTemp,
			&snapshot.BoilerTemp,
			&snapshot.BufferTemp,
			&snapshot.BufferTempTop,
			&snapshot.CalculatedOutsideTemp,
			&snapshot.HPPrimaryCircuitSupplyTemp,
			&snapshot.HPSecondaryCircuitSupplyTemp,
			&snapshot.HeatingCircuit0SupplyTemp,
			&snapshot.HeatingCircuit1SupplyTemp,
			&snapshot.HeatingCircuit2SupplyTemp,
			&snapshot.HeatingCircuit3SupplyTemp,
			&compressorActiveInt,
			&snapshot.CompressorSpeed,
			&snapshot.CompressorCurrent,
			&snapshot.CompressorPressure,
			&snapshot.CompressorOilTemp,
			&snapshot.CompressorMotorTemp,
			&snapshot.CompressorInletTemp,
			&snapshot.CompressorOutletTemp,
			&snapshot.CompressorHours,
			&snapshot.CompressorStarts,
			&snapshot.CompressorPower,
			&circulationPumpActiveInt,
			&dhwPumpActiveInt,
			&internalPumpActiveInt,
			&snapshot.VolumetricFlow,
			&snapshot.ThermalPower,
			&snapshot.COP,
			&snapshot.HeatingCircuit0DeltaT,
			&snapshot.HeatingCircuit1DeltaT,
			&snapshot.HeatingCircuit2DeltaT,
			&snapshot.HeatingCircuit3DeltaT,
			&snapshot.FourWayValve,
			&snapshot.BurnerModulation,
			&snapshot.SecondaryHeatGeneratorStatus,
		)

		if err != nil {
			log.Printf("Warning: failed to scan temperature snapshot row: %v", err)
			continue
		}

		// Parse timestamp
		ts, err := time.Parse(time.RFC3339, timestampStr)
		if err != nil {
			log.Printf("Warning: failed to parse timestamp: %v", err)
			continue
		}
		snapshot.Timestamp = ts

		// Convert ints back to bool pointers
		if compressorActiveInt != nil {
			val := *compressorActiveInt == 1
			snapshot.CompressorActive = &val
		}
		if circulationPumpActiveInt != nil {
			val := *circulationPumpActiveInt == 1
			snapshot.CirculationPumpActive = &val
		}
		if dhwPumpActiveInt != nil {
			val := *dhwPumpActiveInt == 1
			snapshot.DHWPumpActive = &val
		}
		if internalPumpActiveInt != nil {
			val := *internalPumpActiveInt == 1
			snapshot.InternalPumpActive = &val
		}

		snapshots = append(snapshots, snapshot)
	}

	return snapshots, nil
}

// GetTemperatureSnapshotCount returns the total number of temperature snapshots in the database
func GetTemperatureSnapshotCount() (int64, error) {
	if !dbInitialized || eventDB == nil {
		return 0, fmt.Errorf("database not initialized")
	}

	dbMutex.RLock()
	defer dbMutex.RUnlock()

	var count int64
	err := eventDB.QueryRow("SELECT COUNT(*) FROM temperature_snapshots").Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count temperature snapshots: %v", err)
	}

	return count, nil
}

// CleanupOldTemperatureSnapshots removes temperature snapshots older than the retention period
func CleanupOldTemperatureSnapshots(retentionDays int) error {
	if !dbInitialized || eventDB == nil {
		return fmt.Errorf("database not initialized")
	}

	dbMutex.Lock()
	defer dbMutex.Unlock()

	cutoffTime := time.Now().UTC().AddDate(0, 0, -retentionDays)

	result, err := eventDB.Exec("DELETE FROM temperature_snapshots WHERE timestamp < ?", cutoffTime.Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("failed to cleanup old temperature snapshots: %v", err)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected > 0 {
		log.Printf("Cleaned up %d old temperature snapshots (retention: %d days)", rowsAffected, retentionDays)
	}

	return nil
}

// GetTemperatureLogSettings retrieves the temperature logging settings
func GetTemperatureLogSettings() (*TemperatureLogSettings, error) {
	if !dbInitialized || eventDB == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	dbMutex.RLock()
	defer dbMutex.RUnlock()

	var settings TemperatureLogSettings
	var enabledInt int

	err := eventDB.QueryRow(`
		SELECT enabled, sample_interval, retention_days, database_path
		FROM temperature_log_settings
		WHERE id = 1
	`).Scan(&enabledInt, &settings.SampleInterval, &settings.RetentionDays, &settings.DatabasePath)

	if err != nil {
		return nil, fmt.Errorf("failed to get temperature log settings: %v", err)
	}

	settings.Enabled = enabledInt == 1
	return &settings, nil
}

// SetTemperatureLogSettings updates the temperature logging settings
func SetTemperatureLogSettings(settings *TemperatureLogSettings) error {
	if !dbInitialized || eventDB == nil {
		return fmt.Errorf("database not initialized")
	}

	dbMutex.Lock()
	defer dbMutex.Unlock()

	enabledInt := 0
	if settings.Enabled {
		enabledInt = 1
	}

	_, err := eventDB.Exec(`
		UPDATE temperature_log_settings
		SET enabled = ?, sample_interval = ?, retention_days = ?, database_path = ?
		WHERE id = 1
	`, enabledInt, settings.SampleInterval, settings.RetentionDays, settings.DatabasePath)

	if err != nil {
		return fmt.Errorf("failed to update temperature log settings: %v", err)
	}

	log.Printf("Temperature log settings updated: enabled=%v, interval=%dm, retention=%dd",
		settings.Enabled, settings.SampleInterval, settings.RetentionDays)
	return nil
}

// GetConsumptionStats calculates aggregated consumption statistics for a given time period
func GetConsumptionStats(installationID, gatewayID, deviceID string, startTime, endTime time.Time) (*ConsumptionStats, error) {
	if !dbInitialized || eventDB == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	dbMutex.RLock()
	defer dbMutex.RUnlock()

	// Get current sample interval as fallback for old records
	settings, err := GetTemperatureLogSettings()
	if err != nil {
		return nil, fmt.Errorf("failed to get temperature log settings: %v", err)
	}
	fallbackInterval := settings.SampleInterval

	// Query to get snapshots in time range
	query := `
		SELECT
			timestamp,
			compressor_power,
			--thermal_power,
			case when compressor_power > 0 then thermal_power -- usual case
			else
				-- w/o compressor power no thermal power as well
				case when compressor_power = 0 and ifnull (thermal_power, 0) > 0 then 0
				else
					-- fix thermal power null values to 0 (AVG does not include null values)
					case when ifnull (thermal_power, 0) = 0 then 0
					else null -- last exit, should never be the case
					end
				end
			end as thermal_power,
			cop,
			compressor_active,
			COALESCE(sample_interval, ?) as sample_interval
		FROM temperature_snapshots
		WHERE installation_id = ?
			AND gateway_id = ?
			AND device_id = ?
			AND timestamp >= ?
			AND timestamp < ? -- WICHTIG: exklusives Ende
		ORDER BY timestamp ASC
	`

	rows, err := eventDB.Query(query, fallbackInterval, installationID, gatewayID, deviceID,
		startTime.UTC().Format(time.RFC3339), endTime.UTC().Format(time.RFC3339))
	if err != nil {
		return nil, fmt.Errorf("failed to query consumption data: %v", err)
	}
	defer rows.Close()

	var totalElectricityWh float64
	var totalThermalWh float64
	var copSum float64
	var copCount int
	var runtimeMinutes float64
	var samples int

	for rows.Next() {
		var timestampStr string
		var compressorPower, thermalPower, cop *float64
		var compressorActiveInt *int
		var sampleIntervalMinutes int

		err := rows.Scan(&timestampStr, &compressorPower, &thermalPower, &cop, &compressorActiveInt, &sampleIntervalMinutes)
		if err != nil {
			log.Printf("Warning: failed to scan consumption row: %v", err)
			continue
		}

		samples++

		// Use the actual sample interval from this specific row
		intervalMinutes := float64(sampleIntervalMinutes)

		// Calculate energy using trapezoidal integration (power * time)
		// compressor_power is in Watts, thermal_power is in kW
		if compressorPower != nil {
			electricityWh := (*compressorPower) * (intervalMinutes / 60.0) // Wh
			totalElectricityWh += electricityWh
		}

		if thermalPower != nil {
			thermalWh := (*thermalPower) * 1000.0 * (intervalMinutes / 60.0) // kW -> Wh
			totalThermalWh += thermalWh
		}

		if cop != nil && *cop > 0 {
			copSum += *cop
			copCount++
		}

		// Count runtime if compressor was active
		if compressorActiveInt != nil && *compressorActiveInt == 1 {
			runtimeMinutes += intervalMinutes
		}
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating consumption rows: %v", err)
	}

	avgCOP := 0.0
	if copCount > 0 {
		avgCOP = copSum / float64(copCount)
	}

	stats := &ConsumptionStats{
		StartTime:      startTime,
		EndTime:        endTime,
		ElectricityKWh: totalElectricityWh / 1000.0, // Wh -> kWh
		ThermalKWh:     totalThermalWh / 1000.0,     // Wh -> kWh
		AvgCOP:         avgCOP,
		RuntimeHours:   runtimeMinutes / 60.0,
		Samples:        samples,
	}

	return stats, nil
}

// GetHourlyConsumptionBreakdown returns hourly consumption data for a given day
func GetHourlyConsumptionBreakdown(installationID, gatewayID, deviceID string, date time.Time) ([]ConsumptionDataPoint, error) {
	if !dbInitialized || eventDB == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	dbMutex.RLock()
	defer dbMutex.RUnlock()

	// Get current sample interval as fallback for old records
	settings, err := GetTemperatureLogSettings()
	if err != nil {
		return nil, fmt.Errorf("failed to get temperature log settings: %v", err)
	}
	fallbackInterval := settings.SampleInterval

	// Lokale Tagesgrenzen → UTC für indexierbare Filterung
	// Using DefaultLocation which supports both CET and CEST (Europe/Berlin)
	start := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, DefaultLocation)
	end   := time.Date(date.Year(), date.Month(), date.Day(), 23, 59, 59, 999999999, DefaultLocation)

	startUTC := start.UTC().Format(time.RFC3339Nano)
	endUTC   := end.UTC().Format(time.RFC3339Nano)

	query := `
		SELECT
			STRFTIME('%H', timestamp, 'localtime') as hour,
			SUM(COALESCE(compressor_power, 0) * COALESCE(sample_interval, ?) / 60.0) as electricity_wh,
			SUM(COALESCE(
				CASE WHEN compressor_power > 0 THEN thermal_power
				ELSE CASE WHEN compressor_power = 0 AND IFNULL(thermal_power, 0) > 0 THEN 0
					ELSE CASE WHEN IFNULL(thermal_power, 0) = 0 THEN 0 ELSE NULL END
				END END, 0
			) * 1000.0 * COALESCE(sample_interval, ?) / 60.0) as thermal_wh,
			AVG(cop) as avg_cop,
			SUM(CASE WHEN compressor_active = 1 THEN COALESCE(sample_interval, ?) ELSE 0 END) as runtime_minutes,
			COUNT(*) as samples
		FROM temperature_snapshots
		WHERE installation_id = ?
			AND gateway_id = ?
			AND device_id = ?
			AND timestamp >= ?
			AND timestamp <= ?
		GROUP BY hour
		ORDER BY hour ASC
	`

	rows, err := eventDB.Query(query, fallbackInterval, fallbackInterval, fallbackInterval,
		installationID, gatewayID, deviceID,
		startUTC, endUTC)
	if err != nil {
		return nil, fmt.Errorf("failed to query hourly breakdown: %v", err)
	}
	defer rows.Close()

	var dataPoints []ConsumptionDataPoint

	for rows.Next() {
		var hourStr string
		var electricityWh, thermalWh *float64
		var avgCOP *float64
		var runtimeMinutes float64
		var samples int

		err := rows.Scan(&hourStr, &electricityWh, &thermalWh, &avgCOP, &runtimeMinutes, &samples)
		if err != nil {
			log.Printf("Warning: failed to scan hourly breakdown row: %v", err)
			continue
		}

		hourInt, _ := strconv.Atoi(hourStr)

		// Convert Wh to kWh (energy already calculated correctly in SQL)
		eKWh := 0.0
		tKWh := 0.0
		if electricityWh != nil {
			eKWh = *electricityWh / 1000.0 // Wh -> kWh
		}
		if thermalWh != nil {
			tKWh = *thermalWh / 1000.0 // Wh -> kWh
		}

		dataPoint := ConsumptionDataPoint{
			Timestamp:      time.Date(date.Year(), date.Month(), date.Day(), hourInt, 0, 0, 0, DefaultLocation),
			ElectricityKWh: eKWh,
			ThermalKWh:     tKWh,
			AvgCOP:         0.0,
			RuntimeHours:   runtimeMinutes / 60.0,
			Samples:        samples,
		}
		if avgCOP != nil {
			dataPoint.AvgCOP = *avgCOP
		}

		dataPoints = append(dataPoints, dataPoint)
	}

	return dataPoints, nil
}

// GetDailyConsumptionBreakdown returns daily consumption data for a given period
func GetDailyConsumptionBreakdown(installationID, gatewayID, deviceID string, startDate, endDate time.Time) ([]ConsumptionDataPoint, error) {
	if !dbInitialized || eventDB == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	dbMutex.RLock()
	defer dbMutex.RUnlock()

	// Get current sample interval as fallback for old records
	settings, err := GetTemperatureLogSettings()
	if err != nil {
		return nil, fmt.Errorf("failed to get temperature log settings: %v", err)
	}
	fallbackInterval := settings.SampleInterval

	// Normalize to start of day for startDate and end of day for endDate
	// *** WICHTIGER FIX ***
	// Lokale Tagesgrenzen erzeugen – NICHT aus UTC geparsten Dates!
	startLocal := time.Date(startDate.Year(), startDate.Month(), startDate.Day(), 0, 0, 0, 0, DefaultLocation)
	endLocal   := time.Date(endDate.Year(), endDate.Month(), endDate.Day(), 23, 59, 59, 999999999, DefaultLocation)

	// Danach erst in UTC umwandeln
	startUTC := startLocal.UTC().Format(time.RFC3339Nano)
	endUTC   := endLocal.UTC().Format(time.RFC3339Nano)

	query := `
		SELECT
			DATE(timestamp, 'localtime') as day,
			SUM(COALESCE(compressor_power, 0) * COALESCE(sample_interval, ?) / 60.0) as total_electricity_wh,
			SUM(COALESCE(
				CASE WHEN compressor_power > 0 THEN thermal_power
				ELSE CASE WHEN compressor_power = 0 AND IFNULL(thermal_power, 0) > 0 THEN 0
					ELSE CASE WHEN IFNULL(thermal_power, 0) = 0 THEN 0 ELSE NULL END
				END END, 0
			) * 1000.0 * COALESCE(sample_interval, ?) / 60.0) as total_thermal_wh,
			AVG(cop) as avg_cop,
			SUM(CASE WHEN compressor_active = 1 THEN COALESCE(sample_interval, ?) ELSE 0 END) as runtime_minutes,
			COUNT(*) as total_samples
		FROM temperature_snapshots
		WHERE installation_id = ?
			AND gateway_id = ?
			AND device_id = ?
			AND timestamp >= ?
			AND timestamp <= ?
		GROUP BY day
		ORDER BY day ASC
	`

	rows, err := eventDB.Query(query, fallbackInterval, fallbackInterval, fallbackInterval,
		installationID, gatewayID, deviceID,
		startUTC, endUTC)
	if err != nil {
		return nil, fmt.Errorf("failed to query daily breakdown: %v", err)
	}
	defer rows.Close()

	var dataPoints []ConsumptionDataPoint

	for rows.Next() {
		var dayStr string
		var totalElectricityWh, totalThermalWh *float64
		var avgCOP *float64
		var runtimeMinutes float64
		var totalSamples int

		err := rows.Scan(&dayStr, &totalElectricityWh, &totalThermalWh, &avgCOP, &runtimeMinutes, &totalSamples)
		if err != nil {
			log.Printf("Warning: failed to scan daily breakdown row: %v", err)
			continue
		}

		dayTime, err := time.Parse("2006-01-02", dayStr)
		if err != nil {
			log.Printf("Warning: failed to parse day timestamp: %v", err)
			continue
		}

		// Convert Wh to kWh (energy already calculated correctly in SQL)
		electricityKWh := 0.0
		thermalKWh := 0.0
		if totalElectricityWh != nil {
			electricityKWh = (*totalElectricityWh) / 1000.0 // Wh -> kWh
		}
		if totalThermalWh != nil {
			thermalKWh = (*totalThermalWh) / 1000.0 // Wh -> kWh
		}

		dataPoint := ConsumptionDataPoint{
			Timestamp:      dayTime,
			ElectricityKWh: electricityKWh,
			ThermalKWh:     thermalKWh,
			AvgCOP:         0.0,
			RuntimeHours:   runtimeMinutes / 60.0,
			Samples:        totalSamples,
		}
		if avgCOP != nil {
			dataPoint.AvgCOP = *avgCOP
		}

		dataPoints = append(dataPoints, dataPoint)
	}

	return dataPoints, nil
}
