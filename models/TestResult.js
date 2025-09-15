import mongoose from 'mongoose';

const testResultSchema = new mongoose.Schema({
  configurationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TestConfiguration',
    required: true
  },
  executionId: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['running', 'completed', 'failed', 'cancelled'],
    default: 'running'
  },
  startTime: {
    type: Date,
    default: Date.now
  },
  endTime: Date,
  duration: Number,
  results: {
    productPageTests: [{
      url: String,
      passed: Boolean,
      elements: {
        title: { present: Boolean, text: String },
        price: { present: Boolean, text: String },
        addToCart: { present: Boolean, clickable: Boolean },
        description: { present: Boolean, text: String },
        variants: { present: Boolean, count: Number }
      },
      performance: {
        loadTime: Number,
        timeToInteractive: Number
      },
      errors: [String]
    }],
    imageValidation: [{
      url: String,
      src: String,
      loaded: Boolean,
      status: Number,
      altText: String,
      dimensions: {
        width: Number,
        height: Number
      },
      errors: [String]
    }],
    errorDetection: {
      jsErrors: [{
        message: String,
        source: String,
        line: Number,
        column: Number,
        stack: String,
        timestamp: Date
      }],
      networkErrors: [{
        url: String,
        status: Number,
        error: String,
        timestamp: Date
      }],
      consoleWarnings: [{
        message: String,
        timestamp: Date
      }]
    }
  },
  aiAnalysis: {
    summary: String,
    recommendations: [String],
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical']
    },
    score: {
      type: Number,
      min: 0,
      max: 100
    }
  },
  screenshots: [String],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('TestResult', testResultSchema);