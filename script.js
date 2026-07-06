// Регистрация Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/Lazer-shield/sw.js')
        .then(() => console.log('SW registered'))
        .catch(err => console.warn('SW registration failed:', err));
}

// ---------- UUID ----------
// DIS
const DIS_SERVICE = '0000180a-0000-1000-8000-00805f9b34fb';
const DIS_CHARS = {
    manufacturer: '00002a29-0000-1000-8000-00805f9b34fb',
    serial: '00002a25-0000-1000-8000-00805f9b34fb',
    firmware: '00002a26-0000-1000-8000-00805f9b34fb',
    hardware: '00002a27-0000-1000-8000-00805f9b34fb',
    software: '00002a28-0000-1000-8000-00805f9b34fb'
};

// BAS
const BATTERY_SERVICE = '0000180f-0000-1000-8000-00805f9b34fb';
const BATTERY_CHAR = '00002a19-0000-1000-8000-00805f9b34fb';

// Ваш лазерный сервис и характеристика
const LASER_SERVICE_UUID = '66375178-6231-3937-1258-432199739bcc';
const LASER_INPUT_UUID   = '78153469-6274-3432-9825-72538293bb02';

// Резервный сервис для серийного номера (ESP32C3)
const BACKUP_SERVICE_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';
const BACKUP_CHAR_UUID   = '0000ffe2-0000-1000-8000-00805f9b34fb';
// характеристика для телеметрии
const LASER_OUTPUT_UUID = '78153469-6274-3432-9825-72538293bb01';

// ---------- Глобальные переменные ----------
let device = null;
let server = null;
let laserCharacteristic = null;
let isListening = false; // состояние кнопки микрофона

// Переменные для работы с микрофоном
let audioContext = null;
let analyser = null;
let dataArray = null;
let source = null;
let stream = null;
let animationFrame = null;
let lastCommandTime = 0;
const SOUND_THRESHOLD = 0.6;      // порог громкости (0-1)
const COMMAND_COOLDOWN = 500;     // мс между отправками

const connectBtn = document.getElementById('connectBtn');
const impulseBtn = document.getElementById('impulseBtn');
const piezoBtn = document.getElementById('piezoBtn');
const microphoneBtn = document.getElementById('microphoneBtn');
const resetBtn = document.getElementById('resetBtn');
const statusDiv = document.getElementById('status');

// Элементы настройки
const impulseTimeInput = document.getElementById('impulseTimeInput');
const pauseTimeInput = document.getElementById('pauseTimeInput');
const updateSettingsBtn = document.getElementById('updateSettingsBtn');

connectBtn.addEventListener('click', connectDevice);
impulseBtn.addEventListener('click', sendImpulse);
piezoBtn.addEventListener('click', sendPiezo);
microphoneBtn.addEventListener('click', toggleMicrophone);
resetBtn.addEventListener('click', sendReset);
updateSettingsBtn.addEventListener('click', sendSettings);

// ---------- Подключение ----------
async function connectDevice() {
    try {
        device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [
                DIS_SERVICE,
                BATTERY_SERVICE,
                LASER_SERVICE_UUID,
                BACKUP_SERVICE_UUID
            ]
        });

        statusDiv.textContent = `Подключение к ${device.name || 'устройству'}...`;
        server = await device.gatt.connect();
        statusDiv.textContent = `✅ Подключено к ${device.name || 'устройству'}`;
        connectBtn.disabled = true;

        // 1. Читаем DIS (с резервом для серийного номера)
        await readDIS();

        // 2. Читаем BAS
        await readBattery();
        await subscribeBatteryNotifications();

        // 3. Инициализируем управляющую характеристику
        await initLaserCharacteristic();

        if (laserCharacteristic) {
            impulseBtn.disabled = false;
            piezoBtn.disabled = false;
            microphoneBtn.disabled = false;
            resetBtn.disabled = false;
            updateSettingsBtn.disabled = false;
        } else {
            impulseBtn.disabled = true;
            piezoBtn.disabled = true;
            microphoneBtn.disabled = true;
            resetBtn.disabled = true;
            updateSettingsBtn.disabled = true;
            statusDiv.textContent = '⚠️ Управляющая характеристика не найдена';
        }

    } catch (error) {
        console.error(error);
        statusDiv.textContent = '❌ Ошибка: ' + error.message;
        connectBtn.disabled = false;
        impulseBtn.disabled = true;
        piezoBtn.disabled = true;
        microphoneBtn.disabled = true;
        resetBtn.disabled = true;
        updateSettingsBtn.disabled = true;
        // сбросить состояние микрофона
        if (isListening) {
            await stopListening();
            isListening = false;
            microphoneBtn.textContent = '🎤 Микрофон';
        }
    }
}

