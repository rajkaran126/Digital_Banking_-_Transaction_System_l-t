const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/p10_digital_banking';
    
    // Attempt standard connection with 2s timeout
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 2000
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('Local MongoDB service not running. Initializing Persistent In-Memory MongoDB Server...');
      try {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        const dbPath = path.join(__dirname, '../.mongo-data');
        if (!fs.existsSync(dbPath)) {
          fs.mkdirSync(dbPath, { recursive: true });
        }

        const mongod = await MongoMemoryServer.create({
          instance: {
            dbPath,
            storageEngine: 'wiredTiger'
          }
        });
        const uri = mongod.getUri();
        await mongoose.connect(uri);
        console.log(`Persistent MongoDB Connected at ${uri} (dbPath: ${dbPath})`);
        
        // Auto-seed initial demo dataset ONLY if database is empty
        const seedData = require('../seed');
        await seedData(false, true);
      } catch (memErr) {
        console.error(`Database Error: ${memErr.message}`);
        process.exit(1);
      }
    } else {
      console.error(`Database Connection Error: ${error.message}`);
      process.exit(1);
    }
  }
};

module.exports = connectDB;
