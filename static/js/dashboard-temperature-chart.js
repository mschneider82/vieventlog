// Dashboard Temperature Chart Integration
// Renders compact temperature history chart in dashboard when temperature logging is enabled

let tempChartInstance = null;
let tempChartData = null;
let currentTempTimeRange = 24; // hours
let temperatureLoggingEnabled = false;
let chartInitialized = false;

async function checkTemperatureLoggingEnabled() {
    try {
        const response = await fetch('/api/temperature-log/settings');
        if (!response.ok) return false;
        const settings = await response.json();
        temperatureLoggingEnabled = settings.enabled;
        return settings.enabled;
    } catch (error) {
        console.error('Error checking temperature log settings:', error);
        return false;
    }
}

async function loadTemperatureChartData(installationId, hours = 24) {
    try {
        console.log(`Fetching temperature data for installationId=${installationId}, hours=${hours}`);
        const response = await fetch(`/api/temperature-log/data?installationId=${installationId}&hours=${hours}&limit=500`);
        if (!response.ok) {
            console.log('Temperature data not available (status:', response.status, ')');
            return null;
        }
        const result = await response.json();
        console.log(`Loaded ${result.count} temperature data points for installation ${installationId}`);
        return result.data || [];
    } catch (error) {
        console.error('Error loading temperature chart data:', error);
        return null;
    }
}

function renderTemperatureChartCard(deviceInfo) {
    return `
        <div class="card wide" id="temperatureChartCard">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <span>📊 Temperaturverläufe (letzte ${currentTempTimeRange}h)</span>
                <div style="display: flex; gap: 5px; align-items: center;">
                    <button onclick="updateTempChartRange(1)" class="temp-range-btn" data-hours="1">1h</button>
                    <button onclick="updateTempChartRange(6)" class="temp-range-btn" data-hours="6">6h</button>
                    <button onclick="updateTempChartRange(12)" class="temp-range-btn" data-hours="12">12h</button>
                    <button onclick="updateTempChartRange(24)" class="temp-range-btn active" data-hours="24">24h</button>
                    <button onclick="updateTempChartRange(48)" class="temp-range-btn" data-hours="48">2d</button>
                    <button onclick="updateTempChartRange(72)" class="temp-range-btn" data-hours="72">3d</button>
                    <button onclick="updateTempChartRange(168)" class="temp-range-btn" data-hours="168">7d</button>
                    <button onclick="updateTempChartRange(720)" class="temp-range-btn" data-hours="720">30d</button>
                </div>
            </div>
            <div class="card-content">
                <div id="tempSeriesFilters" style="margin-bottom: 15px; display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px;">
                    <!-- Filters will be dynamically generated based on available data -->
                </div>
                <div id="dashboardTempChart" style="width: 100%; height: 400px;"></div>
            </div>
        </div>
    `;
}

async function initializeTemperatureChart(deviceInfo) {
    if (chartInitialized) {
        console.log('Temperature chart already initialized');
        return;
    }

    console.log('Initializing temperature chart for device:', deviceInfo);

    const isEnabled = await checkTemperatureLoggingEnabled();
    console.log('Temperature logging enabled:', isEnabled);
    if (!isEnabled) {
        console.log('Temperature logging is not enabled - skipping chart initialization');
        return;
    }

    // Find the dashboard grid container
    const dashboardGrid = document.querySelector('.dashboard-grid');
    if (!dashboardGrid) {
        console.warn('Dashboard grid not found, cannot insert temperature chart');
        return;
    }

    // Insert chart card at the beginning (after any existing cards)
    const firstCard = dashboardGrid.querySelector('.card');
    if (firstCard) {
        const chartHTML = renderTemperatureChartCard(deviceInfo);
        firstCard.insertAdjacentHTML('afterend', chartHTML);
    } else {
        // No cards yet, insert at the beginning
        const chartHTML = renderTemperatureChartCard(deviceInfo);
        dashboardGrid.insertAdjacentHTML('afterbegin', chartHTML);
    }

    // Initialize ECharts
    const chartContainer = document.getElementById('dashboardTempChart');
    if (chartContainer && window.echarts) {
        tempChartInstance = echarts.init(chartContainer);
        chartInitialized = true;

        // Load and render data
        await updateTemperatureChart(deviceInfo.installationId, currentTempTimeRange);
    } else {
        console.warn('Chart container or echarts not available');
    }
}