// ---------- DIS с резервным чтением серийного номера ----------
async function readDIS() {
    try {
        const service = await server.getPrimaryService(DIS_SERVICE);
        for (const [key, uuid] of Object.entries(DIS_CHARS)) {
            try {
                const char = await service.getCharacteristic(uuid);
                const value = await char.readValue();
                const text = new TextDecoder('utf-8').decode(value);
                document.getElementById(key).textContent = text || '—';
            } catch (e) {
                console.warn(`DIS ${key} не найдена или ошибка чтения`);
                if (key === 'serial') {
                    await readSerialFromBackup();
                }
            }
        }
    } catch (e) {
        console.warn('Устройство не поддерживает DIS');
        await readSerialFromBackup();
    }
}

// ---------- Чтение серийного номера из резервного сервиса ----------
async function readSerialFromBackup() {
    try {
        const service = await server.getPrimaryService(BACKUP_SERVICE_UUID);
        const char = await service.getCharacteristic(BACKUP_CHAR_UUID);
        const value = await char.readValue();
        const text = new TextDecoder('utf-8').decode(value);
        document.getElementById('serial').textContent = text || '—';
        console.log('Серийный номер получен из резервного сервиса:', text);
    } catch (e) {
        console.warn('Резервный сервис для серийного номера не доступен');
        document.getElementById('serial').textContent = '—';
    }
}

// ---------- BAS ----------
async function readBattery() {
    try {
        const service = await server.getPrimaryService(BATTERY_SERVICE);
        const char = await service.getCharacteristic(BATTERY_CHAR);
        const value = await char.readValue();
        const level = value.getUint8(0);
        document.getElementById('battery-level').textContent = level;
    } catch (e) {
        console.warn('Не удалось прочитать заряд батареи');
        document.getElementById('battery-level').textContent = '—';
    }
}

async function subscribeBatteryNotifications() {
    try {
        const service = await server.getPrimaryService(BATTERY_SERVICE);
        const char = await service.getCharacteristic(BATTERY_CHAR);
        if (char.properties.notify) {
            await char.startNotifications();
            char.addEventListener('characteristicvaluechanged', (event) => {
                const value = event.target.value;
                const level = value.getUint8(0);
                document.getElementById('battery-level').textContent = level;
            });
            console.log('Подписка на батарею активна');
        }
    } catch (e) {
        console.log('Уведомления о батарее не поддерживаются');
    }
}

// ---------- Лазерная характеристика (управление + телеметрия) ----------
async function initLaserCharacteristic() {
    try {
        const service = await server.getPrimaryService(LASER_SERVICE_UUID);
        console.log('Сервис найден:', LASER_SERVICE_UUID);

        // ---- 1. Характеристика для отправки команд (INPUT) ----
        const inputChar = await service.getCharacteristic(LASER_INPUT_UUID);
        console.log('INPUT характеристика найдена:', LASER_INPUT_UUID);
        if (inputChar.properties.write || inputChar.properties.writeWithoutResponse) {
            laserCharacteristic = inputChar;
            console.log('INPUT характеристика готова к записи');
        } else {
            console.warn('INPUT характеристика не поддерживает запись');
            laserCharacteristic = null;
        }

        // ---- 2. Характеристика для получения телеметрии (OUTPUT) ----
        try {
            const outputChar = await service.getCharacteristic(LASER_OUTPUT_UUID);
            console.log('OUTPUT характеристика найдена:', LASER_OUTPUT_UUID);

            if (outputChar.properties.notify) {
                await outputChar.startNotifications();
                outputChar.addEventListener('characteristicvaluechanged', (event) => {
                    const value = event.target.value;
                    if (value.byteLength === 5) {
                        const data = new Uint8Array(value.buffer);
                        const state = data[0];
                        const impulseTime = data[1] | (data[2] << 8);
                        const pauseTime = data[3] | (data[4] << 8);

                        document.getElementById('laser-state').textContent =
                            state === 0x07 ? 'Ожидание команды' :
                            state === 0x03 ? 'Работа от пьезоэлемента' :
                            `0x${state.toString(16).padStart(2, '0')}`;
                        document.getElementById('impulse-time').textContent = impulseTime;
                        document.getElementById('pause-time').textContent = pauseTime;

                        console.log('Телеметрия:', { state, impulseTime, pauseTime });
                    } else {
                        console.warn('Неверный размер данных телеметрии:', value.byteLength);
                    }
                });
                console.log('Подписка на телеметрию активна');
            } else {
                console.warn('OUTPUT характеристика не поддерживает notify');
            }
        } catch (e) {
            console.warn('Не удалось получить OUTPUT характеристику или подписаться:', e);
        }

    } catch (e) {
        console.error('Не удалось найти лазерный сервис:', e);
        laserCharacteristic = null;
    }
}

