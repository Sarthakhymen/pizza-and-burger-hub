// ========================================================
// PIZZA & BURGER HUB - CLOUD PRODUCTION SERVER v3.0
// MongoDB Atlas + Rate Limiting + Caching + Collision Prevention
// Designed for Render.com free tier (24/7 via UptimeRobot)
// ========================================================

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');

// Models
const MenuItem = require('./models/MenuItem');
const Order = require('./models/Order');
const Booking = require('./models/Booking');

// Optional: Sentry error tracking
let Sentry = null;
try {
    if (process.env.SENTRY_DSN) {
        Sentry = require('@sentry/node');
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            environment: process.env.NODE_ENV || 'development',
            tracesSampleRate: 0.1,
        });
        console.log('📊 Sentry error tracking enabled');
    }
} catch (e) {
    console.log('ℹ️ Sentry not installed, skipping error tracking');
}

const app = express();
const server = http.createServer(app);

// ---------------------------------------------------
// 1. CONFIGURATION
// ---------------------------------------------------
const PORT = process.env.PORT || 5500;
const ADMIN_PIN = process.env.ADMIN_PIN || 'admin123';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ---------------------------------------------------
// 2. MONGODB CONNECTION
// ---------------------------------------------------
async function connectDB() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('❌ MONGODB_URI not set in .env!');
        process.exit(1);
    }

    try {
        await mongoose.connect(uri, {
            // Connection pool settings for free tier
            maxPoolSize: 5,
            minPoolSize: 1,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
        });
        console.log('✅ Connected to MongoDB Atlas');

        // Handle connection errors after initial connect
        mongoose.connection.on('error', (err) => {
            console.error('❌ MongoDB connection error:', err.message);
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('⚠️ MongoDB disconnected, attempting reconnect...');
        });

    } catch (err) {
        console.error('❌ MongoDB connection failed:', err.message);
        process.exit(1);
    }
}

// ---------------------------------------------------
// 3. SOCKET.IO
// ---------------------------------------------------
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
    }
});

// ---------------------------------------------------
// 4. MIDDLEWARE STACK
// ---------------------------------------------------

// Sentry request handler (must be first)
if (Sentry) app.use(Sentry.Handlers.requestHandler());

// Trust proxy (required for rate limiting behind Render's proxy)
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.static(path.join(__dirname), {
    maxAge: IS_PRODUCTION ? '7d' : '0',
    etag: true,
    lastModified: true
}));

// Slow request logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (duration > 1000) {
            console.log(`⚠️ SLOW: ${req.method} ${req.url} - ${duration}ms`);
        }
    });
    next();
});

// ---------------------------------------------------
// 5. RATE LIMITERS
// ---------------------------------------------------
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { success: false, message: 'Bohot zyada requests! Thoda ruko bhai 🚦' },
    standardHeaders: true,
    legacyHeaders: false,
});

const orderLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { success: false, message: 'Bohot zyada orders! 1 minute mein try karo.' },
});

const bookingLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { success: false, message: 'Bohot zyada bookings! 1 minute mein try karo.' },
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Bohot zyada login attempts! 15 minute ruko.' },
});

app.use('/api', apiLimiter);

// ---------------------------------------------------
// 6. MENU CACHE (In-Memory, 5-min TTL)
// ---------------------------------------------------
let menuCache = null;
let menuCacheTime = 0;
const MENU_CACHE_TTL = 5 * 60 * 1000;

async function getMenuCached() {
    const now = Date.now();
    if (menuCache && (now - menuCacheTime) < MENU_CACHE_TTL) {
        return menuCache;
    }
    menuCache = await MenuItem.find({}).lean();
    menuCacheTime = now;
    return menuCache;
}

function invalidateMenuCache() {
    menuCache = null;
    menuCacheTime = 0;
}

// ---------------------------------------------------
// 7. INPUT VALIDATION
// ---------------------------------------------------
function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str.trim().replace(/[<>]/g, '').substring(0, 500);
}

