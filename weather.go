package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Weather for scripts and the assistant from the free OpenWeatherMap API (current weather + 5 day / 3 hour forecast).
// The data is fetched in the background every RefreshMinutes; scripts only read the cache,
// so the weather API is called independently of how often scripts run.

const (
	weatherDefaultRefresh = 60 // Minutes between two fetches
	weatherMinRefresh     = 15
	weatherRetryInterval  = 10 * time.Minute // Wait after a failed fetch
	weatherMaxAge         = 12 * time.Hour   // Older data is not used anymore
	weatherStep           = 3 * time.Hour    // Forecast resolution: a step stands for 1.5 hours before to 1.5 hours after its time
	weatherSunnyMaxClouds = 30.0             // Cloud cover in % up to which daylight counts as sunny
	weatherRainyMinPop    = 50.0             // Probability of precipitation in % from which rain is expected
)

var (
	weatherAPIBase          = "https://api.openweathermap.org/data/2.5" // Replaced in tests
	weatherHTTPClient       = &http.Client{Timeout: 20 * time.Second}
	weatherZip              = regexp.MustCompile(`\d`) // A location with digits is a postal code, otherwise a city name
	weatherCountry          = regexp.MustCompile(`^[A-Z]{2}$`)
	weatherSeverity         = map[string]int{"Clouds": 1, "Mist": 1, "Fog": 1, "Drizzle": 2, "Rain": 3, "Snow": 4, "Thunderstorm": 5}
	errWeatherNotConfigured = errors.New("Wetter nicht eingerichtet: API-Key und Ort auf der Skript-Seite unter „🌤️ Wetter“ hinterlegen")
)

// WeatherSettings configures the weather location (stored with the accounts)
type WeatherSettings struct {
	APIKey         string `json:"apiKey,omitempty"`
	Location       string `json:"location"`       // Postal code or city name
	Country        string `json:"country"`        // ISO 3166 country code, e.g. DE
	RefreshMinutes int    `json:"refreshMinutes"` // Fetch interval
}

func (s *WeatherSettings) configured() bool { return s.APIKey != "" && s.Location != "" }

func (s *WeatherSettings) refreshInterval() time.Duration {
	m := s.RefreshMinutes
	if m <= 0 {
		m = weatherDefaultRefresh
	}
	return time.Duration(max(m, weatherMinRefresh)) * time.Minute
}

// GetWeatherSettings returns the weather settings, or defaults if not configured
func GetWeatherSettings() (*WeatherSettings, error) {
	store, err := LoadAccounts()
	if err != nil {
		return nil, err
	}
	if store.WeatherSettings == nil {
		return &WeatherSettings{Country: "DE", RefreshMinutes: weatherDefaultRefresh}, nil
	}
	return store.WeatherSettings, nil
}

// SetWeatherSettings stores the weather settings (nil removes them)
func SetWeatherSettings(settings *WeatherSettings) error {
	store, err := LoadAccounts()
	if err != nil {
		return err
	}
	store.WeatherSettings = settings
	return SaveAccounts(store)
}

// --- Data ---

// weatherSlot is the weather at one time: current conditions or a forecast step
type weatherSlot struct {
	Time        time.Time
	Temp        float64 // °C
	FeelsLike   float64 // °C
	Humidity    float64 // %
	Clouds      float64 // Cloud cover in %
	Pop         float64 // Probability of precipitation in % (forecast only)
	Rain        float64 // mm (current: last hour, forecast: 3 hours)
	Snow        float64 // mm
	Wind        float64 // m/s
	Condition   string  // Main group: Clear, Clouds, Rain, Drizzle, Thunderstorm, Snow, Mist, ...
	Description string  // German description, e.g. "leichter Regen"
	DayIcon     bool    // OpenWeatherMap day icon (sun is up)
}

// weatherData is the fetched current weather and forecast
type weatherData struct {
	City      string
	Country   string
	Sunrise   time.Time // Of the fetch day, zero during polar day/night
	Sunset    time.Time
	Current   weatherSlot
	Forecast  []weatherSlot
	FetchedAt time.Time
}

