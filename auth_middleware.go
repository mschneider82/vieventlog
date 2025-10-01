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
