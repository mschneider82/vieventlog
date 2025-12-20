package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Cache variables for API functions
var (
	// Features cache
	featuresCache      = make(map[string]*DeviceFeatures) // key: installationID:gatewayID:deviceID
	featuresCacheMutex sync.RWMutex
)

// fetchEvents fetches events from all active accounts with cursor-based pagination
func fetchEvents(daysBack int) ([]Event, error) {
	fetchMutex.Lock()
	defer fetchMutex.Unlock()

	// Check cache (5 minutes)
	if !lastFetchTime.IsZero() && time.Since(lastFetchTime) < 5*time.Minute {
		return eventsCache, nil
	}

	// Get active accounts
	activeAccounts, err := GetActiveAccounts()
	if err != nil {
		return eventsCache, fmt.Errorf("failed to get active accounts: %w", err)
	}

	if len(activeAccounts) == 0 {
		// Fallback to legacy single credential
		if currentCreds != nil {
			return fetchEventsLegacy(daysBack)
		}
		return nil, fmt.Errorf("no active accounts found")
	}

	// Fetch events from all active accounts
	allEvents := make([]Event, 0)

	for _, account := range activeAccounts {
		log.Printf("Fetching events for account: %s (%s)\n", account.Name, account.Email)

		// Ensure this account is authenticated
		token, err := ensureAccountAuthenticated(account)
		if err != nil {
			log.Printf("Failed to authenticate account %s: %v\n", account.Email, err)
			continue
		}

		// Fetch events from all installations for this account
		for _, installationID := range token.InstallationIDs {
			accountEvents, err := fetchEventsForInstallation(installationID, token.AccessToken, account, daysBack)
			if err != nil {
				log.Printf("Error fetching events for installation %s: %v\n", installationID, err)
				continue
			}

			allEvents = append(allEvents, accountEvents...)
			log.Printf("Fetched %d events from installation %s (account: %s)\n",
				len(accountEvents), installationID, account.Name)
		}
	}

	eventsCache = allEvents
	lastFetchTime = time.Now()
	log.Printf("Fetched total %d events from %d account(s)\n", len(allEvents), len(activeAccounts))

	return allEvents, nil
}

// fetchEventsForInstallation fetches events for a single installation with cursor pagination
// Stops early if events already exist in SQLite database
func fetchEventsForInstallation(installationID, accessToken string, account *Account, daysBack int) ([]Event, error) {
	return fetchEventsForInstallationInternal(installationID, accessToken, account, daysBack, true)
}

// fetchEventsForInstallationFullSync fetches ALL events without early-stop logic
func fetchEventsForInstallationFullSync(installationID, accessToken string, account *Account, daysBack int) ([]Event, error) {
	return fetchEventsForInstallationInternal(installationID, accessToken, account, daysBack, false)
}

// fetchEventsForInstallationInternal is the internal implementation with optional early-stop
func fetchEventsForInstallationInternal(installationID, accessToken string, account *Account, daysBack int, enableEarlyStop bool) ([]Event, error) {
	var allEvents []Event
	var cursor string
	pageCount := 0
	maxPages := 100 // Safety limit to prevent infinite loops

	for pageCount < maxPages {
		pageCount++

		// Build URL with cursor or lastNDays parameter
		baseURL := fmt.Sprintf("https://api.viessmann-climatesolutions.com/iot/v2/events-history/installations/%s/events", installationID)
		req, err := http.NewRequest("GET", baseURL, nil)
		if err != nil {
			return allEvents, fmt.Errorf("failed to create request: %w", err)
		}

		q := req.URL.Query()
		if cursor == "" {
			// First page: use lastNDays parameter
			q.Add("lastNDays", fmt.Sprintf("%d", daysBack))
		} else {
			// Subsequent pages: use cursor
			q.Add("cursor", cursor)
		}
		q.Add("limit", "1000") // Max allowed by API
		req.URL.RawQuery = q.Encode()

		req.Header.Set("Authorization", "Bearer "+accessToken)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return allEvents, fmt.Errorf("request failed: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return allEvents, fmt.Errorf("API returned status %d", resp.StatusCode)
		}

		var eventsResp EventsResponse
		if err := json.NewDecoder(resp.Body).Decode(&eventsResp); err != nil {
			resp.Body.Close()
			return allEvents, fmt.Errorf("failed to decode response: %w", err)
		}
		resp.Body.Close()

		if len(eventsResp.Data) == 0 {
			// No more events
			break
		}

		// Process events and check if they already exist in DB
		foundExistingEvent := false
		for _, rawEvent := range eventsResp.Data {
			event := processEvent(rawEvent)
			event.InstallationID = installationID
			event.AccountID = account.ID
			event.AccountName = account.Name

			// Check if this event already exists in SQLite (only if early-stop is enabled)
			if enableEarlyStop && dbInitialized && eventDB != nil {
				hash := ComputeEventHash(&event)
				var exists bool
				err := eventDB.QueryRow("SELECT EXISTS(SELECT 1 FROM events WHERE hash = ?)", hash).Scan(&exists)
				if err == nil && exists {
					foundExistingEvent = true
					log.Printf("Found existing event in DB (hash: %s), stopping pagination for installation %s", hash[:8], installationID)
					break
				}
			}

			allEvents = append(allEvents, event)
		}

		log.Printf("Page %d: fetched %d events for installation %s", pageCount, len(eventsResp.Data), installationID)

		// Stop if we found an existing event (we've reached events we already have)
		if enableEarlyStop && foundExistingEvent {
			break
		}

		// Check if there's a next page
		if eventsResp.Cursor == nil || eventsResp.Cursor.Next == "" {
			// No more pages
			break
		}

		// Continue with next cursor
		cursor = eventsResp.Cursor.Next
	}

	if pageCount >= maxPages {
		log.Printf("Warning: reached maximum page limit (%d) for installation %s", maxPages, installationID)
	}

	return allEvents, nil
}

