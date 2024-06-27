const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');

// Konfigurasi bot Telegram
const token = '7081458809:AAH_7ycbIvxLILQppE6T1EwuNFkCSQuAtZI';
const bot = new TelegramBot(token, { polling: true });

// Konfigurasi Google Sheets API
const credentials = require('./credentials.json');
const { client_email, private_key } = credentials;
const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
const jwtClient = new google.auth.JWT(client_email, null, private_key, scopes);
const sheets = google.sheets({ version: 'v4', auth: jwtClient });
const spreadsheetId = '1gVs2pt8GNxl27n1aYHeos_1m0WJFT5SIJ_80tJpOezY';

// Menginisialisasi variabel untuk menyimpan informasi pengguna
let userData = {};

// Fungsi untuk mengirim pesan ke pengguna
function sendMessage(chatId, message, options) {
    bot.sendMessage(chatId, message, options);
}

// Fungsi untuk memperbarui data pengguna
async function updateUserData(chatId, username, name) {
    userData[username] = { name, chatId };
    const values = [[chatId, username, name]];

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'User Data!A2:C',
        });
        const userDataArray = response.data.values || [];

        const updatedUserData = userDataArray.filter(user => user[1] !== username);
        updatedUserData.push([chatId, username, name]);

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'User Data!A2:C',
            valueInputOption: 'RAW',
            resource: {
                values: updatedUserData,
            },
        });
    } catch (error) {
        console.error('Error updating user data:', error);
    }
}


// Fungsi untuk menampilkan tombol nama setelah perintah /start
function showNameButton(chatId) {
    const options = {
        reply_markup: {
            keyboard: [['/daftar']],
            resize_keyboard: true,
        },
    };
    sendMessage(chatId, 'Silakan daftar terlebih dahulu', options);
}

// Fungsi untuk menampilkan tombol absen setelah masukan nama berhasil
function showAbsenButtons(chatId) {
    const options = {
        reply_markup: {
            keyboard: [['Hadir', 'Izin'], ['Off', 'WFH'], ['Cuti']],
            resize_keyboard: true,
        },
    };
    sendMessage(chatId, 'Silakan pilih jenis absen.', options);
}

// Fungsi untuk memeriksa apakah pengguna sudah terdaftar
async function isUserRegistered(username) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'User Data!A:C', // Kolom A untuk id, Kolom B untuk username, dan kolom C untuk Nama
        });
        const userDataArray = response.data.values || [];
        for (const data of userDataArray) {
            if (data[1] === username) { // Ubah ini dari data[0] menjadi data[1]
                return data[2]; // Mengembalikan nama pengguna (kolom C)
            }
        }
        return null; // Jika username tidak ditemukan, kembalikan null
    } catch (error) {
        console.error('Error checking user registration:', error);
        return null;
    }
}

// Fungsi untuk menangani perintah /start
bot.onText(/\/start/, async (msg) => {
    const username = msg.from.username;
    if (!username) {
        sendMessage(msg.chat.id, 'Maaf, Anda harus memiliki username Telegram untuk menggunakan bot ini.');
        return;
    }

    const name = await isUserRegistered(username);

    if (name) {
        userData[username] = { name };
        showAbsenButtons(msg.chat.id);
    } else {
        showNameButton(msg.chat.id);
    }
});

// Fungsi untuk menangani perintah /daftar
bot.onText(/\/daftar/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;
    if (!username) {
        sendMessage(chatId, 'Maaf, Anda harus memiliki username Telegram untuk menggunakan bot ini.');
        return;
    }

    const options = {
        reply_markup: {
            force_reply: true,
            selective: true,
        },
    };
    sendMessage(chatId, 'Silakan masukkan nama lengkap Anda.', options);

    async function handleNameResponse(responseMsg) {
        if (responseMsg.reply_to_message && responseMsg.reply_to_message.text === 'Silakan masukkan nama lengkap Anda.') {
            const name = responseMsg.text;
            const existingName = await isUserRegistered(username);
            if (existingName) {
                sendMessage(chatId, 'Anda sudah terdaftar dengan nama: ' + existingName);
                return;
            }

            updateUserData(chatId, username, name)
                .then(() => {
                    showAbsenButtons(chatId);
                })
                .catch((error) => {
                    console.error('Error updating user data:', error);
                });

            bot.removeListener('message', handleNameResponse);
        }
    }

    bot.on('message', handleNameResponse);
});

