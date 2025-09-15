import OpenAI from 'openai';
import winston from 'winston';
import dotenv from 'dotenv';

dotenv.config();

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

class AIAnalysisService {
  constructor() {
  if (process.env.OPENAI_API_KEY) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    logger.info("✅ OpenAI API key detected and client initialized");
  } else {
    this.openai = null;
    logger.warn("⚠️ No OpenAI API key found, falling back to basic analysis");
  }
}


  async analyzeTestResults(results) {
    if (!this.openai) {
      return this.generateBasicAnalysis(results);
    }

    try {
      const analysisPrompt = this.generatePrompt(results);
      
      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are an expert QA engineer analyzing ecommerce website test results. Provide actionable insights and recommendations."
          },
          {
            role: "user",
            content: analysisPrompt
          }
        ],
        max_tokens: 1000,
        temperature: 0.3
      });

      const aiResponse = completion.choices[0].message.content;
      return this.parseAIResponse(aiResponse, results);

    } catch (error) {
      logger.error('AI analysis failed, falling back to basic analysis:', error);
      return this.generateBasicAnalysis(results);
    }
  }

  generatePrompt(results) {
    const summary = {
      productPagesTotal: results.productPageTests.length,
      productPagesPassed: results.productPageTests.filter(t => t.passed).length,
      imagesTotal: results.imageValidation.length,
      imagesLoaded: results.imageValidation.filter(i => i.loaded).length,
      jsErrorsCount: results.errorDetection.jsErrors.length,
      networkErrorsCount: results.errorDetection.networkErrors.length,
      warningsCount: results.errorDetection.consoleWarnings.length
    };

    return `Analyze the following ecommerce website test results:

Product Page Tests:
- Total pages tested: ${summary.productPagesTotal}
- Pages passed: ${summary.productPagesPassed}
- Critical elements missing: ${this.getCriticalElementIssues(results.productPageTests)}

Image Loading:
- Total images: ${summary.imagesTotal}
- Successfully loaded: ${summary.imagesLoaded}
- Failed to load: ${summary.imagesTotal - summary.imagesLoaded}

Errors Detected:
- JavaScript errors: ${summary.jsErrorsCount}
- Network failures: ${summary.networkErrorsCount}
- Console warnings: ${summary.warningsCount}

Most critical JavaScript errors:
${results.errorDetection.jsErrors.slice(0, 3).map(e => `- ${e.message}`).join('\n')}

Please provide:
1. Overall risk level (low/medium/high/critical)
2. Quality score (0-100)
3. Top 3 recommendations
4. Brief summary of findings`;
  }

  getCriticalElementIssues(productPageTests) {
    const issues = [];
    productPageTests.forEach(test => {
      if (!test.elements.title.present) issues.push('Missing product titles');
      if (!test.elements.price.present) issues.push('Missing price display');
      if (!test.elements.addToCart.present) issues.push('Missing add to cart buttons');
    });
    return [...new Set(issues)].join(', ') || 'None';
  }

  parseAIResponse(response, results) {
    // Simple parsing - in production, you'd want more sophisticated parsing
    const lines = response.split('\n').filter(line => line.trim());
    
    const riskLevel = this.extractRiskLevel(response);
    const score = this.extractScore(response);
    const recommendations = this.extractRecommendations(response);
    
    return {
      summary: lines[0] || 'Analysis completed',
      recommendations,
      riskLevel,
      score
    };
  }

  extractRiskLevel(text) {
    const riskMatch = text.toLowerCase().match(/(low|medium|high|critical)/);
    return riskMatch ? riskMatch[1] : this.calculateRiskLevel(text);
  }

  extractScore(text) {
    const scoreMatch = text.match(/(\d+)\/100|(\d+)%|score.*?(\d+)/i);
    if (scoreMatch) {
      return parseInt(scoreMatch[1] || scoreMatch[2] || scoreMatch[3]);
    }
    return 75; // Default score
  }

  extractRecommendations(text) {
    const recommendations = [];
    const lines = text.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.match(/^\d+\.|\-|\•/) && line.length > 10) {
        recommendations.push(line.replace(/^\d+\.|\-|\•/, '').trim());
      }
    }
    
    return recommendations.slice(0, 3);
  }

  calculateRiskLevel(results) {
    // Fallback risk calculation
    const failureRate = results.productPageTests ? 
      1 - (results.productPageTests.filter(t => t.passed).length / results.productPageTests.length) : 0;
    
    if (failureRate > 0.5) return 'critical';
    if (failureRate > 0.3) return 'high';
    if (failureRate > 0.1) return 'medium';
    return 'low';
  }

  generateBasicAnalysis(results) {
    const productPagesPassed = results.productPageTests.filter(t => t.passed).length;
    const totalProductPages = results.productPageTests.length;
    const imagesLoaded = results.imageValidation.filter(i => i.loaded).length;
    const totalImages = results.imageValidation.length;
    
    const passRate = totalProductPages > 0 ? (productPagesPassed / totalProductPages) * 100 : 100;
    const imageSuccessRate = totalImages > 0 ? (imagesLoaded / totalImages) * 100 : 100;
    
    const score = Math.round((passRate + imageSuccessRate) / 2);
    
    const riskLevel = score > 80 ? 'low' : score > 60 ? 'medium' : score > 40 ? 'high' : 'critical';
    
    const recommendations = [];
    if (productPagesPassed < totalProductPages) {
      recommendations.push('Fix missing critical elements on product pages');
    }
    if (imagesLoaded < totalImages) {
      recommendations.push('Resolve image loading issues');
    }
    if (results.errorDetection.jsErrors.length > 0) {
      recommendations.push('Address JavaScript errors');
    }

    return {
      summary: `Test completed with ${score}% overall score. ${productPagesPassed}/${totalProductPages} product pages passed validation.`,
      recommendations: recommendations.slice(0, 3),
      riskLevel,
      score
    };
  }
}

export default new AIAnalysisService();