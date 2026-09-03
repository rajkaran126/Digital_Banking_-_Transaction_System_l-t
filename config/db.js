const mongoose = require('mongoose');

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
      console.log('Local MongoDB not running. Initializing In-Memory MongoDB Server for development...');
      try {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        const mongod = await MongoMemoryServer.create();
        const uri = mongod.getUri();
        await mongoose.connect(uri);
        console.log(`In-Memory MongoDB Connected at ${uri}`);
        
        // Auto-seed initial demo dataset
        const seedData = require('../seed');
        await seedData(false);
      } catch (memErr) {
        console.error(`In-Memory Database Error: ${memErr.message}`);
        process.exit(1);
      }
    } else {
      console.error(`Database Connection Error: ${error.message}`);
      process.exit(1);
    }
  }
};

module.exports = connectDB;
