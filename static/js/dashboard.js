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

                // If gatewaySerial not set yet, get it from first device BEFORE updating dropdown
                if (!currentGatewaySerial && currentInstallationId) {
                    const currentInstall = devicesByInstall.find(i => i.installationId === currentInstallationId);
                    if (currentInstall && currentInstall.devices && currentInstall.devices.length > 0) {
                        // Just take the first device and initialize both deviceId AND gatewaySerial
                        const firstDevice = currentInstall.devices[0];
                        currentDeviceId = firstDevice.deviceId;
                        currentGatewaySerial = firstDevice.gatewaySerial || '';
                        console.log('Initialized with first device:', currentDeviceId, 'Gateway:', currentGatewaySerial);
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

                currentInstall.devices.forEach(device => {
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
                const deviceExists = currentInstall.devices.some(d => `${d.gatewaySerial}_${d.deviceId}` === currentKey);
                if (!deviceExists && currentInstall.devices.length > 0) {
                    const firstDevice = currentInstall.devices[0];
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

            // Extract key features
            const keyFeatures = extractKeyFeatures(features);

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

                // Device info header (if available)
                if (features.deviceInfo) {
                    html += renderDeviceHeader(features.deviceInfo, keyFeatures);
                }

                // Main temperature displays (outside, supply)
                html += renderMainTemperatures(keyFeatures);

                // Detect heating circuits first
                const circuits = detectHeatingCircuits(features);
                console.log('Rendering circuits:', circuits);

                // Store heating curve data per circuit for later use
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

                // Store data for each circuit
                for (const circuitId of circuits) {
                    const circuitPrefix = `heating.circuits.${circuitId}`;
                    const find = (exactName) => {
                        for (const category of [features.circuits, features.operatingModes, features.temperatures, features.other]) {
                            if (category && category[exactName] && category[exactName].value !== null && category[exactName].value !== undefined) {
                                return category[exactName];
                            }
                        }
                        return null;
                    };
                    const findNested = (featureName, propertyName) => {
                        for (const category of [features.circuits, features.operatingModes, features.temperatures, features.other]) {
                            if (category && category[featureName]) {
                                const feature = category[featureName];
                                if (feature.type === 'object' && feature.value && typeof feature.value === 'object') {
                                    const nestedValue = feature.value[propertyName];
                                    if (nestedValue && nestedValue.value !== undefined) {
                                        return nestedValue.value;
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

                // Additional sensors & pumps
                html += renderAdditionalSensors(keyFeatures);

                // Refrigerant circuit (heat pump only)
                html += renderRefrigerantCircuit(keyFeatures);

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
                setTimeout(() => {
                    // Render chart for each circuit that has heating curve data
                    for (const circuitId in window.heatingCurveData) {
                        if (circuitId !== 'slope' && circuitId !== 'shift' && circuitId !== 'currentOutside' &&
                            circuitId !== 'currentSupply' && circuitId !== 'maxSupply' && circuitId !== 'minSupply' &&
                            circuitId !== 'roomTempSetpoint') {
                            const data = window.heatingCurveData[circuitId];
                            if (data && (data.slope !== null || data.shift !== null)) {
                                renderHeatingCurveChart(parseInt(circuitId));
                            }
                        }
                    }
                }, 100);
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
                        if (category[exactName] && category[exactName].value !== null && category[exactName].value !== undefined) {
            return category[exactName];
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
                        if (feature.type === 'object' && feature.value && typeof feature.value === 'object') {
            const nestedValue = feature.value[propertyName];
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
                scop: find(['heating.scop.total', 'heating.spf.total']),
                scopHeating: find(['heating.scop.heating', 'heating.spf.heating']),
                scopDhw: find(['heating.scop.dhw', 'heating.spf.dhw']),
                seerCooling: find(['heating.seer.cooling']),

                // Valves and auxiliary systems
                fourWayValve: find(['heating.valves.fourThreeWay.position']),
                secondaryHeater: find(['heating.secondaryHeatGenerator.state', 'heating.secondaryHeatGenerator.status']),

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
                compressorStats: find(['heating.compressors.0.statistics']),

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
            for (const category of [features.circuits, features.operatingModes, features.temperatures]) {
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
                temps += `
                    <div class="temp-item">
                        <span class="temp-label">Primärkreis-Vorlauf</span>
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
                const isRunning = kf.compressorSpeed && kf.compressorSpeed.value > 0;

                // Convert speed to RPM if unit is revolutionsPerSecond
                let speedValue = kf.compressorSpeed && kf.compressorSpeed.value !== undefined ? kf.compressorSpeed.value : 0;
                let speedUnit = kf.compressorSpeed && kf.compressorSpeed.value !== undefined ? kf.compressorSpeed.unit : '';

                if (speedUnit === 'revolutionsPerSecond') {
                    speedValue = speedValue * 60;
                    speedUnit = 'U/min';
                }

                // Extract compressor statistics
                let compressorHours = 0;
                let compressorStarts = 0;
                let avgRuntime = 0;

                if (kf.compressorStats && kf.compressorStats.value) {
                    const stats = kf.compressorStats.value;
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

            // Extract circuit-specific features
            const find = (exactNames) => {
                if (!Array.isArray(exactNames)) exactNames = [exactNames];
                for (const exactName of exactNames) {
                    for (const category of [features.temperatures, features.circuits, features.operatingModes, features.other]) {
                        if (category && category[exactName] && category[exactName].value !== null && category[exactName].value !== undefined) {
                            return category[exactName];
                        }
                    }
                }
                return null;
            };

            const findNested = (featureName, propertyName) => {
                for (const category of [features.circuits, features.operatingModes, features.temperatures, features.other]) {
                    if (category && category[featureName]) {
                        const feature = category[featureName];
                        if (feature.type === 'object' && feature.value && typeof feature.value === 'object') {
                            const nestedValue = feature.value[propertyName];
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
                const availableModes = find([`${circuitPrefix}.operating.modes.dhwAndHeating`]) ?
                    ['heating', 'standby', 'dhwAndHeating'] : ['heating', 'standby'];

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
                    'climateCircuitOne': 'Integrierter Pufferspeicher',
                    'climatCircuitTwoDefrost': 'Leerlauf'
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

            // Noise Reduction (heat pump)
            if (kf.noiseReductionExists) {
                const currentApiMode = kf.noiseReductionMode ? kf.noiseReductionMode.value : 'notReduced';
                sensors += `
                    <div class="status-item">
                        <span class="status-label">Geräuschreduzierung</span>
                        <span class="status-value">
                            <select id="noiseReductionModeSelect" onchange="changeNoiseReductionMode(this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                                <option value="notReduced" ${currentApiMode === 'notReduced' ? 'selected' : ''}>Aus</option>
                                <option value="slightlyReduced" ${currentApiMode === 'slightlyReduced' ? 'selected' : ''}>Leicht reduziert</option>
                                <option value="maxReduced" ${currentApiMode === 'maxReduced' ? 'selected' : ''}>Maximal reduziert</option>
                            </select>
                        </span>
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
                    'standby': 'Standby'
                };
                const currentMode = kf.operatingMode.value;

                status += `
                    <div class="status-item">
                        <span class="status-label">Betriebsmodus</span>
                        <span class="status-value">
                            <select id="heatingModeSelect" onchange="changeHeatingMode(this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                                <option value="heating" ${currentMode === 'heating' ? 'selected' : ''}>Heizen</option>
                                <option value="standby" ${currentMode === 'standby' ? 'selected' : ''}>Standby</option>
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

            // JAZ / SCOP / SPF values (Coefficient of Performance)
            if (kf.scop || kf.scopHeating || kf.scopDhw || kf.seerCooling) {
                info += `
                    <div class="status-item" style="grid-column: 1 / -1; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 10px; padding-top: 10px;">
                        <span class="status-label" style="font-weight: 600; color: #667eea;">Coefficient of Performance (JAZ)</span>
                    </div>
                `;

                if (kf.scop) {
                    info += `
                        <div class="status-item">
            <span class="status-label">JAZ Gesamt</span>
            <span class="status-value">${formatNum(kf.scop.value)}</span>
                        </div>
                    `;
                }

                if (kf.scopHeating) {
                    info += `
                        <div class="status-item">
            <span class="status-label">JAZ Heizen</span>
            <span class="status-value">${formatNum(kf.scopHeating.value)}</span>
                        </div>
                    `;
                }

                if (kf.scopDhw) {
                    info += `
                        <div class="status-item">
            <span class="status-label">JAZ Warmwasser</span>
            <span class="status-value">${formatNum(kf.scopDhw.value)}</span>
                        </div>
                    `;
                }

                if (kf.seerCooling) {
                    info += `
                        <div class="status-item">
            <span class="status-label">JAZ Kühlen (SEER)</span>
            <span class="status-value">${formatNum(kf.seerCooling.value)}</span>
                        </div>
                    `;
                }
            }

            // Compressor statistics (Lastklassen / Load classes)
            if (kf.compressorStats) {
                const stats = kf.compressorStats.value;

                // Debug: Log the statistics structure
                console.log('📊 Compressor Statistics:', stats);

                if (stats && typeof stats === 'object') {
                    // Check if this has the nested structure (hours/starts from heating.compressors.0.statistics)
                    // These are shown in the Kompressor card, so skip them here
                    const hasHoursStarts = stats.hours && stats.hours.value !== undefined;

                    if (!hasHoursStarts) {
                        // This is the load class data (heating.compressors.0.statistics with loadClassOne, etc.)
                        info += `
            <div class="status-item" style="grid-column: 1 / -1; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 10px; padding-top: 10px;">
                <span class="status-label" style="font-weight: 600; color: #667eea;">Kältemittelkreislauf 1 - Betriebsstunden</span>
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
                    info += `
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
                const modeText = mode === 'heating' ? 'Heizen' : mode === 'cooling' ? 'Kühlen' : 'Standby';
                const badgeClass = mode === 'heating' ? 'badge-info' : mode === 'cooling' ? 'badge-success' : 'badge-warning';
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

                if (data.success && data.compressorRpmMin && data.compressorRpmMax) {
                    const deviceKey = `${installationId}_${deviceId}`;
                    window.deviceSettingsCache[deviceKey] = {
                        min: data.compressorRpmMin,
                        max: data.compressorRpmMax
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

                showDeviceSettingsModal(installationId, deviceId, data.compressorRpmMin || 0, data.compressorRpmMax || 0);
            } catch (error) {
                console.error('Error loading device settings:', error);
                showDeviceSettingsModal(installationId, deviceId, 0, 0);
            }
        }

        function showDeviceSettingsModal(installationId, deviceId, currentMin, currentMax) {
            const modal = document.createElement('div');
            modal.className = 'debug-modal';
            modal.style.display = 'flex';
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

            try {
                const response = await fetch('/api/device-settings/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        accountId: accountId,
                        installationId: installationId,
                        deviceId: deviceId,
                        compressorRpmMin: rpmMin,
                        compressorRpmMax: rpmMax
                    })
                });

                const data = await response.json();

                if (data.success) {
                    // Update cache
                    const deviceKey = `${installationId}_${deviceId}`;
                    window.deviceSettingsCache[deviceKey] = { min: rpmMin, max: rpmMax };

                    alert('Einstellungen gespeichert!');
                    closeDeviceSettingsModal();

                    // Reload dashboard to show updated percentages
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

        // Noise Reduction Mode Change Function
        async function changeNoiseReductionMode(newMode) {
            const select = document.getElementById('noiseReductionModeSelect');
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

                const response = await fetch('/api/noise-reduction/mode/set', {
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
                    console.log('Noise reduction mode changed to:', newMode);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern der Geräuschreduzierung: ' + data.error);
                    select.value = originalValue;
                    select.disabled = false;
                }
            } catch (error) {
                alert('Fehler beim Ändern der Geräuschreduzierung: ' + error.message);
                select.value = originalValue;
                select.disabled = false;
            }
        }

        // Make changeNoiseReductionMode available globally
        window.changeNoiseReductionMode = changeNoiseReductionMode;

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

        // Make functions available globally
        window.changeDhwTemperature = changeDhwTemperature;
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

        // Initialize
        init();
