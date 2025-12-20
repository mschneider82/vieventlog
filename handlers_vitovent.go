package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

// VitoventDevice represents a Vitovent ventilation system
type VitoventDevice struct {
	DeviceID       string                 `json:"deviceId"`
	DeviceType     string                 `json:"deviceType"`
	ModelID        string                 `json:"modelId"`
	Name           string                 `json:"name"`
	InstallationID string                 `json:"installationId"`
	GatewaySerial  string                 `json:"gatewaySerial"`
	AccountID      string                 `json:"accountId"`
	Features       map[string]interface{} `json:"features"`
}

// isVitoventDevice checks if a device is a Vitovent ventilation system
// Supports both VitoAir and Vitovent 300F models
func isVitoventDevice(deviceType, modelID string) bool {
	// Check if deviceType is "ventilation" (VitoAir)
	if deviceType == "ventilation" {
		return true
	}

	// Check ModelID for viair/vitovent/vento keywords
	modelIDLower := strings.ToLower(modelID)
	if strings.Contains(modelIDLower, "viair") ||
		strings.Contains(modelIDLower, "vitovent") ||
		strings.Contains(modelIDLower, "vento") {
		return true
	}

	// Vitovent 300F might not have a clear deviceType, check for common patterns
	// Empty or generic device types with vitovent-like modelIDs
	if modelID != "" {
		// Check if modelID contains any ventilation-related keywords in different positions
		modelLower := strings.ToLower(modelID)
		// Common patterns: VitoVent, vitovent, VENTO, etc.
		ventilationKeywords := []string{"vent", "air", "lüft"}
		for _, keyword := range ventilationKeywords {
			if strings.Contains(modelLower, keyword) {
				log.Printf("Device matches ventilation keyword '%s': Type=%s, ModelID=%s\n", keyword, deviceType, modelID)
				return true
			}
		}
	}

	return false
}

// VitoventDashboardResponse is the response for the Vitovent dashboard
type VitoventDashboardResponse struct {
	InstallationID string          `json:"installationId"`
	Description    string          `json:"description"`
	Device         *VitoventDevice `json:"device"`
}

