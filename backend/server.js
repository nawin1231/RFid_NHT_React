require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const rfidRoutes = require('./routes/rfid');
const as400Routes = require('./routes/as400');
const monitorRoutes = require('./routes/monitor');
const app  = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

app.use('/api/rfid', rfidRoutes);
app.use('/api/as400', as400Routes);
app.use('/api/monitor', monitorRoutes);     

app.get('/', (req, res) => {
    res.json({ message: 'RFID API running' });
});

app.listen(PORT, () => {
    //console.log(`✅ Server running on http://localhost:${PORT}`);
});