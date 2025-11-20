package main

import (
	"fmt"
	"log"
	"sync"
	"time"
)

var (
	temperatureSchedulerTicker *time.Ticker
	temperatureSchedulerStop   chan bool
	temperatureSchedulerMutex  sync.Mutex
	lastTemperatureFetchTime   time.Time
	apiCallCounter             *RateLimitCounter
)

// RateLimitCounter tracks API calls for rate limiting
type RateLimitCounter struct {
	callsLast10Min  []time.Time
	callsLast24Hour []time.Time
	mutex           sync.Mutex
}

// NewRateLimitCounter creates a new rate limit counter
func NewRateLimitCounter() *RateLimitCounter {
	return &RateLimitCounter{
		callsLast10Min:  make([]time.Time, 0),
		callsLast24Hour: make([]time.Time, 0),
	}
}

// RecordAPICall records an API call timestamp
func (r *RateLimitCounter) RecordAPICall() {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	now := time.Now()
	r.callsLast10Min = append(r.callsLast10Min, now)
	r.callsLast24Hour = append(r.callsLast24Hour, now)

	// Clean up old entries
	r.cleanup()
}

// cleanup removes old API call timestamps
func (r *RateLimitCounter) cleanup() {
	now := time.Now()
	tenMinAgo := now.Add(-10 * time.Minute)
	twentyFourHoursAgo := now.Add(-24 * time.Hour)

	// Remove calls older than 10 minutes
	newCalls10Min := make([]time.Time, 0)
	for _, t := range r.callsLast10Min {
		if t.After(tenMinAgo) {
			newCalls10Min = append(newCalls10Min, t)
		}
	}
	r.callsLast10Min = newCalls10Min

	// Remove calls older than 24 hours
	newCalls24Hour := make([]time.Time, 0)
	for _, t := range r.callsLast24Hour {
		if t.After(twentyFourHoursAgo) {
			newCalls24Hour = append(newCalls24Hour, t)
		}
	}
	r.callsLast24Hour = newCalls24Hour
}

// CanMakeAPICall checks if we can make an API call without exceeding rate limits
// Viessmann API limits: 120 calls / 10 min, 1450 calls / 24 hours
func (r *RateLimitCounter) CanMakeAPICall() bool {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	r.cleanup()

	// Check 10-minute limit (use 110 as safety margin)
	if len(r.callsLast10Min) >= 110 {
		return false
	}

	// Check 24-hour limit (use 1400 as safety margin)
	if len(r.callsLast24Hour) >= 1400 {
		return false
	}

	return true
}

// GetCurrentUsage returns the current API usage statistics
func (r *RateLimitCounter) GetCurrentUsage() (int, int) {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	r.cleanup()
	return len(r.callsLast10Min), len(r.callsLast24Hour)
}

// StartTemperatureScheduler starts the temperature logging scheduler
func StartTemperatureScheduler() error {
	temperatureSchedulerMutex.Lock()
	defer temperatureSchedulerMutex.Unlock()

	settings, err := GetTemperatureLogSettings()
	if err != nil {
		return err
	}

	if !settings.Enabled {
		log.Println("Temperature logging is disabled")
		return nil
	}

	// Initialize rate limit counter if not already done
	if apiCallCounter == nil {
		apiCallCounter = NewRateLimitCounter()
	}

	// Stop existing scheduler if any
	if temperatureSchedulerTicker != nil {
		temperatureSchedulerTicker.Stop()
	}
	if temperatureSchedulerStop != nil {
		close(temperatureSchedulerStop)
	}

	// Initialize database
	if err := InitEventDatabase(settings.DatabasePath); err != nil {
		return err
	}

	log.Printf("Starting temperature logging scheduler (interval: %d minutes, retention: %d days)",
		settings.SampleInterval, settings.RetentionDays)

	// Create ticker with configured interval
	intervalDuration := time.Duration(settings.SampleInterval) * time.Minute
	temperatureSchedulerTicker = time.NewTicker(intervalDuration)
	temperatureSchedulerStop = make(chan bool)

	// Run first job immediately
	go collectTemperatureSnapshots(settings)

	// Start scheduler loop
	go func() {
		for {
			select {
			case <-temperatureSchedulerTicker.C:
				collectTemperatureSnapshots(settings)
			case <-temperatureSchedulerStop:
				log.Println("Temperature scheduler stopped")
				return
			}
		}
	}()

	log.Println("Temperature logging scheduler started successfully")
	return nil
}

