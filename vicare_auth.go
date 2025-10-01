package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const (
	authorizeURL = "https://iam.viessmann-climatesolutions.com/idp/v3/authorize"
	tokenURL     = "https://iam.viessmann-climatesolutions.com/idp/v3/token"
	redirectURI  = "vicare://oauth-callback/everest"
)

var viessmannScope = []string{"IoT User"}

// TokenResponse represents the OAuth2 token response
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

// generateCodeVerifier generates a random code verifier for PKCE
func generateCodeVerifier() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// generateCodeChallenge generates the code challenge from the verifier
func generateCodeChallenge(verifier string) string {
	hash := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(hash[:])
}

// AuthenticateWithViCare performs the OAuth2 Authorization Code flow with PKCE
func AuthenticateWithViCare(username, password, clientID string) (*TokenResponse, error) {
	// Generate PKCE parameters
	codeVerifier := generateCodeVerifier()
	codeChallenge := generateCodeChallenge(codeVerifier)

	// Build authorization URL
	authParams := url.Values{}
	authParams.Add("client_id", clientID)
	authParams.Add("redirect_uri", redirectURI)
	authParams.Add("response_type", "code")
	authParams.Add("code_challenge", codeChallenge)
	authParams.Add("code_challenge_method", "S256")
	authParams.Add("scope", strings.Join(viessmannScope, " "))

	authURL := authorizeURL + "?" + authParams.Encode()

	// Step 1: POST to authorization URL with credentials
	req, err := http.NewRequest("POST", authURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create auth request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(username, password)

	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse // Don't follow redirects
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("auth request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("invalid credentials (401): %s", string(body))
	}

	// Check for redirect with authorization code
	location := resp.Header.Get("Location")
	if location == "" {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("no redirect location in response (status %d): %s", resp.StatusCode, string(body))
	}

	// Extract authorization code from redirect URL
	redirectURL, err := url.Parse(location)
	if err != nil {
		return nil, fmt.Errorf("failed to parse redirect URL: %w", err)
	}

	code := redirectURL.Query().Get("code")
	if code == "" {
		return nil, fmt.Errorf("no authorization code in redirect URL: %s", location)
	}

	// Step 2: Exchange authorization code for access token
	tokenParams := url.Values{}
	tokenParams.Add("grant_type", "authorization_code")
	tokenParams.Add("client_id", clientID)
	tokenParams.Add("redirect_uri", redirectURI)
	tokenParams.Add("code", code)
	tokenParams.Add("code_verifier", codeVerifier)

	tokenReq, err := http.NewRequest("POST", tokenURL, strings.NewReader(tokenParams.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create token request: %w", err)
	}

	tokenReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	tokenResp, err := http.DefaultClient.Do(tokenReq)
	if err != nil {
		return nil, fmt.Errorf("token request failed: %w", err)
	}
	defer tokenResp.Body.Close()

	if tokenResp.StatusCode != 200 {
		body, _ := io.ReadAll(tokenResp.Body)
		return nil, fmt.Errorf("token request failed (status %d): %s", tokenResp.StatusCode, string(body))
	}

	var tokenResponse TokenResponse
	if err := json.NewDecoder(tokenResp.Body).Decode(&tokenResponse); err != nil {
		return nil, fmt.Errorf("failed to decode token response: %w", err)
	}

	return &tokenResponse, nil
}