// owmEntry is the current weather response or an entry of the forecast list
type owmEntry struct {
	Dt   int64  `json:"dt"`
	Name string `json:"name"`
	Main struct {
		Temp      float64 `json:"temp"`
		FeelsLike float64 `json:"feels_like"`
		Humidity  float64 `json:"humidity"`
	} `json:"main"`
	Weather []struct {
		Main        string `json:"main"`
		Description string `json:"description"`
		Icon        string `json:"icon"`
	} `json:"weather"`
	Clouds struct {
		All float64 `json:"all"`
	} `json:"clouds"`
	Wind struct {
		Speed float64 `json:"speed"`
	} `json:"wind"`
	Rain map[string]float64 `json:"rain"` // "1h" or "3h"
	Snow map[string]float64 `json:"snow"`
	Pop  float64            `json:"pop"` // 0..1
	Sys  struct {
		Country string `json:"country"`
		Sunrise int64  `json:"sunrise"`
		Sunset  int64  `json:"sunset"`
	} `json:"sys"`
}

func (e *owmEntry) slot() weatherSlot {
	s := weatherSlot{
		Time: time.Unix(e.Dt, 0), Temp: e.Main.Temp, FeelsLike: e.Main.FeelsLike, Humidity: e.Main.Humidity,
		Clouds: e.Clouds.All, Pop: e.Pop * 100, Wind: e.Wind.Speed,
	}
	for _, v := range e.Rain {
		s.Rain += v
	}
	for _, v := range e.Snow {
		s.Snow += v
	}
	if len(e.Weather) > 0 {
		s.Condition, s.Description = e.Weather[0].Main, e.Weather[0].Description
		s.DayIcon = strings.HasSuffix(e.Weather[0].Icon, "d")
	}
	return s
}

// weatherGetJSON calls the weather API. Errors never contain the URL, it includes the API key.
func weatherGetJSON(ctx context.Context, path string, params url.Values, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, weatherAPIBase+path+"?"+params.Encode(), nil)
	if err != nil {
		return err
	}
	resp, err := weatherHTTPClient.Do(req)
	if err != nil {
		var uerr *url.Error
		if errors.As(err, &uerr) {
			err = uerr.Err
		}
		return fmt.Errorf("Wetter-API nicht erreichbar: %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return fmt.Errorf("Wetter-API: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		switch resp.StatusCode {
		case http.StatusUnauthorized:
			return errors.New("Wetter-API: API-Key ungültig oder noch nicht aktiv (neue Keys sind erst nach bis zu 2 Stunden gültig)")
		case http.StatusNotFound:
			return errors.New("Wetter-API: Ort nicht gefunden, PLZ/Ort und Land prüfen")
		case http.StatusTooManyRequests:
			return errors.New("Wetter-API: Abruflimit des API-Keys überschritten")
		}
		var e struct {
			Message string `json:"message"`
		}
		json.Unmarshal(body, &e)
		return fmt.Errorf("Wetter-API: Status %d %s", resp.StatusCode, truncateString(e.Message, 200))
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("Wetter-API: unerwartete Antwort: %v", err)
	}
	return nil
}

// fetchWeather fetches current weather and forecast (2 API calls)
func fetchWeather(ctx context.Context, s *WeatherSettings) (*weatherData, error) {
	params := url.Values{"appid": {s.APIKey}, "units": {"metric"}, "lang": {"de"}}
	loc := s.Location
	if s.Country != "" {
		loc += "," + s.Country
	}
	if weatherZip.MatchString(s.Location) {
		params.Set("zip", loc)
	} else {
		params.Set("q", loc)
	}

	var cur owmEntry
	if err := weatherGetJSON(ctx, "/weather", params, &cur); err != nil {
		return nil, err
	}
	var fc struct {
		List []owmEntry `json:"list"`
	}
	if err := weatherGetJSON(ctx, "/forecast", params, &fc); err != nil {
		return nil, err
	}
	if len(fc.List) == 0 {
		return nil, errors.New("Wetter-API: leere Vorhersage")
	}

	d := &weatherData{City: cur.Name, Country: cur.Sys.Country, Current: cur.slot(), FetchedAt: time.Now()}
	if cur.Sys.Sunrise != 0 && cur.Sys.Sunset != 0 {
		d.Sunrise, d.Sunset = time.Unix(cur.Sys.Sunrise, 0), time.Unix(cur.Sys.Sunset, 0)
	}
	for i := range fc.List {
		d.Forecast = append(d.Forecast, fc.List[i].slot())
	}
	return d, nil
}

