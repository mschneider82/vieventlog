package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

// SmartClimateDevice represents a categorized device
type SmartClimateDevice struct {
	DeviceID       string                 `json:"deviceId"`
	DeviceType     string                 `json:"deviceType"`
	ModelID        string                 `json:"modelId"`
	Name           string                 `json:"name"`
	Category       string                 `json:"category"`
	GatewaySerial  string                 `json:"gatewaySerial"`
	InstallationID string                 `json:"installationId"`
	AccountID      string                 `json:"accountId"`
	Features       map[string]interface{} `json:"features"`
	Battery        *int                   `json:"battery,omitempty"`        // Battery level in percent
	SignalStrength *int                   `json:"signalStrength,omitempty"` // Zigbee LQI
	LQITimestamp   string                 `json:"lqiTimestamp,omitempty"`   // Last LQI update timestamp
}

// SmartClimateCategory represents a category with its devices
type SmartClimateCategory struct {
	Name    string               `json:"name"`
	Icon    string               `json:"icon"`
	Devices []SmartClimateDevice `json:"devices"`
}

// SmartClimateDashboardResponse is the response for the SmartClimate dashboard
type SmartClimateDashboardResponse struct {
	InstallationID string                 `json:"installationId"`
	Description    string                 `json:"description"`
	Categories     []SmartClimateCategory `json:"categories"`
}

// categorizeDevice determines the category based on device type and model
func categorizeDevice(deviceType, modelID string) string {
	if deviceType != "zigbee" && deviceType != "roomControl" {
		return ""
	}

	modelLower := strings.ToLower(modelID)

	// Klimasensoren
	if strings.Contains(modelLower, "cs_generic") || strings.Contains(modelLower, "climate") {
		return "climate_sensors"
	}

	// Heizkörper-Thermostate
	if strings.Contains(modelLower, "etrv") || strings.Contains(modelLower, "radiatoractuator") {
		return "radiator_thermostats"
	}

	// Fußboden-Thermostate (exclude zones, only include FHT actuators)
	if strings.Contains(modelLower, "fht") || strings.Contains(modelLower, "floor") {
		// Skip FHT_Zone devices - these are virtual zone devices without sensors
		if strings.Contains(modelLower, "fht_zone") || strings.Contains(modelLower, "zone") {
			return ""
		}
		return "floor_thermostats"
	}

	// Repeater
	if strings.Contains(modelLower, "repeater") {
		return "repeaters"
	}

	// Room Control
	if deviceType == "roomControl" || strings.Contains(modelLower, "roomcontrol") {
		return "room_control"
	}

	return "other"
}

// getCategoryDisplayName returns the German display name for a category
func getCategoryDisplayName(category string) string {
	names := map[string]string{
		"climate_sensors":      "Klimasensoren",
		"radiator_thermostats": "Heizkörper-Thermostate",
		"floor_thermostats":    "Fußboden-Thermostate",
		"repeaters":            "Repeater",
		"room_control":         "Raumsteuerung",
		"other":                "Sonstige Geräte",
	}
	if name, ok := names[category]; ok {
		return name
	}
	return category
}

// getCategoryIcon returns an icon emoji for a category
func getCategoryIcon(category string) string {
	icons := map[string]string{
		"climate_sensors":      "🌡️",
		"radiator_thermostats": "🔥",
		"floor_thermostats":    "🏠",
		"repeaters":            "📡",
		"room_control":         "🎛️",
		"other":                "📦",
	}
	if icon, ok := icons[category]; ok {
		return icon
	}
	return "📦"
}

// extractSmartClimateFeatures extracts relevant features for SmartClimate devices
func extractSmartClimateFeatures(rawFeatures []Feature) map[string]interface{} {
	features := make(map[string]interface{})

	for _, f := range rawFeatures {
		// Extract key features based on feature name
		// NOTE: Specific cases must come before generic cases!
		switch {
		// Floor heating supply temperature (specific - must come before generic temperature)
		case f.Feature == "fht.sensors.temperature.supply":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["supply_temperature"] = val["value"]
			}

		// TRV temperature (setpoint)
		case f.Feature == "trv.temperature":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["trv_setpoint"] = val["value"]
			}

		// TRV valve position
		case f.Feature == "trv.valve.position":
			if val, ok := f.Properties["position"].(map[string]interface{}); ok {
				features["valve_position"] = val["value"]
			}

		// Child lock
		case f.Feature == "trv.childLock":
			if val, ok := f.Properties["status"].(map[string]interface{}); ok {
				features["child_lock"] = val["value"]
			}

		// Temperature sensors (generic - must come after specific temperature cases)
		case strings.Contains(f.Feature, "sensors.temperature"):
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["temperature"] = val["value"]
				features["temperature_unit"] = val["unit"]
			}

		// Humidity sensors
		case strings.Contains(f.Feature, "sensors.humidity"):
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["humidity"] = val["value"]
			}

		// Floor heating operating mode
		case f.Feature == "fht.operating.modes.active":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["operating_mode"] = val["value"]
			}

		// Floor heating damage protection threshold (max supply temperature)
		case f.Feature == "fht.configuration.floorHeatingDamageProtectionThreshold":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["damage_protection_threshold"] = val["value"]
			}

		// Floor cooling condensation threshold
		case f.Feature == "fht.configuration.floorCoolingCondensationThreshold":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["condensation_threshold"] = val["value"]
			}

		// Heating circuit ID
		case f.Feature == "device.heatingCircuitId":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				features["heating_circuit_id"] = val["value"]
			}
		}
	}

	// Note: temperature vs trv_setpoint
	// - device.sensors.temperature = Ist-Temperatur (OPTO2 devices have this)
	// - trv.temperature = Soll-Temperatur (all TRVs have this)
	// - E3 devices get Ist-Temperatur from Room Control (rooms.X.sensors.temperature)
	//   which is not directly available at the device level

	return features
}

