const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
require('dotenv').config();

// Google Sheets setup
const auth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, auth);

// MySQL setup
const mysqlConfig = {
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
};

// Email setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Store the last known ID to detect new items
let lastKnownId = 0;

// Initialize Google Sheet
async function initializeSheet() {
  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];
  await sheet.setHeaderRow(['ID','Tiêu đề', 'Tên', 'Email','Số điện thoại', 'Created At']);
  return sheet;
}

// Fetch data from MySQL and update Google Sheet
async function syncMySQLToSheet() {
  const connection = await mysql.createConnection(mysqlConfig);
  const [rows] = await connection.execute('SELECT * FROM table_contact');
  await connection.end();

  const sheet = await initializeSheet();
  await sheet.clearRows(); // Clear existing rows
  await sheet.addRows(rows.map(row => ({
    ID: row.id,
    Title: row.tieude,
    Name: row.ten,
    Email: row.email,
    Phone:row.dienthoai,
    'Created At': row.ngaytao,
  })));
  console.log('Google Sheet updated with MySQL data');
}

// Check for new items and send notifications
async function checkForNewItems() {
  const connection = await mysql.createConnection(mysqlConfig);
  const [rows] = await connection.execute('SELECT * FROM table_contact WHERE id > ?', [lastKnownId]);
  await connection.end();

  if (rows.length > 0) {
    lastKnownId = Math.max(...rows.map(row => row.id));
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: 'cuong.ht@somed.vn', // Replace with your email
      subject: 'New Items Added to MySQL',
      text: `New items detected:\n${JSON.stringify(rows, null, 2)}`,
    };
    await transporter.sendMail(mailOptions);
    console.log('Notification sent for new items');
  }
}

// Run sync and check for new items every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    await syncMySQLToSheet();
    await checkForNewItems();
  } catch (error) {
    console.error('Error:', error);
  }
});

// Initial run
(async () => {
  try {
    await syncMySQLToSheet();
    const connection = await mysql.createConnection(mysqlConfig);
    const [rows] = await connection.execute('SELECT MAX(id) as maxId FROM products');
    lastKnownId = rows[0].maxId || 0;
    await connection.end();
    console.log('Initial sync complete. Monitoring for new items...');
  } catch (error) {
    console.error('Initial setup error:', error);
  }
})();