package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// testWeather: Tuesday 10:00, sun from 07:30 to 16:30, forecast steps every 3 hours from 12:00.
// A step stands for ±1.5 hours around its time, the first step also for the time before it.
func testWeather() (*weatherData, time.Time) {
	now := time.Date(2026, 10, 27, 10, 0, 0, 0, time.Local)
	at := func(day, hour, min int) time.Time { return time.Date(2026, 10, 27+day, hour, min, 0, 0, time.Local) }
	step := func(day, hour int, temp, clouds, pop, rain float64, cond, desc string) weatherSlot {
		return weatherSlot{Time: at(day, hour, 0), Temp: temp, FeelsLike: temp - 2, Clouds: clouds, Pop: pop, Rain: rain, Condition: cond, Description: desc}
	}
	d := &weatherData{
		City: "München", Country: "DE", Sunrise: at(0, 7, 30), Sunset: at(0, 16, 30), FetchedAt: now,
		Current: weatherSlot{Time: now, Temp: 9, Clouds: 10, Condition: "Clear", Description: "klarer Himmel", DayIcon: true},
		Forecast: []weatherSlot{
			step(0, 12, 12, 10, 0, 0, "Clear", "klarer Himmel"),
			step(0, 15, 14, 20, 0, 0, "Clouds", "ein paar Wolken"),
			step(0, 18, 10, 90, 80, 1.2, "Rain", "leichter Regen"),
			step(0, 21, 8, 100, 60, 0.5, "Rain", "leichter Regen"),
			step(1, 0, 6, 100, 20, 0, "Clouds", "bedeckt"),
			step(1, 3, 4, 80, 0, 0, "Clouds", "bedeckt"),
			step(1, 6, 3, 50, 0, 0, "Clouds", "Mäßig bewölkt"),
			step(1, 9, 7, 50, 0, 0, "Clouds", "Mäßig bewölkt"),
			step(1, 12, 11, 40, 0, 0, "Clouds", "Mäßig bewölkt"),
			step(1, 15, 12, 30, 0, 0, "Clouds", "Mäßig bewölkt"),
			step(1, 18, 9, 20, 0, 0, "Clouds", "ein paar Wolken"),
			step(1, 21, 7, 0, 0, 0, "Clear", "klarer Himmel"),
		},
	}
	return d, now
}

