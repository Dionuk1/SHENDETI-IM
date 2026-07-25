const mongoose = require('mongoose');

async function connectDb() {
    const isProduction = process.env.NODE_ENV === 'production';
    const uri = process.env.MONGODB_URI
        || (!isProduction ? process.env.MONGO_URI : '')
        || (!isProduction ? 'mongodb://127.0.0.1:27017/healthflow_os' : '');

    if (!uri) {
        throw new Error('MONGODB_URI is required in production');
    }

    await mongoose.connect(uri, {
        autoIndex: true,
    });

    return mongoose.connection;
}

module.exports = {
    connectDb,
};