// smartClimateDevicesHandler returns categorized SmartClimate devices for an installation
func smartClimateDevicesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	installationID := r.URL.Query().Get("installationId")
	if installationID == "" {
		http.Error(w, "installationId parameter required", http.StatusBadRequest)
		return
	}

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

	// Map to collect devices by category
	categoriesMap := make(map[string][]SmartClimateDevice)

	// Iterate through all accounts to find devices
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

		// Iterate through all gateways and devices
		for _, gateway := range installation.Gateways {
			for _, device := range gateway.Devices {
				// Categorize device
				category := categorizeDevice(device.DeviceType, device.ModelID)
				if category == "" {
					continue // Skip non-SmartClimate devices
				}

				// Fetch features for this device
				features, err := fetchFeaturesWithCache(installationID, gateway.Serial, device.DeviceID, token.AccessToken)
				if err != nil {
					log.Printf("Failed to fetch features for device %s: %v\n", device.DeviceID, err)
					continue
				}

				// Get device name from local settings first, then from features
				deviceName := device.DeviceID
				deviceKey := fmt.Sprintf("%s:%s:%s", installationID, gateway.Serial, device.DeviceID)

				// Check for local name
				if account.DeviceSettings != nil {
					if settings, ok := account.DeviceSettings[deviceKey]; ok && settings.Name != "" {
						deviceName = settings.Name
					}
				}

				// Fallback to API name if no local name is set
				if deviceName == device.DeviceID {
					for _, f := range features.RawFeatures {
						if f.Feature == "device.name" {
							if name, ok := f.Properties["name"].(map[string]interface{}); ok {
								if nameStr, ok := name["value"].(string); ok {
									deviceName = nameStr
									break
								}
							}
						}
					}
				}

				// Extract battery level, signal strength and LQI timestamp
				var batteryLevel *int
				var signalStrength *int
				var lqiTimestamp string
				for _, f := range features.RawFeatures {
					if f.Feature == "device.power.battery" {
						if level, ok := f.Properties["level"].(map[string]interface{}); ok {
							if levelVal, ok := level["value"].(float64); ok {
								intLevel := int(levelVal)
								batteryLevel = &intLevel
							}
						}
					}
					if f.Feature == "device.zigbee.lqi" {
						if strength, ok := f.Properties["strength"].(map[string]interface{}); ok {
							if strengthVal, ok := strength["value"].(float64); ok {
								intStrength := int(strengthVal)
								signalStrength = &intStrength
							}
						}
						// Extract timestamp
						lqiTimestamp = f.Timestamp
					}
				}

				// Extract relevant features
				extractedFeatures := extractSmartClimateFeatures(features.RawFeatures)

				// Skip floor thermostats without any relevant features (zones)
				if category == "floor_thermostats" {
					hasRelevantFeature := false
					relevantKeys := []string{"supply_temperature", "operating_mode", "damage_protection_threshold", "condensation_threshold"}
					for _, key := range relevantKeys {
						if _, ok := extractedFeatures[key]; ok {
							hasRelevantFeature = true
							break
						}
					}
					if !hasRelevantFeature {
						log.Printf("Skipping floor thermostat zone device %s (no relevant features)\n", device.DeviceID)
						continue
					}
				}

				// Create SmartClimateDevice
				scDevice := SmartClimateDevice{
					DeviceID:       device.DeviceID,
					DeviceType:     device.DeviceType,
					ModelID:        device.ModelID,
					Name:           deviceName,
					Category:       category,
					GatewaySerial:  gateway.Serial,
					InstallationID: installationID,
					AccountID:      account.ID,
					Features:       extractedFeatures,
					Battery:        batteryLevel,
					SignalStrength: signalStrength,
					LQITimestamp:   lqiTimestamp,
				}

				categoriesMap[category] = append(categoriesMap[category], scDevice)
			}
		}
	}

	// Convert map to sorted list of categories
	var categories []SmartClimateCategory
	categoryOrder := []string{
		"climate_sensors",
		"radiator_thermostats",
		"floor_thermostats",
		"room_control",
		"repeaters",
		"other",
	}

	for _, catKey := range categoryOrder {
		if devices, ok := categoriesMap[catKey]; ok && len(devices) > 0 {
			categories = append(categories, SmartClimateCategory{
				Name:    getCategoryDisplayName(catKey),
				Icon:    getCategoryIcon(catKey),
				Devices: devices,
			})
		}
	}

	// Find installation description
	var installDesc string
	for _, account := range activeAccounts {
		token, err := ensureAccountAuthenticated(account)
		if err != nil {
			continue
		}
		if installation, ok := token.Installations[installationID]; ok {
			installDesc = installation.Description
			if installDesc == "" {
				installDesc = fmt.Sprintf("%s, %s", installation.Address.City, installation.Address.Country)
			}
			break
		}
	}

	response := SmartClimateDashboardResponse{
		InstallationID: installationID,
		Description:    installDesc,
		Categories:     categories,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// TRVSetTemperatureRequest represents the request to set target temperature
type TRVSetTemperatureRequest struct {
	AccountID      string  `json:"accountId"`
	InstallationID string  `json:"installationId"`
	GatewaySerial  string  `json:"gatewaySerial"`
	DeviceID       string  `json:"deviceId"`
	Temperature    float64 `json:"temperature"`
}

// trvSetTemperatureHandler sets the target temperature for a TRV
func trvSetTemperatureHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req TRVSetTemperatureRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate temperature range (typical range for TRVs)
	if req.Temperature < 5 || req.Temperature > 30 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Temperature must be between 5°C and 30°C",
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

	// Build API URL (ZigBee devices use v1 API)
	url := fmt.Sprintf("https://api.viessmann.com/iot/v2/features/installations/%s/gateways/%s/devices/%s/features/trv.temperature/commands/setTargetTemperature",
		req.InstallationID, req.GatewaySerial, req.DeviceID)

	// Prepare request body
	commandBody := map[string]interface{}{
		"temperature": req.Temperature,
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
	httpReq, err := http.NewRequest("POST", url, strings.NewReader(string(bodyBytes)))
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

	log.Printf("Set TRV temperature for device %s to %.1f°C\n", req.DeviceID, req.Temperature)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// DeviceSetNameRequest represents the request to set device name
type DeviceSetNameRequest struct {
	AccountID      string `json:"accountId"`
	InstallationID string `json:"installationId"`
	GatewaySerial  string `json:"gatewaySerial"`
	DeviceID       string `json:"deviceId"`
	Name           string `json:"name"`
}

// deviceSetNameHandler sets the name for a device (stored locally)
func deviceSetNameHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req DeviceSetNameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate name
	if len(req.Name) < 1 || len(req.Name) > 40 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Name must be between 1 and 40 characters",
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

	// Initialize DeviceSettings map if needed
	if account.DeviceSettings == nil {
		account.DeviceSettings = make(map[string]*DeviceSettings)
	}

	// Set device name (key format: installationId:gatewaySerial:deviceId)
	deviceKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	if account.DeviceSettings[deviceKey] == nil {
		account.DeviceSettings[deviceKey] = &DeviceSettings{}
	}
	account.DeviceSettings[deviceKey].Name = req.Name

	// Save account
	if err := UpdateAccount(account); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to save device name: " + err.Error(),
		})
		return
	}

	log.Printf("Set local device name for %s to: %s\n", req.DeviceID, req.Name)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// ChildLockToggleRequest represents the request to toggle child lock
type ChildLockToggleRequest struct {
	AccountID      string `json:"accountId"`
	InstallationID string `json:"installationId"`
	GatewaySerial  string `json:"gatewaySerial"`
	DeviceID       string `json:"deviceId"`
	Active         bool   `json:"active"`
}

// childLockToggleHandler toggles the child lock for a TRV
func childLockToggleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ChildLockToggleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
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

	// Determine command based on desired state
	command := "deactivate"
	if req.Active {
		command = "activate"
	}

	// Build API URL (ZigBee devices use v1 API)
	url := fmt.Sprintf("https://api.viessmann.com/iot/v2/features/installations/%s/gateways/%s/devices/%s/features/trv.childLock/commands/%s",
		req.InstallationID, req.GatewaySerial, req.DeviceID, command)

	// Create HTTP request (empty body for these commands)
	httpReq, err := http.NewRequest("POST", url, strings.NewReader("{}"))
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

	log.Printf("Set child lock for device %s to: %v\n", req.DeviceID, req.Active)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}
