import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import winston from 'winston';

// Routes & middleware
import testRoutes from './routes/tests.js';
import reportRoutes from './routes/reports.js';
import { errorHandler } from './middleware/errorHandler.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

// Show API key status in dev
if (process.env.NODE_ENV !== 'production') {
  console.log(
    'API key loaded:',
    process.env.OPENAI_API_KEY ? ' yes' : ' missing'
  );
}

// Security middleware
app.use(helmet());

// Dynamic CORS setup
const allowedOrigins = [
  'http://localhost:5173', // Dev frontend
];

// Regex for any Netlify deploy URL
const netlifyRegex = /^https:\/\/[a-z0-9-]+\.netlify\.app$/;

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // allow server-to-server or Postman

      if (allowedOrigins.includes(origin) || netlifyRegex.test(origin)) {
        return callback(null, true);
      }

      callback(new Error(`CORS policy: Origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
});
app.use('/api', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req, res) => {
  res.send('Server is running! Visit /api/health for API status.');
});

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => logger.info('MongoDB connected successfully'))
  .catch((err) => logger.error('MongoDB connection error:', err));

// API Routes
app.use('/api/tests', testRoutes);
app.use('/api/reports', reportRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  const distPath = join(__dirname, '../dist');
  app.use(express.static(distPath));

  // SPA fallback
  app.use((req, res) => {
    res.sendFile(join(distPath, 'index.html'));
  });
}

// Error handling middleware
app.use(errorHandler);

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  logger.info(
    `Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`
  );
});

export default app;
