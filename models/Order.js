const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  custName: { type: String, required: true, maxlength: 200 },
  custPhone: { type: String, required: true },
  custAddress: { type: String, maxlength: 500, default: '' },
  type: { type: String, enum: ['delivery', 'pickup'], default: 'delivery' },
  items: [{
    itemId: String,
    name: String,
    price: Number,
    qty: { type: Number, min: 1, max: 50 }
  }],
  total: { type: Number, required: true },
  status: {
    type: String,
    enum: ['Order Placed', 'Preparing', 'Shipping', 'Delivered'],
    default: 'Order Placed'
  },
  deliveredAt: Date,
}, { timestamps: true });

// Indexes for common queries
orderSchema.index({ custPhone: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
