package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var (
	tempSchedulerRunning bool
	tempSchedulerMutex   sync.Mutex
	tempSchedulerStop    chan bool
	tempSchedulerTicker  *time.Ticker

	// Job-level mutex to prevent concurrent job execution
	tempJobMutex  sync.Mutex
	tempJobRunning bool

	// API Rate Limiting tracking
	apiCallsMutex sync.Mutex
	apiCalls10Min []time.Time // Track calls in 10-minute window
	apiCalls24Hr  []time.Time // Track calls in 24-hour window
	apiLimit10Min = 110       // Conservative limit (120 - buffer)
	apiLimit24Hr  = 1400      // Conservative limit (1450 - buffer)
)

// StartTemperatureScheduler starts the background job for periodic temperature logging
func StartTemperatureScheduler() error {
	tempSchedulerMutex.Lock()
	defer tempSchedulerMutex.Unlock()

	if tempSchedulerRunning {
		log.Println("Temperature scheduler already running")
		return nil
	}

	// Get settings
	settings, err := GetTemperatureLogSettings()
	if err != nil {
		return err
	}

	if !settings.Enabled {
		log.Println("Temperature logging is disabled, scheduler not started")
		return nil
	}

	// Use event database path if temperature database path is empty
	if settings.DatabasePath == "" {
		// Use VICARE_CONFIG_DIR or /config for database path (Docker-friendly)
		configDir := os.Getenv("VICARE_CONFIG_DIR")
		if configDir == "" {
			// Check if /config exists (Docker), otherwise use current directory
			if _, err := os.Stat("/config"); err == nil {
				configDir = "/config"
			} else {
				configDir = "."
			}
		}
		settings.DatabasePath = filepath.Join(configDir, "viessmann_events.db")
	}

	// Database should already be initialized by event scheduler
	// but we can call it again to ensure tables exist
	err = InitEventDatabase(settings.DatabasePath)
	if err != nil {
		return err
	}

	// Create ticker with sample interval
	intervalDuration := time.Duration(settings.SampleInterval) * time.Minute
	tempSchedulerTicker = time.NewTicker(intervalDuration)
	tempSchedulerStop = make(chan bool)
	tempSchedulerRunning = true

	log.Printf("Temperature scheduler started with interval: %d minutes", settings.SampleInterval)

	// Start background goroutine
	go func() {
		// Run once immediately on startup
		temperatureLoggingJob()

		for {
			select {
			case <-tempSchedulerTicker.C:
				temperatureLoggingJob()
			case <-tempSchedulerStop:
				log.Println("Temperature scheduler stopped")
				return
			}
		}
	}()

	return nil
}

// StopTemperatureScheduler stops the background job
func StopTemperatureScheduler() {
	tempSchedulerMutex.Lock()
	defer tempSchedulerMutex.Unlock()

	if !tempSchedulerRunning {
		return
	}

	if tempSchedulerTicker != nil {
		tempSchedulerTicker.Stop()
	}

	if tempSchedulerStop != nil {
		close(tempSchedulerStop)
	}

	tempSchedulerRunning = false
	log.Println("Temperature scheduler stopped")
}

// RestartTemperatureScheduler restarts the scheduler with new settings
func RestartTemperatureScheduler() error {
	StopTemperatureScheduler()

	// Small delay to ensure cleanup
	time.Sleep(100 * time.Millisecond)

	return StartTemperatureScheduler()
}

