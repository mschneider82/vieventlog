package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"
)

// temperatureLogSettingsGetHandler handles GET /api/temperature-log/settings
func temperatureLogSettingsGetHandler(w http.ResponseWriter, r *http.Request) {
	settings, err := GetTemperatureLogSettings()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

// temperatureLogSettingsSetHandler handles POST /api/temperature-log/settings/set
func temperatureLogSettingsSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var settings TemperatureLogSettings
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Validate settings
	if settings.RetentionDays < 1 {
		http.Error(w, "RetentionDays must be at least 1", http.StatusBadRequest)
		return
	}

	if settings.SampleInterval < 1 {
		http.Error(w, "SampleInterval must be at least 1 minute", http.StatusBadRequest)
		return
	}

	// Warn if sample interval is too aggressive (less than 5 minutes)
	if settings.SampleInterval < 5 {
		log.Printf("Warning: SampleInterval of %d minutes may be too aggressive for API rate limits", settings.SampleInterval)
	}

	if settings.DatabasePath == "" {
		settings.DatabasePath = "./viessmann_events.db"
	}

	// Get old settings to check if we need to restart scheduler
	oldSettings, _ := GetTemperatureLogSettings()

	// Save new settings
	err := SetTemperatureLogSettings(&settings)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// If enabled status changed or interval changed, restart scheduler
	if oldSettings != nil && (oldSettings.Enabled != settings.Enabled ||
		oldSettings.SampleInterval != settings.SampleInterval ||
		oldSettings.DatabasePath != settings.DatabasePath) {

		log.Println("Temperature log settings changed, restarting scheduler...")

		// Restart scheduler in background
		go func() {
			err := RestartTemperatureScheduler()
			if err != nil {
				log.Printf("Error restarting temperature scheduler: %v", err)
			}
		}()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Temperature log settings updated successfully",
	})
}

// temperatureLogStatsHandler handles GET /api/temperature-log/stats
func temperatureLogStatsHandler(w http.ResponseWriter, r *http.Request) {
	settings, err := GetTemperatureLogSettings()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Get API usage stats
	var calls10m, calls24h int
	if apiCallCounter != nil {
		calls10m, calls24h = apiCallCounter.GetCurrentUsage()
	}

	stats := map[string]interface{}{
		"enabled":            settings.Enabled,
		"schedulerRunning":   IsTemperatureSchedulerRunning(),
		"totalSnapshots":     0,
		"databasePath":       settings.DatabasePath,
		"sampleInterval":     settings.SampleInterval,
		"apiUsage10Minutes":  calls10m,
		"apiUsage24Hours":    calls24h,
		"apiLimit10Minutes":  110,
		"apiLimit24Hours":    1400,
	}

	// Only get DB stats if logging is enabled and DB is initialized
	if settings.Enabled && dbInitialized {
		count, err := GetTemperatureSnapshotCount()
		if err == nil {
			stats["totalSnapshots"] = count
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// temperatureLogDataHandler handles GET /api/temperature-log/data
// Query parameters:
//   - installationId (required): Installation ID
//   - startTime (optional): Start time in RFC3339 format
//   - endTime (optional): End time in RFC3339 format
//   - hours (optional): Number of hours to look back (default: 24)
//   - limit (optional): Maximum number of data points (default: 1000)
func temperatureLogDataHandler(w http.ResponseWriter, r *http.Request) {
	// Get installation ID
	installationID := r.URL.Query().Get("installationId")
	if installationID == "" {
		http.Error(w, "installationId parameter is required", http.StatusBadRequest)
		return
	}

	// Parse time range
	var startTime, endTime time.Time
	var err error

	startTimeStr := r.URL.Query().Get("startTime")
	endTimeStr := r.URL.Query().Get("endTime")

	if startTimeStr != "" && endTimeStr != "" {
		// Use explicit time range
		startTime, err = time.Parse(time.RFC3339, startTimeStr)
		if err != nil {
			http.Error(w, "Invalid startTime format (expected RFC3339): "+err.Error(), http.StatusBadRequest)
			return
		}

		endTime, err = time.Parse(time.RFC3339, endTimeStr)
		if err != nil {
			http.Error(w, "Invalid endTime format (expected RFC3339): "+err.Error(), http.StatusBadRequest)
			return
		}
	} else {
		// Use hours parameter
		hoursStr := r.URL.Query().Get("hours")
		hours := 24 // default
		if hoursStr != "" {
			hours, err = strconv.Atoi(hoursStr)
			if err != nil || hours < 1 {
				http.Error(w, "Invalid hours parameter", http.StatusBadRequest)
				return
			}
		}

		endTime = time.Now().UTC()
		startTime = endTime.Add(-time.Duration(hours) * time.Hour)
	}

	// Parse limit
	limitStr := r.URL.Query().Get("limit")
	limit := 1000 // default
	if limitStr != "" {
		limit, err = strconv.Atoi(limitStr)
		if err != nil || limit < 1 {
			http.Error(w, "Invalid limit parameter", http.StatusBadRequest)
			return
		}
	}

	// Fetch data from database
	snapshots, err := GetTemperatureSnapshots(installationID, startTime, endTime, limit)
	if err != nil {
		http.Error(w, "Failed to fetch temperature data: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"installationId": installationID,
		"startTime":      startTime.Format(time.RFC3339),
		"endTime":        endTime.Format(time.RFC3339),
		"count":          len(snapshots),
		"data":           snapshots,
	})
}

// IsTemperatureSchedulerRunning checks if the temperature scheduler is running
func IsTemperatureSchedulerRunning() bool {
	temperatureSchedulerMutex.Lock()
	defer temperatureSchedulerMutex.Unlock()
	return temperatureSchedulerTicker != nil
}
