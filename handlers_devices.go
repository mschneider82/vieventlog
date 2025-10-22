package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// Device Settings Handlers

func deviceSettingsGetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	accountID := r.URL.Query().Get("accountId")
	installationID := r.URL.Query().Get("installationId")
	deviceID := r.URL.Query().Get("deviceId")

	if accountID == "" || installationID == "" || deviceID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DeviceSettingsResponse{
			Success: false,
			Error:   "accountId, installationId, and deviceId are required",
		})
		return
	}

	deviceKey := fmt.Sprintf("%s_%s", installationID, deviceID)
	settings, err := GetDeviceSettings(accountID, deviceKey)
	if err != nil {
		// No settings found is not an error - return empty settings
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DeviceSettingsResponse{
			Success: true,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(DeviceSettingsResponse{
		Success:          true,
		CompressorRpmMin: settings.CompressorRpmMin,
		CompressorRpmMax: settings.CompressorRpmMax,
	})
}

func deviceSettingsSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req DeviceSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DeviceSettingsResponse{
			Success: false,
			Error:   "Invalid request: " + err.Error(),
		})
		return
	}

	if req.AccountID == "" || req.InstallationID == "" || req.DeviceID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DeviceSettingsResponse{
			Success: false,
			Error:   "accountId, installationId, and deviceId are required",
		})
		return
	}

	deviceKey := fmt.Sprintf("%s_%s", req.InstallationID, req.DeviceID)
	settings := &DeviceSettings{
		CompressorRpmMin: req.CompressorRpmMin,
		CompressorRpmMax: req.CompressorRpmMax,
	}

	if err := SetDeviceSettings(req.AccountID, deviceKey, settings); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DeviceSettingsResponse{
			Success: false,
			Error:   "Failed to save settings: " + err.Error(),
		})
		return
	}

	log.Printf("Device settings saved for %s (account: %s): min=%d, max=%d\n",
		deviceKey, req.AccountID, req.CompressorRpmMin, req.CompressorRpmMax)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(DeviceSettingsResponse{Success: true})
}

func deviceSettingsDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req DeviceSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DeviceSettingsResponse{
			Success: false,
			Error:   "Invalid request: " + err.Error(),
		})
		return
	}

	if req.AccountID == "" || req.InstallationID == "" || req.DeviceID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DeviceSettingsResponse{
			Success: false,
			Error:   "accountId, installationId, and deviceId are required",
		})
		return
	}

	deviceKey := fmt.Sprintf("%s_%s", req.InstallationID, req.DeviceID)

	if err := DeleteDeviceSettings(req.AccountID, deviceKey); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DeviceSettingsResponse{
			Success: false,
			Error:   "Failed to delete settings: " + err.Error(),
		})
		return
	}

	log.Printf("Device settings deleted for %s (account: %s)\n", deviceKey, req.AccountID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(DeviceSettingsResponse{Success: true})
}

// DHW (Domestic Hot Water) Control Handlers

func dhwModeSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string `json:"accountId"`
		InstallationID string `json:"installationId"`
		GatewaySerial  string `json:"gatewaySerial"`
		DeviceID       string `json:"deviceId"`
		Mode           string `json:"mode"` // eco, comfort, off
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" || req.Mode == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, deviceId, and mode are required",
		})
		return
	}

	// Validate mode
	validModes := map[string]bool{
		"efficient":               true,
		"efficientWithMinComfort": true,
		"off":                     true,
	}
	if !validModes[req.Mode] {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid mode. Must be one of: efficient, efficientWithMinComfort, off",
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v1/features/installations/%s/gateways/%s/devices/%s/features/heating.dhw.operating.modes.active/commands/setMode",
		req.InstallationID, req.GatewaySerial, req.DeviceID)

	// Prepare request body
	requestBody := map[string]string{
		"mode": req.Mode,
	}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
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

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("DHW mode changed to '%s' for device %s (account: %s)", req.Mode, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func dhwTemperatureSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string  `json:"accountId"`
		InstallationID string  `json:"installationId"`
		GatewaySerial  string  `json:"gatewaySerial"`
		DeviceID       string  `json:"deviceId"`
		Temperature    float64 `json:"temperature"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, deviceId, and temperature are required",
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v1/features/installations/%s/gateways/%s/devices/%s/features/heating.dhw.temperature.main/commands/setTargetTemperature",
		req.InstallationID, req.GatewaySerial, req.DeviceID)

	// Prepare request body
	requestBody := map[string]int{
		"temperature": int(req.Temperature),
	}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
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

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("DHW temperature changed to %.1f°C for device %s (account: %s)", req.Temperature, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func dhwHysteresisSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string  `json:"accountId"`
		InstallationID string  `json:"installationId"`
		GatewaySerial  string  `json:"gatewaySerial"`
		DeviceID       string  `json:"deviceId"`
		Type           string  `json:"type"` // "on" or "off"
		Value          float64 `json:"value"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" || req.Type == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, deviceId, type, and value are required",
		})
		return
	}

	// Validate type
	var command string
	if req.Type == "on" {
		command = "setHysteresisSwitchOnValue"
	} else if req.Type == "off" {
		command = "setHysteresisSwitchOffValue"
	} else {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid type. Must be 'on' or 'off'",
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v1/features/installations/%s/gateways/%s/devices/%s/features/heating.dhw.temperature.hysteresis/commands/%s",
		req.InstallationID, req.GatewaySerial, req.DeviceID, command)

	// Prepare request body
	requestBody := map[string]float64{
		"hysteresis": req.Value,
	}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
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

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("DHW hysteresis %s changed to %.1fK for device %s (account: %s)", req.Type, req.Value, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func dhwOneTimeChargeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string `json:"accountId"`
		InstallationID string `json:"installationId"`
		GatewaySerial  string `json:"gatewaySerial"`
		DeviceID       string `json:"deviceId"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, and deviceId are required",
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v1/features/installations/%s/gateways/%s/devices/%s/features/heating.dhw.oneTimeCharge/commands/activate",
		req.InstallationID, req.GatewaySerial, req.DeviceID)

	// Prepare empty request body
	requestBody := map[string]interface{}{}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
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

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("DHW one-time charge activated for device %s (account: %s)", req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// Heating Control Handlers

func heatingCurveSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string  `json:"accountId"`
		InstallationID string  `json:"installationId"`
		GatewaySerial  string  `json:"gatewaySerial"`
		DeviceID       string  `json:"deviceId"`
		Circuit        int     `json:"circuit"` // Circuit number, usually 0
		Shift          int     `json:"shift"`
		Slope          float64 `json:"slope"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, deviceId are required",
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v1/features/installations/%s/gateways/%s/devices/%s/features/heating.circuits.%d.heating.curve/commands/setCurve",
		req.InstallationID, req.GatewaySerial, req.DeviceID, req.Circuit)

	// Prepare request body - shift as int, slope as float rounded to 1 decimal
	requestBody := map[string]interface{}{
		"shift": req.Shift,
		"slope": float64(int(req.Slope*10+0.5)) / 10, // Round to 1 decimal
	}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
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

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("Heating curve changed to shift=%d, slope=%.1f for device %s (account: %s)", req.Shift, req.Slope, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func heatingModeSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string `json:"accountId"`
		InstallationID string `json:"installationId"`
		GatewaySerial  string `json:"gatewaySerial"`
		DeviceID       string `json:"deviceId"`
		Circuit        int    `json:"circuit"` // Circuit number, usually 0
		Mode           string `json:"mode"`    // heating, standby
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" || req.Mode == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, deviceId, and mode are required",
		})
		return
	}

	// Validate mode
	validModes := map[string]bool{
		"heating":        true,
		"standby":        true,
		"cooling":        true,
		"heatingCooling": true,
	}
	if !validModes[req.Mode] {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid mode. Must be one of: heating, standby, cooling, heatingCooling",
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v1/features/installations/%s/gateways/%s/devices/%s/features/heating.circuits.%d.operating.modes.active/commands/setMode",
		req.InstallationID, req.GatewaySerial, req.DeviceID, req.Circuit)

	// Prepare request body
	requestBody := map[string]string{
		"mode": req.Mode,
	}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
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

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("Heating mode changed to '%s' for device %s (account: %s)", req.Mode, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func supplyTempMaxSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string `json:"accountId"`
		InstallationID string `json:"installationId"`
		GatewaySerial  string `json:"gatewaySerial"`
		DeviceID       string `json:"deviceId"`
		Circuit        int    `json:"circuit"` // Circuit number, usually 0
		Temperature    int    `json:"temperature"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, deviceId, and temperature are required",
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL - NOTE: using v2 API!
	url := fmt.Sprintf("https://api.viessmann.com/iot/v2/features/installations/%s/gateways/%s/devices/%s/features/heating.circuits.%d.temperature.levels/commands/setMax",
		req.InstallationID, req.GatewaySerial, req.DeviceID, req.Circuit)

	// Prepare request body
	requestBody := map[string]int{
		"temperature": req.Temperature,
	}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
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

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("Supply temperature max changed to %d°C for device %s (account: %s)", req.Temperature, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func roomTempSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string `json:"accountId"`
		InstallationID string `json:"installationId"`
		GatewaySerial  string `json:"gatewaySerial"`
		DeviceID       string `json:"deviceId"`
		Circuit        int    `json:"circuit"` // Circuit number, usually 0
		Temperature    int    `json:"temperature"`
		Program        string `json:"program"` // Program: normal, comfort, reduced
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" || req.Program == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, deviceId, program, and temperature are required",
		})
		return
	}

	// Validate program - accept various program types
	validPrograms := map[string]bool{
		"normal":                     true,
		"normalHeating":              true,
		"normalCooling":              true,
		"normalEnergySaving":         true,
		"normalCoolingEnergySaving":  true,
		"comfort":                    true,
		"comfortHeating":             true,
		"comfortCooling":             true,
		"comfortEnergySaving":        true,
		"comfortCoolingEnergySaving": true,
		"reduced":                    true,
		"reducedHeating":             true,
		"reducedCooling":             true,
		"reducedEnergySaving":        true,
		"reducedCoolingEnergySaving": true,
		"eco":                        true,
		"fixed":                      true,
		"standby":                    true,
		"frostprotection":            true,
		"forcedLastFromSchedule":     true,
		"summerEco":                  true,
	}
	if !validPrograms[req.Program] {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Invalid program: %s", req.Program),
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v1/equipment/installations/%s/gateways/%s/devices/%s/features/heating.circuits.%d.operating.programs.%s/commands/setTemperature",
		req.InstallationID, req.GatewaySerial, req.DeviceID, req.Circuit, req.Program)

	// Prepare request body
	requestBody := map[string]int{
		"targetTemperature": req.Temperature,
	}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
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

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("Room temperature for program %s changed to %d°C for circuit %d, device %s (account: %s)", req.Program, req.Temperature, req.Circuit, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// Other Device Control Handlers

func noiseReductionModeSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string `json:"accountId"`
		InstallationID string `json:"installationId"`
		GatewaySerial  string `json:"gatewaySerial"`
		DeviceID       string `json:"deviceId"`
		Mode           string `json:"mode"` // notReduced, slightlyReduced, maxReduced
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" || req.Mode == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, deviceId, and mode are required",
		})
		return
	}

	// Validate mode
	validModes := map[string]bool{
		"notReduced":      true,
		"slightlyReduced": true,
		"maxReduced":      true,
	}
	if !validModes[req.Mode] {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid mode. Must be one of: notReduced, slightlyReduced, maxReduced",
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v1/features/installations/%s/gateways/%s/devices/%s/features/heating.noise.reduction.operating.programs.active/commands/setMode",
		req.InstallationID, req.GatewaySerial, req.DeviceID)

	// Prepare request body
	requestBody := map[string]string{
		"mode": req.Mode,
	}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
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

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("Noise reduction mode changed to '%s' for device %s (account: %s)", req.Mode, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}
