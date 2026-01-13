package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"
)

// respondWithError sends a JSON error response
func respondWithError(w http.ResponseWriter, statusCode int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": false,
		"error":   message,
	})
}

// handleTemperatureLogSettings handles GET /api/temperature-log/settings
func handleTemperatureLogSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	settings, err := GetTemperatureLogSettings()
	if err != nil {
		log.Printf("Error getting temperature log settings: %v", err)
		respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to get settings: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

// handleSetTemperatureLogSettings handles POST /api/temperature-log/settings/set
func handleSetTemperatureLogSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var settings TemperatureLogSettings
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Validate settings
	if settings.SampleInterval < 1 || settings.SampleInterval > 1440 {
		respondWithError(w, http.StatusBadRequest, "Sample interval must be between 1 and 1440 minutes")
		return
	}

	if settings.RetentionDays < 1 || settings.RetentionDays > 3650 {
		respondWithError(w, http.StatusBadRequest, "Retention days must be between 1 and 3650")
		return
	}

	// Use default database path if not provided
	if settings.DatabasePath == "" {
		settings.DatabasePath = "./viessmann_events.db"
	}

	// Save settings
	err := SetTemperatureLogSettings(&settings)
	if err != nil {
		log.Printf("Error saving temperature log settings: %v", err)
		respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to save settings: %v", err))
		return
	}

	// Restart scheduler with new settings
	if settings.Enabled {
		err = RestartTemperatureScheduler()
		if err != nil {
			log.Printf("Error restarting temperature scheduler: %v", err)
			respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Settings saved but failed to restart scheduler: %v", err))
			return
		}
	} else {
		StopTemperatureScheduler()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Settings updated successfully",
	})
}

// handleTemperatureLogStats handles GET /api/temperature-log/stats
func handleTemperatureLogStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	settings, err := GetTemperatureLogSettings()
	if err != nil {
		log.Printf("Error getting temperature log settings: %v", err)
		respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to get settings: %v", err))
		return
	}

	totalSnapshots, err := GetTemperatureSnapshotCount()
	if err != nil {
		log.Printf("Error getting snapshot count: %v", err)
		totalSnapshots = 0
	}

	usage10min, usage24hr := getAPIUsage()
	limit10min, limit24hr := GetAPIRateLimits()

	stats := TemperatureLogStatsResponse{
		Enabled:          settings.Enabled,
		SchedulerRunning: IsTemperatureSchedulerRunning(),
		TotalSnapshots:   totalSnapshots,
		SampleInterval:   settings.SampleInterval,
		RetentionDays:    settings.RetentionDays,
		DatabasePath:     settings.DatabasePath,
		APIUsage10Min:    usage10min,
		APIUsage24Hr:     usage24hr,
		APILimit10Min:    limit10min,
		APILimit24Hr:     limit24hr,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// handleTemperatureLogData handles GET /api/temperature-log/data
func handleTemperatureLogData(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Get query parameters
	installationID := r.URL.Query().Get("installationId")
	if installationID == "" {
		respondWithError(w, http.StatusBadRequest, "installationId parameter is required")
		return
	}

	// Optional gateway and device filters
	gatewayID := r.URL.Query().Get("gatewayId")
	deviceID := r.URL.Query().Get("deviceId")

	// Parse time range
	var startTime, endTime time.Time
	var err error

	// Check if hours parameter is provided
	hoursParam := r.URL.Query().Get("hours")
	if hoursParam != "" {
		hours, err := strconv.Atoi(hoursParam)
		if err != nil || hours < 1 || hours > 8760 { // Max 1 year
			respondWithError(w, http.StatusBadRequest, "Invalid hours parameter (must be 1-8760)")
			return
		}
		endTime = time.Now().UTC()
		startTime = endTime.Add(-time.Duration(hours) * time.Hour)
	} else {
		// Parse startTime and endTime from query parameters
		startTimeStr := r.URL.Query().Get("startTime")
		endTimeStr := r.URL.Query().Get("endTime")

		if startTimeStr != "" {
			startTime, err = time.Parse(time.RFC3339, startTimeStr)
			if err != nil {
				respondWithError(w, http.StatusBadRequest, "Invalid startTime format (use RFC3339)")
				return
			}
		} else {
			// Default: 24 hours ago
			startTime = time.Now().UTC().Add(-24 * time.Hour)
		}

		if endTimeStr != "" {
			endTime, err = time.Parse(time.RFC3339, endTimeStr)
			if err != nil {
				respondWithError(w, http.StatusBadRequest, "Invalid endTime format (use RFC3339)")
				return
			}
		} else {
			// Default: now
			endTime = time.Now().UTC()
		}
	}

	// Parse limit
	limit := 50000
	limitParam := r.URL.Query().Get("limit")
	if limitParam != "" {
		parsedLimit, err := strconv.Atoi(limitParam)
		if err == nil && parsedLimit > 0 && parsedLimit <= 100000 {
			limit = parsedLimit
		}
	}

	// Fetch data from database
	snapshots, err := GetTemperatureSnapshots(installationID, gatewayID, deviceID, startTime, endTime, limit)
	if err != nil {
		log.Printf("Error fetching temperature snapshots: %v", err)
		respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to fetch data: %v", err))
		return
	}

	// Return data as JSON
	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"installationId": installationID,
		"startTime":      startTime.Format(time.RFC3339),
		"endTime":        endTime.Format(time.RFC3339),
		"count":          len(snapshots),
		"limit":          limit,
		"data":           snapshots,
	}
	json.NewEncoder(w).Encode(response)
}
