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
        const response = await fetch(`/api/temperature-log/data?installationId=${installationId}&hours=${hours}&limit=500`);
        if (!response.ok) {
            console.log('Temperature data not available (status:', response.status, ')');
            return null;
        }
        const result = await response.json();
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
                    <button onclick="updateTempChartRange(6)" class="temp-range-btn" data-hours="6">6h</button>
                    <button onclick="updateTempChartRange(12)" class="temp-range-btn" data-hours="12">12h</button>
                    <button onclick="updateTempChartRange(24)" class="temp-range-btn active" data-hours="24">24h</button>
                    <button onclick="updateTempChartRange(48)" class="temp-range-btn" data-hours="48">2d</button>
                    <button onclick="updateTempChartRange(72)" class="temp-range-btn" data-hours="72">3d</button>
                    <button onclick="updateTempChartRange(168)" class="temp-range-btn" data-hours="168">7d</button>
                    <a href="/vitocal-charts" style="margin-left: 10px; padding: 5px 10px; background: rgba(102, 126, 234, 0.2); border: 1px solid rgba(102, 126, 234, 0.4); border-radius: 4px; color: #a3b9ff; text-decoration: none; font-size: 12px;">
                        Erweitert →
                    </a>
                </div>
            </div>
            <div class="card-content">
                <div id="dashboardTempChart" style="width: 100%; height: 350px;"></div>
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
    if (!isEnabled) {
        console.log('Temperature logging is not enabled');
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

    // Build series - show key temperatures only
    const series = [];

    // DHW (Warmwasser) - always show if available
    if (tempChartData.some(d => d.dhw_temp != null)) {
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
    if (tempChartData.some(d => d.buffer_temp != null)) {
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

    // Supply temp
    if (tempChartData.some(d => d.supply_temp != null)) {
        series.push({
            name: 'Vorlauf',
            type: 'line',
            data: tempChartData.map(d => [new Date(d.timestamp), d.supply_temp]),
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 2 },
            color: '#4ecdc4'
        });
    }

    // Return temp
    if (tempChartData.some(d => d.return_temp != null)) {
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
    if (tempChartData.some(d => d.outside_temp != null)) {
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

    // Compressor power on secondary Y-axis
    const hasCompressorData = tempChartData.some(d => d.compressor_power != null && d.compressor_power > 0);
    if (hasCompressorData) {
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

    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            backgroundColor: 'rgba(0,0,0,0.8)',
            borderColor: 'rgba(255,255,255,0.2)',
            textStyle: { color: '#e0e0e0', fontSize: 12 }
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
            right: hasCompressorData ? '60px' : '20px',
            bottom: '30px',
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
                    if (currentTempTimeRange <= 24) {
                        return date.getHours() + ':00';
                    } else {
                        return (date.getMonth() + 1) + '/' + date.getDate();
                    }
                }
            },
            splitLine: { show: false }
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
                name: 'W',
                nameTextStyle: { color: '#e0e0e0', fontSize: 11 },
                position: 'right',
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
                axisLabel: { color: '#e0e0e0', fontSize: 11 },
                splitLine: { show: false }
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

        // Initialize chart if not done yet
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

// Make functions globally available for onclick handlers
window.updateTempChartRange = updateTempChartRange;