// Generate filter checkboxes based on available data
function generateSeriesFilters(data) {
    const filterContainer = document.getElementById('tempSeriesFilters');
    if (!filterContainer) return;

    // Check which series have data
    const availableSeries = [
        { id: 'series_outside_temp', label: '🌡️ Außentemp.', field: 'outside_temp', defaultChecked: true },
        { id: 'series_supply_temp', label: '➡️ Vorlauf', field: 'primary_supply_temp', defaultChecked: true },
        { id: 'series_return_temp', label: '⬅️ Rücklauf', field: 'return_temp', defaultChecked: true },
        { id: 'series_dhw_temp', label: '💧 Warmwasser', field: 'dhw_temp', defaultChecked: true },
        { id: 'series_buffer_temp', label: '🔥 Puffer', field: 'buffer_temp', defaultChecked: true },
        { id: 'series_target_supply_temp', label: '🎯 Soll-Vorlauf', field: 'target_supply_temp', defaultChecked: false },
        { id: 'series_compressor_power', label: '⚡ Leistung', field: 'compressor_power', defaultChecked: false },
        { id: 'series_cop', label: '📊 COP', field: 'cop', defaultChecked: false }
    ];

    // Filter to only show series that have data
    const seriesWithData = availableSeries.filter(s =>
        data.some(d => d[s.field] != null && d[s.field] !== 0)
    );

    // Generate checkboxes
    filterContainer.innerHTML = seriesWithData.map(s => `
        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 6px; background: rgba(255,255,255,0.03); border-radius: 4px;">
            <input type="checkbox" id="${s.id}" ${s.defaultChecked ? 'checked' : ''} onchange="updateTempChart()">
            <span style="font-size: 12px; color: #e0e0e0;">${s.label}</span>
        </label>
    `).join('');
}