// Fungsi untuk menambahkan data absensi ke spreadsheet
async function addAttendanceToSheet(username, name, type, location, timestamp, photoUrl) {
    try {
        const currentTime = new Date(timestamp);
        const sheetName = `Absensi ${getCurrentMonth()}`;

        const sheetExists = await checkSheetExists(sheetName);
        if (!sheetExists) {
            await createSheet(sheetName);
        }

        let attendanceType = type;
        let lateMessage = '';

        if (type === 'Hadir' && (currentTime.getHours() > 8 || (currentTime.getHours() === 8 && currentTime.getMinutes() > 10))) {
            attendanceType = 'Absen Telat';
            lateMessage = 'Anda terlambat melakukan absen.';
        }

        const formattedDate = `${currentTime.getFullYear()}-${('0' + (currentTime.getMonth() + 1)).slice(-2)}-${('0' + currentTime.getDate()).slice(-2)}`;
        const formattedTime = `${formattedDate} ${('0' + currentTime.getHours()).slice(-2)}:${('0' + currentTime.getMinutes()).slice(-2)}`;

        const values = [[username, name, attendanceType, location, formattedTime, photoUrl || '']];
        const resource = { values };

        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A2:F`,
            valueInputOption: 'RAW',
            resource,
        });

        return lateMessage;
    } catch (error) {
        console.error('Error adding attendance to sheet:', error);
        return 'Terjadi kesalahan saat menyimpan absensi.';
    }
}

// Fungsi untuk memeriksa apakah lembar kerja sudah ada
async function checkSheetExists(sheetName) {
    try {
        const response = await sheets.spreadsheets.get({
            spreadsheetId,
        });
        const sheetsList = response.data.sheets.map(sheet => sheet.properties.title);
        return sheetsList.includes(sheetName);
    } catch (error) {
        console.error('Error checking sheet existence:', error);
        return false;
    }
}

// Fungsi untuk membuat lembar kerja baru
async function createSheet(sheetName) {
    try {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: {
                requests: [
                    {
                        addSheet: {
                            properties: {
                                title: sheetName,
                            },
                        },
                    },
                ],
            },
        });
    } catch (error) {
        console.error('Error creating sheet:', error);
    }
}


// Fungsi untuk mendapatkan nama bulan saat ini (untuk nama sheet)
function getCurrentMonth() {
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const currentDate = new Date();
    return months[currentDate.getMonth()];
}

// Fungsi untuk memeriksa apakah pengguna telah absen hari ini
async function hasUserAttendedToday(username) {
    const sheetName = `Absensi ${getCurrentMonth()}`;
    const today = new Date().toISOString().split('T')[0];

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:E`,
        });

        const attendanceData = response.data.values || [];

        return attendanceData.some(row => {
            const [rowUsername, , , , timestamp] = row;
            return rowUsername === username && timestamp.startsWith(today);
        });
    } catch (error) {
        console.error('Error checking user attendance:', error);
        return false;
    }
}


// Objek untuk menyimpan status absensi pengguna
let userAbsenceState = {};


