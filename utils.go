package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
)

// getEnv gets an environment variable with a default value
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getMapKeys extracts all keys from a map[string]interface{}
func getMapKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// extractFeatureValue extracts the value from feature properties
func extractFeatureValue(properties map[string]interface{}) FeatureValue {
	fv := FeatureValue{}

	// Check if there's a "value" property - this is the primary value
	if valueObj, ok := properties["value"].(map[string]interface{}); ok {
		// Extract the main value
		if typ, ok := valueObj["type"].(string); ok {
			fv.Type = typ
		}
		if val, ok := valueObj["value"]; ok {
			fv.Value = val
		}
		if unit, ok := valueObj["unit"].(string); ok {
			fv.Unit = unit
		}

		// If there are additional meaningful properties (not status/active), include them as nested
		// Properties like switchOnValue, switchOffValue should be included
		hasAdditionalProperties := false
		nestedValues := make(map[string]FeatureValue)

		for propName, propValue := range properties {
			// Skip the main "value" property and metadata properties like "status", "active"
			if propName == "value" || propName == "status" || propName == "active" || propName == "enabled" {
				continue
			}

			if propMap, ok := propValue.(map[string]interface{}); ok {
				nestedFv := FeatureValue{}
				if typ, ok := propMap["type"].(string); ok {
					nestedFv.Type = typ
				}
				if val, ok := propMap["value"]; ok {
					nestedFv.Value = val
				}
				if unit, ok := propMap["unit"].(string); ok {
					nestedFv.Unit = unit
				}
				nestedValues[propName] = nestedFv
				hasAdditionalProperties = true
			}
		}

		// If we have additional properties, return as object
		if hasAdditionalProperties {
			nestedValues["value"] = fv // Include the main value
			fv.Type = "object"
			fv.Value = nestedValues
		}

		return fv
	}

	// No "value" property - the properties themselves are the data
	// (e.g., heating.curve has "slope" and "shift" directly)
	nestedValues := make(map[string]FeatureValue)
	for propName, propValue := range properties {
		if propMap, ok := propValue.(map[string]interface{}); ok {
			nestedFv := FeatureValue{}
			if typ, ok := propMap["type"].(string); ok {
				nestedFv.Type = typ
			}
			if val, ok := propMap["value"]; ok {
				nestedFv.Value = val
			}
			if unit, ok := propMap["unit"].(string); ok {
				nestedFv.Unit = unit
			}
			nestedValues[propName] = nestedFv
		}
	}

	if len(nestedValues) > 0 {
		fv.Type = "object"
		fv.Value = nestedValues
	}

	return fv
}

// getGlobalAccessToken returns the global access token (for legacy support)
func getGlobalAccessToken() string {
	return accessToken
}

// getInstallationForEvent returns the installation ID for an event
func getInstallationForEvent(event Event) string {
	// Events are now tagged with their installation ID during fetch
	if event.InstallationID != "" {
		return event.InstallationID
	}
	return "unknown"
}

// findModelIDForDevice finds the model ID for a specific device from events
func findModelIDForDevice(installationID, deviceID string, events []Event) string {
	for _, event := range events {
		if event.InstallationID == installationID && event.DeviceID == deviceID && event.ModelID != "" {
			return event.ModelID
		}
	}
	return ""
}

// getGatewayFromEvents extracts gateway serial from cached events for a given installation
func getGatewayFromEvents(installationID string) string {
	fetchMutex.Lock()
	defer fetchMutex.Unlock()

	// Look through cached events to find gateway serial
	for _, event := range eventsCache {
		if event.InstallationID == installationID && event.GatewaySerial != "" {
			log.Printf("Found gateway %s for installation %s from events cache\n", event.GatewaySerial, installationID)
			return event.GatewaySerial
		}
	}

	return ""
}

// processEvent processes a raw event map into an Event struct
func processEvent(raw map[string]interface{}) Event {
	event := Event{}

	// Extract basic fields
	event.EventTimestamp, _ = raw["eventTimestamp"].(string)
	event.CreatedAt, _ = raw["createdAt"].(string)
	event.EventType, _ = raw["eventType"].(string)
	event.GatewaySerial, _ = raw["gatewaySerial"].(string)

	// Use eventTimestamp or createdAt for timestamp
	timestamp := event.EventTimestamp
	if timestamp == "" {
		timestamp = event.CreatedAt
	}

	// Keep timestamp in RFC3339 format for browser-side timezone conversion
	event.FormattedTime = timestamp

	// Extract body
	if body, ok := raw["body"].(map[string]interface{}); ok {
		event.Body = body

		// Extract errorDescription first
		var errorDescription string
		if errorDesc, ok := body["errorDescription"].(string); ok {
			event.ErrorDescription = errorDesc
			errorDescription = errorDesc
		}

		if errorCode, ok := body["errorCode"].(string); ok {
			event.ErrorCode = errorCode
			event.HumanReadable = getErrorDescription(errorCode)
			event.CodeCategory = getCodeCategory(errorCode)
			event.Severity = getSeverity(errorCode)

			// If description is "Unbekannter..." and we have errorDescription from API, use that instead
			if strings.Contains(event.HumanReadable, "Unbekannter") && errorDescription != "" {
				event.HumanReadable = errorCode + " - " + errorDescription
			}
		}

		if deviceID, ok := body["deviceId"].(string); ok {
			event.DeviceID = deviceID
		} else if deviceID, ok := body["deviceId"].(float64); ok {
			event.DeviceID = fmt.Sprintf("%.0f", deviceID)
		} else {
			// Try to get deviceId from top-level
			if deviceID, ok := raw["deviceId"].(string); ok {
				event.DeviceID = deviceID
			} else if deviceID, ok := raw["deviceId"].(float64); ok {
				event.DeviceID = fmt.Sprintf("%.0f", deviceID)
			} else {
				event.DeviceID = "0"
				// Debug: log event structure to see where deviceId is
				if event.ModelID != "" {
					log.Printf("DEBUG: Event has no deviceId - EventType: %s, ModelID: %s, Body keys: %v\n",
						event.EventType, event.ModelID, getMapKeys(body))
				}
			}
		}

		if modelID, ok := body["modelId"].(string); ok {
			event.ModelID = modelID
		} else {
			event.ModelID = "Unknown"
		}

		if active, ok := body["active"].(bool); ok {
			event.Active = &active
		}

		// Handle gateway-online/offline distinction
		if event.EventType == "gateway-online" {
			if online, ok := body["online"].(bool); ok && !online {
				event.EventType = "gateway-offline"
			}
		}

		// Handle feature-changed events
		if event.EventType == "feature-changed" {
			if featureName, ok := body["featureName"].(string); ok {
				event.FeatureName = featureName
			}

			// Extract value from commandBody
			if commandBody, ok := body["commandBody"].(map[string]interface{}); ok && len(commandBody) > 0 {
				// Convert commandBody to a readable string
				values := []string{}
				for key, val := range commandBody {
					values = append(values, fmt.Sprintf("%s: %v", key, val))
				}
				event.FeatureValue = strings.Join(values, ", ")
			}
		}
	}

	// Store raw JSON
	if rawJSON, err := json.MarshalIndent(raw, "", "  "); err == nil {
		event.Raw = string(rawJSON)
	}

	return event
}
