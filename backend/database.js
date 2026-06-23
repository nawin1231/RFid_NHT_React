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

const poolPromise = new sql.ConnectionPool(dbConfig)
    .connect()
    .then(pool => {
        console.log('Connected database successfully!');
        return pool;
    })
    .catch(err => {
        console.error('Connection error:', err);
    });

module.exports = { sql, poolPromise };