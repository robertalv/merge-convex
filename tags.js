/**
 * Tag Migration Script
 * ==================
 * 
 * This script migrates tags from MongoDB to Convex Cloud. It handles:
 * - Tag creation
 * - Property associations
 * - User mapping
 * - Organization mapping
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
 * Before running the script, you need to set these variables:
 * 1. MONGODB_URI: Your MongoDB connection string
 * 2. CONVEX_URL: Your Convex deployment URL
 * 3. AUTH_TOKEN: Your Convex authentication token
 * 4. Update the MongoDB database name in mongoClient.db()
 * 5. Update the team ObjectIds in the filter if needed
 * 
 * The script includes mapping functions for:
 * - Organization IDs (mapOrgId)
 * - User IDs (mapUserId)
 * Update these mappings according to your data.
 * 
 * Usage
 * -----
 * 1. Install dependencies:
 *    npm install mongodb convex
 * 
 * 2. Configure the script:
 *    - Set MONGODB_URI
 *    - Set CONVEX_URL
 *    - Set AUTH_TOKEN
 *    - Update mappings if needed
 * 
 * 3. Run the script:
 *    node tags.js
 * 
 * Process
 * -------
 * The script will:
 * 1. Connect to MongoDB
 * 2. Authenticate with Convex
 * 3. Fetch existing tags to avoid duplicates
 * 4. Create new tags in Convex
 * 5. Associate tags with properties
 * 
 * Monitoring
 * ---------
 * The script provides detailed logging:
 * - Connection status
 * - Number of tags being processed
 * - Creation and association status for each tag
 * - Errors and skipped items
 * 
 * Error Handling
 * -------------
 * - MongoDB connection issues
 * - Convex authentication failures
 * - Duplicate tag handling
 * - Property association errors
 * 
 * Limitations
 * ----------
 * - Only handles property-type tags
 * - Requires manual mapping configuration
 * - Single-run migration (not incremental)
 * 
 * Example Configuration
 * -------------------
 * const MONGODB_URI = 'mongodb://localhost:27017/your_database';
 * const CONVEX_URL = 'https://your-deployment.convex.cloud';
 * const authToken = 'your_convex_auth_token';
 */


import { MongoClient, ObjectId } from 'mongodb';
import { ConvexHttpClient } from 'convex/browser';

const MONGODB_URI = 'MONGO_URI';
const CONVEX_URL = 'CONVEX_CLOUD_URL';

async function updateTags() {
  const mongoClient = new MongoClient(MONGODB_URI);
  const convexClient = new ConvexHttpClient(CONVEX_URL);

  try {
    console.log("Connecting to MongoDB...");
    await mongoClient.connect();
    const db = mongoClient.db('MONGO_DB_NAME');
    console.log("Connected to MongoDB.");

    console.log("Authenticating with Convex...");
    const authToken = "AUTH_TOKEN";
    convexClient.setAuth(authToken);

    const user = await convexClient.query('users:viewer');
    if (!user) {
      throw new Error("Authentication failed");
    }
    console.log("Authenticated with Convex.");

    const tagDatasCollection = db.collection('tagdatas');
    const tagRefsCollection = db.collection('tagrefs');

    const filter = {
      team: { 
        $in: [
          new ObjectId('628bff8d44cd3e01b746b737'),
          new ObjectId('628ea3ebfeec685660394d1c')
        ]
      },
    };

    const refFilter = {
      type: { $in: ['property'] }
    };

    console.log("Starting migration...");

    // Fetch all tag data and references
    const tagDatas = await tagDatasCollection.find(filter).toArray();
    const tagRefs = await tagRefsCollection.find(refFilter).toArray();
    
    console.log(`Total tags to be processed: ${tagDatas.length}`);
    
    // Create a mapping of references by tagObject ID
    const tagRefMap = tagRefs.reduce((acc, tagRef) => {
      const tagId = tagRef.tagObject.toString();
      if (!acc[tagId]) {
        acc[tagId] = [];
      }
      acc[tagId].push(tagRef);
      return acc;
    }, {});

    // Store created tag IDs for reference
    const createdTags = new Map();

    // Fetch all existing tags to avoid duplicates
    const existingTags = await convexClient.query('tags:getAll'); // Fetch all existing tags

    // Create a Set for quick lookup by ID and name
    const existingTagIds = new Set(existingTags.map(tag => tag.id));
    const existingTagNames = new Set(existingTags.map(tag => tag.name));

    // // First pass: Create all tags
    for (const tagData of tagDatas) {
      try {
        const mongoId = tagData._id.toString();
        const orgId = mapOrgId(tagData.team.toString());
        
        // Check if the tag already exists by ID or name
        if (existingTagIds.has(mongoId) || existingTagNames.has(tagData.tag)) {
          console.log(`Tag already exists: ${tagData.tag} (ID: ${mongoId}), skipping...`);
          continue;
        }

        // Process references for this tag to determine recordType
        const references = tagRefMap[mongoId] || [];
        const hasContacts = references.some(ref => ref.type === 'contact');
        const hasProperties = references.some(ref => ref.type === 'property');
        
        // Determine recordType based on usage
        let recordType;
        if (hasContacts && !hasProperties) recordType = "contacts";
        if (!hasContacts && hasProperties) recordType = "properties";

        // Create the tag without any record association
        const newTagData = {
          orgId,
          name: tagData.tag,
          recordType: "properties",
          userIds: [{
            userId: mapUserId(tagData.userId.toString()),
            role: "tag:admin"
          }],
          mongoId,
        };

        console.log(`Creating tag: ${JSON.stringify(newTagData)}`);
        try {
          const result = await convexClient.mutation('tags:createTagFromMongo', newTagData);
          if (result.status === 'success') {
            createdTags.set(mongoId, result.data);
            console.log(`Created tag with ID: ${result.data}`);
          }
        } catch (error) {
          console.error(`Error creating tag:`, error);
        }

        console.log("Starting record associations...");
        for (const [mongoId, convexTagId] of createdTags) {
          const references = tagRefMap[mongoId] || [];
          
          for (const ref of references) {
            try {
              const recordType = ref.type === 'contact' ? `${ref.type}s` : ref.type === 'property' ? `${ref.type}ies` : `${ref.type}s`;

              let record = await convexClient.query('properties:getByMongoId', { mongoId: ref.refWith.toString() });

              console.log("RECORD CONVEX PROPERTY", record);
              
              // Check if the tag is already associated with the property
              const existingTags = await convexClient.query('tags:getTagsForRecord', { 
                recordId: record._id,
                recordType: 'properties'
              });
              
              // Only add the tag if it's not already associated
              if (!existingTags.some(tag => tag._id === convexTagId)) {
                console.log(`Adding tag ${convexTagId} to ${recordType} ${ref.refWith.toString()}`);
                
                const result = await convexClient.mutation('tags:addTagToRecord', {
                  recordId: record._id,
                  tagId: convexTagId
                });
                
                console.log(`Added tag to record: ${JSON.stringify(result)}`);
              } else {
                console.log(`Tag ${convexTagId} already exists on ${recordType} ${ref.refWith.toString()}, skipping...`);
              }
            } catch (error) {
              console.error(`Error adding tag ${convexTagId} to record ${ref.refWith.toString()}:`, error);
            }
          }
        }

      } catch (error) {
        console.error(`Error processing tag ${tagData._id.toString()}:`, error);
      }
    }

    console.log(`All ${tagDatas.length} tags have been processed. Breaking script...`);
    process.exit(0);
  } catch (error) {
    console.error('Error during migration:', error);
  } finally {
    await mongoClient.close();
  }
}

