const mongoose = require('mongoose');

async function connectDb() {
    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/healthflow_os';

    await mongoose.connect(uri, {
        autoIndex: true,
    });

    return mongoose.connection;
}

module.exports = {
    connectDb,
};