// fetchEventsLegacy fetches events from legacy single credential (backward compatibility)
func fetchEventsLegacy(daysBack int) ([]Event, error) {
	if err := ensureAuthenticated(); err != nil {
		return eventsCache, err
	}

	allEvents := make([]Event, 0)

	for _, installationID := range installationIDs {
		// Create a dummy account for legacy mode
		legacyAccount := &Account{
			ID:   currentCreds.Email,
			Name: "Legacy Account",
		}

		accountEvents, err := fetchEventsForInstallation(installationID, accessToken, legacyAccount, daysBack)
		if err != nil {
			log.Printf("Error fetching events for installation %s: %v\n", installationID, err)
			continue
		}

		allEvents = append(allEvents, accountEvents...)
		log.Printf("Fetched %d events from installation %s\n", len(accountEvents), installationID)
	}

	eventsCache = allEvents
	lastFetchTime = time.Now()
	return allEvents, nil
}

// fetchFeaturesForDevice fetches features for a specific installation/gateway/device
func fetchFeaturesForDevice(installationID, gatewayID, deviceID, accessToken string) (*DeviceFeatures, error) {
	// Build API URL with includeDeviceFeatures parameter to get array-based statistics
	url := fmt.Sprintf("https://api.viessmann-climatesolutions.com/iot/v2/features/installations/%s/gateways/%s/devices/%s/features?includeDeviceFeatures=true",
		installationID, gatewayID, deviceID)

	log.Printf("Fetching features from API: %s\n", url)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("ERROR: API returned status %d for %s\nResponse: %s\n", resp.StatusCode, url, string(bodyBytes))
		return nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var featuresResp FeaturesResponse
	if err := json.NewDecoder(resp.Body).Decode(&featuresResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// Parse and categorize features
	deviceFeatures := parseFeatures(featuresResp.Data, installationID, gatewayID, deviceID)
	return deviceFeatures, nil
}

// parseFeatures categorizes features into logical groups
func parseFeatures(features []Feature, installationID, gatewayID, deviceID string) *DeviceFeatures {
	df := &DeviceFeatures{
		InstallationID: installationID,
		GatewayID:      gatewayID,
		DeviceID:       deviceID,
		Temperatures:   make(map[string]FeatureValue),
		OperatingModes: make(map[string]FeatureValue),
		DHW:            make(map[string]FeatureValue),
		Circuits:       make(map[string]FeatureValue),
		Other:          make(map[string]FeatureValue),
		RawFeatures:    features,
		LastUpdate:     time.Now(),
	}

	for _, feature := range features {
		// Extract value from properties
		value := extractFeatureValue(feature.Properties)
		featureName := feature.Feature

		// Categorize by feature name
		if strings.Contains(featureName, "temperature") {
			df.Temperatures[featureName] = value
		} else if strings.Contains(featureName, "dhw") || strings.Contains(featureName, "hotwater") {
			df.DHW[featureName] = value
		} else if strings.Contains(featureName, "operating") || strings.Contains(featureName, "mode") || strings.Contains(featureName, "program") || strings.Contains(featureName, "session") {
			df.OperatingModes[featureName] = value
		} else if strings.Contains(featureName, "circuit") {
			df.Circuits[featureName] = value
		} else {
			df.Other[featureName] = value
		}
	}

	return df
}

// fetchFeaturesWithCache fetches features with caching support (default 5 minutes)
func fetchFeaturesWithCache(installationID, gatewayID, deviceID, accessToken string) (*DeviceFeatures, error) {
	return fetchFeaturesWithCustomCache(installationID, gatewayID, deviceID, accessToken, 5*time.Minute)
}

// fetchFeaturesWithCustomCache fetches features with configurable cache duration
func fetchFeaturesWithCustomCache(installationID, gatewayID, deviceID, accessToken string, cacheDuration time.Duration) (*DeviceFeatures, error) {
	cacheKey := fmt.Sprintf("%s:%s:%s", installationID, gatewayID, deviceID)

	// Check cache first
	featuresCacheMutex.RLock()
	if cached, exists := featuresCache[cacheKey]; exists {
		// Cache valid for specified duration
		if time.Since(cached.LastUpdate) < cacheDuration {
			featuresCacheMutex.RUnlock()
			return cached, nil
		}
	}
	featuresCacheMutex.RUnlock()

	// Fetch fresh data
	features, err := fetchFeaturesForDevice(installationID, gatewayID, deviceID, accessToken)
	if err != nil {
		// Return stale cache if available
		featuresCacheMutex.RLock()
		if cached, exists := featuresCache[cacheKey]; exists {
			featuresCacheMutex.RUnlock()
			log.Printf("Warning: Using stale cache due to fetch error: %v\n", err)
			return cached, nil
		}
		featuresCacheMutex.RUnlock()
		return nil, err
	}

	// Update cache
	featuresCacheMutex.Lock()
	featuresCache[cacheKey] = features
	featuresCacheMutex.Unlock()

	return features, nil
}

// getDeviceNameFromFeatures fetches the device.name feature for a device
func getDeviceNameFromFeatures(installationID, gatewayID, deviceID, accessToken string) string {
	features, err := fetchFeaturesWithCache(installationID, gatewayID, deviceID, accessToken)
	if err != nil {
		return ""
	}

	// Look for device.name in the "other" category
	if deviceName, exists := features.Other["device.name"]; exists {
		if nameValue, ok := deviceName.Value.(string); ok {
			return nameValue
		}
		// Handle nested structure: value.name.value
		if nameMap, ok := deviceName.Value.(map[string]FeatureValue); ok {
			if nameProp, exists := nameMap["name"]; exists {
				if nameStr, ok := nameProp.Value.(string); ok {
					return nameStr
				}
			}
		}
	}

	return ""
}

// fetchGatewayIDForInstallation fetches the gateway ID for an installation
func fetchGatewayIDForInstallation(installationID, accessToken string) (string, error) {
	// Fetch all installations to get gateway info
	req, err := http.NewRequest("GET", "https://api.viessmann-climatesolutions.com/iot/v2/equipment/installations", nil)
	if err != nil {
		return "", err
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var result struct {
		Data []map[string]interface{} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	// Find the installation we're looking for
	for _, rawInstall := range result.Data {
		var idStr string
		if id, ok := rawInstall["id"]; ok {
			switch v := id.(type) {
			case float64:
				idStr = fmt.Sprintf("%.0f", v)
			case string:
				idStr = v
			default:
				idStr = fmt.Sprintf("%v", v)
			}
		}

		if idStr == installationID {
			// Extract gateway from this installation
			if gateways, ok := rawInstall["gateways"].([]interface{}); ok && len(gateways) > 0 {
				if gwMap, ok := gateways[0].(map[string]interface{}); ok {
					if serial, ok := gwMap["serial"].(string); ok {
						log.Printf("Found gateway %s for installation %s\n", serial, installationID)
						return serial, nil
					}
				}
			}
		}
	}

	return "", fmt.Errorf("no gateways found for installation %s (checked %d installations)", installationID, len(result.Data))
}

// executeAPIRequest executes an arbitrary HTTP request to the Viessmann API
// Returns status code, response body (parsed as JSON if possible, otherwise as string), and error
func executeAPIRequest(method, url, accessToken string, requestBody map[string]interface{}) (int, interface{}, error) {
	var bodyReader io.Reader
	if requestBody != nil && (method == "POST" || method == "PUT") {
		bodyBytes, err := json.Marshal(requestBody)
		if err != nil {
			return 0, nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		bodyReader = strings.NewReader(string(bodyBytes))
	}

	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return 0, nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	if bodyReader != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	log.Printf("Executing %s request to: %s\n", method, url)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	// Read response body
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, fmt.Errorf("failed to read response body: %w", err)
	}

	// Try to parse as JSON
	var parsedBody interface{}
	if err := json.Unmarshal(bodyBytes, &parsedBody); err != nil {
		// If not JSON, return as string
		return resp.StatusCode, string(bodyBytes), nil
	}

	return resp.StatusCode, parsedBody, nil
}