// temperatureLoggingJob is the main job that collects temperature snapshots
func temperatureLoggingJob() {
	// Prevent concurrent job execution
	tempJobMutex.Lock()
	if tempJobRunning {
		log.Println("Temperature logging job already running, skipping this tick")
		tempJobMutex.Unlock()
		return
	}
	tempJobRunning = true
	tempJobMutex.Unlock()

	// Ensure we reset the running flag when done
	defer func() {
		tempJobMutex.Lock()
		tempJobRunning = false
		tempJobMutex.Unlock()
	}()

	log.Println("Running temperature logging job...")

	// Get settings
	settings, err := GetTemperatureLogSettings()
	if err != nil {
		log.Printf("Error getting temperature log settings: %v", err)
		return
	}

	if !settings.Enabled {
		log.Println("Temperature logging disabled, skipping job")
		return
	}

	// Get active accounts
	activeAccounts, err := GetActiveAccounts()
	if err != nil {
		log.Printf("Error getting active accounts: %v", err)
		return
	}

	if len(activeAccounts) == 0 {
		log.Println("No active accounts found")
		return
	}

	snapshotCount := 0

	// Process each active account
	for _, account := range activeAccounts {
		log.Printf("Collecting temperature data for account: %s (%s)", account.Name, account.Email)

		// Ensure this account is authenticated
		token, err := ensureAccountAuthenticated(account)
		if err != nil {
			log.Printf("Failed to authenticate account %s: %v", account.Email, err)
			continue
		}

		// Process each installation
		for _, installationID := range token.InstallationIDs {
			// Check API rate limits before making calls
			if !checkAPIRateLimit() {
				log.Println("API rate limit reached, skipping remaining installations")
				goto cleanup
			}

			// Fetch installation details to get gateways and devices
			installation, ok := token.Installations[installationID]
			if !ok {
				log.Printf("Installation %s not found in token cache", installationID)
				continue
			}

			// Process each gateway and device
			for _, gateway := range installation.Gateways {
				for _, device := range gateway.Devices {
					// Only collect from device ID "0" to avoid duplicates
					if device.DeviceID != "0" {
						continue
					}

					// Check rate limit again
					if !checkAPIRateLimit() {
						log.Println("API rate limit reached during device processing")
						goto cleanup
					}

					// Fetch all features for this device
					features, err := fetchFeaturesForDeviceWithTracking(installationID, gateway.Serial, device.DeviceID, token.AccessToken)
					if err != nil {
						log.Printf("Error fetching features for device %s: %v", device.DeviceID, err)
						continue
					}

					// Extract temperature snapshot from features
					snapshot := extractTemperatureSnapshot(features, installationID, gateway.Serial, device.DeviceID, account)
					if snapshot == nil {
						log.Printf("No data extracted for installation %s", installationID)
						continue
					}

					// Save to database
					err = SaveTemperatureSnapshot(snapshot)
					if err != nil {
						log.Printf("Error saving temperature snapshot: %v", err)
						continue
					}

					snapshotCount++
					log.Printf("Saved temperature snapshot for installation %s (account: %s)", installationID, account.Name)
				}
			}
		}
	}

cleanup:
	// Cleanup old snapshots based on retention policy
	err = CleanupOldTemperatureSnapshots(settings.RetentionDays)
	if err != nil {
		log.Printf("Error cleaning up old temperature snapshots: %v", err)
	}

	// Log statistics
	totalCount, _ := GetTemperatureSnapshotCount()
	usage10min, usage24hr := getAPIUsage()
	log.Printf("Temperature logging job completed. Snapshots saved: %d, Total: %d, API usage: %d/10min, %d/24hr",
		snapshotCount, totalCount, usage10min, usage24hr)
}

// fetchFeaturesForDeviceWithTracking wraps fetchFeaturesWithCache with API call tracking
func fetchFeaturesForDeviceWithTracking(installationID, gatewayID, deviceID, accessToken string) (*DeviceFeatures, error) {
	// Use cached version - if cache is fresh (< 5 min), no API call is made
	// If cache is stale, fetchFeaturesWithCache will make an API call and we track it
	features, err := fetchFeaturesWithCache(installationID, gatewayID, deviceID, accessToken)

	// Only track API call if cache was stale (indicated by fresh LastUpdate)
	if err == nil && time.Since(features.LastUpdate) < 1*time.Second {
		// Cache was just updated, meaning an API call was made
		trackAPICall()
	}

	return features, err
}

