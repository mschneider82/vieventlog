// Dashboard Temperature Chart
// ECharts-based temperature and sensor data visualization

let temperatureChart = null;
let temperatureChartRefreshInterval = null;
let currentTimeRange = '24h';
let customTemperatureDate = null;
let availableDataFields = new Set();
let selectedFields = new Set();
let cachedTemperatureData = null;  // Store current data for re-rendering

// User preferences for chart display (previously auto-determined based on time range)
let nullconnect = false;  // Connect points across null values
let symbolshow = false;   // Show data points as symbols
let smoothdata = true;    // Apply smoothing to line charts

// zoom parms
var x1 = 50;  // zoom precentages
var x2 = 100;
var step_a = 10; // step size when panning
var step_b = 20;

// Initialize temperature chart section
async function initTemperatureChart() {
    // First check if temperature logging is enabled
    try {
        const response = await fetch('/api/temperature-log/settings');
        if (!response.ok) {
            console.log('Temperature logging settings not available');
            return;
        }

        const settings = await response.json();
        if (!settings.enabled) {
            console.log('Temperature logging is disabled');
            // Remove chart section if it exists
            const existingSection = document.getElementById('temperature-chart-section');
            if (existingSection) {
                existingSection.remove();
            }
            return;
        }
    } catch (error) {
        console.error('Error checking temperature log settings:', error);
        return;
    }

    // Temperature logging is enabled, proceed with initialization
    const dashboardContent = document.getElementById('dashboardContent');
    if (!dashboardContent) return;

    // Check if chart container already exists
    let chartSection = document.getElementById('temperature-chart-section');
    if (!chartSection) {
        // Insert temperature chart section before other content
        chartSection = document.createElement('div');
        chartSection.id = 'temperature-chart-section';
        chartSection.className = 'temperature-chart-container';
        chartSection.innerHTML = `
            <div class="chart-header">
                <h2>📊 Temperatur- und Sensor-Verlauf</h2>
                <div class="chart-controls">
                    <div class="time-range-selector">
                        <button class="time-btn" data-range="1h">1h</button>
                        <button class="time-btn" data-range="6h">6h</button>
                        <button class="time-btn" data-range="12h">12h</button>
                        <button class="time-btn active" data-range="24h">24h</button>
                        <button class="time-btn" data-range="48h">48h</button>
                        <button class="time-btn" data-range="72h">72h</button>
                        <button class="time-btn" data-range="7d">7d</button>
                        <button class="time-btn" data-range="30d">30d</button>
                        <button class="time-btn" data-range="90d">90d</button>
                        <div style="display: inline-flex; align-items: center; gap: 8px; margin-left: 10px;">
                            <label for="temperatureCustomDatePicker" style="color: #a0a0b0; font-size: 13px; white-space: nowrap;">📅 Bestimmter Tag:</label>
                            <input type="date" id="temperatureCustomDatePicker" class="custom-date-input" style="padding: 6px 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #fff; font-size: 13px; cursor: pointer;">
                        </div>
                    </div>
                </div>
            </div>
            <div class="chart-filters" id="temperature-chart-filters">
                <div class="filters-loading">Lade verfügbare Sensoren...</div>
            </div>
            <div id="temperature-chart" style="width: 100%; height: 600px; margin-top: 20px;"></div>
        `;

        // Add chart display options (zoom/move, show symbols, connect nulls, smoothing)
        const displayOptionsHtml = `
            <div class="chart-display-options" style="margin-top: 15px; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;">
                <label class="display-option">
                    <input type="checkbox" id="symbolToggle" ${symbolshow ? 'checked' : ''}>
                    <span>Punkte anzeigen</span>
                </label>
                <label class="display-option">
                    <input type="checkbox" id="connectToggle" ${nullconnect ? 'checked' : ''}>
                    <span>Lücken verbinden</span>
                </label>
                <label class="display-option">
                    <input type="checkbox" id="smoothToggle" ${smoothdata ? 'checked' : ''}>
                    <span>Glättung aktivieren</span>
                </label>

				<label class="display-option">
                    <button type="button" title="Pan links" id="jumpleft">
                    <span> << </span></button>
                </label>

   				<label class="display-option">
                    <button type="button" title="Pan links"id="panleft">
                    <span> < </span> </button>
                </label>

				<label class="display-option">
                    <button type="button" title="Mitte" id="center" >
                    <span> >< </span></button>
                </label>

				<label class="display-option">
                    <button type="button" title="Pan rechts"id="panright">
                    <span> > </span></button>
                </label>

				<label class="display-option">
                    <button type="button" title="Pan rechts" id="jumpright" >
                    <span> >> </span></button>
                </label>

				<label class="display-option">
                    <button type="button" title="alles" id="full">
                    <span> < * > </span></button>
                </label>
            </div>
        `;
        chartSection.innerHTML += displayOptionsHtml;

        // Insert at the end of dashboard content (after temperature tiles)
        dashboardContent.appendChild(chartSection);

        // Add event listeners for time range buttons
        const timeButtons = chartSection.querySelectorAll('.time-btn');
        timeButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                timeButtons.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                currentTimeRange = e.target.dataset.range;
                customTemperatureDate = null; // Clear custom date when using time range buttons
                loadTemperatureData();
            });
        });

        // Add event listeners for display option toggles
        const symbolToggle = chartSection.querySelector('#symbolToggle');
        symbolToggle.addEventListener('change', (e) => {
            symbolshow = e.target.checked;
            // Re-render chart with current data if available
            if (cachedTemperatureData && cachedTemperatureData.length > 0) {
                renderTemperatureChart(cachedTemperatureData);
            }
        });

        const connectToggle = chartSection.querySelector('#connectToggle');
        connectToggle.addEventListener('change', (e) => {
            nullconnect = e.target.checked;
            // Re-render chart with current data if available
            if (cachedTemperatureData && cachedTemperatureData.length > 0) {
                renderTemperatureChart(cachedTemperatureData);
            }
        });

        const smoothToggle = chartSection.querySelector('#smoothToggle');
        smoothToggle.addEventListener('change', (e) => {
            smoothdata = e.target.checked;
            // Re-render chart with current data if available
            if (cachedTemperatureData && cachedTemperatureData.length > 0) {
                renderTemperatureChart(cachedTemperatureData);
            }
        });

		// zoom or move within time range
        const jright = chartSection.querySelector('#jumpright'); // jump right
        jright.addEventListener('click', (e) => {
			x2 +=step_b; if (x2 > 100) {x2 = 100; x1 = 100-step_b;} else { x1 += step_b;}
			temperatureChart.dispatchAction({type: 'dataZoom', dataZoomIndex: 0, start: x1, end: x2});
        });

        const pright = chartSection.querySelector('#panright'); // pan right
		pright.addEventListener('click', (e) => {
			x2 +=step_a; if (x2 > 100) {x2 = 100; x1 = 100-step_b;} else { x1 += step_a;}
			temperatureChart.dispatchAction({type: 'dataZoom', dataZoomIndex: 0, start: x1, end: x2});
        });

		const pfull = chartSection.querySelector('#full');  // full view
        pfull.addEventListener('click', (e) => {
			x1=0; x2=100;
			temperatureChart.dispatchAction({type: 'dataZoom', dataZoomIndex: 0, start: x1, end: x2});
        });

		const pcenter = chartSection.querySelector('#center');  // center view
        pcenter.addEventListener('click', (e) => {
			x1=40; x2=60; step_a=10;
			temperatureChart.dispatchAction({type: 'dataZoom', dataZoomIndex: 0, start: x1, end: x2});
        });

        const pleft = chartSection.querySelector('#panleft');  // pan left
        pleft.addEventListener('click', (e) => {
			x1 -=step_a; if (x1 < 0) {x1 = 0; x2 = step_b;} else { x2 -= step_a;}
			temperatureChart.dispatchAction({type: 'dataZoom', dataZoomIndex: 0, start: x1, end: x2});
        });

        const jleft = chartSection.querySelector('#jumpleft');  // jump left
        jleft.addEventListener('click', (e) => {
			x1 -=step_b; if (x1 < 0) {x1 = 0; x2 = step_b;} else { x2 -= step_b;}
			temperatureChart.dispatchAction({type: 'dataZoom', dataZoomIndex: 0, start: x1, end: x2});
        });
		
		
        // Add event listener for date picker
        const datePicker = chartSection.querySelector('#temperatureCustomDatePicker');
        if (datePicker) {
            // Set max date to today
            const today = new Date().toISOString().split('T')[0];
            datePicker.max = today;

            datePicker.addEventListener('change', (e) => {
                if (e.target.value) {
                    // Deactivate all time range buttons
                    timeButtons.forEach(b => b.classList.remove('active'));

                    // Set custom date and load data for that specific day (24h)
                    customTemperatureDate = e.target.value;
                    currentTimeRange = '24h';
                    loadTemperatureData();
                }
            });
        }
    }

    // Initialize or reinitialize ECharts
    const chartContainer = document.getElementById('temperature-chart');
    if (chartContainer) {
        if (temperatureChart) {
            temperatureChart.dispose();
        }
        temperatureChart = echarts.init(chartContainer);

        // Load initial data
        loadTemperatureData();

		if(temperatureChart !== null ) {chart_datazoom_event();}

        // Start auto-refresh (every 10 minutes)
        if (temperatureChartRefreshInterval) {
            clearInterval(temperatureChartRefreshInterval);
        }
        temperatureChartRefreshInterval = setInterval(() => {
            loadTemperatureData(true);
        }, 600000);
    }
}

