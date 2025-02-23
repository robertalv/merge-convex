/**
 * User Migration Script
 * ====================
 * 
 * This script migrates user data from MongoDB to Convex Cloud.
 * 
 * Prerequisites
 * ------------
 * 1. MongoDB instance running with access to the source database
 * 2. Convex Cloud instance running
 * 3. Node.js installed
 * 4. Required npm packages:
 *    - mongodb
 *    - convex/browser
 * 
 * Configuration
 * ------------
 * Before running the script, update these variables:
 * 1. MONGODB_URI: Your MongoDB connection string
 * 2. CONVEX_URL: Your Convex deployment URL
 * 3. Update the database name in mongoClient.db()
 * 4. Update orgIdMap in mapOrgId function with your organization mappings
 * 
 * User Data Transformation
 * -----------------------
 * The script transforms MongoDB user documents to Convex format:
 * - Normalizes email addresses to lowercase
 * - Combines first and last names
 * - Maps organization IDs
 * - Sets up user presence and verification status
 * - Handles team memberships and roles
 * 
 * Error Handling
 * -------------
 * - Skips users without valid organization IDs
 * - Handles duplicate users (updates instead of creates)
 * - Tracks migration statistics
 * 
 * Usage
 * -----
 * 1. Install dependencies:
 *    npm install mongodb convex
 * 
 * 2. Configure the script variables
 * 
 * 3. Run the script:
 *    node users.js
 */

import { MongoClient } from 'mongodb';
import { ConvexHttpClient } from 'convex/browser';

// Configuration constants
const MONGODB_URI = 'MONGO_URI';
const CONVEX_URL = 'CONVEX_CLOUD_URL';

/**
 * Main migration function
 * Handles the entire migration process from MongoDB to Convex
 */
async function migrateUsers() {
  const mongoClient = new MongoClient(MONGODB_URI);
  const convexClient = new ConvexHttpClient(CONVEX_URL);

  try {
    // Initialize connections
    console.log("Connecting to MongoDB...");
    await mongoClient.connect();
    const db = mongoClient.db('db_name');
    console.log("Connected to database.");

    const usersCollection = db.collection('users');

    // Get total count for progress tracking
    const userCount = await usersCollection.countDocuments({});
    console.log("Users:", userCount);

    console.log("Starting migration...");

    // Initialize cursors and counters
    const cursor = usersCollection.find({});
    let migratedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    // Process each user
    while (await cursor.hasNext()) {
      const oldUser = await cursor.next();
      
      // Transform MongoDB user to Convex format
      const newUser = {
        mongoId: oldUser._id.toString(),
        email: oldUser.email.toLowerCase(),
        emailVerified: true,
        image: oldUser.profileImg,
        isOnboardingComplete: oldUser.isOnBoarded || false,
        name: `${oldUser.firstName} ${oldUser.lastName}`,
        firstName: oldUser.firstName,
        lastName: oldUser.lastName,
        phone: oldUser.phone || '',
        // Map and filter organization IDs
        orgIds: oldUser.team
          .map(t => ({
            id: mapOrgId(t.teamId.toString()),
            role: 'org:member',
            status: t.status.toLowerCase() === 'approved' ? 'active' : 'pending'
          }))
          .filter(org => org.id !== null),
        activeOrgId: mapOrgId(oldUser.teamActive?.toString()) || null,
        presence: {
          lastSeen: oldUser.lastActive ? new Date(oldUser.lastActive).toISOString() : new Date().toISOString(),
          status: 'offline'
        },
        providers: ['']
      };

      // Skip users without valid organizations
      if (newUser.orgIds.length === 0) {
        console.log(`Skipped user ${newUser.email} due to no valid orgIds`);
        skippedCount++;
        continue;
      }

      // Set default active organization if none specified
      if (!newUser.activeOrgId && newUser.orgIds.length > 0) {
        newUser.activeOrgId = newUser.orgIds[0].id;
      }

      // Check for existing user
      const existingUser = await convexClient.query('users:getUserByEmail', { email: newUser.email });

      // Update or create user
      if (existingUser) {
        console.log(`User ${newUser.email} already exists. Updating...`);
        try {
          const updatedUser = await convexClient.mutation('users:update', { id: existingUser._id, ...newUser });
          console.log(`Updated user: ${newUser.email}`, updatedUser);
          updatedCount++;
        } catch (error) {
          console.error(`Failed to update user: ${newUser.email}`, error);
          errorCount++;
        }
      } else {
        console.log(`Creating new user: ${newUser.email}`);
        try {
          const createdUser = await convexClient.mutation('users:create', newUser);
          console.log(`Created user: ${newUser.email}`, createdUser);
          migratedCount++;
        } catch (error) {
          console.error(`Failed to create user: ${newUser.email}`, error);
          errorCount++;
        }
      }
    }

    // Log final statistics
    console.log(`Migration completed. Migrated: ${migratedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);
  } catch (error) {
    console.error('Error during migration:', error);
  } finally {
    await mongoClient.close();
  }
}

/**
 * Maps old status values to new status values
 * @param {string} status - Old status value
 * @returns {string} - New status value
 */
function mapStatus(status) {
  switch (status.toLowerCase()) {
    case 'approved':
      return 'approved';
    case 'active':
      return 'active';
    case 'invited':
      return 'invited'
    case 'pending':
      return 'pending';
    default:
      return 'disabled';
  }
}

/**
 * Maps old organization IDs to new Convex organization IDs
 * @param {string} oldId - MongoDB organization ID
 * @returns {string|null} - Convex organization ID or null if not found
 */
function mapOrgId(oldId) {
  if (!oldId) return null;

  // Map of old MongoDB IDs to new Convex IDs
  const orgIdMap = { 
    '628bff8d44cd3e01b746b737': 'nd73x7djt7ez0zmyp49n6t0x3h6ztghc', // old_id: new_id
    '628ea3ebfeec685660394d1c': 'nd7dzk39r6hzmz012cvmgwgqvn70gdm0',
  };
  return orgIdMap[oldId] || null;
}

// Execute migration
migrateUsers().catch(console.error);

/**
 * Expected Output Format
 * ---------------------
 * Connecting to MongoDB...
 * Connected to database.
 * Users: X
 * Starting migration...
 * Creating/Updating user: user@example.com
 * Migration completed. Migrated: X, Skipped: Y, Errors: Z
 */