function validateOrder(data) {
    const errors = [];
    if (!data.custName || sanitize(data.custName).length < 2) errors.push('Name kamse kam 2 characters ka hona chahiye');
    if (!data.custPhone || !/^[0-9]{10,13}$/.test(data.custPhone.replace(/\s/g, ''))) errors.push('Valid phone number daaliye (10-13 digits)');
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) errors.push('Cart mein kuch toh add karein!');
    if (data.type === 'delivery' && (!data.custAddress || sanitize(data.custAddress).length < 5)) errors.push('Delivery ke liye address likhna zaroori hai');

    if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
            if (!item.id || !item.name || !item.price || !item.qty) {
                errors.push('Cart items mein kuch galat hai');
                break;
            }
            if (item.qty < 1 || item.qty > 50) {
                errors.push('Ek item ki quantity 1-50 ke beech honi chahiye');
                break;
            }
        }
    }
    return errors;
}

function validateBooking(data) {
    const errors = [];
    if (!data.name || sanitize(data.name).length < 2) errors.push('Name likhna zaroori hai');
    if (!data.phone || !/^[0-9]{10,13}$/.test(data.phone.replace(/\s/g, ''))) errors.push('Valid phone number daaliye');
    if (!data.date) errors.push('Date select karein');
    if (!data.timeSlot) errors.push('Time slot select karein');
    if (!data.guests || data.guests < 1 || data.guests > 20) errors.push('Guests 1-20 ke beech hone chahiye');
    return errors;
}

// ---------------------------------------------------
// 8. UNIQUE ID GENERATOR
// ---------------------------------------------------
function generateId(prefix = 'PBH') {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `${prefix}-${timestamp}${random}`;
}

// ---------------------------------------------------
// 9. ADMIN AUTH (session-based)
// ---------------------------------------------------
const adminSessions = new Map();
const SESSION_TIMEOUT = 8 * 60 * 60 * 1000;

function createAdminSession() {
    const token = 'adm-' + crypto.randomBytes(24).toString('hex');
    adminSessions.set(token, { createdAt: Date.now(), lastActive: Date.now() });
    return token;
}

function validateAdminToken(token) {
    if (!token || !adminSessions.has(token)) return false;
    const session = adminSessions.get(token);
    if (Date.now() - session.lastActive > SESSION_TIMEOUT) {
        adminSessions.delete(token);
        return false;
    }
    session.lastActive = Date.now();
    return true;
}

// Clean expired sessions
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of adminSessions.entries()) {
        if (now - session.lastActive > SESSION_TIMEOUT) adminSessions.delete(token);
    }
}, 30 * 60 * 1000);

const protectAdmin = (req, res, next) => {
    const token = req.headers['authorization'];
    if (validateAdminToken(token)) {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Session expired! Phir se login karein.' });
    }
};

// ---------------------------------------------------
// 10. ATOMIC STOCK CHECK (Collision Prevention)
// ---------------------------------------------------
async function verifyAndDeductStock(items) {
    // For each item: atomically check availability and deduct stock
    const verifiedItems = [];
    let total = 0;

    for (const item of items) {
        // Atomic findOneAndUpdate: if stock is tracked, decrement it
        // If two users hit this simultaneously for the last item,
        // only ONE will succeed (MongoDB document-level atomicity)
        const menuItem = await MenuItem.findOneAndUpdate(
            {
                itemId: item.id,
                available: true,
                $or: [
                    { stock: -1 },                        // unlimited stock
                    { stock: { $gte: item.qty } }         // enough stock
                ]
            },
            {
                // Only decrement stock if it's tracked (not -1)
                $inc: {
                    stock: 0 // We'll handle stock decrement conditionally below
                }
            },
            { new: true }
        );

        if (!menuItem) {
            throw new Error(`"${item.name}" abhi available nahi hai ya stock khatam ho gaya`);
        }

        // If stock is tracked, decrement it
        if (menuItem.stock !== -1) {
            const updated = await MenuItem.findOneAndUpdate(
                { itemId: item.id, stock: { $gte: item.qty } },
                { $inc: { stock: -item.qty } },
                { new: true }
            );
            if (!updated) {
                throw new Error(`"${item.name}" ka stock khatam ho gaya!`);
            }
            // Auto-mark unavailable if stock hits 0
            if (updated.stock === 0) {
                await MenuItem.updateOne({ itemId: item.id }, { available: false });
                invalidateMenuCache();
            }
        }

        const qty = Math.min(Math.max(parseInt(item.qty) || 1, 1), 50);
        verifiedItems.push({
            itemId: menuItem.itemId,
            name: menuItem.name,
            price: menuItem.price,  // SERVER price, not client price
            qty: qty
        });
        total += menuItem.price * qty;
    }

    return { verifiedItems, total };
}

