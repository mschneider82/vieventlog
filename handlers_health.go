package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

type healthResponse struct {
	Status   string `json:"status"`
	Database string `json:"database"`
	Error    string `json:"error,omitempty"`
}

// healthHandler reports application health. If the event database is
// initialized, it performs a small write to verify the underlying storage
// (e.g. Longhorn volume) is still writable. Returns 503 if the write fails so
// Kubernetes can restart the pod via livenessProbe.
func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	dbMutex.RLock()
	initialized := dbInitialized
	db := eventDB
	dbMutex.RUnlock()

	if !initialized || db == nil {
		// Database not in use (archiving and temperature logging disabled)
		// is a valid state, treat as healthy.
		_ = json.NewEncoder(w).Encode(healthResponse{Status: "ok", Database: "not_initialized"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS healthcheck (id INTEGER PRIMARY KEY CHECK (id = 1), last_check TEXT NOT NULL)`); err != nil {
		writeHealthFailure(w, "create_table", err)
		return
	}

	if _, err := db.ExecContext(ctx,
		`INSERT INTO healthcheck (id, last_check) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_check = excluded.last_check`,
		time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		writeHealthFailure(w, "write", err)
		return
	}

	_ = json.NewEncoder(w).Encode(healthResponse{Status: "ok", Database: "writable"})
}

func writeHealthFailure(w http.ResponseWriter, stage string, err error) {
	log.Printf("Health check failed (%s): %v", stage, err)
	w.WriteHeader(http.StatusServiceUnavailable)
	_ = json.NewEncoder(w).Encode(healthResponse{
		Status:   "unhealthy",
		Database: "write_failed",
		Error:    err.Error(),
	})
}