// --- Cache ---

var weatherCache struct {
	sync.Mutex
	key         string // Settings the data was fetched with
	data        *weatherData
	lastAttempt time.Time
	lastErr     error
}

// getWeather returns the cached weather for the configured location
func getWeather(ctx context.Context) (*weatherData, error) {
	s, err := GetWeatherSettings()
	if err != nil {
		return nil, err
	}
	return cachedWeather(ctx, s)
}

// cachedWeather returns the cache and refreshes it when it is older than the refresh interval
// (normally done by the background refresh). After a failure it retries at most every weatherRetryInterval
// and keeps using the old data up to weatherMaxAge.
func cachedWeather(ctx context.Context, s *WeatherSettings) (*weatherData, error) {
	if !s.configured() {
		return nil, errWeatherNotConfigured
	}
	weatherCache.Lock()
	defer weatherCache.Unlock()
	if key := s.APIKey + "|" + s.Location + "|" + s.Country; weatherCache.key != key {
		weatherCache.key, weatherCache.data, weatherCache.lastAttempt, weatherCache.lastErr = key, nil, time.Time{}, nil
	}

	d := weatherCache.data
	if d != nil && time.Since(d.FetchedAt) < s.refreshInterval() {
		return d, nil
	}
	if time.Since(weatherCache.lastAttempt) >= weatherRetryInterval {
		weatherCache.lastAttempt = time.Now()
		fresh, err := fetchWeather(ctx, s)
		weatherCache.lastErr = err
		if err == nil {
			weatherCache.data = fresh
			return fresh, nil
		}
		log.Printf("Weather: %v", err)
	}
	if d != nil && time.Since(d.FetchedAt) < weatherMaxAge {
		return d, nil
	}
	if weatherCache.lastErr != nil {
		return nil, weatherCache.lastErr
	}
	return nil, errors.New("keine aktuellen Wetterdaten")
}

// resetWeatherCache makes the next access fetch again, e.g. after saving the settings
func resetWeatherCache() {
	weatherCache.Lock()
	weatherCache.key = ""
	weatherCache.Unlock()
}

