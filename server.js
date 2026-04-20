const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = 5500;
const DB_FILE = path.join(__dirname, 'db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// DB Persistence
const defaultMenu = [
    { id: "1", name: "The Hub Special", price: 499, category: "pizza", img: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400", available: true },
    { id: "2", name: "Margherita Hub", price: 399, category: "pizza", img: "https://images.unsplash.com/photo-1604068549290-dea0e4a305ca?w=400", available: true },
    { id: "3", name: "Double Cheese Hub", price: 549, category: "pizza", img: "https://images.unsplash.com/photo-1571066811402-9d8d77c84439?w=400", available: true },
    { id: "4", name: "The Mighty Beef", price: 349, category: "burger", img: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400", available: true },
    { id: "5", name: "Spicy Paneer Hub", price: 299, category: "burger", img: "https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?w=400", available: true },
    { id: "6", name: "Chicken Zinger Hub", price: 329, category: "burger", img: "https://images.unsplash.com/photo-1512152272829-e3139592d56f?w=400", available: true }
];

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ orders: [], bookings: [], menu: defaultMenu, staff: [] }, null, 2));
} else {
    // Ensure menu property exists in existing db
    const db = JSON.parse(fs.readFileSync(DB_FILE));
    if (!db.menu) {
        db.menu = defaultMenu;
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    }
}

const getDB = () => JSON.parse(fs.readFileSync(DB_FILE));
const saveDB = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

// API: Orders
app.get('/api/orders', (req, res) => res.json(getDB().orders));
app.post('/api/orders', (req, res) => {
    const order = { id: 'PBH-' + Math.random().toString(36).substr(2, 6).toUpperCase(), ...req.body, createdAt: new Date().toISOString() };
    const db = getDB();
    db.orders.unshift(order);
    saveDB(db);
    io.emit('newOrder', order);
    res.json(order);
});
app.post('/api/orders/:id/status', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const db = getDB();
    const order = db.orders.find(o => o.id === id);
    if (order) { order.status = status; saveDB(db); io.emit('orderUpdated', order); res.json({ success: true }); }
    else res.status(404).json({ error: 'Order not found' });
});

// API: Menu Management
app.get('/api/menu', (req, res) => res.json(getDB().menu));
app.post('/api/menu/update', (req, res) => {
    const { id, price, available } = req.body;
    const db = getDB();
    const item = db.menu.find(i => i.id === id);
    if (item) {
        if (price !== undefined) item.price = Number(price);
        if (available !== undefined) item.available = available;
        saveDB(db);
        io.emit('menuUpdated');
        res.json({ success: true });
    } else res.status(404).json({ error: 'Item not found' });
});
app.post('/api/menu/add', (req, res) => {
    const db = getDB();
    const newItem = { id: Date.now().toString(), available: true, ...req.body };
    db.menu.push(newItem);
    saveDB(db);
    io.emit('menuUpdated');
    res.json(newItem);
});

// API: Bookings & Slots
app.get('/api/bookings', (req, res) => res.json(getDB().bookings));
app.post('/api/bookings', (req, res) => {
    const booking = { id: 'BKN-' + Math.random().toString(36).substr(2, 6).toUpperCase(), ...req.body, createdAt: new Date().toISOString() };
    const db = getDB();
    db.bookings.unshift(booking);
    saveDB(db);
    io.emit('newBooking', booking);
    res.json(booking);
});
app.get('/api/slots/:date', (req, res) => {
    const { date } = req.params;
    const counts = {};
    getDB().bookings.filter(b => b.date === date).forEach(b => counts[b.timeSlot] = (counts[b.timeSlot] || 0) + 1);
    res.json(counts);
});

server.listen(PORT, () => {
    console.log(`\n🔥 PIZZA & BURGER HUB - MANAGEMENT SERVER`);
    console.log(`🔗 App URL: http://localhost:${PORT}`);
    console.log(`📊 Admin: http://localhost:${PORT}/admin.html\n`);
});