// StopTemperatureScheduler stops the temperature logging scheduler
func StopTemperatureScheduler() {
	temperatureSchedulerMutex.Lock()
	defer temperatureSchedulerMutex.Unlock()

	if temperatureSchedulerTicker != nil {
		temperatureSchedulerTicker.Stop()
		temperatureSchedulerTicker = nil
	}

	if temperatureSchedulerStop != nil {
		close(temperatureSchedulerStop)
		temperatureSchedulerStop = nil
	}

	log.Println("Temperature logging scheduler stopped")
}

// RestartTemperatureScheduler restarts the scheduler with new settings
func RestartTemperatureScheduler() error {
	StopTemperatureScheduler()
	return StartTemperatureScheduler()
}

// collectTemperatureSnapshots collects temperature data from all active accounts
func collectTemperatureSnapshots(settings *TemperatureLogSettings) {
	log.Println("Collecting temperature snapshots...")

	// Check rate limit before proceeding
	if !apiCallCounter.CanMakeAPICall() {
		calls10m, calls24h := apiCallCounter.GetCurrentUsage()
		log.Printf("Rate limit check failed - skipping this cycle (10min: %d/110, 24h: %d/1400)", calls10m, calls24h)
		return
	}

	activeAccounts, err := GetActiveAccounts()
	if err != nil {
		log.Printf("Error loading active accounts: %v", err)
		return
	}

	if len(activeAccounts) == 0 {
		log.Println("No active accounts found")
		return
	}

	snapshotCount := 0

	for _, account := range activeAccounts {
		// Check rate limit before each account
		if !apiCallCounter.CanMakeAPICall() {
			calls10m, calls24h := apiCallCounter.GetCurrentUsage()
			log.Printf("Rate limit reached - stopping collection (10min: %d/110, 24h: %d/1400)", calls10m, calls24h)
			break
		}

		// Ensure account has valid token
		if err := EnsureAuthenticated(account); err != nil {
			log.Printf("Error authenticating account %s: %v", account.Name, err)
			continue
		}

		// Get installations for this account
		installations, err := getInstallationsForAccount(account)
		if err != nil {
			log.Printf("Error getting installations for account %s: %v", account.Name, err)
			continue
		}

		for _, installation := range installations {
			// Check rate limit before each installation
			if !apiCallCounter.CanMakeAPICall() {
				calls10m, calls24h := apiCallCounter.GetCurrentUsage()
				log.Printf("Rate limit reached - stopping collection (10min: %d/110, 24h: %d/1400)", calls10m, calls24h)
				break
			}

			// Record API call
			apiCallCounter.RecordAPICall()

			// Fetch features for this installation
			features, err := FetchAllFeaturesForInstallation(installation.ID, account)
			if err != nil {
				log.Printf("Error fetching features for installation %s: %v", installation.ID, err)
				continue
			}

			// Convert features to snapshot
			snapshot := convertFeaturesToSnapshot(features, installation, account)
			if snapshot != nil {
				if err := SaveTemperatureSnapshot(snapshot); err != nil {
					log.Printf("Error saving temperature snapshot: %v", err)
				} else {
					snapshotCount++
				}
			}
		}
	}

	// Cleanup old snapshots
	if err := CleanupOldTemperatureSnapshots(settings.RetentionDays); err != nil {
		log.Printf("Error cleaning up old temperature snapshots: %v", err)
	}

	calls10m, calls24h := apiCallCounter.GetCurrentUsage()
	log.Printf("Temperature snapshot collection complete: %d snapshots saved (API usage: 10min=%d/110, 24h=%d/1400)",
		snapshotCount, calls10m, calls24h)
}