// extractVitoventFeatures extracts relevant features for Vitovent devices
// Supports both VitoAir (complex) and Vitovent 300F (simplified) models
func extractVitoventFeatures(rawFeatures []Feature) map[string]interface{} {
	features := make(map[string]interface{})

	// Track device type capabilities and feature presence
	features["device_type"] = "unknown" // Will be set based on available features
	var hasVitoairModes bool
	var has300FModes bool
	var currentOperatingMode string

	for _, f := range rawFeatures {
		switch {
		// ========== OPERATING MODES (Both VitoAir and 300F) ==========
		// VitoAir style: ventilation.operating.modes.active
		case f.Feature == "ventilation.operating.modes.active":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				currentOperatingMode = val["value"].(string)
				features["operating_mode"] = currentOperatingMode
				hasVitoairModes = true // VitoAir has this feature structure
			}

		// Vitovent 300F style: individual mode properties (check for presence, not active state)
		case f.Feature == "ventilation.operating.modes.standby":
			has300FModes = true // Just mark that this 300F-style feature exists
			if val, ok := f.Properties["active"].(map[string]interface{}); ok {
				if active, ok := val["value"].(bool); ok && active {
					features["operating_mode"] = "standby"
				}
			}
		case f.Feature == "ventilation.operating.modes.standard":
			has300FModes = true // Just mark that this 300F-style feature exists
			if val, ok := f.Properties["active"].(map[string]interface{}); ok {
				if active, ok := val["value"].(bool); ok && active {
					features["operating_mode"] = "standard"
				}
			}
		case f.Feature == "ventilation.operating.modes.ventilation":
			has300FModes = true // Just mark that this 300F-style feature exists
			if val, ok := f.Properties["active"].(map[string]interface{}); ok {
				if active, ok := val["value"].(bool); ok && active {
					features["operating_mode"] = "ventilation"
				}
			}

		// Ventilation active
		case f.Feature == "ventilation":
			if val, ok := f.Properties["active"].(map[string]interface{}); ok {
				features["ventilation_active"] = val["value"]
			}

		// Current levels
		case f.Feature == "ventilation.operating.programs.active":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["current_level"] = val["value"]
			}

		// Operating state
		case f.Feature == "ventilation.operating.state":
			state := make(map[string]interface{})
			if demand, ok := f.Properties["demand"].(map[string]interface{}); ok {
				if demandVal, ok := demand["value"].(string); ok {
					state["demand"] = demandVal
				}
			}
			if level, ok := f.Properties["level"].(map[string]interface{}); ok {
				if levelVal, ok := level["value"].(string); ok {
					state["level"] = levelVal
				}
			}
			if reason, ok := f.Properties["reason"].(map[string]interface{}); ok {
				if reasonVal, ok := reason["value"].(string); ok {
					state["reason"] = reasonVal
				}
			}
			features["operating_state"] = state

		// Bypass configuration
		case f.Feature == "ventilation.bypass":
			if val, ok := f.Properties["active"].(map[string]interface{}); ok {
				features["bypass_available"] = val["value"]
			}

		case f.Feature == "ventilation.bypass.operating.modes.active":
			bypass := make(map[string]interface{})
			if level, ok := f.Properties["level"].(map[string]interface{}); ok {
				bypass["level"] = level["value"]
			}
			if state, ok := f.Properties["state"].(map[string]interface{}); ok {
				bypass["state"] = state["value"]
			}
			features["bypass_mode"] = bypass

		case f.Feature == "ventilation.bypass.position":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["bypass_position"] = val["value"]
			}

		case f.Feature == "ventilation.bypass.configuration.temperature.supply.dynamicRegulation":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["bypass_temp_dynamic"] = val["value"]
			}

		case f.Feature == "ventilation.bypass.configuration.temperature.supply.smoothRegulation":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["bypass_temp_smooth"] = val["value"]
			}

		case f.Feature == "ventilation.bypass.configuration.temperature.perceived":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["bypass_target_temp"] = val["value"]
			}

		// Quick modes - VitoAir style (intensive, silent, shutdown)
		case f.Feature == "ventilation.quickmodes.forcedLevelFour":
			qm := make(map[string]interface{})
			if active, ok := f.Properties["active"].(map[string]interface{}); ok {
				qm["active"] = active["value"]
			}
			if runtime, ok := f.Properties["defaultRuntime"].(map[string]interface{}); ok {
				qm["runtime"] = runtime["value"]
			}
			features["quickmode_intensive"] = qm

		case f.Feature == "ventilation.quickmodes.silent":
			qm := make(map[string]interface{})
			if active, ok := f.Properties["active"].(map[string]interface{}); ok {
				qm["active"] = active["value"]
			}
			if runtime, ok := f.Properties["defaultRuntime"].(map[string]interface{}); ok {
				qm["runtime"] = runtime["value"]
			}
			features["quickmode_silent"] = qm

		case f.Feature == "ventilation.quickmodes.temporaryShutdown":
			qm := make(map[string]interface{})
			if active, ok := f.Properties["active"].(map[string]interface{}); ok {
				qm["active"] = active["value"]
			}
			if runtime, ok := f.Properties["defaultRuntime"].(map[string]interface{}); ok {
				qm["runtime"] = runtime["value"]
			}
			features["quickmode_shutdown"] = qm

		// Quick modes - Vitovent 300F style (comfort, eco, holiday)
		case f.Feature == "ventilation.quickmodes.comfort":
			qm := make(map[string]interface{})
			if active, ok := f.Properties["active"].(map[string]interface{}); ok {
				qm["active"] = active["value"]
			}
			features["quickmode_comfort"] = qm

		case f.Feature == "ventilation.quickmodes.eco":
			qm := make(map[string]interface{})
			if active, ok := f.Properties["active"].(map[string]interface{}); ok {
				qm["active"] = active["value"]
			}
			features["quickmode_eco"] = qm

		case f.Feature == "ventilation.quickmodes.holiday":
			qm := make(map[string]interface{})
			if active, ok := f.Properties["active"].(map[string]interface{}); ok {
				qm["active"] = active["value"]
			}
			if start, ok := f.Properties["start"].(map[string]interface{}); ok {
				qm["start"] = start["value"]
			}
			if end, ok := f.Properties["end"].(map[string]interface{}); ok {
				qm["end"] = end["value"]
			}
			features["quickmode_holiday"] = qm

		// Temperature sensors
		case f.Feature == "ventilation.sensors.temperature.supply":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["temp_supply"] = val["value"]
			}

		case f.Feature == "ventilation.sensors.temperature.exhaust":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["temp_exhaust"] = val["value"]
			}

		case f.Feature == "ventilation.sensors.temperature.extract":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["temp_extract"] = val["value"]
			}

		case f.Feature == "ventilation.sensors.temperature.outside":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["temp_outside"] = val["value"]
			}

		// Humidity sensors
		case f.Feature == "ventilation.sensors.humidity.supply":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["humidity_supply"] = val["value"]
			}

		case f.Feature == "ventilation.sensors.humidity.exhaust":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["humidity_exhaust"] = val["value"]
			}

		case f.Feature == "ventilation.sensors.humidity.extract":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["humidity_extract"] = val["value"]
			}

		case f.Feature == "ventilation.sensors.humidity.outdoor":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["humidity_outdoor"] = val["value"]
			}

		// Volume flow
		case f.Feature == "ventilation.volumeFlow.current.input":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["volumeflow_input"] = val["value"]
			}

		case f.Feature == "ventilation.volumeFlow.current.output":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["volumeflow_output"] = val["value"]
			}

		// Fan status
		case f.Feature == "ventilation.fan.supply":
			fan := make(map[string]interface{})
			if current, ok := f.Properties["current"].(map[string]interface{}); ok {
				fan["current_rpm"] = current["value"]
			}
			if target, ok := f.Properties["target"].(map[string]interface{}); ok {
				fan["target_rpm"] = target["value"]
			}
			if status, ok := f.Properties["status"].(map[string]interface{}); ok {
				fan["status"] = status["value"]
			}
			features["fan_supply"] = fan

		case f.Feature == "ventilation.fan.exhaust":
			fan := make(map[string]interface{})
			if current, ok := f.Properties["current"].(map[string]interface{}); ok {
				fan["current_rpm"] = current["value"]
			}
			if target, ok := f.Properties["target"].(map[string]interface{}); ok {
				fan["target_rpm"] = target["value"]
			}
			if status, ok := f.Properties["status"].(map[string]interface{}); ok {
				fan["status"] = status["value"]
			}
			features["fan_exhaust"] = fan

		// Fan runtime
		case f.Feature == "ventilation.fan.supply.runtime":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["fan_supply_runtime"] = val["value"]
			}

		case f.Feature == "ventilation.fan.exhaust.runtime":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["fan_exhaust_runtime"] = val["value"]
			}

		// Filter information
		case f.Feature == "ventilation.filter.pollution.blocked":
			filter := make(map[string]interface{})
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				filter["pollution"] = val["value"]
			}
			if status, ok := f.Properties["status"].(map[string]interface{}); ok {
				filter["status"] = status["value"]
			}
			features["filter_pollution"] = filter

		case f.Feature == "ventilation.filter.runtime":
			filter := make(map[string]interface{})
			if hours, ok := f.Properties["operatingHours"].(map[string]interface{}); ok {
				filter["operating_hours"] = hours["value"]
			}
			if remaining, ok := f.Properties["remainingHours"].(map[string]interface{}); ok {
				filter["remaining_hours"] = remaining["value"]
			}
			if overdue, ok := f.Properties["overdueHours"].(map[string]interface{}); ok {
				filter["overdue_hours"] = overdue["value"]
			}
			features["filter_runtime"] = filter

		// Heat recovery efficiency
		case f.Feature == "ventilation.heating.recovery":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["heat_recovery"] = val["value"]
			}

		// Frost protection
		case f.Feature == "ventilation.heatExchanger.frostprotection":
			if val, ok := f.Properties["status"].(map[string]interface{}); ok {
				features["frostprotection"] = val["value"]
			}

		// Control filter change
		case f.Feature == "ventilation.control.filterChange":
			if val, ok := f.Properties["active"].(map[string]interface{}); ok {
				features["filter_change_mode"] = val["value"]
			}

		// External lock
		case f.Feature == "ventilation.external.lock":
			if val, ok := f.Properties["active"].(map[string]interface{}); ok {
				features["external_lock"] = val["value"]
			}

		// ========== VITOVENT 300F SPECIFIC FEATURES ==========
		// Volume Flow Levels (300F only - showing configured levels)
		case f.Feature == "ventilation.levels.levelOne":
			if vol, ok := f.Properties["volumeFlow"].(map[string]interface{}); ok {
				features["level_one_volumeflow"] = vol["value"]
			}
		case f.Feature == "ventilation.levels.levelTwo":
			if vol, ok := f.Properties["volumeFlow"].(map[string]interface{}); ok {
				features["level_two_volumeflow"] = vol["value"]
			}
		case f.Feature == "ventilation.levels.levelThree":
			if vol, ok := f.Properties["volumeFlow"].(map[string]interface{}); ok {
				features["level_three_volumeflow"] = vol["value"]
			}
		case f.Feature == "ventilation.levels.levelFour":
			if vol, ok := f.Properties["volumeFlow"].(map[string]interface{}); ok {
				features["level_four_volumeflow"] = vol["value"]
			}

		// Schedule (300F only)
		case f.Feature == "ventilation.schedule":
			if active, ok := f.Properties["active"].(map[string]interface{}); ok {
				features["schedule_active"] = active["value"]
			}
			if entries, ok := f.Properties["entries"].(map[string]interface{}); ok {
				features["schedule_entries"] = entries["value"]
			}
		}
	}

	// Determine device type based on feature structure presence (not current state)
	// This ensures stable device type detection even after mode changes
	if hasVitoairModes {
		features["device_type"] = "vitoair"
		log.Printf("Device detected as VitoAir (has ventilation.operating.modes.active structure)\n")
	} else if has300FModes {
		features["device_type"] = "vitovent300f"
		log.Printf("Device detected as Vitovent 300F (has individual mode properties: standby/standard/ventilation)\n")
	}

	return features
}