// ---------------------------------------------------
// 11. API ROUTES - CUSTOMER
// ---------------------------------------------------

// GET /api/menu
app.get('/api/menu', async (req, res) => {
    try {
        const menu = await getMenuCached();
        res.json(menu);
    } catch (err) {
        console.error('❌ Menu fetch error:', err.message);
        res.status(500).json({ success: false, message: 'Server error, thodi der baad try karein' });
    }
});

// GET /api/orders
app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find({})
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();
        res.json(orders);
    } catch (err) {
        console.error('❌ Orders fetch error:', err.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/bookings
app.get('/api/bookings', async (req, res) => {
    try {
        const bookings = await Booking.find({}).sort({ createdAt: -1 }).lean();
        res.json(bookings);
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/orders — RATE LIMITED + VALIDATED + COLLISION-SAFE
app.post('/api/orders', orderLimiter, async (req, res) => {
    try {
        const errors = validateOrder(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ success: false, message: errors.join(', ') });
        }

        // Atomic stock verification and deduction
        const { verifiedItems, total } = await verifyAndDeductStock(req.body.items);

        // Calculate delivery fee
        const deliveryFee = (req.body.type === 'delivery' && total < 1000) ? 40 : 0;

        const newOrder = new Order({
            orderId: generateId('PBH'),
            custName: sanitize(req.body.custName),
            custPhone: sanitize(req.body.custPhone),
            custAddress: sanitize(req.body.custAddress || ''),
            type: req.body.type === 'pickup' ? 'pickup' : 'delivery',
            items: verifiedItems,
            total: total + deliveryFee,
            status: 'Order Placed',
        });

        await newOrder.save();

        // Emit to admin dashboard (real-time)
        io.emit('newOrder', newOrder.toObject());

        console.log(`✅ New Order: ${newOrder.orderId} - ₹${newOrder.total} - ${newOrder.custName}`);
        res.json({ success: true, orderId: newOrder.orderId, total: newOrder.total });

    } catch (err) {
        console.error('❌ Order creation error:', err.message);
        if (err.message.includes('available nahi') || err.message.includes('stock khatam')) {
            return res.status(400).json({ success: false, message: err.message });
        }
        res.status(500).json({ success: false, message: 'Order nahi lag paaya, phir try karo' });
    }
});

// POST /api/bookings
app.post('/api/bookings', bookingLimiter, async (req, res) => {
    try {
        const errors = validateBooking(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ success: false, message: errors.join(', ') });
        }

        const newBooking = new Booking({
            bookingId: generateId('BKN'),
            name: sanitize(req.body.name),
            phone: sanitize(req.body.phone),
            date: req.body.date,
            timeSlot: sanitize(req.body.timeSlot),
            guests: Math.min(Math.max(parseInt(req.body.guests) || 2, 1), 20),
        });

        await newBooking.save();

        io.emit('newBooking', newBooking.toObject());
        console.log(`✅ New Booking: ${newBooking.bookingId} - ${newBooking.name}`);
        res.json({ success: true, bookingId: newBooking.bookingId });

    } catch (err) {
        console.error('❌ Booking error:', err.message);
        res.status(500).json({ success: false, message: 'Booking nahi ho paayi, phir try karo' });
    }
});

// ---------------------------------------------------
// 12. API ROUTES - ADMIN
// ---------------------------------------------------

app.post('/api/admin/login', loginLimiter, (req, res) => {
    try {
        const { pin } = req.body;
        if (pin === ADMIN_PIN) {
            const token = createAdminSession();
            console.log(`🔐 Admin logged in`);
            res.json({ success: true, token });
        } else {
            res.status(401).json({ success: false, message: 'Galat PIN hai bhai!' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: 'Login error' });
    }
});

app.get('/api/admin/all', protectAdmin, async (req, res) => {
    try {
        const [orders, bookings, menu] = await Promise.all([
            Order.find({}).sort({ createdAt: -1 }).lean(),
            Booking.find({}).sort({ createdAt: -1 }).lean(),
            MenuItem.find({}).lean(),
        ]);
        res.json({ orders, bookings, menu });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Data fetch failed' });
    }
});

// Update order status
app.post('/api/orders/:id/status', protectAdmin, async (req, res) => {
    try {
        const validStatuses = ['Order Placed', 'Preparing', 'Shipping', 'Delivered'];
        const newStatus = req.body.status;
        if (!validStatuses.includes(newStatus)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const updateData = { status: newStatus };
        if (newStatus === 'Delivered') updateData.deliveredAt = new Date();

        const order = await Order.findOneAndUpdate(
            { orderId: req.params.id },
            updateData,
            { new: true }
        );

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order nahi mila!' });
        }

        io.emit('orderUpdated', order.toObject());
        console.log(`📋 Order ${order.orderId} → ${newStatus}`);
        res.json({ success: true });

    } catch (err) {
        console.error('❌ Status update error:', err.message);
        res.status(500).json({ success: false, message: 'Status update failed' });
    }
});

// Update menu item
app.post('/api/menu/update', protectAdmin, async (req, res) => {
    try {
        const updateData = {};
        if (req.body.price !== undefined) updateData.price = parseInt(req.body.price);
        if (req.body.available !== undefined) updateData.available = Boolean(req.body.available);
        if (req.body.name) updateData.name = sanitize(req.body.name);

        const item = await MenuItem.findOneAndUpdate(
            { itemId: req.body.id },
            updateData,
            { new: true }
        );

        if (!item) {
            return res.status(404).json({ success: false, message: 'Menu item nahi mila' });
        }

        invalidateMenuCache();
        io.emit('menuUpdated');
        res.json({ success: true });

    } catch (err) {
        res.status(500).json({ success: false, message: 'Menu update failed' });
    }
});

// Add new menu item
app.post('/api/menu/add', protectAdmin, async (req, res) => {
    try {
        if (!req.body.name || !req.body.price) {
            return res.status(400).json({ success: false, message: 'Name aur price dono zaroori hain' });
        }

        const newItem = new MenuItem({
            itemId: Date.now().toString(),
            name: sanitize(req.body.name),
            price: parseInt(req.body.price) || 199,
            category: sanitize(req.body.category || 'pizza'),
            img: req.body.img || 'https://placehold.co/400x300',
            available: true,
            stock: -1,
        });

        await newItem.save();
        invalidateMenuCache();
        io.emit('menuUpdated');

        console.log(`🍕 New menu item: ${newItem.name} - ₹${newItem.price}`);
        res.json({ success: true, item: newItem.toObject() });

    } catch (err) {
        res.status(500).json({ success: false, message: 'Menu item add failed' });
    }
});

// Delete menu item
app.delete('/api/menu/:id', protectAdmin, async (req, res) => {
    try {
        const result = await MenuItem.findOneAndDelete({ itemId: req.params.id });
        if (!result) return res.status(404).json({ success: false, message: 'Item nahi mila' });

        invalidateMenuCache();
        io.emit('menuUpdated');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Delete failed' });
    }
});

// Export orders CSV
app.get('/api/admin/export-orders', protectAdmin, async (req, res) => {
    try {
        const orders = await Order.find({}).sort({ createdAt: -1 }).lean();

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');

        const fields = ['Order ID', 'Customer Name', 'Phone', 'Address', 'Status', 'Total', 'Date'];
        let csv = '\uFEFF' + fields.join(',') + '\n';

        orders.forEach(o => {
            const row = [
                o.orderId,
                `"${(o.custName || '').replace(/"/g, '""')}"`,
                o.custPhone || '',
                `"${(o.custAddress || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
                o.status,
                o.total,
                new Date(o.createdAt).toLocaleString()
            ];
            csv += row.join(',') + '\n';
        });

        res.send(csv);
    } catch (err) {
        res.status(500).json({ success: false, message: 'Export failed' });
    }
});

// ---------------------------------------------------
// 13. HEALTH CHECK (used by UptimeRobot to keep alive)
// ---------------------------------------------------
app.get('/api/health', async (req, res) => {
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    res.json({
        status: 'running',
        database: dbStatus,
        uptime: Math.floor(process.uptime()) + 's',
        activeSockets: io.engine.clientsCount || 0,
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        cacheActive: menuCache !== null,
    });
});

// ---------------------------------------------------
// 14. SOCKET.IO CONNECTION MANAGEMENT
// ---------------------------------------------------
let connectedClients = 0;

io.on('connection', (socket) => {
    connectedClients++;
    if (connectedClients % 100 === 0) {
        console.log(`📡 ${connectedClients} clients connected`);
    }
    socket.on('disconnect', () => connectedClients--);
    socket.on('error', (err) => console.error('Socket error:', err.message));
});

// ---------------------------------------------------
// 15. ERROR HANDLING
// ---------------------------------------------------
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Ye route exist nahi karta' });
});

// Sentry error handler
if (Sentry) app.use(Sentry.Handlers.errorHandler());

app.use((err, req, res, next) => {
    console.error('❌ Unhandled error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
});

process.on('uncaughtException', (err) => {
    console.error('🔥 UNCAUGHT EXCEPTION:', err.message);
    if (Sentry) Sentry.captureException(err);
});

process.on('unhandledRejection', (reason) => {
    console.error('🔥 UNHANDLED REJECTION:', reason);
    if (Sentry) Sentry.captureException(reason);
});

// ---------------------------------------------------
// 16. GRACEFUL SHUTDOWN
// ---------------------------------------------------
function gracefulShutdown(signal) {
    console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);
    server.close(() => console.log('✅ HTTP server closed'));
    io.close(() => {
        mongoose.connection.close(false).then(() => {
            console.log('✅ MongoDB connection closed');
            process.exit(0);
        });
    });
    setTimeout(() => {
        console.error('⚠️ Could not close gracefully, forcing exit');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ---------------------------------------------------
// 17. START SERVER
// ---------------------------------------------------
async function start() {
    await connectDB();

    server.listen(PORT, () => {
        console.log(`\n🔥 ═══════════════════════════════════════════`);
        console.log(`🔥 PIZZA & BURGER HUB - CLOUD SERVER v3.0`);
        console.log(`🔥 ═══════════════════════════════════════════`);
        console.log(`🔗 App URL:    http://localhost:${PORT}`);
        console.log(`📊 Admin:      http://localhost:${PORT}/admin.html`);
        console.log(`💚 Health:     http://localhost:${PORT}/api/health`);
        console.log(`📈 Features:   MongoDB Atlas ✅ | Rate Limiting ✅ | Menu Cache ✅`);
        console.log(`🔒 Security:   Input Validation ✅ | Atomic Stock ✅ | Sentry ${Sentry ? '✅' : '❌'}`);
        console.log(`🔥 ═══════════════════════════════════════════\n`);
    });
}

start();
