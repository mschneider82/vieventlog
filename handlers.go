package main

import (
	"encoding/json"
	"html/template"
	"log"
	"net/http"
	"time"
)

// ============================================================================
// Page Handlers
// ============================================================================

func indexHandler(w http.ResponseWriter, r *http.Request) {
	// Check if credentials are available
	if currentCreds == nil {
		http.Redirect(w, r, "/login", http.StatusSeeOther)
		return
	}

	tmpl, err := template.ParseFS(templatesFS, "templates/index.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	tmpl.Execute(w, nil)
}

func loginPageHandler(w http.ResponseWriter, r *http.Request) {
	tmpl, err := template.ParseFS(templatesFS, "templates/login.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	tmpl.Execute(w, nil)
}

func dashboardPageHandler(w http.ResponseWriter, r *http.Request) {
	tmpl, err := template.ParseFS(templatesFS, "templates/dashboard.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	tmpl.Execute(w, nil)
}

func accountsPageHandler(w http.ResponseWriter, r *http.Request) {
	tmpl, err := template.ParseFS(templatesFS, "templates/accounts.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	tmpl.Execute(w, nil)
}

// ============================================================================
// Auth Handlers (Legacy)
// ============================================================================

func loginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(LoginResponse{
			Success: false,
			Error:   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.Email == "" || req.Password == "" || req.ClientID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(LoginResponse{
			Success: false,
			Error:   "Email, password, and client ID are required",
		})
		return
	}

	// Test the credentials (always use default client secret)
	testCreds := &Credentials{
		Email:        req.Email,
		Password:     req.Password,
		ClientID:     req.ClientID,
		ClientSecret: defaultClientSecret,
	}

	if err := testCredentials(testCreds); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(LoginResponse{
			Success: false,
			Error:   "Authentication failed: " + err.Error(),
		})
		return
	}

	// Save credentials to keyring
	if err := SaveCredentials(*testCreds); err != nil {
		log.Printf("Warning: Failed to save credentials to keyring: %v\n", err)
		// Continue anyway - credentials are valid
	} else {
		log.Println("Credentials successfully saved to keyring")
	}

	// Update current credentials
	currentCreds = testCreds

	// Reset token to force re-authentication with new credentials
	accessToken = ""
	refreshToken = ""
	tokenExpiry = time.Time{}
	installationIDs = nil

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(LoginResponse{
		Success: true,
	})
}

func credentialsCheckHandler(w http.ResponseWriter, r *http.Request) {
	response := CredentialsCheckResponse{
		HasCredentials: currentCreds != nil && currentCreds.Email != "",
	}

	if currentCreds != nil {
		response.Email = currentCreds.Email
		response.ClientID = currentCreds.ClientID
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func credentialsDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := DeleteCredentials(); err != nil {
		log.Printf("Warning: Failed to delete credentials from keyring: %v\n", err)
	}

	currentCreds = nil
	accessToken = ""
	refreshToken = ""
	tokenExpiry = time.Time{}
	installationIDs = nil

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// ============================================================================
// Account Management Handlers
// ============================================================================

func accountsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	store, err := LoadAccounts()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	accounts := make([]AccountResponse, 0, len(store.Accounts))
	for _, acc := range store.Accounts {
		accounts = append(accounts, AccountResponse{
			ID:          acc.ID,
			Name:        acc.Name,
			Email:       acc.Email,
			ClientID:    acc.ClientID,
			Active:      acc.Active,
			HasPassword: acc.Password != "",
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AccountsListResponse{Accounts: accounts})
}

func accountAddHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req AccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.Email == "" || req.Password == "" || req.ClientID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Email, password, and client ID are required",
		})
		return
	}

	// Test credentials before adding (always use default client secret)
	testCreds := &Credentials{
		Email:        req.Email,
		Password:     req.Password,
		ClientID:     req.ClientID,
		ClientSecret: defaultClientSecret,
	}

	if err := testCredentials(testCreds); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Authentication failed: " + err.Error(),
		})
		return
	}

	// Add account (always use default client secret)
	account := &Account{
		ID:           req.Email, // Use email as ID
		Name:         req.Name,
		Email:        req.Email,
		Password:     req.Password,
		ClientID:     req.ClientID,
		ClientSecret: defaultClientSecret,
		Active:       req.Active,
	}

	if account.Name == "" {
		account.Name = account.Email
	}

	if err := AddAccount(account); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Failed to add account: " + err.Error(),
		})
		return
	}

	// Clear cache to force refresh with new account
	fetchMutex.Lock()
	eventsCache = nil
	lastFetchTime = time.Time{}
	fetchMutex.Unlock()

	log.Printf("Account added: %s (%s)\n", account.Name, account.Email)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AccountActionResponse{Success: true})
}

func accountUpdateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req AccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Invalid request: " + err.Error(),
		})
		return
	}

	// Get existing account
	existing, err := GetAccount(req.ID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Account not found: " + err.Error(),
		})
		return
	}

	// Update fields
	if req.Name != "" {
		existing.Name = req.Name
	}
	if req.Password != "" {
		existing.Password = req.Password
	}
	if req.ClientID != "" {
		existing.ClientID = req.ClientID
	}
	// Always use default client secret
	existing.ClientSecret = defaultClientSecret

	if err := UpdateAccount(existing); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Failed to update account: " + err.Error(),
		})
		return
	}

	// Clear token for this account (will re-authenticate with new credentials)
	accountsMutex.Lock()
	delete(accountTokens, existing.ID)
	accountsMutex.Unlock()

	// Clear cache to force refresh
	fetchMutex.Lock()
	eventsCache = nil
	lastFetchTime = time.Time{}
	fetchMutex.Unlock()

	log.Printf("Account updated: %s (%s)\n", existing.Name, existing.Email)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AccountActionResponse{Success: true})
}

func accountDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Invalid request: " + err.Error(),
		})
		return
	}

	if err := DeleteAccount(req.ID); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Failed to delete account: " + err.Error(),
		})
		return
	}

	// Remove token for this account
	accountsMutex.Lock()
	delete(accountTokens, req.ID)
	accountsMutex.Unlock()

	log.Printf("Account deleted: %s\n", req.ID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AccountActionResponse{Success: true})
}

func accountToggleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID     string `json:"id"`
		Active bool   `json:"active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Invalid request: " + err.Error(),
		})
		return
	}

	if err := SetAccountActive(req.ID, req.Active); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Failed to toggle account: " + err.Error(),
		})
		return
	}

	// Clear cache when toggling accounts
	fetchMutex.Lock()
	eventsCache = nil
	lastFetchTime = time.Time{}
	fetchMutex.Unlock()

	log.Printf("Account %s set to active=%v\n", req.ID, req.Active)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AccountActionResponse{Success: true})
}

// ============================================================================
// Helper Functions
// ============================================================================
// testCredentials is in auth.go