// vitoventPageHandler serves the Vitovent dashboard page
func vitoventPageHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Render the vitovent.html template
	tmpl, err := templatesFS.ReadFile("templates/vitovent.html")
	if err != nil {
		http.Error(w, "Template not found", http.StatusInternalServerError)
		log.Printf("Error reading template: %v\n", err)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(tmpl)
}

// vitoventDevicesHandler returns Vitovent ventilation system data for an installation
func vitoventDevicesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	installationID := r.URL.Query().Get("installationId")
	if installationID == "" {
		http.Error(w, "installationId parameter required", http.StatusBadRequest)
		return
	}

	// Check if force refresh is requested
	forceRefresh := r.URL.Query().Get("refresh") == "true"

	// Get active accounts
	activeAccounts, err := GetActiveAccounts()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if len(activeAccounts) == 0 {
		http.Error(w, "no active accounts found", http.StatusBadRequest)
		return
	}

	// Find installation description and Vitovent device
	var installDesc string
	var vitoventDevice *VitoventDevice

	// Iterate through all accounts to find Vitovent devices
	for _, account := range activeAccounts {
		token, err := ensureAccountAuthenticated(account)
		if err != nil {
			log.Printf("Failed to authenticate account %s: %v\n", account.Email, err)
			continue
		}

		// Check if this account has the requested installation
		installation, ok := token.Installations[installationID]
		if !ok {
			continue
		}

		installDesc = installation.Description
		if installDesc == "" {
			installDesc = fmt.Sprintf("%s, %s", installation.Address.City, installation.Address.Country)
		}

		// Look for ventilation device
		// Strategy: Try devices that match ventilation criteria first (direct detection)
		// Then check features for ANY device that has ventilation.* features (embedded in WMP/Heatbox)
		for _, gateway := range installation.Gateways {
			for _, device := range gateway.Devices {
				// Check if this is a Vitovent ventilation device by type/model
				isVentilationDevice := isVitoventDevice(device.DeviceType, device.ModelID)

				if !isVentilationDevice {
					// Don't skip - might be a WMP/Heatbox with embedded ventilation features
					// Log but continue to check features
					log.Printf("Device doesn't match Vitovent criteria, but checking features anyway: Type=%s, ModelID=%s, DeviceID=%s\n",
						device.DeviceType, device.ModelID, device.DeviceID)
				} else {
					log.Printf("Vitovent device detected by type/model: Type=%s, ModelID=%s, DeviceID=%s\n",
						device.DeviceType, device.ModelID, device.DeviceID)
				}

				// Invalidate cache if force refresh is requested
				if forceRefresh {
					cacheKey := fmt.Sprintf("%s:%s:%s", installationID, gateway.Serial, device.DeviceID)
					featuresCacheMutex.Lock()
					delete(featuresCache, cacheKey)
					featuresCacheMutex.Unlock()
				}

				// Fetch features for this device
				features, err := fetchFeaturesWithCache(installationID, gateway.Serial, device.DeviceID, token.AccessToken)
				if err != nil {
					log.Printf("Failed to fetch features for device %s: %v\n", device.DeviceID, err)
					continue
				}

				// Check if this device has any ventilation features
				hasVentilationFeatures := false
				for _, feature := range features.RawFeatures {
					if strings.HasPrefix(feature.Feature, "ventilation.") || feature.Feature == "ventilation" {
						hasVentilationFeatures = true
						log.Printf("Found ventilation feature in device: %s\n", feature.Feature)
						break
					}
				}

				// Skip if device has no ventilation features and doesn't match ventilation device criteria
				if !hasVentilationFeatures && !isVentilationDevice {
					log.Printf("Device has no ventilation features and is not a ventilation device, skipping: %s\n", device.DeviceID)
					continue
				}

				// Extract relevant features
				extractedFeatures := extractVitoventFeatures(features.RawFeatures)

				// Create VitoventDevice
				vitoventDevice = &VitoventDevice{
					DeviceID:       device.DeviceID,
					DeviceType:     device.DeviceType,
					ModelID:        device.ModelID,
					Name:           fmt.Sprintf("Vitovent (über %s)", device.ModelID),
					InstallationID: installationID,
					GatewaySerial:  gateway.Serial,
					AccountID:      account.ID,
					Features:       extractedFeatures,
				}

				// Only return the first Vitovent device found
				break
			}
			if vitoventDevice != nil {
				break
			}
		}

		if vitoventDevice != nil {
			break
		}
	}

	response := VitoventDashboardResponse{
		InstallationID: installationID,
		Description:    installDesc,
		Device:         vitoventDevice,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// VitoventOperatingModeRequest represents the request to set operating mode
type VitoventOperatingModeRequest struct {
	AccountID      string `json:"accountId"`
	InstallationID string `json:"installationId"`
	GatewaySerial  string `json:"gatewaySerial"`
	DeviceID       string `json:"deviceId"`
	Mode           string `json:"mode"`
}

// vitoventOperatingModeHandler sets the operating mode for ventilation
func vitoventOperatingModeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req VitoventOperatingModeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate mode
	validModes := []string{"permanent", "ventilation", "sensorOverride", "sensorDriven"}
	modeValid := false
	for _, m := range validModes {
		if req.Mode == m {
			modeValid = true
			break
		}
	}
	if !modeValid {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid mode: " + req.Mode,
		})
		return
	}

	// Get account
	account, err := GetAccount(req.AccountID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found: " + err.Error(),
		})
		return
	}

	// Ensure authenticated
	token, err := ensureAccountAuthenticated(account)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Authentication failed: " + err.Error(),
		})
		return
	}

	// Build API URL for ventilation device
	url := fmt.Sprintf("https://api.viessmann-climatesolutions.com/iot/v2/features/installations/%s/gateways/%s/devices/%s/features/ventilation.operating.modes.active/commands/setMode",
		req.InstallationID, req.GatewaySerial, req.DeviceID)

	// Prepare request body
	commandBody := map[string]interface{}{
		"mode": req.Mode,
	}

	bodyBytes, err := json.Marshal(commandBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to marshal request: " + err.Error(),
		})
		return
	}

	// Create HTTP request
	httpReq, err := NewRequest("POST", url, strings.NewReader(string(bodyBytes)))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	httpReq.Header.Set("Authorization", "Bearer "+token.AccessToken)
	httpReq.Header.Set("Content-Type", "application/json")

	// Execute request
	client := &http.Client{}
	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "API request failed: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("API returned status %d", resp.StatusCode),
		})
		return
	}

	// Invalidate features cache for this device
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	featuresCacheMutex.Lock()
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	log.Printf("Set ventilation operating mode for device %s to %s\n", req.DeviceID, req.Mode)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// VitoventQuickModeRequest represents the request to activate/deactivate a quick mode
type VitoventQuickModeRequest struct {
	AccountID      string `json:"accountId"`
	InstallationID string `json:"installationId"`
	GatewaySerial  string `json:"gatewaySerial"`
	DeviceID       string `json:"deviceId"`
	Mode           string `json:"mode"`
	Active         bool   `json:"active"`
}

