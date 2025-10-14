
const BLE_service_UUID = "8bac7fbb-9890-4fef-8e2a-05c75fabe512";
const BLE_characteristic_UUID = "85af4282-a704-4944-814d-5dc715d6bd67";

const distanceElementSerial = document.getElementById("data-ultrasonic-serial");
const distanceElementBLE = document.getElementById("data-ultrasonic-BLE");

// SERIAL //

// serial data sent from esp32:
// FF FF FF FF xx xx xx xx FF ...
// └---------┘ └---------┘ └-
// sync bytes | float distance

var latestBytesSerial = new Uint8Array(16); // stores the last 16 bytes received via serial
var serialCount = 0;

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function latestDistanceSerial() {
	// find last 4 consecutive 0xFFs
	var serialCount = 0;
	for (var i = 15; i >= 0; i--) {
		if (latestBytesSerial[i] == 0xFF) {
			serialCount++;
		} else {
			serialCount = 0;
		}

		// found 4 0xFFs -> grab previous 4 bytes to make the float
		if (serialCount >= 4) {
			let floatBytes = latestBytesSerial.slice(i - 4, i);

			// convert bytes to float
			let view = new DataView(floatBytes.buffer);
			let float = view.getFloat32(0);
			return float;
		}
	}
	return -1;
}

async function readSerialUltrasonic() {
	// esp32 dev board vendorid:productid = 1a86:7523 QinHeng Electronics CH340 serial converter
	const filters = [
		{ usbVendorId: 0x1a86, usbPoductId: 0x7523 },
		{ usbVendorId: 0x2341, usbPoductId: 0x0043 }
	];
	const port = await navigator.serial.requestPort({ filters });
	await port.open({ baudRate: 9600 });
	const reader = port.readable.getReader();

	while (true) {
		const { value, done } = await reader.read();
		if (done) break;

		const serialLen = value.length;
		if (serialLen >= 16) {
			latestBytesSerial = value.slice(-16);
		} else {
			// shift old bytes back
			for (var i = serialLen; i < 16; i++) {
				latestBytesSerial[i - serialLen] = latestBytesSerial[i];
			}
			// append new bytes
			for (var i = 0; i < serialLen; i++) {
				latestBytesSerial[16 - serialLen + i] = value[i];
			}
		}

		let distance = latestDistanceSerial();
		console.log(distance);
		if (distance != -1) {
			distanceElementSerial.textContent = distance.toFixed(1) + "mm";
		}

		sleep(200);
	}
}

// BLUETOOTH //

function onCharacteristicValueChange(event) {
	const distance = event.target.value.getFloat32();
	console.log("bt distance (mm) = " + distance);
	distanceElementBLE.textContent = distance.toFixed(1) + "mm";
}

function readBluetoothUltrasonic() {
	navigator.bluetooth.requestDevice({
		filters: [{
			services: [BLE_service_UUID] // service UUID defined in ESP32 code
		}]
	})
	.then(device => {
		console.log("bluetooth connected to: " + device.name);
		return device.gatt.connect();
	})
	.then(server => server.getPrimaryService(BLE_service_UUID))
	.then(service => {
		console.log("service received");
		return service.getCharacteristic(BLE_characteristic_UUID);
	})
	.then(characteristic => characteristic.startNotifications())
	.then(characteristic => {
		console.log("notifications started");
		// call onCharacteristicValueChange() whenever this value changes
		characteristic.addEventListener('characteristicvaluechanged', onCharacteristicValueChange);
	})
	.catch(error => {
		console.error(error);
	});
}
