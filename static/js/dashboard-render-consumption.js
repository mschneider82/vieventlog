/**
 * dashboard-render-consumption.js
 * Renders a detailed consumption tile with statistics and charts
 */

// Cache for consumption data
let consumptionCache = {};
let consumptionChartInstance = null;
let consumptionPeriodChartInstance = null;

/**
 * Renders the consumption tile with detailed statistics
 * Inserts the tile after the temperature chart section
 */
async function renderConsumptionTile(deviceInfo, features) {
    const { installationId, gatewaySerial, deviceId } = deviceInfo;

    // Check if we have temperature logging enabled and data available
    try {
        const statsResponse = await fetch('/api/temperature-log/stats');
        const statsData = await statsResponse.json();

        if (!statsData.enabled || statsData.total_snapshots === 0) {
            // Don't show the tile if temperature logging is not active
            return;
        }
    } catch (err) {
        console.error('Failed to check temperature log status:', err);
        return;
    }

    const dashboardContent = document.getElementById('dashboardContent');
    if (!dashboardContent) return;

    // Check if consumption tile already exists
    let consumptionSection = document.getElementById('consumption-stats-section');
    if (consumptionSection) {
        // Already exists, just refresh data
        await loadConsumptionData(deviceInfo, 'today');
        return;
    }

    // Create consumption section
    consumptionSection = document.createElement('div');
    consumptionSection.id = 'consumption-stats-section';
    consumptionSection.className = 'temperature-chart-container'; // Use same class as temperature chart
    consumptionSection.innerHTML = `
        <div class="chart-header">
            <h2>⚡ Verbrauchsstatistiken
				<span style="font-size: 11px; color: #666; margin-left: 10px; font-family: monospace;">  (berechnet)</span>
			</h2>
            <div class="chart-controls">
                <div class="time-range-selector">
                    <button class="time-btn active" data-period="today">Heute</button>
                    <button class="time-btn" data-period="yesterday">Gestern</button>
                    <button class="time-btn" data-period="week">7 Tage</button>
                    <button class="time-btn" data-period="month">Monat</button>
                    <button class="time-btn" data-period="last30days">30 Tage</button>
                    <button class="time-btn" data-period="year">Jahr</button>
                    <div style="display: inline-flex; align-items: center; gap: 8px; margin-left: 10px;">
                        <label for="customDatePicker" style="color: #a0a0b0; font-size: 13px; white-space: nowrap;">📅 Bestimmter Tag:</label>
                        <input type="date" id="customDatePicker" class="custom-date-input" style="padding: 6px 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #fff; font-size: 13px; cursor: pointer;">
                    </div>
                </div>
            </div>
        </div>

        <!-- Main Statistics Cards -->
        <div class="consumption-stats-grid" id="consumptionStatsGrid">
            <div class="spinner"></div>
            <p style="color: #a0a0b0; text-align: center; margin-top: 10px;">Lade Verbrauchsdaten...</p>
        </div>

        <!-- Charts Container -->
        <div class="consumption-charts">
            <!-- Period Overview Chart -->
            <div class="consumption-chart-wrapper">
                <h3 id="consumptionChartTitle" style="color: #e0e0e0; font-size: 16px; margin-bottom: 15px;">Tagesverlauf</h3>
                <div id="consumptionChart" style="width: 100%; height: 400px;"></div>
            </div>

            <!-- Comparison Chart -->
            <div class="consumption-chart-wrapper">
                <h3 id="consumptionPeriodChartTitle" style="color: #e0e0e0; font-size: 16px; margin-bottom: 15px;">Zeitraumvergleich</h3>
                <div id="consumptionPeriodChart" style="width: 100%; height: 400px;"></div>
            </div>
        </div>

        <!-- Detailed Breakdown Table -->
        <div class="consumption-breakdown" id="consumptionBreakdown">
            <!-- Will be populated dynamically -->
        </div>
    `;

// Consumption statistics cards (API-data)  moved from dashboard-render-engine
    // Extract key features
    const keyFeatures = extractKeyFeatures(features);

    let html='<div  class="card">';
    // Consumption/Production Statistics
    html += renderConsumptionStatistics(keyFeatures);
    html += '</div>';
    consumptionSection.innerHTML += html;

	// Insert after temperature chart section or at the end
    const tempChartSection = document.getElementById('temperature-chart-section');
    if (tempChartSection && tempChartSection.nextSibling) {
        dashboardContent.insertBefore(consumptionSection, tempChartSection.nextSibling);
    } else if (tempChartSection) {
        tempChartSection.parentNode.insertBefore(consumptionSection, tempChartSection.nextElementSibling);
    } else {
        // Temperature chart doesn't exist, append at the end
        dashboardContent.appendChild(consumptionSection);
    }

    // Set up period selector buttons
    const periodButtons = consumptionSection.querySelectorAll('.time-btn');
    periodButtons.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            // Update active state
            periodButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Load data for selected period
            const period = btn.dataset.period;
            await loadConsumptionData(deviceInfo, period);
        });
    });

    // Set up date picker
    const datePicker = consumptionSection.querySelector('#customDatePicker');
    if (datePicker) {
        // Set max date to today
        const today = new Date().toISOString().split('T')[0];
        datePicker.max = today;

        datePicker.addEventListener('change', async (e) => {
            if (e.target.value) {
                // Deactivate all period buttons
                periodButtons.forEach(b => b.classList.remove('active'));

                // Load data for selected date
                await loadConsumptionData(deviceInfo, 'today', e.target.value);
            }
        });
    }

    // Load initial data (today)
    await loadConsumptionData(deviceInfo, 'today');
}

/**
 * Apply compressor power correction factor to consumption stats
 * This corrects electricity consumption values and recalculates COP
 */
