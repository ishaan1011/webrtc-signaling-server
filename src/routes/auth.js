const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/authController');
const authMW  = require('../middleware/auth');

// public
router.post('/register', ctrl.register);
router.post('/login',    ctrl.login);
router.post('/google',   ctrl.googleAuth);

// protected
router.get('/me', authMW, ctrl.me);

module.exports = router;