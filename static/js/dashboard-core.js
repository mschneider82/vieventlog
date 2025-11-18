        let currentInstallationId = null;
        let currentDeviceId = '0';
        let currentGatewaySerial = '';
        let installations = [];
        let autoRefreshInterval = null;

        // Parse URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('installationId')) {
            currentInstallationId = urlParams.get('installationId');
        }
        if (urlParams.has('deviceId')) {
            currentDeviceId = urlParams.get('deviceId');
        }
        if (urlParams.has('gatewaySerial')) {
            currentGatewaySerial = urlParams.get('gatewaySerial');
        }

        async function init() {
            await loadDevices();
            if (currentInstallationId) {
                await loadDashboard();
                startAutoRefresh();
            }
        }

        async function loadDevices() {
            try {
                const response = await fetch('/api/devices');
                const devicesByInstall = await response.json();
                installations = devicesByInstall;

                const installSelect = document.getElementById('installationSelect');
                installSelect.innerHTML = '';

                devicesByInstall.forEach(install => {
                    const option = document.createElement('option');
                    option.value = install.installationId;
                    option.textContent = `${install.description || install.installationId} - ${install.location}`;
                    if (install.installationId === currentInstallationId) {
                        option.selected = true;
                    }
                    installSelect.appendChild(option);
                });

                // Set first installation if none selected
                if (!currentInstallationId && devicesByInstall.length > 0) {
                    currentInstallationId = devicesByInstall[0].installationId;
                    installSelect.value = currentInstallationId;
                }

                // If gatewaySerial not set yet, get it from first heating device (not SmartClimate)
                if (!currentGatewaySerial && currentInstallationId) {
                    const currentInstall = devicesByInstall.find(i => i.installationId === currentInstallationId);
                    if (currentInstall && currentInstall.devices && currentInstall.devices.length > 0) {
                        // Filter to heating devices only
                        const heatingDevices = currentInstall.devices.filter(device => {
                            return device.deviceType !== 'zigbee' && device.deviceType !== 'roomControl';
                        });

                        if (heatingDevices.length > 0) {
                            // Take the first heating device and initialize both deviceId AND gatewaySerial
                            const firstDevice = heatingDevices[0];
                            currentDeviceId = firstDevice.deviceId;
                            currentGatewaySerial = firstDevice.gatewaySerial || '';
                            console.log('Initialized with first heating device:', currentDeviceId, 'Gateway:', currentGatewaySerial);
                        }
                    }
                }

                // Update device dropdown for selected installation (after initializing currentDeviceId and currentGatewaySerial)
                updateDeviceDropdown();

                // Update current installation display
                const selectedInstall = devicesByInstall.find(i => i.installationId === currentInstallationId);
                if (selectedInstall) {
                    document.getElementById('currentInstallation').textContent =
                        selectedInstall.description || selectedInstall.installationId;
                }

            } catch (error) {
                showError('Fehler beim Laden der Geräte: ' + error.message);
            }
        }

        function updateDeviceDropdown() {
            const deviceSelect = document.getElementById('deviceSelect');
            deviceSelect.innerHTML = '';

            // Find current installation
            const currentInstall = installations.find(i => i.installationId === currentInstallationId);

            console.log('updateDeviceDropdown - currentInstall:', currentInstall);

            if (currentInstall && currentInstall.devices && currentInstall.devices.length > 0) {
                console.log('Found', currentInstall.devices.length, 'devices:', currentInstall.devices);

                // Filter out SmartClimate devices (zigbee and roomControl)
                const heatingDevices = currentInstall.devices.filter(device => {
                    return device.deviceType !== 'zigbee' && device.deviceType !== 'roomControl';
                });

                console.log('Filtered to', heatingDevices.length, 'heating devices (excluding SmartClimate)');

                heatingDevices.forEach(device => {
                    const option = document.createElement('option');
                    // Create a unique value from gatewaySerial and deviceId
                    const uniqueKey = `${device.gatewaySerial}_${device.deviceId}`;
                    option.value = uniqueKey;
                    option.dataset.gatewaySerial = device.gatewaySerial || '';
                    option.dataset.deviceId = device.deviceId;
                    option.textContent = device.displayName || `${device.modelId} (Device ${device.deviceId})`;

                    // Check if this is the currently selected device
                    const currentKey = `${currentGatewaySerial}_${currentDeviceId}`;
                    if (uniqueKey === currentKey) {
                        option.selected = true;
                    }
                    deviceSelect.appendChild(option);
                    console.log('Added device option:', uniqueKey, device.modelId, 'Gateway:', device.gatewaySerial);
                });

                // If current device not in list, select first
                const currentKey = `${currentGatewaySerial}_${currentDeviceId}`;
                const deviceExists = heatingDevices.some(d => `${d.gatewaySerial}_${d.deviceId}` === currentKey);
                if (!deviceExists && heatingDevices.length > 0) {
                    const firstDevice = heatingDevices[0];
                    currentDeviceId = firstDevice.deviceId;
                    currentGatewaySerial = firstDevice.gatewaySerial;
                    deviceSelect.value = `${currentGatewaySerial}_${currentDeviceId}`;
                    console.log('Selected first device:', currentDeviceId, 'Gateway:', currentGatewaySerial);
                }
            } else {
                console.log('No devices found, using fallback Device 0');
                // Fallback to Device 0
                const option = document.createElement('option');
                option.value = '0';
                option.textContent = 'Device 0 (Standard)';
                deviceSelect.appendChild(option);
                currentDeviceId = '0';
            }

            console.log('Final currentDeviceId:', currentDeviceId);
        }

        async function loadDashboard(forceRefresh = false) {
            const contentDiv = document.getElementById('dashboardContent');
            contentDiv.className = 'loading';
            contentDiv.innerHTML = '<div class="spinner"></div><p>Lade Dashboard-Daten...</p>';

            try {
                // Get current device to extract gateway serial
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                // Find device by BOTH gatewaySerial AND deviceId (because multiple devices can have the same deviceId!)
                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    console.error('Device not found!', {
                        currentDeviceId,
                        currentGatewaySerial,
                        availableDevices: currentInstall.devices
                    });
                    throw new Error(`Gerät nicht gefunden: ${currentDeviceId} @ ${currentGatewaySerial}`);
                }

                const gatewaySerial = currentDevice.gatewaySerial || '';

                console.log('Selected device:', currentDevice);
                const refreshParam = forceRefresh ? '&refresh=true' : '';

                console.log('Fetching features for:', {
                    installationId: currentInstallationId,
                    gatewaySerial: gatewaySerial,
                    deviceId: currentDeviceId,
                    forceRefresh: forceRefresh
                });

                const response = await fetch(`/api/features?installationId=${currentInstallationId}&gatewaySerial=${gatewaySerial}&deviceId=${currentDeviceId}${refreshParam}`);
                if (!response.ok) {
                    throw new Error('API Fehler: ' + response.status);
                }

                const features = await response.json();

                // Add device info to features for display
                features.deviceInfo = currentDevice;

                // Store current device info globally for RPM calculation
                window.currentDeviceInfo = currentDevice;

                // Load device settings for RPM percentage calculation
                await loadDeviceSettings(currentDevice.installationId, currentDevice.deviceId);

                // Load hybrid pro control settings if available
                await loadSavedHybridProControlSettings(currentDevice.accountId, currentDevice.installationId, currentDevice.deviceId);

                renderDashboard(features);
                updateLastUpdate();

            } catch (error) {
                showError('Fehler beim Laden der Features: ' + error.message);
                contentDiv.innerHTML = '<div class="error">Fehler beim Laden der Daten: ' + error.message + '</div>';
            }
        }


        function translateMode(mode) {
            const modes = {
                'standby': 'Standby',
                'heating': 'Heizen',
                'cooling': 'Kühlen',
                'heatingCooling': 'Heizen/Kühlen',
                'dhw': 'Warmwasser',
                'dhwAndHeating': 'Heizen + Warmwasser',
                'forcedReduced': 'Reduziert',
                'forcedNormal': 'Normal',
                'normal': 'Normal'
            };
            return modes[mode] || mode;
        }

        function formatNum(val, decimals = 1) {
            if (val === null || val === undefined) return '--';
            if (typeof val === 'number') {
                return val.toFixed(decimals);
            }
            return val;
        }

        // Calculate water density based on temperature (in °C)
        // Returns density in kg/m³
        function getWaterDensity(tempC) {
            // Density table from DIN EN 12831 at 1013 hPa
            const densityTable = [
                { temp: 0, density: 999.84 },
                { temp: 1, density: 999.90 },
                { temp: 2, density: 999.94 },
                { temp: 3, density: 999.96 },
                { temp: 4, density: 999.97 },
                { temp: 5, density: 999.96 },
                { temp: 6, density: 999.94 },
                { temp: 7, density: 999.90 },
                { temp: 8, density: 999.85 },
                { temp: 9, density: 999.78 },
                { temp: 10, density: 999.70 },
                { temp: 15, density: 999.10 },
                { temp: 20, density: 998.21 },
                { temp: 25, density: 997.05 },
                { temp: 30, density: 995.65 },
                { temp: 35, density: 994.04 },
                { temp: 40, density: 992.22 },
                { temp: 45, density: 990.22 },
                { temp: 50, density: 988.04 },
                { temp: 55, density: 985.69 },
                { temp: 60, density: 983.20 },
                { temp: 65, density: 980.55 },
                { temp: 70, density: 977.76 },
                { temp: 75, density: 974.84 },
                { temp: 80, density: 971.79 },
                { temp: 85, density: 968.61 },
                { temp: 90, density: 965.30 },
                { temp: 95, density: 961.89 },
                { temp: 100, density: 958.30 }
            ];

            // Clamp temperature to table range
            if (tempC <= 0) return 999.84;
            if (tempC >= 100) return 958.30;

            // Find surrounding values for linear interpolation
            for (let i = 0; i < densityTable.length - 1; i++) {
                if (tempC >= densityTable[i].temp && tempC <= densityTable[i + 1].temp) {
                    const t1 = densityTable[i].temp;
                    const t2 = densityTable[i + 1].temp;
                    const d1 = densityTable[i].density;
                    const d2 = densityTable[i + 1].density;

                    // Linear interpolation
                    const ratio = (tempC - t1) / (t2 - t1);
                    return d1 + ratio * (d2 - d1);
                }
            }

            // Fallback (should never reach here)
            return 992.22; // 40°C default
        }

        // Check if a feature value contains a valid numeric value (not a status object)
        function isValidNumericValue(featureValue) {
            if (!featureValue || featureValue.value === undefined || featureValue.value === null) {
                return false;
            }
            // If value is an object (e.g., {status: {type: "string", value: "notConnected"}}),
            // it's not a valid numeric value
            if (typeof featureValue.value === 'object') {
                return false;
            }
            // Check if it's a number
            return typeof featureValue.value === 'number';
        }

        function extractFeatureValue(properties) {
            if (properties && properties.value) {
                return properties.value;
            }
            return { value: '--' };
        }

        // Format units to be more readable
        function formatUnit(unit, value = null) {
            if (!unit) return '';

            const unitMap = {
                'celsius': '°C',
                'ampere': 'A',
                'watt': 'W',
                'kilowatt': 'kW',
                'hour': 'Std.',
                'hours': 'Std.',
                'kilowattHour': 'kWh',
                'percent': '%',
                'bar': 'bar',
                'revolutionsPerSecond': 'U/s',
                'revolutionsPerMinute': 'U/min',
                'cubicMeter': 'm³',
                'cubicMeterPerHour': 'm³/h',
                'litersPerHour': 'l/h',
                'kelvin': 'K'
            };

            // Special case: Convert watt to kilowatt if value is large
            if (unit === 'watt' && value !== null && value >= 1000) {
                return 'kW';
            }

            return unitMap[unit] || unit;
        }

        // Helper function to unwrap nested value objects
        // Handles cases where value contains another {value: X, unit: Y} structure
        function unwrapValue(val) {
            // Recursively unwrap nested objects
            while (val && typeof val === 'object' && val.value !== undefined) {
                val = val.value;
            }
            return val;
        }

        function formatValue(featureValue) {
            if (!featureValue || featureValue.value === undefined) {
                return '--';
            }
            let val = unwrapValue(featureValue.value);
            const unit = featureValue.unit;

            // Handle case where val is still an object (should not happen after unwrap, but be safe)
            if (typeof val === 'object') {
                console.warn('formatValue: Could not unwrap value, got object:', val);
                return '--';
            }

            // Special case: Convert watt to kilowatt
            if (unit === 'watt' && val >= 1000) {
                val = (val / 1000).toFixed(1);
                return val + ' ' + formatUnit('kilowatt');
            }

            if (typeof val === 'number') {
                val = val.toFixed(1);
            }
            return val + (unit ? ' ' + formatUnit(unit, val) : '');
        }

        function findFeature(features, keyword) {
            for (const [key, value] of Object.entries(features)) {
                if (key.toLowerCase().includes(keyword.toLowerCase())) {
                    return value;
                }
            }
            return null;
        }

        function showError(message) {
            const errorDiv = document.getElementById('errorContainer');
            errorDiv.innerHTML = `<div class="error">${message}</div>`;
            setTimeout(() => {
                errorDiv.innerHTML = '';
            }, 5000);
        }

        function updateLastUpdate() {
            const now = new Date();
            document.getElementById('lastUpdate').textContent = now.toLocaleTimeString('de-DE');
        }

        function startAutoRefresh() {
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
            }
            autoRefreshInterval = setInterval(() => {
                loadDashboard();
            }, 60000); // Every minute
        }

        // Event Listeners
        document.getElementById('installationSelect').addEventListener('change', (e) => {
            currentInstallationId = e.target.value;

            // Get first device of new installation and set currentDeviceId + currentGatewaySerial
            const selectedInstall = installations.find(i => i.installationId === currentInstallationId);
            if (selectedInstall && selectedInstall.devices && selectedInstall.devices.length > 0) {
                const firstDevice = selectedInstall.devices[0];
                currentDeviceId = firstDevice.deviceId;
                currentGatewaySerial = firstDevice.gatewaySerial || '';
                console.log('Installation changed - selected first device:', currentDeviceId, 'Gateway:', currentGatewaySerial);
            }

            // Update device dropdown for new installation (will select the device we just set)
            updateDeviceDropdown();

            // Update installation name in breadcrumb
            if (selectedInstall) {
                document.getElementById('currentInstallation').textContent =
                    selectedInstall.description || selectedInstall.installationId;
            }

            // Reload dashboard with first device of new installation (use cache)
            loadDashboard(false); // Use cache when switching installations
        });

        document.getElementById('deviceSelect').addEventListener('change', (e) => {
            const selectedOption = e.target.options[e.target.selectedIndex];
            currentGatewaySerial = selectedOption.dataset.gatewaySerial || '';
            currentDeviceId = selectedOption.dataset.deviceId || '0';
            console.log('Device changed to:', currentDeviceId, 'Gateway:', currentGatewaySerial);
            loadDashboard(false); // Use cache when switching devices
        });

        document.getElementById('refreshBtn').addEventListener('click', () => {
            console.log('Manual refresh triggered');
            loadDashboard(true); // Force refresh only on manual refresh button
        });

        document.getElementById('debugBtn').addEventListener('click', () => {
            showDebugDevices();
        });

        // Debug functionality
        let showAllDevices = false;
        let showJsonView = false;
        let currentDebugData = null;
        let deviceFeatures = {}; // Store features per device

        // Initialize
        init();