// capture datazoom event to act on user activity
async function chart_datazoom_event(){
    temperatureChart.on('dataZoom', function (evt) {
		// button event
		if (typeof evt.start !== 'undefined'){
     		x1 = evt.start;
			x2 = evt.end;
			step_a=(x2-x1)/2;
		}
		// slider/drag event
		else if (typeof evt.batch !== 'undefined'){
			x1 = evt.batch[0].start;
			x2 = evt.batch[0].end;
			step_a=(x2-x1)/2;
		}
    })
}

// Load temperature data from API
async function loadTemperatureData(silent = false) {
    if (!currentInstallationId) return;

    try {
        // Build API URL
        let apiUrl = `/api/temperature-log/data?installationId=${currentInstallationId}&gatewayId=${currentGatewaySerial}&deviceId=${currentDeviceId}&limit=50000`;


        if (customTemperatureDate) {
            // Use specific date range (from midnight to midnight next day)
            const startDate = new Date(customTemperatureDate + 'T00:00:00');
            const endDate = new Date(customTemperatureDate + 'T23:59:59');
            apiUrl += `&startTime=${startDate.toISOString()}&endTime=${endDate.toISOString()}`;
			// set to no zoom 
			x1 = 0; x2 = 100;
        } else {
            // Use hours-based time range
            let hours = parseTimeRange(currentTimeRange);
			// set zoom range
			x1 = 50; x2=100;
			if (hours > 24){step_b = 30; step_a = 15;}
			else{step_b = 34; step_a = 17;}
			hours = hours*2;  // request twice the data in time 
            apiUrl += `&hours=${hours}`;
        }

        // Fetch data from API with gateway and device filter
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (!result.data || result.data.length === 0) {
            if (!silent) {
                showChartMessage('Keine Temperaturdaten verfügbar. Temperatur-Logging muss aktiviert sein.');
            }
            return;
        }

        // Cache data for re-rendering when display options change
        cachedTemperatureData = result.data;

        // Update available fields and filters
        updateAvailableFields(result.data);
        renderFilters();

        // Render chart
        renderTemperatureChart(result.data);

    } catch (error) {
        console.error('Error loading temperature data:', error);
        if (!silent) {
            showChartMessage('Fehler beim Laden der Temperaturdaten: ' + error.message);
        }
    }
}

