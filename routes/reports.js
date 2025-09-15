import express from 'express';
import TestResult from '../models/TestResult.js';
import TestConfiguration from '../models/TestConfiguration.js';

const router = express.Router();

// Get dashboard statistics
router.get('/dashboard', async (req, res) => {
  try {
    const totalConfigurations = await TestConfiguration.countDocuments();
    const totalTests = await TestResult.countDocuments();
    const recentTests = await TestResult.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('configurationId', 'name');

    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);
    
    const testsLast30Days = await TestResult.countDocuments({
      createdAt: { $gte: last30Days }
    });

    const passedTests = await TestResult.countDocuments({
      status: 'completed',
      createdAt: { $gte: last30Days }
    });

    const successRate = testsLast30Days > 0 ? (passedTests / testsLast30Days) * 100 : 0;

    // Risk distribution
    const riskDistribution = await TestResult.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: last30Days }
        }
      },
      {
        $group: {
          _id: '$aiAnalysis.riskLevel',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      totalConfigurations,
      totalTests,
      testsLast30Days,
      successRate: Math.round(successRate),
      recentTests,
      riskDistribution
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get test trends
router.get('/trends', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const trends = await TestResult.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          total: { $sum: 1 },
          passed: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          avgScore: { $avg: '$aiAnalysis.score' }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      }
    ]);

    res.json(trends);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export test results
router.get('/export/:format', async (req, res) => {
  try {
    const { format } = req.params;
    const { configId, startDate, endDate } = req.query;

    const query = {};
    if (configId && configId !== "all") {
      query.configurationId = configId;
    }
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const results = await TestResult.find(query)
      .populate('configurationId', 'name targetUrl platform')
      .sort({ createdAt: -1 });

    if (format === 'json') {
      res.json(results);
    } else if (format === 'csv') {
      // ✅ FIX: call helper directly
      const csv = generateCSV(results);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=test-results.csv');
      res.send(csv);
    } else {
      res.status(400).json({ error: 'Unsupported format' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function to generate CSV
function generateCSV(results) {
  const headers = [
    'Execution ID',
    'Configuration Name',
    'Target URL',
    'Status',
    'Start Time',
    'Duration (ms)',
    'Risk Level',
    'Score'
  ];

  const rows = results.map(result => [
    result.executionId,
    result.configurationId?.name || '',
    result.configurationId?.targetUrl || '',
    result.status || '',
    result.startTime ? result.startTime.toISOString() : '',
    result.duration || '',
    result.aiAnalysis?.riskLevel || '',
    result.aiAnalysis?.score || ''
  ]);

  return [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n');
}

export default router;