// checkAPIRateLimit checks if we're within API rate limits
func checkAPIRateLimit() bool {
	apiCallsMutex.Lock()
	defer apiCallsMutex.Unlock()

	now := time.Now()
	cutoff10Min := now.Add(-10 * time.Minute)
	cutoff24Hr := now.Add(-24 * time.Hour)

	// Clean up old entries
	apiCalls10Min = filterCallsSince(apiCalls10Min, cutoff10Min)
	apiCalls24Hr = filterCallsSince(apiCalls24Hr, cutoff24Hr)

	// Check limits
	if len(apiCalls10Min) >= apiLimit10Min {
		log.Printf("WARNING: API rate limit reached (10-minute window): %d/%d", len(apiCalls10Min), apiLimit10Min)
		return false
	}

	if len(apiCalls24Hr) >= apiLimit24Hr {
		log.Printf("WARNING: API rate limit reached (24-hour window): %d/%d", len(apiCalls24Hr), apiLimit24Hr)
		return false
	}

	return true
}

// trackAPICall records an API call for rate limiting
func trackAPICall() {
	apiCallsMutex.Lock()
	defer apiCallsMutex.Unlock()

	now := time.Now()
	apiCalls10Min = append(apiCalls10Min, now)
	apiCalls24Hr = append(apiCalls24Hr, now)
}

// filterCallsSince returns calls that occurred after the given time
func filterCallsSince(calls []time.Time, since time.Time) []time.Time {
	filtered := make([]time.Time, 0)
	for _, t := range calls {
		if t.After(since) {
			filtered = append(filtered, t)
		}
	}
	return filtered
}

// getAPIUsage returns current API usage counts
func getAPIUsage() (int, int) {
	apiCallsMutex.Lock()
	defer apiCallsMutex.Unlock()

	now := time.Now()
	cutoff10Min := now.Add(-10 * time.Minute)
	cutoff24Hr := now.Add(-24 * time.Hour)

	apiCalls10Min = filterCallsSince(apiCalls10Min, cutoff10Min)
	apiCalls24Hr = filterCallsSince(apiCalls24Hr, cutoff24Hr)

	return len(apiCalls10Min), len(apiCalls24Hr)
}

// extractTemperatureSnapshot extracts all relevant data from device features
func extractTemperatureSnapshot(features *DeviceFeatures, installationID, gatewayID, deviceID string, account *Account) *TemperatureSnapshot {
	if features == nil || len(features.RawFeatures) == 0 {
		return nil
	}

	// Round timestamp to the nearest minute to prevent near-duplicate entries
	// This ensures that multiple concurrent job executions produce the same timestamp
	now := time.Now().UTC()
	roundedTime := now.Truncate(time.Minute)

	snapshot := &TemperatureSnapshot{
		Timestamp:      roundedTime,
		InstallationID: installationID,
		GatewayID:      gatewayID,
		DeviceID:       deviceID,
		AccountID:      account.Email,
		AccountName:    account.Name,
	}

	// Extract data from raw features
	for _, feature := range features.RawFeatures {
		extractFeatureIntoSnapshot(feature, snapshot)
	}

	// Calculate derived values
	calculateDerivedValues(snapshot)

	return snapshot
}

