package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// External values for scripts: HTTP sources (evcc, Home Assistant, Shelly, Tasmota, ...) and files written by other
// programs, plus helpers to extract single values from them. Sources that are not available yield nil (reason in the log),
// so scripts can fall back with ??.

const (
	scriptHTTPTimeout = 10 * time.Second
	scriptMaxBody     = 5 << 20 // Maximum size of a response or file
)

var scriptHTTPClient = &http.Client{Timeout: scriptHTTPTimeout}

// scriptFilesDir is the only directory readFile() reads from: SCRIPT_FILES_DIR or <config dir>/script-files
func scriptFilesDir() string {
	if dir := os.Getenv("SCRIPT_FILES_DIR"); dir != "" {
		return dir
	}
	return filepath.Join(getDefaultConfigDir(), "script-files")
}

// parseExternal turns a response or file content into a script value: JSON as map, list, number, bool or text,
// anything else as trimmed text. Empty content is nil.
func parseExternal(data []byte) any {
	data = bytes.TrimSpace(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")))
	if len(data) == 0 {
		return nil
	}
	var v any
	if json.Unmarshal(data, &v) == nil {
		return v
	}
	return string(data)
}

// --- Paths ---

// pathSegment is one step of a path: a map key or a list index. Keys written after a dot that are numbers
// work as list index too (emeters.0.power).
type pathSegment struct {
	key     string
	index   int
	isIndex bool
}

// parsePath parses a simplified JSONPath/jq path: grid.power, .grid.power, $.grid.power, loadpoints[0].chargePower,
// emeters.0.power, list[-1], ["key with.dots"]. An empty path, "." or "$" is the whole value.
func parsePath(path string) ([]pathSegment, error) {
	p := strings.TrimSpace(path)
	p = strings.TrimPrefix(p, "$")
	var segs []pathSegment
	invalid := func(msg string) error { return fmt.Errorf("ungültiger Pfad %q: %s", path, msg) }

	for i := 0; i < len(p); {
		switch p[i] {
		case '.':
			i++
			if i == len(p) {
				if len(segs) == 0 {
					return nil, nil // "." is the whole value
				}
				return nil, invalid("Punkt am Ende")
			}
			if p[i] == '.' {
				return nil, invalid("zwei Punkte hintereinander")
			}
			if p[i] == '[' {
				continue // jq style: .[0] or .["key"]
			}
		case '[':
			if rest := strings.TrimLeft(p[i+1:], " "); rest != "" && (rest[0] == '"' || rest[0] == '\'') {
				// Quoted key, may contain dots and brackets
				closing := strings.IndexByte(rest[1:], rest[0])
				if closing < 0 {
					return nil, invalid("Anführungszeichen nicht geschlossen")
				}
				after := strings.TrimLeft(rest[closing+2:], " ")
				if !strings.HasPrefix(after, "]") {
					return nil, invalid("] nach dem Schlüssel fehlt")
				}
				segs = append(segs, pathSegment{key: rest[1 : closing+1]})
				i = len(p) - len(after) + 1
				continue
			}
			end := strings.IndexByte(p[i:], ']')
			if end < 0 {
				return nil, invalid("] fehlt")
			}
			inner := strings.TrimSpace(p[i+1 : i+end])
			n, err := strconv.Atoi(inner)
			if inner == "*" {
				return nil, invalid("[*] wird nicht unterstützt, Listen mit map(), filter(), sum() auswerten")
			} else if err != nil {
				return nil, invalid(fmt.Sprintf("[%s] ist keine Zahl, Schlüssel in Anführungszeichen schreiben: [\"%s\"]", inner, inner))
			}
			segs = append(segs, pathSegment{key: inner, index: n, isIndex: true})
			i += end + 1
			continue
		default:
			if len(segs) > 0 {
				return nil, invalid(fmt.Sprintf("Punkt oder [ vor %q erwartet", p[i:]))
			}
		}
		// Plain key up to the next . or [
		end := strings.IndexAny(p[i:], ".[")
		if end < 0 {
			end = len(p) - i
		}
		key := strings.TrimSpace(p[i : i+end])
		if key == "" {
			return nil, invalid("leerer Schlüssel")
		}
		seg := pathSegment{key: key}
		if n, err := strconv.Atoi(key); err == nil {
			seg.index, seg.isIndex = n, true
		}
		segs = append(segs, seg)
		i += end
	}
	return segs, nil
}

// extractPath returns the value at path, nil if it does not exist. Text containing JSON is parsed first.
func extractPath(v any, path string) (any, error) {
	segs, err := parsePath(path)
	if err != nil {
		return nil, err
	}
	if s, ok := v.(string); ok && len(segs) > 0 {
		var parsed any
		if json.Unmarshal([]byte(s), &parsed) != nil {
			return nil, nil
		}
		v = parsed
	}
	for _, seg := range segs {
		switch cur := v.(type) {
		case map[string]any:
			v = cur[seg.key]
		case []any:
			v = listItem(len(cur), seg, func(i int) any { return cur[i] })
		default:
			// Other maps and lists, e.g. returned by expr functions
			rv := reflect.ValueOf(v)
			switch {
			case rv.Kind() == reflect.Map && rv.Type().Key().Kind() == reflect.String:
				item := rv.MapIndex(reflect.ValueOf(seg.key).Convert(rv.Type().Key()))
				v = nil
				if item.IsValid() {
					v = item.Interface()
				}
			case rv.Kind() == reflect.Slice || rv.Kind() == reflect.Array:
				v = listItem(rv.Len(), seg, func(i int) any { return rv.Index(i).Interface() })
			default:
				return nil, nil
			}
		}
		if v == nil {
			return nil, nil
		}
	}
	return v, nil
}

// listItem returns the element at the index of seg (negative counts from the end), nil if out of range
func listItem(n int, seg pathSegment, get func(int) any) any {
	if !seg.isIndex {
		return nil
	}
	i := seg.index
	if i < 0 {
		i += n
	}
	if i < 0 || i >= n {
		return nil
	}
	return get(i)
}

// --- Numbers ---

var (
	numberPrefix = regexp.MustCompile(`^[+-]?(\d+([.,]\d+)?|[.,]\d+)([eE][+-]?\d+)?`)
	numberUnit   = regexp.MustCompile(`^(\s|%|°|\pL|$)`)
)

// toNumberValue converts numbers, numeric text ("22.5", "22,5", "22.5 °C", "100%") and booleans (1/0) to float64.
// Anything else (e.g. "unavailable", "12:30", "1.234,5") is nil.
func toNumberValue(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case bool:
		if x {
			return 1.0
		}
		return 0.0
	case string:
		s := strings.TrimSpace(x)
		m := numberPrefix.FindString(s)
		if m == "" || !numberUnit.MatchString(s[len(m):]) {
			return nil
		}
		f, err := strconv.ParseFloat(strings.Replace(m, ",", ".", 1), 64)
		if err != nil {
			return nil
		}
		return f
	}
	if f, ok := toFloat(v); ok {
		return f
	}
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return float64(rv.Int())
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return float64(rv.Uint())
	}
	return nil
}

