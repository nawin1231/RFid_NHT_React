const express    = require('express');
const cors       = require('cors');
const rfidRoutes = require('./routes/rfid');
const app  = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

app.use('/api/rfid', rfidRoutes);

app.get('/', (req, res) => {
    res.json({ message: 'RFID API running' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});