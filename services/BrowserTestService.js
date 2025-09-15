import { chromium } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import TestResult from '../models/TestResult.js';
import AIAnalysisService from './AIAnalysisService.js';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

class BrowserTestService {
  constructor() {
    this.browser = null;
  }

  async initializeBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
    return this.browser;
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async runTest(configuration) {
    const executionId = uuidv4();
    const startTime = new Date();
    
    logger.info(`Starting test execution: ${executionId}`);

    // Create test result record
    const testResult = new TestResult({
      configurationId: configuration._id,
      executionId,
      startTime,
      results: {
        productPageTests: [],
        imageValidation: [],
        errorDetection: {
          jsErrors: [],
          networkErrors: [],
          consoleWarnings: []
        }
      }
    });

    try {
      await testResult.save();
      
      const browser = await this.initializeBrowser();
      const context = await browser.newContext({
        viewport: {
          width: configuration.testSettings.viewport.width,
          height: configuration.testSettings.viewport.height
        }
      });

      const page = await context.newPage();
      
      // Set up error listeners
      const jsErrors = [];
      const networkErrors = [];
      const consoleWarnings = [];

      page.on('pageerror', (error) => {
        jsErrors.push({
          message: error.message,
          source: error.stack?.split('\n')[1] || '',
          timestamp: new Date()
        });
      });

      page.on('response', (response) => {
        if (!response.ok()) {
          networkErrors.push({
            url: response.url(),
            status: response.status(),
            error: response.statusText(),
            timestamp: new Date()
          });
        }
      });

      page.on('console', (msg) => {
        if (msg.type() === 'warning') {
          consoleWarnings.push({
            message: msg.text(),
            timestamp: new Date()
          });
        }
      });

      // Test product pages
      for (const productPage of configuration.productPages) {
        const pageResult = await this.testProductPage(page, productPage.url, configuration.testSettings);
        testResult.results.productPageTests.push(pageResult);
      }

      // Test images on all pages
      const imageResults = await this.testImageLoading(page, configuration.productPages.map(p => p.url));
      testResult.results.imageValidation = imageResults;

      // Update error detection results
      testResult.results.errorDetection = {
        jsErrors,
        networkErrors,
        consoleWarnings
      };

      await context.close();

      // Generate AI analysis
      const aiAnalysis = await AIAnalysisService.analyzeTestResults(testResult.results);
      testResult.aiAnalysis = aiAnalysis;

      // Update test result
      testResult.status = 'completed';
      testResult.endTime = new Date();
      testResult.duration = testResult.endTime - testResult.startTime;

      await testResult.save();
      
      logger.info(`Test execution completed: ${executionId}`);
      return testResult;

    } catch (error) {
      logger.error(`Test execution failed: ${executionId}`, error);
      
      testResult.status = 'failed';
      testResult.endTime = new Date();
      testResult.duration = testResult.endTime - testResult.startTime;
      await testResult.save();
      
      throw error;
    }
  }

