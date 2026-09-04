# Educational Physics Equipment

Browser based data logging for custom built physics sensors. An ESP32 reads a sensor and streams measurements over Bluetooth Low Energy, a web page connects directly to the board using Web Bluetooth, plots the data, and can export it as CSV.

Built for classroom experiments. Rotational motion with a quadrature encoder, and linear motion with an ultrasonic rangefinder.

## Hardware

All sketches are for an ESP32 development board.

The rotary encoder is a 600 PPR quadrature photoelectric encoder. 2400 counts per revolution with 4× decoding.

| Encoder | ESP32 |
| --- | --- |
| A | GPIO 25 |
| B | GPIO 26 |
| VCC | 5V |
| GND | GND |

Both inputs use the internal pull ups