// --- Sources ---

// fetchURL returns the parsed response of a GET request. Every URL is fetched once per run, failures included,
// so a script does not wait for an unreachable source several times. Unreachable sources yield nil and a log line.
func (rc *scriptRun) fetchURL(rawURL string, headers map[string]string) (any, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("ungültige URL %q, erwartet http://… oder https://…", rawURL)
	}
	key := u.String() + "\n" + toJSON(headers)
	if v, ok := rc.httpCache[key]; ok {
		return v, nil
	}

	v, err := rc.doFetch(u, headers)
	if err != nil {
		if urlErr, ok := errors.AsType[*url.Error](err); ok {
			err = urlErr.Err // The URL is logged separately, without password
		}
		rc.logs = append(rc.logs, fmt.Sprintf("httpGet %s: %v", u.Redacted(), err))
		v = nil
	}
	if rc.httpCache == nil {
		rc.httpCache = map[string]any{}
	}
	rc.httpCache[key] = v
	return v, nil
}

func (rc *scriptRun) doFetch(u *url.URL, headers map[string]string) (any, error) {
	req, err := http.NewRequestWithContext(rc.ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "ViEventLog/"+version)
	req.Header.Set("Accept", "application/json, text/plain;q=0.9, */*;q=0.8")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := scriptHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, scriptMaxBody+1))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		msg := strings.TrimSpace(scriptHTMLError.ReplaceAllString(string(body), "[HTML-Seite]"))
		return nil, errors.New(strings.TrimSpace("HTTP " + resp.Status + " " + truncateString(msg, 200)))
	}
	if len(body) > scriptMaxBody {
		return nil, fmt.Errorf("Antwort größer als %d MB", scriptMaxBody>>20)
	}
	return parseExternal(body), nil
}

