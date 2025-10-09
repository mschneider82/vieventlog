package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
)

// Room represents aggregated data for a room from RoomControl
type Room struct {
	RoomID            int                    `json:"roomId"`
	RoomName          string                 `json:"roomName"` // User-defined name or default "Raum X"
	InstallationID    string                 `json:"installationId"`
	AccountID         string                 `json:"accountId"`
	GatewaySerial     string                 `json:"gatewaySerial"` // Required for API calls
	Temperature       *float64               `json:"temperature,omitempty"`
	TemperatureStatus string                 `json:"temperatureStatus,omitempty"` // "connected" or "notConnected"
	Humidity          *float64               `json:"humidity,omitempty"`
	HumidityStatus    string                 `json:"humidityStatus,omitempty"`
	CO2               *float64               `json:"co2,omitempty"`
	CondensationRisk  bool                   `json:"condensationRisk"`
	WindowOpen        bool                   `json:"windowOpen"`
	HeatingSetpoint   *float64               `json:"heatingSetpoint,omitempty"`
	CoolingSetpoint   *float64               `json:"coolingSetpoint,omitempty"`
	ChildLock         string                 `json:"childLock,omitempty"` // "active" or "inactive"
	RawFeatures       map[string]interface{} `json:"rawFeatures,omitempty"`
}

// RoomsResponse is the response for rooms listing
type RoomsResponse struct {
	InstallationID string `json:"installationId"`
	Description    string `json:"description"`
	Rooms          []Room `json:"rooms"`
}

// SetRoomNameRequest represents the request to set a room name
type SetRoomNameRequest struct {
	AccountID      string `json:"accountId"`
	InstallationID string `json:"installationId"`
	RoomID         int    `json:"roomId"`
	Name           string `json:"name"`
}

// SetRoomTemperatureRequest represents the request to set a room temperature
type SetRoomTemperatureRequest struct {
	AccountID         string  `json:"accountId"`
	InstallationID    string  `json:"installationId"`
	GatewaySerial     string  `json:"gatewaySerial"`
	RoomID            int     `json:"roomId"`
	TargetTemperature float64 `json:"targetTemperature"`
}

// extractRoomData extracts room data from RoomControl features
func extractRoomData(installationID, accountID, gatewaySerial string, features []Feature) []Room {
	roomsMap := make(map[int]*Room)

	for _, f := range features {
		// Parse room ID from feature name (e.g., "rooms.0.sensors.temperature" -> room 0)
		if !strings.HasPrefix(f.Feature, "rooms.") {
			continue
		}

		parts := strings.Split(f.Feature, ".")
		if len(parts) < 3 {
			continue
		}

		roomIDStr := parts[1]
		roomID, err := strconv.Atoi(roomIDStr)
		if err != nil {
			continue
		}

		// Initialize room if not exists
		if _, exists := roomsMap[roomID]; !exists {
			roomsMap[roomID] = &Room{
				RoomID:         roomID,
				RoomName:       fmt.Sprintf("Raum %d", roomID),
				InstallationID: installationID,
				AccountID:      accountID,
				GatewaySerial:  gatewaySerial,
				RawFeatures:    make(map[string]interface{}),
			}
		}

		room := roomsMap[roomID]
		featureType := strings.Join(parts[2:], ".")

		// Extract relevant values
		switch featureType {
		case "sensors.temperature":
			if status, ok := f.Properties["status"].(map[string]interface{}); ok {
				if statusVal, ok := status["value"].(string); ok {
					room.TemperatureStatus = statusVal
				}
			}
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				if tempVal, ok := val["value"].(float64); ok {
					room.Temperature = &tempVal
				}
			}

		case "sensors.humidity":
			if status, ok := f.Properties["status"].(map[string]interface{}); ok {
				if statusVal, ok := status["value"].(string); ok {
					room.HumidityStatus = statusVal
				}
			}
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				if humVal, ok := val["value"].(float64); ok {
					room.Humidity = &humVal
				}
			}

		case "co2":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				if co2Val, ok := val["value"].(float64); ok {
					room.CO2 = &co2Val
				}
			}

		case "condensationRisk":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				if riskVal, ok := val["value"].(bool); ok {
					room.CondensationRisk = riskVal
				}
			}

		case "sensors.openWindow", "sensors.window.openState":
			if val, ok := f.Properties["value"].(map[string]interface{}); ok {
				if windowVal, ok := val["value"].(bool); ok {
					room.WindowOpen = windowVal
				}
			}

		case "temperature.levels.heating":
			if val, ok := f.Properties["temperature"].(map[string]interface{}); ok {
				if heatVal, ok := val["value"].(float64); ok {
					room.HeatingSetpoint = &heatVal
				}
			}

		case "temperature.levels.normal.perceived":
			// Normal heating setpoint (used by ViGuide)
			if val, ok := f.Properties["temperature"].(map[string]interface{}); ok {
				if heatVal, ok := val["value"].(float64); ok {
					room.HeatingSetpoint = &heatVal
				}
			}

		case "temperature.levels.cooling":
			if val, ok := f.Properties["temperature"].(map[string]interface{}); ok {
				if coolVal, ok := val["value"].(float64); ok {
					room.CoolingSetpoint = &coolVal
				}
			}

		case "childLock":
			if val, ok := f.Properties["status"].(map[string]interface{}); ok {
				if lockVal, ok := val["value"].(string); ok {
					room.ChildLock = lockVal
				}
			}
		}

		// Store raw feature for debugging
		room.RawFeatures[featureType] = f.Properties
	}

	// Convert map to slice and filter out empty rooms
	var rooms []Room
	for roomID := 0; roomID < 20; roomID++ {
		if room, exists := roomsMap[roomID]; exists {
			// Only include rooms that have at least one meaningful data point
			if room.Temperature != nil || room.Humidity != nil || room.CO2 != nil ||
				room.HeatingSetpoint != nil || room.CoolingSetpoint != nil {
				rooms = append(rooms, *room)
			}
		}
	}

	return rooms
}

