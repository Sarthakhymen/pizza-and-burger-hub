// ========================================================
// PIZZA & BURGER HUB - PRODUCTION-GRADE SERVER
// Built to handle 1000+ concurrent users without crashing
// ========================================================

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// ---------------------------------------------------
// 1. CONFIGURATION
// ---------------------------------------------------
const PORT = process.env.PORT || 5500;
const ADMIN_PIN = process.env.ADMIN_PIN || 'admin123';
const DB_FILE = path.join(__dirname, 'db.json');
const MAX_ORDERS_PER_MINUTE = 30; // per IP
const MAX_BOOKINGS_PER_MINUTE = 10;
const DB_FLUSH_INTERVAL = 5000; // write to disk every 5 seconds (not every request)

// ---------------------------------------------------
// 2. SOCKET.IO with connection limits
// ---------------------------------------------------
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6, // 1MB max message
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    }
});

// ---------------------------------------------------  
// 3. MIDDLEWARE STACK
// ---------------------------------------------------
app.use(cors());
app.use(express.json({ limit: '1mb' })); // prevent huge payloads
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.static(path.join(__dirname), {
    maxAge: '1d', // cache static files for 1 day
    etag: true,
    lastModified: true
}));

// Request logging (lightweight)
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (duration > 1000) { // only log slow requests
            console.log(`⚠️ SLOW: ${req.method} ${req.url} - ${duration}ms`);
        }
    });
    next();
});

// ---------------------------------------------------
// 4. IN-MEMORY DATABASE (prevents file I/O per request)
// ---------------------------------------------------
let DB_CACHE = null;
let DB_DIRTY = false; // track if cache has unsaved changes
let DB_WRITE_LOCK = false;

function loadDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const raw = fs.readFileSync(DB_FILE, 'utf8');
            DB_CACHE = JSON.parse(raw);
        } else {
            DB_CACHE = { orders: [], bookings: [], menu: [] };
        }
    } catch (err) {
        console.error('❌ DB load failed, starting fresh:', err.message);
        DB_CACHE = { orders: [], bookings: [], menu: [] };
    }
}

function getDB() {
    if (!DB_CACHE) loadDB();
    return DB_CACHE;
}

function markDirty() {
    DB_DIRTY = true;
}

// Flush to disk periodically (not on every write!)
async function flushDB() {
    if (!DB_DIRTY || DB_WRITE_LOCK) return;
    DB_WRITE_LOCK = true;
    try {
        const data = JSON.stringify(DB_CACHE, null, 2);
        // Write to temp file first, then rename (atomic write - prevents corruption)
        const tempFile = DB_FILE + '.tmp';
        fs.writeFileSync(tempFile, data, 'utf8');
        fs.renameSync(tempFile, DB_FILE);
        DB_DIRTY = false;
    } catch (err) {
        console.error('❌ DB flush failed:', err.message);
    } finally {
        DB_WRITE_LOCK = false;
    }
}

// Periodic flush every 5 seconds
const flushInterval = setInterval(flushDB, DB_FLUSH_INTERVAL);

// Initialize DB on startup
loadDB();
console.log(`📦 DB loaded: ${getDB().orders.length} orders, ${getDB().bookings.length} bookings, ${getDB().menu.length} menu items`);

// ---------------------------------------------------
// 5. RATE LIMITER (in-memory, no dependencies)
// ---------------------------------------------------
const rateLimitStore = new Map();

function rateLimit(key, maxPerMinute) {
    const now = Date.now();
    const windowMs = 60 * 1000;
    
    if (!rateLimitStore.has(key)) {
        rateLimitStore.set(key, []);
    }
    
    const timestamps = rateLimitStore.get(key).filter(t => now - t < windowMs);
    
    if (timestamps.length >= maxPerMinute) {
        return false; // rate limited
    }
    
    timestamps.push(now);
    rateLimitStore.set(key, timestamps);
    return true; // allowed
}

// Clean up old rate limit entries every 2 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of rateLimitStore.entries()) {
        const valid = timestamps.filter(t => now - t < 60000);
        if (valid.length === 0) rateLimitStore.delete(key);
        else rateLimitStore.set(key, valid);
    }
}, 120000);

// ---------------------------------------------------
// 6. INPUT VALIDATION HELPERS
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
    
    // Validate each item
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
// 7. UNIQUE ID GENERATOR (collision-proof)
// ---------------------------------------------------
function generateId(prefix = 'PBH') {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `${prefix}-${timestamp}${random}`;
}