// extractFeatureIntoSnapshot extracts a single feature into the snapshot
func extractFeatureIntoSnapshot(feature Feature, snapshot *TemperatureSnapshot) {
	featureName := feature.Feature

	// Temperature sensors
	switch featureName {
	case "heating.sensors.temperature.outside":
		snapshot.OutsideTemp = getFloatValue(feature.Properties)
	case "heating.sensors.temperature.return":
		snapshot.ReturnTemp = getFloatValue(feature.Properties)
	case "heating.sensors.temperature.supply":
		snapshot.SupplyTemp = getFloatValue(feature.Properties)
	case "heating.circuits.0.sensors.temperature.supply":
		snapshot.PrimarySupplyTemp = getFloatValue(feature.Properties)
	case "heating.circuits.1.sensors.temperature.supply":
		snapshot.SecondarySupplyTemp = getFloatValue(feature.Properties)
	case "heating.circuits.0.sensors.temperature.return":
		snapshot.PrimaryReturnTemp = getFloatValue(feature.Properties)
	case "heating.circuits.1.sensors.temperature.return":
		snapshot.SecondaryReturnTemp = getFloatValue(feature.Properties)
	// Fallback features: only use if primary features are not available
	case "heating.primaryCircuit.sensors.temperature.supply":
		if snapshot.PrimarySupplyTemp == nil {
			snapshot.PrimarySupplyTemp = getFloatValue(feature.Properties)
		}
	case "heating.primaryCircuit.sensors.temperature.return":
		if snapshot.PrimaryReturnTemp == nil {
			snapshot.PrimaryReturnTemp = getFloatValue(feature.Properties)
		}
	case "heating.secondaryCircuit.sensors.temperature.supply":
		if snapshot.SecondarySupplyTemp == nil {
			snapshot.SecondarySupplyTemp = getFloatValue(feature.Properties)
		}
	case "heating.secondaryCircuit.sensors.temperature.return":
		if snapshot.SecondaryReturnTemp == nil {
			snapshot.SecondaryReturnTemp = getFloatValue(feature.Properties)
		}
	case "heating.dhw.sensors.temperature.hotWaterStorage":
		snapshot.DHWTemp = getFloatValue(feature.Properties)
	case "heating.boiler.sensors.temperature.main":
		snapshot.BoilerTemp = getFloatValue(feature.Properties)
	case "heating.buffer.sensors.temperature.main":
		snapshot.BufferTemp = getFloatValue(feature.Properties)
	case "heating.buffer.sensors.temperature.top":
		snapshot.BufferTempTop = getFloatValue(feature.Properties)
	case "heating.sensors.temperature.outside.calculated":
		snapshot.CalculatedOutsideTemp = getFloatValue(feature.Properties)

	// Compressor data
	case "heating.compressors.0":
		snapshot.CompressorActive = getBoolValue(feature.Properties)
	case "heating.compressors.0.speed.current":
		snapshot.CompressorSpeed = getFloatValue(feature.Properties)
	case "heating.compressors.0.sensors.current":
		snapshot.CompressorCurrent = getFloatValue(feature.Properties)
	case "heating.compressors.0.sensors.pressure.inlet":
		snapshot.CompressorPressure = getFloatValue(feature.Properties)
	case "heating.compressors.0.sensors.temperature.oil":
		snapshot.CompressorOilTemp = getFloatValue(feature.Properties)
	case "heating.compressors.0.sensors.temperature.motorChamber":
		snapshot.CompressorMotorTemp = getFloatValue(feature.Properties)
	case "heating.compressors.0.sensors.temperature.inlet":
		snapshot.CompressorInletTemp = getFloatValue(feature.Properties)
	case "heating.compressors.0.sensors.temperature.outlet":
		snapshot.CompressorOutletTemp = getFloatValue(feature.Properties)
	case "heating.compressors.0.statistics":
		// Extract hours from nested structure
		if props, ok := feature.Properties["hours"].(map[string]interface{}); ok {
			snapshot.CompressorHours = getFloatValue(props)
		}
	case "heating.inverters.0.sensors.power.output":
		// Instantaneous electrical power output from inverter (Watt)
		snapshot.CompressorPower = getFloatValue(feature.Properties)
	case "heating.compressors.0.power.consumption.current":
		// Fallback for Oplink devices: direct current power consumption (kilowatt)
		// Only set if CompressorPower is not already set from inverter
		if snapshot.CompressorPower == nil {
			if kwValue := getFloatValue(feature.Properties); kwValue != nil {
				// Convert from kW to W
				wValue := *kwValue * 1000.0
				snapshot.CompressorPower = &wValue
			}
		}
	case "heating.compressors.0.heat.production.current":
		// Fallback for Oplink devices: direct current heat production (watt)
		// Only set if ThermalPower is not already calculated from volumetric flow
		if snapshot.ThermalPower == nil {
			if wValue := getFloatValue(feature.Properties); wValue != nil {
				// Convert from W to kW
				kwValue := *wValue / 1000.0
				snapshot.ThermalPower = &kwValue
			}
		}
	case "heating.power.consumption.total":
		// This is cumulative consumption (kWh), not instantaneous power - skip it
		break
	case "heating.scop.total":
		// This is Seasonal COP (average over weeks/months) - not useful for real-time monitoring
		// We calculate instantaneous COP from thermal power and electrical power
		break

	// Pump status
	case "heating.circuits.0.circulation.pump":
		snapshot.CirculationPumpActive = getPumpStatus(feature.Properties)
	case "heating.dhw.pumps.circulation":
		snapshot.DHWPumpActive = getPumpStatus(feature.Properties)
	case "heating.pumps.primary":
		snapshot.InternalPumpActive = getPumpStatus(feature.Properties)

	// Flow/Energy
	case "heating.sensors.volumetricFlow.allengra":
		snapshot.VolumetricFlow = getFloatValue(feature.Properties)

	// Operating state
	case "heating.compressors.0.refrigerant.fourWayValve":
		snapshot.FourWayValve = getStringValue(feature.Properties)
	case "heating.burners.0.modulation":
		snapshot.BurnerModulation = getFloatValue(feature.Properties)
	case "heating.secondaryHeatGenerator.status":
		snapshot.SecondaryHeatGeneratorStatus = getStringValue(feature.Properties)
	}
}