async function updateTemperatureChart(installationId, hours) {
    if (!tempChartInstance) {
        console.log('Chart instance not initialized yet');
        return;
    }

    console.log(`Loading temperature data for installation ${installationId}, ${hours} hours`);
    tempChartData = await loadTemperatureChartData(installationId, hours);

    if (!tempChartData || tempChartData.length === 0) {
        tempChartInstance.setOption({
            title: {
                text: 'Keine Temperaturdaten verfügbar.\nTemperatur-Logging muss aktiviert sein und Daten müssen gesammelt worden sein.',
                left: 'center',
                top: 'center',
                textStyle: { color: '#e0e0e0', fontSize: 14 }
            }
        });
        console.log('No temperature data available');
        return;
    }

    console.log(`Rendering chart with ${tempChartData.length} data points`);

    // Generate filters based on available data (only on first render or data change)
    generateSeriesFilters(tempChartData);

    // Helper to check if series should be shown
    const isSeriesEnabled = (seriesId) => {
        const checkbox = document.getElementById(seriesId);
        return checkbox ? checkbox.checked : false;
    };

    // Build series based on checkbox selections
    const series = [];

    // DHW (Warmwasser)
    if (isSeriesEnabled('series_dhw_temp') && tempChartData.some(d => d.dhw_temp != null)) {
        series.push({
            name: 'Warmwasser',
            type: 'line',
            data: tempChartData.map(d => [new Date(d.timestamp), d.dhw_temp]),
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 2 },
            color: '#ff6b6b'
        });
    }

    // Buffer
    if (isSeriesEnabled('series_buffer_temp') && tempChartData.some(d => d.buffer_temp != null)) {
        series.push({
            name: 'Puffer',
            type: 'line',
            data: tempChartData.map(d => [new Date(d.timestamp), d.buffer_temp]),
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 2 },
            color: '#ffa500'
        });
    }

    // Supply temp (use primary_supply_temp as fallback)
    if (isSeriesEnabled('series_supply_temp')) {
        const supplyData = tempChartData.map(d => [
            new Date(d.timestamp),
            d.supply_temp != null ? d.supply_temp : d.primary_supply_temp
        ]);
        if (supplyData.some(d => d[1] != null)) {
            series.push({
                name: 'Vorlauf',
                type: 'line',
                data: supplyData,
                smooth: true,
                symbol: 'none',
                lineStyle: { width: 2 },
                color: '#4ecdc4'
            });
        }
    }

    // Return temp
    if (isSeriesEnabled('series_return_temp') && tempChartData.some(d => d.return_temp != null)) {
        series.push({
            name: 'Rücklauf',
            type: 'line',
            data: tempChartData.map(d => [new Date(d.timestamp), d.return_temp]),
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 2 },
            color: '#45b7d1'
        });
    }

    // Outside temp
    if (isSeriesEnabled('series_outside_temp') && tempChartData.some(d => d.outside_temp != null)) {
        series.push({
            name: 'Außentemp.',
            type: 'line',
            data: tempChartData.map(d => [new Date(d.timestamp), d.outside_temp]),
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.5 },
            color: '#95e1d3'
        });
    }

    // Target supply temp
    if (isSeriesEnabled('series_target_supply_temp') && tempChartData.some(d => d.target_supply_temp != null)) {
        series.push({
            name: 'Soll-Vorlauf',
            type: 'line',
            data: tempChartData.map(d => [new Date(d.timestamp), d.target_supply_temp]),
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.5, type: 'dashed' },
            color: '#a78bfa'
        });
    }

    // Compressor power on secondary Y-axis
    const hasCompressorData = tempChartData.some(d => d.compressor_power != null && d.compressor_power > 0);
    if (isSeriesEnabled('series_compressor_power') && hasCompressorData) {
        series.push({
            name: 'Leistung (W)',
            type: 'line',
            data: tempChartData.map(d => [new Date(d.timestamp), d.compressor_power]),
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.5, type: 'dashed' },
            color: '#667eea',
            yAxisIndex: 1
        });
    }

    // COP on secondary Y-axis
    const hasCOPData = tempChartData.some(d => d.cop != null && d.cop > 0);
    if (isSeriesEnabled('series_cop') && hasCOPData) {
        series.push({
            name: 'COP',
            type: 'line',
            data: tempChartData.map(d => [new Date(d.timestamp), d.cop]),
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.5 },
            color: '#34d399',
            yAxisIndex: 1
        });
    }

    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            backgroundColor: 'rgba(0,0,0,0.8)',
            borderColor: 'rgba(255,255,255,0.2)',
            textStyle: { color: '#e0e0e0', fontSize: 12 },
            formatter: function(params) {
                if (!params || params.length === 0) return '';

                // Format timestamp
                const date = new Date(params[0].value[0]);
                const day = date.getDate().toString().padStart(2, '0');
                const month = (date.getMonth() + 1).toString().padStart(2, '0');
                const year = date.getFullYear();
                const hours = date.getHours().toString().padStart(2, '0');
                const minutes = date.getMinutes().toString().padStart(2, '0');

                let tooltip = `<strong>${day}.${month}.${year} ${hours}:${minutes}</strong><br/>`;

                params.forEach(param => {
                    if (param.value[1] != null) {
                        const value = typeof param.value[1] === 'number' ? param.value[1].toFixed(1) : param.value[1];
                        const unit = param.seriesName.includes('Leistung') ? ' W' :
                                     param.seriesName === 'COP' ? '' : ' °C';
                        tooltip += `<span style="color:${param.color}">●</span> ${param.seriesName}: <strong>${value}${unit}</strong><br/>`;
                    }
                });

                return tooltip;
            }
        },
        legend: {
            data: series.map(s => s.name),
            textStyle: { color: '#e0e0e0', fontSize: 11 },
            top: 5,
            itemWidth: 20,
            itemHeight: 10
        },
        grid: {
            left: '50px',
            right: hasCompressorData || hasCOPData ? '60px' : '20px',
            bottom: currentTempTimeRange <= 6 ? '50px' : '30px', // More space for rotated labels
            top: 40
        },
        xAxis: {
            type: 'time',
            boundaryGap: false,
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
            axisLabel: {
                color: '#e0e0e0',
                fontSize: 11,
                formatter: function(value) {
                    const date = new Date(value);
                    const hours = date.getHours().toString().padStart(2, '0');
                    const minutes = date.getMinutes().toString().padStart(2, '0');

                    // For very short time ranges, show hours:minutes
                    if (currentTempTimeRange <= 6) {
                        return hours + ':' + minutes;
                    }
                    // For 12-24 hours, show hours only
                    else if (currentTempTimeRange <= 24) {
                        return hours + ':00';
                    }
                    // For 2-7 days, show date and hour
                    else if (currentTempTimeRange <= 168) {
                        const day = date.getDate().toString().padStart(2, '0');
                        const month = (date.getMonth() + 1).toString().padStart(2, '0');
                        return day + '.' + month + ' ' + hours + ':00';
                    }
                    // For longer periods, show only date
                    else {
                        const day = date.getDate().toString().padStart(2, '0');
                        const month = (date.getMonth() + 1).toString().padStart(2, '0');
                        return day + '.' + month;
                    }
                },
                // Reduce label density to avoid overlap
                interval: 'auto',
                rotate: currentTempTimeRange <= 6 ? 45 : 0,
                hideOverlap: true
            },
            splitLine: { show: false },
            // Improve tick distribution
            minInterval: currentTempTimeRange <= 1 ? 5 * 60 * 1000 : // 5 minutes for 1h
                         currentTempTimeRange <= 6 ? 30 * 60 * 1000 : // 30 minutes for 6h
                         currentTempTimeRange <= 24 ? 3600 * 1000 : // 1 hour for 24h
                         currentTempTimeRange <= 72 ? 6 * 3600 * 1000 : // 6 hours for 3 days
                         24 * 3600 * 1000 // 1 day for longer
        },
        yAxis: [
            {
                type: 'value',
                name: '°C',
                nameTextStyle: { color: '#e0e0e0', fontSize: 11 },
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
                axisLabel: { color: '#e0e0e0', fontSize: 11 },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } }
            },
            {
                type: 'value',
                name: (hasCompressorData && hasCOPData) ? 'W / COP' : hasCompressorData ? 'W' : hasCOPData ? 'COP' : '',
                nameTextStyle: { color: '#e0e0e0', fontSize: 11 },
                position: 'right',
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
                axisLabel: { color: '#e0e0e0', fontSize: 11 },
                splitLine: { show: false },
                // Only show if we have power or COP data
                show: hasCompressorData || hasCOPData
            }
        ],
        series: series
    };

    tempChartInstance.setOption(option, true);
}