// Fungsi untuk menangani perintah absen
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;
    if (!username) {
        sendMessage(chatId, 'Maaf, Anda harus memiliki username Telegram untuk menggunakan bot ini.');
        return;
    }

    // Periksa apakah user sudah terdaftar
    const userInfo = await getUserInfo(username);
    if (!userInfo) {
        sendMessage(chatId, 'Anda belum terdaftar. Silakan daftar terlebih dahulu dengan perintah /daftar');
        return;
    }

    const { name } = userInfo;

    if (['Hadir', 'Izin', 'Off', 'Cuti', 'WFH'].includes(msg.text)) {
        const hasAttended = await hasUserAttendedToday(username);
        if (hasAttended) {
            sendMessage(msg.chat.id, 'Anda sudah absen hari ini.');
            return;
        }

        if (msg.text === 'Hadir') {

            userAbsenceState[chatId] = { state: 'waiting_location', username, name };
            const options = {
                reply_markup: {
                    keyboard: [[{ text: "Bagikan Lokasi", request_location: true }]],
                    resize_keyboard: true,
                    one_time_keyboard: true
                },
            };
            sendMessage(chatId, 'Silakan bagikan lokasi Anda.', options);

        } else if (msg.text === 'Izin') {

            const options = {
                reply_markup: {
                    force_reply: true,
                    selective: true,
                },
            };
            sendMessage(msg.chat.id, 'Silakan berikan keterangan izin Anda.', options);

            // Fungsi untuk menangani balasan keterangan izin
            function handleReasonResponse(reasonMsg) {
                if (reasonMsg.reply_to_message && reasonMsg.reply_to_message.text === 'Silakan berikan keterangan izin Anda.') {
                    const reason = reasonMsg.text;
                    const timestamp = new Date().toISOString();
                    addAttendanceToSheet(username, name, `Izin: ${reason}`, '', timestamp, '')
                        .then(() => {
                            sendMessage(msg.chat.id, 'Absen izin berhasil!');
                        })
                        .catch((error) => {
                            console.error('Error adding attendance:', error);
                            sendMessage(msg.chat.id, 'Terjadi kesalahan saat menyimpan absensi.');
                        });
                    // Hapus event listener setelah selesai
                    bot.removeListener('message', handleReasonResponse);
                }
            }

            // Menambahkan event listener untuk balasan keterangan izin
            bot.on('message', handleReasonResponse);
        } else if (msg.text === 'Off') {

            const timestamp = new Date().toISOString();
            addAttendanceToSheet(username, name, 'Off', '', timestamp, '')
                .then(() => {
                    sendMessage(msg.chat.id, 'Absen off berhasil!');
                })
                .catch((error) => {
                    console.error('Error adding attendance:', error);
                    sendMessage(msg.chat.id, 'Terjadi kesalahan saat menyimpan absensi.');
                });
        } else if (msg.text === 'Cuti') {

            const options = {
                reply_markup: {
                    force_reply: true,
                    selective: true,
                },
            };
            sendMessage(msg.chat.id, 'Berapa lama Anda akan cuti?', options);

            // Fungsi untuk menangani balasan durasi cuti
            function handleDurationResponse(durationMsg) {
                if (durationMsg.reply_to_message && durationMsg.reply_to_message.text === 'Berapa lama Anda akan cuti?') {
                    const duration = durationMsg.text;
                    const reasonOptions = {
                        reply_markup: {
                            force_reply: true,
                            selective: true,
                        },
                    };
                    sendMessage(msg.chat.id, 'Silakan berikan keterangan cuti Anda.', reasonOptions);

                    // Fungsi untuk menangani balasan keterangan cuti
                    function handleReasonResponse(reasonMsg) {
                        if (reasonMsg.reply_to_message && reasonMsg.reply_to_message.text === 'Silakan berikan keterangan cuti Anda.') {
                            const reason = reasonMsg.text;
                            const timestamp = new Date().toISOString();
                            addAttendanceToSheet(username, name, `Cuti: ${duration} - ${reason}`, '', timestamp, '')
                                .then(() => {
                                    sendMessage(msg.chat.id, 'Absen cuti berhasil!');
                                })
                                .catch((error) => {
                                    console.error('Error adding attendance:', error);
                                    sendMessage(msg.chat.id, 'Terjadi kesalahan saat menyimpan absensi.');
                                });
                            // Hapus event listener setelah selesai
                            bot.removeListener('message', handleReasonResponse);
                        }
                    }

                    // Menambahkan event listener untuk balasan keterangan cuti
                    bot.on('message', handleReasonResponse);

                    // Hapus event listener setelah selesai
                    bot.removeListener('message', handleDurationResponse);
                }
            }

            // Menambahkan event listener untuk balasan durasi cuti
            bot.on('message', handleDurationResponse);
        } else if (msg.text === 'WFH') {

            const timestamp = new Date().toISOString();
            addAttendanceToSheet(username, name, 'WFH', 'Work From Home', timestamp, '')
                .then(() => {
                    sendMessage(msg.chat.id, 'Absen WFH berhasil!');
                })
                .catch((error) => {
                    console.error('Error adding attendance:', error);
                    sendMessage(msg.chat.id, 'Terjadi kesalahan saat menyimpan absensi.');
                });
        }
    }
});

async function getUserInfo(username) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'User Data!A2:C',
        });
        const userDataArray = response.data.values || [];
        const userInfo = userDataArray.find(user => user[1] === username);
        if (userInfo) {
            return { chatId: userInfo[0], username: userInfo[1], name: userInfo[2] };
        }
        return null;
    } catch (error) {
        console.error('Error getting user info:', error);
        return null;
    }
}


// Fungsi untuk memperoleh data absensi dari Google Sheets
async function getAttendanceData() {
    try {
        const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        const currentDate = new Date();
        const monthNow = currentDate.getMonth();
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Absensi '+months[monthNow]+'!A2:D',
        });
        return response.data.values || [];
    } catch (error) {
        console.error('Error getting attendance data:', error);
        return [];
    }
}



// Fungsi untuk menangani perintah /show_profile
bot.onText(/\/show_profile/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;
    if (!username) {
        sendMessage(chatId, 'Maaf, Anda harus memiliki username Telegram untuk menggunakan bot ini.');
        return;
    }

    const userInfo = await getUserInfo(username);
    if (!userInfo) {
        sendMessage(chatId, 'Anda belum terdaftar. Silakan daftar terlebih dahulu.');
        return;
    }

    // Memperoleh data absensi dari Google Sheets
    const attendanceData = await getAttendanceData();
    
    // Menghitung total keterlambatan berdasarkan data absensi
    const totalLate = calculateTotalLate(attendanceData.filter(entry => entry[0] === username));
    
    // Bulan ini
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const currentDate = new Date();
    const monthNow = currentDate.getMonth();
    
    // Menampilkan profil pengguna
    sendMessage(chatId, `Nama: ${userInfo.name}\nBulan: ${months[monthNow]}\nTotal Terlambat: ${totalLate}`);
});

