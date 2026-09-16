const sql = require('mssql/msnodesqlv8');
// const sql = require('mssql');

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
//     server: '10.128.17.252',
//     database: 'db_nht_washing_rfid_1',
//     user:     'sa',
//     password: 'RFIDsa@admin',
//     port:     1433,
//     options: {
//         trustServerCertificate: true,
//         enableArithAbort:       true,
//     }
// };

const pool = new sql.ConnectionPool(dbConfig);

const poolPromise = pool.connect().then(() => {
    return pool;
}).catch(err => {
    process.exit(1);
});

module.exports = { sql, poolPromise };