// Parse time range string to hours
function parseTimeRange(range) {
    const match = range.match(/^(\d+)([hd])$/);
    if (!match) return 24;

    const value = parseInt(match[1]);
    const unit = match[2];

    return unit === 'h' ? value : value * 24;
}

// Update available data fields from response
function updateAvailableFields(data) {
    availableDataFields.clear();

    // Check which fields have non-null values
    data.forEach(snapshot => {
        Object.keys(snapshot).forEach(key => {
            if (key !== 'timestamp' && key !== 'installation_id' && key !== 'gateway_id' &&
                key !== 'device_id' && key !== 'account_id' && key !== 'account_name') {
                if (snapshot[key] !== null && snapshot[key] !== undefined) {
                    availableDataFields.add(key);
                }
            }
        });
    });

    // Auto-select important fields if nothing selected yet
    if (selectedFields.size === 0) {
        let hasHotWaterBuffer = false; // default: show heating circuit (IDU)
        // Get device settings
        const deviceInfo = window.currentDeviceInfo;
        const deviceKey = deviceInfo ? (deviceInfo.installationId + '_' + deviceInfo.deviceId) : null;
        const deviceSetting = deviceKey && window.deviceSettingsCache ? window.deviceSettingsCache[deviceKey] : null;
        if (deviceSetting && deviceSetting.hasHotWaterBuffer !== null && deviceSetting.hasHotWaterBuffer !== undefined) {
            hasHotWaterBuffer = deviceSetting.hasHotWaterBuffer;
        }

        // Default: Prefer new explicit fields over legacy fields
        let defaultFields, fallbackFields;
        if (hasHotWaterBuffer) {
            // With buffer: Show WP secondary circuit (common for heat pumps with buffer)
            defaultFields = [
                'outside_temp',
                'hp_secondary_circuit_supply_temp',  // WP secondary circuit supply
                'heating_circuit_0_delta_t',
                'return_temp',                       // Common return (after circuits)
                'dhw_temp',
                'buffer_temp'
            ];
            fallbackFields = ['secondary_supply_temp'];  // Legacy fallback for WP secondary
        } else {
            // Without buffer: Show heating circuit 0 (common supply temperature)
            defaultFields = [
                'outside_temp',
                'heating_circuit_0_supply_temp',     // Heating circuit 0 supply
                'heating_circuit_0_delta_t',
                'return_temp',                       // Common return (after circuits)
                'dhw_temp',
                'buffer_temp'
            ];
            fallbackFields = ['primary_supply_temp'];  // Legacy fallback for heating circuit
        }

        defaultFields.forEach(field => {
            if (availableDataFields.has(field)) {
                selectedFields.add(field);
            }
        });

        // Only add legacy fallbacks if corresponding new fields weren't added
        if (!selectedFields.has('hp_secondary_circuit_supply_temp') && !selectedFields.has('heating_circuit_0_supply_temp')) {
            fallbackFields.forEach(field => {
                if (availableDataFields.has(field)) {
                    selectedFields.add(field);
                }
            });
        }
    }
}

