package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// loadStoredCredentials loads credentials from the keyring
func loadStoredCredentials() {
	// Load credentials from keyring
	creds, err := LoadCredentials()
	if err == nil && creds != nil && creds.Email != "" {
		currentCreds = creds
		log.Printf("Loaded credentials from keyring for: %s\n", creds.Email)
		return
	}

	log.Println("No credentials found. Please login via web interface.")
}

// testCredentials verifies that the provided credentials are valid
func testCredentials(creds *Credentials) error {
	// Use the ViCare-specific authentication (Authorization Code flow with PKCE)
	tokenResp, err := AuthenticateWithViCare(creds.Email, creds.Password, creds.ClientID)
	if err != nil {
		return fmt.Errorf("authentication failed: %w", err)
	}

	// Try to fetch installations to verify the token works
	req, err := NewRequest("GET", "https://api.viessmann-climatesolutions.com/iot/v2/equipment/installations", nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+tokenResp.AccessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to verify token: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var result struct {
		Data []struct {
			ID interface{} `json:"id"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("failed to decode response: %w", err)
	}

	if len(result.Data) == 0 {
		return fmt.Errorf("no installations found for this account")
	}

	log.Printf("Successfully authenticated and found %d installation(s)\n", len(result.Data))
	return nil
}

// ensureAccountAuthenticated ensures a specific account is authenticated and returns its token
func ensureAccountAuthenticated(account *Account) (*AccountToken, error) {
	accountsMutex.RLock()
	token, exists := accountTokens[account.ID]
	accountsMutex.RUnlock()

	// Check if token is still valid
	if exists && token.AccessToken != "" && time.Now().Before(token.TokenExpiry) {
		return token, nil
	}

	// Need to authenticate
	accountsMutex.Lock()
	defer accountsMutex.Unlock()

	// Double-check after acquiring write lock
	token, exists = accountTokens[account.ID]
	if exists && token.AccessToken != "" && time.Now().Before(token.TokenExpiry) {
		return token, nil
	}

	// Authenticate
	tokenResp, err := AuthenticateWithViCare(account.Email, account.Password, account.ClientID)
	if err != nil {
		return nil, fmt.Errorf("authentication failed: %w", err)
	}

	// Fetch installation IDs for this account
	installationIDs, installations, err := fetchInstallationIDsForAccount(tokenResp.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch installations: %w", err)
	}

	// Store token
	token = &AccountToken{
		AccessToken:     tokenResp.AccessToken,
		RefreshToken:    tokenResp.RefreshToken,
		TokenExpiry:     time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second),
		InstallationIDs: installationIDs,
		Installations:   installations,
	}
	accountTokens[account.ID] = token

	log.Printf("Authenticated account %s, found %d installations\n", account.Email, len(installationIDs))

	return token, nil
}

// ensureAuthenticated ensures the current credentials are authenticated (legacy support)
func ensureAuthenticated() error {
	if currentCreds == nil {
		return fmt.Errorf("no credentials configured")
	}

	// Check if token is still valid
	if accessToken != "" && time.Now().Before(tokenExpiry) {
		return nil
	}

	// Get installation IDs if we don't have them
	if len(installationIDs) == 0 {
		if err := fetchInstallationIDs(); err != nil {
			return err
		}
	}

	// Authenticate using ViCare Authorization Code flow with PKCE
	tokenResp, err := AuthenticateWithViCare(currentCreds.Email, currentCreds.Password, currentCreds.ClientID)
	if err != nil {
		return fmt.Errorf("authentication failed: %w", err)
	}

	accessToken = tokenResp.AccessToken
	refreshToken = tokenResp.RefreshToken
	tokenExpiry = time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)

	log.Println("Successfully authenticated")
	return nil
}

// fetchInstallationIDsForAccount fetches installation IDs for a specific account with cursor pagination
func fetchInstallationIDsForAccount(accessToken string) ([]string, map[string]*Installation, error) {
	installations := make(map[string]*Installation)
	installationIDs := make([]string, 0)

	var cursor string
	pageCount := 0
	maxPages := 100 // Safety limit

	for pageCount < maxPages {
		pageCount++

		// Build URL with cursor and includeGateways parameter
		baseURL := "https://api.viessmann-climatesolutions.com/iot/v2/equipment/installations"
		req, err := NewRequest("GET", baseURL, nil)
		if err != nil {
			return nil, nil, err
		}

		q := req.URL.Query()
		q.Add("includeGateways", "true")
		q.Add("limit", "1000") // Max allowed by API
		if cursor != "" {
			q.Add("cursor", cursor)
		}
		req.URL.RawQuery = q.Encode()

		req.Header.Set("Authorization", "Bearer "+accessToken)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, nil, err
		}

		var rawResult struct {
			Data   []map[string]interface{} `json:"data"`
			Cursor *struct {
				Next string `json:"next"`
			} `json:"cursor,omitempty"`
		}

		if err := json.NewDecoder(resp.Body).Decode(&rawResult); err != nil {
			resp.Body.Close()
			return nil, nil, err
		}
		resp.Body.Close()

		if len(rawResult.Data) == 0 {
			// No more installations
			break
		}

		log.Printf("Page %d: fetched %d installations\n", pageCount, len(rawResult.Data))

		for _, rawInstall := range rawResult.Data {
			installation := &Installation{}

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

			if idStr == "" {
				continue
			}

			installation.ID = idStr

			if desc, ok := rawInstall["description"].(string); ok {
				installation.Description = desc
			}

			if addr, ok := rawInstall["address"].(map[string]interface{}); ok {
				if street, ok := addr["street"].(string); ok {
					installation.Address.Street = street
				}
				if houseNumber, ok := addr["houseNumber"].(string); ok {
					installation.Address.HouseNumber = houseNumber
				}
				if zip, ok := addr["zip"].(string); ok {
					installation.Address.Zip = zip
				}
				if city, ok := addr["city"].(string); ok {
					installation.Address.City = city
				}
				if country, ok := addr["country"].(string); ok {
					installation.Address.Country = country
				}
			}

			// Extract gateway information (with includeGateways=true, we get full device info)
			if gateways, ok := rawInstall["gateways"].([]interface{}); ok {
				for _, gw := range gateways {
					if gwMap, ok := gw.(map[string]interface{}); ok {
						gateway := Gateway{}
						if serial, ok := gwMap["serial"].(string); ok {
							gateway.Serial = serial
						}
						if version, ok := gwMap["version"].(string); ok {
							gateway.Version = version
						}
						// Extract device information from devices array (PyViCare style)
						if devices, ok := gwMap["devices"].([]interface{}); ok {
							for _, dev := range devices {
								if devMap, ok := dev.(map[string]interface{}); ok {
									var devID string
									var devType string
									var modelID string

									// Get device ID
									if id, ok := devMap["id"].(string); ok {
										devID = id
										// Handle special cases like PyViCare does
										if id == "gateway" && devMap["deviceType"] == "vitoconnect" {
											devID = "0"
										} else if id == "gateway" && devMap["deviceType"] == "tcu" {
											devID = "0"
										} else if id == "HEMS" && devMap["deviceType"] == "hems" {
											devID = "0"
										} else if id == "EEBUS" && devMap["deviceType"] == "EEBus" {
											devID = "0"
										}
									} else if id, ok := devMap["id"].(float64); ok {
										devID = fmt.Sprintf("%.0f", id)
									}

									// Get device type
									if dt, ok := devMap["deviceType"].(string); ok {
										devType = dt
									}

									// Get model ID
									if mid, ok := devMap["modelId"].(string); ok {
										modelID = mid
									}

									if devID != "" {
										gateway.Devices = append(gateway.Devices, GatewayDevice{
											DeviceID:   devID,
											DeviceType: devType,
											ModelID:    modelID,
										})
										log.Printf("Found device in gateway %s: ID=%s, Type=%s, Model=%s\n",
											gateway.Serial, devID, devType, modelID)
									}
								}
							}
						}
						installation.Gateways = append(installation.Gateways, gateway)
					}
				}
			}

			installations[idStr] = installation
			installationIDs = append(installationIDs, idStr)

			log.Printf("Loaded installation %s: %s\n", idStr, installation.Description)
		}

		// Check if there's a next page
		if rawResult.Cursor == nil || rawResult.Cursor.Next == "" {
			// No more pages
			break
		}

		// Continue with next cursor
		cursor = rawResult.Cursor.Next
	}

	if pageCount >= maxPages {
		log.Printf("Warning: reached maximum page limit (%d) for installations\n", maxPages)
	}

	if len(installationIDs) == 0 {
		return nil, nil, fmt.Errorf("no installations found")
	}

	log.Printf("Total installations found: %d (fetched in %d page(s))\n", len(installationIDs), pageCount)
	return installationIDs, installations, nil
}

// fetchInstallationIDs fetches installation IDs for the current credentials (legacy support)
func fetchInstallationIDs() error {
	if currentCreds == nil {
		return fmt.Errorf("no credentials configured")
	}

	// First authenticate
	tokenResp, err := AuthenticateWithViCare(currentCreds.Email, currentCreds.Password, currentCreds.ClientID)
	if err != nil {
		return fmt.Errorf("authentication failed: %w", err)
	}

	accessToken = tokenResp.AccessToken
	refreshToken = tokenResp.RefreshToken
	tokenExpiry = time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)

	// Initialize installations map
	installations = make(map[string]*Installation)
	installationIDs = make([]string, 0)

	var cursor string
	pageCount := 0
	maxPages := 100 // Safety limit

	for pageCount < maxPages {
		pageCount++

		// Build URL with cursor parameter
		baseURL := "https://api.viessmann-climatesolutions.com/iot/v2/equipment/installations"
		req, err := NewRequest("GET", baseURL, nil)
		if err != nil {
			return err
		}

		q := req.URL.Query()
		q.Add("limit", "1000") // Max allowed by API
		if cursor != "" {
			q.Add("cursor", cursor)
		}
		req.URL.RawQuery = q.Encode()

		req.Header.Set("Authorization", "Bearer "+accessToken)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}

		// Decode as raw JSON to handle ID type flexibility
		var rawResult struct {
			Data   []map[string]interface{} `json:"data"`
			Cursor *struct {
				Next string `json:"next"`
			} `json:"cursor,omitempty"`
		}

		if err := json.NewDecoder(resp.Body).Decode(&rawResult); err != nil {
			resp.Body.Close()
			return err
		}
		resp.Body.Close()

		if len(rawResult.Data) == 0 {
			// No more installations
			break
		}

		log.Printf("Page %d: fetched %d installations\n", pageCount, len(rawResult.Data))

		// Process each installation
		for _, rawInstall := range rawResult.Data {
			installation := &Installation{}

			// Extract ID (can be string or number)
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

			if idStr == "" {
				continue
			}

			installation.ID = idStr

			// Extract description
			if desc, ok := rawInstall["description"].(string); ok {
				installation.Description = desc
			}

			// Extract address
			if addr, ok := rawInstall["address"].(map[string]interface{}); ok {
				if street, ok := addr["street"].(string); ok {
					installation.Address.Street = street
				}
				if houseNumber, ok := addr["houseNumber"].(string); ok {
					installation.Address.HouseNumber = houseNumber
				}
				if zip, ok := addr["zip"].(string); ok {
					installation.Address.Zip = zip
				}
				if city, ok := addr["city"].(string); ok {
					installation.Address.City = city
				}
				if country, ok := addr["country"].(string); ok {
					installation.Address.Country = country
				}
			}

			// Extract gateway information (with includeGateways=true, we get full device info)
			if gateways, ok := rawInstall["gateways"].([]interface{}); ok {
				for _, gw := range gateways {
					if gwMap, ok := gw.(map[string]interface{}); ok {
						gateway := Gateway{}
						if serial, ok := gwMap["serial"].(string); ok {
							gateway.Serial = serial
						}
						if version, ok := gwMap["version"].(string); ok {
							gateway.Version = version
						}
						// Extract device information from devices array (PyViCare style)
						if devices, ok := gwMap["devices"].([]interface{}); ok {
							for _, dev := range devices {
								if devMap, ok := dev.(map[string]interface{}); ok {
									var devID string
									var devType string
									var modelID string

									// Get device ID
									if id, ok := devMap["id"].(string); ok {
										devID = id
										// Handle special cases like PyViCare does
										if id == "gateway" && devMap["deviceType"] == "vitoconnect" {
											devID = "0"
										} else if id == "gateway" && devMap["deviceType"] == "tcu" {
											devID = "0"
										} else if id == "HEMS" && devMap["deviceType"] == "hems" {
											devID = "0"
										} else if id == "EEBUS" && devMap["deviceType"] == "EEBus" {
											devID = "0"
										}
									} else if id, ok := devMap["id"].(float64); ok {
										devID = fmt.Sprintf("%.0f", id)
									}

									// Get device type
									if dt, ok := devMap["deviceType"].(string); ok {
										devType = dt
									}

									// Get model ID
									if mid, ok := devMap["modelId"].(string); ok {
										modelID = mid
									}

									if devID != "" {
										gateway.Devices = append(gateway.Devices, GatewayDevice{
											DeviceID:   devID,
											DeviceType: devType,
											ModelID:    modelID,
										})
										log.Printf("Found device in gateway %s: ID=%s, Type=%s, Model=%s\n",
											gateway.Serial, devID, devType, modelID)
									}
								}
							}
						}
						installation.Gateways = append(installation.Gateways, gateway)
					}
				}
			}

			installations[idStr] = installation
			installationIDs = append(installationIDs, idStr)

			location := "Unknown location"
			if installation.Address.City != "" {
				location = fmt.Sprintf("%s, %s", installation.Address.City, installation.Address.Country)
			}

			log.Printf("Found installation ID: %s (%s) at %s\n",
				idStr, installation.Description, location)
		}

		// Check if there's a next page
		if rawResult.Cursor == nil || rawResult.Cursor.Next == "" {
			// No more pages
			break
		}

		// Continue with next cursor
		cursor = rawResult.Cursor.Next
	}

	if pageCount >= maxPages {
		log.Printf("Warning: reached maximum page limit (%d) for installations\n", maxPages)
	}

	if len(installationIDs) == 0 {
		return fmt.Errorf("no installations found")
	}

	log.Printf("Total installations found: %d (fetched in %d page(s))\n", len(installationIDs), pageCount)
	return nil
}
