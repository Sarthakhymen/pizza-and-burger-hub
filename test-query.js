require('dotenv').config();
const mongoose = require('mongoose');
const MenuItem = require('./models/MenuItem');

async function test() {
    await mongoose.connect(process.env.MONGODB_URI);
    const res = await MenuItem.findOneAndUpdate({ 
        itemId: '404', 
        available: true, 
        $or: [{ stock: -1 }, { stock: { $gte: 1 } }] 
    }, { 
        $inc: { stock: 0 } 
    }, { new: true });
    console.log(res);
    process.exit(0);
}
test();
