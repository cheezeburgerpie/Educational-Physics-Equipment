// web-serial api https://developer.chrome.com/docs/capabilities/serial
// web-bluetooth api https://developer.chrome.com/docs/capabilities/bluetooth

document.addEventListener("DOMContentLoaded", () => {
    /**
     * Element to display the serial log 
     * @type {HTMLElement|null}
     */
    const logSerialElement = document.getElementById("log-serial");

    /**
     * Dark mode button
     * @type {HTMLElement|null}
     */
    const toggleDarkModeButton = document.getElementById('toggleDarkModeButton');

    /**
     * Theme element 
     * @type {HTMLElement}
     */
    const htmlElement = document.documentElement;

    // Check theme preference 
    if (toggleDarkModeButton) {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            htmlElement.setAttribute('data-theme', savedTheme);
            toggleDarkModeButton.textContent = savedTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
        }

        // Event listener dark mode button 
        toggleDarkModeButton.addEventListener('click', () => {
            const currentTheme = htmlElement.getAttribute('data-theme') || 'light';
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            htmlElement.setAttribute('data-theme', newTheme);
            toggleDarkModeButton.textContent = newTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
            localStorage.setItem('theme', newTheme);
        });
    }

    // LIGHT SENSOR //

    // ROTARY ENCODER //

    // ULTRASONIC //

    /**
     * event listener for ultrasonic serial button 
     * @async
     */
    document.getElementById('button-ultrasonic-serial').addEventListener('click', async () => {
        try {
            await readSerialUltrasonic();
        } catch (error) {
            logSerialElement.textContent = error;
            console.error(error);
        }
    });

    /**
     * Event listener for ultrasonic BLE button 
     * @async
     */
    document.getElementById('button-ultrasonic-BLE').addEventListener('click', async () => {
        readBluetoothUltrasonic();
    });
});