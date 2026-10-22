package main

import (
	"crypto/subtle"
	"log"
	"net/http"
	"os"
)

// BasicAuthMiddleware provides HTTP Basic Authentication if credentials are configured
func BasicAuthMiddleware(next http.Handler) http.Handler {
	username := os.Getenv("BASIC_AUTH_USER")
	password := os.Getenv("BASIC_AUTH_PASSWORD")

	// If no credentials configured, skip authentication
	if username == "" || password == "" {
		return next
	}

	log.Printf("Basic Auth enabled for user: %s\n", username)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Allow Kubernetes (or any other) probes to reach /health without credentials
		// /mcp is secured by its own bearer token (MCP clients can't send Basic Auth and a token at once)
		if r.URL.Path == "/health" || r.URL.Path == "/mcp" {
			next.ServeHTTP(w, r)
			return
		}

		user, pass, ok := r.BasicAuth()

		// Use constant-time comparison to prevent timing attacks
		userMatch := subtle.ConstantTimeCompare([]byte(user), []byte(username)) == 1
		passMatch := subtle.ConstantTimeCompare([]byte(pass), []byte(password)) == 1

		if !ok || !userMatch || !passMatch {
			w.Header().Set("WWW-Authenticate", `Basic realm="ViEventLog"`)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}
