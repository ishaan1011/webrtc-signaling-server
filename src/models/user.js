const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  email:      { type: String, required: true, unique: true },
  username:   { type: String, required: true, unique: true },
  fullName:   { type: String },
  avatarUrl:  { type: String },
  passwordHash: { type: String },         // only for local auth
  googleId:   { type: String },           // only for Google OAuth
}, { timestamps: true });

// hash password on set
userSchema.virtual('password')
  .set(function(pw) {
    this.passwordHash = bcrypt.hashSync(pw, 10);
  });

// compare plain text to hash
userSchema.methods.verifyPassword = function(pw) {
  return bcrypt.compareSync(pw, this.passwordHash);
};

module.exports = mongoose.model('User', userSchema);