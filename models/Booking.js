const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  bookingId: { type: String, required: true, unique: true },
  name: { type: String, required: true, maxlength: 200 },
  phone: { type: String, required: true },
  date: { type: String, required: true },
  timeSlot: { type: String, required: true },
  guests: { type: Number, min: 1, max: 20, default: 2 },
}, { timestamps: true });

// Indexes
bookingSchema.index({ date: 1, timeSlot: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
