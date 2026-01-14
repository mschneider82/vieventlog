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
	tempJobMutex   sync.Mutex
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
				log.Println("API rate limit reached, skipping remaining installations to avoid hitting Viessmann API limits")
				goto cleanup
			}

			// Fetch installation details to get gateways and devices
			installation, ok := token.Installations[installationID]
			if !ok {
				log.Printf("Installation %s not found in token cache", installationID)
				continue
			}

			lastGateway := ""

			// Process each gateway and device
			for _, gateway := range installation.Gateways {
				for _, device := range gateway.Devices {
					// Only collect from device ID "0" to avoid duplicates
					if device.DeviceID != "0" {
						continue
					}

					// Check rate limit again
					if !checkAPIRateLimit() {
						log.Println("API rate limit reached during device processing, stopping to avoid hitting Viessmann API limits")
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

					// Set the sample interval for this snapshot
					snapshot.SampleInterval = settings.SampleInterval

					// Save to database
					err = SaveTemperatureSnapshot(snapshot)
					if err != nil {
						log.Printf("Error saving temperature snapshot: %v", err)
						continue
					}

					if lastGateway != gateway.Serial {
						snapshotCount++
						log.Printf("Saved temperature snapshot for installation %s (account: %s)", installationID, account.Name)
						lastGateway = gateway.Serial
					}
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

// fetchFeaturesForDeviceWithTracking wraps fetchFeaturesWithCustomCache with API call tracking
// Cache duration is based on sample interval (min 1 minute, max 5 minutes)
func fetchFeaturesForDeviceWithTracking(installationID, gatewayID, deviceID, accessToken string) (*DeviceFeatures, error) {
	// Get temperature log settings to determine cache duration
	settings, err := GetTemperatureLogSettings()
	if err != nil {
		// Fallback to default 5 minutes on error
		settings = &TemperatureLogSettings{SampleInterval: 5}
	}

	// Calculate cache duration: use sample interval if < 5 minutes, otherwise 5 minutes
	// Subtract 5 seconds to ensure cache expires before next sample (ticker is not exact)
	cacheDuration := 5 * time.Minute
	if settings.SampleInterval < 5 {
		cacheDuration = time.Duration(settings.SampleInterval)*time.Minute - 5*time.Second
		// Ensure minimum cache duration of 10 seconds
		if cacheDuration < 10*time.Second {
			cacheDuration = 10 * time.Second
		}
	}

	// Use cached version with custom cache duration
	// If cache is stale, fetchFeaturesWithCustomCache will make an API call and we track it
	features, err := fetchFeaturesWithCustomCache(installationID, gatewayID, deviceID, accessToken, cacheDuration)

	// Only track API call if cache was stale (indicated by fresh LastUpdate)
	// if err == nil && time.Since(features.LastUpdate) < 1*time.Second {
	if err == nil && time.Since(features.LastUpdate) < 2*time.Second {
		// Cache was just updated, meaning an API call was made
		// Counted elsewhere
		// trackAPICall()
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

	// dashboard: outsideTemp: find(['heating.sensors.temperature.outside'], ['outside']),
	case "heating.sensors.temperature.outside":
		snapshot.OutsideTemp = getFloatValue(feature.Properties)

	// dashboard: returnTemp: find(['heating.sensors.temperature.return']), Rücklauf IDU/ODU
	case "heating.sensors.temperature.return":
		snapshot.ReturnTemp = getFloatValue(feature.Properties)

	// Keep for backward compatibility (legacy devices may still use this)
	case "heating.sensors.temperature.supply":
		snapshot.SupplyTemp = getFloatValue(feature.Properties)

	// Heating circuits 0-3: Store in both legacy fields (backward compat) and new explicit fields
	// dashboard: supplyTemp: find(['heating.circuits.0.sensors.temperature.supply']), Gemeinsame Vorlauftemperatur IDU (auch Vorlauf 1. Heizkreis)
	case "heating.circuits.0.sensors.temperature.supply":
		//snapshot.PrimarySupplyTemp = getFloatValue(feature.Properties)         // DEPRECATED: Legacy (use HeatingCircuit0SupplyTemp)
		snapshot.HeatingCircuit0SupplyTemp = getFloatValue(feature.Properties) // Preferred: Explicit heating circuit 0
	case "heating.circuits.1.sensors.temperature.supply":
		//snapshot.SecondarySupplyTemp = getFloatValue(feature.Properties)       // DEPRECATED: Legacy (use HeatingCircuit1SupplyTemp)
		snapshot.HeatingCircuit1SupplyTemp = getFloatValue(feature.Properties) // Preferred: Explicit heating circuit 1
	case "heating.circuits.2.sensors.temperature.supply":
		snapshot.HeatingCircuit2SupplyTemp = getFloatValue(feature.Properties)
	case "heating.circuits.3.sensors.temperature.supply":
		snapshot.HeatingCircuit3SupplyTemp = getFloatValue(feature.Properties)

	// Heat pump circuits: Only supply temperatures exist (no per-circuit return sensors)
	// dashboard: primarySupplyTemp: find(['heating.primaryCircuit.sensors.temperature.supply']), Lufteintrittstemperatur
	case "heating.primaryCircuit.sensors.temperature.supply":
		snapshot.HPPrimaryCircuitSupplyTemp = getFloatValue(feature.Properties) // Air intake temperature (HP primary circuit)

	// dashboard: secondarySupplyTemp: find(['heating.secondaryCircuit.sensors.temperature.supply']), sek. Vorlauf in ODU
	case "heating.secondaryCircuit.sensors.temperature.supply":
		snapshot.HPSecondaryCircuitSupplyTemp = getFloatValue(feature.Properties) // HP secondary circuit supply
	case "heating.dhw.sensors.temperature.hotWaterStorage":
		snapshot.DHWTemp = getFloatValue(feature.Properties)
	case "heating.dhw.sensors.temperature.hotWaterStorage.middle":
		snapshot.DHWCylinderMiddleTemp = getFloatValue(feature.Properties)

	// Fallback features: only use if primary features are not available
	case "heating.dhw.sensors.temperature.dhwCylinder":
		if snapshot.DHWTemp == nil {
			snapshot.DHWTemp = getFloatValue(feature.Properties)
		}
	case "heating.dhw.sensors.temperature.dhwCylinder.middle":
		if snapshot.DHWCylinderMiddleTemp == nil {
			snapshot.DHWCylinderMiddleTemp = getFloatValue(feature.Properties)
		}

	// dashboard: boilerTemp: find(['heating.boiler.sensors.temperature.commonSupply', 'heating.boiler.temperature.current', 'heating.boiler.temperature']),
	case "heating.boiler.sensors.temperature.commonSupply":
		snapshot.BoilerTemp = getFloatValue(feature.Properties)
	// Fallbacks
	case "heating.boiler.temperature.current":
		if snapshot.BoilerTemp == nil {
			snapshot.BoilerTemp = getFloatValue(feature.Properties)
		}
	case "heating.boiler.temperature":
		if snapshot.BoilerTemp == nil {
			snapshot.BoilerTemp = getFloatValue(feature.Properties)
		}

	// dashboard: bufferTemp: find(['heating.buffer.sensors.temperature.main', 'heating.bufferCylinder.sensors.temperature.main']),
	case "heating.buffer.sensors.temperature.main":
		snapshot.BufferTemp = getFloatValue(feature.Properties)
	// Fallback
	case "heating.bufferCylinder.sensors.temperature.main":
		if snapshot.BufferTemp == nil {
			snapshot.BufferTemp = getFloatValue(feature.Properties)
		}

	// dashboard: bufferTempTop: find(['heating.buffer.sensors.temperature.top', 'heating.bufferCylinder.sensors.temperature.top']),
	case "heating.buffer.sensors.temperature.top":
		snapshot.BufferTempTop = getFloatValue(feature.Properties)
	// Fallback
	case "heating.bufferCylinder.sensors.temperature.top":
		if snapshot.BufferTempTop == nil {
			snapshot.BufferTempTop = getFloatValue(feature.Properties)
		}
	case "heating.sensors.temperature.outside.calculated":
		snapshot.CalculatedOutsideTemp = getFloatValue(feature.Properties)

	// Compressor data
	case "heating.compressors.0":
		snapshot.CompressorActive = getBoolValue(feature.Properties)
	case "heating.compressors.0.speed.current":
		snapshot.CompressorSpeed = getFloatValue(feature.Properties)
	case "heating.inverters.0.sensors.power.current": //"heating.compressors.0.sensors.current":
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
		// Extract starts from nested structure
		if props, ok := feature.Properties["starts"].(map[string]interface{}); ok { snapshot.CompressorStarts = getFloatValue(props) }
		
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
	case "heating.boiler.pumps.internal":  // changed to use vaild keyword "heating.pumps.primary":
		snapshot.InternalPumpActive = getPumpStatus(feature.Properties)

	// Flow/Energy
	case "heating.sensors.volumetricFlow.allengra":
		snapshot.VolumetricFlow = getFloatValue(feature.Properties)

	// Operating state

//remove, will not be used because string content
	//case "heating.valves.fourThreeWay.position": //heating.compressors.0.refrigerant.fourWayValve":
	//	snapshot.FourWayValve = getStringValue(feature.Properties)
	case "heating.burners.0.modulation":
		snapshot.BurnerModulation = getFloatValue(feature.Properties)

// info: this feature migth have no properties/no information
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
		// Mit HW-Puffer: Sekundärkreis Spreizung (see dashboard_render_engine)
		// Dashboard uses: heating.secondaryCircuit.sensors.temperature.supply
		// which maps to our HPSecondaryCircuitSupplyTemp + ReturnTemp
		if snapshot.HPSecondaryCircuitSupplyTemp != nil {
			supplyTemp = snapshot.HPSecondaryCircuitSupplyTemp
			returnTemp = snapshot.ReturnTemp
		}
	} else {
		// Ohne HW-Puffer: Heizkreis Spreizung (see dashboard_render_engine)
		// Dashboard uses: heating.circuits.0.sensors.temperature.supply + heating.sensors.temperature.return
		// which maps to our HeatingCircuit0SupplyTemp + ReturnTemp
		if snapshot.HeatingCircuit0SupplyTemp != nil {
			supplyTemp = snapshot.HeatingCircuit0SupplyTemp
			returnTemp = snapshot.ReturnTemp
		} else if snapshot.SupplyTemp != nil {
			// Fallback for maximum compatibility
			supplyTemp = snapshot.SupplyTemp
			returnTemp = snapshot.ReturnTemp
		}
	}

	// Calculate thermal power if we have all required values (only if not already set from fallback)
	if snapshot.ThermalPower == nil && snapshot.VolumetricFlow != nil && supplyTemp != nil && returnTemp != nil {
		deltaT := *supplyTemp - *returnTemp

		// Fallback für 250-A und ähnliche Anlagen: Bei manchen Anlagentypen liefert
		// die API die "gemeinsame Vorlauftemperatur" statt der höchsten Temperatur.
		// Verwende BoilerTemp wenn diese höher ist als supplyTemp.
		if snapshot.BoilerTemp != nil {
			if *snapshot.BoilerTemp > *supplyTemp {
				supplyTemp = snapshot.BoilerTemp
				deltaT = *supplyTemp - *returnTemp
			}
		}

		// Calculate deltaT for each heating circuit individually
		// NOTE: All circuits share the same return sensor, so these represent
		// the temperature spread from each circuit's supply to the shared return
		if snapshot.ReturnTemp != nil && snapshot.VolumetricFlow != nil && *snapshot.VolumetricFlow > 0 {
			// For systems with hot water buffer, use the calculated deltaT from secondary circuit
			// For systems without buffer, calculate from heating circuit 0 supply temperature
			if hasHotWaterBuffer {
				// Use deltaT calculated from secondary circuit (HPSecondaryCircuitSupplyTemp - ReturnTemp)
				snapshot.HeatingCircuit0DeltaT = &deltaT
			} else {
				if snapshot.HeatingCircuit0SupplyTemp != nil {
					deltaT0 := *snapshot.HeatingCircuit0SupplyTemp - *snapshot.ReturnTemp
					snapshot.HeatingCircuit0DeltaT = &deltaT0
				}
			}
			if snapshot.HeatingCircuit1SupplyTemp != nil {
				deltaT1 := *snapshot.HeatingCircuit1SupplyTemp - *snapshot.ReturnTemp
				snapshot.HeatingCircuit1DeltaT = &deltaT1
			}
			if snapshot.HeatingCircuit2SupplyTemp != nil {
				deltaT2 := *snapshot.HeatingCircuit2SupplyTemp - *snapshot.ReturnTemp
				snapshot.HeatingCircuit2DeltaT = &deltaT2
			}
			if snapshot.HeatingCircuit3SupplyTemp != nil {
				deltaT3 := *snapshot.HeatingCircuit3SupplyTemp - *snapshot.ReturnTemp
				snapshot.HeatingCircuit3DeltaT = &deltaT3
			}
		}

		// Only calculate if deltaT is positive and meaningful (>0°C) and volumetric flow is active
		if deltaT > 0 && *snapshot.VolumetricFlow > 0 {
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
