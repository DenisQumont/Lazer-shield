// ---------- UUID ----------
// DIS
const DIS_SERVICE = '0000180a-0000-1000-8000-00805f9b34fb';
const DIS_CHARS = {
    manufacturer: '00002a29-0000-1000-8000-00805f9b34fb',
    model: '00002a24-0000-1000-8000-00805f9b34fb',
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

// ---------- Глобальные переменные ----------
let device = null;
let server = null;
let laserCharacteristic = null;  // характеристика для записи

const connectBtn = document.getElementById('connectBtn');
const impulseBtn = document.getElementById('impulseBtn');
const statusDiv = document.getElementById('status');

connectBtn.addEventListener('click', connectDevice);
impulseBtn.addEventListener('click', sendImpulse);

// ---------- Подключение ----------
async function connectDevice() {
    try {
        device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [
                DIS_SERVICE,
                BATTERY_SERVICE,
                LASER_SERVICE_UUID   // добавляем наш сервис
            ]
        });

        statusDiv.textContent = `Подключение к ${device.name || 'устройству'}...`;
        server = await device.gatt.connect();
        statusDiv.textContent = `✅ Подключено к ${device.name || 'устройству'}`;
        connectBtn.disabled = true;

        // 1. Читаем DIS
        await readDIS();

        // 2. Читаем BAS
        await readBattery();
        await subscribeBatteryNotifications();

        // 3. Инициализируем управляющую характеристику
        await initLaserCharacteristic();

        // Если характеристика найдена – активируем кнопку
        if (laserCharacteristic) {
            impulseBtn.disabled = false;
        } else {
            impulseBtn.disabled = true;
            statusDiv.textContent = '⚠️ Управляющая характеристика не найдена';
        }

    } catch (error) {
        console.error(error);
        statusDiv.textContent = '❌ Ошибка: ' + error.message;
        connectBtn.disabled = false;
        impulseBtn.disabled = true;
    }
}

// ---------- DIS ----------
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
                console.warn(`DIS ${key} не найдена`);
            }
        }
    } catch (e) {
        console.warn('Устройство не поддерживает DIS');
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

// ---------- Лазерная характеристика (управление) ----------
async function initLaserCharacteristic() {
    try {
        // Пытаемся получить сервис
        const service = await server.getPrimaryService(LASER_SERVICE_UUID);
        console.log('Сервис найден:', LASER_SERVICE_UUID);

        // Пытаемся получить характеристику
        const char = await service.getCharacteristic(LASER_INPUT_UUID);
        console.log('Характеристика найдена:', LASER_INPUT_UUID);

        // Проверяем, можно ли писать
        if (char.properties.write || char.properties.writeWithoutResponse) {
            laserCharacteristic = char;
            console.log('Характеристика готова к записи');
        } else {
            console.warn('Характеристика не поддерживает запись');
            laserCharacteristic = null;
        }
    } catch (e) {
        console.error('Не удалось найти лазерный сервис/характеристику:', e);
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
        // Команда: 0x02 0x00 0x00 0x00 0x00
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