// Render filter checkboxes
function renderFilters() {
    const filtersContainer = document.getElementById('temperature-chart-filters');
    if (!filtersContainer) return;

    const fieldLabels = {
        // Basic temperatures
        'outside_temp': '🌡️ Außentemperatur',
        'calculated_outside_temp': '🌡️ Außentemp. (berechnet)',

        // Heat pump circuits (ODU) - only supply temps exist
        'hp_primary_circuit_supply_temp': '🔄 WP Primärkreis-Vorlauf (Lufteintritt)',
        'hp_secondary_circuit_supply_temp': '🔄 WP Sekundärkreis-Vorlauf',

        // Heating circuits (IDU) - only supply temps exist
        'heating_circuit_0_supply_temp': '🏠 Heizkreis 0 Vorlauf',
        'heating_circuit_1_supply_temp': '🏠 Heizkreis 1 Vorlauf',
        'heating_circuit_2_supply_temp': '🏠 Heizkreis 2 Vorlauf',
        'heating_circuit_3_supply_temp': '🏠 Heizkreis 3 Vorlauf',

        // Temperature spreads (deltaT) per circuit
        'heating_circuit_0_delta_t': '📊 Spreizung (ΔT)',
        'heating_circuit_1_delta_t': '📊 Heizkreis 1 Spreizung (ΔT)',
        'heating_circuit_2_delta_t': '📊 Heizkreis 2 Spreizung (ΔT)',
        'heating_circuit_3_delta_t': '📊 Heizkreis 3 Spreizung (ΔT)',

        // Common return temperature (system-wide, shared by all circuits)
        'return_temp': '↩️ Gemeinsamer Rücklauf',

        // DHW and storage
        'dhw_temp': '🚿 Warmwasser',
        'dhw_cylinder_middle_temp': '🚿 WW Mitte',
        'boiler_temp': '🔥 Kessel',
        'buffer_temp': '📦 Puffer',
        'buffer_temp_top': '📦 Puffer (oben)',

        // DEPRECATED: Legacy fields (kept for backward compatibility)
        'supply_temp': '↗️ Vorlauftemperatur (Legacy)',
        'primary_supply_temp': '↗️ Vorlauf IDU (Legacy)',
        'secondary_supply_temp': '↗️ Sekundär-Vorlauf ODU (Legacy)',
        'primary_return_temp': '↩️ Primär-Rücklauf (Legacy)',
        'secondary_return_temp': '↩️ Sekundär-Rücklauf (Legacy)',

        // Compressor
        'compressor_active': '⚙️ Kompressor aktiv',
        'compressor_speed': '🔧 Kompressor Drehzahl',
        'compressor_current': '⚡ Kompressor Strom',
        'compressor_pressure': '💨 Kompressor Druck',
        'compressor_oil_temp': '🛢️ Öl-Temp.',
        'compressor_motor_temp': '🔧 Motor-Temp.',
        'compressor_inlet_temp': '❄️ Eintritt-Temp.',
        'compressor_outlet_temp': '♨️ Austritt-Temp.',
        'compressor_hours': '⏱️ Betriebsstunden',
        'compressor_starts': '️🔧 Anzahl Starts',
        'compressor_power': '⚡ Leistungsaufnahme',

        // Pumps
        'circulation_pump_active': '🔄 Umwälzpumpe',
        'dhw_pump_active': '🚿 WW-Pumpe',
        'internal_pump_active': '🔄 Interne Pumpe',

        // Flow/Energy
        'volumetric_flow': '💧 Volumenstrom',
        'thermal_power': '🔥 Thermische Leistung',
        'cop': '📊 moment. Arbeitszahl (AZ)',

        // Operating state
        'four_way_valve': '🔀 4-Wege-Ventil',
        'burner_modulation': '🔥 Brenner Modulation',
        'secondary_heat_generator_status': '🔥 Zusatzheizung'
    };

    const categories = {
        'Temperaturen': ['outside_temp', 'calculated_outside_temp', 'dhw_temp', 'dhw_cylinder_middle_temp', 'boiler_temp',
                        'buffer_temp', 'buffer_temp_top'],
        'Kreise': ['supply_temp', 'return_temp',
                   'hp_primary_circuit_supply_temp', 'hp_secondary_circuit_supply_temp',
                   'heating_circuit_0_supply_temp', 'heating_circuit_1_supply_temp',
                   'heating_circuit_2_supply_temp', 'heating_circuit_3_supply_temp',
                   'heating_circuit_0_delta_t', 'heating_circuit_1_delta_t',
                   'heating_circuit_2_delta_t', 'heating_circuit_3_delta_t',
                   'primary_supply_temp', 'secondary_supply_temp', 'primary_return_temp', 'secondary_return_temp'],
        'Kompressor': ['compressor_active', 'compressor_speed', 'compressor_current', 'compressor_pressure',
                      'compressor_oil_temp', 'compressor_motor_temp', 'compressor_inlet_temp', 'compressor_outlet_temp',
                      'compressor_hours', 'compressor_starts', 'compressor_power'],
        'Pumpen': ['circulation_pump_active', 'dhw_pump_active', 'internal_pump_active'],
        'Energie': ['volumetric_flow', 'thermal_power', 'cop'],
        'Betrieb': ['burner_modulation', 'secondary_heat_generator_status']
    };

    let html = '<div class="filter-categories">';

    Object.entries(categories).forEach(([category, fields]) => {
        const availableInCategory = fields.filter(f => availableDataFields.has(f));
        if (availableInCategory.length === 0) return;

        html += `<div class="filter-category">`;
        html += `<h4>${category}</h4>`;
        html += `<div class="filter-checkboxes">`;

        availableInCategory.forEach(field => {
            const checked = selectedFields.has(field) ? 'checked' : '';
            const label = fieldLabels[field] || field;
            html += `
                <label class="filter-checkbox">
                    <input type="checkbox" value="${field}" ${checked} onchange="toggleField('${field}')">
                    <span>${label}</span>
                </label>
            `;
        });

        html += `</div></div>`;
    });

    html += '</div>';
    filtersContainer.innerHTML = html;
}