  // Enhanced element detection with multiple strategies
  async findElementWithMultipleStrategies(page, elementConfig) {
    const { selectors = [], textPatterns = [], contentPatterns = [], attributes = [] } = elementConfig;
    
    // Strategy 1: Try CSS selectors with visibility and content checks
    for (const selector of selectors) {
      try {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const isVisible = await element.isVisible();
          if (isVisible) {
            const text = await element.textContent();
            const innerText = await element.innerText().catch(() => text);
            
            // Check if element has meaningful content
            const content = (innerText || text || '').trim();
            if (content.length > 0) {
              // Additional content validation based on patterns
              if (contentPatterns.length > 0) {
                const matchesPattern = contentPatterns.some(pattern => {
                  if (pattern instanceof RegExp) {
                    return pattern.test(content);
                  }
                  return content.toLowerCase().includes(pattern.toLowerCase());
                });
                if (matchesPattern) {
                  return { element, text: content, selector, strategy: 'css-pattern' };
                }
              } else {
                return { element, text: content, selector, strategy: 'css' };
              }
            }
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Strategy 2: Search by visible text using getByText
    for (const pattern of textPatterns) {
      try {
        const locator = page.getByText(pattern, { exact: false });
        const count = await locator.count();
        if (count > 0) {
          const first = locator.first();
          const isVisible = await first.isVisible();
          if (isVisible) {
            const text = await first.textContent();
            return { element: first, text: text?.trim() || '', selector: `text:${pattern}`, strategy: 'text' };
          }
        }
      } catch (e) {
        // Continue to next pattern
      }
    }

    // Strategy 3: Search by attributes
    for (const attr of attributes) {
      try {
        const elements = await page.$$(`[${attr.name}*="${attr.value}"]`);
        for (const element of elements) {
          const isVisible = await element.isVisible();
          if (isVisible) {
            const text = await element.textContent();
            const content = text?.trim() || '';
            if (content.length > 0) {
              return { element, text: content, selector: `[${attr.name}*="${attr.value}"]`, strategy: 'attribute' };
            }
          }
        }
      } catch (e) {
        // Continue to next attribute
      }
    }

    // Strategy 4: Advanced text content search using evaluate
    if (contentPatterns.length > 0) {
      try {
        const result = await page.evaluate((patterns) => {
          const allElements = document.querySelectorAll('*');
          
          for (const element of allElements) {
            const rect = element.getBoundingClientRect();
            // Skip hidden elements
            if (rect.width === 0 || rect.height === 0) continue;
            
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            
            const text = element.textContent || element.innerText || '';
            const cleanText = text.trim();
            
            if (cleanText.length > 0) {
              for (const pattern of patterns) {
                let matches = false;
                if (pattern.source) { // RegExp pattern
                  const regex = new RegExp(pattern.source, pattern.flags);
                  matches = regex.test(cleanText);
                } else { // String pattern
                  matches = cleanText.toLowerCase().includes(pattern.toLowerCase());
                }
                
                if (matches) {
                  // Generate a unique selector for this element
                  let selector = '';
                  if (element.id) {
                    selector = `#${element.id}`;
                  } else if (element.className && typeof element.className === 'string') {
                    const classes = element.className.split(' ').filter(c => c.length > 0);
                    if (classes.length > 0) {
                      selector = `.${classes[0]}`;
                    }
                  }
                  if (!selector) {
                    selector = element.tagName.toLowerCase();
                  }
                  
                  return { text: cleanText, selector, tagName: element.tagName };
                }
              }
            }
          }
          return null;
        }, contentPatterns.map(p => p instanceof RegExp ? { source: p.source, flags: p.flags } : p));

        if (result) {
          const element = await page.$(result.selector).catch(() => null);
          if (element) {
            return { element, text: result.text, selector: result.selector, strategy: 'content-search' };
          }
        }
      } catch (e) {
        // Continue to fallback
      }
    }

    return null;
  }

  async testProductPage(page, url, settings) {
    const startTime = Date.now();
    const result = {
      url,
      passed: false,
      elements: {
        title: { present: false, text: '', selector: '', strategy: '' },
        price: { present: false, text: '', selector: '', strategy: '' },
        addToCart: { present: false, clickable: false, selector: '', strategy: '' },
        description: { present: false, text: '', selector: '', strategy: '' },
        variants: { present: false, count: 0, selector: '', strategy: '' },
        availability: { present: false, text: '', inStock: null, selector: '', strategy: '' }
      },
      performance: {
        loadTime: 0,
        timeToInteractive: 0
      },
      errors: []
    };

    try {
      // Navigate to page with better wait conditions
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: settings.timeout 
      });
      
      // Wait for additional loading
      await page.waitForTimeout(2000);
      
      // Try to wait for any lazy loading content
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

      const loadTime = Date.now() - startTime;
      result.performance.loadTime = loadTime;

      // Test product title
      const titleConfig = {
        selectors: [
          'h1', 'h2', 'h3',
          '[class*="title" i]', '[class*="name" i]', '[class*="product" i]',
          '[data-testid*="title" i]', '[data-testid*="name" i]',
          '[data-testid*="product" i]', '[id*="title" i]', '[id*="name" i]',
          '.product-title', '.product-name', '.item-title', '.item-name',
          '.pdp-title', '.entry-title', '.main-title', '.page-title',
          '[itemprop="name"]', '[role="heading"]'
        ],
        attributes: [
          { name: 'data-testid', value: 'title' },
          { name: 'data-testid', value: 'name' },
          { name: 'data-testid', value: 'product' },
          { name: 'itemprop', value: 'name' }
        ]
      };
      
      const titleResult = await this.findElementWithMultipleStrategies(page, titleConfig);
      if (titleResult) {
        result.elements.title.present = true;
        result.elements.title.text = titleResult.text;
        result.elements.title.selector = titleResult.selector;
        result.elements.title.strategy = titleResult.strategy;
      }

      // Test price with comprehensive detection
      const priceConfig = {
        selectors: [
          '[class*="price" i]:not([class*="compare" i]):not([class*="was" i]):not([class*="original" i])',
          '[data-testid*="price" i]', '[data-price]', '[data-product-price]',
          '.money', '.currency', '.cost', '.amount', '.value',
          '[id*="price" i]', '[itemprop="price"]', '[itemprop="offers"] [itemprop="price"]',
          '.current-price', '.sale-price', '.selling-price', '.final-price',
          '.product-price', '.item-price', '.pdp-price'
        ],
        contentPatterns: [
          /\$\s*[\d,]+\.?\d*/i,
          /₹\s*[\d,]+\.?\d*/i, 
          /€\s*[\d,]+\.?\d*/i,
          /£\s*[\d,]+\.?\d*/i,
          /USD\s*[\d,]+\.?\d*/i,
          /INR\s*[\d,]+\.?\d*/i,
          /\b\d+\.\d{2}\b/,
          /\b\d{1,3}(,\d{3})*(\.\d{2})?\b/
        ],
        attributes: [
          { name: 'data-testid', value: 'price' },
          { name: 'data-price', value: '' },
          { name: 'itemprop', value: 'price' }
        ]
      };

      const priceResult = await this.findElementWithMultipleStrategies(page, priceConfig);
      if (priceResult) {
        result.elements.price.present = true;
        result.elements.price.text = priceResult.text;
        result.elements.price.selector = priceResult.selector;
        result.elements.price.strategy = priceResult.strategy;
      }

      // Test add to cart button
      const cartConfig = {
        selectors: [
          'button[type="submit"]', 'input[type="submit"]',
          '[class*="add" i][class*="cart" i]', '[class*="cart" i][class*="btn" i]',
          '[class*="buy" i]', '[class*="purchase" i]', '[class*="shop" i]',
          'button', 'input[type="button"]', '[role="button"]',
          '[data-testid*="add" i]', '[data-testid*="cart" i]', '[data-testid*="buy" i]'
        ],
        textPatterns: [
          'Add to Cart', 'Add to Bag', 'Buy Now', 'Purchase', 'Add to Basket',
          'Shop Now', 'Order Now', 'Add', 'Buy', 'Cart'
        ],
        attributes: [
          { name: 'data-testid', value: 'add' },
          { name: 'data-testid', value: 'cart' },
          { name: 'data-action', value: 'add-to-cart' }
        ]
      };
      
      const cartResult = await this.findElementWithMultipleStrategies(page, cartConfig);
      if (cartResult) {
        result.elements.addToCart.present = true;
        result.elements.addToCart.selector = cartResult.selector;
        result.elements.addToCart.strategy = cartResult.strategy;
        
        try {
          const isClickable = await cartResult.element.isEnabled() && await cartResult.element.isVisible();
          result.elements.addToCart.clickable = isClickable;
        } catch (e) {
          result.elements.addToCart.clickable = true;
        }
      }

      // Test product description
      const descConfig = {
        selectors: [
          '[class*="description" i]', '[class*="details" i]', '[class*="summary" i]',
          '[data-testid*="description" i]', '[data-testid*="details" i]',
          '[id*="description" i]', '[id*="details" i]',
          '.product-description', '.item-description', '.product-details',
          '.product-summary', '.product-info', '.description',
          '[itemprop="description"]', '.desc', '.details', '.summary'
        ],
        attributes: [
          { name: 'data-testid', value: 'description' },
          { name: 'itemprop', value: 'description' }
        ]
      };
      
      const descResult = await this.findElementWithMultipleStrategies(page, descConfig);
      if (descResult) {
        result.elements.description.present = true;
        result.elements.description.text = descResult.text.substring(0, 200);
        result.elements.description.selector = descResult.selector;
        result.elements.description.strategy = descResult.strategy;
      }

      // Test variants/options
      const variantConfig = {
        selectors: [
          '[class*="variant" i]', '[class*="option" i]', '[class*="choice" i]',
          '[class*="size" i]', '[class*="color" i]', '[class*="style" i]',
          'select', 'input[type="radio"]', 'input[type="checkbox"]',
          '[data-testid*="variant" i]', '[data-testid*="option" i]',
          '.swatch', '.picker', '.selector',
        ],
        attributes: [
          { name: 'data-testid', value: 'variant' },
          { name: 'name', value: 'variant' },
          { name: 'name', value: 'option' }
        ]
      };
      
      // Count variants differently - look for groups of options
      let variantCount = 0;
      let variantSelector = '';
      let variantStrategy = '';
      
      try {
        // Try to find variant containers first
        const variantContainers = await page.$$('[class*="variant" i], [class*="option" i], .product-options, .product-variants');
        for (const container of variantContainers) {
          const options = await container.$$('button, input, select, .swatch, [role="button"]');
          if (options.length > 0) {
            variantCount += options.length;
            variantSelector = 'container-based';
            variantStrategy = 'container';
            break;
          }
        }

        // If no containers found, count individual variant elements
        if (variantCount === 0) {
          const variantResult = await this.findElementWithMultipleStrategies(page, variantConfig);
          if (variantResult) {
            const allVariants = await page.$$(variantResult.selector);
            variantCount = allVariants.length;
            variantSelector = variantResult.selector;
            variantStrategy = variantResult.strategy;
          }
        }
      } catch (e) {
        result.errors.push(`Variant detection error: ${e.message}`);
      }
      
      if (variantCount > 0) {
        result.elements.variants.present = true;
        result.elements.variants.count = variantCount;
        result.elements.variants.selector = variantSelector;
        result.elements.variants.strategy = variantStrategy;
      }

      // Test availability/stock status
      const availConfig = {
        selectors: [
          '[class*="availability" i]', '[class*="stock" i]', '[class*="inventory" i]',
          '[data-testid*="stock" i]', '[data-testid*="availability" i]',
          '.in-stock', '.out-of-stock', '.stock-status'
        ],
        textPatterns: [
          'In Stock', 'Out of Stock', 'Available', 'Unavailable',
          'In stock', 'out of stock', 'available', 'unavailable'
        ],
        contentPatterns: [
          /in\s*stock/i, /out\s*of\s*stock/i, /available/i, /unavailable/i,
          /\d+\s*in\s*stock/i, /\d+\s*left/i, /\d+\s*remaining/i
        ],
        attributes: [
          { name: 'data-testid', value: 'stock' },
          { name: 'data-testid', value: 'availability' }
        ]
      };
      
      const availResult = await this.findElementWithMultipleStrategies(page, availConfig);
      if (availResult) {
        result.elements.availability.present = true;
        result.elements.availability.text = availResult.text;
        result.elements.availability.selector = availResult.selector;
        result.elements.availability.strategy = availResult.strategy;
        
        // Determine stock status
        const stockText = availResult.text.toLowerCase();
        if (stockText.includes('in stock') || stockText.includes('available')) {
          result.elements.availability.inStock = true;
        } else if (stockText.includes('out of stock') || stockText.includes('unavailable')) {
          result.elements.availability.inStock = false;
        }
      }

      // Determine if test passed with flexible criteria
      result.passed = result.elements.title.present && 
                     result.elements.price.present && 
                     (result.elements.addToCart.present || result.elements.variants.present);

      // Enhanced logging for debugging
      logger.info(`Enhanced page analysis for ${url}:`, {
        title: { present: result.elements.title.present, strategy: result.elements.title.strategy },
        price: { present: result.elements.price.present, strategy: result.elements.price.strategy, text: result.elements.price.text },
        addToCart: { present: result.elements.addToCart.present, strategy: result.elements.addToCart.strategy },
        variants: { count: result.elements.variants.count, strategy: result.elements.variants.strategy },
        availability: { present: result.elements.availability.present, strategy: result.elements.availability.strategy },
        passed: result.passed
      });

    } catch (error) {
      result.errors.push(error.message);
      logger.error(`Error testing product page ${url}:`, error);
    }

    return result;
  }

  async testImageLoading(page, urls) {
    const imageResults = [];

    for (const url of urls) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000); // Wait for images to load
        
        const images = await page.$$('img[src], img[data-src], [style*="background-image"]');
        
        for (const img of images) {
          const src = await img.getAttribute('src') || await img.getAttribute('data-src');
          const alt = await img.getAttribute('alt');
          const style = await img.getAttribute('style');
          
          // Handle background images
          let imageSrc = src;
          if (!imageSrc && style && style.includes('background-image')) {
            const match = style.match(/background-image:\s*url\(['"]?([^'"]+)['"]?\)/);
            if (match) {
              imageSrc = match[1];
            }
          }
          
          if (imageSrc) {
            const result = {
              url,
              src: imageSrc,
              loaded: false,
              status: 0,
              altText: alt || '',
              dimensions: { width: 0, height: 0 },
              errors: []
            };

            try {
              // Check if image is visible and loaded
              const isVisible = await img.isVisible();
              if (isVisible) {
                result.loaded = true;
                result.status = 200; // Assume loaded if visible
                
                const boundingBox = await img.boundingBox();
                if (boundingBox) {
                  result.dimensions.width = boundingBox.width;
                  result.dimensions.height = boundingBox.height;
                }
              }
            } catch (error) {
              result.errors.push(error.message);
            }

            imageResults.push(result);
          }
        }
      } catch (error) {
        logger.error(`Error testing images on ${url}:`, error);
      }
    }

    return imageResults;
  }
}

export default new BrowserTestService();