// ---------------------------------------------------
// 8. ADMIN AUTH (supports multiple admin sessions)
// ---------------------------------------------------
const adminSessions = new Map(); // token -> { createdAt, lastActive }
const SESSION_TIMEOUT = 8 * 60 * 60 * 1000; // 8 hours

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

// Clean expired sessions every 30 minutes
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of adminSessions.entries()) {
        if (now - session.lastActive > SESSION_TIMEOUT) {
            adminSessions.delete(token);
        }
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
// 9. API ROUTES - CUSTOMER
// ---------------------------------------------------

// GET /api/menu — serve menu (cached, fast)
app.get('/api/menu', (req, res) => {
    try {
        const db = getDB();
        res.json(db.menu || []);
    } catch (err) {
        console.error('❌ Menu fetch error:', err.message);
        res.status(500).json({ success: false, message: 'Server error, thodi der baad try karein' });
    }
});

// GET /api/orders — returns ALL orders (customers filter on frontend)
app.get('/api/orders', (req, res) => {
    try {
        const db = getDB();
        // Only return last 200 orders to keep response light
        const recentOrders = (db.orders || []).slice(-200);
        res.json(recentOrders);
    } catch (err) {
        console.error('❌ Orders fetch error:', err.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/bookings
app.get('/api/bookings', (req, res) => {
    try {
        const db = getDB();
        res.json(db.bookings || []);
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/orders — Create new order (RATE LIMITED + VALIDATED)
app.post('/api/orders', (req, res) => {
    try {
        const clientIP = req.ip || req.connection.remoteAddress;
        
        // Rate limit check
        if (!rateLimit(`order:${clientIP}`, MAX_ORDERS_PER_MINUTE)) {
            return res.status(429).json({ 
                success: false, 
                message: 'Bohot zyada orders aa rahe hain! Thoda ruko bhai, 1 minute mein try karo.' 
            });
        }

        // Validate input
        const errors = validateOrder(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ success: false, message: errors.join(', ') });
        }

        const db = getDB();
        
        // Verify menu items exist and prices match (prevent price manipulation)
        const verifiedItems = [];
        let verifiedTotal = 0;
        for (const item of req.body.items) {
            const menuItem = db.menu.find(m => m.id === item.id);
            if (!menuItem) {
                return res.status(400).json({ success: false, message: `Item "${item.name}" humari menu mein nahi hai` });
            }
            if (!menuItem.available) {
                return res.status(400).json({ success: false, message: `"${menuItem.name}" abhi available nahi hai` });
            }
            verifiedItems.push({
                id: menuItem.id,
                name: menuItem.name,
                price: menuItem.price, // use SERVER price, not client price
                qty: Math.min(Math.max(parseInt(item.qty) || 1, 1), 50)
            });
            verifiedTotal += menuItem.price * verifiedItems[verifiedItems.length - 1].qty;
        }

        // Calculate delivery fee
        const deliveryFee = (req.body.type === 'delivery' && verifiedTotal < 1000) ? 40 : 0;

        const newOrder = {
            id: generateId('PBH'),
            createdAt: new Date().toISOString(),
            status: 'Order Placed',
            custName: sanitize(req.body.custName),
            custPhone: sanitize(req.body.custPhone),
            custAddress: sanitize(req.body.custAddress || ''),
            type: req.body.type === 'pickup' ? 'pickup' : 'delivery',
            items: verifiedItems,
            total: verifiedTotal + deliveryFee
        };

        db.orders.push(newOrder);
        markDirty();

        // Emit to admin dashboard
        io.emit('newOrder', newOrder);
        
        console.log(`✅ New Order: ${newOrder.id} - ₹${newOrder.total} - ${newOrder.custName}`);
        res.json({ success: true, orderId: newOrder.id, total: newOrder.total });

    } catch (err) {
        console.error('❌ Order creation error:', err.message);
        res.status(500).json({ success: false, message: 'Order nahi lag paaya, phir try karo' });
    }
});

// POST /api/bookings — Create booking (RATE LIMITED + VALIDATED)
app.post('/api/bookings', (req, res) => {
    try {
        const clientIP = req.ip || req.connection.remoteAddress;
        
        if (!rateLimit(`booking:${clientIP}`, MAX_BOOKINGS_PER_MINUTE)) {
            return res.status(429).json({ 
                success: false, 
                message: 'Bohot zyada bookings! 1 minute mein try karo.' 
            });
        }

        const errors = validateBooking(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ success: false, message: errors.join(', ') });
        }

        const db = getDB();
        const newBooking = {
            id: generateId('BKN'),
            createdAt: new Date().toISOString(),
            name: sanitize(req.body.name),
            phone: sanitize(req.body.phone),
            date: req.body.date,
            timeSlot: sanitize(req.body.timeSlot),
            guests: Math.min(Math.max(parseInt(req.body.guests) || 2, 1), 20)
        };

        db.bookings.push(newBooking);
        markDirty();

        io.emit('newBooking', newBooking);
        console.log(`✅ New Booking: ${newBooking.id} - ${newBooking.name} - ${newBooking.date}`);
        res.json({ success: true, bookingId: newBooking.id });

    } catch (err) {
        console.error('❌ Booking error:', err.message);
        res.status(500).json({ success: false, message: 'Booking nahi ho paayi, phir try karo' });
    }
});

// ---------------------------------------------------
// 10. API ROUTES - ADMIN
// ---------------------------------------------------

// Admin Login
app.post('/api/admin/login', (req, res) => {
    try {
        const clientIP = req.ip || req.connection.remoteAddress;
        
        // Rate limit login attempts (5 per minute)
        if (!rateLimit(`login:${clientIP}`, 5)) {
            return res.status(429).json({ success: false, message: 'Bohot zyada attempts! 1 minute ruko.' });
        }

        const { pin } = req.body;
        if (pin === ADMIN_PIN) {
            const token = createAdminSession();
            console.log(`🔐 Admin logged in from ${clientIP}`);
            res.json({ success: true, token });
        } else {
            res.status(401).json({ success: false, message: 'Galat PIN hai bhai!' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: 'Login error' });
    }
});

// Get all data for admin
app.get('/api/admin/all', protectAdmin, (req, res) => {
    try {
        const db = getDB();
        res.json({
            orders: db.orders || [],
            bookings: db.bookings || [],
            menu: db.menu || []
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Data fetch failed' });
    }
});

// Update order status
app.post('/api/orders/:id/status', protectAdmin, (req, res) => {
    try {
        const db = getDB();
        const order = db.orders.find(o => o.id === req.params.id);
        
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order nahi mila!' });
        }

        const validStatuses = ['Order Placed', 'Preparing', 'Shipping', 'Delivered'];
        const newStatus = req.body.status;
        
        if (!validStatuses.includes(newStatus)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        order.status = newStatus;
        if (newStatus === 'Delivered') {
            order.deliveredAt = new Date().toISOString();
        }
        markDirty();

        io.emit('orderUpdated', order);
        console.log(`📋 Order ${order.id} → ${newStatus}`);
        res.json({ success: true });

    } catch (err) {
        console.error('❌ Status update error:', err.message);
        res.status(500).json({ success: false, message: 'Status update failed' });
    }
});

// Update menu item
app.post('/api/menu/update', protectAdmin, (req, res) => {
    try {
        const db = getDB();
        const index = db.menu.findIndex(m => m.id == req.body.id);
        
        if (index === -1) {
            return res.status(404).json({ success: false, message: 'Menu item nahi mila' });
        }

        // Only allow updating safe fields
        if (req.body.price !== undefined) db.menu[index].price = parseInt(req.body.price) || db.menu[index].price;
        if (req.body.available !== undefined) db.menu[index].available = Boolean(req.body.available);
        if (req.body.name) db.menu[index].name = sanitize(req.body.name);
        
        markDirty();
        io.emit('menuUpdated');
        res.json({ success: true });

    } catch (err) {
        res.status(500).json({ success: false, message: 'Menu update failed' });
    }
});

// Add new menu item
app.post('/api/menu/add', protectAdmin, (req, res) => {
    try {
        const db = getDB();
        
        if (!req.body.name || !req.body.price) {
            return res.status(400).json({ success: false, message: 'Name aur price dono zaroori hain' });
        }

        const newItem = {
            id: Date.now().toString(),
            name: sanitize(req.body.name),
            price: parseInt(req.body.price) || 199,
            category: sanitize(req.body.category || 'pizza'),
            img: req.body.img || 'https://placehold.co/400x300',
            available: true
        };

        db.menu.push(newItem);
        markDirty();
        io.emit('menuUpdated');
        
        console.log(`🍕 New menu item: ${newItem.name} - ₹${newItem.price}`);
        res.json({ success: true, item: newItem });

    } catch (err) {
        res.status(500).json({ success: false, message: 'Menu item add failed' });
    }
});

// Delete menu item
app.delete('/api/menu/:id', protectAdmin, (req, res) => {
    try {
        const db = getDB();
        const index = db.menu.findIndex(m => m.id === req.params.id);
        if (index === -1) return res.status(404).json({ success: false, message: 'Item nahi mila' });
        
        db.menu.splice(index, 1);
        markDirty();
        io.emit('menuUpdated');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Delete failed' });
    }
});

// Export orders CSV
app.get('/api/admin/export-orders', protectAdmin, (req, res) => {
    try {
        const db = getDB();
        const orders = db.orders;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');

        const fields = ['Order ID', 'Customer Name', 'Phone', 'Address', 'Status', 'Total', 'Date'];
        let csv = '\uFEFF' + fields.join(',') + '\n'; // BOM for Excel UTF-8

        orders.forEach(o => {
            const row = [
                o.id,
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
// 11. HEALTH CHECK
// ---------------------------------------------------
app.get('/api/health', (req, res) => {
    const db = getDB();
    res.json({
        status: 'running',
        uptime: Math.floor(process.uptime()) + 's',
        orders: db.orders.length,
        bookings: db.bookings.length,
        menuItems: db.menu.length,
        activeSockets: io.engine.clientsCount || 0,
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    });
});

// ---------------------------------------------------
// 12. SOCKET.IO CONNECTION MANAGEMENT
// ---------------------------------------------------
let connectedClients = 0;

io.on('connection', (socket) => {
    connectedClients++;
    if (connectedClients % 100 === 0) { // log every 100 connections
        console.log(`📡 ${connectedClients} clients connected`);
    }
    
    socket.on('disconnect', () => {
        connectedClients--;
    });

    socket.on('error', (err) => {
        console.error('Socket error:', err.message);
    });
});

// ---------------------------------------------------
// 13. GLOBAL ERROR HANDLING (NEVER CRASH)
// ---------------------------------------------------
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Ye route exist nahi karta' });
});

app.use((err, req, res, next) => {
    console.error('❌ Unhandled error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
});

process.on('uncaughtException', (err) => {
    console.error('🔥 UNCAUGHT EXCEPTION:', err.message);
    // Don't exit — keep serving
});

process.on('unhandledRejection', (reason) => {
    console.error('🔥 UNHANDLED REJECTION:', reason);
});

// ---------------------------------------------------
// 14. GRACEFUL SHUTDOWN
// ---------------------------------------------------
function gracefulShutdown(signal) {
    console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);
    
    // Stop accepting new connections
    server.close(() => {
        console.log('✅ HTTP server closed');
    });
    
    // Flush DB one final time
    clearInterval(flushInterval);
    if (DB_DIRTY) {
        try {
            fs.writeFileSync(DB_FILE, JSON.stringify(DB_CACHE, null, 2));
            console.log('✅ DB saved to disk');
        } catch (e) {
            console.error('❌ Final DB save failed:', e.message);
        }
    }
    
    // Close socket.io
    io.close(() => {
        console.log('✅ Socket.IO closed');
        process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
        console.error('⚠️ Could not close gracefully, forcing exit');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ---------------------------------------------------
// 15. START SERVER
// ---------------------------------------------------
server.listen(PORT, () => {
    console.log(`\n🔥 ═══════════════════════════════════════════`);
    console.log(`🔥 PIZZA & BURGER HUB - PRODUCTION SERVER`);
    console.log(`🔥 ═══════════════════════════════════════════`);
    console.log(`🔗 App URL:    http://localhost:${PORT}`);
    console.log(`📊 Admin:      http://localhost:${PORT}/admin.html`);
    console.log(`💚 Health:     http://localhost:${PORT}/api/health`);
    console.log(`📈 Features:   Rate Limiting ✅ | Validation ✅ | Error Handling ✅`);
    console.log(`📦 Database:   In-Memory Cache + Periodic Flush (${DB_FLUSH_INTERVAL/1000}s)`);
    console.log(`🔥 ═══════════════════════════════════════════\n`);
});