// getFloatValue extracts a float64 value from feature properties
func getFloatValue(properties map[string]interface{}) *float64 {
	// Try properties.value.value first (standard structure)
	if valueMap, ok := properties["value"].(map[string]interface{}); ok {
		if val, ok := valueMap["value"].(float64); ok {
			return &val
		}
		// Try as int if float64 failed
		if val, ok := valueMap["value"].(int); ok {
			floatVal := float64(val)
			return &floatVal
		}
	}

	// Try direct properties.value as float64
	if val, ok := properties["value"].(float64); ok {
		return &val
	}

	// Try direct properties.value as int
	if val, ok := properties["value"].(int); ok {
		floatVal := float64(val)
		return &floatVal
	}

	return nil
}

// getBoolValue extracts a bool value from feature properties
func getBoolValue(properties map[string]interface{}) *bool {
	// Try properties.active.value (for compressor active status)
	if activeMap, ok := properties["active"].(map[string]interface{}); ok {
		if val, ok := activeMap["value"].(bool); ok {
			return &val
		}
	}

	// Try properties.value.value (standard structure)
	if valueMap, ok := properties["value"].(map[string]interface{}); ok {
		if val, ok := valueMap["value"].(bool); ok {
			return &val
		}
	}

	// Try direct properties.value
	if val, ok := properties["value"].(bool); ok {
		return &val
	}

	return nil
}

// getStringValue extracts a string value from feature properties
func getStringValue(properties map[string]interface{}) *string {
	// Try properties.value.value first
	if valueMap, ok := properties["value"].(map[string]interface{}); ok {
		if val, ok := valueMap["value"].(string); ok {
			return &val
		}
	}

	// Try direct properties.value
	if val, ok := properties["value"].(string); ok {
		return &val
	}

	return nil
}

// getPumpStatus extracts pump status from properties (status: "on"/"off")
func getPumpStatus(properties map[string]interface{}) *bool {
	// Pumps use properties.status.value instead of properties.value.value
	if statusMap, ok := properties["status"].(map[string]interface{}); ok {
		if val, ok := statusMap["value"].(string); ok {
			result := val == "on"
			return &result
		}
	}

	return nil
}

