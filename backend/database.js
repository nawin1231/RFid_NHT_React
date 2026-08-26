const sql = require('mssql/msnodesqlv8');

const dbConfig = {
    server: 'PBSY70\\SQLEXPRESS',
    database: 'db_nht_washing_rfid_1',
    driver: 'msnodesqlv8',
    options: {
        trustedConnection: true, 
        trustServerCertificate: true 
    }
};

// const dbConfig = {
//     server: '10.120.139.25',
//     database: 'db_nht_washing_rfid_1',
//     driver: 'msnodesqlv8',
//     user:     process.env.DB_USER,
//     password: process.env.DB_PASSWORD,
//     options: {
//         trustedConnection:      false,
//         trustServerCertificate: true
//     }
// };

const poolPromise = new sql.ConnectionPool(dbConfig)
    .connect()
    .then(pool => {
        return pool;
    })
    .catch(err => {
        console.error('Connection error:', err);
    });

module.exports = { sql, poolPromise };