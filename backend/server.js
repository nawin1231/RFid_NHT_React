require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const rfidRoutes = require('./routes/rfid');
const { router: as400Routes, retryErrors } = require('./routes/as400');
const app  = express();
const PORT = 1001;

app.use(cors({
    origin: '*'
}));
app.use(express.json());

app.use('/api/rfid', rfidRoutes);
app.use('/api/as400', as400Routes);

app.get('/', (req, res) => {
    res.json({ message: 'RFID API running' });
});

app.listen(PORT, '0.0.0.0', () => {
    setInterval(retryErrors, 5 * 60 * 1000);
});