// Fungsi untuk menghitung total keterlambatan berdasarkan data absensi
function calculateTotalLate(attendanceData) {
    return attendanceData.filter(entry => entry[2] === 'Absen Telat').length;
}
// Fungsi untuk menangani perintah /lokasi
bot.onText(/\/lokasi/, (msg) => {
    const chatId = msg.chat.id;
    // Kirim pesan kepada pengguna untuk meminta lokasi mereka
    bot.sendMessage(chatId, 'Bagikan lokasi Anda dengan saya, tekan tombol atau kirimkan lokasi secara langsung.', {
        reply_markup: {
            keyboard: [[{ text: "Bagikan Lokasi", request_location: true }]],
            resize_keyboard: true,
            one_time_keyboard: true
        }
    });
});

// Fungsi untuk menangani pesan lokasi
bot.on('location', async (msg) => {
    const chatId = msg.chat.id;
    
    if (userAbsenceState[chatId] && userAbsenceState[chatId].state === 'waiting_location') {
        const { latitude, longitude } = msg.location;
        console.log(`Received location: ${latitude}, ${longitude}`);
        
        const isValidLocation = validateLocation(latitude, longitude);
        
        if (isValidLocation) {
            userAbsenceState[chatId].state = 'waiting_photo';
            userAbsenceState[chatId].location = `${latitude}, ${longitude}`;
            userAbsenceState[chatId].timestamp = new Date().toISOString();
            
            const photoOptions = {
                reply_markup: {
                    remove_keyboard: true,
                },
            };
            sendMessage(chatId, 'Lokasi Anda valid. Silakan kirimkan foto kehadiran Anda.', photoOptions);
        } else {
            sendMessage(chatId, 'Lokasi tidak valid. Silakan kirimkan lokasi yang benar.');
            userAbsenceState[chatId].state = 'waiting_location';
            const options = {
                reply_markup: {
                    keyboard: [[{ text: "Bagikan Lokasi", request_location: true }]],
                    resize_keyboard: true,
                    one_time_keyboard: true
                },
            };
            sendMessage(chatId, 'Silakan bagikan lokasi Anda kembali.', options);
        }
    }
});

// Fungsi untuk menangani pesan foto
bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    
    if (userAbsenceState[chatId] && userAbsenceState[chatId].state === 'waiting_photo') {
        const { username, name, location, timestamp } = userAbsenceState[chatId];
        
        // Periksa kembali apakah user sudah absen hari ini
        const hasAttended = await hasUserAttendedToday(username);
        if (hasAttended) {
            sendMessage(chatId, 'Anda sudah absen hari ini.');
            delete userAbsenceState[chatId];
            return;
        }
        
        const photoUrl = await bot.getFileLink(msg.photo[msg.photo.length - 1].file_id);
        
        const attendanceResult = await addAttendanceToSheet(username, name, 'Hadir', location, timestamp, photoUrl);
        let message = `Absen berhasil! `;
        if (attendanceResult.includes('terlambat')) {
            message += 'Anda terlambat melakukan absen.';
        } else {
            message += 'Absen tepat waktu.';
        }
        sendMessage(chatId, message, {
            reply_markup: {
                keyboard: [['Hadir', 'Izin'], ['Off', 'WFH'], ['Cuti']],
                resize_keyboard: true,
            },
        });
        delete userAbsenceState[chatId];
    }
});


// Fungsi untuk memvalidasi lokasi pengguna -0.4943361835414167, 117.14824806696326
function validateLocation(latitude, longitude) {
    const officeLatitude = -0.4943361835414167;
    const officeLongitude = 117.14824806696326;

    const distance = getDistance(latitude, longitude, officeLatitude, officeLongitude);

    const allowedDistance = 300; // 200 meters

    console.log(`Received location: ${latitude}, ${longitude}`);
    console.log(`Office location: ${officeLatitude}, ${officeLongitude}`);
    console.log(`Distance: ${distance} meters`);

    return distance <= allowedDistance;
}
// Fungsi untuk menghitung jarak antara dua titik koordinat (dalam meter)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = toRadians(lat1);
    const φ2 = toRadians(lat2);
    const Δφ = toRadians(lat2 - lat1);
    const Δλ = toRadians(lon2 - lon1);

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const d = R * c; // Distance in meters
    return d;
}

// Fungsi untuk mengonversi derajat menjadi radian
function toRadians(degrees) {
    return degrees * Math.PI / 180;
}