func TestScriptWeatherFunctions(t *testing.T) {
	d, now := testWeather()
	tests := []struct {
		code string
		want string
	}{
		{`weather().temp`, `9`},
		{`weather().sunny`, `true`},
		{`sunny(3)`, `true`},                   // 10–13: step 12:00 with 10 %
		{`sunny(9)`, `true`},                   // 3.5 h × 10 % (12:00) and 3 h × 20 % (15:00), 18:00 is after sunset: 14.6 %
		{`sunny(9, 12)`, `false`},              //
		{`sunny(3, 5)`, `false`},               //
		{`rainy(6)`, `false`},                  // 10–16: steps 12:00 and 15:00
		{`rainy(7)`, `true`},                   // 10–17 reaches step 18:00 (from 16:30) with 80 %
		{`forecast("temp", 24, "min")`, `3`},   // up to tomorrow 10:00 (step 09:00)
		{`forecast("temp", 6, "max")`, `14`},   // 12:00, 15:00
		{`forecast("rain", 12, "sum")`, `1.7`}, // 18:00 and 21:00
		{`forecast("clouds", 3, "avg")`, `10`}, // 12:00
		{`forecast("temp", 200, "avg") != nil`, `true`},
		{`len(forecastList(6))`, `2`},
		{`forecastList(3)[0].time`, `"12:00"`},
		{`any(forecastList(12), .temp < 9)`, `true`},
		{`all(forecastList(6), .daylight)`, `true`},
		{`all(forecastList(9), .daylight)`, `false`}, // 18:00 stands for 16:30–19:30, after sunset
		{`[dayForecast(0).min, dayForecast(0).max, dayForecast(0).rain, dayForecast(0).pop]`, `[8,14,1.7,80]`},
		{`dayForecast(0).description`, `"ein paar Wolken"`}, // Daytime tie with "klarer Himmel": clouds are more significant
		// Daylight 07:30–16:30: 3 h × 50 %, 3 h × 40 %, 3 h × 30 %
		{`[dayForecast(1).min, dayForecast(1).max, dayForecast(1).clouds, dayForecast(1).sunHours, dayForecast(1).sunny]`, `[3,12,40,5.4,false]`},
		{`dayForecast(1).description`, `"Mäßig bewölkt"`},
		{`dayForecast(3) == nil`, `true`},
		{`(dayForecast(3)?.max ?? 0) > 25`, `false`},
		{`[sunrise(), sunset(), timeBetween(sunrise(), sunset())]`, `["07:30","16:30",true]`},
		{`sunnyBetween("11:00", "13:00")`, `true`},       // step 12:00 with 10 %
		{`sunnyBetween("15:00", "17:00")`, `true`},       // 15:00–16:30 step 15:00 with 20 %, then night
		{`sunnyBetween("15:00", "17:00", 15)`, `false`},  //
		{`sunnyBetween("08:00", "09:00")`, `false`},      // over today: tomorrow, step 09:00 with 50 %
		{`sunnyBetween("08:00", "09:00", 60)`, `true`},   //
		{`sunnyBetween("09:00", "11:00")`, `true`},       // running: 10–11 (tomorrow would be 50 %)
		{`sunnyBetween("20:00", "22:00", 100)`, `false`}, // no daylight
		{`sunnyBetween("22:00", "02:00", 100)`, `false`}, // over midnight
	}
	for _, tt := range tests {
		t.Run(tt.code, func(t *testing.T) {
			rc := testScriptRun(nil, now)
			rc.weather = d
			res := rc.run(tt.code)
			if res.Status != "ok" {
				t.Fatalf("status %s: %s", res.Status, res.Error)
			}
			if got := toJSON(res.Result); got != tt.want {
				t.Errorf("got %s, want %s", got, tt.want)
			}
		})
	}

	for _, code := range []string{`forecast("pressure", 3, "avg")`, `forecast("temp", 3, "median")`, `sunny(0)`, `dayForecast(6)`,
		`sunnyBetween("25:00", "13:00")`, `sunnyBetween("11:00")`} {
		rc := testScriptRun(nil, now)
		rc.weather = d
		if res := rc.run(code); res.Status != "error" {
			t.Errorf("%s: expected error, got %v", code, res.Result)
		}
	}
}

func TestNextWindow(t *testing.T) {
	at := func(day, hour, min int) time.Time { return time.Date(2026, 10, 27+day, hour, min, 0, 0, time.Local) }
	clock := func(s string) time.Time { c, _ := time.Parse("15:04", s); return c }
	tests := []struct {
		now              time.Time
		from, to         string
		wantFrom, wantTo time.Time
	}{
		{at(0, 10, 0), "11:00", "13:00", at(0, 11, 0), at(0, 13, 0)}, // later today
		{at(0, 10, 0), "08:00", "09:00", at(1, 8, 0), at(1, 9, 0)},   // over today: tomorrow
		{at(0, 10, 0), "09:00", "11:00", at(0, 10, 0), at(0, 11, 0)}, // running: from now
		{at(0, 4, 0), "16:00", "16:00", at(0, 4, 0), at(0, 16, 0)},   // 24 hours, always running
		{at(0, 1, 0), "22:00", "02:00", at(0, 1, 0), at(0, 2, 0)},    // running since yesterday
		{at(0, 3, 0), "22:00", "02:00", at(0, 22, 0), at(1, 2, 0)},   // tonight
		{at(0, 23, 0), "22:00", "02:00", at(0, 23, 0), at(1, 2, 0)},  // running since today
	}
	for _, tt := range tests {
		from, to := nextWindow(tt.now, clock(tt.from), clock(tt.to))
		if !from.Equal(tt.wantFrom) || !to.Equal(tt.wantTo) {
			t.Errorf("%s %s–%s: got %s–%s, want %s–%s", tt.now.Format("15:04"), tt.from, tt.to,
				from.Format("02. 15:04"), to.Format("02. 15:04"), tt.wantFrom.Format("02. 15:04"), tt.wantTo.Format("02. 15:04"))
		}
	}
}