// ---------- Отправка импульса ----------
async function sendImpulse() {
    if (!laserCharacteristic) {
        alert('Характеристика не инициализирована. Подключитесь заново.');
        return;
    }

    try {
        const data = new Uint8Array([0x02, 0x00, 0x00, 0x00, 0x00]);
        await laserCharacteristic.writeValue(data);
        statusDiv.textContent = '💥 Импульс отправлен!';
        console.log('Команда отправлена:', data);
    } catch (error) {
        console.error('Ошибка записи:', error);
        alert('Ошибка при отправке: ' + error.message);
        statusDiv.textContent = '❌ Ошибка отправки';
    }
}

// ---------- Отправка команды "Пьезо" ----------
async function sendPiezo() {
    if (!laserCharacteristic) {
        alert('Характеристика не инициализирована. Подключитесь заново.');
        return;
    }

    try {
        const data = new Uint8Array([0x03, 0x00, 0x00, 0x00, 0x00]);
        await laserCharacteristic.writeValue(data);
        statusDiv.textContent = '📳 Команда "Пьезо" отправлена!';
        console.log('Команда отправлена:', data);
    } catch (error) {
        console.error('Ошибка записи:', error);
        alert('Ошибка при отправке команды "Пьезо": ' + error.message);
        statusDiv.textContent = '❌ Ошибка отправки';
    }
}

// ---------- Отправка команды микрофона (аналогично импульсу) ----------
async function sendMicrophoneCommand() {
    if (!laserCharacteristic) {
        console.warn('Характеристика не инициализирована, команда не отправлена');
        return;
    }

    try {
        const data = new Uint8Array([0x02, 0x00, 0x00, 0x00, 0x00]);
        await laserCharacteristic.writeValue(data);
        statusDiv.textContent = '🎤 Команда микрофона отправлена!';
        console.log('Команда отправлена:', data);
    } catch (error) {
        console.error('Ошибка записи:', error);
        statusDiv.textContent = '❌ Ошибка отправки команды микрофона';
    }
}

// ---------- Запуск прослушивания микрофона ----------
async function startListening() {
    try {
        // Запрашиваем доступ к микрофону
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        dataArray = new Uint8Array(analyser.fftSize);

        statusDiv.textContent = '🎤 Микрофон активен, ожидание звука...';

        // Запускаем цикл анализа
        function analyze() {
            if (!isListening) return; // остановлено пользователем
            analyser.getByteTimeDomainData(dataArray);
            // Вычисляем RMS (среднеквадратичное) или просто максимум
            let max = 0;
            for (let i = 0; i < dataArray.length; i++) {
                const val = (dataArray[i] - 128) / 128; // нормализация от -1 до 1
                const abs = Math.abs(val);
                if (abs > max) max = abs;
            }
            // Если громкость превышает порог
            if (max > SOUND_THRESHOLD) {
                const now = Date.now();
                if (now - lastCommandTime > COMMAND_COOLDOWN) {
                    lastCommandTime = now;
                    sendMicrophoneCommand();
                }
            }
            // Продолжаем анализ
            animationFrame = requestAnimationFrame(analyze);
        }
        analyze();

        console.log('Микрофон запущен');
    } catch (error) {
        console.error('Ошибка доступа к микрофону:', error);
        alert('Не удалось получить доступ к микрофону. Разрешите доступ и попробуйте снова.');
        // Отключаем режим прослушивания
        await stopListening();
        isListening = false;
        microphoneBtn.textContent = '🎤 Микрофон';
        // Разблокируем остальные кнопки (если характеристика есть)
        if (laserCharacteristic) {
            impulseBtn.disabled = false;
            piezoBtn.disabled = false;
            resetBtn.disabled = false;
            updateSettingsBtn.disabled = false;
        }
        statusDiv.textContent = '❌ Ошибка доступа к микрофону';
    }
}

