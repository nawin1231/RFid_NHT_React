require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const rfidRoutes = require('./routes/rfid');
const { router: as400Routes, retryErrors } = require('./routes/as400');
const app  = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

app.use('/api/rfid', rfidRoutes);
app.use('/api/as400', as400Routes);

app.get('/', (req, res) => {
    res.json({ message: 'RFID API running' });
});

app.listen(PORT, () => {
    setInterval(retryErrors, 5 * 60 * 1000);
    console.log(`Server running on port ${PORT}`);
});