// Toggle field selection
function toggleField(field) {
    if (selectedFields.has(field)) {
        selectedFields.delete(field);
    } else {
        selectedFields.add(field);
    }
    loadTemperatureData(true);
}

// Render ECharts temperature chart
function renderTemperatureChart(data) {
    if (!temperatureChart || data.length === 0) return;

    // Prepare series data - timestamps are ISO-8601 strings
    const timestamps = data.map(d => {
        // Parse ISO-8601 string (e.g., "2025-11-21T08:33:04Z")
        const date = new Date(d.timestamp);

        // Validate the date
        if (isNaN(date.getTime())) {
            console.error('Invalid timestamp:', d.timestamp);
            return Date.now();
        }

        return date.getTime(); // Convert to milliseconds for ECharts
    });
    const series = [];
    const legend = [];

    // Field configurations
    const fieldConfig = {
        // Temperatures (main axis)
        'outside_temp': { type: 'line', yAxisIndex: 0, color: '#4285f4', smooth: true },
        'calculated_outside_temp': { type: 'line', yAxisIndex: 0, color: '#6fa8dc', smooth: true },
        'primary_supply_temp': { type: 'line', yAxisIndex: 0, color: '#ea4335', smooth: true, opacity: 0.5 },
        'secondary_supply_temp': { type: 'line', yAxisIndex: 0, color: '#ff6f00', smooth: true, opacity: 0.5 },
        'return_temp': { type: 'line', yAxisIndex: 0, color: '#34a853', smooth: true },
        'primary_return_temp': { type: 'line', yAxisIndex: 0, color: '#57bb8a', smooth: true, opacity: 0.5 },
        'secondary_return_temp': { type: 'line', yAxisIndex: 0, color: '#7cb342', smooth: true, opacity: 0.5 },
        'supply_temp': { type: 'line', yAxisIndex: 0, color: '#999999', smooth: true, opacity: 0.5 },
        'dhw_temp': { type: 'line', yAxisIndex: 0, color: '#fbbc04', smooth: true },
        'dhw_cylinder_middle_temp': { type: 'line', yAxisIndex: 0, color: '#fdd663', smooth: true },
        'boiler_temp': { type: 'line', yAxisIndex: 0, color: '#ff5722', smooth: true },
        'buffer_temp': { type: 'line', yAxisIndex: 0, color: '#9c27b0', smooth: true },
        'buffer_temp_top': { type: 'line', yAxisIndex: 0, color: '#ba68c8', smooth: true },
        'compressor_oil_temp': { type: 'line', yAxisIndex: 0, color: '#795548', smooth: true },
        'compressor_motor_temp': { type: 'line', yAxisIndex: 0, color: '#8d6e63', smooth: true },
        'compressor_inlet_temp': { type: 'line', yAxisIndex: 0, color: '#0288d1', smooth: true },
        'compressor_outlet_temp': { type: 'line', yAxisIndex: 0, color: '#d32f2f', smooth: true },
        // Heat pump circuits
        'hp_primary_circuit_supply_temp': { type: 'line', yAxisIndex: 0, color: '#e74c3c', smooth: true },
        'hp_secondary_circuit_supply_temp': { type: 'line', yAxisIndex: 0, color: '#9b59b6', smooth: true },
        // Heating circuits
        'heating_circuit_0_supply_temp': { type: 'line', yAxisIndex: 0, color: '#e67e22', smooth: true },
        'heating_circuit_1_supply_temp': { type: 'line', yAxisIndex: 0, color: '#16a085', smooth: true },
        'heating_circuit_2_supply_temp': { type: 'line', yAxisIndex: 0, color: '#2980b9', smooth: true },
        'heating_circuit_3_supply_temp': { type: 'line', yAxisIndex: 0, color: '#8e44ad', smooth: true },
        // Temperature spreads (deltaT)
        'heating_circuit_0_delta_t': { type: 'line', yAxisIndex: 0, color: '#f39c12', smooth: true, lineStyle: { type: 'dashed' } },
        'heating_circuit_1_delta_t': { type: 'line', yAxisIndex: 0, color: '#1abc9c', smooth: true, lineStyle: { type: 'dashed' } },
        'heating_circuit_2_delta_t': { type: 'line', yAxisIndex: 0, color: '#3498db', smooth: true, lineStyle: { type: 'dashed' } },
        'heating_circuit_3_delta_t': { type: 'line', yAxisIndex: 0, color: '#9b59b6', smooth: true, lineStyle: { type: 'dashed' } },

        // Boolean states (secondary axis)
        'compressor_active': { type: 'line', yAxisIndex: 1, color: '#f4b400', step: 'end' },
        'circulation_pump_active': { type: 'line', yAxisIndex: 1, color: '#0f9d58', step: 'end' },
        'dhw_pump_active': { type: 'line', yAxisIndex: 1, color: '#4285f4', step: 'end' },
        'internal_pump_active': { type: 'line', yAxisIndex: 1, color: '#9c27b0', step: 'end' },

        // Power/COP/Flow (tertiary axis)
        'compressor_speed': { type: 'line', yAxisIndex: 2, color: '#ff9800', smooth: true },
        'compressor_current': { type: 'line', yAxisIndex: 2, color: '#3f51b5', smooth: true },
        'compressor_pressure': { type: 'line', yAxisIndex: 2, color: '#00bcd4', smooth: true },
        'compressor_hours': { type: 'line', yAxisIndex: 2, color: '#607d8b', smooth: true },
        'compressor_starts': { type: 'line', yAxisIndex: 2, color: '#7cb342', smooth: true },
        'compressor_power': { type: 'line', yAxisIndex: 2, color: '#e91e63', smooth: true },
        'volumetric_flow': { type: 'line', yAxisIndex: 2, color: '#2196f3', smooth: true },
        'thermal_power': { type: 'line', yAxisIndex: 2, color: '#ff5722', smooth: true },
        'cop': { type: 'line', yAxisIndex: 2, color: '#4caf50', smooth: true },
        'burner_modulation': { type: 'line', yAxisIndex: 2, color: '#ff6f00', smooth: true }
    };

    const fieldNames = {
        // Basic temperatures
        'outside_temp': 'Außentemp.',
        'calculated_outside_temp': 'Außentemp. (ged.)',

        // Heat pump circuits
        'hp_primary_circuit_supply_temp': 'WP Primär VL',
        'hp_secondary_circuit_supply_temp': 'WP Sekundär VL',

        // Heating circuits
        'heating_circuit_0_supply_temp': 'HK0 VL',
        'heating_circuit_1_supply_temp': 'HK1 VL',
        'heating_circuit_2_supply_temp': 'HK2 VL',
        'heating_circuit_3_supply_temp': 'HK3 VL',

        // Temperature spreads (deltaT)
        'heating_circuit_0_delta_t': 'ΔT',
        'heating_circuit_1_delta_t': 'HK1 ΔT',
        'heating_circuit_2_delta_t': 'HK2 ΔT',
        'heating_circuit_3_delta_t': 'HK3 ΔT',

        // Common return
        'return_temp': 'Gemeins. RL',

        // DHW and storage
        'dhw_temp': 'Warmwasser',
        'dhw_cylinder_middle_temp': 'WW Mitte',
        'boiler_temp': 'Kessel',
        'buffer_temp': 'Puffer',
        'buffer_temp_top': 'Puffer (oben)',

        // DEPRECATED: Legacy fields
        'supply_temp': 'Vorlauf (L)',
        'primary_supply_temp': 'Vorlauf IDU (L)',
        'secondary_supply_temp': 'Sek.-Vorlauf ODU (L)',
        'primary_return_temp': 'Primär-RL (L)',
        'secondary_return_temp': 'Sek.-RL (L)',
        'compressor_active': 'Kompressor',
        'compressor_speed': 'Drehzahl',
        'compressor_current': 'Strom',
        'compressor_pressure': 'Druck',
        'compressor_oil_temp': 'Öl-Temp.',
        'compressor_motor_temp': 'Motor-Temp.',
        'compressor_inlet_temp': 'Eintritt-Temp.',
        'compressor_outlet_temp': 'Austritt-Temp.',
        'compressor_hours': 'Betriebsstunden',
        'compressor_starts': 'Starts',
        'compressor_power': 'Leistung',
        'circulation_pump_active': 'Umwälzpumpe',
        'dhw_pump_active': 'WW-Pumpe',
        'internal_pump_active': 'Int. Pumpe',
        'volumetric_flow': 'Volumenstrom',
        'thermal_power': 'Therm. Leistung',
        'cop': 'AZ',
        'burner_modulation': 'Brenner Mod.'
    };

    // Create series for selected fields
    selectedFields.forEach(field => {
        const config = fieldConfig[field];
        if (!config) return;

        const seriesData = data.map((d, index) => {
            const value = d[field];
            // Convert boolean to number for chart
            let numValue;
            if (typeof value === 'boolean') {
                numValue = value ? 1 : 0;
            } else {
                numValue = value;
            }
            // Return [timestamp, value] pair for ECharts time axis
            return [timestamps[index], numValue];
        });

        series.push({
            name: fieldNames[field] || field,
            type: config.type,
            data: seriesData,
            smooth: smoothdata,
            step: config.step || false,
            yAxisIndex: config.yAxisIndex,
            itemStyle: { color: config.color },
            lineStyle: { color: config.color, width: 2 },
            showSymbol: symbolshow,
            connectNulls: nullconnect
        });

        legend.push(fieldNames[field] || field);
    });

    // Determine axis formatter based on time range
    const hours = parseTimeRange(currentTimeRange);
    const xAxisFormatter = hours <= 24 ? '{HH}:{mm}' : '{MM}-{dd} {HH}:{mm}';

    // Chart options
    const option = {
        title: {
            text: '',
            left: 'center'
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'cross',
                animation: false
            },
            formatter: function(params) {
                let result = params[0].axisValueLabel + '<br/>';
                params.forEach(param => {
                    // param.value is [timestamp, value] array for time-series data
                    const value = Array.isArray(param.value) ? param.value[1] : param.value;

                    if (value !== null && value !== undefined) {
                        // Format boolean values
                        const displayValue = param.seriesName.includes('aktiv') || param.seriesName.includes('Pumpe')
                            ? (value === 1 ? 'AN' : 'AUS')
                            : (typeof value === 'number' ? value.toFixed(2) : value);
                        result += `${param.marker} ${param.seriesName}: <strong>${displayValue}</strong><br/>`;
                    }
                });
                return result;
            }
        },
        legend: {
            data: legend,
            top: 30,
            type: 'scroll',
            pageButtonPosition: 'start',
			textStyle: {color: "#ffffff"}            
        },
        grid: {
            left: '3%',
            right: '4%',
            bottom: '80px',
            top: '100px',
            containLabel: true
        },
        xAxis: {
            type: 'time',
            boundaryGap: false,
   			nameTextStyle: {color: "#ffffff"},
            axisLabel: {
   				color: "#ffffff",
                formatter: xAxisFormatter
            }
        },
        yAxis: [
            {
                type: 'value',
                name: 'Temperatur (°C)',
       			nameTextStyle: {color: "#ffffff"},
                position: 'left',
                // Minimum and maximum variations according to the value of incoming
                // Add 20% padding below and 10% above for better readability
                min: function(value){
                    return Math.floor(value.min - 0.2 * Math.abs(value.min));
                },
                max: function(value){
                    return Math.ceil(1.1 * value.max);
                },
                axisLabel: {
   				    color: "#ffffff",
                    formatter: '{value} °C'
                }
            },
            {
                type: 'value',
                name: 'Status',
   				nameTextStyle: {color: "#0f9d58"},
                position: 'right',
                min: 0,
                max: 1,
                interval: 1,
                axisLabel: {
       				color: "#0f9d58",
                    formatter: function(value) {
                        return value === 1 ? 'AN' : 'AUS';
                    }
                }
            },
            {
                type: 'value',
                name: 'Leistung;\nFlow',
				nameTextStyle: {color: "#ffffff"},
				axisLabel: {color: "#ffffff"},
                position: 'right',
                // Dynamic Y-axis scaling based on value range
                // For small values (<100, e.g. temperatures, compressor pressure, ...): 10% padding below, 10% above
                // For large values (>=100, e.g. compressor power, flow): 0.5% padding to reduce empty space
                // For very large values (>=1000, e.g. compressor hours, starts): no padding
				min: function(value) {
                    if (value.min < 100.0) return Math.floor(value.min - 0.1 * Math.abs(value.min));
					if (value.min > 1000.0) return value.min;
                    return Math.floor(value.min - 0.005 * Math.abs(value.min));
                },
                max: function(value){
					if (value.max < 100.0) return Math.ceil(1.1 * value.max);
					if (value.max > 1000.0) return value.max;
					return Math.ceil(1.005 * value.max);
				},
                offset: 60
            }
        ],
        dataZoom: [
            {
                type: 'slider',
                show: true,
                xAxisIndex: [0],
                start: x1,
                end: x2,
                bottom: 10
            },
            {
                type: 'inside',
                xAxisIndex: [0],
                start: 0,
                end: 100
            }
        ],
        series: series
    };

    temperatureChart.setOption(option, true);
}

