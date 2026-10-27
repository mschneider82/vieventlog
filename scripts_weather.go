package main

import (
	"fmt"
	"math"
	"time"
)

// Weather functions for scripts. They read the weather cache (see weather.go) and never call the weather API per run.

// weatherFields are the forecast values available in forecast(field, ...)
var weatherFields = map[string]func(weatherSlot) float64{
	"temp":      func(s weatherSlot) float64 { return s.Temp },
	"feelsLike": func(s weatherSlot) float64 { return s.FeelsLike },
	"humidity":  func(s weatherSlot) float64 { return s.Humidity },
	"clouds":    func(s weatherSlot) float64 { return s.Clouds },
	"pop":       func(s weatherSlot) float64 { return s.Pop },
	"rain":      func(s weatherSlot) float64 { return s.Rain },
	"snow":      func(s weatherSlot) float64 { return s.Snow },
	"wind":      func(s weatherSlot) float64 { return s.Wind },
}

func (rc *scriptRun) loadWeather() (*weatherData, error) {
	if rc.weather == nil {
		w, err := getWeather(rc.ctx)
		if err != nil {
			return nil, err
		}
		if age := time.Since(w.FetchedAt); age > 3*time.Hour {
			rc.logs = append(rc.logs, fmt.Sprintf("Hinweis: Wetterdaten sind %d Stunden alt (letzter Abruf fehlgeschlagen)", int(age.Hours())))
		}
		rc.weather = w
	}
	return rc.weather, nil
}

func argHours(args []any, i int) (float64, error) {
	h, err := argFloat(args, i, "hours")
	if err == nil && h <= 0 {
		err = fmt.Errorf("hours muss größer als 0 sein")
	}
	return h, err
}

// argClock parses a time of day "HH:MM"
func argClock(args []any, i int, name string) (time.Time, error) {
	s, err := argStr(args, i, name)
	if err != nil {
		return time.Time{}, err
	}
	t, err := time.Parse("15:04", s)
	if err != nil {
		return time.Time{}, fmt.Errorf("Uhrzeit %q muss HH:MM sein", s)
	}
	return t, nil
}

// nextWindow returns the next occurrence of the daily window from..to (may span midnight):
// the running window from now on, otherwise today's or, if that is over, tomorrow's
func nextWindow(now, from, to time.Time) (time.Time, time.Time) {
	for day := -1; ; day++ {
		start := time.Date(now.Year(), now.Month(), now.Day()+day, from.Hour(), from.Minute(), 0, 0, time.Local)
		end := time.Date(now.Year(), now.Month(), now.Day()+day, to.Hour(), to.Minute(), 0, 0, time.Local)
		if !end.After(start) {
			end = end.AddDate(0, 0, 1)
		}
		if end.After(now) {
			if start.Before(now) {
				start = now
			}
			return start, end
		}
	}
}

// argOptFloat returns an optional number parameter or def
func argOptFloat(args []any, i int, name string, def float64) (float64, error) {
	if i >= len(args) {
		return def, nil
	}
	return argFloat(args, i, name)
}