// calculateDerivedValues computes thermal power from flow and temperature
// Uses the same logic as the dashboard for consistency
func calculateDerivedValues(snapshot *TemperatureSnapshot) {
	// Get device settings to determine which temperatures to use
	hasHotWaterBuffer := true // Default to true (use secondary circuit)
	deviceKey := fmt.Sprintf("%s_%s", snapshot.InstallationID, snapshot.DeviceID)
	settings, err := GetDeviceSettings(snapshot.AccountID, deviceKey)
	if err == nil && settings.HasHotWaterBuffer != nil {
		hasHotWaterBuffer = *settings.HasHotWaterBuffer
	}

	var supplyTemp, returnTemp *float64

	if hasHotWaterBuffer {
		// Mit HW-Puffer: Sekundärkreis Spreizung (like dashboard line 333-342)
		// Dashboard uses: heating.secondaryCircuit.sensors.temperature.supply/return
		// which maps to our SecondarySupplyTemp/SecondaryReturnTemp
		if snapshot.SecondarySupplyTemp != nil && snapshot.SecondaryReturnTemp != nil {
			supplyTemp = snapshot.SecondarySupplyTemp
			returnTemp = snapshot.SecondaryReturnTemp
		} else if snapshot.SecondarySupplyTemp != nil && snapshot.ReturnTemp != nil {
			// Fallback: secondary supply + generic return (dashboard line 410 has this fallback)
			supplyTemp = snapshot.SecondarySupplyTemp
			returnTemp = snapshot.ReturnTemp
		}
	} else {
		// Ohne HW-Puffer: Heizkreis Spreizung (like dashboard line 344-352)
		// Dashboard uses: heating.circuits.0.sensors.temperature.supply + heating.sensors.temperature.return
		// which maps to our PrimarySupplyTemp + ReturnTemp
		if snapshot.PrimarySupplyTemp != nil && snapshot.ReturnTemp != nil {
			supplyTemp = snapshot.PrimarySupplyTemp
			returnTemp = snapshot.ReturnTemp
		}
	}

	// Calculate thermal power if we have all required values (only if not already set from fallback)
	if snapshot.ThermalPower == nil && snapshot.VolumetricFlow != nil && supplyTemp != nil && returnTemp != nil {
		deltaT := *supplyTemp - *returnTemp

		// Only calculate if deltaT is positive and meaningful (>0°C)
		if deltaT > 0 {
			// Use the same formula as dashboard (dashboard-render-heating.js line 356-369)
			// Dashboard: thermalPowerW = massFlow × specificHeatCapacity × spreizung
			// where massFlow = waterDensity × volumetricFlowM3s
			// Simplified with constant density (1000 kg/m³) and specific heat (4180 J/kg·K):
			// kW = Flow * ΔT * 0.001163
			thermalPowerKW := *snapshot.VolumetricFlow * deltaT * 0.001163
			snapshot.ThermalPower = &thermalPowerKW
		}
	}

	// Calculate instantaneous COP if both thermal and electrical power are available
	// This works for both calculated thermal power (from flow) and direct thermal power (from fallback)
	if snapshot.ThermalPower != nil && snapshot.CompressorPower != nil && *snapshot.CompressorPower > 0 {
		thermalPowerW := *snapshot.ThermalPower * 1000 // Convert kW to W
		cop := thermalPowerW / *snapshot.CompressorPower
		snapshot.COP = &cop
	}
}

// IsTemperatureSchedulerRunning returns whether the scheduler is currently running
func IsTemperatureSchedulerRunning() bool {
	tempSchedulerMutex.Lock()
	defer tempSchedulerMutex.Unlock()
	return tempSchedulerRunning
}

// GetAPIRateLimits returns current limits
func GetAPIRateLimits() (int, int) {
	return apiLimit10Min, apiLimit24Hr
}