function updateTempChartRange(hours) {
    currentTempTimeRange = hours;

    // Update button states
    document.querySelectorAll('.temp-range-btn').forEach(btn => {
        if (btn.dataset.hours == hours) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update card header
    const cardHeader = document.querySelector('#temperatureChartCard .card-header span');
    if (cardHeader) {
        const hoursText = hours >= 24 ? Math.floor(hours / 24) + 'd' : hours + 'h';
        cardHeader.textContent = `📊 Temperaturverläufe (letzte ${hoursText})`;
    }

    // Reload data
    if (window.currentInstallationId) {
        updateTemperatureChart(window.currentInstallationId, hours);
    }
}

// Hook into dashboard refresh - listen for the custom event
window.addEventListener('dashboardDataLoaded', (event) => {
    console.log('Dashboard data loaded event received:', event.detail);
    const deviceInfo = event.detail?.deviceInfo;
    if (deviceInfo && deviceInfo.installationId) {
        window.currentInstallationId = deviceInfo.installationId;

        // Check if chart DOM element still exists (dashboard might have been re-rendered)
        const chartElement = document.getElementById('dashboardTempChart');
        const chartCardExists = document.getElementById('temperatureChartCard');

        if (!chartCardExists || !chartElement) {
            // Chart was removed from DOM (e.g., installation/device switch), re-initialize
            console.log('Chart DOM element not found, reinitializing...');
            chartInitialized = false;
            tempChartInstance = null;
        }

        // Initialize chart if not done yet or was removed
        if (!chartInitialized) {
            setTimeout(() => {
                initializeTemperatureChart(deviceInfo);
            }, 500); // Small delay to ensure DOM is ready
        } else {
            // Just update the data
            updateTemperatureChart(deviceInfo.installationId, currentTempTimeRange);
        }
    }
});

// Resize handler
window.addEventListener('resize', () => {
    if (tempChartInstance) {
        tempChartInstance.resize();
    }
});

// Update chart with current data (called by checkbox changes)
function updateTempChart() {
    if (window.currentInstallationId && tempChartData) {
        updateTemperatureChart(window.currentInstallationId, currentTempTimeRange);
    }
}

// Make functions globally available for onclick handlers
window.updateTempChartRange = updateTempChartRange;
window.updateTempChart = updateTempChart;

