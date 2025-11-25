package main

import (
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var (
	schedulerRunning bool
	schedulerMutex   sync.Mutex
	schedulerStop    chan bool
	schedulerTicker  *time.Ticker
)

// StartEventArchiveScheduler starts the background job for periodic event archiving
func StartEventArchiveScheduler() error {
	schedulerMutex.Lock()
	defer schedulerMutex.Unlock()

	if schedulerRunning {
		log.Println("Event archive scheduler already running")
		return nil
	}

	// Get settings
	settings, err := GetEventArchiveSettings()
	if err != nil {
		return err
	}

	if !settings.Enabled {
		log.Println("Event archiving is disabled, scheduler not started")
		return nil
	}

	// Initialize database
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

	err = InitEventDatabase(settings.DatabasePath)
	if err != nil {
		return err
	}

	// Create ticker with refresh interval
	intervalDuration := time.Duration(settings.RefreshInterval) * time.Minute
	schedulerTicker = time.NewTicker(intervalDuration)
	schedulerStop = make(chan bool)
	schedulerRunning = true

	log.Printf("Event archive scheduler started with interval: %d minutes", settings.RefreshInterval)

	// Start background goroutine
	go func() {
		// Run once immediately on startup
		archiveEventsJob()

		for {
			select {
			case <-schedulerTicker.C:
				archiveEventsJob()
			case <-schedulerStop:
				log.Println("Event archive scheduler stopped")
				return
			}
		}
	}()

	return nil
}

// StopEventArchiveScheduler stops the background job
func StopEventArchiveScheduler() {
	schedulerMutex.Lock()
	defer schedulerMutex.Unlock()

	if !schedulerRunning {
		return
	}

	if schedulerTicker != nil {
		schedulerTicker.Stop()
	}

	if schedulerStop != nil {
		close(schedulerStop)
	}

	schedulerRunning = false
	log.Println("Event archive scheduler stopped")
}

// RestartEventArchiveScheduler restarts the scheduler with new settings
func RestartEventArchiveScheduler() error {
	StopEventArchiveScheduler()

	// Small delay to ensure cleanup
	time.Sleep(100 * time.Millisecond)

	return StartEventArchiveScheduler()
}

// archiveEventsJob is the main job that fetches and archives events
func archiveEventsJob() {
	log.Println("Running event archive job...")

	// Get settings
	settings, err := GetEventArchiveSettings()
	if err != nil {
		log.Printf("Error getting archive settings: %v", err)
		return
	}

	if !settings.Enabled {
		log.Println("Event archiving disabled, skipping job")
		return
	}

	// Fetch events from API (using default 7 days)
	events, err := fetchEvents(7)
	if err != nil {
		log.Printf("Error fetching events: %v", err)
		return
	}

	// Save events to database (with deduplication)
	err = SaveEventsToDB(events)
	if err != nil {
		log.Printf("Error saving events to database: %v", err)
		return
	}

	// Cleanup old events based on retention policy
	err = CleanupOldEvents(settings.RetentionDays)
	if err != nil {
		log.Printf("Error cleaning up old events: %v", err)
		return
	}

	// Log statistics
	count, _ := GetEventCount()
	oldest, _ := GetOldestEventTimestamp()
	log.Printf("Event archive job completed. Total events: %d, Oldest: %s", count, oldest)
}

// IsSchedulerRunning returns whether the scheduler is currently running
func IsSchedulerRunning() bool {
	schedulerMutex.Lock()
	defer schedulerMutex.Unlock()
	return schedulerRunning
}
