package main

import (
	"encoding/json"
	"log"
	"net/http"
)

// eventArchiveSettingsGetHandler handles GET /api/event-archive/settings
func eventArchiveSettingsGetHandler(w http.ResponseWriter, r *http.Request) {
	settings, err := GetEventArchiveSettings()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

// eventArchiveSettingsSetHandler handles POST /api/event-archive/settings
func eventArchiveSettingsSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var settings EventArchiveSettings
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Validate settings
	if settings.RetentionDays < 1 {
		http.Error(w, "RetentionDays must be at least 1", http.StatusBadRequest)
		return
	}

	if settings.RefreshInterval < 1 {
		http.Error(w, "RefreshInterval must be at least 1 minute", http.StatusBadRequest)
		return
	}

	if settings.DatabasePath == "" {
		settings.DatabasePath = "./viessmann_events.db"
	}

	// Get old settings to check if we need to restart scheduler
	oldSettings, _ := GetEventArchiveSettings()

	// Save new settings
	err := SetEventArchiveSettings(&settings)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// If enabled status changed or interval changed, restart scheduler
	if oldSettings != nil && (oldSettings.Enabled != settings.Enabled ||
		oldSettings.RefreshInterval != settings.RefreshInterval ||
		oldSettings.DatabasePath != settings.DatabasePath) {

		log.Println("Event archive settings changed, restarting scheduler...")

		// Restart scheduler in background
		go func() {
			err := RestartEventArchiveScheduler()
			if err != nil {
				log.Printf("Error restarting scheduler: %v", err)
			}
		}()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Event archive settings updated successfully",
	})
}

// eventArchiveStatsHandler handles GET /api/event-archive/stats
func eventArchiveStatsHandler(w http.ResponseWriter, r *http.Request) {
	settings, err := GetEventArchiveSettings()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	stats := map[string]interface{}{
		"enabled":          settings.Enabled,
		"schedulerRunning": IsSchedulerRunning(),
		"totalEvents":      0,
		"oldestEvent":      "",
		"databasePath":     settings.DatabasePath,
	}

	// Only get DB stats if archiving is enabled and DB is initialized
	if settings.Enabled && dbInitialized {
		count, err := GetEventCount()
		if err == nil {
			stats["totalEvents"] = count
		}

		oldest, err := GetOldestEventTimestamp()
		if err == nil {
			stats["oldestEvent"] = oldest
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}
