/**
 * Property Coordinates Update Script
 * =================================
 * 
 * This script updates property coordinates in Convex by geocoding addresses using Google Maps API.
 * It processes all properties in the database and adds/updates their location coordinates.
 * 
 * Prerequisites
 * ------------
 * 1. Node.js installed
 * 2. Required npm packages:
 *    - convex/browser
 *    - axios
 * 
 * Setup
 * -----
 * 1. Install dependencies:
 *    npm install convex axios
 * 
 * 2. Configure the following variables:
 *    - CONVEX_URL: Your Convex deployment URL
 *    - GOOGLE_API_KEY: Your Google Maps API key with Geocoding API enabled
 *    - AUTH_TOKEN: Your Convex authentication token
 * 
 * Usage
 * -----
 * Run the script:
 *    node properties.js
 * 
 * The script will:
 * 1. Authenticate with Convex
 * 2. Fetch all properties in batches
 * 3. Process each property's address through Google Geocoding
 * 4. Update the property with new coordinates
 * 
 * Output
 * ------
 * The script provides detailed logging:
 * - Progress of property fetching
 * - Individual property processing status
 * - New coordinates for each property
 * - Final summary with success/error counts
 */

import { ConvexHttpClient } from 'convex/browser';
import axios from 'axios';

// Configuration
// Replace these values with your actual credentials
const CONVEX_URL = 'CONVEX_CLOUD_URL';
const GOOGLE_API_KEY = 'YOUR_GOOGLE_API_KEY';

/**
 * Geocodes an address using Google Maps API
 * @param {Object} address - Property address object
 * @param {string} address.street - Street address
 * @param {string} address.city - City
 * @param {string} address.state - State
 * @param {number} address.zip - ZIP code
 * @returns {Promise<Object|null>} Location object with coordinates or null if failed
 */
async function getCoordinates(address) {
  try {
    const encodedAddress = encodeURIComponent(
      `${address.street}, ${address.city}, ${address.state} ${address.zip}`
    );
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${GOOGLE_API_KEY}`;
    
    const response = await axios.get(url);
    
    if (response.data.results && response.data.results.length > 0) {
      const location = response.data.results[0].geometry.location;
      return {
        coordinates: [location.lng, location.lat],
        type: "Point"
      };
    }
    return null;
  } catch (error) {
    console.error('Error geocoding address:', error);
    return null;
  }
}

/**
 * Main function to update property coordinates
 * Processes all properties in batches and updates their coordinates
 * 
 * Error Handling:
 * - Skips properties without addresses
 * - Logs geocoding failures
 * - Maintains count of successful updates and errors
 * 
 * Rate Limiting:
 * - Includes 200ms delay between requests to avoid API limits
 * - Uses batch size of 1000 for property fetching
 */
async function updateCoordinates() {
  const convexClient = new ConvexHttpClient(CONVEX_URL);

  try {
    console.log("Authenticating with Convex...");
    const authToken = "AUTH_TOKEN";
    convexClient.setAuth(authToken);

    const user = await convexClient.query('users:viewer');
    if (!user) {
      throw new Error("Authentication failed");
    }
    console.log("Authenticated with Convex.");

    console.log("Starting to update coordinates...");

    let allProperties = [];
    let cursor = null;
    let isDone = false;
    let totalPages = 0;

    // First, get total count of properties
    while (!isDone) {
      const result = await convexClient.query('properties:getProperties', {
        orgId: user.activeOrgId,
        paginationOpts: { cursor, numItems: 1000 },
        isDeleted: false
      });

      if (!result.page.length) {
        break;
      }

      totalPages++;
      allProperties = [...allProperties, ...result.page];
      cursor = result.continueCursor;
      isDone = result.isDone;
      console.log(`Fetched page ${totalPages} with ${result.page.length} properties...`);
    }

    console.log(`\nTotal properties found: ${allProperties.length}`);
    console.log(`Total pages: ${totalPages}\n`);
    console.log("Starting coordinate updates...\n");

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Process each property
    for (let i = 0; i < allProperties.length; i++) {
      const property = allProperties[i];
      try {
        if (!property.address) {
          console.log(`[${i + 1}/${allProperties.length}] Skipping property ${property._id}: No address found`);
          skippedCount++;
          continue;
        }

        console.log(`\n[${i + 1}/${allProperties.length}] Processing:`);
        console.log(`Property ID: ${property._id}`);
        console.log(`Address: ${property.address.street}, ${property.address.city}, ${property.address.state} ${property.address.zip}`);
        
        // Get coordinates for the address
        const location = await getCoordinates(property.address);
        
        if (!location) {
          console.log(`Could not get coordinates for property ${property._id}`);
          errorCount++;
          continue;
        }

        console.log(`New coordinates: [${location.coordinates[0]}, ${location.coordinates[1]}]`);

        // Update the property with new coordinates
        await convexClient.mutation('properties:updateProperty', {
          id: property._id,
          orgId: property.orgId,
          location: location
        });

        console.log(`✓ Successfully updated coordinates`);
        updatedCount++;
        
        // Add a small delay to avoid hitting rate limits
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.error(`Error processing property ${property._id}:`, error);
        errorCount++;
      }
    }

    console.log("\nUpdate Summary:");
    console.log("---------------");
    console.log(`Total properties: ${allProperties.length}`);
    console.log(`Successfully updated: ${updatedCount}`);
    console.log(`Skipped (no address): ${skippedCount}`);
    console.log(`Errors: ${errorCount}`);

    process.exit(0);
  } catch (error) {
    console.error('Error during migration:', error);
  }
}

// Script execution
updateCoordinates().catch(console.error);

/**
 * Expected Output Format:
 * ----------------------
 * Authenticating with Convex...
 * Authenticated with Convex.
 * Starting to update coordinates...
 * Fetched page 1 with X properties...
 * 
 * Total properties found: X
 * Total pages: Y
 * 
 * [1/X] Processing:
 * Property ID: abc123
 * Address: 123 Main St, City, State 12345
 * New coordinates: [-123.456, 45.789]
 * ✓ Successfully updated coordinates
 * 
 * Update Summary:
 * ---------------
 * Total properties: X
 * Successfully updated: Y
 * Skipped (no address): Z
 * Errors: W
 */
