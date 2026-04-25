// ========================================================
// SEED.JS — Migrate db.json data to MongoDB Atlas
// Run once: node seed.js
// ========================================================

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const MenuItem = require('./models/MenuItem');
const Order = require('./models/Order');
const Booking = require('./models/Booking');

const DB_FILE = path.join(__dirname, 'db.json');

async function migrate() {
    console.log('🚀 Starting migration to MongoDB Atlas...\n');

    if (!process.env.MONGODB_URI) {
        console.error('❌ MONGODB_URI not found in .env file!');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB Atlas\n');

    if (!fs.existsSync(DB_FILE)) {
        console.error('❌ db.json not found! Nothing to migrate.');
        process.exit(1);
    }

    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

    // --- Migrate Menu Items ---
    if (db.menu && db.menu.length > 0) {
        await MenuItem.deleteMany({});
        const menuDocs = db.menu.map(m => ({
            itemId: m.id,
            name: m.name,
            price: m.price,
            category: m.category || 'pizza',
            img: m.img || 'https://placehold.co/400x300',
            available: m.available !== false,
            stock: -1, // unlimited by default
        }));
        await MenuItem.insertMany(menuDocs);
        console.log(`✅ Migrated ${menuDocs.length} menu items`);
    }

    // --- Migrate Orders ---
    if (db.orders && db.orders.length > 0) {
        await Order.deleteMany({});
        const orderDocs = db.orders.map(o => ({
            orderId: o.id,
            custName: o.custName,
            custPhone: o.custPhone,
            custAddress: o.custAddress || '',
            type: o.type || 'delivery',
            items: (o.items || []).map(i => ({
                itemId: i.id,
                name: i.name,
                price: i.price,
                qty: i.qty || 1
            })),
            total: o.total,
            status: o.status || 'Order Placed',
            deliveredAt: o.deliveredAt ? new Date(o.deliveredAt) : undefined,
            createdAt: new Date(o.createdAt),
        }));
        await Order.insertMany(orderDocs);
        console.log(`✅ Migrated ${orderDocs.length} orders`);
    }

    // --- Migrate Bookings ---
    if (db.bookings && db.bookings.length > 0) {
        await Booking.deleteMany({});
        const bookingDocs = db.bookings.map(b => ({
            bookingId: b.id,
            name: b.name,
            phone: b.phone,
            date: b.date,
            timeSlot: b.timeSlot,
            guests: parseInt(b.guests) || 2,
            createdAt: new Date(b.createdAt),
        }));
        await Booking.insertMany(bookingDocs);
        console.log(`✅ Migrated ${bookingDocs.length} bookings`);
    }

    console.log('\n🎉 Migration complete! Your data is now in MongoDB Atlas.');
    console.log('💡 You can now safely deploy to Render.com');
    process.exit(0);
}

migrate().catch(err => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
});