func scriptWeatherFunctions() []scriptFunc {
	return []scriptFunc{
		{Name: "weather", Category: "Wetter", Sig: "weather()",
			Desc: "Aktuelles Wetter als Map: temp, feelsLike (°C), humidity (%), clouds (Bewölkung %), wind (m/s), rain, snow (mm in der letzten Stunde), " +
				"condition (\"Clear\", \"Clouds\", \"Rain\", \"Drizzle\", \"Thunderstorm\", \"Snow\", \"Mist\" …), description (z.B. \"leichter Regen\"), daylight, sunny, city.",
			Example: "weather().temp < 0 or weather().condition == \"Snow\"",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				w, err := rc.loadWeather()
				if err != nil {
					return nil, err
				}
				return w.currentMap(), nil
			}},
		{Name: "forecast", Category: "Wetter", Sig: "forecast(field, hours, agg)",
			Desc: "Aggregat der Vorhersage für die nächsten Stunden. field: temp, feelsLike, humidity, clouds, pop (Regenwahrscheinlichkeit %), " +
				"rain, snow (mm je 3 h), wind. agg: \"avg\", \"min\", \"max\", \"sum\". nil, wenn keine Vorhersage vorliegt.",
			Example: "forecast(\"temp\", 24, \"avg\") > 16",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				field, err := argStr(args, 0, "field")
				if err != nil {
					return nil, err
				}
				value := weatherFields[field]
				if value == nil {
					return nil, fmt.Errorf("field muss temp, feelsLike, humidity, clouds, pop, rain, snow oder wind sein")
				}
				hours, err := argHours(args, 1)
				if err != nil {
					return nil, err
				}
				agg, err := argStr(args, 2, "agg")
				if err != nil {
					return nil, err
				}
				if agg != "avg" && agg != "min" && agg != "max" && agg != "sum" {
					return nil, fmt.Errorf("agg muss avg, min, max oder sum sein")
				}
				w, err := rc.loadWeather()
				if err != nil {
					return nil, err
				}
				slots := w.next(rc.now, hours)
				if len(slots) == 0 {
					return nil, nil
				}
				res := value(slots[0])
				sum := 0.0
				for _, s := range slots {
					v := value(s)
					sum += v
					switch agg {
					case "min":
						res = math.Min(res, v)
					case "max":
						res = math.Max(res, v)
					}
				}
				switch agg {
				case "avg":
					res = sum / float64(len(slots))
				case "sum":
					res = sum
				}
				return round1(res), nil
			}},
		{Name: "sunny", Category: "Wetter", Sig: "sunny(hours[, maxClouds])",
			Desc:    "true, wenn es in den nächsten Stunden überwiegend sonnig ist: mittlere Bewölkung bei Tageslicht ≤ maxClouds % (Standard 30). Ohne Tageslicht (nachts) false.",
			Example: "sunny(3) ? startDhwOneTimeCharge() : false",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				hours, err := argHours(args, 0)
				if err != nil {
					return nil, err
				}
				maxClouds, err := argOptFloat(args, 1, "maxClouds", weatherSunnyMaxClouds)
				if err != nil {
					return nil, err
				}
				w, err := rc.loadWeather()
				if err != nil {
					return nil, err
				}
				clouds, daylight, _ := w.sunshine(rc.now, rc.now.Add(time.Duration(hours*float64(time.Hour))))
				return daylight > 0 && clouds <= maxClouds, nil
			}},
		{Name: "sunnyBetween", Category: "Wetter", Sig: "sunnyBetween(from, to[, maxClouds])",
			Desc: "true, wenn es im Zeitfenster (\"HH:MM\", wie timeBetween) sonnig ist: mittlere Bewölkung bei Tageslicht ≤ maxClouds % (Standard 30). " +
				"Gemeint ist das nächste Vorkommen: heute, oder morgen, wenn das Fenster heute schon vorbei ist; ein laufendes Fenster ab jetzt. Ohne Tageslicht false.",
			Example: "setDhwTemperature(sunnyBetween(\"12:00\", \"16:00\") ? 45 : 50)",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				from, err := argClock(args, 0, "from")
				if err != nil {
					return nil, err
				}
				to, err := argClock(args, 1, "to")
				if err != nil {
					return nil, err
				}
				maxClouds, err := argOptFloat(args, 2, "maxClouds", weatherSunnyMaxClouds)
				if err != nil {
					return nil, err
				}
				w, err := rc.loadWeather()
				if err != nil {
					return nil, err
				}
				clouds, daylight, _ := w.sunshine(nextWindow(rc.now, from, to))
				return daylight > 0 && clouds <= maxClouds, nil
			}},
		{Name: "rainy", Category: "Wetter", Sig: "rainy(hours[, minPop])",
			Desc:    "true, wenn in den nächsten Stunden Niederschlag erwartet wird: Regenwahrscheinlichkeit mindestens minPop % (Standard 50).",
			Example: "rainy(6)",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				hours, err := argHours(args, 0)
				if err != nil {
					return nil, err
				}
				minPop, err := argOptFloat(args, 1, "minPop", weatherRainyMinPop)
				if err != nil {
					return nil, err
				}
				w, err := rc.loadWeather()
				if err != nil {
					return nil, err
				}
				for _, s := range w.next(rc.now, hours) {
					if s.Pop >= minPop {
						return true, nil
					}
				}
				return false, nil
			}},
		{Name: "dayForecast", Category: "Wetter", Sig: "dayForecast(day)",
			Desc: "Tageswerte als Map, day 0 = heute (restliche Stunden), 1 = morgen … 5: min, max, avg (°C), clouds (Bewölkung tagsüber %), " +
				"sunHours (geschätzte Sonnenstunden), sunny, rain, snow (mm), pop (max. Regenwahrscheinlichkeit %), wind (max. m/s), condition, description. " +
				"nil, wenn für den Tag keine Vorhersage vorliegt (heute ab ca. 22 Uhr).",
			Example: "(dayForecast(1)?.max ?? 0) > 25",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				day, err := argFloat(args, 0, "day")
				if err != nil {
					return nil, err
				}
				if day < 0 || day > 5 {
					return nil, fmt.Errorf("day muss zwischen 0 (heute) und 5 liegen")
				}
				w, err := rc.loadWeather()
				if err != nil {
					return nil, err
				}
				if m := w.day(rc.now, int(day)); m != nil {
					return m, nil
				}
				return nil, nil
			}},
		{Name: "forecastList", Category: "Wetter", Sig: "forecastList(hours)",
			Desc: "Vorhersage der nächsten Stunden als Liste von 3-Stunden-Schritten mit den Feldern von weather() plus time (\"HH:MM\"), date und pop. " +
				"Für eigene Auswertungen mit any(), all(), filter(), map().",
			Example: "any(forecastList(12), .temp < 0)",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				hours, err := argHours(args, 0)
				if err != nil {
					return nil, err
				}
				w, err := rc.loadWeather()
				if err != nil {
					return nil, err
				}
				out := []any{}
				for _, s := range w.next(rc.now, hours) {
					out = append(out, w.slotMap(s))
				}
				return out, nil
			}},
		{Name: "sunrise", Category: "Wetter", Sig: "sunrise()", Desc: "Sonnenaufgang heute als \"HH:MM\".",
			Example: "timeBetween(sunrise(), sunset())",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				w, err := rc.loadWeather()
				if err != nil || w.Sunrise.IsZero() {
					return nil, err
				}
				return atTimeOf(rc.now, w.Sunrise).Format("15:04"), nil
			}},
		{Name: "sunset", Category: "Wetter", Sig: "sunset()", Desc: "Sonnenuntergang heute als \"HH:MM\".",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				w, err := rc.loadWeather()
				if err != nil || w.Sunset.IsZero() {
					return nil, err
				}
				return atTimeOf(rc.now, w.Sunset).Format("15:04"), nil
			}},
	}
}