// vitoventQuickModeHandler activates/deactivates quick modes
func vitoventQuickModeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req VitoventQuickModeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate mode
	validModes := []string{"forcedLevelFour", "silent", "temporaryShutdown"}
	modeValid := false
	for _, m := range validModes {
		if req.Mode == m {
			modeValid = true
			break
		}
	}
	if !modeValid {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid quick mode: " + req.Mode,
		})
		return
	}

	// Get account
	account, err := GetAccount(req.AccountID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found: " + err.Error(),
		})
		return
	}

	// Ensure authenticated
	token, err := ensureAccountAuthenticated(account)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Authentication failed: " + err.Error(),
		})
		return
	}

	// Determine command
	command := "deactivate"
	if req.Active {
		command = "activate"
	}

	// Build API URL
	url := fmt.Sprintf("https://api.viessmann-climatesolutions.com/iot/v2/features/installations/%s/gateways/%s/devices/%s/features/ventilation.quickmodes.%s/commands/%s",
		req.InstallationID, req.GatewaySerial, req.DeviceID, req.Mode, command)

	// Create HTTP request (empty body for these commands)
	httpReq, err := NewRequest("POST", url, strings.NewReader("{}"))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	httpReq.Header.Set("Authorization", "Bearer "+token.AccessToken)
	httpReq.Header.Set("Content-Type", "application/json")

	// Execute request
	client := &http.Client{}
	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "API request failed: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("API returned status %d", resp.StatusCode),
		})
		return
	}

	// Invalidate features cache for this device
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	featuresCacheMutex.Lock()
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	log.Printf("Set ventilation quick mode %s for device %s to: %v\n", req.Mode, req.DeviceID, req.Active)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}
