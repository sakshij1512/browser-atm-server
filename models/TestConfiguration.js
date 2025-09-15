import mongoose from 'mongoose';

const testConfigurationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  targetUrl: {
    type: String,
    required: true,
    trim: true
  },
  platform: {
    type: String,
    enum: ['shopify', 'bigcommerce', 'other'],
    required: true
  },
  productPages: [{
    url: String,
    identifier: String
  }],
  testSettings: {
    timeout: {
      type: Number,
      default: 30000
    },
    retryAttempts: {
      type: Number,
      default: 3
    },
    viewport: {
      width: {
        type: Number,
        default: 1920
      },
      height: {
        type: Number,
        default: 1080
      }
    },
    mobileTest: {
      type: Boolean,
      default: false
    }
  },
  testTypes: {
    productPageTest: {
      type: Boolean,
      default: true
    },
    imageValidation: {
      type: Boolean,
      default: true
    },
    errorDetection: {
      type: Boolean,
      default: true
    }
  },
  schedule: {
    enabled: {
      type: Boolean,
      default: false
    },
    frequency: {
      type: String,
      enum: ['hourly', 'daily', 'weekly'],
      default: 'daily'
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

testConfigurationSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model('TestConfiguration', testConfigurationSchema);