// StartWeatherRefresh keeps the weather cache up to date while the weather is configured
func StartWeatherRefresh(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			if s, err := GetWeatherSettings(); err == nil && s.configured() {
				cachedWeather(ctx, s) // Fetches only when the cache is older than the refresh interval
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// --- Evaluation ---

func round1(v float64) float64 { return math.Round(v*10) / 10 }

// atTimeOf returns the clock time of ref on the day of t (local time)
func atTimeOf(t, ref time.Time) time.Time {
	t, ref = t.In(time.Local), ref.In(time.Local)
	return time.Date(t.Year(), t.Month(), t.Day(), ref.Hour(), ref.Minute(), ref.Second(), 0, time.Local)
}

// daylightHours returns the hours between sunrise and sunset within from..to (at most a day, part of the forecast step s).
// Sunrise and sunset of the fetch day are used for all days, they shift only a few minutes per day.
func (d *weatherData) daylightHours(s weatherSlot, from, to time.Time) float64 {
	if d.Sunrise.IsZero() { // Polar day or night
		if s.DayIcon {
			return to.Sub(from).Hours()
		}
		return 0
	}
	overlap := func(day time.Time) float64 {
		start, end := atTimeOf(day, d.Sunrise), atTimeOf(day, d.Sunset)
		if from.After(start) {
			start = from
		}
		if to.Before(end) {
			end = to
		}
		return math.Max(0, end.Sub(start).Hours())
	}
	h := overlap(from)
	if from.In(time.Local).Day() != to.In(time.Local).Day() {
		h += overlap(to)
	}
	return h
}

// period returns the time a forecast step stands for
func (s weatherSlot) period() (time.Time, time.Time) {
	return s.Time.Add(-weatherStep / 2), s.Time.Add(weatherStep / 2)
}

// covers returns the time forecast step i covers. The first step also covers the time before it,
// the forecast starts with the next step after the fetch.
func (d *weatherData) covers(i int) (time.Time, time.Time) {
	start, end := d.Forecast[i].period()
	if i == 0 {
		start = time.Time{}
	}
	return start, end
}

// isDaytime reports whether the sun is up for most of the step's period
func (d *weatherData) isDaytime(s weatherSlot) bool {
	start, end := s.period()
	return d.daylightHours(s, start, end) >= weatherStep.Hours()/2
}

// next returns the forecast steps that overlap the next hours
func (d *weatherData) next(now time.Time, hours float64) []weatherSlot {
	end := now.Add(time.Duration(hours * float64(time.Hour)))
	out := []weatherSlot{}
	for i, s := range d.Forecast {
		if start, stop := d.covers(i); stop.After(now) && start.Before(end) {
			out = append(out, s)
		}
	}
	return out
}

// sunshine returns the mean cloud cover during daylight between from and to (weighted by daylight hours),
// the daylight hours and the estimated hours of sunshine
func (d *weatherData) sunshine(from, to time.Time) (clouds, daylight, sun float64) {
	for i, s := range d.Forecast {
		start, end := d.covers(i)
		if start.Before(from) {
			start = from
		}
		if end.After(to) {
			end = to
		}
		if !end.After(start) {
			continue
		}
		h := d.daylightHours(s, start, end)
		daylight += h
		clouds += h * s.Clouds
		sun += h * (1 - s.Clouds/100)
	}
	if daylight > 0 {
		clouds /= daylight
	}
	return clouds, daylight, sun
}

func (d *weatherData) slotMap(s weatherSlot) map[string]any {
	t := s.Time.In(time.Local)
	daylight := d.isDaytime(s)
	return map[string]any{
		"time": t.Format("15:04"), "date": t.Format("2006-01-02"),
		"temp": round1(s.Temp), "feelsLike": round1(s.FeelsLike), "humidity": s.Humidity, "clouds": s.Clouds,
		"pop": math.Round(s.Pop), "rain": round1(s.Rain), "snow": round1(s.Snow), "wind": round1(s.Wind),
		"condition": s.Condition, "description": s.Description,
		"daylight": daylight, "sunny": daylight && s.Clouds <= weatherSunnyMaxClouds,
	}
}

func (d *weatherData) currentMap() map[string]any {
	m := d.slotMap(d.Current)
	delete(m, "pop")
	m["daylight"] = d.Current.DayIcon
	m["sunny"] = d.Current.DayIcon && d.Current.Clouds <= weatherSunnyMaxClouds
	m["city"] = d.City
	return m
}

// day returns the daily values for day 0 = today (remaining hours), 1 = tomorrow, ... or nil without forecast
func (d *weatherData) day(now time.Time, day int) map[string]any {
	now = now.In(time.Local)
	start := time.Date(now.Year(), now.Month(), now.Day()+day, 0, 0, 0, 0, time.Local)
	end := start.AddDate(0, 0, 1)

	var slots []weatherSlot
	for _, s := range d.Forecast {
		if !s.Time.Before(start) && s.Time.Before(end) {
			slots = append(slots, s)
		}
	}
	if len(slots) == 0 {
		return nil
	}

	minT, maxT, sumT := math.Inf(1), math.Inf(-1), 0.0
	var rain, snow, pop, wind float64
	for _, s := range slots {
		minT, maxT, sumT = math.Min(minT, s.Temp), math.Max(maxT, s.Temp), sumT+s.Temp
		rain, snow = rain+s.Rain, snow+s.Snow
		pop, wind = math.Max(pop, s.Pop), math.Max(wind, s.Wind)
	}

	// Most frequent weather during the day (at night if there is no daylight left), on a tie the more significant one
	counts := map[string]int{}
	var best weatherSlot
	for _, daytime := range []bool{true, false} {
		for _, s := range slots {
			if daytime && !d.isDaytime(s) {
				continue
			}
			counts[s.Description]++
			c, b := counts[s.Description], counts[best.Description]
			if c > b || c == b && weatherSeverity[s.Condition] > weatherSeverity[best.Condition] {
				best = s
			}
		}
		if len(counts) > 0 {
			break
		}
	}

	from := start
	if now.After(from) {
		from = now
	}
	clouds, daylight, sun := d.sunshine(from, end)
	m := map[string]any{
		"date": start.Format("2006-01-02"),
		"min":  round1(minT), "max": round1(maxT), "avg": round1(sumT / float64(len(slots))),
		"rain": round1(rain), "snow": round1(snow), "pop": math.Round(pop), "wind": round1(wind),
		"condition": best.Condition, "description": best.Description,
		"clouds": nil, "sunHours": round1(sun), "sunny": false,
	}
	if daylight > 0 {
		m["clouds"] = math.Round(clouds)
		m["sunny"] = clouds <= weatherSunnyMaxClouds
	}
	return m
}

// weatherOverview summarizes the weather for the UI and the assistant
func weatherOverview(d *weatherData, now time.Time) map[string]any {
	days := []any{}
	for i := 0; i <= 5; i++ {
		if day := d.day(now, i); day != nil {
			days = append(days, day)
		}
	}
	next := []any{}
	for _, s := range d.next(now, 24) {
		next = append(next, d.slotMap(s))
	}
	m := map[string]any{
		"location":  strings.Trim(d.City+", "+d.Country, ", "),
		"fetchedAt": d.FetchedAt.Format(time.RFC3339),
		"current":   d.currentMap(),
		"next24h":   next,
		"days":      days,
	}
	if !d.Sunrise.IsZero() {
		m["sunrise"], m["sunset"] = atTimeOf(now, d.Sunrise).Format("15:04"), atTimeOf(now, d.Sunset).Format("15:04")
	}
	return m
}

// --- HTTP ---

// weatherHandler handles GET /api/weather: settings (without API key) and the cached weather
func weatherHandler(w http.ResponseWriter, r *http.Request) {
	s, err := GetWeatherSettings()
	if err != nil {
		writeJSON(w, map[string]any{"success": false, "error": err.Error()})
		return
	}
	resp := map[string]any{"success": true, "settings": map[string]any{
		"hasApiKey": s.APIKey != "", "location": s.Location, "country": s.Country,
		"refreshMinutes": int(s.refreshInterval().Minutes()),
	}}
	if s.configured() {
		if d, err := cachedWeather(r.Context(), s); err != nil {
			resp["weatherError"] = err.Error()
		} else {
			resp["weather"] = weatherOverview(d, time.Now())
		}
	}
	writeJSON(w, resp)
}

// weatherSettingsSetHandler handles POST /api/weather/settings/set and fetches the weather right away
// to check the settings. An empty apiKey keeps the stored key, "remove": true deletes the settings.
func weatherSettingsSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		WeatherSettings
		Remove bool `json:"remove"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, map[string]any{"success": false, "error": "Invalid request: " + err.Error()})
		return
	}

	var settings *WeatherSettings
	if !req.Remove {
		current, err := GetWeatherSettings()
		if err != nil {
			writeJSON(w, map[string]any{"success": false, "error": err.Error()})
			return
		}
		settings = &req.WeatherSettings
		settings.APIKey = strings.TrimSpace(settings.APIKey)
		if settings.APIKey == "" {
			settings.APIKey = current.APIKey
		}
		settings.Location = strings.TrimSpace(settings.Location)
		settings.Country = strings.ToUpper(strings.TrimSpace(settings.Country))
		settings.RefreshMinutes = int(settings.refreshInterval().Minutes())
		var msg string
		switch {
		case settings.APIKey == "":
			msg = "API-Key fehlt"
		case settings.Location == "":
			msg = "PLZ oder Ort fehlt"
		case settings.Country != "" && !weatherCountry.MatchString(settings.Country):
			msg = "Land als zweistelligen Code angeben, z.B. DE, AT, CH"
		}
		if msg != "" {
			writeJSON(w, map[string]any{"success": false, "error": msg})
			return
		}
	}
	if err := SetWeatherSettings(settings); err != nil {
		writeJSON(w, map[string]any{"success": false, "error": err.Error()})
		return
	}
	resetWeatherCache()
	weatherHandler(w, r)
}
