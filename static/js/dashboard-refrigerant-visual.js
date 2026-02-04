// Refrigerant Circuit Visualization
// Visual representation of the heat pump refrigerant cycle with real-time data overlay

// Helper function to get water density based on temperature
function getWaterDensity(tempC) {
    // Approximate water density as function of temperature (kg/m³)
    // Linear approximation: ρ(T) ≈ 1000 - 0.3 × T
    return 1000 - 0.3 * tempC;
}

function renderRefrigerantCircuitVisual(keyFeatures) {
    // Check if we have compressor data (heat pump only)
    const hasCompressor = keyFeatures.compressorActive !== null ||
                         keyFeatures.compressorSpeed !== null ||
                         keyFeatures.compressorInletTemp !== null;

    if (!hasCompressor) {
        return ''; // Not a heat pump, don't show visualization
    }

    // Determine if compressor is active
    const compressorActive = keyFeatures.compressorActive?.value === true ||
                            (keyFeatures.compressorSpeed?.value && keyFeatures.compressorSpeed.value > 0);

    // Select base image (active or inactive)
    let baseImage = compressorActive ?
        '/static/img/vitocal/Kaeltekreislauf%20ein.jpg' : '/static/img/vitocal/Kaeltekreislauf%20aus.jpg';
	if (compressorActive && keyFeatures?.fourWayValve && 
		(keyFeatures.fourWayValve.value === 'climatCircuitTwoDefrost' || keyFeatures.fourWayValve.value === 'climateCircuitTwoDefrostDomesticHotWater' || keyFeatures.fourWayValve.value === 'defrost')) {
        baseImage = '/static/img/vitocal/Kaeltekreislauf%20abtau.jpg';
    }

    // Determine component states
    const fanActive = (keyFeatures.fan0?.value && keyFeatures.fan0.value > 0) ||
                     (keyFeatures.fan1?.value && keyFeatures.fan1.value > 0);

    // Check if DHW is active (heating domestic hot water)
	let dhw_exists = false;
	let dhw_image =  ""; // no dhw 
    // Check if DHW exists or on intended temperature or is active (heating domestic hot water)
	if (keyFeatures.dhwStatus?.value === 'off' || keyFeatures.dhwStatus?.value === 'inactive'){
		dhw_exists = true;
		dhw_image = "/static/img/vitocal/Warmwasserspeicher%20aus.png"; // dhw is off 
	} else{
	  if (keyFeatures.dhwTemp?.value && keyFeatures.dhwTarget?.value){
		dhw_exists = true;
		dhw_image = "/static/img/vitocal/Warmwasserspeicher%20temp.png"; // dhw has intended temp
		if ( keyFeatures?.dhwHysteresisSwitchOn?.value ){
			if (keyFeatures.dhwTemp.value <= (keyFeatures.dhwTarget.value - keyFeatures.dhwHysteresisSwitchOn.value)){
				dhw_image = "/static/img/vitocal/Warmwasserspeicher_cold.png"; // dhw has low temp
			}
		}
	  } 
	}
    if (keyFeatures.dhwStatus?.value === 'on' || keyFeatures.dhwStatus?.value === 'active'){
		dhw_exists = true;
		dhw_image = "/static/img/vitocal/Warmwasserspeicher%20ein.png"; // dhw is heating
	}

    // Check if heating circuit is active
    const heatingActive = keyFeatures.operatingMode?.value === 'heating' ||
                         keyFeatures.operatingMode?.value === 'dhwAndHeating';

    // Check if electric heater (Heizstab) is active
    // This would typically be a secondary heater or backup heater
    const heaterActive = keyFeatures.secondaryHeater?.value === 'on' ||
                        keyFeatures.secondaryHeater?.value === true ||
                        keyFeatures.secondaryHeatGeneratorStatus?.value === 'on';

    // Calculate compressor speed with percentage if device settings available
    let compressorSpeedValue = null;
    let compressorSpeedUnit = '';
    if (keyFeatures.compressorSpeed?.value) {
        let speedValue = keyFeatures.compressorSpeed.value;
        const speedUnit = keyFeatures.compressorSpeed.unit;

        // Convert revolutionsPerSecond to RPM
        if (speedUnit === 'revolutionsPerSecond') {
            speedValue = speedValue * 60;
        }

        // Get device settings for RPM percentage calculation
        const deviceInfo = window.currentDeviceInfo;
        let rpmPercentage = null;
        if (deviceInfo && window.deviceSettingsCache) {
            const deviceKey = deviceInfo.installationId + '_' + deviceInfo.deviceId;
            const settings = window.deviceSettingsCache[deviceKey];
            if (settings && settings.max > settings.min && speedValue > 0) {
                rpmPercentage = Math.round(((speedValue - settings.min) / (settings.max - settings.min)) * 100);
                rpmPercentage = Math.max(0, Math.min(100, rpmPercentage));
            }
        }

        // Use percentage if available, otherwise RPM
        if (rpmPercentage !== null) {
            compressorSpeedValue = rpmPercentage;
            compressorSpeedUnit = '%';
        } else {
            compressorSpeedValue = speedValue;
            compressorSpeedUnit = 'RPM';
        }
    }

    // Map values according to Mapping.png
    const values = {
        // A: Lüfter 1 (Drehzahl Ventilator 1)
        fan1: keyFeatures.fan0?.value || null,
        // B: Lüfter 2 (Drehzahl Ventilator 2)
        fan2: keyFeatures.fan1?.value || null,
        // C: Verdampfer Überhitzung (Flüssiggastemperatur kühlen)
        evaporatorOverheat: keyFeatures.evaporatorOverheat?.value || null,
        // D: Öffnungsweite elektr. Expansionsventil (not available via API)
        expansionValve1: null,
        // E: Economizer (Sauggastemperatur Heizen)
        economizer: keyFeatures.economizerTemp?.value || null,
        // F: Öffnungsweite des elektr. Expansionsventil 2 (not available via API)
        expansionValve2: null,
        // G: Verdampfer Überhitzung (Sauggastemperatur Verdampfer)
        evaporatorTemp: keyFeatures.evaporatorTemp?.value || null,
        // H: Verflüssiger (Flüssigkeitgrad Verflüssiger)
        condensorTemp: keyFeatures.condensorTemp?.value || null,
        // K: Heizkreis Rücklauftemperatur (Rücklauf Sekundärkreis)
        returnTemp: keyFeatures.returnTemp?.value || keyFeatures.secondaryReturnTemp?.value || null,
        // L: Interne Pumpe (Drehzahl Sekundärpumpe)
        pumpInternal: keyFeatures.pumpInternal?.value || null,
        // M: Vorlauftemperatur (Vorlauftemperatur IDU)
        supplyTemp: keyFeatures.supplyTemp?.value || null,
        // M2: Vorlauftemperatur (Vorlauftemperatur ODU Sekundärkreis)
        supplyTempSec: keyFeatures.secondarySupplyTemp?.value || null,
        // N: 4/3-Wege-Ventil (4-Wege Ventil Kältekreis)
        fourWayValve: keyFeatures.fourWayValve?.value || null,
        // O: Einlassdruck (Saugasdruck Verdichter)
        compressorPressure: keyFeatures.compressorPressure?.value || null,
        // P: Verflüssigungsdruck (not available via API)
        condensingPressure: null,
        // R: Einlasstemperatur (Sauggastemperatur Verdichter)
        compressorInletTemp: keyFeatures.compressorInletTemp?.value || null,
        // S: Auslasstemperatur (Heissgastemperatur)
        compressorOutletTemp: keyFeatures.compressorOutletTemp?.value || null,
        // T: Drehzahl Verdichter (RPM oder % je nach Konfiguration)
        compressorSpeed: compressorSpeedValue,
        compressorSpeedUnit: compressorSpeedUnit,
        // U: Öltemperatur (Verdichtertemperatur)
        compressorOilTemp: keyFeatures.compressorOilTemp?.value || null,
        // V: Betriebsart
        operatingMode: keyFeatures.operatingMode?.value || null,
        // W: Lufteintrittstemperatur Verdampfer (Primärkreis-Vorlauf)
        airIntakeTemp: keyFeatures.primarySupplyTemp?.value || null,
        // W2: Außentemperatur
        outsideTemp: keyFeatures.outsideTemp?.value || null,
        // X: Volumenstrom
        volumetricFlow: keyFeatures.volumetricFlow?.value || null,
        // Y: Druck
        pressure: keyFeatures.pressure?.value || null,
        valve_0: keyFeatures.expansionValve_0?.value || null,
        valve_1: keyFeatures.expansionValve_1?.value || null
    };

    // Format value with unit
    const formatValue = (value, unit = '', decimals = 1) => {
        if (value === null || value === undefined) return '-';
        if (typeof value === 'number') {
            return value.toFixed(decimals) + (unit ? ' ' + unit : '');
        }
        return value;
    };

    // Calculate thermal power if all required values are available
    let thermalPowerW = null;
    if (keyFeatures.volumetricFlow?.value) {
        // Get device settings to determine which spreizung to use
        const deviceInfo = window.currentDeviceInfo;
        const deviceKey = deviceInfo ? (deviceInfo.installationId + '_' + deviceInfo.deviceId) : null;
        const deviceSetting = deviceKey && window.deviceSettingsCache ? window.deviceSettingsCache[deviceKey] : null;
        let hasHotWaterBuffer = true; // default
        if (deviceSetting && deviceSetting.hasHotWaterBuffer !== null && deviceSetting.hasHotWaterBuffer !== undefined) {
            hasHotWaterBuffer = deviceSetting.hasHotWaterBuffer;
        }

        // Use central spreizung calculation
        const spreizungResult = calculateSpreizung(keyFeatures, hasHotWaterBuffer);

        if (spreizungResult.isValid) {
            const waterDensity = getWaterDensity(spreizungResult.supplyTemp); // kg/m³
            const specificHeatCapacity = 4180; // J/(kg·K)
            const volumetricFlowM3s = keyFeatures.volumetricFlow.value / 3600000; // l/h to m³/s
            const massFlow = waterDensity * volumetricFlowM3s; // kg/s
            thermalPowerW = massFlow * specificHeatCapacity * spreizungResult.spreizung; // W
        }
    }

    return `
            <div class="refrigerant-visual-container">
                <div class="refrigerant-diagram">
                    <img src="${baseImage}" alt="Kältekreislauf" class="base-diagram">

                    <!-- Component overlays with status images -->
                    <!-- DHW Storage -->
                    ${dhw_exists ? `
                    <img src="${dhw_image}"
                         alt="Warmwasserspeicher" class="component-overlay dhw-storage-overlay">
                    ` : ''}

                    <!-- Heating Storage -->
                    <img src="/static/img/vitocal/Heizwasserspeicher%20${heatingActive ? 'ein' : 'aus'}.png"
                         alt="Heizwasserspeicher" class="component-overlay heating-storage-overlay">

                    <!-- Electric Heater (Heizstab) -->
                    ${heaterActive ? `
                    <img src="/static/img/vitocal/Heizstab%20ein.png" alt="Heizstab aktiv" class="component-overlay heater-overlay">
                    ` : `
                    <img src="/static/img/vitocal/Heizstab%20aus.png" alt="Heizstab aus" class="component-overlay heater-overlay">
                    `}

                    <!-- Individual value overlays with tooltips -->
                    <!-- Alle Positionen basierend auf View-Größe 847x363px -->
                    ${values.fan1 !== null ? `<div class="value-label" style="top: 51.52%; left: 8.03%;" title="Lüfter 1">${formatValue(values.fan1, '%', 0)}</div>` : ''}
                    ${values.fan2 !== null ? `<div class="value-label" style="top: 22.87%; left: 8.03%;" title="Lüfter 2">${formatValue(values.fan2, '%', 0)}</div>` : ''}

                    ${values.evaporatorTemp !== null ? `<div class="value-label" style="top: 37.19%; left: 21.72%;" title="Verdampfer Temperatur">${formatValue(values.evaporatorTemp, '°C')}</div>` : ''}
                    ${values.evaporatorOverheat !== null ? `<div class="value-label" style="top: 37.19%; left: 56.79%;" title="Verdampfer Überhitzung">${formatValue(values.evaporatorOverheat, '°C')}</div>` : ''}

                    ${values.economizer !== null ? `<div class="value-label" style="top: 17.36%; left: 38.72%;" title="Economizer">${formatValue(values.economizer, '°C')}</div>` : ''}

                    ${values.compressorSpeed !== null ? `<div class="value-label" style="top: 71.35%; left: 38.61%;" title="Kompressor Drehzahl">${formatValue(values.compressorSpeed, values.compressorSpeedUnit, 0)}</div>` : ''}
                    ${values.compressorInletTemp !== null ? `<div class="value-label" style="top: 69.70%; left: 47.93%;" title="Kompressor Einlasstemperatur">${formatValue(values.compressorInletTemp, '°C')}</div>` : ''}
                    ${values.compressorOutletTemp !== null ? `<div class="value-label" style="top: 93.94%; left: 38.84%;" title="Kompressor Auslasstemperatur">${formatValue(values.compressorOutletTemp, '°C')}</div>` : ''}
                    ${values.compressorOilTemp !== null ? `<div class="value-label" style="top: 52.62%; left: 32.35%;" title="Kompressor Öltemperatur">${formatValue(values.compressorOilTemp, '°C')}</div>` : ''}
                    ${values.compressorPressure !== null ? `<div class="value-label" style="top: 69.70%; left: 56.43%;" title="Kompressor Einlassdruck">${formatValue(values.compressorPressure, 'bar')}</div>` : ''}
                    ${values.valve_0 !== null ? `<div class="value-label" style="top: 17.36%; left: 58%;" title="Ventil">${formatValue(values.valve_0, '%')}</div>` : ''}
                    ${values.valve_1 !== null ? `<div class="value-label" style="top: 37.20%; left: 33%;" title="Ventil">${formatValue(values.valve_1, '%')}</div>` : ''}


                    ${values.condensorTemp !== null ? `<div class="value-label" style="top: 17.36%; left: 66.47%;" title="Verflüssiger">${formatValue(values.condensorTemp, '°C')}</div>` : ''}

                    ${values.returnTemp !== null ? `<div class="value-label" style="top: 17.36%; left: 83.83%;" title="Rücklauftemperatur">${formatValue(values.returnTemp, '°C')}</div>` : ''}
                    ${values.pressure !== null ? `<div class="value-label" style="top: 21%; left: 83.83%;" title="Druck">${formatValue(values.pressure, 'bar')}</div>` : ''}
                    ${values.supplyTempSec !== null ? `<div class="value-label" style="top: 83.75%; left: 82.0%;" title="ODU sekundär Vorlauftemperatur">${formatValue(values.supplyTempSec, '°C')}</div>` : ''}
                    ${values.supplyTemp !== null ? `<div class="value-label" style="top: 83.75%; left: 88.0%;" title="IDU Vorlauftemperatur">${formatValue(values.supplyTemp, '°C')}</div>` : ''}
                    ${values.pumpInternal !== null ? `<div class="value-label" style="top: 22.87%; left: 95.0%;" title="Interne Pumpe">${formatValue(values.pumpInternal, '%', 0)}</div>` : ''}

                    ${keyFeatures.primarySupplyTemp !== null ? `<div class="value-label" style="top: 44.35%; left: 0.71%;" title="Lufteintrittstemperatur">${formatValue(keyFeatures.primarySupplyTemp.value, '°C')}</div>` : ''}
                    ${keyFeatures.outsideTemp !== null ? `<div class="value-label" style="top: 48.35%; left: 0.71%;" title="Außentemperatur">${formatValue(keyFeatures.outsideTemp.value, '°C')}</div>` : ''}
                    ${keyFeatures.volumetricFlow !== null ? `<div class="value-label" style="top: 17.36%; left: 93.0%;" title="Volumenstrom">${formatValue(keyFeatures.volumetricFlow.value, 'l/h', 0)}</div>` : ''}

                    <!-- Speichertemperaturen (unter den Speicher-Bildern) -->
                    ${keyFeatures.bufferTemp !== null && keyFeatures.bufferTemp.value !== null ? `<div class="value-label" style="top: 64.74%; left: 84.65%;" title="Heizpuffer Temperatur">${formatValue(keyFeatures.bufferTemp.value, '°C')}</div>` : ''}
                    ${keyFeatures.dhwTemp !== null && keyFeatures.dhwTemp.value !== null ? `<div class="value-label" style="top: 64.74%; left: 91.26%;" title="Warmwasser Temperatur">${formatValue(keyFeatures.dhwTemp.value, '°C')}</div>` : ''}

                    <!-- Leistungsanzeigen -->
                    ${keyFeatures.compressorPower !== null && keyFeatures.compressorPower !== undefined && keyFeatures.compressorPower.value !== null ? `<div class="value-label" style="top: 55.37%; left: 43.68%;" title="Elektrische Leistung Kompressor">${formatValue(keyFeatures.compressorPower.value, 'W', 0)}</div>` : ''}
                    ${thermalPowerW !== null ? `<div class="value-label" style="top: 37.19%; left: 82.64%;" title="Thermische Leistung (berechnet)">${formatValue(thermalPowerW, 'W', 0)}</div>` : ''}
                </div>
            </div>
    `;
}