// Installation represents a Viessmann installation
type Installation struct {
	ID        string
	GatewayID string
	DeviceID  string
}

// getInstallationsForAccount retrieves all installations for an account
func getInstallationsForAccount(account *Account) ([]Installation, error) {
	// Get equipment/installations from API
	equipment, err := FetchEquipment(account)
	if err != nil {
		return nil, err
	}

	var installations []Installation

	// Parse the equipment response to extract installation, gateway, and device IDs
	if data, ok := equipment["data"].([]interface{}); ok {
		for _, item := range data {
			if inst, ok := item.(map[string]interface{}); ok {
				installationID := ""
				if id, ok := inst["id"].(float64); ok {
					installationID = fmt.Sprintf("%.0f", id)
				} else if id, ok := inst["id"].(string); ok {
					installationID = id
				}

				// Get gateways
				if gateways, ok := inst["gateways"].([]interface{}); ok {
					for _, gw := range gateways {
						if gateway, ok := gw.(map[string]interface{}); ok {
							gatewaySerial := ""
							if serial, ok := gateway["serial"].(string); ok {
								gatewaySerial = serial
							}

							// Get devices
							if devices, ok := gateway["devices"].([]interface{}); ok {
								for _, dev := range devices {
									if device, ok := dev.(map[string]interface{}); ok {
										deviceID := ""
										if id, ok := device["id"].(string); ok {
											deviceID = id
										}

										if installationID != "" && gatewaySerial != "" && deviceID != "" {
											installations = append(installations, Installation{
												ID:        installationID,
												GatewayID: gatewaySerial,
												DeviceID:  deviceID,
											})
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}

	return installations, nil
}

// convertFeaturesToSnapshot converts API features to a TemperatureSnapshot
func convertFeaturesToSnapshot(features map[string]Feature, installation Installation, account *Account) *TemperatureSnapshot {
	snapshot := &TemperatureSnapshot{
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
		InstallationID: installation.ID,
		GatewayID:      installation.GatewayID,
		DeviceID:       installation.DeviceID,
		AccountID:      account.ID,
		AccountName:    account.Name,
	}

	// Helper function to extract float value
	getFloat := func(featureName string) *float64 {
		if feature, ok := features[featureName]; ok {
			if props, ok := feature.Properties["value"]; ok {
				if val, ok := props.(map[string]interface{}); ok {
					if v, ok := val["value"].(float64); ok {
						return &v
					}
				}
			}
		}
		return nil
	}

	// Helper function to extract string value
	getString := func(featureName string) *string {
		if feature, ok := features[featureName]; ok {
			if props, ok := feature.Properties["value"]; ok {
				if val, ok := props.(map[string]interface{}); ok {
					if v, ok := val["value"].(string); ok {
						return &v
					}
				}
			}
		}
		return nil
	}

	// Helper function to extract bool value
	getBool := func(featureName string) *bool {
		if feature, ok := features[featureName]; ok {
			if props, ok := feature.Properties["active"]; ok {
				if val, ok := props.(map[string]interface{}); ok {
					if v, ok := val["value"].(bool); ok {
						return &v
					}
				}
			}
			// Try "value" property as well
			if props, ok := feature.Properties["value"]; ok {
				if val, ok := props.(map[string]interface{}); ok {
					if v, ok := val["value"].(bool); ok {
						return &v
					}
				}
			}
		}
		return nil
	}

	// Extract temperature values
	snapshot.OutsideTemp = getFloat("heating.sensors.temperature.outside")
	snapshot.CalculatedOutsideTemp = getFloat("heating.sensors.temperature.outside.calculated")
	snapshot.SupplyTemp = getFloat("heating.sensors.temperature.supply")
	snapshot.ReturnTemp = getFloat("heating.sensors.temperature.return")
	snapshot.DHWTemp = getFloat("heating.dhw.sensors.temperature.hotWaterStorage")
	snapshot.BoilerTemp = getFloat("heating.boiler.sensors.temperature.main")
	snapshot.BufferTemp = getFloat("heating.buffer.sensors.temperature.main")
	snapshot.BufferTempTop = getFloat("heating.buffer.sensors.temperature.top")
	snapshot.PrimarySupplyTemp = getFloat("heating.circuits.0.sensors.temperature.supply")
	snapshot.SecondarySupplyTemp = getFloat("heating.circuits.1.sensors.temperature.supply")
	snapshot.PrimaryReturnTemp = getFloat("heating.circuits.0.sensors.temperature.return")
	snapshot.SecondaryReturnTemp = getFloat("heating.circuits.1.sensors.temperature.return")

	// Extract compressor data
	snapshot.CompressorActive = getBool("heating.compressors.0")
	snapshot.CompressorSpeed = getFloat("heating.compressors.0.statistics.speed")
	snapshot.CompressorPower = getFloat("heating.power.consumption")
	snapshot.CompressorCurrent = getFloat("heating.compressors.0.statistics.current")
	snapshot.CompressorPressure = getFloat("heating.compressors.0.refrigerant.pressure")
	snapshot.CompressorOilTemp = getFloat("heating.compressors.0.refrigerant.temperature.oil")
	snapshot.CompressorMotorTemp = getFloat("heating.compressors.0.statistics.temperature.motor")
	snapshot.CompressorInletTemp = getFloat("heating.compressors.0.refrigerant.temperature.inlet")
	snapshot.CompressorOutletTemp = getFloat("heating.compressors.0.refrigerant.temperature.outlet")
	snapshot.CompressorHours = getFloat("heating.compressors.0.statistics.hours")

	// Extract flow and energy
	snapshot.VolumetricFlow = getFloat("heating.sensors.volumetricFlow.allengra")

	// Calculate thermal power and COP
	if snapshot.VolumetricFlow != nil && snapshot.SecondarySupplyTemp != nil && snapshot.SecondaryReturnTemp != nil {
		deltaT := *snapshot.SecondarySupplyTemp - *snapshot.SecondaryReturnTemp
		if deltaT > 0 {
			// Thermal Power = Volume Flow (m³/h) × Density (kg/m³) × Specific Heat (kJ/kg·K) × ΔT (K) / 3.6 (convert to W)
			// For water: Density ≈ 1000 kg/m³, Specific Heat ≈ 4.18 kJ/kg·K
			thermalPowerKW := (*snapshot.VolumetricFlow) * 1000.0 * 4.18 * deltaT / 3600.0
			thermalPowerW := thermalPowerKW * 1000.0
			snapshot.ThermalPower = &thermalPowerW

			// Calculate COP
			if snapshot.CompressorPower != nil && *snapshot.CompressorPower > 0 {
				cop := thermalPowerW / *snapshot.CompressorPower
				snapshot.COP = &cop
			}
		}
	}

	// Extract operating state
	snapshot.FourWayValve = getString("heating.circuits.0.operating.modes.active")
	snapshot.BurnerModulation = getFloat("heating.burners.0.modulation")
	snapshot.SecondaryHeatGeneratorStatus = getString("heating.secondaryHeatGenerator.status")

	// Extract heating curve parameters
	snapshot.HeatingCurveSlope = getFloat("heating.circuits.0.heating.curve.slope")
	snapshot.HeatingCurveShift = getFloat("heating.circuits.0.heating.curve.shift")

	// Calculate target supply temperature based on heating curve
	if snapshot.HeatingCurveSlope != nil && snapshot.HeatingCurveShift != nil && snapshot.OutsideTemp != nil {
		// Formula: Target = (Slope × (20 - OutsideTemp)) + Shift + 20
		targetTemp := (*snapshot.HeatingCurveSlope * (20.0 - *snapshot.OutsideTemp)) + *snapshot.HeatingCurveShift + 20.0
		snapshot.TargetSupplyTemp = &targetTemp
	}

	return snapshot
}
