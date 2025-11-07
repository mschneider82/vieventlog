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

        function renderDashboard(features) {
            const contentDiv = document.getElementById('dashboardContent');
            contentDiv.className = 'dashboard-grid';

            // Store features globally for debugging
            window.currentFeaturesData = features;

            // Extract key features
            const keyFeatures = extractKeyFeatures(features);

            // Store key features globally for use in Modal
            window.currentKeyFeatures = keyFeatures;

            // Debug: Log features with specific keywords
            if (features.rawFeatures) {
                const volumeFlowFeatures = features.rawFeatures.filter(f =>
                    f.feature && (
                        f.feature.toLowerCase().includes('volume') ||
                        f.feature.toLowerCase().includes('flow') ||
                        f.feature.toLowerCase().includes('fan')
                    )
                );
                if (volumeFlowFeatures.length > 0) {
                    console.log('🔍 Features mit volume/flow/fan:', volumeFlowFeatures);
                }

                const statsFeatures = features.rawFeatures.filter(f =>
                    f.feature && f.feature.toLowerCase().includes('statistic')
                );
                if (statsFeatures.length > 0) {
                    console.log('📊 Statistics Features:', statsFeatures);
                }
            }

            // Build dashboard HTML
            let html = '';

            // Check if this is a SmartClimate / Zigbee device
            const deviceInfo = features.deviceInfo;
            const deviceType = deviceInfo ? deviceInfo.deviceType : null;
            const modelId = deviceInfo ? deviceInfo.modelId : null;

            console.log('Device Type:', deviceType, 'Model ID:', modelId);

            // Render appropriate view based on device type
            if (deviceType === 'zigbee') {
                // SmartClimate / Zigbee device
                if (modelId && modelId.includes('eTRV')) {
                    // Heizkörper-Thermostat
                    html += renderThermostatView(keyFeatures, deviceInfo);
                } else if (modelId && modelId.includes('cs_generic')) {
                    // Klimasensor
                    html += renderClimateSensorView(keyFeatures, deviceInfo);
                } else if (modelId && modelId.includes('fht')) {
                    // Fußboden-Thermostat
                    html += renderFloorHeatingView(keyFeatures, deviceInfo);
                } else if (modelId && modelId.includes('repeater')) {
                    // Repeater
                    html += renderRepeaterView(keyFeatures, deviceInfo);
                } else {
                    // Unknown zigbee device - show generic info
                    html += renderDeviceHeader(deviceInfo, keyFeatures);
                    html += renderZigbeeDeviceInfo(keyFeatures);
                }
            } else {
                // Standard heating device (Vitocal/Vitodens)

                // Detect heating circuits first
                const circuits = detectHeatingCircuits(features);
                console.log('Rendering circuits:', circuits);

                // Store heating curve data per circuit for later use (BEFORE rendering header)
                if (!window.heatingCurveData) {
                    window.heatingCurveData = {};
                }

                // Get room temperature setpoint from active program
                let roomTempSetpoint = 20; // Default fallback
                if (keyFeatures.operatingProgram && keyFeatures.operatingProgram.value) {
                    const activeProgram = keyFeatures.operatingProgram.value;
                    console.log('🔍 Active program for heating curve:', activeProgram);
                    // Try to get temperature for active program (it's a nested property)
                    const programFeatureName = `heating.circuits.0.operating.programs.${activeProgram}`;
                    console.log('🔍 Looking for feature:', programFeatureName);
                    for (const category of [features.circuits, features.operatingModes, features.temperatures, features.other]) {
                        if (category && category[programFeatureName]) {
                            const programFeature = category[programFeatureName];
                            console.log('🔍 Found program feature:', programFeature);
                            if (programFeature.value && programFeature.value.temperature) {
                                const tempProp = programFeature.value.temperature;
                                if (tempProp.value !== undefined && tempProp.value !== null) {
                                    roomTempSetpoint = tempProp.value;
                                    console.log(`✅ Using room temp setpoint from active program ${activeProgram}: ${roomTempSetpoint}°C`);
                                    break;
                                }
                            }
                        }
                    }
                    if (roomTempSetpoint === 20) {
                        console.log('⚠️ Could not find temperature for active program, using default 20°C');
                    }
                }

                // Store data for circuit 0 (backward compatibility)
                window.heatingCurveData[0] = {
                    slope: keyFeatures.heatingCurveSlope ? keyFeatures.heatingCurveSlope.value : null,
                    shift: keyFeatures.heatingCurveShift ? keyFeatures.heatingCurveShift.value : null,
                    currentOutside: keyFeatures.outsideTemp ? keyFeatures.outsideTemp.value : null,
                    currentSupply: keyFeatures.supplyTemp ? keyFeatures.supplyTemp.value : null,
                    maxSupply: keyFeatures.supplyTempMax ? keyFeatures.supplyTempMax.value : null,
                    minSupply: keyFeatures.supplyTempMin ? keyFeatures.supplyTempMin.value : null,
                    roomTempSetpoint: roomTempSetpoint
                };
                // Keep legacy format for backward compatibility (for chart rendering)
                window.heatingCurveData.slope = window.heatingCurveData[0].slope;
                window.heatingCurveData.shift = window.heatingCurveData[0].shift;
                window.heatingCurveData.currentOutside = window.heatingCurveData[0].currentOutside;
                window.heatingCurveData.currentSupply = window.heatingCurveData[0].currentSupply;
                window.heatingCurveData.maxSupply = window.heatingCurveData[0].maxSupply;
                window.heatingCurveData.minSupply = window.heatingCurveData[0].minSupply;
                window.heatingCurveData.roomTempSetpoint = window.heatingCurveData[0].roomTempSetpoint;

                // Device info header (if available) - NOW with heatingCurveData available
                if (features.deviceInfo) {
                    html += renderDeviceHeader(features.deviceInfo, keyFeatures);
                }

                // Main temperature displays (outside, supply)
                html += renderMainTemperatures(keyFeatures);

                // Store data for each circuit
                for (const circuitId of circuits) {
                    const circuitPrefix = `heating.circuits.${circuitId}`;
                    const find = (exactName) => {
                        for (const category of [features.circuits, features.operatingModes, features.temperatures, features.other]) {
                            if (category && category[exactName]) {
                                const feature = category[exactName];
                                // Handle both simple values and Objects with properties/value
                                if (feature.type === 'object') {
                                    // For objects, try to extract the actual value from properties or value
                                    const container = feature.value || feature.properties;
                                    if (container && typeof container === 'object') {
                                        // Look for a "value" property that has an actual numeric value
                                        if (container.value && container.value.value !== undefined) {
                                            return container.value; // Return the value object
                                        }
                                        // Or return the container itself if it has a direct value
                                        if (container.value !== undefined && typeof container.value === 'number') {
                                            return { value: container.value, type: feature.type, unit: feature.unit };
                                        }
                                    }
                                } else if (feature.value !== null && feature.value !== undefined) {
                                    return feature;
                                }
                            }
                        }
                        return null;
                    };
                    const findNested = (featureName, propertyName) => {
                        for (const category of [features.circuits, features.operatingModes, features.temperatures, features.other]) {
                            if (category && category[featureName]) {
                                const feature = category[featureName];
                                if (feature.type === 'object') {
                                    // Support both "value" and "properties" formats
                                    const container = feature.value || feature.properties;
                                    if (container && typeof container === 'object') {
                                        const nestedValue = container[propertyName];
                                        if (nestedValue && nestedValue.value !== undefined) {
                                            return nestedValue.value;
                                        }
                                    }
                                }
                            }
                        }
                        return null;
                    };

                    const slope = findNested(`${circuitPrefix}.heating.curve`, 'slope');
                    const shift = findNested(`${circuitPrefix}.heating.curve`, 'shift');
                    const circuitSupplyTemp = find(`${circuitPrefix}.sensors.temperature.supply`);
                    const maxSupply = findNested(`${circuitPrefix}.temperature.levels`, 'max');
                    const minSupply = findNested(`${circuitPrefix}.temperature.levels`, 'min');

                    // Get room temperature setpoint from active program for this circuit
                    let circuitRoomTempSetpoint = 20; // Default fallback
                    const operatingProgram = find(`${circuitPrefix}.operating.programs.active`);
                    if (operatingProgram && operatingProgram.value) {
                        const activeProgram = operatingProgram.value;
                        const programFeatureName = `${circuitPrefix}.operating.programs.${activeProgram}`;
                        for (const category of [features.circuits, features.operatingModes, features.temperatures, features.other]) {
                            if (category && category[programFeatureName]) {
                                const programFeature = category[programFeatureName];
                                if (programFeature.value && programFeature.value.temperature) {
                                    const tempProp = programFeature.value.temperature;
                                    if (tempProp.value !== undefined && tempProp.value !== null) {
                                        circuitRoomTempSetpoint = tempProp.value;
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    window.heatingCurveData[circuitId] = {
                        slope: slope,
                        shift: shift,
                        currentOutside: keyFeatures.outsideTemp ? keyFeatures.outsideTemp.value : null,
                        currentSupply: circuitSupplyTemp ? circuitSupplyTemp.value : null,
                        maxSupply: maxSupply,
                        minSupply: minSupply,
                        roomTempSetpoint: circuitRoomTempSetpoint
                    };
                    console.log(`📊 Stored heating curve data for circuit ${circuitId}:`, window.heatingCurveData[circuitId]);
                }

                // Compressor/burner status card with all details
                html += renderCompressorBurnerStatus(keyFeatures);

                // Render heating circuits
                for (const circuitId of circuits) {
                    html += renderHeatingCircuitCard(features, circuitId, deviceInfo);
                }

                // Hot water card
                html += renderHotWater(keyFeatures);

                // Heating curve & settings - only show if no heating circuit cards were rendered
                if (circuits.length === 0) {
                    html += renderHeatingCurve(keyFeatures);
                }

                // Consumption
                html += renderConsumption(keyFeatures);

                // Consumption/Production Statistics
                html += renderConsumptionStatistics(keyFeatures);

                // Additional sensors & pumps
                html += renderAdditionalSensors(keyFeatures);

                // Refrigerant circuit (heat pump only)
                html += renderRefrigerantCircuit(keyFeatures);

                // Hybrid Pro Control (hybrid systems)
                html += renderHybridProControlInfo(keyFeatures);

                // System status - only show if no heating circuit cards were rendered
                if (circuits.length === 0) {
                    html += renderSystemStatus(keyFeatures);
                }

                // Device information
                html += renderDeviceInfo(keyFeatures);
            }

            contentDiv.innerHTML = html;

            // Render D3 charts after DOM is updated (only for heating devices)
            if (deviceType !== 'zigbee' && window.heatingCurveData) {
                // Use longer timeout to allow DOM to fully layout (especially important with multiple circuits)
                setTimeout(() => {
                    console.log('📈 Starting to render all heating curve charts...');
                    console.log('Available circuits in heatingCurveData:', Object.keys(window.heatingCurveData));
                    // Render chart for each circuit that has heating curve data
                    for (const circuitId in window.heatingCurveData) {
                        if (circuitId !== 'slope' && circuitId !== 'shift' && circuitId !== 'currentOutside' &&
                            circuitId !== 'currentSupply' && circuitId !== 'maxSupply' && circuitId !== 'minSupply' &&
                            circuitId !== 'roomTempSetpoint') {
                            const data = window.heatingCurveData[circuitId];
                            console.log(`  Circuit ${circuitId}: data=${JSON.stringify(data)}`);
                            if (data && (data.slope !== null || data.shift !== null)) {
                                console.log(`  └─ Rendering chart for circuit ${circuitId}`);
                                renderHeatingCurveChart(parseInt(circuitId));
                            }
                        }
                    }
                }, 300); // Increased timeout from 100ms to 300ms for better DOM layout with multiple circuits
            }
        }

        function extractKeyFeatures(features) {
            // Find features by exact name first, then by pattern
            const find = (exactNames, patterns = []) => {
                if (!Array.isArray(exactNames)) exactNames = [exactNames];
                if (!Array.isArray(patterns)) patterns = patterns ? [patterns] : [];

                // Try exact matches first
                for (const exactName of exactNames) {
                    for (const category of [features.temperatures, features.dhw, features.circuits,
                           features.operatingModes, features.other]) {
                        if (category[exactName]) {
                            const feature = category[exactName];
                            // Handle both simple values and Objects with properties/value
                            if (feature.type === 'object') {
                                // For objects, try to extract the actual value from properties or value
                                const container = feature.value || feature.properties;
                                if (container && typeof container === 'object') {
                                    // Look for a "value" property that has an actual numeric value
                                    if (container.value && container.value.value !== undefined) {
                                        return container.value; // Return the value object
                                    }
                                    // Or return the container itself if it has a direct value
                                    if (container.value !== undefined && typeof container.value === 'number') {
                                        return { value: container.value, type: feature.type, unit: feature.unit };
                                    }
                                }
                            } else if (feature.value !== null && feature.value !== undefined) {
                                return feature;
                            }
                        }
                    }
                }

                // Fall back to pattern matching
                for (const pattern of patterns) {
                    for (const category of [features.temperatures, features.dhw, features.circuits,
                           features.operatingModes, features.other]) {
                        for (const [key, value] of Object.entries(category)) {
            if (key.toLowerCase().includes(pattern.toLowerCase()) &&
                value.value !== null && value.value !== undefined) {
                return value;
            }
                        }
                    }
                }
                return null;
            };

            // Special find for nested properties (e.g., heating.curve has slope and shift as properties)
            const findNested = (featureName, propertyName) => {
                for (const category of [features.temperatures, features.dhw, features.circuits,
                       features.operatingModes, features.other]) {
                    if (category[featureName]) {
                        const feature = category[featureName];
                        // Check if it has nested properties (Go now returns type="object" with nested FeatureValues)
                        if (feature.type === 'object') {
                            // Support both "value" and "properties" formats
                            const container = feature.value || feature.properties;
                            if (container && typeof container === 'object') {
                                const nestedValue = container[propertyName];
                                if (nestedValue && nestedValue.value !== undefined) {
                                    return {
                                        type: nestedValue.type || 'number',
                                        value: nestedValue.value,
                                        unit: nestedValue.unit || ''
                                    };
                                }
                            }
                        }
                    }
                }
                return null;
            };

            const findAll = (pattern) => {
                const results = [];
                for (const category of [features.temperatures, features.dhw, features.circuits,
                       features.operatingModes, features.other]) {
                    for (const [key, value] of Object.entries(category)) {
                        if (key.toLowerCase().includes(pattern.toLowerCase()) &&
            value.value !== null && value.value !== undefined) {
            results.push({ name: key, value: value });
                        }
                    }
                }
                return results;
            };

            return {
                // Temperatures
                outsideTemp: find(['heating.sensors.temperature.outside'], ['outside']),
                calculatedOutsideTemp: find(['heating.calculated.temperature.outside']),
                supplyTemp: find(['heating.circuits.0.sensors.temperature.supply']),
                returnTemp: find(['heating.sensors.temperature.return']),
                primarySupplyTemp: find(['heating.primaryCircuit.sensors.temperature.supply']),
                secondarySupplyTemp: find(['heating.secondaryCircuit.sensors.temperature.supply']),
                bufferTemp: find(['heating.buffer.sensors.temperature.main', 'heating.bufferCylinder.sensors.temperature.main']),
                boilerTemp: find(['heating.boiler.sensors.temperature.commonSupply', 'heating.boiler.temperature.current', 'heating.boiler.temperature']),
                roomTemp: find(['heating.circuits.0.sensors.temperature.room']),
                circuitTemp: find(['heating.circuits.0.temperature']),

                // DHW
                dhwTemp: find(['heating.dhw.sensors.temperature.hotWaterStorage', 'heating.dhw.sensors.temperature.dhwCylinder']),
                dhwTarget: find(['heating.dhw.temperature.main']),
                dhwTarget2: find(['heating.dhw.temperature.temp2']),
                dhwStatus: find(['heating.dhw.operating.modes.active']),
                dhwHysteresis: find(['heating.dhw.temperature.hysteresis']),
                dhwHysteresisSwitchOn: findNested('heating.dhw.temperature.hysteresis', 'switchOnValue'),
                dhwHysteresisSwitchOff: findNested('heating.dhw.temperature.hysteresis', 'switchOffValue'),

                // Heating curve - these need to be fetched from circuits category
                heatingCurveSlope: findNested('heating.circuits.0.heating.curve', 'slope'),
                heatingCurveShift: findNested('heating.circuits.0.heating.curve', 'shift'),
                supplyTempMax: findNested('heating.circuits.0.temperature.levels', 'max'),
                supplyTempMin: findNested('heating.circuits.0.temperature.levels', 'min'),

                // Operating mode
                operatingMode: find(['heating.circuits.0.operating.modes.active']),
                operatingProgram: find(['heating.circuits.0.operating.programs.active']),

                // Compressor (heat pump - Vitocal)
                compressorActive: findNested('heating.compressors.0', 'active'),
                compressorSpeed: find(['heating.compressors.0.speed.current']),
                compressorPower: find(['heating.inverters.0.sensors.power.output']),
                compressorCurrent: find(['heating.inverters.0.sensors.power.current']),
                compressorInletTemp: find(['heating.compressors.0.sensors.temperature.inlet']),
                compressorOutletTemp: find(['heating.compressors.0.sensors.temperature.outlet']),
                compressorOilTemp: find(['heating.compressors.0.sensors.temperature.oil']),
                compressorMotorTemp: find(['heating.compressors.0.sensors.temperature.motorChamber']),
                compressorPressure: find(['heating.compressors.0.sensors.pressure.inlet']),

                // Noise reduction (heat pump - Vitocal)
                noiseReductionMode: find(['heating.noise.reduction.operating.programs.active']),

                // Also check if noise reduction feature exists (even without value)
                noiseReductionExists: (() => {
                    // Check in categories first
                    for (const category of [features.operatingModes, features.other]) {
                        if (category && category['heating.noise.reduction.operating.programs.active']) {
                            return true;
                        }
                    }
                    // Check in raw features as fallback
                    if (features.rawFeatures) {
                        return features.rawFeatures.some(f =>
                            f.feature === 'heating.noise.reduction.operating.programs.active'
                        );
                    }
                    return false;
                })(),

                // Burner (gas heating - Vitodens)
                burnerModulation: find(['heating.burners.0.modulation']),

                // Additional sensors
                volumetricFlow: find(['heating.sensors.volumetricFlow.allengra']),
                pressure: find(['heating.sensors.pressure.supply']),
                pumpInternal: find(['heating.boiler.pumps.internal.current']),
                fan0: find(['heating.primaryCircuit.fans.0.current']),
                fan1: find(['heating.primaryCircuit.fans.1.current']),

                // Efficiency
                // COP (Coefficient of Performance) features - primary source
                copTotal: find(['heating.cop.total']),
                copHeating: find(['heating.cop.heating']),
                copDhw: find(['heating.cop.dhw']),
                copCooling: find(['heating.cop.cooling']),
                // SCOP/SPF fallback if COP not available
                scop: find(['heating.scop.total', 'heating.spf.total']),
                scopHeating: find(['heating.scop.heating', 'heating.spf.heating']),
                scopDhw: find(['heating.scop.dhw', 'heating.spf.dhw']),
                seerCooling: find(['heating.seer.cooling']),

                // Valves and auxiliary systems
                fourWayValve: find(['heating.valves.fourThreeWay.position']),
                secondaryHeater: find(['heating.secondaryHeatGenerator.state', 'heating.secondaryHeatGenerator.status']),
                secondaryHeatGeneratorStatus: find(['heating.secondaryHeatGenerator.status']),
                fanRing: findNested('heating.heater.fanRing', 'active'),

                // Hybrid Pro Control features
                hybridElectricityPriceLow: find(['heating.secondaryHeatGenerator.electricity.price.low']),
                hybridElectricityPriceNormal: find(['heating.secondaryHeatGenerator.electricity.price.normal']),
                hybridHeatPumpEnergyFactor: find(['heating.secondaryHeatGenerator.electricity.energyFactor']),
                hybridFossilEnergyFactor: find(['heating.secondaryHeatGenerator.fossil.energyFactor']),
                hybridFossilPriceLow: find(['heating.secondaryHeatGenerator.fossil.price.low']),
                hybridFossilPriceNormal: find(['heating.secondaryHeatGenerator.fossil.price.normal']),
                hybridControlStrategy: find(['heating.secondaryHeatGenerator.control.strategy']),

                // Refrigerant circuit (heat pump specific)
                evaporatorTemp: find(['heating.evaporators.0.sensors.temperature.liquid']),
                evaporatorOverheat: find(['heating.evaporators.0.sensors.temperature.overheat']),
                condensorTemp: find(['heating.condensors.0.sensors.temperature.liquid']),
                economizerTemp: find(['heating.economizers.0.sensors.temperature.liquid']),
                inverterTemp: find(['heating.inverters.0.sensors.temperature.powerModule']),

                // Device information
                deviceSerial: find(['device.serial']),
                deviceType: find(['device.type']),
                deviceVariant: find(['device.variant', 'heating.device.variant']),

                // Compressor statistics (load classes)
                compressorStats0: find(['heating.compressors.0.statistics']),
                compressorStats1: find(['heating.compressors.1.statistics']),

                // SmartClimate / Zigbee device features
                // Device generic
                deviceName: find(['device.name']),
                deviceBattery: find(['device.power.battery']),
                zigbeeLqi: find(['device.zigbee.lqi']),
                deviceHumidity: find(['device.sensors.humidity']),
                deviceTemperature: find(['device.sensors.temperature']),

                // Thermostat (TRV) features
                trvTemperature: find(['trv.temperature']),
                trvValvePosition: find(['trv.valve.position']),
                trvChildLock: find(['trv.childLock']),
                trvMountingMode: find(['trv.mountingMode']),

                // Floor heating thermostat (FHT) features
                fhtOperatingMode: find(['fht.operating.modes.active']),
                fhtSupplyTemp: find(['fht.sensors.temperature.supply']),
                fhtHeatingActive: find(['fht.operating.modes.heating']),
                fhtCoolingActive: find(['fht.operating.modes.cooling']),
                fhtStandbyActive: find(['fht.operating.modes.standby']),

                // Consumption/Production Statistics (Arrays with history)
                // With includeDeviceFeatures=true, these features have day/week/month/year arrays
                powerConsumptionDhw: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.power.consumption.dhw');
                    return f || null;
                })(),
                powerConsumptionHeating: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.power.consumption.heating');
                    return f || null;
                })(),
                powerConsumptionTotal: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.power.consumption.total');
                    return f || null;
                })(),
                heatProductionDhw: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.heat.production.dhw');
                    return f || null;
                })(),
                heatProductionHeating: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.heat.production.heating');
                    return f || null;
                })(),
                // Keep summary features as fallback
                powerConsumptionSummaryDhw: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.power.consumption.summary.dhw');
                    return f || null;
                })(),
                powerConsumptionSummaryHeating: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.power.consumption.summary.heating');
                    return f || null;
                })(),
                heatProductionSummaryDhw: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.heat.production.summary.dhw');
                    return f || null;
                })(),
                heatProductionSummaryHeating: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.heat.production.summary.heating');
                    return f || null;
                })(),

                // Compressor-specific energy consumption/production (Vitocal)
                // Only available with includeDeviceFeatures=true
                compressorPowerConsumptionDhw: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.compressors.0.power.consumption.dhw.week');
                    return f || null;
                })(),
                compressorPowerConsumptionHeating: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.compressors.0.power.consumption.heating.week');
                    return f || null;
                })(),
                compressorHeatProductionDhw: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.compressors.0.heat.production.dhw.week');
                    return f || null;
                })(),
                compressorHeatProductionHeating: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.compressors.0.heat.production.heating.week');
                    return f || null;
                })(),
                compressorHeatProductionCooling: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.compressors.0.heat.production.cooling.week');
                    return f || null;
                })(),

            };
        }

        // Detect available heating circuits
        function detectHeatingCircuits(features) {
            if (features.circuits && features.circuits['heating.circuits']) {
                const heatingCircuits = features.circuits['heating.circuits'];

                if (heatingCircuits.value && heatingCircuits.value.enabled) {
                    let enabled = heatingCircuits.value.enabled;

                    // Handle nested structure: {type: 'array', value: [...]}
                    if (enabled.type === 'array' && enabled.value) {
                        enabled = enabled.value;
                    }

                    // Check if enabled is an array
                    if (Array.isArray(enabled)) {
                        console.log('Found enabled circuits array:', enabled);
                        return enabled.map(c => parseInt(c));
                    }

                    // Handle single value as string or number
                    if (typeof enabled === 'string' || typeof enabled === 'number') {
                        console.log('Found single circuit:', enabled);
                        return [parseInt(enabled)];
                    }
                }
            }

            // Fallback: search for heating.circuits.X features
            console.log('Fallback: searching for circuit features');
            const circuitNumbers = new Set();
            for (const category of [features.circuits, features.operatingModes, features.temperatures, features.dhw, features.other]) {
                if (category) {
                    for (const key of Object.keys(category)) {
                        const match = key.match(/^heating\.circuits\.(\d+)\./);
                        if (match) {
                            circuitNumbers.add(parseInt(match[1]));
                        }
                    }
                }
            }

            if (circuitNumbers.size > 0) {
                const circuits = Array.from(circuitNumbers).sort((a, b) => a - b);
                console.log('Found circuits from features:', circuits);
                return circuits;
            }

            // Ultimate fallback: assume circuit 0 exists
            console.log('No circuits found, defaulting to [0]');
            return [0];
        }

        function renderDeviceHeader(deviceInfo, kf) {
            // Prefer device.name feature over modelId/displayName
            let deviceTitle = deviceInfo.modelId || deviceInfo.displayName;
            if (kf.deviceName && kf.deviceName.value) {
                deviceTitle = kf.deviceName.value;
            }

            // Show settings button for heat pumps (devices with compressor)
            const hasCompressor = kf.compressorSpeed || kf.compressorActive || kf.compressorHours;
            const settingsButton = hasCompressor ? `
                <button onclick="openDeviceSettingsModal('${deviceInfo.installationId}', '${deviceInfo.deviceId}')"
                        style="margin-left: 10px; padding: 5px 10px; cursor: pointer;">
                    ⚙️ Einstellungen
                </button>
            ` : '';

            // Check if this is a hybrid system and show Hybrid Pro Control button
            const isHybrid = kf.secondaryHeatGeneratorStatus !== undefined;
            const hybridProControlButton = isHybrid ? `
                <button onclick="openHybridProControlModal('${deviceInfo.installationId}', '${deviceInfo.deviceId}', '${deviceInfo.gatewaySerial}')"
                        style="margin-left: 10px; padding: 5px 10px; cursor: pointer; background-color: #ff9800; color: white; border: none; border-radius: 4px;">
                    ☀️ Hybrid Pro Control
                </button>
            ` : '';

            // Build temperature grid
            let temps = '';
            if (kf.outsideTemp) {
                const formatted = formatValue(kf.outsideTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                temps += `
                    <div class="temp-item">
                        <span class="temp-label">Außentemperatur</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }
            if (kf.calculatedOutsideTemp) {
                const formatted = formatValue(kf.calculatedOutsideTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                temps += `
                    <div class="temp-item">
                        <span class="temp-label">Außentemp. (ged.)</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }
            if (kf.dhwTemp) {
                const formatted = formatValue(kf.dhwTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                temps += `
                    <div class="temp-item">
                        <span class="temp-label">Warmwasser</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }
            if (kf.supplyTemp) {
                const formatted = formatValue(kf.supplyTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                temps += `
                    <div class="temp-item">
                        <span class="temp-label">Gemeinsame Vorlauftemperatur</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }
            // Calculate and show heating curve target temperature
            if (kf.outsideTemp && kf.heatingCurveSlope && kf.heatingCurveShift) {
                const outsideTemp = kf.outsideTemp.value;
                const slope = kf.heatingCurveSlope.value;
                const shift = kf.heatingCurveShift.value;

                // Get room setpoint temperature (default: 20°C)
                let roomSetpoint = 20;
                if (window.heatingCurveData && window.heatingCurveData.roomTempSetpoint) {
                    roomSetpoint = window.heatingCurveData.roomTempSetpoint;
                }

                // Calculate target supply temperature using official Viessmann formula:
                // VT = RTSoll + Niveau - Neigung * DAR * (1.4347 + 0.021 * DAR + 247.9 * 10^-6 * DAR^2)
                // with DAR = AT - RTSoll
                const DAR = outsideTemp - roomSetpoint;
                let targetTemp = roomSetpoint + shift - slope * DAR * (1.4347 + 0.021 * DAR + 247.9 * 1e-6 * DAR * DAR);

                // Cap at max supply temperature if available
                const maxSupply = window.heatingCurveData && window.heatingCurveData.maxSupply;
                if (maxSupply !== null && maxSupply !== undefined && targetTemp > maxSupply) {
                    targetTemp = maxSupply;
                }

                temps += `
                    <div class="temp-item">
                        <span class="temp-label">Solltemperatur (Heizkurve)</span>
                        <div>
                            <span class="temp-value">${formatNum(targetTemp)}</span>
                            <span class="temp-unit">°C</span>
                        </div>
                    </div>
                `;
            }
            if (kf.returnTemp) {
                const formatted = formatValue(kf.returnTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                temps += `
                    <div class="temp-item">
                        <span class="temp-label">Rücklauftemperatur</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }
            // Calculate and show Spreizung (supply - return temperature difference)
            if (kf.supplyTemp && kf.returnTemp) {
                const supplyValue = kf.supplyTemp.value;
                const returnValue = kf.returnTemp.value;
                const spreizung = supplyValue - returnValue;
                temps += `
                    <div class="temp-item">
                        <span class="temp-label">Spreizung</span>
                        <div>
                            <span class="temp-value">${formatNum(spreizung)}</span>
                            <span class="temp-unit">K</span>
                        </div>
                    </div>
                `;
            }
            if (kf.boilerTemp) {
                const formatted = formatValue(kf.boilerTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                temps += `
                    <div class="temp-item">
                        <span class="temp-label">Kesseltemperatur</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }
            if (kf.bufferTemp) {
                const formatted = formatValue(kf.bufferTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                temps += `
                    <div class="temp-item">
                        <span class="temp-label">Puffertemperatur</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }
            if (kf.primarySupplyTemp) {
                const formatted = formatValue(kf.primarySupplyTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                // Determine label: check device settings first, then fall back to auto-detection
                let label = 'Primärkreis-Vorlauf'; // Default

                // Check if there's a device setting override
                const deviceKey = `${deviceInfo.installationId}_${deviceInfo.deviceId}`;
                const deviceSetting = window.deviceSettingsCache && window.deviceSettingsCache[deviceKey];

                if (deviceSetting && deviceSetting.useAirIntakeTemperatureLabel !== null && deviceSetting.useAirIntakeTemperatureLabel !== undefined) {
                    // Use the explicit setting from device settings
                    label = deviceSetting.useAirIntakeTemperatureLabel ? 'Lufteintritts-temperatur' : 'Primärkreis-Vorlauf';
                } else {
                    // Fall back to auto-detection based on compressor sensors
                    const isVitocal = kf.compressorActive || kf.compressorSpeed || kf.compressorInletTemp ||
                                     kf.compressorOutletTemp || kf.compressorOilTemp || kf.compressorMotorTemp ||
                                     kf.compressorPressure;
                    if (isVitocal) {
                        label = 'Lufteintritts-temperatur';
                    }
                }

                temps += `
                    <div class="temp-item">
                        <span class="temp-label">${label}</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }
            if (kf.secondarySupplyTemp) {
                const formatted = formatValue(kf.secondarySupplyTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                temps += `
                    <div class="temp-item">
                        <span class="temp-label">Sekundärkreis-Vorlauf</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="card wide">
                    <div class="card-header">
                        <h2>🔧 ${deviceTitle}</h2>
                        <div>
                            <span class="badge badge-info">Device ${deviceInfo.deviceId}</span>
                            ${settingsButton}
                            ${hybridProControlButton}
                        </div>
                    </div>
                    ${temps ? `<div class="temp-grid">${temps}</div>` : ''}
                </div>
            `;
        }

        function renderMainTemperatures(kf) {
            // Temperatures are now integrated into renderDeviceHeader
            return '';
        }

        function renderCompressorBurnerStatus(kf) {
            // Combined status card with all details
            const hasCompressor = kf.compressorSpeed || kf.compressorPower ||
                                  kf.compressorCurrent || kf.compressorPressure ||
                                  kf.compressorOilTemp || kf.compressorMotorTemp ||
                                  kf.compressorInletTemp || kf.compressorOutletTemp ||
                                  kf.compressorStats;
            const hasBurner = kf.burnerModulation;

            if (!hasCompressor && !hasBurner) return '';

            let content = '';
            let title = '';

            if (hasCompressor) {
                title = '⚙️ Verdichter';
                // Use compressorActive boolean if available, otherwise fall back to compressorSpeed
                const isRunning = kf.compressorActive ? kf.compressorActive.value : (kf.compressorSpeed && kf.compressorSpeed.value > 0);

                // Convert speed to RPM if unit is revolutionsPerSecond
                let speedValue = kf.compressorSpeed && kf.compressorSpeed.value !== undefined ? kf.compressorSpeed.value : 0;
                let speedUnit = kf.compressorSpeed && kf.compressorSpeed.value !== undefined ? kf.compressorSpeed.unit : '';

                if (speedUnit === 'revolutionsPerSecond') {
                    speedValue = speedValue * 60;
                    speedUnit = 'U/min';
                }

                // Extract compressor statistics (use compressorStats0 since it now holds the primary compressor data)
                let compressorHours = 0;
                let compressorStarts = 0;
                let avgRuntime = 0;

                // Try compressorStats0 first (new naming), then fall back to legacy compressorStats
                const statsObj = kf.compressorStats0 || kf.compressorStats;
                if (statsObj && statsObj.value) {
                    const stats = statsObj.value;
                    if (stats.hours && stats.hours.value !== undefined) {
                        compressorHours = stats.hours.value;
                    }
                    if (stats.starts && stats.starts.value !== undefined) {
                        compressorStarts = stats.starts.value;
                    }
                    if (compressorHours > 0 && compressorStarts > 0) {
                        avgRuntime = compressorHours / compressorStarts;
                    }
                }

                // Get device settings from cache for RPM percentage calculation
                const deviceInfo = window.currentDeviceInfo;
                let rpmPercentage = null;
                if (deviceInfo && window.deviceSettingsCache) {
                    const deviceKey = `${deviceInfo.installationId}_${deviceInfo.deviceId}`;
                    const settings = window.deviceSettingsCache[deviceKey];
                    if (settings && settings.max > settings.min && speedValue > 0) {
                        rpmPercentage = Math.round(((speedValue - settings.min) / (settings.max - settings.min)) * 100);
                        rpmPercentage = Math.max(0, Math.min(100, rpmPercentage));
                    }
                }

                content = `
                    <div class="status-item">
                        <span class="status-label">Status</span>
                        <span class="status-value">${isRunning ? '🟢 An' : '⚪ Aus'}</span>
                    </div>
                    ${kf.compressorSpeed ? `
                        <div class="status-item">
                            <span class="status-label">Drehzahl</span>
                            <span class="status-value">
                                ${speedValue !== 0 ? formatNum(speedValue) + ' ' + speedUnit : '--'}
                                ${rpmPercentage !== null ? `<span style="color: #10b981; margin-left: 8px;">(${rpmPercentage}%)</span>` : ''}
                            </span>
                        </div>
                    ` : ''}
                    ${kf.compressorPower ? `
                        <div class="status-item">
                            <span class="status-label">Leistung</span>
                            <span class="status-value">${isValidNumericValue(kf.compressorPower) ? formatValue(kf.compressorPower) : '--'}</span>
                        </div>
                    ` : ''}
                    ${kf.compressorCurrent ? `
                        <div class="status-item">
                            <span class="status-label">Stromaufnahme</span>
                            <span class="status-value">${isValidNumericValue(kf.compressorCurrent) ? formatValue(kf.compressorCurrent) : '--'}</span>
                        </div>
                    ` : ''}
                    ${kf.compressorPressure ? `
                        <div class="status-item">
                            <span class="status-label">Einlassdruck</span>
                            <span class="status-value">${isValidNumericValue(kf.compressorPressure) ? formatValue(kf.compressorPressure) : '--'}</span>
                        </div>
                    ` : ''}
                    ${kf.compressorOilTemp ? `
                        <div class="status-item">
                            <span class="status-label">Öltemperatur</span>
                            <span class="status-value">${isValidNumericValue(kf.compressorOilTemp) ? formatValue(kf.compressorOilTemp) : '--'}</span>
                        </div>
                    ` : ''}
                    ${kf.compressorMotorTemp ? `
                        <div class="status-item">
                            <span class="status-label">Motorraumtemperatur</span>
                            <span class="status-value">${isValidNumericValue(kf.compressorMotorTemp) ? formatValue(kf.compressorMotorTemp) : '--'}</span>
                        </div>
                    ` : ''}
                    ${kf.compressorInletTemp ? `
                        <div class="status-item">
                            <span class="status-label">Einlasstemperatur</span>
                            <span class="status-value">${isValidNumericValue(kf.compressorInletTemp) ? formatValue(kf.compressorInletTemp) : '--'}</span>
                        </div>
                    ` : ''}
                    ${kf.compressorOutletTemp ? `
                        <div class="status-item">
                            <span class="status-label">Auslasstemperatur</span>
                            <span class="status-value">${isValidNumericValue(kf.compressorOutletTemp) ? formatValue(kf.compressorOutletTemp) : '--'}</span>
                        </div>
                    ` : ''}
                    ${compressorHours > 0 ? `
                        <div class="status-item">
                            <span class="status-label">Betriebsstunden Verdichter</span>
                            <span class="status-value">${formatNum(compressorHours)} Std.</span>
                        </div>
                    ` : ''}
                    ${compressorStarts > 0 ? `
                        <div class="status-item">
                            <span class="status-label">Anzahl Verdichterstarts</span>
                            <span class="status-value">${compressorStarts}</span>
                        </div>
                    ` : ''}
                    ${avgRuntime > 0 ? `
                        <div class="status-item">
                            <span class="status-label">Durchschnittl. mittlere Laufzeit</span>
                            <span class="status-value">${formatNum(avgRuntime)} Std.</span>
                        </div>
                    ` : ''}
                    ${kf.fanRing ? `
                        <div class="status-item">
                            <span class="status-label">Ventilatorringheizung</span>
                            <span class="status-value">
                                <button id="fanRingToggle" class="toggle-btn ${kf.fanRing.value ? 'active' : ''}"
                                    data-current="${kf.fanRing.value ? 'true' : 'false'}"
                                    onclick="toggleFanRing(event)">
                                    ${kf.fanRing.value ? '🟢 An' : '⚪ Aus'}
                                </button>
                            </span>
                        </div>
                    ` : ''}
                `;
            } else if (hasBurner) {
                title = '🔥 Brenner';
                const modulation = kf.burnerModulation ? kf.burnerModulation.value : 0;
                const isRunning = modulation > 0;

                content = `
                    <div class="status-item">
                        <span class="status-label">Status</span>
                        <span class="status-value">${isRunning ? '🟢 An' : '⚪ Aus'}</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Modulation</span>
                        <span class="status-value">${formatValue(kf.burnerModulation)}</span>
                    </div>
                `;
            }

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>${title}</h2>
                    </div>
                    <div class="status-list">
                        ${content}
                    </div>
                </div>
            `;
        }

        // Render heating circuit card for a specific circuit
        function renderHeatingCircuitCard(features, circuitId, deviceInfo) {
            const circuitPrefix = `heating.circuits.${circuitId}`;
            console.log(`🔄 renderHeatingCircuitCard called for circuit ${circuitId} (prefix: ${circuitPrefix})`);

            // Extract circuit-specific features
            const find = (exactNames) => {
                if (!Array.isArray(exactNames)) exactNames = [exactNames];
                for (const exactName of exactNames) {
                    for (const category of [features.temperatures, features.circuits, features.operatingModes, features.dhw, features.other]) {
                        if (category && category[exactName]) {
                            const feature = category[exactName];
                            // Handle both simple values and Objects with properties/value
                            if (feature.type === 'object') {
                                // For objects, try to extract the actual value from properties or value
                                const container = feature.value || feature.properties;
                                if (container && typeof container === 'object') {
                                    // Look for a "value" property that has an actual numeric value
                                    if (container.value && container.value.value !== undefined) {
                                        return container.value; // Return the value object
                                    }
                                    // Or return the container itself if it has a direct value
                                    if (container.value !== undefined && typeof container.value === 'number') {
                                        return { value: container.value, type: feature.type, unit: feature.unit };
                                    }
                                }
                            } else if (feature.value !== null && feature.value !== undefined) {
                                return feature;
                            }
                        }
                    }
                }
                return null;
            };

            const findNested = (featureName, propertyName) => {
                for (const category of [features.circuits, features.operatingModes, features.temperatures, features.dhw, features.other]) {
                    if (category && category[featureName]) {
                        const feature = category[featureName];
                        if (feature.type === 'object') {
                            // Support both "value" and "properties" formats
                            const container = feature.value || feature.properties;
                            if (container && typeof container === 'object') {
                                const nestedValue = container[propertyName];
                                if (nestedValue && nestedValue.value !== undefined) {
                                    return {
                                        type: nestedValue.type || 'number',
                                        value: nestedValue.value,
                                        unit: nestedValue.unit || ''
                                    };
                                }
                            }
                        }
                    }
                }
                return null;
            };

            const circuitName = find([`${circuitPrefix}.name`]);
            const operatingMode = find([`${circuitPrefix}.operating.modes.active`]);
            const operatingProgram = find([`${circuitPrefix}.operating.programs.active`]);
            const circuitTemp = find([`${circuitPrefix}.sensors.temperature.supply`]);
            const roomTemp = find([`${circuitPrefix}.sensors.temperature.room`]);
            const heatingCurveSlope = findNested(`${circuitPrefix}.heating.curve`, 'slope');
            const heatingCurveShift = findNested(`${circuitPrefix}.heating.curve`, 'shift');
            const supplyTempMax = findNested(`${circuitPrefix}.temperature.levels`, 'max');
            console.log(`  └─ Heating curve data - slope: ${heatingCurveSlope}, shift: ${heatingCurveShift}, supplyTempMax: ${supplyTempMax}`);

            // Get program temperatures (normal, comfort, reduced) - these are nested properties
            const normalTemp = findNested(`${circuitPrefix}.operating.programs.normal`, 'temperature');
            const normalHeatingTemp = findNested(`${circuitPrefix}.operating.programs.normalHeating`, 'temperature');
            const comfortTemp = findNested(`${circuitPrefix}.operating.programs.comfort`, 'temperature');
            const comfortHeatingTemp = findNested(`${circuitPrefix}.operating.programs.comfortHeating`, 'temperature');
            const reducedTemp = findNested(`${circuitPrefix}.operating.programs.reduced`, 'temperature');
            const reducedHeatingTemp = findNested(`${circuitPrefix}.operating.programs.reducedHeating`, 'temperature');

            // Check if circuit has any relevant data
            if (!operatingMode && !operatingProgram && !circuitTemp && !heatingCurveSlope && !supplyTempMax) {
                return '';
            }

            // Get circuit name (handle nested structure)
            // Display circuit number starting from 1 (circuitId 0 = Heizkreis 1)
            let displayName = `Heizkreis ${circuitId + 1}`;
            if (circuitName && circuitName.value) {
                let nameValue = circuitName.value;
                if (nameValue.name && typeof nameValue.name === 'object') {
                    if (nameValue.name.value) {
                        nameValue = nameValue.name.value;
                    }
                }
                if (typeof nameValue === 'string') {
                    displayName = nameValue;
                }
            }

            // Program name translations
            const programNames = {
                'normal': 'Normal',
                'normalHeating': 'Normal (Heizen)',
                'normalCooling': 'Normal (Kühlen)',
                'normalEnergySaving': 'Normal (Energiesparen)',
                'normalCoolingEnergySaving': 'Normal (Kühlen, Energiesparen)',
                'comfort': 'Komfort',
                'comfortHeating': 'Komfort (Heizen)',
                'comfortCooling': 'Komfort (Kühlen)',
                'comfortEnergySaving': 'Komfort (Energiesparen)',
                'comfortCoolingEnergySaving': 'Komfort (Kühlen, Energiesparen)',
                'reduced': 'Reduziert',
                'reducedHeating': 'Reduziert (Heizen)',
                'reducedCooling': 'Reduziert (Kühlen)',
                'reducedEnergySaving': 'Reduziert (Energiesparen)',
                'reducedCoolingEnergySaving': 'Reduziert (Kühlen, Energiesparen)',
                'eco': 'Eco',
                'fixed': 'Fest',
                'standby': 'Standby',
                'frostprotection': 'Frostschutz',
                'forcedLastFromSchedule': 'Zeitprogramm',
            };

            // Mode translations
            const modeNames = {
                'heating': 'Heizen',
                'standby': 'Standby',
                'cooling': 'Kühlen',
                'heatingCooling': 'Heizen/Kühlen',
                'dhw': 'Warmwasser',
                'dhwAndHeating': 'Warmwasser und Heizen',
                'forcedReduced': 'Reduziert (Erzwungen)',
                'forcedNormal': 'Normal (Erzwungen)',
            };

            const currentMode = operatingMode ? operatingMode.value : '';
            const currentProgram = operatingProgram ? operatingProgram.value : '';
            const programDisplay = programNames[currentProgram] || currentProgram;
            const modeDisplay = modeNames[currentMode] || currentMode;

            let html = `
                <div class="card wide">
                    <div class="card-header">
                        <h2>🏠 ${displayName}</h2>
                    </div>
                    <div class="status-list">
            `;

            // Operating mode with dropdown
            if (operatingMode) {
                // Dynamically detect available modes by checking which features exist
                const availableModes = ['heating', 'standby'];
                if (find([`${circuitPrefix}.operating.modes.dhwAndHeating`])) {
                    availableModes.push('dhwAndHeating');
                }
                if (find([`${circuitPrefix}.operating.modes.cooling`])) {
                    availableModes.push('cooling');
                }
                if (find([`${circuitPrefix}.operating.modes.heatingCooling`])) {
                    availableModes.push('heatingCooling');
                }

                html += `
                    <div class="status-item">
                        <span class="status-label">Betriebsart</span>
                        <span class="status-value">
                            <select onchange="changeHeatingMode(${circuitId}, this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                `;
                for (const mode of availableModes) {
                    const selected = mode === currentMode ? 'selected' : '';
                    html += `<option value="${mode}" ${selected}>${modeNames[mode] || mode}</option>`;
                }
                html += `
                            </select>
                        </span>
                    </div>
                `;
            }

            // Active program
            if (operatingProgram) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Aktives Programm</span>
                        <span class="status-value">${programDisplay}</span>
                    </div>
                `;
            }

            // Room temperature setpoints - simplified to 3 main programs
            // Priority: Use heating variant if both exist
            const reducedProg = reducedHeatingTemp || reducedTemp;
            const reducedApiName = reducedHeatingTemp ? 'reducedHeating' : 'reduced';
            const normalProg = normalHeatingTemp || normalTemp;
            const normalApiName = normalHeatingTemp ? 'normalHeating' : 'normal';
            const comfortProg = comfortHeatingTemp || comfortTemp;
            const comfortApiName = comfortHeatingTemp ? 'comfortHeating' : 'comfort';

            console.log(`Circuit ${circuitId} room temps:`, {
                reducedTemp: reducedTemp?.value,
                reducedHeatingTemp: reducedHeatingTemp?.value,
                normalTemp: normalTemp?.value,
                normalHeatingTemp: normalHeatingTemp?.value,
                comfortTemp: comfortTemp?.value,
                comfortHeatingTemp: comfortHeatingTemp?.value
            });

            if (reducedProg) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Raumtemperatur Reduziert</span>
                        <span class="status-value">
                            <select onchange="changeRoomTemp(${circuitId}, '${reducedApiName}', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                `;
                for (let temp = 10; temp <= 30; temp++) {
                    const selected = Math.round(reducedProg.value) === temp ? 'selected' : '';
                    html += `<option value="${temp}" ${selected}>${temp}°C</option>`;
                }
                html += `
                            </select>
                        </span>
                    </div>
                `;
            }

            if (normalProg) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Raumtemperatur Normal</span>
                        <span class="status-value">
                            <select onchange="changeRoomTemp(${circuitId}, '${normalApiName}', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                `;
                for (let temp = 10; temp <= 30; temp++) {
                    const selected = Math.round(normalProg.value) === temp ? 'selected' : '';
                    html += `<option value="${temp}" ${selected}>${temp}°C</option>`;
                }
                html += `
                            </select>
                        </span>
                    </div>
                `;
            }

            if (comfortProg) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Raumtemperatur Komfort</span>
                        <span class="status-value">
                            <select onchange="changeRoomTemp(${circuitId}, '${comfortApiName}', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                `;
                for (let temp = 10; temp <= 30; temp++) {
                    const selected = Math.round(comfortProg.value) === temp ? 'selected' : '';
                    html += `<option value="${temp}" ${selected}>${temp}°C</option>`;
                }
                html += `
                            </select>
                        </span>
                    </div>
                `;
            }

            // Circuit temperature
            if (circuitTemp) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Vorlauftemperatur</span>
                        <span class="status-value">${formatValue(circuitTemp)}</span>
                    </div>
                `;
            }

            // Room temperature sensor
            if (roomTemp) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Raumtemperatur (Ist)</span>
                        <span class="status-value">${formatValue(roomTemp)}</span>
                    </div>
                `;
            }

            // Humidity dewpoint sensor (for cooling systems)
            const humidityDewpoint = find([`${circuitPrefix}.sensors.humidity.dewpoint`]);
            if (humidityDewpoint) {
                let statusText = '';
                let statusClass = '';

                // Check if it's a nested object with properties
                if (typeof humidityDewpoint.value === 'object' && humidityDewpoint.value !== null) {
                    const statusProp = humidityDewpoint.value.status;
                    const valueProp = humidityDewpoint.value.value;

                    if (statusProp && statusProp.value) {
                        statusText = statusProp.value === 'connected' ? 'Verbunden' : 'Nicht verbunden';
                        statusClass = statusProp.value === 'connected' ? 'sensor-connected' : 'sensor-disconnected';
                    }

                    if (valueProp && valueProp.value) {
                        const valueText = valueProp.value === 'on' ? 'EIN' : 'AUS';
                        statusText += ` (${valueText})`;
                        if (valueProp.value === 'on') {
                            statusClass = 'sensor-active';
                        }
                    }
                } else if (humidityDewpoint.value !== null && humidityDewpoint.value !== undefined) {
                    // Direct value (e.g., "on" or "off")
                    const valueText = humidityDewpoint.value === 'on' ? 'EIN' : 'AUS';
                    statusText = valueText;
                    statusClass = humidityDewpoint.value === 'on' ? 'sensor-active' : 'sensor-disconnected';
                }

                if (statusText) {
                    html += `
                        <div class="status-item">
                            <span class="status-label">Feuchteanbauschalter</span>
                            <span class="status-value ${statusClass}">${statusText}</span>
                        </div>
                    `;
                }
            }

            // Heating curve with editable dropdowns
            if (heatingCurveSlope) {
                // Generate slope options from 0.2 to 3.5 in 0.1 steps
                const slopeOptions = [];
                for (let i = 2; i <= 35; i++) {
                    const val = i / 10;
                    const selected = Math.abs(heatingCurveSlope.value - val) < 0.01 ? 'selected' : '';
                    slopeOptions.push(`<option value="${val}" ${selected}>${val}</option>`);
                }
                html += `
                    <div class="status-item">
                        <span class="status-label">Heizkurve Neigung</span>
                        <span class="status-value">
                            <select onchange="changeHeatingCurve(${circuitId}, 'slope', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                                ${slopeOptions.join('')}
                            </select>
                        </span>
                    </div>
                `;
            }

            if (heatingCurveShift) {
                // Generate shift options from -13 to 40 in 1 step
                const shiftOptions = [];
                for (let i = -13; i <= 40; i++) {
                    const selected = heatingCurveShift.value === i ? 'selected' : '';
                    shiftOptions.push(`<option value="${i}" ${selected}>${i}</option>`);
                }
                html += `
                    <div class="status-item">
                        <span class="status-label">Heizkurve Niveau</span>
                        <span class="status-value">
                            <select onchange="changeHeatingCurve(${circuitId}, 'shift', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                                ${shiftOptions.join('')}
                            </select>
                        </span>
                    </div>
                `;
            }

            // Supply temperature limit
            if (supplyTempMax) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Vorlauftemperaturbegrenzung (max)</span>
                        <span class="status-value">
                            <select onchange="changeSupplyTempMax(${circuitId}, this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                `;
                for (let i = 10; i <= 90; i++) {
                    const selected = Math.round(supplyTempMax.value) === i ? 'selected' : '';
                    html += `<option value="${i}" ${selected}>${i}°C</option>`;
                }
                html += `
                            </select>
                        </span>
                    </div>
                `;
            }

            html += `
                    </div>
            `;

            // Add heating curve chart for circuits with heating curve data
            if (heatingCurveSlope || heatingCurveShift) {
                html += `
                    <div id="heatingCurveChart_${circuitId}" style="width: 100%; height: 400px; margin-top: 15px;"></div>
                `;
            }

            html += `
                </div>
            `;

            return html;
        }

        function renderHotWater(kf) {
            if (!kf.dhwTemp && !kf.dhwTarget && !kf.dhwStatus) return '';

            // Map API modes to user-friendly labels and vice versa
            const modeMapping = {
                'eco': 'Eco',
                'efficient': 'Eco',
                'efficientWithMinComfort': 'Eco',
                'comfort': 'Komfort',
                'off': 'Aus'
            };

            // Get current mode and convert to display mode
            const currentApiMode = kf.dhwStatus ? kf.dhwStatus.value : '';
            const currentDisplayMode = modeMapping[currentApiMode] || currentApiMode;

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>💧 Warmwasser</h2>
                    </div>
                    <div class="status-list">
                        ${kf.dhwStatus ? `
            <div class="status-item">
                <span class="status-label">Betriebsart</span>
                <span class="status-value">
                    <select id="dhwModeSelect" onchange="changeDhwMode(this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                        <option value="efficient" ${currentApiMode === 'efficient' ? 'selected' : ''}>Eco</option>
                        <option value="efficientWithMinComfort" ${currentApiMode === 'efficientWithMinComfort' ? 'selected' : ''}>Komfort</option>
                        <option value="off" ${currentApiMode === 'off' ? 'selected' : ''}>Aus</option>
                    </select>
                </span>
            </div>
                        ` : ''}
                        ${kf.dhwTemp ? `
            <div class="status-item">
                <span class="status-label">Ist-Temperatur</span>
                <span class="status-value">${formatValue(kf.dhwTemp)}</span>
            </div>
                        ` : ''}
                        ${kf.dhwTarget ? `
            <div class="status-item">
                <span class="status-label">Soll-Temperatur</span>
                <span class="status-value">
                    <select id="dhwTargetSelect" onchange="changeDhwTemperature(this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                        ${Array.from({length: 51}, (_, i) => i + 10).map(temp => `
                            <option value="${temp}" ${Math.round(kf.dhwTarget.value) === temp ? 'selected' : ''}>${temp}°C</option>
                        `).join('')}
                    </select>
                </span>
            </div>
                        ` : ''}
                        ${kf.dhwTarget2 ? `
            <div class="status-item">
                <span class="status-label">Soll-Temperatur 2</span>
                <span class="status-value">
                    <select id="dhwTarget2Select" onchange="changeDhwTemperature2(this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                        ${Array.from({length: 51}, (_, i) => i + 10).map(temp => `
                            <option value="${temp}" ${Math.round(kf.dhwTarget2.value) === temp ? 'selected' : ''}>${temp}°C</option>
                        `).join('')}
                    </select>
                </span>
            </div>
                        ` : ''}
                        ${kf.dhwHysteresisSwitchOn ? `
            <div class="status-item">
                <span class="status-label">Hysterese Ein</span>
                <span class="status-value">
                    <select id="dhwHysteresisOnSelect" onchange="changeDhwHysteresis('on', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                        ${Array.from({length: 19}, (_, i) => 1 + (i * 0.5)).map(val => `
                            <option value="${val}" ${kf.dhwHysteresisSwitchOn.value === val ? 'selected' : ''}>${val}K</option>
                        `).join('')}
                    </select>
                </span>
            </div>
                        ` : ''}
                        ${kf.dhwHysteresisSwitchOff ? `
            <div class="status-item">
                <span class="status-label">Hysterese Aus</span>
                <span class="status-value">
                    <select id="dhwHysteresisOffSelect" onchange="changeDhwHysteresis('off', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                        <option value="0" ${kf.dhwHysteresisSwitchOff.value === 0 ? 'selected' : ''}>0K</option>
                        <option value="0.5" ${kf.dhwHysteresisSwitchOff.value === 0.5 ? 'selected' : ''}>0.5K</option>
                        <option value="1" ${kf.dhwHysteresisSwitchOff.value === 1 ? 'selected' : ''}>1K</option>
                        <option value="1.5" ${kf.dhwHysteresisSwitchOff.value === 1.5 ? 'selected' : ''}>1.5K</option>
                        <option value="2" ${kf.dhwHysteresisSwitchOff.value === 2 ? 'selected' : ''}>2K</option>
                        <option value="2.5" ${kf.dhwHysteresisSwitchOff.value === 2.5 ? 'selected' : ''}>2.5K</option>
                    </select>
                </span>
            </div>
                        ` : ''}
                    </div>
                    <div style="margin-top: 15px; padding: 0 15px 15px 15px;">
                        <button onclick="startOneTimeCharge()" style="width: 100%; padding: 10px; background: rgba(59, 130, 246, 0.8); color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 14px;">
                            🔥 Einmalige Warmwassererwärmung starten
                        </button>
                    </div>
                </div>
            `;
        }

        function renderHeatingCurve(kf) {
            console.log('🔍 renderHeatingCurve called');
            console.log('heatingCurveSlope:', kf.heatingCurveSlope);
            console.log('heatingCurveShift:', kf.heatingCurveShift);

            if (!kf.heatingCurveSlope && !kf.heatingCurveShift) {
                console.warn('⚠️ No heating curve data available');
                return '';
            }

            const slope = kf.heatingCurveSlope ? kf.heatingCurveSlope.value : 1.0;
            const shift = kf.heatingCurveShift ? kf.heatingCurveShift.value : 0;

            console.log('✅ Heating curve values - slope:', slope, 'shift:', shift);
            const currentOutsideTemp = kf.outsideTemp ? kf.outsideTemp.value : null;
            const currentSupplyTemp = kf.supplyTemp ? kf.supplyTemp.value : null;
            const maxSupplyTemp = kf.supplyTempMax ? kf.supplyTempMax.value : null;
            const minSupplyTemp = kf.supplyTempMin ? kf.supplyTempMin.value : null;

            let settings = '';
            if (kf.heatingCurveSlope) {
                // Generate slope options from 0.2 to 3.5 in 0.1 steps
                const slopeOptions = [];
                for (let i = 2; i <= 35; i++) {
                    const val = i / 10;
                    slopeOptions.push(`<option value="${val}" ${Math.abs(kf.heatingCurveSlope.value - val) < 0.01 ? 'selected' : ''}>${val}</option>`);
                }
                settings += `
                    <div class="status-item">
                        <span class="status-label">Neigung</span>
                        <span class="status-value">
                            <select id="heatingCurveSlopeSelect" onchange="changeHeatingCurve('slope', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                                ${slopeOptions.join('')}
                            </select>
                        </span>
                    </div>
                `;
            }
            if (kf.heatingCurveShift) {
                // Generate shift options from -13 to 40 in 1 step
                const shiftOptions = [];
                for (let i = -13; i <= 40; i++) {
                    shiftOptions.push(`<option value="${i}" ${kf.heatingCurveShift.value === i ? 'selected' : ''}>${i}</option>`);
                }
                settings += `
                    <div class="status-item">
                        <span class="status-label">Niveau (Verschiebung)</span>
                        <span class="status-value">
                            <select id="heatingCurveShiftSelect" onchange="changeHeatingCurve('shift', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                                ${shiftOptions.join('')}
                            </select>
                        </span>
                    </div>
                `;
            }
            if (kf.supplyTempMax) {
                // Generate max temp options from 10 to 70 in 1°C steps
                const maxTempOptions = [];
                for (let i = 10; i <= 70; i++) {
                    maxTempOptions.push(`<option value="${i}" ${Math.round(kf.supplyTempMax.value) === i ? 'selected' : ''}>${i}°C</option>`);
                }
                settings += `
                    <div class="status-item">
                        <span class="status-label">Vorlauftemperaturbegrenzung (max)</span>
                        <span class="status-value">
                            <select id="supplyTempMaxSelect" onchange="changeSupplyTempMax(this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                                ${maxTempOptions.join('')}
                            </select>
                        </span>
                    </div>
                `;
            }
            if (kf.supplyTempMin) {
                settings += `
                    <div class="status-item">
                        <span class="status-label">Vorlauftemperatur (min)</span>
                        <span class="status-value">${formatValue(kf.supplyTempMin)}</span>
                    </div>
                `;
            }

            return `
                <div class="card wide">
                    <div class="card-header">
                        <h2>📐 Heizkurve</h2>
                    </div>
                    <div class="status-list" style="margin-bottom: 15px;">
                        ${settings}
                    </div>
                    <div id="heatingCurveChart" style="width: 100%; height: 400px;"></div>
                </div>
            `;
        }

        function renderHeatingCurveChart(circuitId) {
            console.log('📈 Starting to render heating curve chart for circuit', circuitId);

            const chartId = 'heatingCurveChart_' + circuitId;
            const chartElement = document.getElementById(chartId);

            if (!chartElement) {
                console.error('❌ Chart element not found:', chartId);
                return;
            }

            // Check if D3 is loaded
            if (typeof d3 === 'undefined') {
                console.error('❌ D3.js is not loaded');
                chartElement.innerHTML = '<div style="color: #ef4444; padding: 20px; text-align: center;">D3.js konnte nicht geladen werden.</div>';
                return;
            }
            console.log('✅ D3.js is loaded, version:', d3.version);

            const data = window.heatingCurveData && window.heatingCurveData[circuitId];
            if (!data) {
                console.error('❌ No heating curve data available for circuit', circuitId);
                return;
            }

            const {slope, shift, currentOutside, currentSupply, maxSupply, minSupply, roomTempSetpoint} = data;
            console.log('Chart parameters:', {slope, shift, currentOutside, currentSupply, maxSupply, minSupply, roomTempSetpoint});

            // Clear any existing content
            chartElement.innerHTML = '';

            // Calculate heating curve using official Viessmann formula:
            // VT = RTSoll + Niveau - Neigung * DAR * (1.4347 + 0.021 * DAR + 247.9 * 10^-6 * DAR^2)
            // with DAR = AT - RTSoll
            function calculateSupplyTemp(outsideTemp) {
                const RTSoll = roomTempSetpoint || 20;  // Use room temp from active program, fallback to 20
                const DAR = outsideTemp - RTSoll;
                let VT = RTSoll + shift - slope * DAR * (1.4347 + 0.021 * DAR + 247.9 * 1e-6 * DAR * DAR);

                // Cap at max supply temperature (Viessmann behavior)
                if (maxSupply !== null && VT > maxSupply) {
                    VT = maxSupply;
                }

                return VT;
            }

            // Setup dimensions
            const margin = {top: 20, right: 30, bottom: 50, left: 60};
            const width = chartElement.clientWidth - margin.left - margin.right;
            const height = 400 - margin.top - margin.bottom;

            console.log(`📏 Chart dimensions for circuit ${circuitId}: clientWidth=${chartElement.clientWidth}, width=${width}, height=${height}`);

            // Create SVG
            const svg = d3.select('#' + chartId)
                .append('svg')
                .attr('width', width + margin.left + margin.right)
                .attr('height', height + margin.top + margin.bottom)
                .append('g')
                .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            // Scales (X-axis reversed: 20°C left, -30°C right)
            const xScale = d3.scaleLinear()
                .domain([20, -30])
                .range([0, width]);

            const yScale = d3.scaleLinear()
                .domain([20, 70])
                .range([height, 0]);

            // Grid lines
            svg.append('g')
                .attr('class', 'grid')
                .attr('opacity', 0.1)
                .call(d3.axisLeft(yScale)
                    .tickSize(-width)
                    .tickFormat(''));

            svg.append('g')
                .attr('class', 'grid')
                .attr('opacity', 0.1)
                .attr('transform', 'translate(0,' + height + ')')
                .call(d3.axisBottom(xScale)
                    .tickSize(-height)
                    .tickFormat(''));

            // Generate curve data
            const curveData = [];
            for (let temp = -30; temp <= 20; temp += 0.5) {
                curveData.push({
                    outside: temp,
                    supply: calculateSupplyTemp(temp)
                });
            }

            // Line generator
            const line = d3.line()
                .x(d => xScale(d.outside))
                .y(d => yScale(d.supply))
                .curve(d3.curveMonotoneX);

            // Draw the curve
            svg.append('path')
                .datum(curveData)
                .attr('fill', 'none')
                .attr('stroke', '#667eea')
                .attr('stroke-width', 3)
                .attr('d', line);

            // Draw max supply temp reference line
            if (maxSupply !== null) {
                svg.append('line')
                    .attr('x1', 0)
                    .attr('x2', width)
                    .attr('y1', yScale(maxSupply))
                    .attr('y2', yScale(maxSupply))
                    .attr('stroke', '#ef4444')
                    .attr('stroke-width', 2)
                    .attr('stroke-dasharray', '5,5')
                    .attr('opacity', 0.7);

                svg.append('text')
                    .attr('x', width - 5)
                    .attr('y', yScale(maxSupply) - 5)
                    .attr('text-anchor', 'end')
                    .attr('fill', '#ef4444')
                    .attr('font-size', '11px')
                    .attr('font-weight', 'bold')
                    .text('Max: ' + maxSupply + '°C');
            }

            // Draw min supply temp reference line
            if (minSupply !== null) {
                svg.append('line')
                    .attr('x1', 0)
                    .attr('x2', width)
                    .attr('y1', yScale(minSupply))
                    .attr('y2', yScale(minSupply))
                    .attr('stroke', '#3b82f6')
                    .attr('stroke-width', 2)
                    .attr('stroke-dasharray', '5,5')
                    .attr('opacity', 0.7);

                svg.append('text')
                    .attr('x', width - 5)
                    .attr('y', yScale(minSupply) + 15)
                    .attr('text-anchor', 'end')
                    .attr('fill', '#3b82f6')
                    .attr('font-size', '11px')
                    .attr('font-weight', 'bold')
                    .text('Min: ' + minSupply + '°C');
            }

            // Draw current point if available
            if (currentOutside !== null && currentSupply !== null) {
                svg.append('circle')
                    .attr('cx', xScale(currentOutside))
                    .attr('cy', yScale(currentSupply))
                    .attr('r', 6)
                    .attr('fill', '#f59e0b')
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 2);

                svg.append('text')
                    .attr('x', xScale(currentOutside) + 10)
                    .attr('y', yScale(currentSupply) - 10)
                    .attr('fill', '#f59e0b')
                    .attr('font-size', '12px')
                    .attr('font-weight', 'bold')
                    .text('Aktuell: ' + currentOutside.toFixed(1) + '°C / ' + currentSupply.toFixed(1) + '°C');
            }

            // X-Axis
            svg.append('g')
                .attr('transform', 'translate(0,' + height + ')')
                .call(d3.axisBottom(xScale).ticks(10))
                .attr('color', '#a0a0b0');

            svg.append('text')
                .attr('x', width / 2)
                .attr('y', height + 40)
                .attr('text-anchor', 'middle')
                .attr('fill', '#e0e0e0')
                .attr('font-size', '14px')
                .text('Außentemperatur (°C)');

            // Y-Axis
            svg.append('g')
                .call(d3.axisLeft(yScale).ticks(10))
                .attr('color', '#a0a0b0');

            svg.append('text')
                .attr('transform', 'rotate(-90)')
                .attr('x', -height / 2)
                .attr('y', -45)
                .attr('text-anchor', 'middle')
                .attr('fill', '#e0e0e0')
                .attr('font-size', '14px')
                .text('Vorlauftemperatur (°C)');

            // Formula text - Viessmann official formula (simplified display)
            const RTSoll = roomTempSetpoint || 20;
            const shiftText = shift >= 0 ? '+ ' + shift : '- ' + Math.abs(shift);
            svg.append('text')
                .attr('x', 10)
                .attr('y', 15)
                .attr('fill', '#667eea')
                .attr('font-size', '11px')
                .attr('font-family', 'monospace')
                .text('VL = ' + RTSoll + ' ' + shiftText + ' - ' + slope.toFixed(1) + ' × DAR × (1.4347 + 0.021×DAR + 247.9×10⁻⁶×DAR²)   mit DAR = AT - ' + RTSoll);

            // Add hover functionality
            // Create tooltip
            const tooltip = d3.select('body')
                .append('div')
                .style('position', 'absolute')
                .style('background', 'rgba(0, 0, 0, 0.8)')
                .style('color', '#fff')
                .style('padding', '8px 12px')
                .style('border-radius', '4px')
                .style('font-size', '12px')
                .style('pointer-events', 'none')
                .style('opacity', 0)
                .style('z-index', 1000);

            // Create hover line and circle
            const hoverLine = svg.append('line')
                .attr('stroke', '#667eea')
                .attr('stroke-width', 1)
                .attr('stroke-dasharray', '3,3')
                .style('opacity', 0);

            const hoverCircle = svg.append('circle')
                .attr('r', 5)
                .attr('fill', '#667eea')
                .attr('stroke', '#fff')
                .attr('stroke-width', 2)
                .style('opacity', 0);

            // Invisible overlay to capture mouse events
            svg.append('rect')
                .attr('width', width)
                .attr('height', height)
                .style('fill', 'none')
                .style('pointer-events', 'all')
                .on('mousemove', function(event) {
                    const [mouseX] = d3.pointer(event);
                    const outsideTemp = xScale.invert(mouseX);
                    const supplyTemp = calculateSupplyTemp(outsideTemp);

                    // Update hover elements
                    hoverLine
                        .attr('x1', mouseX)
                        .attr('x2', mouseX)
                        .attr('y1', 0)
                        .attr('y2', height)
                        .style('opacity', 1);

                    hoverCircle
                        .attr('cx', xScale(outsideTemp))
                        .attr('cy', yScale(supplyTemp))
                        .style('opacity', 1);

                    // Update tooltip
                    tooltip
                        .style('opacity', 1)
                        .html(`
                            <strong>Außentemperatur:</strong> ${outsideTemp.toFixed(1)}°C<br>
                            <strong>Vorlauftemperatur:</strong> ${supplyTemp.toFixed(1)}°C
                        `)
                        .style('left', (event.pageX + 15) + 'px')
                        .style('top', (event.pageY - 15) + 'px');
                })
                .on('mouseout', function() {
                    hoverLine.style('opacity', 0);
                    hoverCircle.style('opacity', 0);
                    tooltip.style('opacity', 0);
                });

            console.log('✅ Heating curve chart rendered successfully');
        }

        function renderConsumption(kf) {
            let consumption = '';

            // Power consumption
            if (kf.powerConsumptionToday) {
                consumption += `
                    <div class="status-item">
                        <span class="status-label">Stromverbrauch heute</span>
                        <span class="status-value">${formatValue(kf.powerConsumptionToday)}</span>
                    </div>
                `;
            }
            if (kf.powerConsumptionHeatingToday) {
                consumption += `
                    <div class="status-item">
                        <span class="status-label">Heizung-Stromverbrauch heute</span>
                        <span class="status-value">${formatValue(kf.powerConsumptionHeatingToday)}</span>
                    </div>
                `;
            }
            if (kf.powerConsumptionDhwToday) {
                consumption += `
                    <div class="status-item">
                        <span class="status-label">WW-Stromverbrauch heute</span>
                        <span class="status-value">${formatValue(kf.powerConsumptionDhwToday)}</span>
                    </div>
                `;
            }

            // Gas consumption
            if (kf.gasConsumptionToday) {
                consumption += `
                    <div class="status-item">
                        <span class="status-label">Gasverbrauch heute</span>
                        <span class="status-value">${formatValue(kf.gasConsumptionToday)}</span>
                    </div>
                `;
            }
            if (kf.gasConsumptionHeatingToday) {
                consumption += `
                    <div class="status-item">
                        <span class="status-label">Heizung-Gasverbrauch heute</span>
                        <span class="status-value">${formatValue(kf.gasConsumptionHeatingToday)}</span>
                    </div>
                `;
            }
            if (kf.gasConsumptionDhwToday) {
                consumption += `
                    <div class="status-item">
                        <span class="status-label">WW-Gasverbrauch heute</span>
                        <span class="status-value">${formatValue(kf.gasConsumptionDhwToday)}</span>
                    </div>
                `;
            }

            if (!consumption) return '';

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>📊 Verbrauch heute</h2>
                    </div>
                    <div class="status-list">
                        ${consumption}
                    </div>
                </div>
            `;
        }

        function renderConsumptionStatistics(kf) {
            // Check for array-based features (with includeDeviceFeatures=true)
            const hasArrayFeatures = kf.powerConsumptionDhw || kf.powerConsumptionHeating ||
                                     kf.heatProductionDhw || kf.heatProductionHeating;

            // Fallback to summary features
            const hasSummaryFeatures = kf.powerConsumptionSummaryDhw || kf.powerConsumptionSummaryHeating;

            if (!hasArrayFeatures && !hasSummaryFeatures) return '';

            // Use array features if available (gives us historical data)
            if (hasArrayFeatures) {
                console.log('📊 Using array-based consumption statistics');
                return renderConsumptionStatisticsArrays(kf);
            } else {
                console.log('📊 Using summary-based consumption statistics (fallback)');
                return renderConsumptionStatisticsSummary(kf);
            }
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

            return html;
        }

        // Render Power Consumption Card with full array history
        // Power Consumption Card (Stromverbrauch) - separate Kachel
        function renderPowerConsumptionCard(kf, getArrayValue) {
            const getMonthName = (index) => {
                const now = new Date();
                const d = new Date(now.getFullYear(), now.getMonth() - index, 1);
                return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
            };
        
            const getWeekLabel = (index) => {
                const now = new Date();
                const d = new Date(now.getTime() - (index * 7 * 24 * 60 * 60 * 1000));
                const onejan = new Date(d.getFullYear(), 0, 1);
                const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
                return `KW ${week}`;
            };
        
            const getDayLabel = (index) => {
                const now = new Date();
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
                                    <span class="stat-label">📊 JAZ (${period.label})</span>
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

        function renderAdditionalSensors(kf) {
            let sensors = '';

            if (kf.volumetricFlow) {
                sensors += `
                    <div class="status-item">
                        <span class="status-label">Volumenstrom</span>
                        <span class="status-value">${formatNum(kf.volumetricFlow.value)} ${kf.volumetricFlow.unit || 'l/h'}</span>
                    </div>
                `;
            }

            if (kf.pressure) {
                sensors += `
                    <div class="status-item">
                        <span class="status-label">Druck</span>
                        <span class="status-value">${formatNum(kf.pressure.value)} ${kf.pressure.unit || 'bar'}</span>
                    </div>
                `;
            }

            if (kf.pumpInternal) {
                sensors += `
                    <div class="status-item">
                        <span class="status-label">Interne Pumpe</span>
                        <span class="status-value">${formatNum(kf.pumpInternal.value)} ${kf.pumpInternal.unit || '%'}</span>
                    </div>
                `;
            }

            if (kf.fan0) {
                sensors += `
                    <div class="status-item">
                        <span class="status-label">Lüfter 1</span>
                        <span class="status-value">${formatNum(kf.fan0.value)} ${kf.fan0.unit || '%'}</span>
                    </div>
                `;
            }

            if (kf.fan1) {
                sensors += `
                    <div class="status-item">
                        <span class="status-label">Lüfter 2</span>
                        <span class="status-value">${formatNum(kf.fan1.value)} ${kf.fan1.unit || '%'}</span>
                    </div>
                `;
            }

            // 4/3-Way Valve Position
            if (kf.fourWayValve) {
                const valveLabels = {
                    'domesticHotWater': 'Warmwasser',
                    'heating': 'Heizen',
                    'cooling': 'Kühlen',
                    'defrost': 'Abtauen',
                    'standby': 'Standby',
                    'off': 'Aus',
                    'climateCircuitOne': 'Heiz-/Kühlkreis 1',
                    'climatCircuitTwoDefrost': 'Integrierter Pufferspeicher'
                };
                const valveValue = kf.fourWayValve.value;
                const valveDisplay = valveLabels[valveValue] || valveValue;
                sensors += `
                    <div class="status-item">
                        <span class="status-label">4/3-Wege-Ventil</span>
                        <span class="status-value">${valveDisplay}</span>
                    </div>
                `;
            }

            // Secondary Heater
            if (kf.secondaryHeater) {
                const heaterStatus = kf.secondaryHeater.value;
                const isActive = heaterStatus !== 'off' && heaterStatus !== 'standby';
                sensors += `
                    <div class="status-item">
                        <span class="status-label">Zusatzheizung</span>
                        <span class="status-value">${isActive ? '🟢' : '⚪'} ${heaterStatus}</span>
                    </div>
                `;
            }

            // Noise Reduction (heat pump) - Read-only display
            if (kf.noiseReductionExists) {
                const currentApiMode = kf.noiseReductionMode ? kf.noiseReductionMode.value : 'notReduced';
                const modeLabels = {
                    'notReduced': 'Aus',
                    'slightlyReduced': 'Leicht reduziert',
                    'maxReduced': 'Maximal reduziert'
                };
                const modeLabel = modeLabels[currentApiMode] || currentApiMode;
                sensors += `
                    <div class="status-item">
                        <span class="status-label">Geräuschreduzierung</span>
                        <span class="status-value">${modeLabel}</span>
                    </div>
                `;
            }

            if (!sensors) return '';

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>🔧 Weitere Komponenten</h2>
                    </div>
                    <div class="status-list">
                        ${sensors}
                    </div>
                </div>
            `;
        }

        function renderHybridProControlInfo(kf) {
            // Get saved settings if available
            const saved = window.savedHybridProControlSettings || {};

            // Debug logging
            console.log('=== Hybrid Pro Control Debug ===');
            console.log('Current kf values:', {
                hybridElectricityPriceLow: kf.hybridElectricityPriceLow,
                hybridElectricityPriceNormal: kf.hybridElectricityPriceNormal,
                hybridHeatPumpEnergyFactor: kf.hybridHeatPumpEnergyFactor,
                hybridFossilEnergyFactor: kf.hybridFossilEnergyFactor,
                hybridFossilPriceLow: kf.hybridFossilPriceLow,
                hybridFossilPriceNormal: kf.hybridFossilPriceNormal,
                hybridControlStrategy: kf.hybridControlStrategy
            });
            console.log('Saved settings:', saved);

            // Debug: Search for any control strategy fields
            console.log('All kf keys with "strategy":', Object.keys(kf).filter(k => k.toLowerCase().includes('strategy')));
            console.log('All kf keys with "control":', Object.keys(kf).filter(k => k.toLowerCase().includes('control')));

            // Simple number formatter for hybrid values (not feature objects)
            const formatNumber = (num) => {
                if (num === null || num === undefined || num === '' || isNaN(num)) {
                    return null;
                }
                const n = parseFloat(num);
                // For prices and energy factors, show up to 3 decimal places but remove trailing zeros
                return n.toFixed(4).replace(/\.?0+$/, '');
            };

            // Prefer saved settings, fallback to API values
            const getDisplayValue = (savedVal, apiVal) => {
                // If saved value exists and is not 0, use it
                if (savedVal !== undefined && savedVal !== null && savedVal !== 0) {
                    console.log('Using saved value:', savedVal);
                    return formatNumber(savedVal);
                }
                // Otherwise use API value
                else if (apiVal) {
                    // apiVal can be an object with a 'value' property or just a number
                    const numVal = (typeof apiVal === 'object' && apiVal.value !== undefined) ? apiVal.value : apiVal;
                    console.log('Using API value:', numVal, 'from apiVal:', apiVal);
                    return formatNumber(numVal);
                }
                return null;
            };

            // Helper to check if a value is valid
            const hasValidValue = (val) => {
                if (val === null || val === undefined || val === '') return false;
                if (typeof val === 'object' && val.value !== undefined) {
                    return val.value !== null && val.value !== undefined && val.value !== '' && !isNaN(val.value);
                }
                return !isNaN(val);
            };

            // Only show if hybrid system with at least one hybrid value (saved or API)
            const hasAnyValue = (saved.electricityPriceLow !== undefined && saved.electricityPriceLow !== 0) ||
                               (saved.electricityPriceNormal !== undefined && saved.electricityPriceNormal !== 0) ||
                               (saved.heatPumpEnergyFactor !== undefined && saved.heatPumpEnergyFactor !== 0) ||
                               (saved.fossilEnergyFactor !== undefined && saved.fossilEnergyFactor !== 0) ||
                               (saved.fossilPriceLow !== undefined && saved.fossilPriceLow !== 0) ||
                               (saved.fossilPriceNormal !== undefined && saved.fossilPriceNormal !== 0) ||
                               hasValidValue(kf.hybridElectricityPriceLow) ||
                               hasValidValue(kf.hybridElectricityPriceNormal) ||
                               hasValidValue(kf.hybridHeatPumpEnergyFactor) ||
                               hasValidValue(kf.hybridFossilEnergyFactor) ||
                               hasValidValue(kf.hybridFossilPriceLow) ||
                               hasValidValue(kf.hybridFossilPriceNormal);

            if (!hasAnyValue) {
                return '';
            }

            let hybrid = '';

            // Stromtarif Niedrig
            const elLow = getDisplayValue(saved.electricityPriceLow, kf.hybridElectricityPriceLow);
            if (elLow) {
                hybrid += `
                    <div class="status-item">
                        <span class="status-label">Stromtarif Niedrig</span>
                        <span class="status-value">${elLow} EUR/kWh</span>
                    </div>
                `;
            }

            // Stromtarif Normal
            const elNorm = getDisplayValue(saved.electricityPriceNormal, kf.hybridElectricityPriceNormal);
            if (elNorm) {
                hybrid += `
                    <div class="status-item">
                        <span class="status-label">Stromtarif Normal</span>
                        <span class="status-value">${elNorm} EUR/kWh</span>
                    </div>
                `;
            }

            // Primärenergiefaktor WP
            const hpFactor = getDisplayValue(saved.heatPumpEnergyFactor, kf.hybridHeatPumpEnergyFactor);
            if (hpFactor) {
                hybrid += `
                    <div class="status-item">
                        <span class="status-label">Primärenergiefaktor WP</span>
                        <span class="status-value">${hpFactor}</span>
                    </div>
                `;
            }

            // Primärenergiefaktor Fossil
            const fosFactor = getDisplayValue(saved.fossilEnergyFactor, kf.hybridFossilEnergyFactor);
            if (fosFactor) {
                hybrid += `
                    <div class="status-item">
                        <span class="status-label">Primärenergiefaktor Fossil</span>
                        <span class="status-value">${fosFactor}</span>
                    </div>
                `;
            }

            // Fossil Tarif Niedrig
            const fosPriceLow = getDisplayValue(saved.fossilPriceLow, kf.hybridFossilPriceLow);
            if (fosPriceLow) {
                hybrid += `
                    <div class="status-item">
                        <span class="status-label">Fossil Tarif Niedrig</span>
                        <span class="status-value">${fosPriceLow} EUR/kWh</span>
                    </div>
                `;
            }

            // Fossil Tarif Normal
            const fosPriceNorm = getDisplayValue(saved.fossilPriceNormal, kf.hybridFossilPriceNormal);
            if (fosPriceNorm) {
                hybrid += `
                    <div class="status-item">
                        <span class="status-label">Fossil Tarif Normal</span>
                        <span class="status-value">${fosPriceNorm} EUR/kWh</span>
                    </div>
                `;
            }

            // Regelstrategie (nur aus gespeicherten Einstellungen, nicht aus API)
            const strategyMap = {
                'constant': 'Konstanttemperatur',
                'ecological': 'Ökologisch',
                'economic': 'Ökonomisch'
            };

            if (saved.controlStrategy) {
                const strategy = strategyMap[saved.controlStrategy] || saved.controlStrategy;
                hybrid += `
                    <div class="status-item">
                        <span class="status-label">Regelstrategie</span>
                        <span class="status-value">${strategy}</span>
                    </div>
                `;
            }

            if (!hybrid) return '';

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>☀️ Hybrid Pro Control</h2>
                    </div>
                    <div class="status-list">
                        ${hybrid}
                    </div>
                </div>
            `;
        }

        function renderRefrigerantCircuit(kf) {
            // Only for heat pumps
            if (!kf.evaporatorTemp && !kf.condensorTemp && !kf.inverterTemp) return '';

            let circuit = '';

            if (kf.evaporatorTemp && isValidNumericValue(kf.evaporatorTemp)) {
                circuit += `
                    <div class="status-item">
                        <span class="status-label">Verdampfer</span>
                        <span class="status-value">${formatValue(kf.evaporatorTemp)}</span>
                    </div>
                `;
            }

            if (kf.evaporatorOverheat && isValidNumericValue(kf.evaporatorOverheat)) {
                circuit += `
                    <div class="status-item">
                        <span class="status-label">Verdampfer Überhitzung</span>
                        <span class="status-value">${formatValue(kf.evaporatorOverheat)}</span>
                    </div>
                `;
            }

            if (kf.condensorTemp && isValidNumericValue(kf.condensorTemp)) {
                circuit += `
                    <div class="status-item">
                        <span class="status-label">Verflüssiger</span>
                        <span class="status-value">${formatValue(kf.condensorTemp)}</span>
                    </div>
                `;
            }

            if (kf.economizerTemp && isValidNumericValue(kf.economizerTemp)) {
                circuit += `
                    <div class="status-item">
                        <span class="status-label">Economizer</span>
                        <span class="status-value">${formatValue(kf.economizerTemp)}</span>
                    </div>
                `;
            }

            if (kf.inverterTemp && isValidNumericValue(kf.inverterTemp)) {
                circuit += `
                    <div class="status-item">
                        <span class="status-label">Wechselrichter</span>
                        <span class="status-value">${formatValue(kf.inverterTemp)}</span>
                    </div>
                `;
            }

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>🔧 Kältekreislauf</h2>
                    </div>
                    <div class="status-list">
                        ${circuit}
                    </div>
                </div>
            `;
        }

        function renderSystemStatus(kf) {
            let status = '';

            if (kf.operatingMode) {
                // Map API modes to German labels
                const modeLabels = {
                    'heating': 'Heizen',
                    'standby': 'Standby',
                    'cooling': 'Kühlen',
                    'heatingCooling': 'Heizen/Kühlen'
                };
                const currentMode = kf.operatingMode.value;

                status += `
                    <div class="status-item">
                        <span class="status-label">Betriebsmodus</span>
                        <span class="status-value">
                            <select id="heatingModeSelect" onchange="changeHeatingMode(this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                                <option value="heating" ${currentMode === 'heating' ? 'selected' : ''}>Heizen</option>
                                <option value="standby" ${currentMode === 'standby' ? 'selected' : ''}>Standby</option>
                                <option value="cooling" ${currentMode === 'cooling' ? 'selected' : ''}>Kühlen</option>
                                <option value="heatingCooling" ${currentMode === 'heatingCooling' ? 'selected' : ''}>Heizen/Kühlen</option>
                            </select>
                        </span>
                    </div>
                `;
            }

            if (!status) return '';

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>⚙️ Systemstatus</h2>
                        <span class="badge badge-success">Normal</span>
                    </div>
                    <div class="status-list">
                        ${status}
                    </div>
                </div>
            `;
        }

        function renderDeviceInfo(kf) {
            if (!kf.deviceSerial && !kf.deviceType && !kf.deviceVariant && !kf.scop && !kf.compressorStats) return '';

            let info = '';

            // Basic device info
            if (kf.deviceVariant) {
                info += `
                    <div class="status-item">
                        <span class="status-label">Modell</span>
                        <span class="status-value">${kf.deviceVariant.value}</span>
                    </div>
                `;
            }

            if (kf.deviceType) {
                info += `
                    <div class="status-item">
                        <span class="status-label">Typ</span>
                        <span class="status-value">${kf.deviceType.value}</span>
                    </div>
                `;
            }

            if (kf.deviceSerial) {
                info += `
                    <div class="status-item">
                        <span class="status-label">Seriennummer</span>
                        <span class="status-value" style="font-family: monospace;">${kf.deviceSerial.value}</span>
                    </div>
                `;
            }

            // JAZ / COP / SCOP / SPF values (Coefficient of Performance)
            if (kf.copTotal || kf.copHeating || kf.copDhw || kf.copCooling || kf.scop || kf.scopHeating || kf.scopDhw || kf.seerCooling) {
                info += `
                    <div class="status-item" style="grid-column: 1 / -1; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 10px; padding-top: 10px;">
                        <span class="status-label" style="font-weight: 600; color: #667eea;">Coefficient of Performance (JAZ)</span>
                    </div>
                `;

                // JAZ Gesamt (COP or SCOP fallback)
                if (kf.copTotal || kf.scop) {
                    const value = kf.copTotal || kf.scop;
                    info += `
                        <div class="status-item">
            <span class="status-label">JAZ Gesamt</span>
            <span class="status-value">${formatNum(value.value)}</span>
                        </div>
                    `;
                }

                // JAZ Heizen (COP or SCOP fallback)
                if (kf.copHeating || kf.scopHeating) {
                    const value = kf.copHeating || kf.scopHeating;
                    info += `
                        <div class="status-item">
            <span class="status-label">JAZ Heizen</span>
            <span class="status-value">${formatNum(value.value)}</span>
                        </div>
                    `;
                }

                // JAZ Warmwasser (COP or SCOP fallback)
                if (kf.copDhw || kf.scopDhw) {
                    const value = kf.copDhw || kf.scopDhw;
                    info += `
                        <div class="status-item">
            <span class="status-label">JAZ Warmwasser</span>
            <span class="status-value">${formatNum(value.value)}</span>
                        </div>
                    `;
                }

                // JAZ Kühlen (COP or SEER fallback)
                if (kf.copCooling || kf.seerCooling) {
                    const value = kf.copCooling || kf.seerCooling;
                    info += `
                        <div class="status-item">
            <span class="status-label">JAZ Kühlen</span>
            <span class="status-value">${formatNum(value.value)}</span>
                        </div>
                    `;
                }
            }

            // Compressor statistics (Lastklassen / Load classes)
            // Helper function to render load class statistics
            function renderCompressorStats(statsObj, compressorIndex) {
                let html = '';
                const stats = statsObj.value;

                if (stats && typeof stats === 'object') {
                    // Check if this has the nested structure (hours/starts from heating.compressors.X.statistics)
                    // These are shown in the Kompressor card, so skip them here
                    const hasHoursStarts = stats.hours && stats.hours.value !== undefined;

                    if (!hasHoursStarts) {
                        // This is the load class data (heating.compressors.X.statistics with loadClassOne, etc.)
                        html += `
            <div class="status-item" style="grid-column: 1 / -1; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 10px; padding-top: 10px;">
                <span class="status-label" style="font-weight: 600; color: #667eea;">Kältemittelkreislauf ${compressorIndex + 1}</span>
            </div>
                        `;

                        // Try different property name patterns for load classes
                        const loadClassPatterns = [
            ['hoursLoadClassOne', 'hoursLoadClassTwo', 'hoursLoadClassThree', 'hoursLoadClassFour', 'hoursLoadClassFive'],
            ['loadClassOne', 'loadClassTwo', 'loadClassThree', 'loadClassFour', 'loadClassFive'],
            ['hoursLoadClass1', 'hoursLoadClass2', 'hoursLoadClass3', 'hoursLoadClass4', 'hoursLoadClass5'],
            ['class1', 'class2', 'class3', 'class4', 'class5'],
            ['one', 'two', 'three', 'four', 'five']
                        ];

                        let foundPattern = null;
                        for (const pattern of loadClassPatterns) {
            // Check both direct values and nested structure
            if (stats[pattern[0]] !== undefined) {
                foundPattern = pattern;
                break;
            }
            if (stats[pattern[0]] && stats[pattern[0]].value !== undefined) {
                foundPattern = pattern;
                break;
            }
                        }

                        if (foundPattern) {
            foundPattern.forEach((key, index) => {
                let value = null;
                // Handle both direct values and nested structure
                if (stats[key] !== undefined) {
                    if (typeof stats[key] === 'object' && stats[key].value !== undefined) {
                        value = stats[key].value;
                    } else {
                        value = stats[key];
                    }
                }

                if (value !== null) {
                    html += `
                        <div class="status-item">
                            <span class="status-label">Stunden Lastklasse ${['eins', 'zwei', 'drei', 'vier', 'fünf'][index]}</span>
                            <span class="status-value">${value} h</span>
                        </div>
                    `;
                }
            });
                        }
                    }
                }
                return html;
            }

            // Render all available compressor statistics
            if (kf.compressorStats0) {
                console.log('📊 Compressor 0 Statistics:', kf.compressorStats0.value);
                info += renderCompressorStats(kf.compressorStats0, 0);
            }
            if (kf.compressorStats1) {
                console.log('📊 Compressor 1 Statistics:', kf.compressorStats1.value);
                info += renderCompressorStats(kf.compressorStats1, 1);
            }

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>ℹ️ Geräteinformationen</h2>
                    </div>
                    <div class="status-list">
                        ${info}
                    </div>
                </div>
            `;
        }

        // SmartClimate / Zigbee device rendering functions

        function renderThermostatView(kf, deviceInfo) {
            let html = '';

            // Device header
            html += renderDeviceHeader(deviceInfo, kf);

            // Main temperature card
            html += `
                <div class="card">
                    <div class="card-header">
                        <h2>🌡️ Raumtemperatur</h2>
                    </div>
                    <div class="status-list">
            `;

            if (kf.deviceTemperature && isValidNumericValue(kf.deviceTemperature)) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Ist-Temperatur</span>
                        <span class="status-value">${formatNum(kf.deviceTemperature.value)} ${kf.deviceTemperature.unit || '°C'}</span>
                    </div>
                `;
            }

            if (kf.trvTemperature && isValidNumericValue(kf.trvTemperature)) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Soll-Temperatur</span>
                        <span class="status-value">${formatNum(kf.trvTemperature.value)} ${kf.trvTemperature.unit || '°C'}</span>
                    </div>
                `;
            }

            if (kf.trvValvePosition) {
                // Nested property: value.position.value
                const valveData = kf.trvValvePosition.value;
                if (valveData && valveData.position && typeof valveData.position.value === 'number') {
                    const valvePos = valveData.position.value;
                    const valveUnit = valveData.position.unit || '%';
                    const valveStatus = valvePos > 0 ? '🟢 Offen' : '⚪ Geschlossen';
                    html += `
                        <div class="status-item">
                            <span class="status-label">Ventilstellung</span>
                            <span class="status-value">${valveStatus} (${formatNum(valvePos)} ${valveUnit})</span>
                        </div>
                    `;
                }
            }

            html += `
                    </div>
                </div>
            `;

            // Settings & Status card
            html += `
                <div class="card">
                    <div class="card-header">
                        <h2>⚙️ Einstellungen & Status</h2>
                    </div>
                    <div class="status-list">
            `;

            if (kf.trvChildLock) {
                // Nested property: value.status.value
                const lockData = kf.trvChildLock.value;
                if (lockData && lockData.status) {
                    const lockStatus = lockData.status.value;
                    const lockText = lockStatus === 'active' ? '🔒 AN' : '🔓 AUS';
                    html += `
                        <div class="status-item">
                            <span class="status-label">Kindersicherung</span>
                            <span class="status-value">${lockText}</span>
                        </div>
                    `;
                }
            }

            if (kf.trvMountingMode) {
                // Nested property: value.active.value
                const mountingData = kf.trvMountingMode.value;
                if (mountingData && mountingData.active && mountingData.active.value !== undefined) {
                    const mountingActive = mountingData.active.value;
                    html += `
                        <div class="status-item">
                            <span class="status-label">Montagemodus</span>
                            <span class="status-value">${mountingActive ? 'Aktiv' : 'Inaktiv'}</span>
                        </div>
                    `;
                }
            }

            html += `
                    </div>
                </div>
            `;

            // Zigbee device info
            html += renderZigbeeDeviceInfo(kf);

            return html;
        }

        function renderClimateSensorView(kf, deviceInfo) {
            let html = '';

            // Device header
            html += renderDeviceHeader(deviceInfo, kf);

            // Sensor data card
            html += `
                <div class="card wide">
                    <div class="card-header">
                        <h2>📊 Sensordaten</h2>
                    </div>
                    <div class="temp-grid">
            `;

            if (kf.deviceTemperature && isValidNumericValue(kf.deviceTemperature)) {
                html += `
                    <div class="temp-item">
                        <span class="temp-label">Temperatur</span>
                        <div>
                            <span class="temp-value">${formatNum(kf.deviceTemperature.value)}</span>
                            <span class="temp-unit">${kf.deviceTemperature.unit || '°C'}</span>
                        </div>
                    </div>
                `;
            }

            if (kf.deviceHumidity && isValidNumericValue(kf.deviceHumidity)) {
                html += `
                    <div class="temp-item">
                        <span class="temp-label">Luftfeuchtigkeit</span>
                        <div>
                            <span class="temp-value">${formatNum(kf.deviceHumidity.value)}</span>
                            <span class="temp-unit">${kf.deviceHumidity.unit || '%'}</span>
                        </div>
                    </div>
                `;
            }

            html += `
                    </div>
                </div>
            `;

            // Zigbee device info
            html += renderZigbeeDeviceInfo(kf);

            return html;
        }

        function renderFloorHeatingView(kf, deviceInfo) {
            let html = '';

            // Device header
            html += renderDeviceHeader(deviceInfo, kf);

            // Operating mode card
            html += `
                <div class="card">
                    <div class="card-header">
                        <h2>🏠 Betriebsmodus</h2>
            `;

            if (kf.fhtOperatingMode && kf.fhtOperatingMode.value) {
                const mode = kf.fhtOperatingMode.value;
                const modeText = mode === 'heating' ? 'Heizen' :
                                 mode === 'cooling' ? 'Kühlen' :
                                 mode === 'heatingCooling' ? 'Heizen/Kühlen' :
                                 'Standby';
                const badgeClass = mode === 'heating' ? 'badge-info' :
                                   mode === 'cooling' ? 'badge-success' :
                                   mode === 'heatingCooling' ? 'badge-primary' :
                                   'badge-warning';
                html += `<span class="badge ${badgeClass}">${modeText}</span>`;
            }

            html += `
                    </div>
                    <div class="status-list">
            `;

            if (kf.fhtSupplyTemp && isValidNumericValue(kf.fhtSupplyTemp)) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Vorlauftemperatur</span>
                        <span class="status-value">${formatNum(kf.fhtSupplyTemp.value)} ${kf.fhtSupplyTemp.unit || '°C'}</span>
                    </div>
                `;
            }

            if (kf.fhtHeatingActive) {
                // Nested property: value.active.value
                const heatingData = kf.fhtHeatingActive.value;
                if (heatingData && heatingData.active && heatingData.active.value !== undefined) {
                    html += `
                        <div class="status-item">
                            <span class="status-label">Heizen</span>
                            <span class="status-value">${heatingData.active.value ? '🟢 Aktiv' : '⚪ Inaktiv'}</span>
                        </div>
                    `;
                }
            }

            if (kf.fhtCoolingActive) {
                // Nested property: value.active.value
                const coolingData = kf.fhtCoolingActive.value;
                if (coolingData && coolingData.active && coolingData.active.value !== undefined) {
                    html += `
                        <div class="status-item">
                            <span class="status-label">Kühlen</span>
                            <span class="status-value">${coolingData.active.value ? '🟢 Aktiv' : '⚪ Inaktiv'}</span>
                        </div>
                    `;
                }
            }

            html += `
                    </div>
                </div>
            `;

            // Zigbee device info
            html += renderZigbeeDeviceInfo(kf);

            return html;
        }

        function renderRepeaterView(kf, deviceInfo) {
            let html = '';

            // Device header
            html += renderDeviceHeader(deviceInfo, kf);

            // Network info card
            html += `
                <div class="card wide">
                    <div class="card-header">
                        <h2>📡 Netzwerk-Informationen</h2>
                    </div>
                    <div class="status-list">
            `;

            if (kf.zigbeeLqi) {
                // Nested property: value.strength.value
                const lqiData = kf.zigbeeLqi.value;
                if (lqiData && lqiData.strength && typeof lqiData.strength.value === 'number') {
                    const lqiValue = lqiData.strength.value;
                    const lqiUnit = lqiData.strength.unit || '%';
                    const lqiColor = lqiValue >= 70 ? '#10b981' : lqiValue >= 40 ? '#f59e0b' : '#ef4444';
                    html += `
                        <div class="status-item">
                            <span class="status-label">Link Quality Indicator</span>
                            <span class="status-value" style="color: ${lqiColor}; font-weight: bold;">
                                ${formatNum(lqiValue)} ${lqiUnit}
                            </span>
                        </div>
                    `;
                }
            }

            html += `
                        <div class="status-item">
                            <span class="status-label">Gerätetyp</span>
                            <span class="status-value">Zigbee Repeater</span>
                        </div>
                    </div>
                </div>
            `;

            return html;
        }

        function renderZigbeeDeviceInfo(kf) {
            if (!kf.deviceBattery && !kf.zigbeeLqi) return '';

            let html = `
                <div class="card">
                    <div class="card-header">
                        <h2>🔋 Geräteinformationen</h2>
                    </div>
                    <div class="status-list">
            `;

            if (kf.deviceBattery) {
                // Nested property: value.level.value
                const batteryData = kf.deviceBattery.value;
                if (batteryData && batteryData.level && typeof batteryData.level.value === 'number') {
                    const battery = batteryData.level.value;
                    const batteryUnit = batteryData.level.unit || '%';
                    const batteryColor = battery >= 70 ? '#10b981' : battery >= 30 ? '#f59e0b' : '#ef4444';
                    const batteryIcon = battery >= 70 ? '🔋' : battery >= 30 ? '🪫' : '🔴';
                    html += `
                        <div class="status-item">
                            <span class="status-label">Batteriestand</span>
                            <span class="status-value" style="color: ${batteryColor}; font-weight: bold;">
                                ${batteryIcon} ${formatNum(battery)} ${batteryUnit}
                            </span>
                        </div>
                    `;
                }
            }

            if (kf.zigbeeLqi) {
                // Nested property: value.strength.value
                const lqiData = kf.zigbeeLqi.value;
                if (lqiData && lqiData.strength && typeof lqiData.strength.value === 'number') {
                    const lqiValue = lqiData.strength.value;
                    const lqiUnit = lqiData.strength.unit || '%';
                    const lqiColor = lqiValue >= 70 ? '#10b981' : lqiValue >= 40 ? '#f59e0b' : '#ef4444';
                    html += `
                        <div class="status-item">
                            <span class="status-label">Link Quality</span>
                            <span class="status-value" style="color: ${lqiColor}; font-weight: bold;">
                                ${formatNum(lqiValue)} ${lqiUnit}
                            </span>
                        </div>
                    `;
                }
            }

            html += `
                    </div>
                </div>
            `;

            return html;
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

        function formatNum(val) {
            if (val === null || val === undefined) return '--';
            if (typeof val === 'number') {
                return val.toFixed(1);
            }
            return val;
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

        function formatValue(featureValue) {
            if (!featureValue || featureValue.value === undefined) {
                return '--';
            }
            let val = featureValue.value;
            const unit = featureValue.unit;

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

        async function showDebugDevices() {
            try {
                const params = new URLSearchParams();
                if (!showAllDevices) params.append('onlyUnknown', 'true');

                const response = await fetch('/api/debug/devices?' + params.toString());
                if (!response.ok) {
                    throw new Error('API Fehler: ' + response.status);
                }

                const data = await response.json();
                currentDebugData = data;
                renderDebugModal(data);

            } catch (error) {
                showError('Fehler beim Laden der Debug-Daten: ' + error.message);
            }
        }

        function renderDebugModal(data) {
            // Create modal
            const modal = document.createElement('div');
            modal.className = 'debug-modal';
            modal.id = 'debugModal';

            let devicesHtml = '';
            for (let i = 0; i < data.devices.length; i++) {
                const device = data.devices[i];
                const deviceKey = `${device.installationId}_${device.gatewaySerial}_${device.deviceId}`;
                const hasFeatures = deviceFeatures[deviceKey];

                let featuresHtml = '';
                if (hasFeatures) {
                    if (hasFeatures.error) {
                        featuresHtml = `
            <div style="margin-top: 10px; padding: 10px; background: rgba(220, 38, 38, 0.1); border: 1px solid rgba(220, 38, 38, 0.3); border-radius: 4px; color: #fca5a5;">
                ❌ Fehler beim Laden der Features: ${hasFeatures.error}
            </div>
                        `;
                    } else if (hasFeatures.features && hasFeatures.features.length > 0) {
                        featuresHtml = `
            <div style="margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); border-radius: 4px;">
                <div style="color: #667eea; font-weight: 600; margin-bottom: 8px;">📊 Features (${hasFeatures.features.length}):</div>
                <div style="max-height: 200px; overflow-y: auto; font-size: 11px;">
                    ${hasFeatures.features.map(f => `
                        <div style="margin-bottom: 6px; padding: 6px; background: rgba(0,0,0,0.2); border-radius: 3px;">
                            <div style="color: #fbbf24;">${f.feature}</div>
                            ${f.properties && f.properties.value ? `
                                <div style="color: #a0a0b0; margin-left: 10px;">
                                    ${JSON.stringify(f.properties.value).substring(0, 100)}${JSON.stringify(f.properties.value).length > 100 ? '...' : ''}
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
                        `;
                    } else {
                        featuresHtml = `
            <div style="margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 4px; color: #a0a0b0; font-style: italic;">
                Keine Features gefunden
            </div>
                        `;
                    }
                }

                devicesHtml += `
                    <div class="debug-device">
                        <div class="debug-device-header">
            <span class="debug-device-type">${device.deviceType}</span>
            <span class="debug-device-model">${device.modelId}</span>
                        </div>
                        <div class="debug-device-details">
            <div class="debug-device-detail">
                <span class="debug-device-detail-label">Installation:</span>
                <span>${device.installationDesc || device.installationId}</span>
            </div>
            <div class="debug-device-detail">
                <span class="debug-device-detail-label">Device ID:</span>
                <span>${device.deviceId}</span>
            </div>
            <div class="debug-device-detail">
                <span class="debug-device-detail-label">Gateway:</span>
                <span>${device.gatewaySerial}</span>
            </div>
            ${device.accountName ? `
            <div class="debug-device-detail">
                <span class="debug-device-detail-label">Account:</span>
                <span>${device.accountName}</span>
            </div>
            ` : ''}
                        </div>
                        ${featuresHtml}
                        <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="toggle-all" style="flex: 1; min-width: 140px; ${hasFeatures ? 'background: linear-gradient(135deg, #10b981 0%, #059669 100%);' : ''}"
                    onclick="loadDeviceFeatures('${deviceKey}', ${i})">
                ${hasFeatures ? '✅ Features geladen' : '📊 Features laden'}
            </button>
            <button class="toggle-all" style="flex: 1; min-width: 140px;" onclick="copyDeviceJson(${i})">
                📋 JSON kopieren
            </button>
            <button class="toggle-all" style="flex: 1; min-width: 140px;" onclick="downloadDeviceJson(${i})">
                💾 JSON herunterladen
            </button>
                        </div>
                    </div>
                `;
            }

            const jsonString = JSON.stringify(data, null, 2);

            modal.innerHTML = `
                <div class="debug-content">
                    <div class="debug-header">
                        <h2>🐛 Debug: Geräte-Übersicht</h2>
                        <button class="close-btn" onclick="closeDebugModal()">✕ Schließen</button>
                    </div>
                    <div class="debug-summary">
                        <div class="debug-stat">
            <div class="debug-stat-label">Angezeigte Geräte</div>
            <div class="debug-stat-value">${data.totalDevices}</div>
                        </div>
                        <div class="debug-stat">
            <div class="debug-stat-label">Unbekannte Geräte</div>
            <div class="debug-stat-value">${data.unknownDevices}</div>
                        </div>
                    </div>
                    <div class="debug-actions">
                        <button class="toggle-all" onclick="toggleAllDevices()">
            ${showAllDevices ? '🔽 Nur unbekannte Geräte' : '🔼 Alle Geräte anzeigen'}
                        </button>
                        <button class="toggle-all" onclick="toggleJsonView()">
            ${showJsonView ? '👁️ Liste anzeigen' : '📄 JSON anzeigen'}
                        </button>
                    </div>
                    <div style="padding: 12px; background: rgba(102, 126, 234, 0.1); border: 1px solid rgba(102, 126, 234, 0.3); border-radius: 6px; margin-bottom: 15px; color: #667eea; font-size: 13px;">
                        ℹ️ Verwende die Buttons unter jedem Gerät um Features zu laden oder das Gerät zu exportieren.
                    </div>
                    <div id="debugDeviceList" style="max-height: 500px; overflow-y: auto; display: ${showJsonView ? 'none' : 'block'};">
                        ${devicesHtml || '<p style="color: #a0a0b0; text-align: center; padding: 20px;">Keine Geräte gefunden</p>'}
                    </div>
                    <div id="debugJsonView" class="json-view" style="display: ${showJsonView ? 'block' : 'none'};">${jsonString}</div>
                </div>
            `;

            document.body.appendChild(modal);

            // Close on background click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeDebugModal();
                }
            });
        }

        function closeDebugModal() {
            const modal = document.getElementById('debugModal');
            if (modal) {
                modal.remove();
            }
        }

        function toggleAllDevices() {
            showAllDevices = !showAllDevices;
            closeDebugModal();
            showDebugDevices();
        }

        function toggleJsonView() {
            showJsonView = !showJsonView;
            closeDebugModal();
            renderDebugModal(currentDebugData);
        }

        async function loadDeviceFeatures(deviceKey, deviceIndex) {
            const device = currentDebugData.devices[deviceIndex];

            // Show loading indicator
            const btn = event.target;
            const originalText = btn.textContent;
            btn.textContent = '⏳ Laden...';
            btn.disabled = true;

            try {
                const response = await fetch(`/api/features?installationId=${device.installationId}&gatewaySerial=${device.gatewaySerial}&deviceId=${device.deviceId}`);
                if (!response.ok) {
                    throw new Error('API Fehler: ' + response.status);
                }

                const features = await response.json();

                // Store features for this device
                deviceFeatures[deviceKey] = {
                    features: features.rawFeatures || []
                };

                // Re-render modal to show features
                closeDebugModal();
                renderDebugModal(currentDebugData);

            } catch (error) {
                deviceFeatures[deviceKey] = {
                    error: error.message
                };
                closeDebugModal();
                renderDebugModal(currentDebugData);
            }
        }

        async function copyDeviceJson(deviceIndex) {
            const device = currentDebugData.devices[deviceIndex];
            const deviceKey = `${device.installationId}_${device.gatewaySerial}_${device.deviceId}`;

            // Build device JSON with features if loaded
            const deviceData = { ...device };
            if (deviceFeatures[deviceKey]) {
                if (deviceFeatures[deviceKey].features) {
                    deviceData.features = deviceFeatures[deviceKey].features;
                }
                if (deviceFeatures[deviceKey].error) {
                    deviceData.featuresError = deviceFeatures[deviceKey].error;
                }
            }

            const jsonString = JSON.stringify(deviceData, null, 2);

            try {
                await navigator.clipboard.writeText(jsonString);
                // Show success feedback
                const btn = event.target;
                const originalText = btn.textContent;
                btn.textContent = '✅ Kopiert!';
                btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.background = '';
                }, 2000);
            } catch (err) {
                showError('Fehler beim Kopieren: ' + err.message);
            }
        }

        function downloadDeviceJson(deviceIndex) {
            const device = currentDebugData.devices[deviceIndex];
            const deviceKey = `${device.installationId}_${device.gatewaySerial}_${device.deviceId}`;

            // Build device JSON with features if loaded
            const deviceData = { ...device };
            if (deviceFeatures[deviceKey]) {
                if (deviceFeatures[deviceKey].features) {
                    deviceData.features = deviceFeatures[deviceKey].features;
                }
                if (deviceFeatures[deviceKey].error) {
                    deviceData.featuresError = deviceFeatures[deviceKey].error;
                }
            }

            const jsonString = JSON.stringify(deviceData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            // Create filename from device info
            const filename = `vicare-device-${device.deviceType}-${device.modelId.replace(/[^a-zA-Z0-9]/g, '_')}-${device.deviceId}.json`;
            a.download = filename;

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Show success feedback
            const btn = event.target;
            const originalText = btn.textContent;
            btn.textContent = '✅ Heruntergeladen!';
            btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.background = '';
            }, 2000);
        }

        // --- Device Settings Modal ---

        window.deviceSettingsCache = {}; // Cache for device settings

        async function loadDeviceSettings(installationId, deviceId) {
            // Get account from current device
            const accountId = window.currentDeviceInfo?.accountId;
            if (!accountId) {
                console.log('No accountId available for device settings');
                return;
            }

            try {
                const response = await fetch(`/api/device-settings/get?accountId=${encodeURIComponent(accountId)}&installationId=${encodeURIComponent(installationId)}&deviceId=${encodeURIComponent(deviceId)}`);
                const data = await response.json();

                if (data.success) {
                    const deviceKey = `${installationId}_${deviceId}`;
                    window.deviceSettingsCache[deviceKey] = {
                        min: data.compressorRpmMin || 0,
                        max: data.compressorRpmMax || 0,
                        useAirIntakeTemperatureLabel: data.useAirIntakeTemperatureLabel // null = auto-detect, true/false = override
                    };
                }
            } catch (error) {
                console.error('Error loading device settings:', error);
            }
        }

        async function openDeviceSettingsModal(installationId, deviceId) {
            // Get account from current device
            const accountId = window.currentDeviceInfo?.accountId;
            if (!accountId) {
                alert('Kein Account für dieses Gerät verfügbar');
                return;
            }

            // Load current settings
            try {
                const response = await fetch(`/api/device-settings/get?accountId=${encodeURIComponent(accountId)}&installationId=${encodeURIComponent(installationId)}&deviceId=${encodeURIComponent(deviceId)}`);
                const data = await response.json();

                if (!data.success) {
                    console.error('Failed to load settings:', data.error);
                }

                showDeviceSettingsModal(installationId, deviceId, data.compressorRpmMin || 0, data.compressorRpmMax || 0, data.useAirIntakeTemperatureLabel);
            } catch (error) {
                console.error('Error loading device settings:', error);
                showDeviceSettingsModal(installationId, deviceId, 0, 0, null);
            }
        }

        function showDeviceSettingsModal(installationId, deviceId, currentMin, currentMax, useAirIntakeTemperatureLabel) {
            const modal = document.createElement('div');
            modal.className = 'debug-modal';
            modal.style.display = 'flex';

            // Determine radio button state
            let radioState = 'auto'; // default
            if (useAirIntakeTemperatureLabel === true) {
                radioState = 'air';
            } else if (useAirIntakeTemperatureLabel === false) {
                radioState = 'primary';
            }

            modal.innerHTML = `
                <div style="background: #1a1a2e; padding: 30px; border-radius: 12px; max-width: 500px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.5);">
                    <h2 style="margin-top: 0; color: #fff;">⚙️ Geräteeinstellungen</h2>
                    <p style="color: #a0a0b0; margin-bottom: 20px;">Device: ${deviceId}</p>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; color: #fff; margin-bottom: 8px; font-weight: 600;">
                            Kompressor U/min Minimum
                        </label>
                        <input type="number" id="rpmMin" value="${currentMin}"
                               style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #fff; font-size: 14px;">
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; color: #fff; margin-bottom: 8px; font-weight: 600;">
                            Kompressor U/min Maximum
                        </label>
                        <input type="number" id="rpmMax" value="${currentMax}"
                               style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #fff; font-size: 14px;">
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; color: #fff; margin-bottom: 12px; font-weight: 600;">
                            Temperaturbezeichnung für Primärkreis
                        </label>
                        <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 6px;">
                            <div style="margin-bottom: 8px;">
                                <input type="radio" id="labelAuto" name="tempLabel" value="auto" ${radioState === 'auto' ? 'checked' : ''}
                                       style="cursor: pointer;">
                                <label for="labelAuto" style="color: #a0a0b0; cursor: pointer; display: inline;">
                                    Automatisch erkennen (Standard)
                                </label>
                            </div>
                            <div style="margin-bottom: 8px;">
                                <input type="radio" id="labelAir" name="tempLabel" value="air" ${radioState === 'air' ? 'checked' : ''}
                                       style="cursor: pointer;">
                                <label for="labelAir" style="color: #a0a0b0; cursor: pointer; display: inline;">
                                    Lufteintrittstemperatur
                                </label>
                            </div>
                            <div>
                                <input type="radio" id="labelPrimary" name="tempLabel" value="primary" ${radioState === 'primary' ? 'checked' : ''}
                                       style="cursor: pointer;">
                                <label for="labelPrimary" style="color: #a0a0b0; cursor: pointer; display: inline;">
                                    Primärkreisvorlauf
                                </label>
                            </div>
                        </div>
                    </div>

                    <div style="display: flex; gap: 10px; margin-top: 30px;">
                        <button onclick="saveDeviceSettings('${installationId}', '${deviceId}')"
                                style="flex: 1; padding: 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                            💾 Speichern
                        </button>
                        <button onclick="deleteDeviceSettings('${installationId}', '${deviceId}')"
                                style="flex: 1; padding: 12px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                            🗑️ Löschen
                        </button>
                        <button onclick="closeDeviceSettingsModal()"
                                style="padding: 12px 20px; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; cursor: pointer; font-weight: 600;">
                            Abbrechen
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            modal.id = 'deviceSettingsModal';

            // Close on background click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeDeviceSettingsModal();
                }
            });
        }

        function closeDeviceSettingsModal() {
            const modal = document.getElementById('deviceSettingsModal');
            if (modal) {
                modal.remove();
            }
        }

        async function saveDeviceSettings(installationId, deviceId) {
            const accountId = window.currentDeviceInfo?.accountId;
            if (!accountId) {
                alert('Kein Account für dieses Gerät verfügbar');
                return;
            }

            const rpmMin = parseInt(document.getElementById('rpmMin').value) || 0;
            const rpmMax = parseInt(document.getElementById('rpmMax').value) || 0;

            if (rpmMin >= rpmMax && rpmMax !== 0) {
                alert('Minimum muss kleiner als Maximum sein');
                return;
            }

            // Get temperature label setting from radio buttons
            const radioValue = document.querySelector('input[name="tempLabel"]:checked').value;
            let useAirIntakeTemperatureLabel = null;
            if (radioValue === 'air') {
                useAirIntakeTemperatureLabel = true;
            } else if (radioValue === 'primary') {
                useAirIntakeTemperatureLabel = false;
            }
            // else 'auto' means null (auto-detect)

            try {
                const response = await fetch('/api/device-settings/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        accountId: accountId,
                        installationId: installationId,
                        deviceId: deviceId,
                        compressorRpmMin: rpmMin,
                        compressorRpmMax: rpmMax,
                        useAirIntakeTemperatureLabel: useAirIntakeTemperatureLabel
                    })
                });

                const data = await response.json();

                if (data.success) {
                    // Update cache
                    const deviceKey = `${installationId}_${deviceId}`;
                    if (!window.deviceSettingsCache[deviceKey]) {
                        window.deviceSettingsCache[deviceKey] = {};
                    }
                    window.deviceSettingsCache[deviceKey].min = rpmMin;
                    window.deviceSettingsCache[deviceKey].max = rpmMax;
                    window.deviceSettingsCache[deviceKey].useAirIntakeTemperatureLabel = useAirIntakeTemperatureLabel;

                    alert('Einstellungen gespeichert!');
                    closeDeviceSettingsModal();

                    // Reload dashboard to show updated labels and percentages
                    loadDashboard();
                } else {
                    alert('Fehler beim Speichern: ' + data.error);
                }
            } catch (error) {
                alert('Fehler beim Speichern: ' + error.message);
            }
        }

        async function deleteDeviceSettings(installationId, deviceId) {
            if (!confirm('Einstellungen wirklich löschen?')) {
                return;
            }

            const accountId = window.currentDeviceInfo?.accountId;
            if (!accountId) {
                alert('Kein Account für dieses Gerät verfügbar');
                return;
            }

            try {
                const response = await fetch('/api/device-settings/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        accountId: accountId,
                        installationId: installationId,
                        deviceId: deviceId
                    })
                });

                const data = await response.json();

                if (data.success) {
                    // Clear cache
                    const deviceKey = `${installationId}_${deviceId}`;
                    delete window.deviceSettingsCache[deviceKey];

                    alert('Einstellungen gelöscht!');
                    closeDeviceSettingsModal();

                    // Reload dashboard
                    loadDashboard();
                } else {
                    alert('Fehler beim Löschen: ' + data.error);
                }
            } catch (error) {
                alert('Fehler beim Löschen: ' + error.message);
            }
        }

        // DHW Mode Change Function
        async function changeDhwMode(newMode) {
            const select = document.getElementById('dhwModeSelect');
            const originalValue = select.value;

            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                // Disable select while changing
                select.disabled = true;

                const response = await fetch('/api/dhw/mode/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        mode: newMode
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log('DHW mode changed to:', newMode);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern der Betriebsart: ' + data.error);
                    select.value = originalValue;
                    select.disabled = false;
                }
            } catch (error) {
                alert('Fehler beim Ändern der Betriebsart: ' + error.message);
                select.value = originalValue;
                select.disabled = false;
            }
        }

        // Make changeDhwMode available globally
        window.changeDhwMode = changeDhwMode;

        // DHW Temperature Change Function
        async function changeDhwTemperature(newTemp) {
            const select = document.getElementById('dhwTargetSelect');
            const originalValue = select.value;

            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                // Disable select while changing
                select.disabled = true;

                const response = await fetch('/api/dhw/temperature/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        temperature: parseFloat(newTemp)
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log('DHW temperature changed to:', newTemp);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern der Temperatur: ' + data.error);
                    select.value = originalValue;
                    select.disabled = false;
                }
            } catch (error) {
                alert('Fehler beim Ändern der Temperatur: ' + error.message);
                select.value = originalValue;
                select.disabled = false;
            }
        }

        // DHW Hysteresis Change Function
        async function changeDhwHysteresis(type, newValue) {
            const selectId = type === 'on' ? 'dhwHysteresisOnSelect' : 'dhwHysteresisOffSelect';
            const select = document.getElementById(selectId);
            const originalValue = select.value;

            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                // Disable select while changing
                select.disabled = true;

                const response = await fetch('/api/dhw/hysteresis/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        type: type,
                        value: parseFloat(newValue)
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log(`DHW hysteresis ${type} changed to:`, newValue);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern der Hysterese: ' + data.error);
                    select.value = originalValue;
                    select.disabled = false;
                }
            } catch (error) {
                alert('Fehler beim Ändern der Hysterese: ' + error.message);
                select.value = originalValue;
                select.disabled = false;
            }
        }

        // DHW Temperature 2 Change Function
        async function changeDhwTemperature2(newTemp) {
            const select = document.getElementById('dhwTarget2Select');
            const originalValue = select.value;

            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                // Disable select while changing
                select.disabled = true;

                const response = await fetch('/api/dhw/temperature2/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        temperature: parseFloat(newTemp)
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log('DHW temperature 2 changed to:', newTemp);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern der Temperatur 2: ' + data.error);
                    select.value = originalValue;
                    select.disabled = false;
                }
            } catch (error) {
                alert('Fehler beim Ändern der Temperatur 2: ' + error.message);
                select.value = originalValue;
                select.disabled = false;
            }
        }

        // Make functions available globally
        window.changeDhwTemperature = changeDhwTemperature;
        window.changeDhwTemperature2 = changeDhwTemperature2;
        window.changeDhwHysteresis = changeDhwHysteresis;

        // DHW One Time Charge Function
        async function startOneTimeCharge() {
            if (!confirm('Möchten Sie die einmalige Warmwassererwärmung wirklich starten?')) {
                return;
            }

            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                const response = await fetch('/api/dhw/oneTimeCharge/activate', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId
                    })
                });

                const data = await response.json();

                if (data.success) {
                    alert('Einmalige Warmwassererwärmung wurde gestartet! ✓');
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Starten: ' + data.error);
                }
            } catch (error) {
                alert('Fehler beim Starten: ' + error.message);
            }
        }

        // Make function available globally
        window.startOneTimeCharge = startOneTimeCharge;

        // Heating Curve Change Function
        async function changeHeatingCurve(circuitIdOrType, typeOrValue, valueOrNull = null) {
            // Support both old signature changeHeatingCurve(type, value) and new changeHeatingCurve(circuitId, type, value)
            let circuitId, type, newValue;
            if (valueOrNull === null) {
                // Old signature: changeHeatingCurve(type, value)
                circuitId = 0;
                type = circuitIdOrType;
                newValue = typeOrValue;
            } else {
                // New signature: changeHeatingCurve(circuitId, type, value)
                circuitId = circuitIdOrType;
                type = typeOrValue;
                newValue = valueOrNull;
            }

            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                // Get current values from window.heatingCurveData for this circuit
                let shift = 0;
                let slope = 1.0;
                if (window.heatingCurveData && window.heatingCurveData[circuitId]) {
                    shift = window.heatingCurveData[circuitId].shift || 0;
                    slope = window.heatingCurveData[circuitId].slope || 1.0;
                }

                // Update the changed value
                if (type === 'shift') {
                    shift = parseInt(newValue);
                } else if (type === 'slope') {
                    slope = parseFloat(newValue);
                }

                // Disable both selects while changing (if they exist)
                const shiftSelect = document.getElementById('heatingCurveShiftSelect');
                const slopeSelect = document.getElementById('heatingCurveSlopeSelect');
                if (shiftSelect) shiftSelect.disabled = true;
                if (slopeSelect) slopeSelect.disabled = true;

                const response = await fetch('/api/heating/curve/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        circuit: circuitId,
                        shift: shift,
                        slope: slope
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log(`Heating curve changed for circuit ${circuitId}: shift=${shift}, slope=${slope}`);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern der Heizkurve: ' + data.error);
                    if (shiftSelect) shiftSelect.disabled = false;
                    if (slopeSelect) slopeSelect.disabled = false;
                }
            } catch (error) {
                alert('Fehler beim Ändern der Heizkurve: ' + error.message);
                const shiftSelect = document.getElementById('heatingCurveShiftSelect');
                const slopeSelect = document.getElementById('heatingCurveSlopeSelect');
                if (shiftSelect) shiftSelect.disabled = false;
                if (slopeSelect) slopeSelect.disabled = false;
            }
        }

        // Supply Temperature Max Change Function
        async function changeSupplyTempMax(circuitIdOrValue, tempValue = null) {
            // Support both old signature changeSupplyTempMax(value) and new changeSupplyTempMax(circuitId, value)
            let circuitId, newValue;
            if (tempValue === null) {
                // Old signature: changeSupplyTempMax(value)
                circuitId = 0;
                newValue = circuitIdOrValue;
            } else {
                // New signature: changeSupplyTempMax(circuitId, value)
                circuitId = circuitIdOrValue;
                newValue = tempValue;
            }

            const select = document.getElementById('supplyTempMaxSelect');

            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                // Disable select while changing (if it exists)
                if (select) {
                    select.disabled = true;
                }

                const response = await fetch('/api/heating/supplyTempMax/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        circuit: circuitId,
                        temperature: parseInt(newValue)
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log(`Supply temperature max changed to ${newValue} for circuit ${circuitId}`);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern der Vorlauftemperaturbegrenzung: ' + data.error);
                    if (select) {
                        select.disabled = false;
                    }
                }
            } catch (error) {
                alert('Fehler beim Ändern der Vorlauftemperaturbegrenzung: ' + error.message);
                if (select) {
                    select.disabled = false;
                }
            }
        }

        // Room Temperature Change Function
        async function changeRoomTemp(circuitId, program, temperature) {
            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                const response = await fetch('/api/heating/roomTemp/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        circuit: circuitId,
                        program: program,
                        temperature: parseInt(temperature)
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log(`Room temperature for program ${program} changed to ${temperature}°C for circuit ${circuitId}`);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern der Raumtemperatur: ' + data.error);
                }
            } catch (error) {
                alert('Fehler beim Ändern der Raumtemperatur: ' + error.message);
            }
        }

        // Make functions available globally
        window.changeHeatingCurve = changeHeatingCurve;
        window.changeSupplyTempMax = changeSupplyTempMax;
        window.changeRoomTemp = changeRoomTemp;

        // Tab switching function for consumption statistics
        function switchStatTab(event, tabId) {
            // Find the parent card to scope operations to current card only
            const card = event.currentTarget.closest('.card');

            // Hide all tab contents within this card only
            const contents = card.querySelectorAll('.stat-tab-content');
            contents.forEach(content => content.style.display = 'none');

            // Remove active class from all tabs in current period
            const parentTabs = event.currentTarget.parentElement;
            const tabs = parentTabs.querySelectorAll('.stat-tab');
            tabs.forEach(tab => tab.classList.remove('active'));

            // Show selected tab content
            document.getElementById(tabId).style.display = 'block';

            // Add active class to clicked tab
            event.currentTarget.classList.add('active');
        }
        window.switchStatTab = switchStatTab;

        function switchStatPeriod(event, periodId) {
            // Find the parent card to scope operations to current card only
            const card = event.currentTarget.closest('.card');

            // Hide all period contents within this card only
            const contents = card.querySelectorAll('.stat-period-content');
            contents.forEach(content => content.style.display = 'none');

            // Remove active class from period tabs
            const parentTabs = event.currentTarget.parentElement;
            const tabs = parentTabs.querySelectorAll('.stat-tab');
            tabs.forEach(tab => tab.classList.remove('active'));

            // Show selected period content
            const periodElement = document.getElementById(periodId);
            periodElement.style.display = 'block';

            // Add active class to clicked period tab
            event.currentTarget.classList.add('active');

            // Show first tab content in the new period and activate first tab
            const firstTabContent = periodElement.querySelector('.stat-tab-content');
            const allTabContents = periodElement.querySelectorAll('.stat-tab-content');
            const subTabs = periodElement.querySelectorAll('.stat-tabs-scrollable .stat-tab');

            // Hide all tab contents in this period
            allTabContents.forEach(content => content.style.display = 'none');
            // Remove active from all sub-tabs
            subTabs.forEach(tab => tab.classList.remove('active'));

            // Show first tab content and mark first tab as active
            if (firstTabContent) {
                firstTabContent.style.display = 'block';
            }
            if (subTabs.length > 0) {
                subTabs[0].classList.add('active');
            }
        }
        window.switchStatPeriod = switchStatPeriod;

        // Heating Mode Change Function
        async function changeHeatingMode(circuitIdOrMode, modeValue = null) {
            // Support both old signature changeHeatingMode(mode) and new changeHeatingMode(circuitId, mode)
            let circuitId, newMode;
            if (modeValue === null) {
                // Old signature: changeHeatingMode(mode)
                circuitId = 0;
                newMode = circuitIdOrMode;
            } else {
                // New signature: changeHeatingMode(circuitId, mode)
                circuitId = circuitIdOrMode;
                newMode = modeValue;
            }

            const select = document.getElementById('heatingModeSelect');

            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                // Disable select while changing (if it exists)
                if (select) {
                    select.disabled = true;
                }

                const response = await fetch('/api/heating/mode/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        circuit: circuitId,
                        mode: newMode
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log(`Heating mode changed to ${newMode} for circuit ${circuitId}`);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern des Betriebsmodus: ' + data.error);
                    if (select) {
                        select.disabled = false;
                    }
                }
            } catch (error) {
                alert('Fehler beim Ändern des Betriebsmodus: ' + error.message);
                if (select) {
                    select.disabled = false;
                }
            }
        }

        // Make function available globally
        window.changeHeatingMode = changeHeatingMode;

        // --- Fan Ring Heating Control ---
        async function toggleFanRing(event) {
            event.preventDefault();

            try {
                if (!currentDeviceInfo) {
                    throw new Error('Device-Information nicht verfügbar');
                }

                const button = event.target;
                const currentState = button.dataset.current === 'true';
                const newState = !currentState;

                // Disable button while changing
                button.disabled = true;
                const originalText = button.textContent;
                button.textContent = '⏳ Wird geändert...';

                const response = await fetch('/api/fan-ring/toggle', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDeviceInfo.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        active: newState
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log(`Fan ring heating turned ${newState ? 'on' : 'off'}`);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Umschalten der Ventilatorringheizung: ' + data.error);
                    button.disabled = false;
                    button.textContent = originalText;
                }
            } catch (error) {
                alert('Fehler beim Umschalten der Ventilatorringheizung: ' + error.message);
                button.disabled = false;
                const originalText = event.target.dataset.originalText;
                if (originalText) {
                    event.target.textContent = originalText;
                }
            }
        }

        // Make function available globally
        window.toggleFanRing = toggleFanRing;

        // Hybrid Pro Control Modal Functions
        async function openHybridProControlModal(installationId, deviceId, gatewaySerial) {
            // Get account from current device
            const accountId = window.currentDeviceInfo?.accountId;
            if (!accountId) {
                alert('Kein Account für dieses Gerät verfügbar');
                return;
            }

            showHybridProControlModal(installationId, deviceId, gatewaySerial, accountId);
        }

        function showHybridProControlModal(installationId, deviceId, gatewaySerial, accountId) {
            // Store parameters for later use
            hybridModalParams = {
                installationId: installationId,
                deviceId: deviceId,
                accountId: accountId,
                gatewaySerial: gatewaySerial
            };

            const modal = document.createElement('div');
            modal.className = 'debug-modal';
            modal.style.display = 'flex';
            modal.style.zIndex = '10000';

            // Create a temporary container for the form
            const formContainer = document.createElement('div');
            formContainer.innerHTML = `
                <div style="background: white; padding: 30px; border-radius: 12px; max-width: 800px; width: 95%; max-height: 85vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                    <div id="hybridProControlContainer" style="display: block;">
                        <!-- Form will be loaded here -->
                    </div>
                </div>
            `;

            modal.appendChild(formContainer);
            document.body.appendChild(modal);
            modal.id = 'hybridProControlModal';

            // Close on background click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeHybridProControlModal();
                }
            });

            // Create inline form
            const container = document.getElementById('hybridProControlContainer');
            if (container) {
                container.innerHTML = `
                    <div style="margin-bottom: 20px; border-bottom: 2px solid #ddd; padding-bottom: 10px;">
                        <h2 style="margin: 0 0 5px 0; color: #333;">☀️ Hybrid Pro Control</h2>
                        <p style="margin: 0; color: #666; font-size: 14px;">Einstellungen für Hybrid-Wärmepumpensysteme</p>
                    </div>

                    <div id="hybridTabs" style="display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid #ddd; flex-wrap: wrap;">
                        <button class="hybrid-tab-btn active" onclick="switchHybridTab(event, 'electricity')" style="padding: 10px 15px; border: none; background: #f5f5f5; cursor: pointer; border-radius: 4px 4px 0 0; color: #666; font-weight: 500; transition: all 0.3s ease;">💡 Stromtarife</button>
                        <button class="hybrid-tab-btn" onclick="switchHybridTab(event, 'strategy')" style="padding: 10px 15px; border: none; background: #f5f5f5; cursor: pointer; border-radius: 4px 4px 0 0; color: #666; font-weight: 500; transition: all 0.3s ease;">⚙️ Regelstrategie</button>
                        <button class="hybrid-tab-btn" onclick="switchHybridTab(event, 'energyFactors')" style="padding: 10px 15px; border: none; background: #f5f5f5; cursor: pointer; border-radius: 4px 4px 0 0; color: #666; font-weight: 500; transition: all 0.3s ease;">📊 Primärenergiefaktoren</button>
                        <button class="hybrid-tab-btn" onclick="switchHybridTab(event, 'fossil')" style="padding: 10px 15px; border: none; background: #f5f5f5; cursor: pointer; border-radius: 4px 4px 0 0; color: #666; font-weight: 500; transition: all 0.3s ease;">🔥 Fossile Brennstoffe</button>
                    </div>

                    <form id="hybridProControlForm" style="margin-bottom: 20px;">
                        <!-- Electricity Prices Tab -->
                        <div id="electricity-tab" style="display: block; background: #f9f9f9; padding: 15px; border-radius: 4px; margin-bottom: 15px;">
                            <h3 style="margin: 0 0 10px 0; color: #333;">Elektrizitätstarife</h3>
                            <p style="margin: 0 0 15px 0; color: #888; font-size: 13px;">Einheit: EUR/kWh</p>

                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">Niedertarif (Low) <span style="color: #2196F3; font-size: 12px;">ℹ️</span></label>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <input type="number" id="electricityPriceLow" name="electricityPriceLow" step="0.001" min="0" placeholder="z.B. 0.15" required style="flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                                    <span style="white-space: nowrap; color: #666; font-size: 13px; padding: 8px 10px; background: #f0f0f0; border-radius: 4px;">EUR/kWh</span>
                                </div>
                            </div>

                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">Normaltarif (Normal) <span style="color: #2196F3; font-size: 12px;">ℹ️</span></label>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <input type="number" id="electricityPriceNormal" name="electricityPriceNormal" step="0.001" min="0" placeholder="z.B. 0.28" required style="flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                                    <span style="white-space: nowrap; color: #666; font-size: 13px; padding: 8px 10px; background: #f0f0f0; border-radius: 4px;">EUR/kWh</span>
                                </div>
                            </div>
                        </div>

                        <!-- Control Strategy Tab -->
                        <div id="strategy-tab" style="display: none; background: #f9f9f9; padding: 15px; border-radius: 4px; margin-bottom: 15px;">
                            <h3 style="margin: 0 0 10px 0; color: #333;">Regelstrategie</h3>
                            <p style="margin: 0 0 15px 0; color: #888; font-size: 13px;">Auswahl der Betriebsstrategie für das Hybrid-System</p>

                            <div style="margin: 0;">
                                <div style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 15px; padding: 12px; background: white; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; transition: all 0.2s ease;">
                                    <input type="radio" id="strategy-constant" name="controlStrategy" value="constant" style="cursor: pointer; accent-color: #4CAF50; margin-top: 2px;">
                                    <label for="strategy-constant" style="margin: 0; cursor: pointer; flex: 1;"><strong>Konstanttemperatur</strong><br><span style="color: #666; font-size: 13px;">Konstante Rücklauftemperatur unabhängig von Außentemperatur</span></label>
                                </div>

                                <div style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 15px; padding: 12px; background: white; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; transition: all 0.2s ease;">
                                    <input type="radio" id="strategy-ecological" name="controlStrategy" value="ecological" style="cursor: pointer; accent-color: #4CAF50; margin-top: 2px;">
                                    <label for="strategy-ecological" style="margin: 0; cursor: pointer; flex: 1;"><strong>Ökologisch</strong><br><span style="color: #666; font-size: 13px;">Maximaler Einsatz der Wärmepumpe für geringere CO₂-Emissionen</span></label>
                                </div>

                                <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: white; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; transition: all 0.2s ease;">
                                    <input type="radio" id="strategy-economic" name="controlStrategy" value="economic" style="cursor: pointer; accent-color: #4CAF50; margin-top: 2px;">
                                    <label for="strategy-economic" style="margin: 0; cursor: pointer; flex: 1;"><strong>Ökonomisch</strong><br><span style="color: #666; font-size: 13px;">Optimierung der Betriebskosten unter Berücksichtigung der Strompreise</span></label>
                                </div>
                            </div>
                        </div>

                        <!-- Energy Factors Tab -->
                        <div id="energyFactors-tab" style="display: none; background: #f9f9f9; padding: 15px; border-radius: 4px; margin-bottom: 15px;">
                            <h3 style="margin: 0 0 10px 0; color: #333;">Primärenergiefaktoren</h3>
                            <p style="margin: 0 0 15px 0; color: #888; font-size: 13px;">Wertangaben für die Effizienzberechnung</p>

                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">Primärenergiefaktor Wärmepumpe <span style="color: #2196F3; font-size: 12px;">ℹ️</span></label>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <input type="number" id="heatPumpEnergyFactor" name="heatPumpEnergyFactor" step="0.01" min="0" placeholder="z.B. 2.4" required style="flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                                    <span style="white-space: nowrap; color: #666; font-size: 13px; padding: 8px 10px; background: #f0f0f0; border-radius: 4px;">(dimensionslos)</span>
                                </div>
                                <small style="display: block; margin-top: 4px; color: #999; font-size: 12px;">Typisch: 2.0 - 3.5 für moderne Wärmepumpen</small>
                            </div>

                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">Primärenergiefaktor Fossil (Kessel) <span style="color: #2196F3; font-size: 12px;">ℹ️</span></label>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <input type="number" id="fossilEnergyFactor" name="fossilEnergyFactor" step="0.01" min="0" placeholder="z.B. 1.1" required style="flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                                    <span style="white-space: nowrap; color: #666; font-size: 13px; padding: 8px 10px; background: #f0f0f0; border-radius: 4px;">(dimensionslos)</span>
                                </div>
                                <small style="display: block; margin-top: 4px; color: #999; font-size: 12px;">Typisch: 1.0 - 1.3 für Gasheizungen</small>
                            </div>
                        </div>

                        <!-- Fossil Fuels Tab -->
                        <div id="fossil-tab" style="display: none; background: #f9f9f9; padding: 15px; border-radius: 4px; margin-bottom: 15px;">
                            <h3 style="margin: 0 0 10px 0; color: #333;">Energiekosten externer Wärmeerzeuger (Fossil)</h3>
                            <p style="margin: 0 0 15px 0; color: #888; font-size: 13px;">Einheit: EUR/kWh (für Gas) oder EUR/Liter (für Öl)</p>

                            <div style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px; margin-bottom: 15px; border-radius: 4px; color: #1976d2; font-size: 13px;">
                                💡 <strong>Hinweis:</strong> Diese Werte sind optional und werden für erweiterte Kostenberechnungen verwendet.
                            </div>

                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">Niedertarif (Low) <span style="color: #2196F3; font-size: 12px;">ℹ️</span></label>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <input type="number" id="fossilPriceLow" name="fossilPriceLow" step="0.001" min="0" placeholder="z.B. 0.08" style="flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                                    <span style="white-space: nowrap; color: #666; font-size: 13px; padding: 8px 10px; background: #f0f0f0; border-radius: 4px;">EUR/kWh</span>
                                </div>
                            </div>

                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">Normaltarif (Normal) <span style="color: #2196F3; font-size: 12px;">ℹ️</span></label>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <input type="number" id="fossilPriceNormal" name="fossilPriceNormal" step="0.001" min="0" placeholder="z.B. 0.10" style="flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                                    <span style="white-space: nowrap; color: #666; font-size: 13px; padding: 8px 10px; background: #f0f0f0; border-radius: 4px;">EUR/kWh</span>
                                </div>
                            </div>
                        </div>
                    </form>

                    <div style="display: flex; gap: 10px; align-items: center; margin-top: 20px; flex-wrap: wrap;">
                        <button onclick="saveHybridProControlFromModal()" style="padding: 10px 20px; background: #4CAF50; color: white; border: none; border-radius: 4px; font-weight: 500; cursor: pointer;">💾 Einstellungen speichern</button>
                        <button onclick="resetHybridProControl()" style="padding: 10px 20px; background: #f0f0f0; color: #333; border: 1px solid #ddd; border-radius: 4px; font-weight: 500; cursor: pointer;">🔄 Zurücksetzen</button>
                        <div id="hybridProControlStatus" style="flex: 1; min-height: 20px; font-size: 13px; display: flex; align-items: center;"></div>
                    </div>
                `;

                // Add close button
                const closeBtn = document.createElement('button');
                closeBtn.textContent = '✕';
                closeBtn.style.cssText = `
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    background: none;
                    border: none;
                    font-size: 24px;
                    cursor: pointer;
                    color: #666;
                    z-index: 10001;
                `;
                closeBtn.onclick = closeHybridProControlModal;
                formContainer.querySelector('div').appendChild(closeBtn);

                // Load settings after a small delay to ensure DOM is ready
                setTimeout(() => {
                    loadHybridProControlSettings(installationId, deviceId, accountId);
                }, 100);
            }
        }

        function closeHybridProControlModal() {
            const modal = document.getElementById('hybridProControlModal');
            if (modal) {
                modal.remove();
            }
        }

        // Switch between Hybrid Pro Control tabs
        function switchHybridTab(event, tabName) {
            // Remove active class from all buttons
            document.querySelectorAll('#hybridTabs .hybrid-tab-btn').forEach(btn => {
                btn.style.background = '#f5f5f5';
                btn.style.color = '#666';
            });

            // Hide all tab contents
            ['electricity', 'strategy', 'energyFactors', 'fossil'].forEach(tab => {
                const tabEl = document.getElementById(tab + '-tab');
                if (tabEl) tabEl.style.display = 'none';
            });

            // Activate clicked button
            event.target.style.background = '#4CAF50';
            event.target.style.color = 'white';

            // Show clicked tab
            const tabEl = document.getElementById(tabName + '-tab');
            if (tabEl) tabEl.style.display = 'block';
        }

        // Load Hybrid Pro Control settings (from both API and saved settings)
        async function loadHybridProControlSettings(installationId, deviceId, accountId) {
            try {
                // Get form elements (wait a bit to ensure they exist)
                const elLow = document.getElementById('electricityPriceLow');
                const elNorm = document.getElementById('electricityPriceNormal');
                const hpFactor = document.getElementById('heatPumpEnergyFactor');
                const fosFactor = document.getElementById('fossilEnergyFactor');
                const fosPriceLow = document.getElementById('fossilPriceLow');
                const fosPriceNorm = document.getElementById('fossilPriceNormal');

                if (!elLow) {
                    console.warn('Form elements not found, retrying in 300ms...');
                    setTimeout(() => loadHybridProControlSettings(installationId, deviceId, accountId), 300);
                    return;
                }

                // First, try to load saved settings from our API
                console.log('Loading hybrid settings for:', {installationId, deviceId, accountId});
                const params = new URLSearchParams({
                    accountId: accountId,
                    installationId: installationId,
                    deviceId: deviceId
                });

                let savedSettings = null;
                try {
                    const response = await fetch(`/api/hybrid-pro-control/get?${params}`);
                    const data = await response.json();
                    console.log('Saved settings response:', data);
                    if (data.success && data.settings) {
                        savedSettings = data.settings;
                    }
                } catch (e) {
                    console.log('No saved settings found');
                }

                // Also get current API values from keyFeatures (which are in the dashboard)
                const kf = window.currentKeyFeatures || {};
                console.log('Current API values from dashboard:', {
                    hybridElectricityPriceLow: kf.hybridElectricityPriceLow,
                    hybridElectricityPriceNormal: kf.hybridElectricityPriceNormal,
                    hybridHeatPumpEnergyFactor: kf.hybridHeatPumpEnergyFactor,
                    hybridFossilEnergyFactor: kf.hybridFossilEnergyFactor,
                    hybridFossilPriceLow: kf.hybridFossilPriceLow,
                    hybridFossilPriceNormal: kf.hybridFossilPriceNormal
                });

                // Helper to format number with up to 4 decimal places (but remove trailing zeros)
                const formatDecimal = (val) => {
                    if (!val) return '';
                    const num = parseFloat(val);
                    // Show up to 4 decimal places, but remove trailing zeros
                    return num.toFixed(4).replace(/\.?0+$/, '');
                };

                // Populate form: prefer saved settings, fallback to API values
                if (savedSettings && savedSettings.electricityPriceLow) {
                    elLow.value = formatDecimal(savedSettings.electricityPriceLow);
                } else if (kf.hybridElectricityPriceLow?.value) {
                    elLow.value = formatDecimal(kf.hybridElectricityPriceLow.value);
                }

                if (savedSettings && savedSettings.electricityPriceNormal) {
                    elNorm.value = formatDecimal(savedSettings.electricityPriceNormal);
                } else if (kf.hybridElectricityPriceNormal?.value) {
                    elNorm.value = formatDecimal(kf.hybridElectricityPriceNormal.value);
                }

                if (savedSettings && savedSettings.heatPumpEnergyFactor) {
                    hpFactor.value = formatDecimal(savedSettings.heatPumpEnergyFactor);
                } else if (kf.hybridHeatPumpEnergyFactor?.value) {
                    hpFactor.value = formatDecimal(kf.hybridHeatPumpEnergyFactor.value);
                }

                if (savedSettings && savedSettings.fossilEnergyFactor) {
                    fosFactor.value = formatDecimal(savedSettings.fossilEnergyFactor);
                } else if (kf.hybridFossilEnergyFactor?.value) {
                    fosFactor.value = formatDecimal(kf.hybridFossilEnergyFactor.value);
                }

                if (savedSettings && savedSettings.fossilPriceLow) {
                    fosPriceLow.value = formatDecimal(savedSettings.fossilPriceLow);
                } else if (kf.hybridFossilPriceLow?.value) {
                    fosPriceLow.value = formatDecimal(kf.hybridFossilPriceLow.value);
                }

                if (savedSettings && savedSettings.fossilPriceNormal) {
                    fosPriceNorm.value = formatDecimal(savedSettings.fossilPriceNormal);
                } else if (kf.hybridFossilPriceNormal?.value) {
                    fosPriceNorm.value = formatDecimal(kf.hybridFossilPriceNormal.value);
                }

                if (savedSettings && savedSettings.controlStrategy) {
                    const strategyRadio = document.getElementById('strategy-' + savedSettings.controlStrategy);
                    if (strategyRadio) {
                        strategyRadio.checked = true;
                        console.log('Selected strategy:', savedSettings.controlStrategy);
                    }
                }

                console.log('✅ Settings loaded and form populated');
            } catch (error) {
                console.error('Error loading hybrid settings:', error);
            }
        }

        // Save Hybrid Pro Control settings from modal
        function saveHybridProControlFromModal() {
            if (hybridModalParams.installationId && hybridModalParams.deviceId && hybridModalParams.accountId) {
                saveHybridProControl(hybridModalParams.installationId, hybridModalParams.deviceId, hybridModalParams.accountId);
            } else {
                showHybridStatus('❌ Fehler: Keine Geräte-Informationen verfügbar', 'error');
            }
        }

        // Save Hybrid Pro Control settings
        async function saveHybridProControl(installationId, deviceId, accountId) {
            // Get current form values
            const electricityLow = document.getElementById('electricityPriceLow').value;
            const electricityNormal = document.getElementById('electricityPriceNormal').value;
            const strategy = document.querySelector('input[name="controlStrategy"]:checked');
            const heatPumpFactor = document.getElementById('heatPumpEnergyFactor').value;
            const fossilFactor = document.getElementById('fossilEnergyFactor').value;
            const fossilPriceLow = document.getElementById('fossilPriceLow').value;
            const fossilPriceNorm = document.getElementById('fossilPriceNormal').value;

            // Check if at least ONE field has been filled in
            if (!electricityLow && !electricityNormal && !strategy && !heatPumpFactor && !fossilFactor && !fossilPriceLow && !fossilPriceNorm) {
                showHybridStatus('❌ Bitte füllen Sie mindestens ein Feld aus', 'error');
                return;
            }

            // Load current saved settings to merge with new values
            const params = new URLSearchParams({
                accountId: accountId,
                installationId: installationId,
                deviceId: deviceId
            });

            let currentSettings = null;
            try {
                const response = await fetch(`/api/hybrid-pro-control/get?${params}`);
                const data = await response.json();
                if (data.success && data.settings) {
                    currentSettings = data.settings;
                }
            } catch (e) {
                console.log('No existing settings found');
            }

            // Also get current API values as fallback
            const kf = window.currentKeyFeatures || {};

            // Build settings object: use filled values, keep existing values for empty fields
            const settings = {
                electricityPriceLow: electricityLow ? parseFloat(electricityLow) :
                                   (currentSettings?.electricityPriceLow || kf.hybridElectricityPriceLow?.value || 0),
                electricityPriceNormal: electricityNormal ? parseFloat(electricityNormal) :
                                       (currentSettings?.electricityPriceNormal || kf.hybridElectricityPriceNormal?.value || 0),
                controlStrategy: strategy ? strategy.value :
                               (currentSettings?.controlStrategy || ''),
                heatPumpEnergyFactor: heatPumpFactor ? parseFloat(heatPumpFactor) :
                                     (currentSettings?.heatPumpEnergyFactor || kf.hybridHeatPumpEnergyFactor?.value || 0),
                fossilEnergyFactor: fossilFactor ? parseFloat(fossilFactor) :
                                   (currentSettings?.fossilEnergyFactor || kf.hybridFossilEnergyFactor?.value || 0),
                fossilPriceLow: fossilPriceLow ? parseFloat(fossilPriceLow) :
                               (currentSettings?.fossilPriceLow || kf.hybridFossilPriceLow?.value || 0),
                fossilPriceNormal: fossilPriceNorm ? parseFloat(fossilPriceNorm) :
                                  (currentSettings?.fossilPriceNormal || kf.hybridFossilPriceNormal?.value || 0)
            };

            const request = {
                accountId: accountId,
                installationId: installationId,
                deviceId: deviceId,
                settings: settings
            };

            showHybridStatus('Speichern...', 'loading');

            try {
                const response = await fetch('/api/hybrid-pro-control/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(request)
                });

                const data = await response.json();

                if (data.success) {
                    showHybridStatus('✅ Einstellungen erfolgreich gespeichert', 'success');
                } else {
                    showHybridStatus('❌ Fehler: ' + (data.error || 'Unbekannter Fehler'), 'error');
                }
            } catch (error) {
                showHybridStatus('❌ Fehler beim Speichern: ' + error.message, 'error');
            }
        }

        // Reset Hybrid Pro Control form
        function resetHybridProControl() {
            // Get current values from server and reload form
            const form = document.getElementById('hybridProControlForm');
            if (form) {
                form.reset();
                // Use stored parameters
                if (hybridModalParams.installationId && hybridModalParams.deviceId && hybridModalParams.accountId) {
                    loadHybridProControlSettings(hybridModalParams.installationId, hybridModalParams.deviceId, hybridModalParams.accountId);
                }
            }
        }

        // Store parameters for use in hybrid modal
        let hybridModalParams = {
            installationId: null,
            deviceId: null,
            accountId: null,
            gatewaySerial: null
        };

        // Load saved hybrid pro control settings and store globally
        async function loadSavedHybridProControlSettings(accountId, installationId, deviceId) {
            try {
                const params = new URLSearchParams({
                    accountId: accountId,
                    installationId: installationId,
                    deviceId: deviceId
                });

                const response = await fetch(`/api/hybrid-pro-control/get?${params}`);
                const data = await response.json();

                if (data.success && data.settings) {
                    // Store saved settings globally
                    window.savedHybridProControlSettings = data.settings;
                    console.log('✅ Saved Hybrid Pro Control settings loaded:', data.settings);
                } else {
                    window.savedHybridProControlSettings = null;
                    console.log('No saved hybrid settings found');
                }
            } catch (error) {
                console.error('Error loading saved hybrid settings:', error);
                window.savedHybridProControlSettings = null;
            }
        }

        // Show status message for Hybrid Pro Control
        function showHybridStatus(message, type) {
            const statusDiv = document.getElementById('hybridProControlStatus');
            if (!statusDiv) return;

            statusDiv.textContent = message;
            statusDiv.style.color = type === 'success' ? '#2e7d32' : type === 'error' ? '#c62828' : '#f57f17';

            if (type === 'success' || type === 'error') {
                setTimeout(() => {
                    statusDiv.textContent = '';
                }, 4000);
            }
        }

        // Make functions available globally
        window.openHybridProControlModal = openHybridProControlModal;
        window.closeHybridProControlModal = closeHybridProControlModal;
        window.switchHybridTab = switchHybridTab;
        window.saveHybridProControl = saveHybridProControl;
        window.saveHybridProControlFromModal = saveHybridProControlFromModal;
        window.resetHybridProControl = resetHybridProControl;

        // Initialize
        init();