function applyPowerCorrectionFactor(stats, deviceInfo) {
    if (!stats || !deviceInfo) return stats;

    // Get correction factor from device settings (default: 1.0 = no correction)
    let correctionFactor = 1.0;
    if (window.deviceSettingsCache) {
        const deviceKey = `${deviceInfo.installationId}_${deviceInfo.deviceId}`;
        const settings = window.deviceSettingsCache[deviceKey];
        if (settings && settings.powerCorrectionFactor) {
            correctionFactor = settings.powerCorrectionFactor;
            console.log(`[Consumption] Applying correction factor: ${correctionFactor} for device ${deviceKey}`);
        } else {
            console.log(`[Consumption] No correction factor found for device ${deviceKey}`, settings);
        }
    } else {
        console.log('[Consumption] deviceSettingsCache not available');
    }

    // If no correction needed, return original stats
    if (correctionFactor === 1.0) {
        console.log('[Consumption] No correction applied (factor = 1.0)');
        return stats;
    }

    // Create a deep copy to avoid modifying the original
    const corrected = JSON.parse(JSON.stringify(stats));

    console.log(`[Consumption] Original electricity: ${stats.electricity_kwh.toFixed(2)} kWh, COP: ${stats.avg_cop.toFixed(2)}`);

    // Apply correction to main stats
    corrected.electricity_kwh *= correctionFactor;

    // Recalculate COP: COP = Thermal / Electrical
    if (corrected.electricity_kwh > 0) {
        corrected.avg_cop = corrected.thermal_kwh / corrected.electricity_kwh;
    }

    console.log(`[Consumption] Corrected electricity: ${corrected.electricity_kwh.toFixed(2)} kWh, COP: ${corrected.avg_cop.toFixed(2)}`);

    // Apply correction to hourly breakdown
    if (corrected.hourly_breakdown && Array.isArray(corrected.hourly_breakdown)) {
        corrected.hourly_breakdown = corrected.hourly_breakdown.map(point => ({
            ...point,
            electricity_kwh: point.electricity_kwh * correctionFactor,
            avg_cop: point.electricity_kwh * correctionFactor > 0
                ? point.thermal_kwh / (point.electricity_kwh * correctionFactor)
                : 0
        }));
        console.log(`[Consumption] Corrected ${corrected.hourly_breakdown.length} hourly data points`);
    }

    // Apply correction to daily breakdown
    if (corrected.daily_breakdown && Array.isArray(corrected.daily_breakdown)) {
        corrected.daily_breakdown = corrected.daily_breakdown.map(point => ({
            ...point,
            electricity_kwh: point.electricity_kwh * correctionFactor,
            avg_cop: point.electricity_kwh * correctionFactor > 0
                ? point.thermal_kwh / (point.electricity_kwh * correctionFactor)
                : 0
        }));
        console.log(`[Consumption] Corrected ${corrected.daily_breakdown.length} daily data points`);
    }

    return corrected;
}

/**
 * Load consumption data for a specific period
 */
async function loadConsumptionData(deviceInfo, period, customDate = null) {
    const { installationId, gatewaySerial, deviceId, accountId } = deviceInfo;
    const cacheKey = customDate ? `${installationId}_${deviceId}_${customDate}` : `${installationId}_${deviceId}_${period}`;

    try {
        // Show loading state
        const statsGrid = document.getElementById('consumptionStatsGrid');
        if (statsGrid) {
            statsGrid.innerHTML = '<div class="spinner"></div><p style="color: #a0a0b0; text-align: center; margin-top: 10px;">Lade Verbrauchsdaten...</p>';
        }

        // Build API URL
        let apiUrl = `/api/consumption/stats?installationId=${installationId}&gatewaySerial=${gatewaySerial}&deviceId=${deviceId}&period=${period}`;
        if (customDate) {
            apiUrl += `&date=${customDate}`;
        }

        // Fetch data from API
        const response = await fetch(apiUrl);

        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to load consumption data');
        }

        // Apply correction factor to the stats
        const correctedStats = applyPowerCorrectionFactor(data.stats, deviceInfo);

        // Cache the corrected data
        consumptionCache[cacheKey] = correctedStats;

        // Render the data
        renderConsumptionStats(correctedStats, period, deviceInfo, customDate);
        renderConsumptionCharts(correctedStats, period, customDate);
        renderConsumptionBreakdown(correctedStats, period, customDate);

    } catch (err) {
        console.error('Failed to load consumption data:', err);
        const statsGrid = document.getElementById('consumptionStatsGrid');
        if (statsGrid) {
            statsGrid.innerHTML = `
                <div style="grid-column: 1/-1; background: rgba(220, 53, 69, 0.1); color: #f8d7da; padding: 15px; border-radius: 8px; border: 1px solid rgba(220, 53, 69, 0.3);">
                    <strong>Fehler beim Laden der Verbrauchsdaten:</strong><br>
                    ${err.message}
                </div>
            `;
        }
    }
}

/**
 * Render consumption statistics cards
 */
function renderConsumptionStats(stats, period, deviceInfo, customDate = null) {
    const statsGrid = document.getElementById('consumptionStatsGrid');
    if (!statsGrid) return;

    const formatKWh = (kwh) => {
        if (kwh >= 1000) return `${(kwh / 1000).toFixed(2)} MWh`;
        return `${kwh.toFixed(2)} kWh`;
    };

    const formatHours = (hours) => {
        const h = Math.floor(hours);
        const m = Math.round((hours - h) * 60);
        return `${h}h ${m}m`;
    };

    // Get electricity price from device settings cache (fallback to 0.30 if not found)
    let electricityPrice = 0.30; // Default
    if (deviceInfo && window.deviceSettingsCache) {
        const deviceKey = `${deviceInfo.installationId}_${deviceInfo.deviceId}`;
        const settings = window.deviceSettingsCache[deviceKey];
        if (settings && settings.electricityPrice) {
            electricityPrice = settings.electricityPrice;
        }
    }

    const costs = stats.electricity_kwh * electricityPrice;

    // Calculate efficiency
    const efficiency = stats.thermal_kwh > 0 ? (stats.thermal_kwh / stats.electricity_kwh) : 0;

    // Determine COP color class
    let copColorClass = 'stat-normal';
    if (stats.avg_cop >= 4) copColorClass = 'stat-success';
    else if (stats.avg_cop >= 3) copColorClass = 'stat-warning';
    else if (stats.avg_cop > 0) copColorClass = 'stat-error';

    statsGrid.innerHTML = `
        <div class="consumption-stat-card">
            <div class="stat-icon">⚡</div>
            <div class="stat-content">
                <div class="stat-label">Stromverbrauch</div>
                <div class="stat-value">${formatKWh(stats.electricity_kwh)}</div>
                <div class="stat-sublabel">~${costs.toFixed(2)} € (bei ${electricityPrice.toFixed(2)} €/kWh)</div>
            </div>
        </div>

        <div class="consumption-stat-card">
            <div class="stat-icon">🔥</div>
            <div class="stat-content">
                <div class="stat-label">Wärmeerzeugung</div>
                <div class="stat-value">${formatKWh(stats.thermal_kwh)}</div>
                <div class="stat-sublabel">Thermische Energie</div>
            </div>
        </div>

        <div class="consumption-stat-card ${copColorClass}">
            <div class="stat-icon">📊</div>
            <div class="stat-content">
                <div class="stat-label">Ø ArbeitsZahl</div>
                <div class="stat-value">${stats.avg_cop.toFixed(2)}</div>
                <div class="stat-sublabel">aus moment. ArbeitsZahl</div>
            </div>
        </div>

        <div class="consumption-stat-card">
            <div class="stat-icon">⏱️</div>
            <div class="stat-content">
                <div class="stat-label">Betriebsstunden</div>
                <div class="stat-value">${formatHours(stats.runtime_hours)}</div>
                <div class="stat-sublabel">Kompressor aktiv</div>
            </div>
        </div>

        <div class="consumption-stat-card">
            <div class="stat-icon">📈</div>
            <div class="stat-content">
                <div class="stat-label">Effizienz</div>
                <div class="stat-value">${efficiency.toFixed(2)}x</div>
                <div class="stat-sublabel">${stats.thermal_kwh.toFixed(1)} kWh aus ${stats.electricity_kwh.toFixed(1)} kWh</div>
            </div>
        </div>

        <div class="consumption-stat-card">
            <div class="stat-icon">📉</div>
            <div class="stat-content">
                <div class="stat-label">Datenpunkte</div>
                <div class="stat-value">${stats.samples}</div>
                <div class="stat-sublabel">Snapshots aufgezeichnet</div>
            </div>
        </div>
    `;
}

