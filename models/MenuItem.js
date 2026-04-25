const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  itemId: { type: String, required: true, unique: true },
  name: { type: String, required: true, maxlength: 200 },
  price: { type: Number, required: true, min: 0 },
  category: {
    type: String,
    enum: ['pizza', 'burger', 'pasta', 'sides', 'beverages'],
    required: true
  },
  img: { type: String, default: 'https://placehold.co/400x300' },
  available: { type: Boolean, default: true },
  stock: { type: Number, default: -1 }, // -1 = unlimited stock
}, { timestamps: true });

// Indexes for fast queries
menuItemSchema.index({ category: 1, available: 1 });

module.exports = mongoose.model('MenuItem', menuItemSchema);
