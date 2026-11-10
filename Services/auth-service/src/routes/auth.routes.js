import express from 'express';
import {
  register, login, logout, getMe, changePassword,
  forgotPassword, resetPassword, resetTempPassword,
  verifyEmail, resendVerification, updateProfile,
  loginStep1, loginStep2, resendOTP, refresh, sendSetPasswordLink, selectTenant,
} from '../controllers/auth.controller.js';

const router = express.Router();

// Public
router.post('/register', register);
router.post('/login', login);
router.post('/login-step1', loginStep1);
router.post('/login-step2', loginStep2);
router.post('/resend-otp', resendOTP);
router.post('/forgot-password', forgotPassword);
router.put('/reset-password/:token', resetPassword);
router.post('/reset-temp-password', resetTempPassword);
router.get('/verify-email/:token', verifyEmail);
router.post('/refresh', refresh);
router.post('/select-tenant', selectTenant);
router.post('/logout', logout);

// Protected (user info from gateway headers)
router.get('/me', getMe);
router.post('/users/:userId/set-password-link', sendSetPasswordLink);
router.put('/change-password', changePassword);
router.post('/resend-verification', resendVerification);
router.put('/profile', updateProfile);

export default router;