// Show message in chart
function showChartMessage(message) {
    const chartContainer = document.getElementById('temperature-chart');
    if (chartContainer) {
        chartContainer.innerHTML = `<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;">${message}</div>`;
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (temperatureChartRefreshInterval) {
        clearInterval(temperatureChartRefreshInterval);
    }
    if (temperatureChart) {
        temperatureChart.dispose();
    }
});

// Add CSS styles for chart
const chartStyles = document.createElement('style');
chartStyles.textContent = `
.temperature-chart-container {
    background: linear-gradient(135deg, #1e1e2e 0%, #262637 100%);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 25px;
    margin-bottom: 20px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    width: 100%;
    grid-column: 1 / -1; /* Span all columns in the grid */
}

@media (max-width: 768px) {
    .temperature-chart-container {
        padding: 15px;
    }
}

.chart-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
    flex-wrap: wrap;
}

.chart-header h2 {
    margin: 0;
    font-size: 1.5rem;
    color: #fff;
}

.time-range-selector {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
}

.time-btn {
    padding: 6px 12px;
    border: 1px solid rgba(255,255,255,0.2);
    background: rgba(255,255,255,0.05);
    color: #e0e0e0;
    cursor: pointer;
    border-radius: 4px;
    font-size: 0.9rem;
    transition: all 0.2s;
}

.time-btn:hover {
    background: rgba(255,255,255,0.1);
    border-color: rgba(255,255,255,0.3);
}

.time-btn.active {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-color: rgba(102, 126, 234, 0.5);
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
}

.chart-filters {
    margin-top: 15px;
    padding: 15px;
    background: rgba(0,0,0,0.2);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
}

.filter-categories {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 15px;
}

.filter-category h4 {
    margin: 0 0 10px 0;
    font-size: 0.95rem;
    color: #e0e0e0;
    font-weight: 600;
}

.filter-checkboxes {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.filter-checkbox {
    display: flex;
    align-items: center;
    cursor: pointer;
    font-size: 0.9rem;
    color: #c0c0d0;
}

.filter-checkbox input {
    margin-right: 8px;
    cursor: pointer;
}

.chart-display-options {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
}

.display-option {
    display: flex;
    align-items: center;
    cursor: pointer;
    font-size: 0.9rem;
    color: #c0c0d0;
}

.display-option input {
    margin-right: 6px;
    cursor: pointer;
}

.display-option span {
    user-select: none;
}

.filters-loading {
    text-align: center;
    color: #a0a0b0;
    padding: 10px;
}

@media (max-width: 768px) {
    .chart-header {
        flex-direction: column;
        align-items: flex-start;
    }

    .time-range-selector {
        margin-top: 10px;
    }

    .filter-categories {
        grid-template-columns: 1fr;
    }
}
`;
document.head.appendChild(chartStyles);
