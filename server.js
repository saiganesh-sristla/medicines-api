const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const popularMedicines = {
    painRelievers: [
      "Aspirin", "Ibuprofen", "Acetaminophen", "Naproxen", "Celecoxib"
    ],
    antihistamines: [
      "Cetirizine", "Loratadine", "Diphenhydramine", "Fexofenadine", "Desloratadine"
    ],
    antibiotics: [
      "Amoxicillin", "Azithromycin", "Ciprofloxacin", "Doxycycline", "Cephalexin"
    ],
    antidepressants: [
      "Sertraline", "Fluoxetine", "Escitalopram", "Venlafaxine", "Bupropion"
    ],
    statins: [
      "Atorvastatin", "Simvastatin", "Rosuvastatin", "Pravastatin", "Lovastatin"
    ],
    antihypertensives: [
      "Lisinopril", "Amlodipine", "Losartan", "Metoprolol", "Hydrochlorothiazide"
    ],
    diabetesMedications: [
      "Metformin", "Glipizide", "Insulin", "Empagliflozin", "Sitagliptin"
    ],
    anxiolytics: [
      "Alprazolam", "Diazepam", "Lorazepam", "Buspirone", "Clonazepam"
    ],
    gastrointestinalMedications: [
      "Omeprazole", "Famotidine", "Esomeprazole", "Pantoprazole", "Ranitidine"
    ],
    respiratoryMedications: [
      "Albuterol", "Fluticasone", "Montelukast", "Tiotropium", "Budesonide"
    ]
  };

// Configure axios defaults
const axiosConfig = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br'
  },
  timeout: 10000
};

// Utility functions
const cleanText = (text) => text.replace(/\s+/g, ' ').trim();

const extractSectionContent = ($, sectionId) => {
  try {
    // Find the section header first
    const sectionHeader = $(`#${sectionId}`).first();
    if (!sectionHeader.length) return "Information not available";
    
    // Get the section's content div (typically follows the header)
    let sectionContent;
    
    // Try different approaches to find content
    // 1. Check if there's a div with content after the header
    sectionContent = sectionHeader.next('div.contentBox, div.drug-content');
    
    // 2. If not found, look for content within the parent container
    if (!sectionContent.length) {
      const parentContainer = sectionHeader.closest('div.contentBox, div.drug-content');
      if (parentContainer.length) {
        // Clone the parent to avoid modifying the original
        const container = parentContainer.clone();
        // Remove the header and any other non-content elements
        container.find('h1, h2, h3, h4, .more-resources, .references, .footnotes, script, style').remove();
        return cleanText(container.text()) || "Information not available";
      }
    }
    
    // 3. If still not found, get all content until the next header
    if (!sectionContent.length) {
      let content = [];
      let currentElement = sectionHeader.next();
      
      while (currentElement.length && !currentElement.is('h1, h2, h3, h4, #uses, #warnings, #dosage, #side-effects, #interactions, #precautions')) {
        if (currentElement.is('p, ul, ol, table')) {
          content.push(cleanText(currentElement.text()));
        }
        currentElement = currentElement.next();
      }
      
      if (content.length) {
        return content.join(' ');
      }
    }
    
    // 4. If we have content from approach 1, extract it
    if (sectionContent.length) {
      // Special handling for dosage tables
      if (sectionId === 'dosage') {
        const dosageData = [];
        sectionContent.find('table tr').each((i, row) => {
          const cols = $(row).find('td').map((i, td) => $(td).text().trim()).get();
          if (cols.length > 1) dosageData.push(cols.join(' - '));
        });
        if (dosageData.length > 0) return dosageData.join('\n');
      }
      
      return cleanText(sectionContent.text()).substring(0, 2000) || "Information not available";
    }
    
    // Fallback: try to get content from siblings
    const siblings = sectionHeader.siblings('p, div:not(.contentBox), ul, ol, table').slice(0, 5);
    if (siblings.length) {
      return cleanText(siblings.text()).substring(0, 2000) || "Information not available";
    }
    
    return "Information not available";
  } catch (error) {
    console.error(`Error extracting ${sectionId}: ${error.message}`);
    return "Content unavailable";
  }
};

