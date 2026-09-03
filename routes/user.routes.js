const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

// All user routes require authentication
router.use(protect);

router.get('/me', userController.getMe);
router.put('/me', validate(schemas.updateProfile), userController.updateMe);

module.exports = router;