function mapOrgId(oldId) {
  if (!oldId) return "nd70p3ngxkh8n7chaddb81tjpx7166mr";

  const orgIdMap = { 
    '628bff8d44cd3e01b746b737': 'nd73x7djt7ez0zmyp49n6t0x3h6ztghc',
    '628ea3ebfeec685660394d1c': 'nd7dzk39r6hzmz012cvmgwgqvn70gdm0',
  };
  return orgIdMap[oldId] || null;
}

function mapUserId(oldId) {
  if (!oldId) return null;
  
  const userIdMap = {
    '628c069244cd3e01b746bb27': 'jx7fccjdbh0tkk4d8sm5gkk55572ckx7',
    '628c068a44cd3e01b746bb1b': 'jx72n00r91av5bhvac1y1vj0ss72d194',
    '632245717e8b30f96324399b': 'jx7ehz07gwg8tgz2a085n3t75172cncs',
    '60e1f01a93969009be99b46d': 'jx71hh2kfx7j6v7504envzx1yn72dpk0',
    '628c06f044cd3e01b746bb9e': 'jx72pj9eav4g6wxec8wvc1txjd72d1p3',
    '628c06a644cd3e01b746bb63': 'jx7c59n0knmjg8n8yn62pyvh2s72dhsc',
    '628c06b744cd3e01b746bb7a': 'jx72yacpvkhc779st99xp6sfnx72d5x8',
    '6334d9efe649ad2f1edecbae': 'jx79wfbcyaaqnvcejqmdqpya8x72cr0k',
    '66020ef2ad9f7a60cfd5de5e': 'jx7ax8tdwcp3rd461a8rmn0tz172d1wh',
    '6322457f7e8b30f9632439a7': 'jx7864z64kzcm2p1xfj3wkk83172csvw',
    '665fbbd06451bf23d3eab6c1': 'jx7f7y699zrhyn46aa8dr6ym9572cf20',
    '632245667e8b30f963244398f': 'jx743dfq80jftth0bfdb1e6gq172cnnw',
    '63225d8c7e8b30f963244450': 'jx7d8ft0whj3zcjxqpqd05jdqs72d7mq',
    '66045830ad9f7a60cfd74077': 'jx7amjhxaqxnc55fs7mh4x73gh72d4qz',
    '61382e137d8edd0023c1539d': 'jx77anct8xft6ej3q3tetcbkp172cw5z',
    '636025626b13702974981ad4': 'jx7a5hmy7w66fpkjd4ew8a90rx72ddzf',
    '65fb6089ad9f7a60cfd48b7f': 'jx73e8tf5hp6wvxvew0wks9rth72cs4p',
    '628c06c344cd3e01b746bb86': 'jx7drgj8n8kx18egwwwkje8v9x72dkdf',
    '6363f4a55acbe1bf42c33415': 'jx73wsrz21fdttqfc6wxptyd1h72dygk'
  };

  return userIdMap[oldId] || 'jx7af8p9kcxg2hy7b4zgzez5056ztvpv';
}

updateTags().catch(console.error);
