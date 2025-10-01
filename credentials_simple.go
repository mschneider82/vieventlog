//go:build nokeyring

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// SimpleStorage implements credential storage without keyring (env/file only)
type SimpleStorage struct{}

func (s *SimpleStorage) SaveCredentials(creds Credentials) error {
	return fmt.Errorf("credential saving not supported in nokeyring build - use environment variables or file storage")
}

func (s *SimpleStorage) LoadCredentials() (*Credentials, error) {
	// Try environment variables first
	if email := os.Getenv("VICARE_EMAIL"); email != "" {
		return &Credentials{
			Email:        email,
			Password:     os.Getenv("VICARE_PASSWORD"),
			ClientID:     os.Getenv("VICARE_CLIENT_ID"),
			ClientSecret: defaultClientSecret,
		}, nil
	}

	// Try legacy account file
	configPath := getConfigPath()
	data, err := os.ReadFile(filepath.Join(configPath, "credentials.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // No credentials stored
		}
		return nil, fmt.Errorf("failed to read credentials file: %w", err)
	}

	var creds Credentials
	if err := json.Unmarshal(data, &creds); err != nil {
		return nil, fmt.Errorf("failed to unmarshal credentials: %w", err)
	}

	return &creds, nil
}

func (s *SimpleStorage) DeleteCredentials() error {
	return fmt.Errorf("credential deletion not supported in nokeyring build")
}

func (s *SimpleStorage) SaveAccounts(store *AccountStore) error {
	configPath := getConfigPath()

	// Create directory if it doesn't exist
	if err := os.MkdirAll(configPath, 0700); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal accounts: %w", err)
	}

	filePath := filepath.Join(configPath, "accounts.json")
	if err := os.WriteFile(filePath, data, 0600); err != nil {
		return fmt.Errorf("failed to write accounts file: %w", err)
	}

	return nil
}

func (s *SimpleStorage) LoadAccounts() (*AccountStore, error) {
	// Try VICARE_ACCOUNTS environment variable first (JSON format)
	if accountsJSON := os.Getenv("VICARE_ACCOUNTS"); accountsJSON != "" {
		var store AccountStore
		if err := json.Unmarshal([]byte(accountsJSON), &store); err != nil {
			return nil, fmt.Errorf("failed to unmarshal VICARE_ACCOUNTS: %w", err)
		}
		if store.Accounts == nil {
			store.Accounts = make(map[string]*Account)
		}
		return &store, nil
	}

	// Try individual environment variables (single account)
	if email := os.Getenv("VICARE_EMAIL"); email != "" {
		store := &AccountStore{
			Accounts: make(map[string]*Account),
		}
		account := &Account{
			ID:           email,
			Name:         os.Getenv("VICARE_ACCOUNT_NAME"),
			Email:        email,
			Password:     os.Getenv("VICARE_PASSWORD"),
			ClientID:     os.Getenv("VICARE_CLIENT_ID"),
			ClientSecret: defaultClientSecret,
			Active:       true,
		}
		if account.Name == "" {
			account.Name = email
		}
		store.Accounts[account.ID] = account
		return store, nil
	}

	// Try file storage
	configPath := getConfigPath()
	filePath := filepath.Join(configPath, "accounts.json")

	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return &AccountStore{Accounts: make(map[string]*Account)}, nil
		}
		return nil, fmt.Errorf("failed to read accounts file: %w", err)
	}

	var store AccountStore
	if err := json.Unmarshal(data, &store); err != nil {
		return nil, fmt.Errorf("failed to unmarshal accounts: %w", err)
	}

	if store.Accounts == nil {
		store.Accounts = make(map[string]*Account)
	}

	return &store, nil
}

func getConfigPath() string {
	// Default to /config for container use, or current dir for testing
	if configDir := os.Getenv("VICARE_CONFIG_DIR"); configDir != "" {
		return configDir
	}
	if _, err := os.Stat("/config"); err == nil {
		return "/config"
	}
	return "."
}

func newCredentialStorage() CredentialStorage {
	return &SimpleStorage{}
}
