/**
 * To run this script, you need to have a MongoDB instance running and a Convex Cloud instance running.
 * This script was used to migrate users from MongoDB to Convex Cloud.
 * You can run this script using the following command:
 * node users.js
 */

import { MongoClient } from 'mongodb';
import { ConvexHttpClient } from 'convex/browser';

const MONGODB_URI = 'MONGO_URI';
const CONVEX_URL = 'CONVEX_CLOUD_URL';

async function migrateUsers() {
  const mongoClient = new MongoClient(MONGODB_URI);
  const convexClient = new ConvexHttpClient(CONVEX_URL);

  try {
    console.log("Connecting to MongoDB...");
    await mongoClient.connect();

    const db = mongoClient.db('db_name');
    console.log("Connected to database.");

    const usersCollection = db.collection('users');

    const userCount = await usersCollection.countDocuments({});
    console.log("Users:", userCount);

    console.log("Starting migration...");

    const cursor = usersCollection.find({});
    let migratedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    while (await cursor.hasNext()) {
      const oldUser = await cursor.next();
      
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

      if (newUser.orgIds.length === 0) {
        console.log(`Skipped user ${newUser.email} due to no valid orgIds`);
        skippedCount++;
        continue;
      }

      if (!newUser.activeOrgId && newUser.orgIds.length > 0) {
        newUser.activeOrgId = newUser.orgIds[0].id;
      }

      const existingUser = await convexClient.query('users:getUserByEmail', { email: newUser.email });

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

    console.log(`Migration completed. Migrated: ${migratedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);
  } catch (error) {
    console.error('Error during migration:', error);
  } finally {
    await mongoClient.close();
  }
}

/**
 * This function maps the old status to the new status.
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

function mapOrgId(oldId) {
  if (!oldId) return null;

  /**
   * This function maps the old organization ID to the new organization ID.
   * A new organization has to be created in Convex before running this script.
   */
  const orgIdMap = { 
    '628bff8d44cd3e01b746b737': 'nd73x7djt7ez0zmyp49n6t0x3h6ztghc', // old_id: new_id
    '628ea3ebfeec685660394d1c': 'nd7dzk39r6hzmz012cvmgwgqvn70gdm0',
  };
  return orgIdMap[oldId] || null;
}

migrateUsers().catch(console.error);