/**
 * Render consumption charts using ECharts
 */
function renderConsumptionCharts(stats, period, customDate = null) {
    // Determine chart type based on period
    if (period === 'today' || period === 'yesterday') {
        renderHourlyChart(stats, period, customDate);
    } else {
        renderDailyChart(stats, period, customDate);
    }

    // Always render the period comparison chart
    renderPeriodComparisonChart(stats, period, customDate);
}

/**
 * Render hourly consumption chart (for today/yesterday)
 */
function renderHourlyChart(stats, period, customDate = null) {
    const chartContainer = document.getElementById('consumptionChart');
    if (!chartContainer) return;

    const chartTitle = document.getElementById('consumptionChartTitle');
    if (chartTitle) {
        if (customDate) {
            // Format custom date for display (DD.MM.YYYY)
            const date = new Date(customDate + 'T00:00:00');
            const formatted = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
            chartTitle.textContent = `Tagesverlauf ${formatted}`;
        } else {
            chartTitle.textContent = period === 'today' ? 'Heutiger Tagesverlauf' : 'Gestriger Tagesverlauf';
        }
    }

    // Dispose old chart
    if (consumptionChartInstance) {
        consumptionChartInstance.dispose();
    }

    consumptionChartInstance = echarts.init(chartContainer, 'dark');

    const hourlyData = stats.hourly_breakdown || [];

    // Prepare data arrays
    const hours = hourlyData.map(d => {
        const date = new Date(d.timestamp);
        return `${date.getHours()}:00`;
    });
    const electricityData = hourlyData.map(d => d.electricity_kwh);
    const thermalData = hourlyData.map(d => d.thermal_kwh);
    const copData = hourlyData.map(d => d.avg_cop);

    // Calculate dynamic COP axis max (round up to next integer, minimum 6)
    const maxCOP = Math.max(...copData, 0);
    const copAxisMax = Math.max(Math.ceil(maxCOP + 1), 6);

    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            backgroundColor: 'rgba(30, 30, 46, 0.95)',
            borderColor: 'rgba(255,255,255,0.1)',
            textStyle: { color: '#e0e0e0' },
            formatter: function(params) {
                let result = params[0].axisValue + '<br/>';
                params.forEach(param => {
                    const value = typeof param.value === 'number' ? param.value.toFixed(2) : param.value;
                    result += param.marker + ' ' + param.seriesName + ': ' + value;
                    if (param.seriesName !== 'ArbeitsZahl') {
                        result += ' kWh';
                    }
                    result += '<br/>';
                });
                return result;
            }
        },
        legend: {
            data: ['Stromverbrauch', 'Wärmeerzeugung', 'ArbeitsZahl'],
            bottom: 0,
            textStyle: { color: '#a0a0b0' }
        },
        grid: {
            left: '3%',
            right: '4%',
            bottom: '50px',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            data: hours,
            boundaryGap: false,
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
            axisLabel: { color: '#a0a0b0' }
        },
        yAxis: [
            {
                type: 'value',
                name: 'Energie (kWh)',
                position: 'left',
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
                axisLabel: {
                    formatter: '{value} kWh',
                    color: '#a0a0b0'
                },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } }
            },
            {
                type: 'value',
                name: 'ArbeitsZahl',
                position: 'right',
                min: 0,
                max: copAxisMax,
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
                axisLabel: {
                    formatter: '{value}',
                    color: '#a0a0b0'
                },
                splitLine: { show: false }
            }
        ],
        series: [
            {
                name: 'Stromverbrauch',
                type: 'bar',
                data: electricityData,
                itemStyle: { color: '#ff6b6b' },
                yAxisIndex: 0
            },
            {
                name: 'Wärmeerzeugung',
                type: 'bar',
                data: thermalData,
                itemStyle: { color: '#4ecdc4' },
                yAxisIndex: 0
            },
            {
                name: 'ArbeitsZahl',
                type: 'line',
                data: copData,
                smooth: true,
                itemStyle: { color: '#95e1d3' },
                lineStyle: { width: 2 },
                yAxisIndex: 1
            }
        ]
    };

    consumptionChartInstance.setOption(option);
}

/**
 * Render daily consumption chart (for week/month/year)
 */
function renderDailyChart(stats, period, customDate = null) {
    const chartContainer = document.getElementById('consumptionChart');
    if (!chartContainer) return;

    const chartTitle = document.getElementById('consumptionChartTitle');
    if (chartTitle) {
        const titles = {
            'week': 'Letzte 7 Tage',
            'month': 'Aktueller Monat',
            'last30days': 'Letzte 30 Tage',
            'year': 'Aktuelles Jahr'
        };
        chartTitle.textContent = titles[period] || 'Zeitraum';
    }

    // Dispose old chart
    if (consumptionChartInstance) {
        consumptionChartInstance.dispose();
    }

    consumptionChartInstance = echarts.init(chartContainer, 'dark');

    const dailyData = stats.daily_breakdown || [];

    // Prepare data arrays
    const days = dailyData.map(d => {
        const date = new Date(d.timestamp);
        return `${date.getDate()}.${date.getMonth() + 1}`;
    });
    const electricityData = dailyData.map(d => d.electricity_kwh);
    const thermalData = dailyData.map(d => d.thermal_kwh);
    const copData = dailyData.map(d => d.avg_cop);

    // Calculate dynamic COP axis max (round up to next integer, minimum 6)
    const maxCOP = Math.max(...copData, 0);
    const copAxisMax = Math.max(Math.ceil(maxCOP + 1), 6);

    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            backgroundColor: 'rgba(30, 30, 46, 0.95)',
            borderColor: 'rgba(255,255,255,0.1)',
            textStyle: { color: '#e0e0e0' },
            formatter: function(params) {
                let result = params[0].axisValue + '<br/>';
                params.forEach(param => {
                    const value = typeof param.value === 'number' ? param.value.toFixed(2) : param.value;
                    result += param.marker + ' ' + param.seriesName + ': ' + value;
                    if (param.seriesName !== 'ArbeitsZahl') {
                        result += ' kWh';
                    }
                    result += '<br/>';
                });
                return result;
            }
        },
        legend: {
            data: ['Stromverbrauch', 'Wärmeerzeugung', 'ArbeitsZahl'],
            bottom: 0,
            textStyle: { color: '#a0a0b0' }
        },
        grid: {
            left: '3%',
            right: '4%',
            bottom: '50px',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            data: days,
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
            axisLabel: {
                rotate: period === 'year' ? 45 : 0,
                color: '#a0a0b0'
            }
        },
        yAxis: [
            {
                type: 'value',
                name: 'Energie (kWh)',
                position: 'left',
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
                axisLabel: {
                    formatter: '{value} kWh',
                    color: '#a0a0b0'
                },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } }
            },
            {
                type: 'value',
                name: 'ArbeitsZahl',
                position: 'right',
                min: 0,
                max: copAxisMax,
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
                axisLabel: {
                    formatter: '{value}',
                    color: '#a0a0b0'
                },
                splitLine: { show: false }
            }
        ],
        series: [
            {
                name: 'Stromverbrauch',
                type: 'bar',
                data: electricityData,
                itemStyle: { color: '#ff6b6b' },
                yAxisIndex: 0
            },
            {
                name: 'Wärmeerzeugung',
                type: 'bar',
                data: thermalData,
                itemStyle: { color: '#4ecdc4' },
                yAxisIndex: 0
            },
            {
                name: 'ArbeitsZahl',
                type: 'line',
                data: copData,
                smooth: true,
                itemStyle: { color: '#95e1d3' },
                lineStyle: { width: 2 },
                yAxisIndex: 1
            }
        ]
    };

    consumptionChartInstance.setOption(option);
}