// ---------- Остановка прослушивания микрофона ----------
async function stopListening() {
    // Останавливаем цикл анализа
    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
    // Останавливаем аудиопоток
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    // Закрываем аудиоконтекст
    if (audioContext) {
        await audioContext.close();
        audioContext = null;
    }
    analyser = null;
    source = null;
    dataArray = null;
    console.log('Микрофон остановлен');
    statusDiv.textContent = '🎤 Микрофон отключён';
}

// ---------- Переключение режима микрофона ----------
function toggleMicrophone() {
    if (isListening) {
        // Выключение режима прослушивания
        isListening = false;
        microphoneBtn.textContent = '🎤 Микрофон';
        // Включаем остальные кнопки (если характеристика есть)
        if (laserCharacteristic) {
            impulseBtn.disabled = false;
            piezoBtn.disabled = false;
            resetBtn.disabled = false;
            updateSettingsBtn.disabled = false;
        }
        // Останавливаем микрофон
        stopListening();
    } else {
        // Включение режима прослушивания
        isListening = true;
        microphoneBtn.textContent = '🎤 Прослушивание';
        // Отключаем остальные кнопки
        impulseBtn.disabled = true;
        piezoBtn.disabled = true;
        resetBtn.disabled = true;
        updateSettingsBtn.disabled = true;
        // Отправляем команду 0x02 (один раз при старте)
        sendMicrophoneCommand();
        // Запускаем микрофон
        startListening();
    }
}

// ---------- Сброс настроек ----------
async function sendReset() {
    if (!laserCharacteristic) {
        alert('Характеристика не инициализирована. Подключитесь заново.');
        return;
    }

    try {
        const data = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00]);
        await laserCharacteristic.writeValue(data);
        statusDiv.textContent = '🔄 Сброс отправлен!';
        console.log('Команда сброса отправлена:', data);
    } catch (error) {
        console.error('Ошибка записи сброса:', error);
        alert('Ошибка при отправке сброса: ' + error.message);
        statusDiv.textContent = '❌ Ошибка сброса';
    }
}

// ---------- Отправка настроек ----------
async function sendSettings() {
    if (!laserCharacteristic) {
        alert('Характеристика не инициализирована. Подключитесь заново.');
        return;
    }

    // Получаем и проверяем значения
    let impulseTime = parseInt(impulseTimeInput.value.trim(), 10);
    let pauseTime = parseInt(pauseTimeInput.value.trim(), 10);

    if (isNaN(impulseTime) || isNaN(pauseTime) || impulseTime < 1 || impulseTime > 5000 || pauseTime < 1 || pauseTime > 5000) {
        alert('Введите целые числа от 1 до 5000 для обоих полей.');
        return;
    }

    // Формируем пакет (5 байт)
    const data = new Uint8Array(5);
    data[0] = 0x01;
    data[1] = impulseTime & 0xFF;
    data[2] = (impulseTime >> 8) & 0xFF;
    data[3] = pauseTime & 0xFF;
    data[4] = (pauseTime >> 8) & 0xFF;

    try {
        await laserCharacteristic.writeValue(data);
        statusDiv.textContent = '✅ Настройки обновлены!';
        console.log('Команда настроек отправлена:', data);
    } catch (error) {
        console.error('Ошибка записи настроек:', error);
        alert('Ошибка при отправке настроек: ' + error.message);
        statusDiv.textContent = '❌ Ошибка обновления настроек';
    }
}