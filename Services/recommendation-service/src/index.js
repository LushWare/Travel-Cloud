import 'dotenv/config';
import app from './app.js';

const PORT = process.env.PORT || 3013;
app.listen(PORT, '0.0.0.0');