// Main medicine endpoint
app.get("/medicine/:name", async (req, res) => {
  try {
    const medicineName = req.params.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let medicineUrl = `https://www.drugs.com/${medicineName}.html`;
    
    let response;
    try {
      // Try direct access first
      response = await axios.get(medicineUrl, axiosConfig);
    } catch (directError) {
      // Fallback to search
      const searchUrl = `https://www.drugs.com/search.php?searchterm=${encodeURIComponent(medicineName)}`;
      const searchResponse = await axios.get(searchUrl, axiosConfig);
      const $ = cheerio.load(searchResponse.data);
      
      const resultLink = $('a[href*="/pro/"]').first().attr('href') 
        || $('a[href^="/"]').not('[href*="search"]').first().attr('href');
      
      if (!resultLink) throw new Error('No search results found');
      medicineUrl = resultLink.startsWith('/') 
        ? `https://www.drugs.com${resultLink}`
        : resultLink;
      
      response = await axios.get(medicineUrl, axiosConfig);
    }

    const $ = cheerio.load(response.data);

    // Verify valid page
    if ($('h1:contains("404"), .error404').length > 0) {
      return res.status(404).json({
        error: "Page not found",
        attemptedUrl: medicineUrl,
        suggestion: "Try different medication name"
      });
    }

    // Extract basic information
    const name = $('h1').first().text().trim();
    
    // Better extraction for drug metadata
    let generic = "";
    let brandNames = "";
    let drugClass = "";
    
    // Extract generic name
    const genericText = $('.drug-subtitle:contains("Generic name:")').text();
    if (genericText) {
      generic = genericText.replace('Generic name:', '').trim();
    }
    
    // Extract brand names
    const brandText = $('.drug-subtitle:contains("Brand names:")').text();
    if (brandText) {
      brandNames = brandText.replace('Brand names:', '').trim();
    }
    
    // Extract drug class
    const classText = $('.drug-subtitle:contains("Drug class:")').text();
    if (classText) {
      drugClass = classText.replace('Drug class:', '').trim();
    }
    
    // Alternative approach for drug class if not found
    if (!drugClass) {
      const dcText = $('p:contains("Drug class:")').text();
      if (dcText) {
        drugClass = dcText.split('Drug class:')[1]?.trim() || "";
      }
    }

    // Extract core information
    const medicineInfo = {
      name: name,
      generic: generic,
      brandNames: brandNames,
      drugClass: drugClass,
      uses: extractSectionContent($, 'uses'),
      warnings: extractSectionContent($, 'warnings'),
      dosage: extractSectionContent($, 'dosage'),
      sideEffects: extractSectionContent($, 'side-effects'),
      interactions: extractSectionContent($, 'interactions'),
      precautions: extractSectionContent($, 'precautions'),
      source: medicineUrl
    };

    // Fallback for common alternative sections
    if (medicineInfo.uses === "Information not available") {
      medicineInfo.uses = extractSectionContent($, 'monograph');
    }

    res.json(medicineInfo);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error: ${error.message}`);
    res.status(500).json({
      error: "Failed to retrieve information",
      details: error.message,
      troubleshooting: [
        "Try both brand and generic names (e.g., /medicine/ibuprofen)",
        "Check spelling and special characters",
        "Example working endpoints:",
        "/medicine/aspirin",
        "/medicine/omeprazole",
        "/medicine/metformin"
      ]
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "active",
    timestamp: new Date().toISOString(),
    version: "1.2.0"
  });
});

// Get all popular medicines endpoint
app.get("/popular-medicines", (req, res) => {
    try {
      const category = req.query.category;
      const format = req.query.format || 'full'; // Options: 'full', 'list', 'grouped'
      
      // Handle category-specific request
      if (category && popularMedicines[category]) {
        return res.json({
          category: category,
          medicines: popularMedicines[category]
        });
      }
      
      // Return all medicines in the requested format
      if (format === 'list') {
        // Flat list of all medicine names
        const allMedicines = Object.values(popularMedicines).flat();
        return res.json({
          count: allMedicines.length,
          medicines: allMedicines
        });
      } else if (format === 'grouped') {
        // Return the entire structure
        return res.json({
          categories: Object.keys(popularMedicines),
          medicines: popularMedicines
        });
      } else {
        // Default full format with metadata
        const allMedicines = Object.values(popularMedicines).flat();
        return res.json({
          status: "success",
          count: allMedicines.length,
          categories: Object.keys(popularMedicines),
          categoryCount: Object.keys(popularMedicines).length,
          data: popularMedicines,
          endpoints: {
            all: "/popular-medicines",
            list: "/popular-medicines?format=list",
            byCategory: "/popular-medicines?category=painRelievers"
          }
        });
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error in popular-medicines: ${error.message}`);
      res.status(500).json({
        error: "Failed to retrieve popular medicines",
        details: error.message
      });
    }
  });
  
  // Get random popular medicine endpoint
  app.get("/random-medicine", (req, res) => {
    try {
      // Get all medicine names
      const allMedicines = Object.values(popularMedicines).flat();
      
      // Select a random medicine
      const randomIndex = Math.floor(Math.random() * allMedicines.length);
      const randomMedicine = allMedicines[randomIndex];
      
      // Find which category it belongs to
      const category = Object.keys(popularMedicines).find(key => 
        popularMedicines[key].includes(randomMedicine)
      );
      
      res.json({
        medicine: randomMedicine,
        category: category,
        info: `/medicine/${randomMedicine.toLowerCase()}`
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error in random-medicine: ${error.message}`);
      res.status(500).json({
        error: "Failed to retrieve random medicine",
        details: error.message
      });
    }
  });
  
  // Dynamic search endpoint for popular medicines
  app.get("/search-medicines", (req, res) => {
    try {
      const query = req.query.q?.toLowerCase() || '';
      
      if (!query || query.length < 2) {
        return res.status(400).json({
          error: "Search query must be at least 2 characters",
          hint: "Use /popular-medicines for a full list"
        });
      }
      
      const results = {};
      
      // Search through all categories
      for (const [category, medicines] of Object.entries(popularMedicines)) {
        const matchedMedicines = medicines.filter(med => 
          med.toLowerCase().includes(query)
        );
        
        if (matchedMedicines.length > 0) {
          results[category] = matchedMedicines;
        }
      }
      
      // Flatten results if requested
      const format = req.query.format || 'grouped';
      if (format === 'list') {
        const flatResults = Object.values(results).flat();
        return res.json({
          query: query,
          count: flatResults.length,
          results: flatResults
        });
      }
      
      const totalMatches = Object.values(results).flat().length;
      
      if (totalMatches === 0) {
        return res.json({
          query: query,
          matches: 0,
          message: "No medicines found matching your query",
          suggestion: "Try a different search term or check /popular-medicines for a full list"
        });
      }
      
      res.json({
        query: query,
        matches: totalMatches,
        categories: Object.keys(results).length,
        results: results
      });
      
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error in search-medicines: ${error.message}`);
      res.status(500).json({
        error: "Failed to search medicines",
        details: error.message
      });
    }
  });

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`
Medicine API Server running on port ${PORT}
Test endpoints:
http://localhost:${PORT}/medicine/aspirin
http://localhost:${PORT}/health
`));