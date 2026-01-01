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
            <h2>⚡ Verbrauchsstatistiken</h2>
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
        const timeLabel = (period === 'today' || period === 'yesterday')
            ? `${date.getHours()}:00 - ${date.getHours() + 1}:00`
            : `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;

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