/**
 * Render period comparison chart (pie/donut chart)
 */
function renderPeriodComparisonChart(stats, period, customDate = null) {
    const chartContainer = document.getElementById('consumptionPeriodChart');
    if (!chartContainer) return;

    const chartTitle = document.getElementById('consumptionPeriodChartTitle');
    if (chartTitle) {
        chartTitle.textContent = 'Energieverteilung';
    }

    // Dispose old chart
    if (consumptionPeriodChartInstance) {
        consumptionPeriodChartInstance.dispose();
    }

    consumptionPeriodChartInstance = echarts.init(chartContainer, 'dark');

    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                const value = params.value.toFixed(2);
                const percent = params.percent.toFixed(2);
                return `${params.seriesName} <br/>${params.name}: ${value} kWh (${percent}%)`;
            },
            backgroundColor: 'rgba(30, 30, 46, 0.95)',
            borderColor: 'rgba(255,255,255,0.1)',
            textStyle: { color: '#e0e0e0' }
        },
        legend: {
            orient: 'vertical',
            left: 'left',
            textStyle: { color: '#a0a0b0' }
        },
        series: [
            {
                name: 'Energie',
                type: 'pie',
                radius: ['40%', '70%'],
                avoidLabelOverlap: false,
                label: {
                    show: true,
                    formatter: (params) => {
                        const value = params.value.toFixed(2);
                        const percent = params.percent.toFixed(2);
                        return `${params.name}\n${value} kWh\n(${percent}%)`;
                    },
                    color: '#e0e0e0'
                },
                emphasis: {
                    label: {
                        show: true,
                        fontSize: '16',
                        fontWeight: 'bold'
                    }
                },
                labelLine: {
                    show: true,
                    lineStyle: { color: 'rgba(255,255,255,0.3)' }
                },
                data: [
                    {
                        value: stats.electricity_kwh,
                        name: 'Stromverbrauch',
                        itemStyle: { color: '#ff6b6b' }
                    },
                    {
                        value: stats.thermal_kwh,
                        name: 'Wärmeerzeugung',
                        itemStyle: { color: '#4ecdc4' }
                    }
                ]
            }
        ]
    };

    consumptionPeriodChartInstance.setOption(option);
}

/**
 * Render detailed breakdown table
 */
