package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/robfig/cron/v3"
)

// Script is an automation script stored in SQLite
type Script struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
	Schedule    string `json:"schedule"` // Cron expression (5 fields) or descriptor like @every 5m
	scriptDevice
	Code       string `json:"code"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
	LastRun    string `json:"lastRun,omitempty"`
	LastStatus string `json:"lastStatus,omitempty"`
	LastError  string `json:"lastError,omitempty"`
}

// scriptRunLog is one entry of the execution log
type scriptRunLog struct {
	ID        int64           `json:"id"`
	ScriptID  string          `json:"scriptId"`
	Timestamp string          `json:"timestamp"`
	Trigger   string          `json:"trigger"` // schedule, manual
	Status    string          `json:"status"`
	Relevant  bool            `json:"relevant"`
	Result    json.RawMessage `json:"result"`
}

const scriptRunsKeep = 200

func scriptsEnsureTables() error {
	if err := aiEnsureDatabase(); err != nil {
		return err
	}
	_, err := eventDB.Exec(`
	CREATE TABLE IF NOT EXISTS scripts (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		description TEXT,
		enabled INTEGER NOT NULL DEFAULT 0,
		schedule TEXT NOT NULL,
		account_id TEXT NOT NULL,
		installation_id TEXT NOT NULL,
		gateway_serial TEXT NOT NULL,
		device_id TEXT NOT NULL,
		code TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		last_run TEXT,
		last_status TEXT,
		last_error TEXT
	);
	CREATE TABLE IF NOT EXISTS script_state (
		script_id TEXT NOT NULL,
		key TEXT NOT NULL,
		value TEXT,
		updated_at TEXT NOT NULL,
		PRIMARY KEY (script_id, key)
	);
	CREATE TABLE IF NOT EXISTS script_runs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		script_id TEXT NOT NULL,
		timestamp TEXT NOT NULL,
		trigger TEXT NOT NULL,
		status TEXT NOT NULL,
		relevant INTEGER NOT NULL DEFAULT 0, -- error, manual run or executed action
		result TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_script_runs_script ON script_runs(script_id, id);
	`)
	return err
}

const scriptColumns = `id, name, description, enabled, schedule, account_id, installation_id, gateway_serial, device_id,
	code, created_at, updated_at, last_run, last_status, last_error`

func scanScript(row interface{ Scan(...any) error }) (*Script, error) {
	var s Script
	var desc, lastRun, lastStatus, lastError sql.NullString
	var enabled int
	err := row.Scan(&s.ID, &s.Name, &desc, &enabled, &s.Schedule, &s.AccountID, &s.InstallationID, &s.GatewaySerial,
		&s.DeviceID, &s.Code, &s.CreatedAt, &s.UpdatedAt, &lastRun, &lastStatus, &lastError)
	if err != nil {
		return nil, err
	}
	s.Description, s.LastRun, s.LastStatus, s.LastError = desc.String, lastRun.String, lastStatus.String, lastError.String
	s.Enabled = enabled == 1
	return &s, nil
}

func listScripts() ([]*Script, error) {
	if err := scriptsEnsureTables(); err != nil {
		return nil, err
	}
	rows, err := eventDB.Query("SELECT " + scriptColumns + " FROM scripts ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	scripts := []*Script{}
	for rows.Next() {
		s, err := scanScript(rows)
		if err != nil {
			return nil, err
		}
		scripts = append(scripts, s)
	}
	return scripts, rows.Err()
}

func getScript(id string) (*Script, error) {
	if err := scriptsEnsureTables(); err != nil {
		return nil, err
	}
	s, err := scanScript(eventDB.QueryRow("SELECT "+scriptColumns+" FROM scripts WHERE id = ?", id))
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("Skript %s nicht gefunden", id)
	}
	return s, err
}

// validateScriptDefinition checks all fields before saving
func validateScriptDefinition(s *Script) error {
	s.Name = strings.TrimSpace(s.Name)
	s.Schedule = strings.TrimSpace(s.Schedule)
	if s.Name == "" {
		return fmt.Errorf("Name fehlt")
	}
	if s.Schedule == "" {
		return fmt.Errorf("Zeitplan fehlt")
	}
	if _, err := cron.ParseStandard(s.Schedule); err != nil {
		return fmt.Errorf("ungültiger Zeitplan %q: %v", s.Schedule, err)
	}
	if s.AccountID == "" || s.InstallationID == "" || s.GatewaySerial == "" {
		return fmt.Errorf("Gerät fehlt (accountId, installationId, gatewaySerial)")
	}
	if s.DeviceID == "" {
		s.DeviceID = "0"
	}
	if strings.TrimSpace(s.Code) == "" {
		return fmt.Errorf("Skript-Code fehlt")
	}
	if err := validateScript(s.Code); err != nil {
		return fmt.Errorf("Syntaxfehler: %v", err)
	}
	return nil
}

// saveScript creates or updates a script and reloads the scheduler
func saveScript(s *Script) (*Script, error) {
	if err := validateScriptDefinition(s); err != nil {
		return nil, err
	}
	if err := scriptsEnsureTables(); err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if s.ID == "" {
		s.ID = randomHex(8)
	}
	enabled := 0
	if s.Enabled {
		enabled = 1
	}
	_, err := eventDB.Exec(`
		INSERT INTO scripts (id, name, description, enabled, schedule, account_id, installation_id, gateway_serial, device_id, code, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, enabled = excluded.enabled,
			schedule = excluded.schedule, account_id = excluded.account_id, installation_id = excluded.installation_id,
			gateway_serial = excluded.gateway_serial, device_id = excluded.device_id, code = excluded.code, updated_at = excluded.updated_at`,
		s.ID, s.Name, s.Description, enabled, s.Schedule, s.AccountID, s.InstallationID, s.GatewaySerial, s.DeviceID, s.Code, now, now)
	if err != nil {
		return nil, err
	}
	reloadScriptScheduler()
	return getScript(s.ID)
}

func deleteScript(id string) error {
	if err := scriptsEnsureTables(); err != nil {
		return err
	}
	for _, q := range []string{"DELETE FROM scripts WHERE id = ?", "DELETE FROM script_state WHERE script_id = ?", "DELETE FROM script_runs WHERE script_id = ?"} {
		if _, err := eventDB.Exec(q, id); err != nil {
			return err
		}
	}
	reloadScriptScheduler()
	return nil
}

// --- State ---

func scriptLoadState(scriptID string) map[string]any {
	state := map[string]any{}
	if err := scriptsEnsureTables(); err != nil {
		return state
	}
	rows, err := eventDB.Query("SELECT key, value FROM script_state WHERE script_id = ?", scriptID)
	if err != nil {
		return state
	}
	defer rows.Close()
	for rows.Next() {
		var key, value string
		if rows.Scan(&key, &value) == nil {
			var v any
			if json.Unmarshal([]byte(value), &v) == nil {
				state[key] = v
			}
		}
	}
	return state
}

func scriptSaveState(scriptID string, values map[string]any) {
	now := time.Now().UTC().Format(time.RFC3339)
	for k, v := range values {
		data, err := json.Marshal(v)
		if err != nil {
			continue
		}
		_, err = eventDB.Exec(`INSERT INTO script_state (script_id, key, value, updated_at) VALUES (?, ?, ?, ?)
			ON CONFLICT(script_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			scriptID, k, string(data), now)
		if err != nil {
			log.Printf("Script %s: failed to save state %s: %v", scriptID, k, err)
		}
	}
}

