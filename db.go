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

	-- Temperature snapshots table for time-series data
	CREATE TABLE IF NOT EXISTS temperature_snapshots (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp TEXT NOT NULL,
		installation_id TEXT NOT NULL,
		gateway_id TEXT NOT NULL,
		device_id TEXT NOT NULL,
		account_id TEXT NOT NULL,
		account_name TEXT,

		-- Temperature values (°C)
		outside_temp REAL,
		calculated_outside_temp REAL,
		supply_temp REAL,
		return_temp REAL,
		dhw_temp REAL,
		boiler_temp REAL,
		buffer_temp REAL,
		buffer_temp_top REAL,
		primary_supply_temp REAL,
		secondary_supply_temp REAL,
		primary_return_temp REAL,
		secondary_return_temp REAL,

		-- Compressor data
		compressor_active INTEGER,
		compressor_speed REAL,
		compressor_power REAL,
		compressor_current REAL,
		compressor_pressure REAL,
		compressor_oil_temp REAL,
		compressor_motor_temp REAL,
		compressor_inlet_temp REAL,
		compressor_outlet_temp REAL,
		compressor_hours REAL,

		-- Flow and energy
		volumetric_flow REAL,
		thermal_power REAL,
		cop REAL,

		-- Operating state
		four_way_valve TEXT,
		burner_modulation REAL,
		secondary_heat_generator_status TEXT,

		-- Heating curve parameters
		heating_curve_slope REAL,
		heating_curve_shift REAL,
		target_supply_temp REAL,

		indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_temp_timestamp ON temperature_snapshots(timestamp);
	CREATE INDEX IF NOT EXISTS idx_temp_installation ON temperature_snapshots(installation_id);
	CREATE INDEX IF NOT EXISTS idx_temp_device ON temperature_snapshots(device_id);
	CREATE INDEX IF NOT EXISTS idx_temp_account ON temperature_snapshots(account_id);
	CREATE INDEX IF NOT EXISTS idx_temp_timestamp_installation ON temperature_snapshots(timestamp, installation_id);
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

// --- Temperature Snapshots Functions ---

// TemperatureSnapshot represents a single temperature/state snapshot
type TemperatureSnapshot struct {
	Timestamp      string
	InstallationID string
	GatewayID      string
	DeviceID       string
	AccountID      string
	AccountName    string

	// Temperature values
	OutsideTemp           *float64
	CalculatedOutsideTemp *float64
	SupplyTemp            *float64
	ReturnTemp            *float64
	DHWTemp               *float64
	BoilerTemp            *float64
	BufferTemp            *float64
	BufferTempTop         *float64
	PrimarySupplyTemp     *float64
	SecondarySupplyTemp   *float64
	PrimaryReturnTemp     *float64
	SecondaryReturnTemp   *float64

	// Compressor data
	CompressorActive    *bool
	CompressorSpeed     *float64
	CompressorPower     *float64
	CompressorCurrent   *float64
	CompressorPressure  *float64
	CompressorOilTemp   *float64
	CompressorMotorTemp *float64
	CompressorInletTemp *float64
	CompressorOutletTemp *float64
	CompressorHours     *float64

	// Flow and energy
	VolumetricFlow *float64
	ThermalPower   *float64
	COP            *float64

	// Operating state
	FourWayValve                 *string
	BurnerModulation             *float64
	SecondaryHeatGeneratorStatus *string

	// Heating curve
	HeatingCurveSlope *float64
	HeatingCurveShift *float64
	TargetSupplyTemp  *float64
}

// SaveTemperatureSnapshot inserts a temperature snapshot into the database
func SaveTemperatureSnapshot(snapshot *TemperatureSnapshot) error {
	if !dbInitialized || eventDB == nil {
		return fmt.Errorf("database not initialized")
	}

	dbMutex.Lock()
	defer dbMutex.Unlock()

	// Convert bool pointer to nullable int
	var compressorActiveInt *int
	if snapshot.CompressorActive != nil {
		val := 0
		if *snapshot.CompressorActive {
			val = 1
		}
		compressorActiveInt = &val
	}

	insertSQL := `
		INSERT INTO temperature_snapshots (
			timestamp, installation_id, gateway_id, device_id, account_id, account_name,
			outside_temp, calculated_outside_temp, supply_temp, return_temp,
			dhw_temp, boiler_temp, buffer_temp, buffer_temp_top,
			primary_supply_temp, secondary_supply_temp, primary_return_temp, secondary_return_temp,
			compressor_active, compressor_speed, compressor_power, compressor_current,
			compressor_pressure, compressor_oil_temp, compressor_motor_temp,
			compressor_inlet_temp, compressor_outlet_temp, compressor_hours,
			volumetric_flow, thermal_power, cop,
			four_way_valve, burner_modulation, secondary_heat_generator_status,
			heating_curve_slope, heating_curve_shift, target_supply_temp
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	_, err := eventDB.Exec(insertSQL,
		snapshot.Timestamp,
		snapshot.InstallationID,
		snapshot.GatewayID,
		snapshot.DeviceID,
		snapshot.AccountID,
		snapshot.AccountName,
		snapshot.OutsideTemp,
		snapshot.CalculatedOutsideTemp,
		snapshot.SupplyTemp,
		snapshot.ReturnTemp,
		snapshot.DHWTemp,
		snapshot.BoilerTemp,
		snapshot.BufferTemp,
		snapshot.BufferTempTop,
		snapshot.PrimarySupplyTemp,
		snapshot.SecondarySupplyTemp,
		snapshot.PrimaryReturnTemp,
		snapshot.SecondaryReturnTemp,
		compressorActiveInt,
		snapshot.CompressorSpeed,
		snapshot.CompressorPower,
		snapshot.CompressorCurrent,
		snapshot.CompressorPressure,
		snapshot.CompressorOilTemp,
		snapshot.CompressorMotorTemp,
		snapshot.CompressorInletTemp,
		snapshot.CompressorOutletTemp,
		snapshot.CompressorHours,
		snapshot.VolumetricFlow,
		snapshot.ThermalPower,
		snapshot.COP,
		snapshot.FourWayValve,
		snapshot.BurnerModulation,
		snapshot.SecondaryHeatGeneratorStatus,
		snapshot.HeatingCurveSlope,
		snapshot.HeatingCurveShift,
		snapshot.TargetSupplyTemp,
	)

	if err != nil {
		return fmt.Errorf("failed to insert temperature snapshot: %v", err)
	}

	return nil
}

// GetTemperatureSnapshots retrieves temperature snapshots from the database with filters
func GetTemperatureSnapshots(installationID string, startTime, endTime time.Time, limit int) ([]TemperatureSnapshot, error) {
	if !dbInitialized || eventDB == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	dbMutex.RLock()
	defer dbMutex.RUnlock()

	query := `
		SELECT
			timestamp, installation_id, gateway_id, device_id, account_id, account_name,
			outside_temp, calculated_outside_temp, supply_temp, return_temp,
			dhw_temp, boiler_temp, buffer_temp, buffer_temp_top,
			primary_supply_temp, secondary_supply_temp, primary_return_temp, secondary_return_temp,
			compressor_active, compressor_speed, compressor_power, compressor_current,
			compressor_pressure, compressor_oil_temp, compressor_motor_temp,
			compressor_inlet_temp, compressor_outlet_temp, compressor_hours,
			volumetric_flow, thermal_power, cop,
			four_way_valve, burner_modulation, secondary_heat_generator_status,
			heating_curve_slope, heating_curve_shift, target_supply_temp
		FROM temperature_snapshots
		WHERE installation_id = ? AND timestamp >= ? AND timestamp <= ?
		ORDER BY timestamp ASC
	`

	if limit > 0 {
		query += fmt.Sprintf(" LIMIT %d", limit)
	}

	rows, err := eventDB.Query(query, installationID, startTime.Format(time.RFC3339), endTime.Format(time.RFC3339))
	if err != nil {
		return nil, fmt.Errorf("failed to query temperature snapshots: %v", err)
	}
	defer rows.Close()

	var snapshots []TemperatureSnapshot
	for rows.Next() {
		var snapshot TemperatureSnapshot
		var compressorActiveInt *int

		err := rows.Scan(
			&snapshot.Timestamp,
			&snapshot.InstallationID,
			&snapshot.GatewayID,
			&snapshot.DeviceID,
			&snapshot.AccountID,
			&snapshot.AccountName,
			&snapshot.OutsideTemp,
			&snapshot.CalculatedOutsideTemp,
			&snapshot.SupplyTemp,
			&snapshot.ReturnTemp,
			&snapshot.DHWTemp,
			&snapshot.BoilerTemp,
			&snapshot.BufferTemp,
			&snapshot.BufferTempTop,
			&snapshot.PrimarySupplyTemp,
			&snapshot.SecondarySupplyTemp,
			&snapshot.PrimaryReturnTemp,
			&snapshot.SecondaryReturnTemp,
			&compressorActiveInt,
			&snapshot.CompressorSpeed,
			&snapshot.CompressorPower,
			&snapshot.CompressorCurrent,
			&snapshot.CompressorPressure,
			&snapshot.CompressorOilTemp,
			&snapshot.CompressorMotorTemp,
			&snapshot.CompressorInletTemp,
			&snapshot.CompressorOutletTemp,
			&snapshot.CompressorHours,
			&snapshot.VolumetricFlow,
			&snapshot.ThermalPower,
			&snapshot.COP,
			&snapshot.FourWayValve,
			&snapshot.BurnerModulation,
			&snapshot.SecondaryHeatGeneratorStatus,
			&snapshot.HeatingCurveSlope,
			&snapshot.HeatingCurveShift,
			&snapshot.TargetSupplyTemp,
		)

		if err != nil {
			log.Printf("Warning: failed to scan temperature snapshot row: %v", err)
			continue
		}

		// Convert active int back to bool pointer
		if compressorActiveInt != nil {
			val := *compressorActiveInt == 1
			snapshot.CompressorActive = &val
		}

		snapshots = append(snapshots, snapshot)
	}

	return snapshots, nil
}

// CleanupOldTemperatureSnapshots removes snapshots older than the retention period
func CleanupOldTemperatureSnapshots(retentionDays int) error {
	if !dbInitialized || eventDB == nil {
		return fmt.Errorf("database not initialized")
	}

	dbMutex.Lock()
	defer dbMutex.Unlock()

	cutoffTime := time.Now().AddDate(0, 0, -retentionDays)

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