// readScriptFile reads a file below scriptFilesDir. os.Root prevents leaving the directory, also via symlinks.
func readScriptFile(name string) ([]byte, time.Time, error) {
	root, err := os.OpenRoot(scriptFilesDir())
	if err != nil {
		return nil, time.Time{}, err
	}
	defer root.Close()
	f, err := root.Open(name)
	if err != nil {
		return nil, time.Time{}, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, time.Time{}, err
	}
	if st.IsDir() {
		return nil, time.Time{}, fmt.Errorf("%s ist ein Verzeichnis", name)
	}
	if st.Size() > scriptMaxBody {
		return nil, time.Time{}, fmt.Errorf("Datei größer als %d MB", scriptMaxBody>>20)
	}
	data, err := io.ReadAll(io.LimitReader(f, scriptMaxBody))
	return data, st.ModTime(), err
}

// --- Argument helpers ---

func argOptStr(args []any, i int, name string) (string, error) {
	if i >= len(args) || args[i] == nil {
		return "", nil
	}
	return argStr(args, i, name)
}

func argHeaders(v any) (map[string]string, error) {
	m, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("Parameter headers muss eine Map sein, z.B. {\"Authorization\": \"Bearer …\"}, ist %T", v)
	}
	headers := make(map[string]string, len(m))
	for k, v := range m {
		headers[k] = fmt.Sprint(v)
	}
	return headers, nil
}