function renderConsumptionBreakdown(stats, period, customDate = null) {
    const breakdownContainer = document.getElementById('consumptionBreakdown');
    if (!breakdownContainer) return;

    const breakdown = (period === 'today' || period === 'yesterday')
        ? stats.hourly_breakdown
        : stats.daily_breakdown;

    if (!breakdown || breakdown.length === 0) {
        breakdownContainer.innerHTML = '';
        return;
    }

    let html = `
        <h3 style="color: #e0e0e0; font-size: 16px; margin: 20px 0 15px 0;">Detaillierte Aufschlüsselung</h3>
        <div class="breakdown-table-container">
            <table class="breakdown-table">
                <thead>
                    <tr>
                        <th>${period === 'today' || period === 'yesterday' ? 'Uhrzeit' : 'Datum'}</th>
                        <th>Strom (kWh)</th>
                        <th>Wärme (kWh)</th>
                        <th>ArbeitsZahl</th>
                        <th>Laufzeit</th>
                        <th>Samples</th>
                    </tr>
                </thead>
                <tbody>
    `;

    breakdown.forEach(item => {
        const date = new Date(item.timestamp);
        let timeLabel;
        if (period === 'today' || period === 'yesterday') {
            const startHour = date.getHours();
            const endHour = (startHour + 1) % 24; // Wrap 24 to 0
            const endHourStr = endHour.toString().padStart(2, '0');
            timeLabel = `${startHour}:00 - ${endHourStr}:00`;
        } else {
            timeLabel = `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;
        }

        const hours = Math.floor(item.runtime_hours);
        const minutes = Math.round((item.runtime_hours - hours) * 60);
        const runtimeLabel = `${hours}h ${minutes}m`;

        html += `
            <tr>
                <td><strong>${timeLabel}</strong></td>
                <td>${item.electricity_kwh.toFixed(2)}</td>
                <td>${item.thermal_kwh.toFixed(2)}</td>
                <td>${item.avg_cop.toFixed(2)}</td>
                <td>${runtimeLabel}</td>
                <td>${item.samples}</td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

    breakdownContainer.innerHTML = html;
}

// Window resize handler for charts
window.addEventListener('resize', () => {
    if (consumptionChartInstance) {
        consumptionChartInstance.resize();
    }
    if (consumptionPeriodChartInstance) {
        consumptionPeriodChartInstance.resize();
    }
});


//RS moved from dashboard-render-heating

        function renderConsumptionStatistics(kf) {
            // Check for array-based features (with includeDeviceFeatures=true)
            const hasArrayFeatures = kf.powerConsumptionDhw || kf.powerConsumptionHeating ||
                                     kf.heatProductionDhw || kf.heatProductionHeating || kf.gasConsumptionHeating;

            // Fallback to summary features
            const hasSummaryFeatures = kf.powerConsumptionSummaryDhw || kf.powerConsumptionSummaryHeating;

            if (!hasArrayFeatures && !hasSummaryFeatures) return '';

			// show array and summary statistics because array data may outdated
			// this may lead to duplicate information shown
            console.log('📊 show consumption statistics');
			let html = renderConsumptionStatisticsArrays(kf);
			html += renderConsumptionStatisticsSummary(kf);
			return html;
        }
		
		
        // NEW: Render statistics using array-based features - split into two cards
        function renderConsumptionStatisticsArrays(kf) {
            // Helper to get array value safely
            const getArrayValue = (feature, period, index = 0) => {
                if (!feature || !feature.properties || !feature.properties[period]) return null;
                const arr = feature.properties[period].value;
                if (!Array.isArray(arr) || index >= arr.length) return null;
                return arr[index];
            };

            // Helper to get summary value
            const getSummaryValue = (feature, period) => {
                if (!feature || !feature.properties || !feature.properties[period]) return null;
                const prop = feature.properties[period];
                if (prop && prop.value !== undefined) {
                    return prop.value;
                }
                return null;
            };

            // Check what data is available
            const hasGasConsumptionArrays = kf.gasConsumptionHeating || kf.gasConsumptionDhw;
            const hasPowerConsumptionArrays = kf.powerConsumptionDhw || kf.powerConsumptionHeating;
            const hasHeatProductionArrays = kf.heatProductionDhw && kf.heatProductionHeating;
            const hasHeatProductionSummary = kf.heatProductionSummaryDhw || kf.heatProductionSummaryHeating;
            const hasCompressorEnergyData = kf.compressorPowerConsumptionDhw || kf.compressorPowerConsumptionHeating ||
                                            kf.compressorHeatProductionDhw || kf.compressorHeatProductionHeating ||
                                            kf.compressorHeatProductionCooling;

            console.log('Power consumption arrays:', hasPowerConsumptionArrays);
            console.log('Heat production arrays:', hasHeatProductionArrays);
            console.log('Heat production summary:', hasHeatProductionSummary);
            console.log('Compressor energy data:', hasCompressorEnergyData);

            let html = '';

            // Card 1: Power Consumption (always with arrays if available)
            if (hasPowerConsumptionArrays) {
                html += renderPowerConsumptionCard(kf, getArrayValue);
            }

            // Card 2: Heat Production (arrays if available, otherwise summary)
            if (hasHeatProductionArrays) {
                html += renderHeatProductionArrayCard(kf, getArrayValue);
            } else if (hasHeatProductionSummary) {
                html += renderHeatProductionSummaryCard(kf, getSummaryValue);
            }

            // Card 3: Compressor-specific energy consumption and production (Vitocal)
            if (hasCompressorEnergyData) {
                html += renderCompressorEnergyCard(kf, getArrayValue);
            }
		
            // Card 3: Gas Consumption (always with arrays if available) (Vitodens)			
            if (hasGasConsumptionArrays) {
                html += renderGasConsumptionCard(kf, getArrayValue);
            }

            return html;
        }



        // Render Power Consumption Card with full array history
        // Power Consumption Card (Stromverbrauch) - separate Kachel
        function renderPowerConsumptionCard(kf, getArrayValue) {
			
			// get date to show from data if available
            const dayValueReadAt = kf.powerConsumptionHeating?.properties?.dayValueReadAt?.value || 0;
            let now = new Date();
            if(dayValueReadAt != 0){
                now = new Date(dayValueReadAt);
            }
			
            const getMonthName = (index) => {
				//const now = new Date();
                const d = new Date(now.getFullYear(), now.getMonth() - index, 1);
                return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
            };
        
            const getWeekLabel = (index) => {
                //const now = new Date();
                const d = new Date(now.getTime() - (index * 7 * 24 * 60 * 60 * 1000));
                const onejan = new Date(d.getFullYear(), 0, 1);
                const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
                return `KW ${week}`;
            };
        
            const getDayLabel = (index) => {
                //const now = new Date();
                const d = new Date(now.getTime() - (index * 24 * 60 * 60 * 1000));
                return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
            };
        
            let mainTabsHtml = `
                <button class="stat-tab active" onclick="switchStatPeriod(event, 'power-period-day')">Tag</button>
                <button class="stat-tab" onclick="switchStatPeriod(event, 'power-period-week')">Woche</button>
                <button class="stat-tab" onclick="switchStatPeriod(event, 'power-period-month')">Monat</button>
                <button class="stat-tab" onclick="switchStatPeriod(event, 'power-period-year')">Jahr</button>
            `;
        
            // Build days
            const dayArray = kf.powerConsumptionDhw?.properties?.day?.value || kf.powerConsumptionHeating?.properties?.day?.value || [];
            const maxDays = Math.min(dayArray.length, 8);
            let dayTabsHtml = '', dayContentHtml = '';

            for (let i = 0; i < maxDays; i++) {
                const powerDhw = getArrayValue(kf.powerConsumptionDhw, 'day', i);
                const powerHeating = getArrayValue(kf.powerConsumptionHeating, 'day', i);
                if (powerDhw === null && powerHeating === null) continue;
        
                const totalPower = (powerDhw || 0) + (powerHeating || 0);
                dayTabsHtml += `<button class="stat-tab ${i === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'power-day-${i}')">${getDayLabel(i)}</button>`;
                dayContentHtml += `
                    <div id="power-day-${i}" class="stat-tab-content" style="${i === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${powerDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(powerDhw)} kWh</span></div>` : ''}
                            ${powerHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(powerHeating)} kWh</span></div>` : ''}
                            ${totalPower > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalPower)} kWh</span></div>` : ''}
                        </div>
                    </div>
                `;
            }
        
            // Build weeks
            const weekArray = kf.powerConsumptionDhw?.properties?.week?.value || kf.powerConsumptionHeating?.properties?.week?.value || [];
            const maxWeeks = Math.min(weekArray.length, 6);
            let weekTabsHtml = '', weekContentHtml = '';
        
            for (let i = 0; i < maxWeeks; i++) {
                const powerDhw = getArrayValue(kf.powerConsumptionDhw, 'week', i);
                const powerHeating = getArrayValue(kf.powerConsumptionHeating, 'week', i);
                if (powerDhw === null && powerHeating === null) continue;
        
                const totalPower = (powerDhw || 0) + (powerHeating || 0);
                weekTabsHtml += `<button class="stat-tab ${i === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'power-week-${i}')">${getWeekLabel(i)}</button>`;
                weekContentHtml += `
                    <div id="power-week-${i}" class="stat-tab-content" style="${i === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${powerDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(powerDhw)} kWh</span></div>` : ''}
                            ${powerHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(powerHeating)} kWh</span></div>` : ''}
                            ${totalPower > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalPower)} kWh</span></div>` : ''}
                        </div>
                    </div>
                `;
            }
        
            // Build months
            const monthArray = kf.powerConsumptionDhw?.properties?.month?.value || kf.powerConsumptionHeating?.properties?.month?.value || [];
            const maxMonths = Math.min(monthArray.length, 13);
            let monthTabsHtml = '', monthContentHtml = '';
        
            for (let i = 0; i < maxMonths; i++) {
                const powerDhw = getArrayValue(kf.powerConsumptionDhw, 'month', i);
                const powerHeating = getArrayValue(kf.powerConsumptionHeating, 'month', i);
                if (powerDhw === null && powerHeating === null) continue;
        
                const totalPower = (powerDhw || 0) + (powerHeating || 0);
                monthTabsHtml += `<button class="stat-tab ${i === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'power-month-${i}')">${getMonthName(i)}</button>`;
                monthContentHtml += `
                    <div id="power-month-${i}" class="stat-tab-content" style="${i === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${powerDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(powerDhw)} kWh</span></div>` : ''}
                            ${powerHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(powerHeating)} kWh</span></div>` : ''}
                            ${totalPower > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalPower)} kWh</span></div>` : ''}
                        </div>
                    </div>
                `;
            }
        
            // Build years
            const yearArray = kf.powerConsumptionDhw?.properties?.year?.value || kf.powerConsumptionHeating?.properties?.year?.value || [];
            const maxYears = Math.min(yearArray.length, 2);
            let yearTabsHtml = '', yearContentHtml = '';
        
            for (let i = 0; i < maxYears; i++) {
                const powerDhw = getArrayValue(kf.powerConsumptionDhw, 'year', i);
                const powerHeating = getArrayValue(kf.powerConsumptionHeating, 'year', i);
                if (powerDhw === null && powerHeating === null) continue;
        
                const now = new Date();
                const yearLabel = now.getFullYear() - i;
                const totalPower = (powerDhw || 0) + (powerHeating || 0);
                yearTabsHtml += `<button class="stat-tab ${i === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'power-year-${i}')">${yearLabel}</button>`;
                yearContentHtml += `
                    <div id="power-year-${i}" class="stat-tab-content" style="${i === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${powerDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(powerDhw)} kWh</span></div>` : ''}
                            ${powerHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(powerHeating)} kWh</span></div>` : ''}
                            ${totalPower > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalPower)} kWh</span></div>` : ''}
                        </div>
                    </div>
                `;
            }
        
            if (!dayTabsHtml && !weekTabsHtml && !monthTabsHtml && !yearTabsHtml) return '';
        
            return `
                <div class="card">
                    <div class="card-header"><h2>⚡ Stromverbrauch</h2></div>
                    <div class="stat-tabs stat-tabs-main">${mainTabsHtml}</div>
                    <div id="power-period-day" class="stat-period-content" style="display: block;">
                        <div class="stat-tabs stat-tabs-scrollable">${dayTabsHtml}</div>
                        <div class="stat-content">${dayContentHtml}</div>
                    </div>
                    <div id="power-period-week" class="stat-period-content" style="display: none;">
                        <div class="stat-tabs stat-tabs-scrollable">${weekTabsHtml}</div>
                        <div class="stat-content">${weekContentHtml}</div>
                    </div>
                    <div id="power-period-month" class="stat-period-content" style="display: none;">
                        <div class="stat-tabs stat-tabs-scrollable">${monthTabsHtml}</div>
                        <div class="stat-content">${monthContentHtml}</div>
                    </div>
                    <div id="power-period-year" class="stat-period-content" style="display: none;">
                        <div class="stat-tabs stat-tabs-scrollable">${yearTabsHtml}</div>
                        <div class="stat-content">${yearContentHtml}</div>
                    </div>
                </div>
            `;
        }
        // Render Gas Consumption Card with full array history
        // Gas Consumption Card (Gasverbrauch) - separate Kachel
        function renderGasConsumptionCard(kf, getArrayValue) {
			
			// get date to show from data if available
            const dayValueReadAt = kf.gasConsumptionDhw?.properties?.dayValueReadAt?.value ||
                                   kf.gasConsumptionHeating?.properties?.dayValueReadAt?.value || 0;
            let now = new Date();
            if(dayValueReadAt != 0){
                now = new Date(dayValueReadAt);
            }

            // Maximum age for day-0 data before it's considered stale (4 hours in milliseconds)
            const MAX_DAY_AGE_MS = 4 * 3600 * 1000;

            const getMonthName = (index) => {
                //const now = new Date();
                const d = new Date(now.getFullYear(), now.getMonth() - index, 1);
                return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
            };

            const getWeekLabel = (index) => {
                //const now = new Date();
                const d = new Date(now.getTime() - (index * 7 * 24 * 60 * 60 * 1000));
                const onejan = new Date(d.getFullYear(), 0, 1);
                const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
                return `KW ${week}`;
            };

            const getDayLabel = (index) => {
                //const now = new Date();
                const d = new Date(now.getTime() - (index * 24 * 60 * 60 * 1000));
                return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
            };

            let mainTabsHtml = `
                <button class="stat-tab active" onclick="switchStatPeriod(event, 'gas-period-day')">Tag</button>
                <button class="stat-tab" onclick="switchStatPeriod(event, 'gas-period-week')">Woche</button>
                <button class="stat-tab" onclick="switchStatPeriod(event, 'gas-period-month')">Monat</button>
                <button class="stat-tab" onclick="switchStatPeriod(event, 'gas-period-year')">Jahr</button>
            `;

            // Build days
            const dayArray = kf.gasConsumptionDhw?.properties?.day?.value || kf.gasConsumptionHeating?.properties?.day?.value || [];
            const maxDays = Math.min(dayArray.length, 8);
            let dayTabsHtml = '', dayContentHtml = '';


            for (let i = 0; i < maxDays; i++) {
                const gasDhw = getArrayValue(kf.gasConsumptionDhw, 'day', i);
                const gasHeating = getArrayValue(kf.gasConsumptionHeating, 'day', i);
                if (gasDhw === null && gasHeating === null) continue;

                const totalGas = (gasDhw || 0) + (gasHeating || 0);
                dayTabsHtml += `<button class="stat-tab ${i === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'gas-day-${i}')">${getDayLabel(i)}</button>`;
                dayContentHtml += `
                    <div id="gas-day-${i}" class="stat-tab-content" style="${i === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${gasDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(gasDhw)} m³</span></div>` : ''}
                            ${gasHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(gasHeating)} m³</span></div>` : ''}
                            ${totalGas > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalGas)} m³</span></div>` : ''}
                        </div>
                    </div>
                `;
            }

            // Build weeks
            const weekArray = kf.gasConsumptionDhw?.properties?.week?.value || kf.gasConsumptionHeating?.properties?.week?.value || [];
            const maxWeeks = Math.min(weekArray.length, 6);
            let weekTabsHtml = '', weekContentHtml = '';

            for (let i = 0; i < maxWeeks; i++) {
                const gasDhw = getArrayValue(kf.gasConsumptionDhw, 'week', i);
                const gasHeating = getArrayValue(kf.gasConsumptionHeating, 'week', i);
                if (gasDhw === null && gasHeating === null) continue;

                const totalGas = (gasDhw || 0) + (gasHeating || 0);
                weekTabsHtml += `<button class="stat-tab ${i === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'gas-week-${i}')">${getWeekLabel(i)}</button>`;
                weekContentHtml += `
                    <div id="gas-week-${i}" class="stat-tab-content" style="${i === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${gasDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(gasDhw)} m³</span></div>` : ''}
                            ${gasHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(gasHeating)} m³</span></div>` : ''}
                            ${totalGas > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalGas)} m³</span></div>` : ''}
                        </div>
                    </div>
                `;
            }

            // Build months
            const monthArray = kf.gasConsumptionDhw?.properties?.month?.value || kf.gasConsumptionHeating?.properties?.month?.value || [];
            const maxMonths = Math.min(monthArray.length, 13);
            let monthTabsHtml = '', monthContentHtml = '';

            for (let i = 0; i < maxMonths; i++) {
                const gasDhw = getArrayValue(kf.gasConsumptionDhw, 'month', i);
                const gasHeating = getArrayValue(kf.gasConsumptionHeating, 'month', i);
                if (gasDhw === null && gasHeating === null) continue;

                const totalGas = (gasDhw || 0) + (gasHeating || 0);
                monthTabsHtml += `<button class="stat-tab ${i === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'gas-month-${i}')">${getMonthName(i)}</button>`;
                monthContentHtml += `
                    <div id="gas-month-${i}" class="stat-tab-content" style="${i === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${gasDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(gasDhw)} m³</span></div>` : ''}
                            ${gasHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(gasHeating)} m³</span></div>` : ''}
                            ${totalGas > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalGas)} m³</span></div>` : ''}
                        </div>
                    </div>
                `;
            }

            // Build years
            const yearArray = kf.gasConsumptionDhw?.properties?.year?.value || kf.gasConsumptionHeating?.properties?.year?.value || [];
            const maxYears = Math.min(yearArray.length, 2);
            let yearTabsHtml = '', yearContentHtml = '';

            for (let i = 0; i < maxYears; i++) {
                const gasDhw = getArrayValue(kf.gasConsumptionDhw, 'year', i);
                const gasHeating = getArrayValue(kf.gasConsumptionHeating, 'year', i);
                if (gasDhw === null && gasHeating === null) continue;

                const now = new Date();
                const yearLabel = now.getFullYear() - i;
                const totalGas = (gasDhw || 0) + (gasHeating || 0);
                yearTabsHtml += `<button class="stat-tab ${i === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'gas-year-${i}')">${yearLabel}</button>`;
                yearContentHtml += `
                    <div id="gas-year-${i}" class="stat-tab-content" style="${i === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${gasDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(gasDhw)} m³</span></div>` : ''}
                            ${gasHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(gasHeating)} m³</span></div>` : ''}
                            ${totalGas > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalGas)} m³</span></div>` : ''}
                        </div>
                    </div>
                `;
            }

            if (!dayTabsHtml && !weekTabsHtml && !monthTabsHtml && !yearTabsHtml) return '';

            return `
                <div class="card">
                    <div class="card-header"><h2>🔥 Gasverbrauch</h2></div>
                    <div class="stat-tabs stat-tabs-main">${mainTabsHtml}</div>
                    <div id="gas-period-day" class="stat-period-content" style="display: block;">
                        <div class="stat-tabs stat-tabs-scrollable">${dayTabsHtml}</div>
                        <div class="stat-content">${dayContentHtml}</div>
                    </div>
                    <div id="gas-period-week" class="stat-period-content" style="display: none;">
                        <div class="stat-tabs stat-tabs-scrollable">${weekTabsHtml}</div>
                        <div class="stat-content">${weekContentHtml}</div>
                    </div>
                    <div id="gas-period-month" class="stat-period-content" style="display: none;">
                        <div class="stat-tabs stat-tabs-scrollable">${monthTabsHtml}</div>
                        <div class="stat-content">${monthContentHtml}</div>
                    </div>
                    <div id="gas-period-year" class="stat-period-content" style="display: none;">
                        <div class="stat-tabs stat-tabs-scrollable">${yearTabsHtml}</div>
                        <div class="stat-content">${yearContentHtml}</div>
                    </div>
                </div>
            `;
        }
        
        
        // Heat Production Summary Card (Erzeugte Wärmeenergie) - separate Kachel mit Summary-Daten
        function renderHeatProductionSummaryCard(kf, getSummaryValue) {
            const periods = [
                {key: 'currentDay', label: 'Heute'},
                {key: 'lastSevenDays', label: 'Letzte 7 Tage'},
                {key: 'currentMonth', label: 'Aktueller Monat'},
                {key: 'lastMonth', label: 'Letzter Monat'},
                {key: 'currentYear', label: 'Aktuelles Jahr'},
                {key: 'lastYear', label: 'Letztes Jahr'}
            ];
        
            let tabsHtml = '';
            let contentHtml = '';
        
            periods.forEach((period, index) => {
                const heatDhw = getSummaryValue(kf.heatProductionSummaryDhw, period.key);
                const heatHeating = getSummaryValue(kf.heatProductionSummaryHeating, period.key);
        
                if (heatDhw === null && heatHeating === null) return;
        
                const totalHeat = (heatDhw || 0) + (heatHeating || 0);
        
                tabsHtml += `<button class="stat-tab ${index === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'heat-${period.key}')">${period.label}</button>`;
                contentHtml += `
                    <div id="heat-${period.key}" class="stat-tab-content" style="${index === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${heatDhw !== null ? `<div class="stat-item stat-heat"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(heatDhw)} kWh</span></div>` : ''}
                            ${heatHeating !== null ? `<div class="stat-item stat-heat"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(heatHeating)} kWh</span></div>` : ''}
                            ${totalHeat > 0 ? `<div class="stat-item stat-heat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalHeat)} kWh</span></div>` : ''}
                        </div>
                    </div>
                `;
            });
        
            if (!tabsHtml) return '';
        
            return `
                <div class="card">
                    <div class="card-header"><h2>🌡️ Erzeugte Wärmeenergie</h2></div>
                    <div class="stat-tabs stat-tabs-scrollable">${tabsHtml}</div>
                    <div class="stat-content">${contentHtml}</div>
                </div>
            `;
        }

        // Compressor-specific energy consumption and production card (Vitocal - single week values)
        function renderCompressorEnergyCard(kf, getArrayValue) {
            // Helper to extract single value from feature
            const getValue = (feature) => {
                if (!feature) return null;
                // Handle direct value property
                if (feature.value !== undefined) {
                    return feature.value;
                }
                // Handle properties.value structure
                if (feature.properties && feature.properties.value && feature.properties.value.value !== undefined) {
                    return feature.properties.value.value;
                }
                return null;
            };

            let html = '';

            // Build power consumption card
            const powerDhw = getValue(kf.compressorPowerConsumptionDhw);
            const powerHeating = getValue(kf.compressorPowerConsumptionHeating);

            if (powerDhw !== null || powerHeating !== null) {
                const totalPower = (powerDhw || 0) + (powerHeating || 0);
                html += `
                    <div class="card">
                        <div class="card-header"><h2>⚡ Verdichter Stromverbrauch (Wöchentlich)</h2></div>
                        <div class="stat-grid">
                            ${powerDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(powerDhw)} kWh</span></div>` : ''}
                            ${powerHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(powerHeating)} kWh</span></div>` : ''}
                            ${totalPower > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalPower)} kWh</span></div>` : ''}
                        </div>
                    </div>
                `;
            }

            // Build heat production card
            const heatDhw = getValue(kf.compressorHeatProductionDhw);
            const heatHeating = getValue(kf.compressorHeatProductionHeating);
            const heatCooling = getValue(kf.compressorHeatProductionCooling);

            if (heatDhw !== null || heatHeating !== null || heatCooling !== null) {
                const totalHeat = (heatDhw || 0) + (heatHeating || 0) + (heatCooling || 0);
                html += `
                    <div class="card">
                        <div class="card-header"><h2>🌡️ Verdichter Wärmeproduktion (Wöchentlich)</h2></div>
                        <div class="stat-grid">
                            ${heatDhw !== null ? `<div class="stat-item stat-heat"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(heatDhw)} kWh</span></div>` : ''}
                            ${heatHeating !== null ? `<div class="stat-item stat-heat"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(heatHeating)} kWh</span></div>` : ''}
                            ${heatCooling !== null ? `<div class="stat-item stat-cool"><span class="stat-label">❄️ Kühlung</span><span class="stat-value">${formatNum(heatCooling)} kWh</span></div>` : ''}
                            ${totalHeat > 0 ? `<div class="stat-item stat-heat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalHeat)} kWh</span></div>` : ''}
                        </div>
                    </div>
                `;
            }

            return html;
        }

        // Fallback: Render statistics using summary features
        function renderConsumptionStatisticsSummary(kf) {

            // Helper to extract property from summary feature
            const getProp = (summary, prop) => {
                if (!summary || !summary.properties || !summary.properties[prop]) return null;
                const property = summary.properties[prop];
                // The property structure is {type: "number", value: X, unit: "kilowattHour"}
                if (property && property.value !== undefined) {
                    return property.value;
                }
                return null;
            };

            // Collect data for each time period
            const periods = [
                {key: 'currentDay', label: 'Heute', divider: 1},
                {key: 'lastSevenDays', label: '7 Tage', divider: 7},
                {key: 'currentMonth', label: 'Monat', divider: 30},
                {key: 'currentYear', label: 'Jahr', divider: 365}
            ];

            let tabsHtml = '';
            let contentHtml = '';

            periods.forEach((period, index) => {
                const powerDhw = getProp(kf.powerConsumptionSummaryDhw, period.key);
                const powerHeating = getProp(kf.powerConsumptionSummaryHeating, period.key);
                const heatDhw = getProp(kf.heatProductionSummaryDhw, period.key);
                const heatHeating = getProp(kf.heatProductionSummaryHeating, period.key);

                // Debug log
                if (period.key === 'currentDay') {
                    console.log(`📊 ${period.label} raw data:`, {
                        powerDhw,
                        powerHeating,
                        heatDhw,
                        heatHeating,
                        powerDhwFeature: kf.powerConsumptionSummaryDhw,
                        powerHeatingFeature: kf.powerConsumptionSummaryHeating
                    });
                }

                // Skip if no data
                if (powerDhw === null && powerHeating === null && heatDhw === null && heatHeating === null) return;

                const totalPower = (powerDhw || 0) + (powerHeating || 0);
                const totalHeat = (heatDhw || 0) + (heatHeating || 0);
                const cop = totalPower > 0 ? (totalHeat / totalPower).toFixed(2) : '-';
                const avgPerWeek = period.divider > 1 ? (totalPower / period.divider * 7).toFixed(1) : null;

                tabsHtml += `
                    <button class="stat-tab ${index === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'stat-${period.key}')">
                        ${period.label}
                    </button>
                `;

                contentHtml += `
                    <div id="stat-${period.key}" class="stat-tab-content" style="${index === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${powerDhw !== null ? `
                                <div class="stat-item stat-power">
                                    <span class="stat-label">💧 Warmwasser/Verdichter</span>
                                    <span class="stat-value">${formatNum(powerDhw)} kWh</span>
                                    ${avgPerWeek && period.key !== 'currentDay' ? `<span class="stat-avg">≈ ${avgPerWeek} kWh/Woche</span>` : ''}
                                </div>
                            ` : ''}
                            ${powerHeating !== null ? `
                                <div class="stat-item stat-power">
                                    <span class="stat-label">🔥 Heizen/Verdichter</span>
                                    <span class="stat-value">${formatNum(powerHeating)} kWh</span>
                                </div>
                            ` : ''}
                            ${totalPower > 0 ? `
                                <div class="stat-item stat-total">
                                    <span class="stat-label">⚡ Strom Gesamt</span>
                                    <span class="stat-value">${formatNum(totalPower)} kWh</span>
                                </div>
                            ` : ''}
                            ${heatDhw !== null ? `
                                <div class="stat-item stat-heat">
                                    <span class="stat-label">🌡️ Wärme Warmwasser</span>
                                    <span class="stat-value">${formatNum(heatDhw)} kWh</span>
                                </div>
                            ` : ''}
                            ${heatHeating !== null ? `
                                <div class="stat-item stat-heat">
                                    <span class="stat-label">🏠 Wärme Heizen</span>
                                    <span class="stat-value">${formatNum(heatHeating)} kWh</span>
                                </div>
                            ` : ''}
                            ${totalHeat > 0 && totalPower > 0 ? `
                                <div class="stat-item stat-cop">
                                    <span class="stat-label">📊 momentane AZ (${period.label})</span>
                                    <span class="stat-value">${cop}</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            });

            if (!tabsHtml) return '';

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>📈 Verbrauchsstatistik</h2>
                    </div>
                    <div class="stat-tabs">
                        ${tabsHtml}
                    </div>
                    <div class="stat-content">
                        ${contentHtml}
                    </div>
                </div>
            `;
        }
