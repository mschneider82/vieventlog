package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"
)

// eventsHandler handles GET /api/events
// Returns events for the last N days (default: 7)
func eventsHandler(w http.ResponseWriter, r *http.Request) {
	daysStr := r.URL.Query().Get("days")
	days := 7
	if daysStr != "" {
		if d, err := strconv.Atoi(daysStr); err == nil {
			days = d
		}
	}

	events, err := fetchEvents(days)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(events)
}

// statusHandler handles GET /api/status
// Returns connection status, device count, and cache statistics
func statusHandler(w http.ResponseWriter, r *http.Request) {
	status := StatusResponse{}

	// Get active accounts
	activeAccounts, err := GetActiveAccounts()
	if err != nil {
		status.Connected = false
		status.Error = err.Error()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(status)
		return
	}

	if len(activeAccounts) == 0 {
		// Fallback to legacy system
		err := ensureAuthenticated()
		if err != nil {
			status.Connected = false
			status.Error = err.Error()
		} else {
			status.Connected = true
			if len(installationIDs) > 0 {
				status.DeviceID = fmt.Sprintf("%d installations: %v", len(installationIDs), installationIDs)
			}
			status.CachedEvents = len(eventsCache)
			if !lastFetchTime.IsZero() {
				t := lastFetchTime.Format(time.RFC3339)
				status.LastFetch = &t
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(status)
		return
	}

	// Multi-account system
	status.Connected = true
	totalInstallations := 0
	accountNames := make([]string, 0, len(activeAccounts))

	// Ensure accounts are authenticated to get installation counts
	for _, account := range activeAccounts {
		accountNames = append(accountNames, account.Name)

		// Try to get or create token for this account
		token, err := ensureAccountAuthenticated(account)
		if err != nil {
			log.Printf("Warning: Failed to authenticate account %s for status: %v\n", account.Email, err)
			continue
		}

		totalInstallations += len(token.InstallationIDs)
	}

	if len(activeAccounts) == 1 {
		status.DeviceID = fmt.Sprintf("%s (%d installations)", activeAccounts[0].Name, totalInstallations)
	} else {
		status.DeviceID = fmt.Sprintf("%d accounts (%d installations)", len(activeAccounts), totalInstallations)
	}

	status.CachedEvents = len(eventsCache)
	if !lastFetchTime.IsZero() {
		t := lastFetchTime.Format(time.RFC3339)
		status.LastFetch = &t
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// devicesHandler handles GET /api/devices
// Returns all devices from all installations, grouped by installation
func devicesHandler(w http.ResponseWriter, r *http.Request) {
	// Get active accounts and ensure they're authenticated
	activeAccounts, err := GetActiveAccounts()
	if err == nil && len(activeAccounts) > 0 {
		// Authenticate all active accounts to populate accountTokens
		for _, account := range activeAccounts {
			_, err := ensureAccountAuthenticated(account)
			if err != nil {
				log.Printf("Warning: Failed to authenticate account %s for devices: %v\n", account.Email, err)
			}
		}
	} else if err == nil && len(activeAccounts) == 0 {
		// Fallback to legacy system
		if currentCreds != nil {
			if err := ensureAuthenticated(); err != nil {
				log.Printf("Warning: Failed to authenticate legacy credentials: %v\n", err)
			}
		}
	}

	// Build a unified installations map from all account tokens
	// Track which account owns each installation
	allInstallations := make(map[string]*Installation)
	installationToAccount := make(map[string]string) // installationID -> accountID

	accountsMutex.RLock()
	for accountID, token := range accountTokens {
		for id, installation := range token.Installations {
			allInstallations[id] = installation
			installationToAccount[id] = accountID
		}
	}
	accountsMutex.RUnlock()

	// Also include legacy installations
	if installations != nil {
		for id, installation := range installations {
			if _, exists := allInstallations[id]; !exists {
				allInstallations[id] = installation
				// Legacy installations don't have an account ID
				installationToAccount[id] = ""
			}
		}
	}

	// Group devices by installation - use gateway data (not events!)
	devicesByInstallation := make(map[string]map[string]Device)

	// Build device list from installations' gateway data
	for installID, installation := range allInstallations {
		if _, exists := devicesByInstallation[installID]; !exists {
			devicesByInstallation[installID] = make(map[string]Device)
		}

		accountID := installationToAccount[installID]

		// Iterate through gateways and their devices
		for _, gateway := range installation.Gateways {
			for _, gwDevice := range gateway.Devices {
				// Include heating and zigbee devices (SmartClimate)
				if gwDevice.DeviceType != "heating" && gwDevice.DeviceType != "zigbee" {
					continue
				}

				// Try to get device name from features
				displayName := gwDevice.ModelID

				// Get access token for this account
				accountsMutex.RLock()
				token, hasToken := accountTokens[accountID]
				accountsMutex.RUnlock()

				if hasToken && token.AccessToken != "" {
					// Try to fetch device.name feature
					deviceName := getDeviceNameFromFeatures(installID, gateway.Serial, gwDevice.DeviceID, token.AccessToken)
					if deviceName != "" {
						displayName = deviceName
					}
				}

				key := fmt.Sprintf("%s_%s", gateway.Serial, gwDevice.DeviceID)
				devicesByInstallation[installID][key] = Device{
					DeviceID:       gwDevice.DeviceID,
					ModelID:        gwDevice.ModelID,
					DisplayName:    displayName,
					InstallationID: installID,
					GatewaySerial:  gateway.Serial,
					AccountID:      accountID,
				}
				log.Printf("Registered %s device in installation %s: %s (Gateway %s, Device %s, Account %s)\n",
					gwDevice.DeviceType, installID, displayName, gateway.Serial, gwDevice.DeviceID, accountID)
			}
		}
	}

	// Build response grouped by installation
	response := make([]DevicesByInstallation, 0)

	for installID, devices := range devicesByInstallation {
		installation := allInstallations[installID]
		location := "Unknown"
		description := ""

		if installation != nil {
			description = installation.Description
			if installation.Address.City != "" {
				location = fmt.Sprintf("%s %s, %s %s",
					installation.Address.Street,
					installation.Address.HouseNumber,
					installation.Address.Zip,
					installation.Address.City)
			}
		}

		deviceList := make([]Device, 0, len(devices))
		for _, device := range devices {
			deviceList = append(deviceList, device)
		}

		response = append(response, DevicesByInstallation{
			InstallationID: installID,
			Location:       location,
			Description:    description,
			Devices:        deviceList,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// featuresHandler handles GET /api/features
// Returns device features for a specific installation/gateway/device
// Query parameters: installationId (required), gatewaySerial (optional), deviceId (default: "0"), refresh (default: false)
func featuresHandler(w http.ResponseWriter, r *http.Request) {
	// Get query parameters
	installationID := r.URL.Query().Get("installationId")
	gatewaySerial := r.URL.Query().Get("gatewaySerial")
	deviceID := r.URL.Query().Get("deviceId")
	forceRefresh := r.URL.Query().Get("refresh") == "true"

	if installationID == "" {
		http.Error(w, "installationId parameter required", http.StatusBadRequest)
		return
	}

	if deviceID == "" {
		deviceID = "0" // Default device
	}

	log.Printf("Features request: installation=%s, gateway=%s, device=%s, forceRefresh=%v\n", installationID, gatewaySerial, deviceID, forceRefresh)

	// Get active accounts to find the right token
	activeAccounts, err := GetActiveAccounts()
	var accessToken string
	var gatewayID string

	// Use provided gateway serial if available
	if gatewaySerial != "" {
		gatewayID = gatewaySerial
	}

	if err == nil && len(activeAccounts) > 0 {
		// Try to find the account that owns this installation
		for _, account := range activeAccounts {
			token, err := ensureAccountAuthenticated(account)
			if err != nil {
				continue
			}

			// Check if this account has this installation
			for _, instID := range token.InstallationIDs {
				if instID == installationID {
					accessToken = token.AccessToken

					// Only try to get gateway from installation if not provided
					if gatewayID == "" {
						if installation, ok := token.Installations[installationID]; ok {
							if len(installation.Gateways) > 0 {
								gatewayID = installation.Gateways[0].Serial
							}
						}
					}
					break
				}
			}
			if accessToken != "" {
				break
			}
		}
	}

	// Fallback to legacy single account if no token found
	if accessToken == "" {
		if err := ensureAuthenticated(); err != nil {
			http.Error(w, "Authentication failed: "+err.Error(), http.StatusUnauthorized)
			return
		}
		// Use the global access token from legacy system
		accessToken = getGlobalAccessToken()
		// Only try to get gateway from installations if not provided
		if gatewayID == "" {
			if installation, ok := installations[installationID]; ok {
				if len(installation.Gateways) > 0 {
					gatewayID = installation.Gateways[0].Serial
				}
			}
		}
	}

	if accessToken == "" {
		http.Error(w, "No access token available for this installation", http.StatusUnauthorized)
		return
	}

	if gatewayID == "" {
		// Try to get gateway from cached events (they contain gatewaySerial)
		gatewayID = getGatewayFromEvents(installationID)

		if gatewayID == "" {
			// Last resort: try to fetch from API
			gatewayID, err = fetchGatewayIDForInstallation(installationID, accessToken)
			if err != nil {
				http.Error(w, "Failed to determine gateway ID: "+err.Error()+". Tip: Load events first to populate gateway information.", http.StatusInternalServerError)
				return
			}
		}
	}

	// Fetch features with caching (or force refresh)
	var features *DeviceFeatures
	if forceRefresh {
		log.Printf("Force refresh - bypassing cache for %s:%s:%s\n", installationID, gatewayID, deviceID)
		features, err = fetchFeaturesForDevice(installationID, gatewayID, deviceID, accessToken)
		if err != nil {
			http.Error(w, "Failed to fetch features: "+err.Error(), http.StatusInternalServerError)
			return
		}
		// Update cache with fresh data
		cacheKey := fmt.Sprintf("%s:%s:%s", installationID, gatewayID, deviceID)
		featuresCacheMutex.Lock()
		featuresCache[cacheKey] = features
		featuresCacheMutex.Unlock()
	} else {
		features, err = fetchFeaturesWithCache(installationID, gatewayID, deviceID, accessToken)
		if err != nil {
			http.Error(w, "Failed to fetch features: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(features)
}

// debugDevicesHandler handles GET /api/debug/devices
// Returns detailed device information for debugging purposes
// Query parameters: onlyUnknown (default: false), includeFeatures (default: false)
func debugDevicesHandler(w http.ResponseWriter, r *http.Request) {
	// Check query parameters
	onlyUnknown := r.URL.Query().Get("onlyUnknown") == "true"
	includeFeatures := r.URL.Query().Get("includeFeatures") == "true"

	// Build a unified installations map from all account tokens
	allInstallations := make(map[string]*Installation)
	accountNames := make(map[string]string)    // installationID -> accountName
	accountTokenMap := make(map[string]string) // installationID -> accessToken

	accountsMutex.RLock()
	for accountID, token := range accountTokens {
		// Get account name
		account, _ := GetAccount(accountID)
		accountName := accountID
		if account != nil {
			accountName = account.Name
		}

		for id, installation := range token.Installations {
			allInstallations[id] = installation
			accountNames[id] = accountName
			accountTokenMap[id] = token.AccessToken
		}
	}
	accountsMutex.RUnlock()

	// Also include legacy installations
	if installations != nil {
		for id, installation := range installations {
			if _, exists := allInstallations[id]; !exists {
				allInstallations[id] = installation
				accountNames[id] = "Legacy Account"
				accountTokenMap[id] = accessToken
			}
		}
	}

	// Collect all devices
	debugDevices := make([]DebugDeviceInfo, 0)
	unknownCount := 0

	for installID, installation := range allInstallations {
		for _, gateway := range installation.Gateways {
			for _, gwDevice := range gateway.Devices {
				isUnknown := gwDevice.DeviceType != "heating"

				// Count unknown devices
				if isUnknown {
					unknownCount++
				}

				// Skip known devices if only unknown requested
				if onlyUnknown && !isUnknown {
					continue
				}

				deviceInfo := DebugDeviceInfo{
					InstallationID:   installID,
					InstallationDesc: installation.Description,
					GatewaySerial:    gateway.Serial,
					DeviceID:         gwDevice.DeviceID,
					DeviceType:       gwDevice.DeviceType,
					ModelID:          gwDevice.ModelID,
					AccountName:      accountNames[installID],
				}

				// Fetch features if requested
				if includeFeatures {
					if token, ok := accountTokenMap[installID]; ok {
						features, err := fetchFeaturesForDevice(installID, gateway.Serial, gwDevice.DeviceID, token)
						if err != nil {
							deviceInfo.FeaturesError = err.Error()
							log.Printf("Failed to fetch features for %s/%s/%s: %v\n",
								installID, gateway.Serial, gwDevice.DeviceID, err)
						} else if features != nil {
							deviceInfo.Features = features.RawFeatures
						}
					}
				}

				debugDevices = append(debugDevices, deviceInfo)
			}
		}
	}

	response := DebugDevicesResponse{
		TotalDevices:     len(debugDevices),
		UnknownDevices:   unknownCount,
		Devices:          debugDevices,
		IncludesFeatures: includeFeatures,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
