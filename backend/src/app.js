const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
require('dotenv').config();

const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Render terminates TLS at a proxy; needed for correct client IPs in rate limiting.
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(cors());
// Photo uploads (receipts, driver documents) arrive as base64 JSON and need more room.
const smallJson = express.json({ limit: '100kb' });
const photoJson = express.json({ limit: '12mb' });
app.use((req, res, next) =>
  (/\/(receipts\/scan|documents\/[^/]+\/upload)$/.test(req.path) ? photoJson : smallJson)(req, res, next)
);
app.use(express.urlencoded({ extended: true }));

// Swagger setup (development only)
if (NODE_ENV === 'development') {
  const swaggerOptions = {
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'InThaRoute API',
        version: '1.0.0',
        description: 'InThaRoute Backend API Documentation',
      },
      servers: [
        {
          url: `http://localhost:${PORT}`,
          description: 'Development server',
        },
      ],
    },
    apis: ['./src/routes/*.js', './src/controllers/*.js'],
  };

  const swaggerSpec = swaggerJsdoc(swaggerOptions);
  app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// Routes
app.use('/api', routes);

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'InThaRoute API is running' });
});

app.use(errorHandler.notFound);
app.use(errorHandler);

module.exports = app;