// fakeOWM serves current weather and forecast like api.openweathermap.org/data/2.5
func fakeOWM(calls *atomic.Int32) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		q := r.URL.Query()
		if q.Get("appid") != "secret-key" {
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, `{"cod":401,"message":"Invalid API key. Please see https://openweathermap.org/faq#error401 for more info."}`)
			return
		}
		if q.Get("zip") != "80331,DE" || q.Get("units") != "metric" || q.Get("lang") != "de" {
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprint(w, `{"cod":"404","message":"city not found"}`)
			return
		}
		now := time.Now().Unix()
		switch r.URL.Path {
		case "/weather":
			fmt.Fprintf(w, `{"weather":[{"id":500,"main":"Rain","description":"leichter Regen","icon":"10d"}],
				"main":{"temp":7.53,"feels_like":5.1,"humidity":87},"wind":{"speed":3.6},"clouds":{"all":75},"rain":{"1h":0.31},
				"dt":%d,"sys":{"country":"DE","sunrise":%d,"sunset":%d},"name":"München","cod":200}`, now, now-3600, now+3600)
		case "/forecast":
			var list []string
			for i := 1; i <= 40; i++ {
				list = append(list, fmt.Sprintf(`{"dt":%d,"main":{"temp":%d,"feels_like":1,"humidity":70},
					"weather":[{"main":"Clouds","description":"bedeckt","icon":"04n"}],"clouds":{"all":90},"wind":{"speed":2},
					"pop":0.42,"snow":{"3h":0.8},"sys":{"pod":"n"}}`, now+int64(i)*10800, i))
			}
			fmt.Fprintf(w, `{"cod":"200","cnt":40,"list":[%s],"city":{"name":"München","country":"DE"}}`, strings.Join(list, ","))
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestWeatherFetchAndCache(t *testing.T) {
	var calls atomic.Int32
	srv := fakeOWM(&calls)
	defer srv.Close()
	oldBase := weatherAPIBase
	weatherAPIBase = srv.URL
	defer func() { weatherAPIBase = oldBase; resetWeatherCache() }()
	resetWeatherCache()

	s := &WeatherSettings{APIKey: "secret-key", Location: "80331", Country: "DE"}
	d, err := cachedWeather(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	if d.City != "München" || d.Current.Temp != 7.53 || d.Current.Rain != 0.31 || !d.Current.DayIcon || len(d.Forecast) != 40 {
		t.Errorf("unexpected current weather: %+v", d)
	}
	if f := d.Forecast[0]; f.Pop != 42 || f.Snow != 0.8 || f.Condition != "Clouds" || f.DayIcon {
		t.Errorf("unexpected forecast step: %+v", f)
	}
	if got := calls.Load(); got != 2 {
		t.Errorf("got %d API calls, want 2", got)
	}

	// Further accesses within the refresh interval use the cache
	for range 5 {
		if _, err := cachedWeather(context.Background(), s); err != nil {
			t.Fatal(err)
		}
	}
	if got := calls.Load(); got != 2 {
		t.Errorf("cache not used: %d API calls", got)
	}
	m := weatherOverview(d, d.Current.Time) // Steps are exactly 3, 6, … hours after the observation
	if m["location"] != "München, DE" || len(m["next24h"].([]any)) != 8 {
		t.Errorf("unexpected overview: %v", toJSON(m))
	}

	// Errors never contain the API key, a failed fetch is not retried immediately
	bad := &WeatherSettings{APIKey: "wrong-key", Location: "München", Country: "DE"}
	if _, err := cachedWeather(context.Background(), bad); err == nil || !strings.Contains(err.Error(), "API-Key ungültig") {
		t.Errorf("expected invalid key error, got %v", err)
	}
	calls.Store(0)
	if _, err := cachedWeather(context.Background(), bad); err == nil || calls.Load() != 0 {
		t.Errorf("failed fetch retried immediately (%d calls, %v)", calls.Load(), err)
	}

	srv.Close()
	resetWeatherCache()
	if _, err := cachedWeather(context.Background(), s); err == nil || strings.Contains(err.Error(), "secret-key") {
		t.Errorf("unreachable API: error missing or contains the key: %v", err)
	}

	if _, err := cachedWeather(context.Background(), &WeatherSettings{Location: "80331"}); err != errWeatherNotConfigured {
		t.Errorf("expected not configured error, got %v", err)
	}
}
