const jwt = require('jsonwebtoken');

const generateToken = (user) => {
  const payload = {
    id: user._id.toString(),
    userId: user._id.toString(),
    role: user.role
  };

  return jwt.sign(payload, process.env.JWT_SECRET || 'super_secret_jwt_key_p10_digital_banking_2026', {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

module.exports = generateToken;
