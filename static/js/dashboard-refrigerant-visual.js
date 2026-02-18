// Refrigerant Circuit Visualization
// Visual representation of the heat pump refrigerant cycle with real-time data overlay

// Helper function to get water density based on temperature
function getWaterDensity(tempC) {
    // Approximate water density as function of temperature (kg/m³)
    // Linear approximation: ρ(T) ≈ 1000 - 0.3 × T
    return 1000 - 0.3 * tempC;
}

// validate value
function validate(featureVal) {
	if (featureVal !== null && featureVal.value !== null){
		if (typeof featureVal.value === 'number'){
			return featureVal.value;
		}
    }
    return null;
}

function renderRefrigerantCircuitVisual(keyFeatures) {

	// Get device settings to determine: hasHotWaterBuffer, refrigerant-picture, compressor rpm
    const deviceInfo = window.currentDeviceInfo;
    const deviceKey = deviceInfo ? (deviceInfo.installationId + '_' + deviceInfo.deviceId) : null;
    const deviceSetting = deviceKey && window.deviceSettingsCache ? window.deviceSettingsCache[deviceKey] : null;
    let hasHotWaterBuffer = true; // default
    if (deviceSetting && deviceSetting.hasHotWaterBuffer !== null && deviceSetting.hasHotWaterBuffer !== undefined) {
        hasHotWaterBuffer = deviceSetting.hasHotWaterBuffer;
    }
	let useOtherPic = false; // default
	if (deviceSetting && deviceSetting.useOtherRefrigerantPic !== null && deviceSetting.useOtherRefrigerantPic !== undefined) {
        useOtherPic = deviceSetting.useOtherRefrigerantPic;
    }

    // Check if we have compressor data (heat pump only)
    const hasCompressor = keyFeatures.compressorActive !== null ||
                         keyFeatures.compressorSpeed !== null ||
                         keyFeatures.compressorInletTemp !== null;

    if (!hasCompressor) {
        return ''; // Not a heat pump, don't show visualization
    }
	
	// if primary return temp available and alternative picture selected, use the other refrigerant picture
	if (useOtherPic && keyFeatures.primaryReturnTemp && (typeof keyFeatures.primaryReturnTemp?.value === 'number')){
		return renderOtherRefrigerantCircuitPic(keyFeatures)
	}	
	
    // Determine if compressor is active
    const compressorActive = keyFeatures.compressorActive?.value === true ||
                            (keyFeatures.compressorSpeed?.value && keyFeatures.compressorSpeed.value > 0);

    // Select base image (active or inactive)
    let baseImage = compressorActive ?
        '/static/img/vitocal/Kaeltekreislauf%20ein.jpg' : '/static/img/vitocal/Kaeltekreislauf%20aus.jpg';
	if (compressorActive && keyFeatures?.fourWayValve && 
		(keyFeatures.fourWayValve.value === 'climatCircuitTwoDefrost' || keyFeatures.fourWayValve.value === 'defrost')) {
        baseImage = '/static/img/vitocal/Kaeltekreislauf%20abtau.jpg';
    }

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
    if (keyFeatures?.compressorSpeed && (typeof keyFeatures.compressorSpeed.value === 'number')) {
        let speedValue = keyFeatures.compressorSpeed.value;
        const speedUnit = keyFeatures.compressorSpeed.unit;

        // Convert revolutionsPerSecond to RPM
        if (speedUnit === 'revolutionsPerSecond') {
            speedValue = speedValue * 60;
        }

	    // Calculate RPM percentage from device settings
        let rpmPercentage = null;
        if (deviceSetting && deviceSetting.max > deviceSetting.min && speedValue > 0) {
            rpmPercentage = Math.round(((speedValue - deviceSetting.min) / (deviceSetting.max - deviceSetting.min)) * 100);
            rpmPercentage = Math.max(0, Math.min(100, rpmPercentage));
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
        fan1: validate (keyFeatures.fan0),
        // B: Lüfter 2 (Drehzahl Ventilator 2)
        fan2: validate (keyFeatures.fan1),
        // C: Verdampfer Überhitzung (Flüssiggastemperatur kühlen)
        evaporatorOverheat: validate (keyFeatures.evaporatorOverheat),
        // D: Öffnungsweite elektr. Expansionsventil
        expansionValve1: validate (keyFeatures.expansionValve_0),
        // E: Economizer (Sauggastemperatur Heizen)
        economizer: validate (keyFeatures.economizerTemp),
        // F: Öffnungsweite des elektr. Expansionsventil 2
        expansionValve2: validate (keyFeatures.expansionValve_1),
        // G: Verdampfer Überhitzung (Sauggastemperatur Verdampfer)
        evaporatorTemp: validate(keyFeatures.evaporatorTemp),
        // H: Verflüssiger (Flüssigkeitgrad Verflüssiger)
        condensorTemp: validate (keyFeatures.condensorTemp),
        // K: Heizkreis Rücklauftemperatur (Rücklauf Sekundärkreis)
        returnTemp: validate (keyFeatures.returnTemp),
        // L: Interne Pumpe (Drehzahl Sekundärpumpe)
        pumpInternal: validate (keyFeatures.pumpInternal),
        // M: Vorlauftemperatur (Vorlauftemperatur IDU)
        supplyTemp: validate (keyFeatures.supplyTemp),
        // M2: Vorlauftemperatur (Vorlauftemperatur ODU Sekundärkreis)
        supplyTempSec: validate (keyFeatures.secondarySupplyTemp),
        // N: 4/3-Wege-Ventil (4-Wege Ventil Kältekreis)
        fourWayValve: validate (keyFeatures.fourWayValve),
        // O: Einlassdruck (Saugasdruck Verdichter)
        compressorPressure: validate (keyFeatures.compressorPressure),
        // P: Verflüssigungsdruck (not available via API)
        condensingPressure: null,
        // R: Einlasstemperatur (Sauggastemperatur Verdichter)
        compressorInletTemp: validate (keyFeatures.compressorInletTemp),
        // S: Auslasstemperatur (Heissgastemperatur)
        compressorOutletTemp: validate (keyFeatures.compressorOutletTemp),
        // T: Drehzahl Verdichter (RPM oder % je nach Konfiguration)
        compressorSpeed: compressorSpeedValue,
        compressorSpeedUnit: compressorSpeedUnit,
        // U: Öltemperatur (Verdichtertemperatur)
        compressorOilTemp: validate (keyFeatures.compressorOilTemp),
        // V: Betriebsart
        operatingMode: validate (keyFeatures.operatingMode),
        // W: Lufteintrittstemperatur Verdampfer (Primärkreis-Vorlauf)
        airIntakeTemp: validate (keyFeatures.primarySupplyTemp),
        // W2: Außentemperatur
        outsideTemp: validate (keyFeatures.outsideTemp),
        // X: Volumenstrom
        volumetricFlow: validate (keyFeatures.volumetricFlow),
        // Y: Druck
        pressure: validate (keyFeatures.pressure),
		dhwTemp:  validate (keyFeatures.dhwTemp),
		compressorPower:  validate (keyFeatures.compressorPower),
		
    };

	// validate bufferTemp, option: bufferTempTop
    let bufferTempVal = null;
    if (keyFeatures.bufferTemp !== null){
    	const bufferTempValue = keyFeatures.bufferTemp.value;
        if ( typeof bufferTempValue === 'number'){
            bufferTempVal = bufferTempValue;
        }
    }
    if (bufferTempVal == null && keyFeatures.bufferTempTop !== null){
    	const bufferTempTopValue = keyFeatures.bufferTempTop.value;
        if ( typeof bufferTempTopValue === 'number'){
            bufferTempVal = bufferTempTopValue;
        }
    }

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
                    ${values.expansionValve1 !== null ? `<div class="value-label" style="top: 17.36%; left: 58%;" title="Ventil">${formatValue(values.expansionValve1, '%')}</div>` : ''}
                    ${values.expansionValve2 !== null ? `<div class="value-label" style="top: 37.20%; left: 33%;" title="Ventil">${formatValue(values.expansionValve2, '%')}</div>` : ''}

                    ${values.condensorTemp !== null  ? `<div class="value-label" style="top: 17.36%; left: 66.47%;" title="Verflüssiger">${formatValue(values.condensorTemp, '°C')}</div>` : ''}

                    ${values.returnTemp !== null ? `<div class="value-label" style="top: 17.36%; left: 83.83%;" title="Rücklauftemperatur">${formatValue(values.returnTemp, '°C')}</div>` : ''}
                    ${values.pressure !== null ? `<div class="value-label" style="top: 22.87%; left: 83.83%;" title="Druck">${formatValue(values.pressure, 'bar')}</div>` : ''}
                    ${values.supplyTempSec !== null ? `<div class="value-label" style="top: 83.75%; left: 82.0%;" title="ODU sekundär Vorlauftemperatur">${formatValue(values.supplyTempSec, '°C')}</div>` : ''}
                    ${values.supplyTemp !== null ? `<div class="value-label" style="top: 83.75%; left: 88.0%;" title="IDU Vorlauftemperatur">${formatValue(values.supplyTemp, '°C')}</div>` : ''}
                    ${values.pumpInternal !== null ? `<div class="value-label" style="top: 22.87%; left: 95.0%;" title="Interne Pumpe">${formatValue(values.pumpInternal, '%', 0)}</div>` : ''}

                    ${values.airIntakeTemp !== null ? `<div class="value-label" style="top: 44.35%; left: 0.71%;" title="Lufteintrittstemperatur">${formatValue(values.airIntakeTemp, '°C')}</div>` : ''}
                    ${values.outsideTemp !== null ? `<div class="value-label" style="top: 48.35%; left: 0.71%;" title="Außentemperatur">${formatValue(values.outsideTemp, '°C')}</div>` : ''}
                    ${values.volumetricFlow !== null ? `<div class="value-label" style="top: 17.36%; left: 93.0%;" title="Volumenstrom">${formatValue(values.volumetricFlow, 'l/h', 0)}</div>` : ''}

                    <!-- Speichertemperaturen (unter den Speicher-Bildern) -->
                    ${bufferTempVal !== null ? `<div class="value-label" style="top: 64.74%; left: 84.65%;" title="Heizpuffer Temperatur">${formatValue(bufferTempVal, '°C')}</div>` : ''}
                    ${values.dhwTemp !== null ? `<div class="value-label" style="top: 64.74%; left: 91.26%;" title="Warmwasser Temperatur">${formatValue(values.dhwTemp, '°C')}</div>` : ''}

                    <!-- Leistungsanzeigen -->
                    ${values.compressorPower !== null  ? `<div class="value-label" style="top: 55.37%; left: 43.68%;" title="Elektrische Leistung Kompressor">${formatValue(values.compressorPower, 'W', 0)}</div>` : ''}
                    ${thermalPowerW !== null ? `<div class="value-label" style="top: 37.19%; left: 82.64%;" title="Thermische Leistung (berechnet)">${formatValue(thermalPowerW, 'W', 0)}</div>` : ''}
                </div>
            </div>
    `;
}


// use other picture for visual representation of the heat pump refrigerant cycle with real-time data overlay 
function renderOtherRefrigerantCircuitPic(keyFeatures) {
	
    // Select base image (active or inactive)
    let baseImage = '/static/img/vitocal/WMPrefrigerant.jpg';
	
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

    // Calculate compressor speed with percentage if device settings available
    let compressorSpeedValue = null;
    let compressorSpeedUnit = '';
    if (keyFeatures?.compressorSpeed && (typeof keyFeatures.compressorSpeed.value === 'number')) {
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
            if (settings && settings.max > settings.min){
				if (speedValue > 0) {
					rpmPercentage = Math.round(((speedValue - settings.min) / (settings.max - settings.min)) * 100);
					rpmPercentage = Math.max(0, Math.min(100, rpmPercentage));
				}
				else rpmPercentage = 0;
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
	
    // Map values according to WMPrefrigerant.jpg (1299x547px)
    const values = {
        //  Verdampfer Flüssigtemperatur (tO)
        evaporatorTemp: validate(keyFeatures.evaporatorTemp),
        //  Verdampfer Überhitzung
        evaporatorOverheat: validate(keyFeatures.evaporatorOverheat),
        //  Heizkreis Rücklauftemperatur (Rücklauf Sekundärkreis)
        returnTemp: validate(keyFeatures.returnTemp),
        //  Vorlauftemperatur (Vorlauftemperatur ODU Sekundärkreis)
        supplyTempSec: validate(keyFeatures.secondarySupplyTemp),
        //  Einlassdruck (Saugasdruck Verdichter)
        compressorPressure: validate(keyFeatures.compressorPressure),
        //  Einlasstemperatur (Sauggastemperatur Verdichter)
        compressorInletTemp: validate(keyFeatures.compressorInletTemp),
        //  Auslasstemperatur (Heißgastemperatur Verdichter)
        compressorOutletTemp: validate(keyFeatures.compressorOutletTemp),
        //  Eintrittstemperatur Primärkreis (Sole-Eintritt)
        primarySupply: validate(keyFeatures.primarySupplyTemp),
        //  Austrittstemperatur Primärkreis (Sole-Austritt)
        primaryReturn: validate(keyFeatures.primaryReturnTemp),
        //  Außentemperatur
        outsideTemp: validate(keyFeatures.outsideTemp),
        //  Warmwasser
        dhwTemp: validate(keyFeatures.dhwTemp),
        // Sole-spezifisch: Heißgasdruck
        hotGasPressure: validate(keyFeatures.hotGasPressure),
        // Sole-spezifisch: Sauggasdruck
        suctionGasPressure: validate(keyFeatures.suctionGasPressure),
        // Sole-spezifisch: Heißgastemperatur
        hotGasTemp: validate(keyFeatures.hotGasTemp),
        // Sole-spezifisch: Sauggastemperatur
        suctionGasTemp: validate(keyFeatures.suctionGasTemp),
        // Sole-spezifisch: Flüssiggastemperatur
        liquidGasTemp: validate(keyFeatures.liquidGasTemp),
        // Sole-spezifisch: Primärkreis Pumpendrehzahl
        primaryRotation: validate(keyFeatures.primaryRotation),
    };


	// validate bufferTemp, option: bufferTempTop
    let bufferTempVal = null;
    if (keyFeatures.bufferTemp !== null){
    	const bufferTempValue = keyFeatures.bufferTemp.value;
        if ( typeof bufferTempValue === 'number'){
            bufferTempVal = bufferTempValue;
        }
    }
    if (bufferTempVal == null && keyFeatures.bufferTempTop !== null){
    	const bufferTempTopValue = keyFeatures.bufferTempTop.value;
        if ( typeof bufferTempTopValue === 'number'){
            bufferTempVal = bufferTempTopValue;
        }
    }

    // Format value with unit
    const formatValue = (value, unit = '', decimals = 1) => {
        if (value === null || value === undefined) return '-';
        if (typeof value === 'number') {
            return value.toFixed(decimals) + (unit ? ' ' + unit : '');
        }
        return value;
    };

    return `
            <div class="refrigerant-visual-container">
                <div class="refrigerant-diagram">
                    <img src="${baseImage}" alt="Kältekreislauf" class="base-diagram">

                    <!-- Component overlays with status images -->
                    <!-- DHW Storage -->
                    ${dhw_exists ? `
                    <img src="${dhw_image}"
                         alt="Warmwasserspeicher" class="component-overlay dhw-storage-overlay-left">
                    ` : ''}

                    <!-- Individual value overlays with tooltips -->
                    <!-- Alle Positionen basierend auf WMPrefrigerant.jpg 1299x547px -->

                    ${values.compressorInletTemp !== null ? `<div class="value-label" style="top: 18.00%; left: 55.00%;" title="Kompressor Einlasstemperatur">${formatValue(values.compressorInletTemp, '°C')}</div>` : ''}
                    ${values.compressorPressure !== null ? `<div class="value-label" style="top: 23.00%; left: 55.00%;" title="Kompressor Einlassdruck">${formatValue(values.compressorPressure, 'bar')}</div>` : ''}
                    ${values.compressorOutletTemp !== null ? `<div class="value-label" style="top: 18.00%; left: 39.00%;" title="Kompressor Auslasstemperatur">${formatValue(values.compressorOutletTemp, '°C')}</div>` : ''}

                    ${values.returnTemp !== null ? `<div class="value-label" style="top: 84.00%; left: 15.00%;" title="Rücklauftemperatur sekundär">${formatValue(values.returnTemp, '°C')}</div>` : ''}
                    ${values.supplyTempSec !== null ? `<div class="value-label" style="top: 16.00%; left: 15.00%;" title="Vorlauftemperatur sekundär">${formatValue(values.supplyTempSec, '°C')}</div>` : ''}

                    ${values.evaporatorTemp !== null ? `<div class="value-label" style="top: 59.09%; left: 85.39%;" title="Verdampfer Flüssigtemperatur (tO)">tO:${formatValue(values.evaporatorTemp, '°C')}</div>` : ''}
                    ${values.evaporatorOverheat !== null ? `<div class="value-label" style="top: 50.00%; left: 85.00%;" title="Verdampfer Überhitzung">${formatValue(values.evaporatorOverheat, '°C')}</div>` : ''}
                    ${values.primarySupply !== null ? `<div class="value-label" style="top: 16.00%; left: 80.00%;" title="Eintrittstemperatur Primärkreis (Sole)">${formatValue(values.primarySupply, '°C')}</div>` : ''}
                    ${values.primaryReturn !== null ? `<div class="value-label" style="top: 84.00%; left: 80.00%;" title="Austrittstemperatur Primärkreis (Sole)">${formatValue(values.primaryReturn, '°C')}</div>` : ''}
                    ${values.outsideTemp !== null ? `<div class="value-label" style="top: 49.00%; left: 92.00%;" title="Außentemperatur">${formatValue(values.outsideTemp, '°C')}</div>` : ''}

                    <!-- Sole-spezifische Sensoren -->
                    ${values.hotGasPressure !== null ? `<div class="value-label" style="top: 52.49%; left: 55.23%;" title="Heißgasdruck">${formatValue(values.hotGasPressure, 'bar')}</div>` : ''}
                    ${values.suctionGasPressure !== null ? `<div class="value-label" style="top: 44.14%; left: 55.31%;" title="Sauggasdruck">${formatValue(values.suctionGasPressure, 'bar')}</div>` : ''}
                    ${values.hotGasTemp !== null ? `<div class="value-label" style="top: 25.16%; left: 39.08%;" title="Heißgastemperatur">${formatValue(values.hotGasTemp, '°C')}</div>` : ''}
                    ${values.suctionGasTemp !== null ? `<div class="value-label" style="top: 12.00%; left: 55.00%;" title="Sauggastemperatur">${formatValue(values.suctionGasTemp, '°C')}</div>` : ''}
                    ${values.liquidGasTemp !== null ? `<div class="value-label" style="top: 81.86%; left: 39.44%;" title="Flüssiggastemperatur">${formatValue(values.liquidGasTemp, '°C')}</div>` : ''}
                    ${values.primaryRotation !== null ? `<div class="value-label" style="top: 38.67%; left: 93.48%;" title="Primärkreis Pumpendrehzahl">${formatValue(values.primaryRotation, '%', 0)}</div>` : ''}

                    <!-- Speichertemperaturen (unter den Speicher-Bildern) -->
                    ${values.dhwTemp !== null ? `<div class="value-label" style="top: 65.00%; left: 4.50%;" title="Warmwasser Temperatur">${formatValue(values.dhwTemp, '°C')}</div>` : ''}

                </div>
            </div>
    `;
}

