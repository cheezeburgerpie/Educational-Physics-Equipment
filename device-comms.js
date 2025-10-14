// web-serial api https://developer.chrome.com/docs/capabilities/serial
// web-bluetooth api https://developer.chrome.com/docs/capabilities/bluetooth

const logSerialElement = document.getElementById("log-serial");

if ("serial" in navigator) {
	console.log("serial supported");
}

// LIGHT SENSOR //



// ROTARY ENCODER //



// ULTRASONIC //

document.getElementById('button-ultrasonic-serial').addEventListener('click', async () => {
	try {
		await readSerialUltrasonic();
	} catch (error) {
		logSerialElement.textContent = error;
		console.error(error);
	}
});

document.getElementById('button-ultrasonic-BLE').addEventListener('click', async () => {
	readBluetoothUltrasonic();
});