// --- Run log ---

func scriptRecordRun(s *Script, trigger string, res *scriptRunResult) {
	data, _ := json.Marshal(res)
	now := time.Now().UTC().Format(time.RFC3339)
	relevant := res.Status != "ok" || trigger != "schedule"
	for _, a := range res.Actions {
		if a.Status == "executed" || a.Status == "error" {
			relevant = true
		}
	}
	if _, err := eventDB.Exec(`INSERT INTO script_runs (script_id, timestamp, trigger, status, relevant, result) VALUES (?, ?, ?, ?, ?, ?)`,
		s.ID, now, trigger, res.Status, relevant, string(data)); err != nil {
		log.Printf("Script %s: failed to record run: %v", s.ID, err)
	}
	eventDB.Exec(`UPDATE scripts SET last_run = ?, last_status = ?, last_error = ? WHERE id = ?`, now, res.Status, res.Error, s.ID)
	// Keep the latest runs plus relevant ones (errors, executed actions) separately, so a script
	// running every minute doesn't push its last executed action out of the log
	eventDB.Exec(`DELETE FROM script_runs WHERE script_id = ? AND relevant = 0 AND id NOT IN
		(SELECT id FROM script_runs WHERE script_id = ? AND relevant = 0 ORDER BY id DESC LIMIT ?)`, s.ID, s.ID, scriptRunsKeep)
	eventDB.Exec(`DELETE FROM script_runs WHERE script_id = ? AND relevant = 1 AND id NOT IN
		(SELECT id FROM script_runs WHERE script_id = ? AND relevant = 1 ORDER BY id DESC LIMIT ?)`, s.ID, s.ID, scriptRunsKeep)
}

// scriptRuns returns the latest runs; onlyRelevant returns only errors, manual runs and executed actions
func scriptRuns(scriptID string, limit int, onlyRelevant bool) ([]scriptRunLog, error) {
	if err := scriptsEnsureTables(); err != nil {
		return nil, err
	}
	query := `SELECT id, script_id, timestamp, trigger, status, relevant, result FROM script_runs WHERE script_id = ?`
	if onlyRelevant {
		query += ` AND relevant = 1`
	}
	query += ` ORDER BY id DESC LIMIT ?`
	rows, err := eventDB.Query(query, scriptID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	runs := []scriptRunLog{}
	for rows.Next() {
		var r scriptRunLog
		var result string
		if err := rows.Scan(&r.ID, &r.ScriptID, &r.Timestamp, &r.Trigger, &r.Status, &r.Relevant, &result); err != nil {
			return nil, err
		}
		r.Result = json.RawMessage(result)
		runs = append(runs, r)
	}
	return runs, rows.Err()
}
