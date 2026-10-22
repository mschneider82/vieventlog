package main

import (
	"context"
	"log"
	"os"
	"sync"
	"time"

	"github.com/robfig/cron/v3"
)

var (
	scriptCron   *cron.Cron
	scriptCronMu sync.Mutex
)

// StartScriptScheduler starts the scheduler if a database already exists (no new database is created for it)
func StartScriptScheduler() {
	path, err := aiDatabasePath()
	if err != nil {
		return
	}
	if _, err := os.Stat(path); err != nil {
		log.Printf("Script scheduler: no database at %s, not started", path)
		return
	}
	reloadScriptScheduler()
}

// StopScriptScheduler stops the scheduler and waits for running scripts
func StopScriptScheduler() {
	scriptCronMu.Lock()
	defer scriptCronMu.Unlock()
	if scriptCron != nil {
		<-scriptCron.Stop().Done()
		scriptCron = nil
	}
}

// reloadScriptScheduler (re)creates all cron entries for enabled scripts
func reloadScriptScheduler() {
	scripts, err := listScripts()
	if err != nil {
		log.Printf("Script scheduler: failed to load scripts: %v", err)
		return
	}

	scriptCronMu.Lock()
	defer scriptCronMu.Unlock()
	if scriptCron != nil {
		scriptCron.Stop() // Running jobs finish in the background
	}

	c := cron.New(cron.WithLocation(time.Local), cron.WithChain(cron.Recover(cron.DefaultLogger)))
	count := 0
	for _, s := range scripts {
		if !s.Enabled {
			continue
		}
		id := s.ID
		job := cron.NewChain(cron.SkipIfStillRunning(cron.DiscardLogger)).Then(cron.FuncJob(func() {
			executeScript(id, "schedule")
		}))
		if _, err := c.AddJob(s.Schedule, job); err != nil {
			log.Printf("Script scheduler: invalid schedule for %q: %v", s.Name, err)
			continue
		}
		count++
	}
	c.Start()
	scriptCron = c
	log.Printf("Script scheduler: %d active script(s)", count)
}

// executeScript loads the current version of a script, runs it and records the run
func executeScript(id, trigger string) *scriptRunResult {
	s, err := getScript(id)
	if err != nil {
		log.Printf("Script %s: %v", id, err)
		return &scriptRunResult{Status: "error", Error: err.Error(), Logs: []string{}, Actions: []scriptAction{}}
	}
	res := runScript(context.Background(), s.ID, s.scriptDevice, s.Code, false)
	scriptRecordRun(s, trigger, res)
	for _, a := range res.Actions {
		if a.Status == "executed" || a.Status == "error" {
			log.Printf("Script %q: %s%v -> %s %s", s.Name, a.Function, a.Args, a.Status, a.Detail)
		}
	}
	if res.Status != "ok" {
		log.Printf("Script %q failed: %s", s.Name, res.Error)
	}
	return res
}

// scriptNextRuns returns the next run times of a schedule
func scriptNextRuns(schedule string, n int) []string {
	sched, err := cron.ParseStandard(schedule)
	if err != nil {
		return nil
	}
	out := []string{}
	t := time.Now()
	for i := 0; i < n; i++ {
		t = sched.Next(t)
		out = append(out, t.Format(time.RFC3339))
	}
	return out
}
