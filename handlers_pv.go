package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
)

// pvSettingsGetHandler returns PV string settings for a device
func pvSettingsGetHandler(w http.ResponseWriter, r *http.Request) {
	var req PVSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.DeviceID == "" {
		http.Error(w, "Missing required fields: accountId, installationId, deviceId", http.StatusBadRequest)
		return
	}

	// Load device settings
	deviceKey := fmt.Sprintf("%s_%s", req.InstallationID, req.DeviceID)
	settings, err := GetDeviceSettings(req.AccountID, deviceKey)
	if err != nil {
		slog.Warn("Failed to load device settings for PV", "accountId", req.AccountID, "deviceKey", deviceKey, "error", err)
		// Return empty settings if not found
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(PVSettingsResponse{
			Success:  true,
			Settings: nil, // No settings configured
		})
		return
	}

	// Return PV settings (may be nil if not configured)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(PVSettingsResponse{
		Success:  true,
		Settings: settings.PVStrings,
	})
}

// pvSettingsSetHandler saves PV string settings for a device
func pvSettingsSetHandler(w http.ResponseWriter, r *http.Request) {
	var req PVSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.DeviceID == "" {
		http.Error(w, "Missing required fields: accountId, installationId, deviceId", http.StatusBadRequest)
		return
	}

	if req.Settings == nil {
		http.Error(w, "Missing settings object", http.StatusBadRequest)
		return
	}

	// Validate PV string configurations
	for i, str := range req.Settings.Strings {
		if str.Name == "" {
			http.Error(w, fmt.Sprintf("String %d: name is required", i+1), http.StatusBadRequest)
			return
		}
		if str.ModuleCount <= 0 {
			http.Error(w, fmt.Sprintf("String %s: moduleCount must be > 0", str.Name), http.StatusBadRequest)
			return
		}
		if str.ModulePower <= 0 {
			http.Error(w, fmt.Sprintf("String %s: modulePower must be > 0", str.Name), http.StatusBadRequest)
			return
		}
	}

	// Load or create device settings
	deviceKey := fmt.Sprintf("%s_%s", req.InstallationID, req.DeviceID)
	settings, err := GetDeviceSettings(req.AccountID, deviceKey)
	if err != nil {
		// Create new settings if not exists
		settings = &DeviceSettings{}
	}

	// Update PV settings
	settings.PVStrings = req.Settings

	// Save device settings
	if err := SetDeviceSettings(req.AccountID, deviceKey, settings); err != nil {
		slog.Error("Failed to save PV settings", "accountId", req.AccountID, "deviceKey", deviceKey, "error", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(PVSettingsResponse{
			Success: false,
			Error:   "Failed to save PV settings: " + err.Error(),
		})
		return
	}

	// Invalidate feature cache for this device
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, "0", req.DeviceID) // Gateway serial typically "0" for Vitocharge
	delete(featuresCache, cacheKey)
	// Also try common gateway patterns
	for serial := range featuresCache {
		if featuresCache[serial].InstallationID == req.InstallationID && featuresCache[serial].DeviceID == req.DeviceID {
			delete(featuresCache, serial)
		}
	}
	featuresCacheMutex.Unlock()

	slog.Info("PV settings saved successfully", "accountId", req.AccountID, "deviceKey", deviceKey, "stringCount", len(req.Settings.Strings))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(PVSettingsResponse{
		Success:  true,
		Settings: req.Settings,
	})
}