func scriptExternalFunctions() []scriptFunc {
	return []scriptFunc{
		{Name: "httpGet", Category: "Externe Daten", Sig: "httpGet(url[, path][, headers])",
			Desc: "Ruft eine URL im Heimnetz oder Internet ab (HTTP GET, max. 10 s), z.B. evcc, Home Assistant, Shelly, Tasmota, ioBroker. " +
				"JSON kommt als Map/Liste/Zahl zurück, anderes als Text. path zieht einen einzelnen Wert heraus (siehe Pfade unten), " +
				"headers ist eine Map, z.B. für Tokens. nil, wenn die Quelle nicht erreichbar ist oder der Pfad nicht existiert (Grund im Log). " +
				"Jede URL wird pro Lauf nur einmal abgerufen.",
			Example: "httpGet(\"http://192.168.1.10:7070/api/state\", \"grid.power\") ?? 0",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				u, err := argStr(args, 0, "url")
				if err != nil {
					return nil, err
				}
				path, headerArg := "", any(nil)
				if len(args) > 1 {
					if _, isMap := args[1].(map[string]any); isMap {
						headerArg = args[1] // httpGet(url, headers)
					} else if path, err = argOptStr(args, 1, "path"); err != nil {
						return nil, err
					}
				}
				if len(args) > 2 {
					headerArg = args[2]
				}
				var headers map[string]string
				if headerArg != nil {
					if headers, err = argHeaders(headerArg); err != nil {
						return nil, err
					}
				}
				if _, err := parsePath(path); err != nil {
					return nil, err // Report path errors even if the source is down
				}
				v, err := rc.fetchURL(u, headers)
				if err != nil || v == nil {
					return nil, err
				}
				return extractPath(v, path)
			}},
		{Name: "readFile", Category: "Externe Daten", Sig: "readFile(name[, path][, maxAge])",
			Desc: "Liest eine Datei, die ein anderes Programm schreibt (JSON oder Text), aus dem Verzeichnis für Skript-Dateien " +
				"(Umgebungsvariable SCRIPT_FILES_DIR, Standard: Unterordner script-files im Config-Verzeichnis, im Container /config/script-files). " +
				"path wie bei httpGet. maxAge in Minuten: nil, wenn die Datei länger nicht geändert wurde. nil, wenn die Datei fehlt (Grund im Log).",
			Example: "readFile(\"sensors.json\", \"sensor_1\", 15)",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				name, err := argStr(args, 0, "name")
				if err != nil {
					return nil, err
				}
				if !filepath.IsLocal(name) {
					return nil, fmt.Errorf("readFile: nur Dateinamen im Verzeichnis für Skript-Dateien erlaubt, kein absoluter Pfad und kein ..")
				}
				path, err := argOptStr(args, 1, "path")
				if err != nil {
					return nil, err
				}
				maxAge, err := argOptFloat(args, 2, "maxAge", 0)
				if err != nil {
					return nil, err
				}
				if _, err := parsePath(path); err != nil {
					return nil, err
				}
				data, modified, err := readScriptFile(name)
				if err != nil {
					if errors.Is(err, os.ErrNotExist) {
						err = fmt.Errorf("nicht gefunden in %s", scriptFilesDir())
					}
					rc.logs = append(rc.logs, fmt.Sprintf("readFile %s: %v", name, err))
					return nil, nil
				}
				if age := rc.now.Sub(modified); maxAge > 0 && age > time.Duration(maxAge*float64(time.Minute)) {
					rc.logs = append(rc.logs, fmt.Sprintf("readFile %s: zuletzt vor %d Minuten geändert, älter als maxAge %g", name, int(age.Minutes()), maxAge))
					return nil, nil
				}
				return extractPath(parseExternal(data), path)
			}},
		{Name: "jsonPath", Category: "Externe Daten", Sig: "jsonPath(value, path)",
			Desc:    "Zieht einen Wert aus einer Map/Liste (z.B. einem vorher mit httpGet geholten Ergebnis) oder aus JSON-Text heraus. nil, wenn der Pfad nicht existiert.",
			Example: "jsonPath(state, \"loadpoints[0].chargePower\")",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				if len(args) < 1 {
					return nil, fmt.Errorf("Parameter value fehlt")
				}
				path, err := argStr(args, 1, "path")
				if err != nil {
					return nil, err
				}
				return extractPath(args[0], path)
			}},
		{Name: "toNumber", Category: "Externe Daten", Sig: "toNumber(value)",
			Desc: "Wandelt Text in eine Zahl: \"22.5\", \"22,5\", \"22.5 °C\", \"100%\"; true/false werden 1/0. " +
				"nil, wenn es keine Zahl ist (z.B. \"unavailable\" bei Home Assistant), dann mit ?? einen Ersatzwert angeben.",
			Example: "toNumber(httpGet(url, \"state\", headers)) ?? 20",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				if len(args) < 1 {
					return nil, fmt.Errorf("Parameter value fehlt")
				}
				return toNumberValue(args[0]), nil
			}},
		{Name: "regexFind", Category: "Externe Daten", Sig: "regexFind(text, pattern)",
			Desc: "Sucht einen regulären Ausdruck (Go-Syntax) in einem Text, der kein JSON ist, z.B. HTML oder Prometheus-Metriken, und gibt die erste " +
				"Klammergruppe als Text zurück (ohne Klammern den ganzen Treffer), nil ohne Treffer. Enthält das Muster \\, es in Backticks statt " +
				"Anführungszeichen schreiben, sonst muss jedes \\ verdoppelt werden.",
			Example: "toNumber(regexFind(httpGet(url), \"power_watts ([0-9.]+)\"))",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				if len(args) < 1 {
					return nil, fmt.Errorf("Parameter text fehlt")
				}
				pattern, err := argStr(args, 1, "pattern")
				if err != nil {
					return nil, err
				}
				re, err := regexp.Compile(pattern)
				if err != nil {
					return nil, fmt.Errorf("ungültiger regulärer Ausdruck: %v", err)
				}
				if args[0] == nil {
					return nil, nil
				}
				text, ok := args[0].(string)
				if !ok {
					text = toJSON(args[0])
				}
				m := re.FindStringSubmatch(text)
				switch {
				case m == nil:
					return nil, nil
				case len(m) > 1:
					return m[1], nil
				default:
					return m[0], nil
				}
			}},
	}
}