// roomsHandler returns all rooms for an installation
func roomsHandler(w http.ResponseWriter, r *http.Request) {
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

	var allRooms []Room
	var installDesc string

	// Iterate through accounts to find RoomControl devices
	for _, account := range activeAccounts {
		token, err := ensureAccountAuthenticated(account)
		if err != nil {
			log.Printf("Failed to authenticate account %s: %v\n", account.Email, err)
			continue
		}

		installation, ok := token.Installations[installationID]
		if !ok {
			continue
		}

		if installDesc == "" {
			installDesc = installation.Description
			if installDesc == "" {
				installDesc = fmt.Sprintf("%s, %s", installation.Address.City, installation.Address.Country)
			}
		}

		// Find RoomControl devices
		for _, gateway := range installation.Gateways {
			for _, device := range gateway.Devices {
				if device.DeviceType != "roomControl" {
					continue
				}

				// Fetch features for RoomControl device
				features, err := fetchFeaturesWithCache(installationID, gateway.Serial, device.DeviceID, token.AccessToken)
				if err != nil {
					log.Printf("Failed to fetch features for RoomControl %s: %v\n", device.DeviceID, err)
					continue
				}

				// Extract room data
				rooms := extractRoomData(installationID, account.ID, gateway.Serial, features.RawFeatures)

				// Apply user-defined room names
				for i := range rooms {
					roomKey := fmt.Sprintf("%s:%d", installationID, rooms[i].RoomID)
					if account.RoomSettings != nil {
						if settings, ok := account.RoomSettings[roomKey]; ok && settings.Name != "" {
							rooms[i].RoomName = settings.Name
						}
					}
				}

				allRooms = append(allRooms, rooms...)
			}
		}
	}

	response := RoomsResponse{
		InstallationID: installationID,
		Description:    installDesc,
		Rooms:          allRooms,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// setRoomNameHandler sets a user-defined name for a room
func setRoomNameHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SetRoomNameRequest
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

	// Initialize RoomSettings map if needed
	if account.RoomSettings == nil {
		account.RoomSettings = make(map[string]*RoomSettings)
	}

	// Set room name
	roomKey := fmt.Sprintf("%s:%d", req.InstallationID, req.RoomID)
	account.RoomSettings[roomKey] = &RoomSettings{
		Name: req.Name,
	}

	// Save account
	if err := UpdateAccount(account); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to save room name: " + err.Error(),
		})
		return
	}

	log.Printf("Set room name for %s room %d to: %s\n", req.InstallationID, req.RoomID, req.Name)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// setRoomTemperatureHandler sets the target temperature for a room
func setRoomTemperatureHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SetRoomTemperatureRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate temperature range (typical range for room temperature)
	if req.TargetTemperature < 10 || req.TargetTemperature > 30 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Temperature must be between 10°C and 30°C",
		})
		return
	}

	// Get account and ensure authenticated
	account, err := GetAccount(req.AccountID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found: " + err.Error(),
		})
		return
	}

	token, err := ensureAccountAuthenticated(account)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Authentication failed: " + err.Error(),
		})
		return
	}

	// Build API URL
	// Format: /installations/{id}/gateways/{gateway}/devices/RoomControl-1/features/rooms.{roomId}.temperature.levels.normal.perceived/commands/setTemperature
	url := fmt.Sprintf("https://api.viessmann-climatesolutions.com/iot/v2/features/installations/%s/gateways/%s/devices/RoomControl-1/features/rooms.%d.temperature.levels.normal.perceived/commands/setTemperature",
		req.InstallationID, req.GatewaySerial, req.RoomID)

	// Create request body
	body := map[string]interface{}{
		"targetTemperature": req.TargetTemperature,
	}
	bodyJSON, err := json.Marshal(body)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API request
	apiReq, err := http.NewRequest("POST", url, strings.NewReader(string(bodyJSON)))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	apiReq.Header.Set("Authorization", "Bearer "+token.AccessToken)
	apiReq.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(apiReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "API request failed: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("API returned status %d", resp.StatusCode),
		})
		return
	}

	log.Printf("Set room temperature for installation %s room %d to %.1f°C\n", req.InstallationID, req.RoomID, req.TargetTemperature)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}
