import express from 'express';
import * as ctrl from '../controllers/authController.js';
import authMiddleware from '../middleware/auth.js';
const router = express.Router();

// public
router.post('/register', ctrl.register);
router.post('/login',    ctrl.login);
router.post('/google',   ctrl.googleAuth);

// protected
router.get('/me', authMiddleware, ctrl.me);

export default router;