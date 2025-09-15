import express from 'express';
import TestConfiguration from '../models/TestConfiguration.js';
import TestResult from '../models/TestResult.js';
import BrowserTestService from '../services/BrowserTestService.js';

const router = express.Router();

// Get all test configurations
router.get('/configurations', async (req, res) => {
  try {
    const configurations = await TestConfiguration.find()
      .sort({ updatedAt: -1 });
    res.json(configurations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new test configuration
router.post('/configurations', async (req, res) => {
  try {
    const configuration = new TestConfiguration(req.body);
    await configuration.save();
    res.status(201).json(configuration);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update test configuration
router.put('/configurations/:id', async (req, res) => {
  try {
    const configuration = await TestConfiguration.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!configuration) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    res.json(configuration);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete test configuration
router.delete('/configurations/:id', async (req, res) => {
  try {
    const configuration = await TestConfiguration.findByIdAndDelete(req.params.id);
    
    if (!configuration) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    // Also delete associated test results
    await TestResult.deleteMany({ configurationId: req.params.id });
    
    res.json({ message: 'Configuration deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Run test
router.post('/run/:configId', async (req, res) => {
  try {
    const configuration = await TestConfiguration.findById(req.params.configId);
    
    if (!configuration) {
      return res.status(404).json({ error: 'Configuration not found' });
    }

    // Start test execution asynchronously
    BrowserTestService.runTest(configuration)
      .catch(error => console.error('Test execution error:', error));

    res.json({ 
      message: 'Test execution started',
      configurationId: req.params.configId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get test results
router.get('/results/:configId', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const { configId } = req.params;

    let filter = {};
    if (configId !== 'all') {
      filter = { configurationId: configId };
    }

    let query = TestResult.find(filter)
      .sort({ createdAt: -1 })
      .populate('configurationId', 'name targetUrl platform');

    // If limit is 'all', don't paginate
    if (limit !== 'all') {
      const skip = (parseInt(page) - 1) * parseInt(limit);
      query = query.skip(skip).limit(parseInt(limit));
    }

    const results = await query;
    const total = await TestResult.countDocuments(filter);

    res.json({
      results,
      pagination: {
        page: limit === 'all' ? 1 : parseInt(page),
        limit: limit === 'all' ? total : parseInt(limit),
        total,
        pages: limit === 'all' ? 1 : Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// Get specific test result
router.get('/results/detail/:executionId', async (req, res) => {
  try {
    const result = await TestResult.findOne({ executionId: req.params.executionId })
      .populate('configurationId', 'name targetUrl platform');
    
    if (!result) {
      return res.status(404).json({ error: 'Test result not found' });
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;